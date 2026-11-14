// Additive supplement: demo finance accounts for the Finance page and the
// Financial Compliance dashboard snapshot.
//
// SME finance normally comes from the external Qx system, which knows nothing
// about the digital-twin SMEs. This writes one `syntheticFinanceAccounts` doc
// per [DEMO Twin] Incubation Foundations SME, Oct 2025 - Oct 2026:
//   - revenue keeps each SME's overall trend from the main seed
//     (participantMonthlyMetrics) but adds seasonality and month-to-month
//     variation, so the monthly figures are close to, not equal to, the twin's;
//   - expenses are fixed overheads plus costs that move with revenue, with the
//     odd one-off cost, so profit follows revenue and dips in weak months;
//   - 0-3 demo document records per SME (metadata only, no files).
// Deterministic: the same inputs always give the same figures.
// Never changes the original seed. Create-only, with a manifest in
// syntheticSeedRuns, against the test project only. v2 replaces the v1 run
// (straight-line revenue and a repeating cost ratio); --remove-previous
// deletes the v1 accounts after v2 is written and verified.
//
//   node scripts/digital-twin/seed-finance.cjs --local-only
//   node scripts/digital-twin/seed-finance.cjs                 (dry run against lepharo-smart-inc)
//   node scripts/digital-twin/seed-finance.cjs --apply --confirm=dtseed_20261009_finance_v2 [--remove-previous]
//   node scripts/digital-twin/seed-finance.cjs --verify
require('../node26-shim.cjs');
const admin = require('firebase-admin');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {RUN, REF, generate, hash, encode} = require('./dataset.cjs');

const EXT = 'dtseed_20261009_finance_v2';
const PREVIOUS_EXT = 'dtseed_20261009_finance_v1';
const COLLECTION = 'syntheticFinanceAccounts';
const PROGRAM_ID = `${RUN}_program_0`; // [DEMO Twin] Incubation Foundations
const out = path.resolve(__dirname, '../../artifacts/digital-twin');
const save = (name, value) => {
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, name), JSON.stringify(encode(value), null, 2) + '\n');
};
const metadata = {dataOrigin: 'synthetic', suppressNotifications: true, seedRunId: EXT, parentSeedRunId: RUN, generatorVersion: '2.0.0'};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const EXTRA_MONTH = '2026-10';

// Retail-style year: festive peak, January slump, a softer winter.
const SEASON = {1: 0.84, 2: 0.9, 3: 1.0, 4: 0.97, 5: 0.99, 6: 0.94, 7: 0.96, 8: 1.02, 9: 1.0, 10: 1.01, 11: 1.06, 12: 1.17};
// How strongly each sector follows that year (agriculture swings most).
const SEASON_STRENGTH = {Manufacturing: 0.6, Services: 0.8, Agriculture: 1.4};

/** Small seeded PRNG, so every run gives identical figures. */
const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const roundTo = (value, step) => Math.round(value / step) * step;

const DOCUMENTS = [
  {name: 'Management accounts - Q2 2026.pdf', type: 'application/pdf', month: '2026-07'},
  {name: 'Bank statement - September 2026.pdf', type: 'application/pdf', month: '2026-10'},
  {name: 'Sales register 2026.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', month: '2026-09'},
];

/** One finance account per Incubation Foundations SME, from the generated records. */
function build(records) {
  const participants = records
    .filter((r) => r.path.startsWith('participants/') && r.data.programId === PROGRAM_ID)
    .map((r) => r.data)
    .sort((a, b) => a.participantId.localeCompare(b.participantId));
  assert.ok(participants.length > 0, 'No Incubation Foundations participants in the dataset');

  const metrics = records.filter((r) => r.path.startsWith('participantMonthlyMetrics/')).map((r) => r.data);
  const created = admin.firestore.Timestamp.fromDate(new Date(REF));

  const result = participants.map((p, k) => {
    const n = Number(p.participantId.slice(-3));
    const history = metrics
      .filter((m) => m.participantId === p.participantId)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({month: m.month, revenue: Number(m.revenue || 0)}));
    assert.equal(history.length, 12, `Expected 12 months for ${p.participantId}`);

    // Overall trend from the main seed: its first month and average monthly change.
    const first = history[0].revenue;
    const slope = (history[history.length - 1].revenue - first) / (history.length - 1);
    const rand = mulberry32(n * 7919);
    const strength = SEASON_STRENGTH[p.sector] ?? 1;

    // Cost structure: a quarter of the SMEs run lean, a quarter are thin-margin
    // and a quarter carry more overhead than they earn in a normal month.
    const fixedShare = [0.32, 0.42, 0.56, 0.38][k % 4];
    const variableRate = [0.46, 0.5, 0.5, 0.48][k % 4];
    const overheads = first * fixedShare;

    const keys = [...history.map((h) => h.month), EXTRA_MONTH];
    const months = keys.map((month, m) => {
      const calendarMonth = Number(month.slice(5, 7));
      const seasonal = 1 + (SEASON[calendarMonth] - 1) * strength;
      const noise = 1 + (rand() - 0.5) * 0.14; // about +/-7%
      // Every fourth SME has a soft October after a strong run.
      const octoberDip = month === EXTRA_MONTH && k % 4 === 3 ? 0.86 : 1;
      const revenue = Math.max(0, roundTo((first + slope * m) * seasonal * noise * octoberDip, 10));

      const overheadDrift = 1 + (rand() - 0.5) * 0.06;
      // Roughly one month in ten carries a one-off cost (repairs, licences, stock write-off).
      const oneOff = rand() < 0.1 ? first * (0.08 + rand() * 0.14) : 0;
      const expenses = roundTo(overheads * overheadDrift + revenue * variableRate + oneOff, 10);

      return {month, monthLabel: monthLabel(month), revenue, expenses, profit: revenue - expenses};
    });

    const documents = DOCUMENTS.slice(0, k % 4).map((doc, d) => ({
      id: `${EXT}_doc_${String(n).padStart(3, '0')}_${d + 1}`,
      original_name: doc.name,
      type: doc.type,
      created_at: `${doc.month}-05T09:00:00Z`,
      demo: true,
    }));

    const id = `${EXT}_${String(n).padStart(3, '0')}`;
    return {
      path: `${COLLECTION}/${id}`,
      data: {
        ...metadata,
        id,
        participantId: p.participantId,
        programId: p.programId,
        programName: p.programName,
        branchId: p.branchId,
        name: p.businessName,
        email: p.email,
        currency: 'ZAR',
        scenarioKey: 'finance_history',
        months,
        totalRevenue: months.reduce((sum, m) => sum + m.revenue, 0),
        totalExpenses: months.reduce((sum, m) => sum + m.expenses, 0),
        documents,
        createdAt: created,
      },
    };
  });

  assert.equal(new Set(result.map((r) => r.path)).size, result.length);
  return {
    records: result,
    summary: {
      seedRunId: EXT,
      parentSeedRunId: RUN,
      programId: PROGRAM_ID,
      accounts: result.length,
      months: result[0].data.months.length,
      firstMonth: result[0].data.months[0].month,
      lastMonth: EXTRA_MONTH,
      documents: result.reduce((sum, r) => sum + r.data.documents.length, 0),
      datasetHash: hash(result),
    },
  };
}

async function readAll(db, refs) {
  const docs = [];
  for (let i = 0; i < refs.length; i += 150) docs.push(...(await db.getAll(...refs.slice(i, i + 150))));
  return docs;
}

async function main() {
  const planned = build(generate().records);
  if (process.argv.includes('--local-only')) {
    save('finance-local.json', planned.summary);
    console.log(JSON.stringify(planned.summary));
    return;
  }

  const key = require('../serviceAccountKey.json');
  assert.equal(key.project_id, 'lepharo-smart-inc', 'This seed only runs against the test project');
  const app = admin.initializeApp({credential: admin.credential.cert(key)});
  const db = app.firestore();

  try {
    // The SMEs these accounts belong to must already be seeded.
    const sources = await readAll(db, planned.records.map((r) => db.doc(`participants/${r.data.participantId}`)));
    sources.forEach((s) => assert.ok(s.exists, `Seeded participant missing: ${s.ref.path}`));

    const manifestRef = db.doc(`syntheticSeedRuns/${EXT}`);
    const [manifest, existingDocs] = await Promise.all([
      manifestRef.get(),
      readAll(db, planned.records.map((r) => db.doc(r.path))),
    ]);
    if (manifest.exists) assert.equal(manifest.data().datasetHash, planned.summary.datasetHash, 'Manifest hash differs');

    const absent = [];
    existingDocs.forEach((d, i) => {
      if (d.exists) assert.equal(hash(d.data()), hash(planned.records[i].data), `Existing document differs: ${d.ref.path}`);
      else absent.push(planned.records[i]);
    });
    save('finance-dry-run.json', {...planned.summary, toCreate: absent.length});

    if (process.argv.includes('--apply')) {
      assert.ok(process.argv.includes(`--confirm=${EXT}`), 'Explicit dataset confirmation required');
      if (!manifest.exists) {
        await manifestRef.create({...metadata, status: 'applying', startedAt: admin.firestore.Timestamp.now(), datasetHash: planned.summary.datasetHash, summary: planned.summary});
      }
      for (let i = 0; i < absent.length; i += 100) {
        const batch = db.batch();
        for (const r of absent.slice(i, i + 100)) batch.create(db.doc(r.path), r.data);
        await batch.commit();
      }
      await manifestRef.update({status: 'complete', completedAt: admin.firestore.Timestamp.now()});
    }

    if (process.argv.includes('--verify') || process.argv.includes('--apply')) {
      const verified = await readAll(db, planned.records.map((r) => db.doc(r.path)));
      verified.forEach((d, i) => assert.equal(hash(d.data()), hash(planned.records[i].data), `Readback drift: ${d.ref.path}`));
      save('finance-verification.json', {...planned.summary, verifiedAt: new Date().toISOString(), verifiedDocuments: verified.length});
    }

    // Only after this run is written and verified: delete the superseded run's
    // accounts. Touches nothing but syntheticFinanceAccounts docs tagged with
    // that run id.
    let removedPrevious = 0;
    if (process.argv.includes('--apply') && process.argv.includes('--remove-previous')) {
      const previous = await db.collection(COLLECTION).where('seedRunId', '==', PREVIOUS_EXT).get();
      for (const d of previous.docs) {
        assert.equal(d.data().dataOrigin, 'synthetic', `Refusing to delete non-synthetic doc: ${d.ref.path}`);
      }
      for (let i = 0; i < previous.docs.length; i += 100) {
        const batch = db.batch();
        for (const d of previous.docs.slice(i, i + 100)) batch.delete(d.ref);
        await batch.commit();
      }
      removedPrevious = previous.size;
      const previousManifest = db.doc(`syntheticSeedRuns/${PREVIOUS_EXT}`);
      if ((await previousManifest.get()).exists) {
        await previousManifest.update({status: 'superseded', supersededBy: EXT, supersededAt: admin.firestore.Timestamp.now(), removedDocuments: removedPrevious});
      }
    }

    console.log(JSON.stringify({...planned.summary, toCreate: absent.length, applied: process.argv.includes('--apply'), verified: process.argv.includes('--verify') || process.argv.includes('--apply'), removedPrevious}));
  } finally {
    await app.delete();
  }
}

module.exports = {build, EXT, COLLECTION};
if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
