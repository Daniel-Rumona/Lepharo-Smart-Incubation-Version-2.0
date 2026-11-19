const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { loadTs } = require('../../scripts/digital-twin/validate.cjs');
const logic = loadTs('functions/src/smeIncubationLogic.ts');
const ago = days => new Date(Date.now() - days * 86400000).toISOString();
function setup(overrides = {}) {
  const data = {
    'users/staff': { role: 'operations', departmentId: 'rom' },
    'departments/rom': { isOnboarding: true },
    'applications/app': { participantId: 'sme', programId: 'p', applicationStatus: 'accepted', createdAt: ago(120), incubationStatus: 'Active' },
    'participants/sme': {},
    'appointments/a': { smeId: 'sme', programId: 'p', attendance: { checkedInAt: ago(10) } },
    ...overrides,
  };
  const writes = [];
  const snapshot = path => ({ id: path.split('/').at(-1), exists: path in data, data: () => data[path] });
  const query = (name, filters = []) => ({
    name, filters,
    doc: id => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }),
    where: (field, op, value) => query(name, [...filters, [field, value]]),
    get: async () => ({ docs: Object.keys(data).filter(path => path.startsWith(name + '/') && filters.every(([field, value]) => data[path][field] === value)).map(snapshot) }),
  });
  const db = { collection: name => query(name), runTransaction: async fn => fn({
    get: async ref => ref.path ? snapshot(ref.path) : ref.get(),
    update: (ref, patch) => { writes.push(patch); data[ref.path] = { ...data[ref.path], ...patch }; },
  }) };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const file = __dirname + '/smeIncubationStatus.ts';
  const m = new Module(file, module);
  m.require = name => {
    if (name === 'firebase-functions/v2/https') return { onCall: (_, fn) => fn, HttpsError };
    if (name === 'firebase-functions/v2/firestore') return { onDocumentWritten: (_, fn) => fn };
    if (name === './firebase') return { db, admin: { firestore: { FieldValue: { arrayUnion: entry => [entry] } } } };
    if (name === './cronHeartbeat') return { scheduledJob: (_, __, fn) => fn };
    if (name === './departmentRoles') return { departmentIdsForRole: async () => ['rom'] };
    if (name === './syntheticData') return { suppressRecordNotifications: () => false };
    if (name === './smeIncubationLogic') return logic;
    throw new Error(name);
  };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
  return { handlers: m.exports, writes, data, call: (body = {}, auth = { uid: 'staff' }) => m.exports.setSmeIncubationStatus({ auth, data: { applicationId: 'app', status: 'Inactive', reason: 'Temporary pause', ...body } }) };
}
test('ROM can change status with an audit reason without resetting participation', async () => {
  const h = setup();
  const result = await h.call();
  assert.equal(result.incubationStatus, 'Inactive');
  assert.equal(result.inactiveDays, 10);
  assert.equal(h.writes[0].incubationStatusHistory[0].reason, 'Temporary pause');
  assert.equal(h.writes[0].incubationStatusHistory[0].by, 'staff');
});
test('unauthenticated and non-ROM users cannot change status', async () => {
  await assert.rejects(setup().call({}, null), { code: 'unauthenticated' });
  const h = setup({ 'users/staff': { role: 'incubatee', departmentId: 'rom' } });
  await assert.rejects(h.call(), { code: 'permission-denied' });
  assert.equal(h.writes.length, 0);
});
test('a blank audit reason is rejected', async () => {
  await assert.rejects(setup().call({ reason: '  ' }), { code: 'invalid-argument' });
});
test('an old SME cannot escape the 80-day rule by changing its status', async () => {
  const h = setup({ 'appointments/a': { smeId: 'sme', programId: 'p', attendance: { checkedInAt: ago(85) } } });
  await assert.rejects(h.call({ status: 'Active' }), { code: 'failed-precondition' });
  assert.equal(h.writes.length, 0);
  assert.equal((await h.call({ status: 'Potential Exit' })).incubationStatus, 'Potential Exit');
});
test('activity in another programme does not reset this programme countdown', async () => {
  const h = setup({ 'appointments/a': { smeId: 'sme', programId: 'other', attendance: { checkedInAt: ago(1) } } });
  const result = await h.call({ status: 'Potential Exit' });
  assert.equal(result.inactiveDays, 120);
  assert.equal(result.exitQualified, true);
});
test('appointment activity trigger restores Active and clears exit qualification', async () => {
  const h = setup({ 'applications/app': { participantId: 'sme', programId: 'p', applicationStatus: 'accepted', incubationStatus: 'Potential Exit', incubationStatusChangedAt: ago(12), incubationStatusActivityAt: ago(95), exitQualified: true } });
  await h.handlers.onSmeAppointmentActivity({ data: { before: { data: () => null }, after: { data: () => ({ smeId: 'sme' }) } } });
  assert.equal(h.writes[0].incubationStatus, 'Active');
  assert.equal(h.writes[0].exitQualified, false);
});
test('deleting attendance recomputes activity rather than retaining a stale watermark', async () => {
  const h = setup({
    'applications/app': { participantId: 'sme', programId: 'p', applicationStatus: 'accepted', createdAt: ago(100), lastParticipationAt: ago(1) },
    'appointments/a': { smeId: 'sme', attendance: { status: 'absent' } },
  });
  await h.handlers.onSmeAppointmentActivity({ data: { before: { data: () => ({ smeId: 'sme' }) }, after: { data: () => null } } });
  assert.equal(h.writes[0].incubationStatus, 'Potential Exit');
  assert.equal(h.writes[0].lastParticipationAt, null);
});

test('pending applications cannot be changed through the SME status endpoint', async () => {
  const h = setup({ 'applications/app': { applicationStatus: 'pending' } });
  await assert.rejects(h.call(), { code: 'failed-precondition' });
  assert.equal(h.writes.length, 0);
});
test('disabled staff cannot update status even in an onboarding department', async () => {
  const h = setup({ 'users/staff': { role: 'operations', departmentId: 'rom', status: 'Inactive' } });
  await assert.rejects(h.call(), { code: 'permission-denied' });
});
test('late participation restores an SME previously flagged using its onboarding baseline', async () => {
  const h = setup({
    'applications/app': { participantId: 'sme', programId: 'p', applicationStatus: 'accepted', createdAt: ago(100) },
    'appointments/a': { smeId: 'sme', programId: 'p', attendance: { status: 'absent' } },
  });
  const event = { data: { before: { data: () => null }, after: { data: () => ({ smeId: 'sme' }) } } };
  await h.handlers.onSmeAppointmentActivity(event);
  assert.equal(h.writes[0].incubationStatus, 'Potential Exit');
  h.data['appointments/a'].attendance = { checkedInAt: ago(10) };
  await h.handlers.onSmeAppointmentActivity(event);
  assert.equal(h.writes[1].incubationStatus, 'Active');
});
