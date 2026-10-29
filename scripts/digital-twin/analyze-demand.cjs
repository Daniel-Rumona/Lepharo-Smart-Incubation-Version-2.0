// READ-ONLY live calibration of the digital twin's demand model.
//   node scripts/digital-twin/analyze-demand.cjs [--weeks=8] [--old]
// Each measure is reported for the whole history, the first N weeks of each programme and the last N weeks, because a pilot
// mixes learning with steady behaviour.
// It only reads a fixed set of fields (field masks exclude names, emails and phone numbers), analyses them in memory,
// and prints/saves AGGREGATES: counts, medians and percentiles. Ids are used to group rows and are never output.
// It performs no writes of any kind and never prints the credential.
require('../node26-shim.cjs');
const admin = require('firebase-admin');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { analyze } = require('./demand-analysis.cjs');

const FIELDS = {
  applications: ['participantId', 'programId', 'applicationStatus', 'createdAt', 'updatedAt', 'acceptedAt', 'dataOrigin'],
  diagnosticPlans: ['participantId', 'programId', 'interventions', 'confirmedByDeptId', 'incubateeDepartmentConfirmationsByDeptId', 'finalConfirmation', 'finalConfirmationAt', 'incubateeConfirmation', 'incubateeConfirmationAt', 'confirmed', 'incubateeDepartmentConfirmations', 'smmeConfirmedByDeptId', 'createdAt', 'updatedAt', 'dataOrigin'],
  assignedInterventions: ['participantId', 'programId', 'interventionId', 'subInterventionId', 'departmentId', 'areaOfSupport', 'cycleKey', 'scheduleMode', 'frequency', 'recurrence', 'plannedSessions', 'assignmentStatus', 'createdAt', 'assignedAt', 'completedAt', 'groupKey', 'dataOrigin'],
  appointments: ['assignedInterventionId', 'appointmentSessionId', 'status', 'dataOrigin'],
  appointmentSessions: ['interventionId', 'sessionType', 'startAt', 'endAt', 'status', 'assigneeId', 'dataOrigin']
};

async function main() {
  // Default: the current project. --old: the project the pilot ran in (a different project with its own credential file).
  const old = process.argv.includes('--old');
  const key = require(old ? '../oldServiceAccountKey.json' : '../serviceAccountKey.json');
  if (old) assert.notEqual(key.project_id, 'lepharo-smart-inc', 'The old-project credential must not be the current project');
  else assert.equal(key.project_id, 'lepharo-smart-inc', 'Unexpected project');
  const projectId = String(key.project_id);
  console.error('Reading project ' + projectId + ' (read-only)');
  const app = admin.initializeApp({ credential: admin.credential.cert(key) }), db = app.firestore();
  try {
    const data = {};
    for (const [name, fields] of Object.entries(FIELDS)) {
      const snapshot = await db.collection(name).select(...fields).get();
      data[name] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      console.error(`read ${name}: ${data[name].length} documents`); // sizes only
    }
    const weeksArg = process.argv.find(x => x.startsWith('--weeks=')), weeks = weeksArg ? Math.max(2, Math.min(26, Number(weeksArg.slice(8)) || 8)) : 8;
    const result = analyze(data, { includeSynthetic: process.argv.includes('--include-synthetic'), weeks });
    const out = path.resolve(__dirname, '../../artifacts/digital-twin');
    fs.mkdirSync(out, { recursive: true });
    const report = { project: projectId, ...result };
    fs.writeFileSync(path.join(out, old ? 'demand-analysis-old-project.json' : 'demand-analysis.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await app.delete(); }
}
module.exports = { FIELDS };
if (require.main === module) main().catch(e => { console.error('Analysis failed:', e.message); process.exitCode = 1; });
