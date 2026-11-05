// Tests for the shared digital-twin rules. Run with `npm run test:twin` in functions/.
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAssignmentLifecycle, type AssignmentLifecycleKey } from "./lifecycle";
import {
  buildTwinRecord,
  classifyAssignment,
  comparePeers,
  computeGrowthScore,
  averageOutlook,
  computeRiskScore,
  departmentScopeFor,
  explainNeedsAttention,
  latestChange,
  mirrorFreshness,
  NO_CHANGE_SCENARIO,
  projectOutlook,
  projectionCurve,
  resolveComplianceRows,
  scenarioCurve,
  scenarioFromMoves,
  scenarioGrowth,
  simulateMoves,
  summarizeBusiness,
  summarizeCompliance,
  summarizeDelivery,
  type PeerProfile,
  type RiskScoreInputs,
} from "./rules";

const NOW = new Date("2026-10-17T08:00:00Z");
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

// One fixture per reachable lifecycle key. "assigned" is the resolver's final
// fallback and no combination of normalised statuses reaches it today.
const LIFECYCLE_FIXTURES: Array<[AssignmentLifecycleKey, Record<string, any>]> = [
  ["cancelled", { assignmentStatus: "cancelled" }],
  ["needs-reassignment", { assigneeAcceptanceStatus: "declined" }],
  ["participant-declined", { participantAcceptanceStatus: "declined" }],
  ["participant-rejected", { participantAcceptanceStatus: "accepted", participantCompletionStatus: "rejected" }],
  ["completed", { assignmentStatus: "completed" }],
  ["awaiting-participant-acceptance", {}],
  ["in-delivery", { participantAcceptanceStatus: "accepted" }],
  ["awaiting-participant-confirmation", { participantAcceptanceStatus: "accepted", assigneeCompletionStatus: "completed" }],
];

for (const [key, fixture] of LIFECYCLE_FIXTURES) {
  test(`lifecycle: ${key}`, () => {
    assert.equal(resolveAssignmentLifecycle(fixture).key, key);
  });
}

test("lifecycle: SME confirmation completes even when assignmentStatus lags", () => {
  assert.equal(resolveAssignmentLifecycle({ assignmentStatus: "in-progress", participantCompletionStatus: "confirmed" }).key, "completed");
});

test("coverage: facilitator completion alone is waiting on the SME, not completed", () => {
  const state = classifyAssignment({
    assignmentStatus: "in-progress",
    participantAcceptanceStatus: "accepted",
    assigneeCompletionStatus: "completed",
  });
  assert.equal(state.isCompleted, false);
  assert.equal(state.awaitingSmeConfirmation, true);
});

test("coverage: only the SME declining or a cancellation counts as declined", () => {
  const declined = (fixture: Record<string, any>) => classifyAssignment(fixture).isDeclined;
  assert.equal(declined({ assignmentStatus: "cancelled", participantAcceptanceStatus: "declined" }), true);
  assert.equal(declined({ assignmentStatus: "cancelled" }), true);
  // The facilitator declined: waiting on staff to reassign, not the SME's decline.
  assert.equal(declined({ assigneeAcceptanceStatus: "declined", participantAcceptanceStatus: "accepted" }), false);
  // The SME rejected a completion: it answered, so it is neither declined nor unresponsive.
  const rejected = classifyAssignment({ participantAcceptanceStatus: "accepted", assigneeCompletionStatus: "completed", participantCompletionStatus: "rejected" });
  assert.equal(rejected.isDeclined, false);
  assert.equal(rejected.awaitingSmeConfirmation, false);
});

test("delivery: overdue means open and past due, never completed", () => {
  const summary = summarizeDelivery(
    [
      { participantAcceptanceStatus: "accepted", dueDate: daysFromNow(-3) },
      { assignmentStatus: "completed", dueDate: daysFromNow(-3) },
      { participantAcceptanceStatus: "accepted", dueDate: daysFromNow(5) },
    ],
    NOW
  );
  assert.equal(summary.overdue, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.open, 2);
});

test("compliance: sub-collection upload overrides the embedded copy", () => {
  const rows = resolveComplianceRows({
    requirements: [
      { key: "tax clearance", title: "Tax Clearance", hasExpiry: false, expiryMonths: null },
      { key: "bee certificate", title: "BEE Certificate", hasExpiry: false, expiryMonths: null },
    ],
    embedded: [{ type: "Tax Clearance", status: "rejected" }],
    uploads: [{ type: "tax clearance", status: "valid" }],
    now: NOW,
  });
  assert.equal(rows[0].status, "valid");
  assert.equal(rows[0].source, "subcollection");
  assert.equal(rows[1].status, "missing");
});

test("compliance: expiry turns valid into expiring-soon, then expired", () => {
  const rows = resolveComplianceRows({
    requirements: [],
    embedded: [],
    uploads: [
      { type: "Soon", status: "valid", expiryDate: daysFromNow(10) },
      { type: "Gone", status: "valid", expiryDate: daysFromNow(-1) },
    ],
    now: NOW,
  });
  assert.deepEqual(rows.map((row) => row.status), ["expiring-soon", "expired"]);
  const summary = summarizeCompliance(rows);
  assert.equal(summary.covered, 1);
  assert.equal(summary.expired, 1);
});

const BASE_INPUTS: RiskScoreInputs = {
  daysSinceLastService: 47,
  hasNeverReceivedService: false,
  docsMissing: 2,
  docsQueried: 0,
  docsRejected: 0,
  missingDepartmentsCount: 0,
  smePendingAcceptanceCount: 1,
  smePendingConfirmationCount: 0,
  declinedTouches: 0,
};

test("needs attention: unchanged register weights", () => {
  const result = computeRiskScore(BASE_INPUTS);
  assert.equal(result.score, 61);
  assert.equal(result.level, "High");
  assert.deepEqual(result.breakdown.map((item) => item.delta), [45, 8, 8]);
});

test("outlook: inactivity crossing 90 days moves the level on a known day", () => {
  const inputs = { ...BASE_INPUTS, daysSinceLastService: 80, docsMissing: 0, smePendingAcceptanceCount: 0 };
  const outlook = projectOutlook({ inputs, complianceRows: [], assignments: [], now: NOW });
  assert.equal(computeRiskScore(inputs).level, "Medium");
  assert.equal(outlook.nextChange?.inDays, 10);
  assert.equal(outlook.nextChange?.toLevel, "High");
  assert.equal(outlook.horizons[0].days, 20);
  assert.equal(outlook.horizons[0].level, "High");
});

test("outlook: documents expiring inside the horizon count as missing there", () => {
  const complianceRows = resolveComplianceRows({
    requirements: [],
    embedded: [],
    uploads: [{ type: "Tax", status: "valid", expiryDate: daysFromNow(15) }],
    now: NOW,
  });
  const inputs = { ...BASE_INPUTS, daysSinceLastService: 5, docsMissing: 0, smePendingAcceptanceCount: 0 };
  const outlook = projectOutlook({ inputs, complianceRows, assignments: [], now: NOW });
  assert.equal(outlook.horizons[0].expiringDocuments.length, 1);
  assert.equal(outlook.horizons[0].score, computeRiskScore({ ...inputs, daysSinceLastService: 25, docsMissing: 1 }).score);
});

test("growth: cancelled and reassigned work no longer counts against the SME", () => {
  const compliance = summarizeCompliance([]);
  const score = computeGrowthScore({
    assignments: [{ assignmentStatus: "completed" }, { assignmentStatus: "cancelled" }, { assigneeAcceptanceStatus: "declined" }],
    compliance,
  });
  const interventions = score.components.find((item) => item.key === "interventions")!;
  assert.equal(interventions.score, 30);
  assert.equal(interventions.detail, "1 of 1 interventions completed");
});

test("business: headcount months keyed by name or by year and month", () => {
  const business = (monthly: Record<string, unknown>) =>
    summarizeBusiness({ participant: { headcountHistory: { monthly } }, monthlyMetrics: [], jobContracts: [], now: NOW });
  assert.deepEqual(business({ September: { permanent: 4, temporary: 1 } }).headcount, { total: 5, period: "Sep 2026", source: "SME profile" });
  assert.deepEqual(business({ "2026-09": { permanent: 6, temporary: 2 } }).headcount, { total: 8, period: "Sep 2026", source: "SME profile" });
  // A dated key wins over a bare month name, which could be from any year.
  assert.equal(business({ October: { permanent: 1 }, "2026-10": { permanent: 3 } }).headcount?.total, 3);
});

const peer = (twinId: string, needsAttention: number, gender = "Female"): PeerProfile => ({
  twinId,
  group: "B",
  programme: "P1",
  sector: null,
  gender,
  needsAttention,
  growth: 50,
  compliancePercent: 70,
  deliveryPercent: 50,
  revenue: null,
  headcount: null,
});

test("peers: hidden below three peers, lower needs attention is better", () => {
  const self = peer("me", 20);
  const all = [self, peer("a", 30), peer("b", 40), peer("c", 10), peer("d", 90, "Male")];
  const comparisons = comparePeers(self, all);
  const byGender = comparisons.find((item) => item.dimension === "gender")!;
  assert.equal(byGender.peerCount, 3);
  assert.equal(byGender.metrics.find((item) => item.key === "needsAttention")!.betterThanPercent, 67);
  assert.equal(comparisons.find((item) => item.dimension === "sector"), undefined);
});

test("record: scoped to the application's programme and JSON-safe", () => {
  const record = buildTwinRecord(
    {
      application: { id: "app1", participantId: "p1", programId: "prog1", beneficiaryName: "Test SME", applicationStatus: "accepted" },
      participant: { id: "p1", participantName: "Owner" },
      program: { programRequirements: [{ title: "Tax Clearance" }] },
      diagnosticPlans: [],
      assignments: [
        { programId: "prog1", assignmentStatus: "completed" },
        { programId: "prog2", assignmentStatus: "completed" },
      ],
      departments: [],
      movs: [],
      complianceUploads: [],
    },
    { now: NOW, source: "daily" }
  );
  assert.equal(record.twinId, "p1_prog1");
  assert.equal(record.day, "2026-10-17");
  assert.equal(record.delivery.total, 1);
  assert.equal(record.compliance.missing, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(record)).needsAttention, record.needsAttention);
});

const scenarioRecord = () =>
  buildTwinRecord(
    {
      application: { id: "app1", participantId: "p1", programId: "prog1" },
      participant: { id: "p1" },
      program: { programRequirements: [{ title: "Tax Clearance" }, { title: "BEE Certificate" }] },
      diagnosticPlans: [],
      assignments: [
        { programId: "prog1", assignmentStatus: "completed", completedAt: daysFromNow(-80) },
        { programId: "prog1", participantAcceptanceStatus: "pending" },
      ],
      departments: [],
      movs: [],
      complianceUploads: [],
    },
    { now: NOW, source: "live" }
  );

test("scope: main and monitoring departments see the whole SME, others their own", () => {
  const departments = [
    { id: "rom", name: "ROM (Recruitment, Onboarding and Maintenance)", isMain: true, isMonitoring: true },
    { id: "me", name: "M&E (Monitoring and Evaluation)", isMain: true },
    { id: "hse", name: "HSE and Labour Compliance", isMain: false },
  ];
  assert.equal(departmentScopeFor({ departmentId: "rom" }, departments), null);
  assert.equal(departmentScopeFor({ departmentId: "me" }, departments), null);
  assert.equal(departmentScopeFor({}, departments), null);
  assert.deepEqual(departmentScopeFor({ departmentId: "hse" }, departments), { departmentId: "hse", departmentName: "HSE & Labour Compliance" });
});

test("record: a department's view counts only its services, and every record keeps each department's score", () => {
  const sources = {
    application: { id: "app1", participantId: "p1", programId: "prog1", applicationStatus: "accepted" },
    participant: { id: "p1" },
    diagnosticPlans: [{ participantId: "p1", programId: "prog1", interventions: [
      { id: "iv-hse", departmentId: "hse", title: "HSE file" },
      { id: "iv-fin", departmentId: "fin", title: "Financial statements" },
    ] }],
    assignments: [
      { programId: "prog1", departmentId: "hse", interventionId: "iv-hse", assignmentStatus: "completed", completedAt: daysFromNow(-5) },
      { programId: "prog1", departmentId: "fin", interventionId: "iv-fin", assignmentStatus: "assigned", assigneeAcceptanceStatus: "accepted", participantAcceptanceStatus: "pending" },
    ],
    departments: [
      { id: "hse", name: "HSE and Labour Compliance", interventionsDepartment: true },
      { id: "fin", name: "Financial Compliance", interventionsDepartment: true },
    ],
    movs: [],
    complianceUploads: [],
  };
  const whole = buildTwinRecord(sources, { now: NOW, source: "live" });
  const finance = buildTwinRecord(sources, { now: NOW, source: "live", scope: { departmentId: "fin", departmentName: "Financial Compliance" } });
  assert.equal(whole.scope, null);
  assert.equal(whole.delivery.total, 2);
  assert.deepEqual(whole.byDepartment.map((dep) => dep.departmentId).sort(), ["fin", "hse"]);
  assert.deepEqual(finance.scope, { departmentId: "fin", departmentName: "Financial Compliance" });
  assert.equal(finance.delivery.total, 1);
  assert.equal(finance.needsAttention.inputs.smePendingAcceptanceCount, 1);
  // The department's score in a whole-SME record is the score its own view shows.
  assert.equal(whole.byDepartment.find((dep) => dep.departmentId === "fin")!.score, finance.needsAttention.score);
  // Growth stays the whole SME's in every view.
  assert.equal(finance.growth.total, whole.growth.total);
});

test("what-if: no change matches the saved outlook horizons", () => {
  const record = scenarioRecord();
  const curve = projectionCurve(record, 40);
  for (const horizon of record.outlook.horizons) {
    assert.equal(curve[horizon.days].score, horizon.score);
  }
  assert.deepEqual(scenarioCurve(record, NO_CHANGE_SCENARIO, 40), curve);
});

test("what-if: a service on day 10 resets inactivity from that day", () => {
  const record = { ...scenarioRecord() };
  record.needsAttention = { ...record.needsAttention, inputs: { ...BASE_INPUTS, daysSinceLastService: 80, docsMissing: 0, smePendingAcceptanceCount: 0 } };
  const curve = scenarioCurve(record, { ...NO_CHANGE_SCENARIO, serviceInDays: 10 }, 40);
  assert.equal(curve[9].level, "Medium");
  assert.equal(curve[10].score, computeRiskScore({ ...record.needsAttention.inputs, daysSinceLastService: 0 }).score);
  assert.equal(curve[40].level, "Medium");
});

test("what-if: uploads and responses lower the score and lift growth", () => {
  const record = scenarioRecord();
  record.needsAttention = { ...record.needsAttention, inputs: { ...BASE_INPUTS } };
  const scenario = { ...NO_CHANGE_SCENARIO, documentsUploaded: 2, smeResponses: 1 };
  const before = scenarioCurve(record, NO_CHANGE_SCENARIO, 0)[0].score;
  const after = scenarioCurve(record, scenario, 0)[0].score;
  assert.equal(before - after, 8 + 8);
  const growth = scenarioGrowth(record, scenario);
  assert.equal(growth.counts.documentsCovered, 2);
  assert.ok(growth.total > record.growth.total);
});

test("moves: each move runs alone, ranked by its drop in average needs attention", () => {
  const record = scenarioRecord();
  // 47 days without a service, 2 missing documents, 1 intervention awaiting acceptance.
  record.needsAttention = { ...record.needsAttention, inputs: { ...BASE_INPUTS } };
  const moves = simulateMoves(record, 40);
  const keys = moves.map((move) => move.key);
  assert.ok(keys.includes("service"), "a service lowers the days ahead even though they drift back by day 40");
  assert.ok(keys.includes("documentsUploaded") && keys.includes("smeResponses"));
  assert.ok(!keys.includes("declinesResolved"), "nothing to resolve, so no move");
  moves.forEach((move) => assert.ok(move.scoreDelta < 0 || move.growthDelta > 0));
  for (let index = 1; index < moves.length; index += 1) {
    const [before, after] = [moves[index - 1], moves[index]];
    assert.ok(before.scoreDelta < after.scoreDelta || (before.scoreDelta === after.scoreDelta && before.growthDelta >= after.growthDelta));
  }
  const baseline = averageOutlook(record, NO_CHANGE_SCENARIO, 40);
  const days = scenarioCurve(record, NO_CHANGE_SCENARIO, 40).slice(1);
  assert.equal(baseline.score, Math.round(days.reduce((sum, day) => sum + day.score, 0) / days.length));
  const upload = moves.find((move) => move.key === "documentsUploaded")!;
  assert.equal(upload.score, averageOutlook(record, scenarioFromMoves([upload]), 40).score);
});

test("moves: chosen together they make one what-if", () => {
  const scenario = scenarioFromMoves([{ change: { documentsUploaded: 2 } }, { change: { serviceInDays: 7 } }]);
  assert.deepEqual(scenario, { ...NO_CHANGE_SCENARIO, documentsUploaded: 2, serviceInDays: 7 });
  assert.deepEqual(scenarioFromMoves([]), NO_CHANGE_SCENARIO);
});

test("mirror: newest past change per source, and how fresh it is", () => {
  const docs = [
    { createdAt: daysFromNow(-90), updatedAt: daysFromNow(-20) },
    { createdAt: daysFromNow(-5) },
    { createdAt: daysFromNow(10) },
  ];
  assert.equal(latestChange(docs, NOW)?.toISOString(), daysFromNow(-5).toISOString());
  assert.equal(latestChange([], NOW), null);
  assert.equal(mirrorFreshness(daysFromNow(-3).toISOString(), NOW), "fresh");
  assert.equal(mirrorFreshness(daysFromNow(-30).toISOString(), NOW), "ageing");
  assert.equal(mirrorFreshness(daysFromNow(-90).toISOString(), NOW), "stale");
  assert.equal(mirrorFreshness(null, NOW), "unknown");
  const record = scenarioRecord();
  const interventions = record.mirror.find((feed) => feed.key === "interventions")!;
  assert.equal(interventions.records, 2);
  assert.equal(interventions.lastChange, daysFromNow(-80).toISOString());
  assert.deepEqual(record.mirror.map((feed) => feed.key), ["interventions", "documents", "plan", "evidence", "contact", "business"]);
});

test("why: every reason says who it is waiting on", () => {
  const record = scenarioRecord();
  record.plan = {
    ...record.plan,
    areas: [
      { departmentName: "Finance", deptConfirmed: false, smmeConfirmed: false, services: 0 },
      { departmentName: "Legal", deptConfirmed: true, smmeConfirmed: false, services: 1 },
      { departmentName: "HSE", deptConfirmed: true, smmeConfirmed: true, services: 2 },
    ],
  };
  record.compliance = { ...record.compliance, outstanding: [{ title: "Tax Clearance", status: "missing", expiry: null }, { title: "BEE Certificate", status: "expired", expiry: null }] };
  const inputs = { ...BASE_INPUTS, docsMissing: 2, missingDepartmentsCount: 2, smePendingAcceptanceCount: 1, declinedTouches: 2 };
  const byKey = Object.fromEntries(explainNeedsAttention(record, inputs).map((reason) => [reason.key, reason]));
  // A service gap with an unaccepted intervention is on both sides.
  assert.equal(byKey["inactive-1-month"].owner, "both");
  assert.match(byKey["inactive-1-month"].detail, /47 days ago.*1 new intervention still waits for the SME to accept/);
  assert.equal(byKey["documents-missing"].owner, "sme");
  assert.equal(byKey["documents-missing"].detail, "To upload or renew: Tax Clearance, BEE Certificate.");
  assert.equal(byKey["departments-follow-up"].owner, "both");
  assert.equal(byKey["departments-follow-up"].detail, "HOD to review the plan: Finance. SME to confirm the plan: Legal.");
  assert.equal(byKey["awaiting-sme-response"].waitingOn, "SME");
  assert.equal(byKey["repeat-declines"].owner, "both");
  // Without anything waiting on the SME, the service gap is staff's.
  const staffOnly = explainNeedsAttention(record, { ...inputs, smePendingAcceptanceCount: 0 });
  assert.equal(staffOnly.find((reason) => reason.key === "inactive-1-month")!.owner, "staff");
  // A later day with more documents missing than today is described by its count.
  const later = explainNeedsAttention(record, { ...inputs, docsMissing: 3 });
  assert.equal(later.find((reason) => reason.key === "documents-missing")!.detail, "3 documents missing or expired by then.");
  // The deltas are the score's own.
  assert.deepEqual(explainNeedsAttention(record, inputs).map((reason) => reason.delta), computeRiskScore(inputs).breakdown.map((reason) => reason.delta));
});

test("why: a department only waiting on its HOD names that HOD", () => {
  const record = scenarioRecord();
  record.plan = { ...record.plan, areas: [{ departmentName: "QMS", deptConfirmed: true, smmeConfirmed: true, services: 0 }] };
  const reason = explainNeedsAttention(record, { ...BASE_INPUTS, missingDepartmentsCount: 1 }).find((item) => item.key === "departments-follow-up")!;
  assert.equal(reason.owner, "staff");
  assert.equal(reason.waitingOn, "HOD · QMS");
  assert.equal(reason.detail, "No service assigned yet: QMS.");
});
