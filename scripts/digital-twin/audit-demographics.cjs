// Read-only: which synthetic SMEs in the demo programmes lack the demographic
// fields the reports read (gender, age, B-BBEE level, ward/hub, ownership).
// Prints counts and IDs only.
require("../node26-shim.cjs");
const admin = require("firebase-admin");
const key = require("../serviceAccountKey.json");
if (key.project_id !== "lepharo-smart-inc") throw new Error("Unexpected project");
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();
const timer = setTimeout(() => process.exit(1), 60000);

const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const hasAge = (p) => has(p.dateOfBirth) || has(p.age) || String(p.idNumber || "").replace(/\D/g, "").length >= 6;

(async () => {
  const programs = (await db.collection("programs").get()).docs.filter((d) =>
    ["Incubation Foundations", "Enterprise Growth"].includes(d.data().name)
  );
  for (const program of programs) {
    const parts = (await db.collection("participants").where("programId", "==", program.id).get()).docs;
    const apps = (await db.collection("applications").where("programId", "==", program.id).get()).docs;
    const missing = { gender: [], age: [], beeLevel: [], ward: [], blackOwned: [], femaleOwned: [], youthOwned: [] };
    let synthetic = 0;
    parts.forEach((d) => {
      const p = d.data();
      if (p.dataOrigin === "synthetic") synthetic += 1;
      if (!has(p.gender)) missing.gender.push(d.id);
      if (!hasAge(p)) missing.age.push(d.id);
      if (!has(p.beeLevel) && !has(p.bbeeeLevel)) missing.beeLevel.push(d.id);
      if (!has(p.ward) && !has(p.hub)) missing.ward.push(d.id);
      if (!has(p.blackOwnedPercent)) missing.blackOwned.push(d.id);
      if (!has(p.femaleOwnedPercent)) missing.femaleOwned.push(d.id);
      if (!has(p.youthOwnedPercent)) missing.youthOwned.push(d.id);
    });
    const appMissing = { gender: 0, ageGroup: 0 };
    apps.forEach((d) => {
      const a = d.data();
      if (!has(a.gender)) appMissing.gender += 1;
      if (!has(a.ageGroup)) appMissing.ageGroup += 1;
    });
    console.log(JSON.stringify({
      program: program.data().name, programId: program.id,
      participants: parts.length, synthetic, applications: apps.length,
      missingCounts: Object.fromEntries(Object.entries(missing).map(([k, v]) => [k, v.length])),
      applicationsMissing: appMissing,
      sampleKeys: parts[0] ? Object.keys(parts[0].data()).sort() : [],
    }));
  }
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => { clearTimeout(timer); await admin.app().delete(); });
