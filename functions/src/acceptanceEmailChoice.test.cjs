const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');

function setup() {
  const sent = [];
  const writes = [];
  const file = __dirname + '/emailApplications.ts';
  const m = new Module(file, module);
  m.require = key => {
    if (key.includes('firebase-functions/v2/')) return new Proxy({}, { get: () => (...args) => args.at(-1) });
    if (key === 'firebase-functions/logger') return { error(error) { throw error; }, info() {} };
    if (key === './cronHeartbeat') return { scheduledJob: (...args) => args.at(-1) };
    if (key === './syntheticData') return { suppressRecordNotifications: () => false };
    if (key === './emailShared') return {
      getTransporter: () => ({ sendMail: async data => sent.push(data) }),
      admin: { firestore: { FieldValue: { serverTimestamp: () => 'now' } } }
    };
    if (key === './emailHelpers') return {
      buildAcceptanceEmail: () => ({ subject: 'Accepted' }),
      buildRejectionEmail: () => ({ subject: 'Rejected' })
    };
    if (key === './inAppNotifications') return { notifyInApp: async () => {}, uidForParticipant: async () => 'user' };
    return {};
  };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, file);
  return { sent, writes, run: (after, before) => m.exports.onApplicationDecisionEmail({
    params: { appId: 'app' }, data: {
      before: { data: () => before },
      after: { data: () => ({ email: 'sme@example.com', ...after }), ref: { set: async data => writes.push(data) } }
    }
  }) };
}

for (const choice of [true, false, undefined]) {
  test(`initial accepted SME with email choice ${choice}`, async () => {
    const h = setup();
    await h.run({ applicationStatus: 'accepted', sendAcceptanceEmail: choice });
    assert.equal(h.sent.length, choice === false ? 0 : 1);
    assert.equal(h.writes.length, choice === false ? 0 : 1);
  });
}
test('rejection emails remain enabled when acceptance emails were declined', async () => {
  const h = setup();
  await h.run({ applicationStatus: 'rejected', sendAcceptanceEmail: false });
  assert.equal(h.sent[0].subject, 'Rejected');
});
test('unchanged accepted status does not resend', async () => {
  const h = setup();
  await h.run({ applicationStatus: 'accepted', sendAcceptanceEmail: true }, { applicationStatus: 'accepted' });
  assert.equal(h.sent.length, 0);
});

