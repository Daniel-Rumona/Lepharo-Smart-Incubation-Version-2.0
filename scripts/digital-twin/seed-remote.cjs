// Additive supplement: virtual and telephonic deliveries for History/attendance testing.
// Clones a deterministic share of completed individual in-person deliveries as NEW assignments,
// sessions and invitations with new IDs. Never changes the original seed, creates no MOVs,
// follow-ups or walk-ins (remote sessions have no reception visit).
//
// Local only: this script has no Firestore write path. Applying to the live project should follow
// the seed-walkins.cjs pattern (preflight, hash checks, manifest, create-only) after explicit sign-off.
require('../node26-shim.cjs');
const admin = require('firebase-admin');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {RUN, REF, generate, hash, encode} = require('./dataset.cjs');
const EXT = 'dtseed_20261009_remote_v1';
const out = path.resolve(__dirname, '../../artifacts/digital-twin');
const metadata = {dataOrigin: 'synthetic', suppressNotifications: true, seedRunId: EXT, parentSeedRunId: RUN, generatorVersion: '1.0.0'};
const isTimestamp = v => v instanceof admin.firestore.Timestamp;
const METHODS = [{key: 'virtual', method: 'virtual'}, {key: 'telephonic', method: 'telephonically'}];

function rewrite(value, ids) {
  if (typeof value === 'string') return ids.reduce((s, [from, to]) => s.split(from).join(to), value);
  if (Array.isArray(value)) return value.map(v => rewrite(v, ids));
  if (value && typeof value === 'object' && !isTimestamp(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [rewrite(k, ids), rewrite(v, ids)]));
  return value;
}

/** Every `every`-th completed individual delivery (by id) becomes a remote twin; they alternate virtual/telephonic. */
function build(records, every = 3) {
  const byPath = new Map(records.map(r => [r.path, r.data]));
  const eligible = records.filter(r => r.path.startsWith('appointments/')).map(r => r.data).filter(a => {
    const s = byPath.get(`appointmentSessions/${a.appointmentSessionId}`);
    return a.attendance?.status === 'attended' && s?.sessionType === 'individual' && s.deliveryMethod === 'in_person' && s.startAt.toMillis() <= Date.parse(REF);
  }).sort((x, y) => x.id.localeCompare(y.id));
  const result = [], counts = {};
  eligible.filter((_, i) => i % every === 0).forEach((a, n) => {
    const s = byPath.get(`appointmentSessions/${a.appointmentSessionId}`), asg = byPath.get(`assignedInterventions/${a.assignedInterventionId}`);
    assert.ok(s && asg, `Missing link: ${a.id}`);
    const {key, method} = METHODS[n % METHODS.length];
    const suffix = a.id.replace(`${RUN}_appointment_`, '');
    const ids = [[`${RUN}_assignment_${suffix}`, `${EXT}_assignment_${suffix}`], [`${RUN}_session_${suffix}`, `${EXT}_session_${suffix}`], [`${RUN}_appointment_${suffix}`, `${EXT}_appointment_${suffix}`], [`${RUN}_mov_${suffix}`, `${EXT}_mov_${suffix}`]];
    const remote = {scenarioKey: `remote_${key}`, ...metadata};
    const session = {...rewrite(s, ids), ...remote, deliveryMethod: method, location: null,
      meetingLink: method === 'virtual' ? `https://meet.example.invalid/${EXT}_${suffix}` : null,
      dialInNote: method === 'telephonically' ? 'Synthetic telephonic session: facilitator called the SME.' : null,
      title: `${s.title} (${key})`};
    const assignment = {...rewrite(asg, ids), ...remote, movDocumentId: null};
    const invitation = {...rewrite(a, ids), ...remote};
    result.push({path: `appointmentSessions/${session.id}`, data: session}, {path: `assignedInterventions/${assignment.id}`, data: assignment}, {path: `appointments/${invitation.id}`, data: invitation});
    counts[key] = (counts[key] || 0) + 1;
  });
  assert.equal(new Set(result.map(r => r.path)).size, result.length);
  for (const r of result.filter(r => !r.path.startsWith('appointmentSessions/'))) assert.ok(!JSON.stringify(encode(r.data)).includes(`${RUN}_mov_`), `Dangling MOV link: ${r.path}`);
  return {records: result, summary: {seedRunId: EXT, parentSeedRunId: RUN, eligible: eligible.length, created: result.length / 3, byMethod: counts, documents: result.length, datasetHash: hash(result)}};
}

module.exports = {build, EXT};
if (require.main === module) {
  const planned = build(generate().records);
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'remote-local.json'), JSON.stringify(encode(planned.summary), null, 2) + '\n');
  console.log(JSON.stringify(planned.summary));
}
