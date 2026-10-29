// Demographics extension for the digital-twin dataset.
//
// The original seed (dtseed_20261009_v1) created SMEs without the fields the
// reports read for demographics: gender, age, B-BBEE level, ward/hub and the
// three ownership shares. This fills those fields on the synthetic SMEs of one
// demo programme, deterministically per SME.
//
// - Only records with dataOrigin "synthetic" and the original seedRunId are touched.
// - Only empty fields are filled; nothing already set is overwritten.
// - Age is a dateOfBirth, not a generated ID number (a made-up 13-digit ID could
//   belong to a real person).
// - Each write is tagged with demographicsSeedRunId; the receipt lists every field set.
//
// Usage (repository root):
//   node scripts/digital-twin/seed-demographics.cjs                       # dry run, Incubation Foundations
//   node scripts/digital-twin/seed-demographics.cjs --program="Enterprise Growth"
//   node scripts/digital-twin/seed-demographics.cjs --apply --confirm=dtseed_20261009_demographics_v1
//   node scripts/digital-twin/seed-demographics.cjs --verify
require("../node26-shim.cjs");
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const key = require("../serviceAccountKey.json");
if (key.project_id !== "lepharo-smart-inc") throw new Error("Unexpected project");

const RUN_ID = "dtseed_20261009_demographics_v1";
const SOURCE_SEED = "dtseed_20261009_v1";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  })
);
const PROGRAM = args.program || "Incubation Foundations";
const APPLY = args.apply === true;
const VERIFY = args.verify === true;
if (APPLY && args.confirm !== RUN_ID) throw new Error(`--apply needs --confirm=${RUN_ID}`);

// Rustenburg-area hubs (the demo programmes run from the Rustenburg centre).
const HUBS = ["Rustenburg", "Thekwane", "Phokeng", "Boitekong", "Tlhabane", "Kanana", "Marikana", "Bethanie"];
// A handful of Rustenburg wards, so the ward chart has a readable number of slices.
const WARDS = ["Ward 3", "Ward 7", "Ward 12", "Ward 18", "Ward 22", "Ward 27", "Ward 31", "Ward 38"];
const BEE_LEVELS = ["1", "2", "3", "4", "5+", "1", "2", "Non-compliant"];
// Reference date for ages, matching the dataset's clock (9 Oct 2026).
const REFERENCE = new Date(Date.UTC(2026, 9, 9));

/** Deterministic demographics for the SME at this index within its programme. */
const demographicsFor = (i) => {
  const gender = i % 9 === 0 || i % 9 === 4 || i % 9 === 7 || i % 9 === 2 ? "Male" : "Female";
  // Ages 19–63, with roughly half under 35 (youth).
  const age = 19 + ((i * 7) % 45);
  const birth = new Date(Date.UTC(REFERENCE.getUTCFullYear() - age, (i * 5) % 12, 1 + ((i * 11) % 27)));
  const youth = age < 35;
  return {
    gender,
    dateOfBirth: admin.firestore.Timestamp.fromDate(birth),
    age,
    ageGroup: youth ? "Youth" : "Adult",
    beeLevel: BEE_LEVELS[i % BEE_LEVELS.length],
    ward: WARDS[(i * 3) % WARDS.length],
    hub: HUBS[i % HUBS.length],
    // Owner-consistent shares: female/youth ownership is a majority only when the owner is.
    blackOwnedPercent: [100, 100, 51, 75, 100, 60, 100, 0][i % 8],
    femaleOwnedPercent: gender === "Female" ? [100, 51, 75, 100][i % 4] : [0, 0, 25, 49][i % 4],
    youthOwnedPercent: youth ? [100, 51, 100, 70][i % 4] : [0, 0, 30, 0][i % 4],
  };
};

const PARTICIPANT_FIELDS = ["gender", "dateOfBirth", "age", "beeLevel", "ward", "hub", "blackOwnedPercent", "femaleOwnedPercent", "youthOwnedPercent"];
const APPLICATION_FIELDS = ["gender", "ageGroup", "hub", "ward"];

const empty = (v) => v === undefined || v === null || String(v).trim() === "";

admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();
const timer = setTimeout(() => process.exit(1), 120000);

(async () => {
  const program = (await db.collection("programs").where("name", "==", PROGRAM).get()).docs.find(
    (d) => d.data().dataOrigin === "synthetic" || String(d.id).startsWith("dtseed_")
  );
  if (!program) throw new Error(`No synthetic programme named "${PROGRAM}"`);

  const participants = (await db.collection("participants").where("programId", "==", program.id).get()).docs
    .filter((d) => d.data().dataOrigin === "synthetic" && d.data().seedRunId === SOURCE_SEED)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (VERIFY) {
    const missing = participants.filter((d) => PARTICIPANT_FIELDS.some((f) => empty(d.data()[f]))).map((d) => d.id);
    console.log(JSON.stringify({ program: PROGRAM, participants: participants.length, stillMissing: missing.length, ids: missing }));
    return;
  }

  const changes = [];
  for (const [index, doc] of participants.entries()) {
    const p = doc.data();
    const values = demographicsFor(index);
    const participantPatch = {};
    PARTICIPANT_FIELDS.forEach((f) => { if (empty(p[f])) participantPatch[f] = values[f]; });

    const applicationPatch = {};
    let appRef = null;
    if (p.applicationId) {
      appRef = db.collection("applications").doc(p.applicationId);
      const app = await appRef.get();
      const a = app.exists ? app.data() : null;
      if (a && a.dataOrigin === "synthetic" && a.seedRunId === SOURCE_SEED) {
        APPLICATION_FIELDS.forEach((f) => { if (empty(a[f])) applicationPatch[f] = values[f]; });
      } else {
        appRef = null;
      }
    }
    if (Object.keys(participantPatch).length || Object.keys(applicationPatch).length) {
      changes.push({ participantId: doc.id, applicationId: appRef ? appRef.id : null, participantPatch, applicationPatch, ref: doc.ref, appRef });
    }
  }

  const summary = {
    runId: RUN_ID,
    program: PROGRAM,
    programId: program.id,
    participants: participants.length,
    toUpdate: changes.length,
    participantFields: changes.reduce((n, c) => n + Object.keys(c.participantPatch).length, 0),
    applicationFields: changes.reduce((n, c) => n + Object.keys(c.applicationPatch).length, 0),
    mode: APPLY ? "apply" : "dry-run",
  };

  if (APPLY && changes.length) {
    const stamp = { demographicsSeedRunId: RUN_ID, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    for (let i = 0; i < changes.length; i += 200) {
      const batch = db.batch();
      changes.slice(i, i + 200).forEach((c) => {
        if (Object.keys(c.participantPatch).length) batch.update(c.ref, { ...c.participantPatch, ...stamp });
        if (c.appRef && Object.keys(c.applicationPatch).length) batch.update(c.appRef, { ...c.applicationPatch, ...stamp });
      });
      await batch.commit();
    }
  }

  const outDir = path.join(__dirname, "..", "..", "artifacts", "digital-twin");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `demographics-${APPLY ? "receipt" : "dry-run"}-${PROGRAM.toLowerCase().replace(/\s+/g, "-")}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        ...summary,
        changes: changes.map(({ participantId, applicationId, participantPatch, applicationPatch }) => ({
          participantId,
          applicationId,
          participantFields: Object.fromEntries(
            Object.entries(participantPatch).map(([k, v]) => [k, v && v.toDate ? v.toDate().toISOString().slice(0, 10) : v])
          ),
          applicationFields: applicationPatch,
        })),
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ ...summary, file: path.relative(process.cwd(), file) }));
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => { clearTimeout(timer); await admin.app().delete(); });
