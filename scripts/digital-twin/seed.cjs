require("../node26-shim.cjs");
const admin = require("firebase-admin");
const fs = require("node:fs");
const path = require("node:path");
const {
  generate,
  encode,
  hash,
  evidenceAssets,
  BUCKET,
  RUN,
  REF,
  DEPARTMENTS,
  BRANCHES,
} = require("./dataset.cjs");
const { validate } = require("./validate.cjs");
const APPLY = process.argv.includes("--apply"),
  VERIFY = process.argv.includes("--verify");
const out = path.resolve(__dirname, "../../artifacts/digital-twin");
fs.mkdirSync(out, { recursive: true });
const save = (name, value) =>
  fs.writeFileSync(
    path.join(out, name),
    JSON.stringify(encode(value), null, 2) + "\n"
  );
const REQUIRED_FUNCTIONS = [
  "onInquiryCreatedNotifyStaff",
  "notifyInquirySpecialist",
  "onApplicationDecisionEmail",
  "onAppointmentWriteNotifyIncubatee",
  "appointmentCompletionNotifier",
  "onAssignedInterventionEmail",
  "onAssignmentConfirmedScheduleFollowUp",
  "outcomeFollowUpReminderCron",
  "onOutcomeFollowUpAnswered",
  "movStageReminderCron",
  "workflowQueryReminderCron",
  "complianceExpiryReminderCron",
  "requireMoaAfter3Months",
  "devPlanReminderCron",
  "sendDevPlanReminders",
  "remindSmmeDpConfirmation",
  "onNotificationCreatedEmail",
  "onNotificationCreatedPush",
  "remindMovOwner",
  "sendInterventionReminderEmail",
  "syncAssignedInterventionsDenorm",
  "syncProgramToBranchCoordinators",
];
function requireSafeguards() {
  const receipt = JSON.parse(
    fs.readFileSync(path.join(out, "safeguard-receipt.json"), "utf8")
  );
  if (
    receipt.projectId !== "lepharo-smart-inc" ||
    !receipt.deploymentVerifiedAt
  )
    throw new Error("Missing verified safeguard deployment");
  for (const name of REQUIRED_FUNCTIONS)
    if (
      !receipt.functions.some(
        (f) =>
          f.id === name && f.region === "us-central1" && f.state === "ACTIVE"
      )
    )
      throw new Error(`Safeguard not verified: ${name}`);
  const digest = hash(REQUIRED_FUNCTIONS.map((name) => name));
  if (receipt.functionSetHash !== digest)
    throw new Error("Safeguard receipt function set mismatch");
}
async function main() {
  const dataset = generate(),
    summary = validate(dataset);
  save("dataset.json", dataset);
  save("validation-local.json", summary);
  if (!APPLY && !VERIFY && process.argv.includes("--local-only")) {
    console.log(JSON.stringify({ mode: "local-only", ...summary }));
    return;
  }
  if (APPLY && !process.argv.includes(`--confirm=${RUN}`))
    throw new Error("Explicit seed-run confirmation is required");
  if (APPLY) requireSafeguards();
  const key = require("../serviceAccountKey.json");
  if (key.project_id !== dataset.projectId) throw new Error("Project mismatch");
  const app = admin.initializeApp({
    credential: admin.credential.cert(key),
    storageBucket: BUCKET,
  });
  const db = app.firestore();
  db.settings({ ignoreUndefinedProperties: false });
  try {
    const external = await db.getAll(
      ...DEPARTMENTS.map((d) => db.doc(`departments/${d.id}`)),
      ...BRANCHES.map((b) => db.doc(`branches/${b.id}`))
    );
    if (external.some((s) => !s.exists))
      throw new Error("Required existing department or branch is missing");
    const existing = new Map();
    for (let n = 0; n < dataset.records.length; n += 800) {
      const chunks = [];
      for (let k = n; k < Math.min(n + 800, dataset.records.length); k += 200) {
        chunks.push(dataset.records.slice(k, k + 200));
      }
      const snaps = (await Promise.all(chunks.map(chunk => db.getAll(...chunk.map(r => db.doc(r.path)))))).flat();
      for (const snap of snaps)
        if (snap.exists) existing.set(snap.ref.path, snap.data());
      console.log(JSON.stringify({preflightChecked: Math.min(n + 800, dataset.records.length), total: dataset.records.length}));
    }
    const collisions = dataset.records.filter(
      (r) =>
        existing.has(r.path) &&
        (existing.get(r.path).seedRunId !== RUN ||
          existing.get(r.path).dataOrigin !== "synthetic")
    );
    if (collisions.length)
      throw new Error(
        `Refusing to replace ${collisions.length} non-owned records`
      );
    const missing = dataset.records.filter((r) => !existing.has(r.path));
    if (VERIFY) {
      if (missing.length)
        throw new Error(`Verification missing ${missing.length} records`);
      for (const [collection, expectedCount] of Object.entries(dataset.counts)) {
        const count = (await db.collection(collection).where('seedRunId', '==', RUN).count().get()).data().count;
        if (count !== expectedCount) throw new Error(`Unexpected seed count in ${collection}: ${count} instead of ${expectedCount}`);
      }
      const actual = {
        ...dataset,
        records: dataset.records.map((r) => ({
          path: r.path,
          data: existing.get(r.path),
        })),
      };
      const verified = validate(actual);
      const drift = dataset.records
        .filter((r) => hash(r.data) !== hash(existing.get(r.path)))
        .map((r) => r.path);
      const baselineFile = path.join(out, "baseline.json"),
        changes = [];
      if (fs.existsSync(baselineFile)) {
        const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
        for (let n = 0; n < baseline.length; n += 150) {
          const slice = baseline.slice(n, n + 150),
            snaps = await db.getAll(...slice.map((x) => db.doc(x.path)));
          snaps.forEach((s, i) => {
            if (!s.exists || hash(s.data()) !== slice[i].hash)
              changes.push(slice[i].path);
          });
        }
      }
      const result = {
        verifiedAt: new Date().toISOString(),
        projectId: dataset.projectId,
        seedRunId: RUN,
        mode: "verify",
        ...verified,
        seedRecordDrift: drift,
        preExistingRecordChanges: changes,
      };
      save("verification-live.json", result);
      console.log(JSON.stringify(result));
      if (drift.length || changes.length)
        throw new Error(
          "Live records differ; inspect verification-live.json before claiming completion"
        );
      return;
    }
    save("dry-run.json", {
      at: new Date().toISOString(),
      projectId: dataset.projectId,
      seedRunId: RUN,
      toCreate: missing.length,
      alreadyPresent: existing.size,
      ...summary,
    });
    if (!APPLY) {
      console.log(
        JSON.stringify({
          mode: "dry-run",
          toCreate: missing.length,
          alreadyPresent: existing.size,
          ...summary,
        })
      );
      return;
    }
    if (!fs.existsSync(path.join(out, "baseline.json"))) {
      const baseline = [];
      for (const collection of Object.keys(dataset.counts)) {
        const snap = await db.collection(collection).get();
        for (const d of snap.docs)
          if (d.data().seedRunId !== RUN)
            baseline.push({ path: d.ref.path, hash: hash(d.data()) });
      }
      save("baseline.json", baseline);
    }
    // create-only Storage writes; do not overwrite an existing object.
    for (const asset of evidenceAssets()) {
      const file = app.storage().bucket().file(asset.path);
      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        if (metadata.metadata?.seedRunId !== RUN)
          throw new Error("Foreign evidence object collision");
      } else
        await file.save(asset.content, {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          contentType: "text/plain; charset=utf-8",
          metadata: {
            metadata: {
              seedRunId: RUN,
              dataOrigin: "synthetic",
              firebaseStorageDownloadTokens: asset.token,
            },
          },
        });
    }
    const manifest = db.collection("syntheticSeedRuns").doc(RUN);
    const prior = (await manifest.get()).data();
    if (prior && prior.datasetHash !== summary.datasetHash)
      throw new Error("Seed manifest differs from generated dataset");
    await manifest.set(
      {
        seedRunId: RUN,
        dataOrigin: "synthetic",
        suppressNotifications: true,
        referenceDate: REF,
        generatorVersion: dataset.generatorVersion,
        datasetHash: summary.datasetHash,
        counts: dataset.counts,
        status: "applying",
        startedAt: prior?.startedAt || admin.firestore.Timestamp.now(),
      },
      { merge: true }
    );
    // Follow-ups are present before confirmed assignments fire their trigger.
    const order = [
      "programs",
      "coordinators",
      "syntheticActors",
      "users",
      "participants",
      "applications",
      "interventions",
      "diagnosticPlans",
      "outcomeFollowUps",
      "outcomeAssessments",
      "assignedInterventions",
      "appointmentSessions",
      "appointments",
      "groupInterventionDeliveries",
      "movDocuments",
      "consolidatedMOVs",
      "workflowQueries",
      "participantMonthlyMetrics",
      "syntheticHistory",
      "twinCapacityCalendars",
    ];
    for (const collection of order) {
      const rows = missing.filter((r) => r.path.startsWith(collection + "/"));
      for (let n = 0; n < rows.length; n += 150) {
        const chunk = rows.slice(n, n + 150),
          batch = db.batch();
        for (const r of chunk) batch.create(db.doc(r.path), r.data);
        await batch.commit();
      }
      console.log(JSON.stringify({ collection, created: rows.length }));
    }
    await manifest.update({
      status: "seeded",
      completedAt: admin.firestore.Timestamp.now(),
    });
    save("seed-receipt.json", {
      projectId: dataset.projectId,
      seedRunId: RUN,
      completedAt: new Date().toISOString(),
      created: missing.length,
      skippedExisting: existing.size,
      datasetHash: summary.datasetHash,
      counts: dataset.counts,
      evidenceFiles: evidenceAssets().map((a) => a.path),
    });
    console.log(
      JSON.stringify({
        mode: "apply",
        created: missing.length,
        skippedExisting: existing.size,
        seedRunId: RUN,
      })
    );
  } finally {
    await app.delete();
  }
}
if (require.main === module) {
  const timer = setTimeout(() => {
    console.error(
      "Seed operation timed out; rerun the same command to resume create-only writes."
    );
    process.exit(1);
  }, 600000);
  main()
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => clearTimeout(timer));
}
module.exports = { REQUIRED_FUNCTIONS };
