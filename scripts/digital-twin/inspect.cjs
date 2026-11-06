require("../node26-shim.cjs");
const admin = require("firebase-admin");
const key = require("../serviceAccountKey.json");
if (key.project_id !== "lepharo-smart-inc")
  throw new Error("Unexpected project");
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();
const timer = setTimeout(() => process.exit(1), 45000);
(async () => {
  for (const name of ["programs", "branches", "departments"]) {
    const snap = await db.collection(name).get();
    console.log(
      JSON.stringify({
        collection: name,
        rows: snap.docs.map((d) => ({
          id: d.id,
          name:
            d.data().name || d.data().programName || d.data().departmentName,
          keys: Object.keys(d.data()),
        })),
      })
    );
  }
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(timer);
    await admin.app().delete();
  });
