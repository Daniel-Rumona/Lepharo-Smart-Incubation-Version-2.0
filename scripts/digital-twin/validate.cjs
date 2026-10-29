const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const {
  generate,
  encode,
  decode,
  hash,
  RUN,
  REF,
  DEPARTMENTS,
  BRANCHES,
} = require("./dataset.cjs");
function loadTs(relative, cache = new Map()) {
  const filename = path.resolve(__dirname, "../..", relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  cache.set(filename, m);
  m.require = (name) =>
    name.startsWith(".")
      ? loadTs(
          path.relative(
            path.resolve(__dirname, "../.."),
            path.resolve(path.dirname(filename), name + ".ts")
          ),
          cache
        )
      : require(name);
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    filename
  );
  return m.exports;
}
function validate(dataset) {
  const map = new Map(dataset.records.map((r) => [r.path, r.data]));
  assert.equal(map.size, dataset.records.length);
  const rows = (c) =>
    dataset.records
      .filter((r) => r.path.startsWith(c + "/"))
      .map((r) => r.data);
  const { resolveAssignmentLifecycle } = loadTs(
    "src/services/assignmentLifecycleService.ts"
  );
  const { resolveMovPosition } = loadTs("src/services/movPipeline.ts");
  const { splitMovRequirement } = loadTs("src/services/completionMovRules.ts");
  const { buildTowerModel, indexPacksByMovId } = loadTs(
    "src/services/interventionTower.ts"
  );
  const { suppressRecordNotifications } = loadTs(
    "functions/src/syntheticData.ts"
  );
  const ref = (c, i) => {
    assert.ok(map.has(`${c}/${i}`), `Missing ${c}/${i}`);
    return map.get(`${c}/${i}`);
  };
  const knownDepts = new Set(DEPARTMENTS.map((d) => d.id)),
    knownBranches = new Set(BRANCHES.map((b) => b.id));
  for (const { path: p, data } of dataset.records) {
    assert.ok(p.split("/")[1].startsWith(RUN));
    assert.equal(data.dataOrigin, "synthetic");
    assert.equal(data.seedRunId, RUN);
    assert.ok(suppressRecordNotifications(data, p.split("/")[1]));
    if (data.programId) ref("programs", data.programId);
    if (data.participantId) ref("participants", data.participantId);
    if (data.departmentId) assert.ok(knownDepts.has(data.departmentId));
    if (data.branchId) assert.ok(knownBranches.has(data.branchId));
    const check = (value) => {
      assert.notEqual(value, undefined, `Undefined field in ${p}`);
      if (value && typeof value === "object" && !value.toDate)
        Object.values(value).forEach(check);
      if (typeof value === "string" && value.includes("@"))
        assert.ok(
          value.endsWith("@example.invalid"),
          `Non-synthetic contact in ${p}`
        );
    };
    check(data);
    assert.ok(
      Buffer.byteLength(JSON.stringify(encode(data))) < 900000,
      `Oversized ${p}`
    );
  }
  const assignments = rows("assignedInterventions");
  assert.equal(assignments.length, 300);
  assert.equal(rows("participants").length, 60);
  const life = {},
    outcomes = {},
    pipeline = {};
  for (const a of assignments) {
    ref("participants", a.participantId);
    ref("interventions", a.interventionId);
    ref("coordinators", a.assigneeId);
    const actual = resolveAssignmentLifecycle(a).key;
    assert.equal(actual, dataset.expectations.lifecycle[a.id], a.id);
    life[actual] = (life[actual] || 0) + 1;
    if (a.completedAt) {
      assert.ok(a.completedAt.toMillis() >= a.createdAt.toMillis());
      assert.ok(a.completedAt.toMillis() <= Date.parse(REF));
    }
    if (a.movDocumentId)
      assert.equal(
        ref("movDocuments", a.movDocumentId).assignedInterventionId,
        a.id
      );
    if (
      a.groupKey &&
      !Object.values(a.sessionAttendanceByAppointment).some(
        (r) => r.outcome === "attended"
      )
    ) {
      assert.equal(a.movDocumentId, null);
      assert.equal(splitMovRequirement([a]).required.length, 0);
    }
    if (a.outcome)
      outcomes[a.outcome.status] = (outcomes[a.outcome.status] || 0) + 1;
  }
  for (const a of rows("appointments")) {
    const s = ref("appointmentSessions", a.appointmentSessionId),
      assignment = ref("assignedInterventions", a.assignedInterventionId);
    assert.equal(assignment.participantId, a.smeId);
    assert.equal(assignment.programId, a.programId);
    assert.equal(s.programId, a.programId);
    assert.equal(s.departmentId, a.departmentId);
    assert.equal(s.interventionId, a.interventionId);
    if (a.attendance.checkedOutAt)
      assert.ok(
        a.attendance.checkedOutAt.toMillis() >=
          a.attendance.checkedInAt.toMillis()
      );
  }
  for (const s of rows("appointmentSessions")) {
    assert.ok(s.endAt.toMillis() > s.startAt.toMillis());
    const attendees = rows("appointments").filter(
      (a) => a.appointmentSessionId === s.id
    );
    assert.equal(s.attendanceSummary.invitedCount, attendees.length);
    assert.equal(
      s.attendanceSummary.attendedCount,
      attendees.filter((a) => a.attendance.status === "attended").length
    );
  }
  for (const f of rows("outcomeFollowUps")) {
    const a = ref("assignedInterventions", f.assignedInterventionId);
    assert.equal(resolveAssignmentLifecycle(a).key, "completed");
    assert.ok(f.dueAt.toMillis() > a.completedAt.toMillis());
    if (f.status === "answered")
      assert.ok(
        f.answeredAt.toMillis() >= f.dueAt.toMillis() &&
          f.answeredAt.toMillis() <= Date.parse(REF)
      );
  }
  for (const a of rows("outcomeAssessments")) {
    ref("outcomeFollowUps", a.followUpId);
    const assignment = ref("assignedInterventions", a.assignedInterventionId);
    assert.ok(["achieved", "partial", "not_yet"].includes(a.assessment));
    assert.ok(
      a.at.toMillis() >= assignment.completedAt.toMillis() &&
        a.at.toMillis() <= Date.parse(REF)
    );
    if (a.byRole === "sme") assert.equal(a.confidence, "self_reported");
  }
  for (const p of rows("participants")) {
    assert.equal(Object.keys(p.revenueHistory.monthly).length, 12);
    assert.equal(
      new Set(p.interventions.assigned.map((a) => a.assignedInterventionId))
        .size,
      p.interventions.assigned.length
    );
    assert.equal(
      hash(p.interventions),
      hash(ref("applications", p.applicationId).interventions)
    );
  }
  const packs = rows("consolidatedMOVs"),
    packByMov = indexPacksByMovId(packs);
  for (const mov of rows("movDocuments")) {
    assert.ok(!['generated', 'signed'].includes(mov.status), 'Legacy notification-triggering MOV states are not allowed in this seed');
    const stage = resolveMovPosition(mov, packByMov.get(mov.id)).stage;
    assert.equal(stage, dataset.expectations.movStages[mov.id], mov.id);
    pipeline[stage] = (pipeline[stage] || 0) + 1;
  }
  const tower = buildTowerModel({
    assignments,
    movs: rows("movDocuments"),
    packs,
    now: Date.parse(REF),
  });
  assert.equal(tower.totals.assignments, 300);
  assert.ok(tower.stuck.length > 0);
  assert.ok(tower.totals.stuckDelivery > 0);
  assert.ok(tower.totals.stuckEvidence > 0);
  assert.ok(
    outcomes.achieved > 0 && outcomes.partial > 0 && outcomes.not_yet > 0
  );
  assert.ok(
    assignments.some(
      (a) =>
        a.outcome?.status === "achieved" && a.outcome?.smeStatus === "not_yet"
    )
  );
  return {
    counts: dataset.counts,
    lifecycle: life,
    outcomes,
    pipeline,
    stuck: tower.totals,
    groupSessions: dataset.expectations.groups.length,
    datasetHash: hash(dataset.records),
  };
}
if (require.main === module) {
  const d = generate();
  const summary = validate(d);
  assert.equal(hash(d), hash(generate()), "Generator must be deterministic");
  assert.equal(hash(d), hash(decode(encode(d))), "Timestamp roundtrip");
  console.log(JSON.stringify(summary, null, 2));
}
module.exports = { validate, loadTs };
