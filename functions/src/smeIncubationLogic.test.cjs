const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('../../scripts/digital-twin/validate.cjs');
const { incubationState, latestSmeActivity, normalizeSmeStatus } = loadTs('functions/src/smeIncubationLogic.ts');
const now = Date.parse('2026-11-17T12:00:00Z');
const ago = days => new Date(now - days * 86400000).toISOString();

for (const [days, status, qualified] of [[79, 'Active', false], [80, 'Potential Exit', false], [89, 'Potential Exit', false], [90, 'Potential Exit', true], [120, 'Potential Exit', true]]) {
  test(`${days} days since activity: ${status}, qualified=${qualified}`, () => {
    const result = incubationState({ lastParticipationAt: ago(days) }, {}, null, now);
    assert.equal(result.status, status);
    assert.equal(result.exitQualified, qualified);
    assert.equal(result.inactiveDays, days);
  });
}
test('status changes do not reset the inactivity clock', () => {
  const result = incubationState({ incubationStatus: 'Dormant', incubationStatusChangedAt: ago(1), lastParticipationAt: ago(90) }, {}, null, now);
  assert.equal(result.status, 'Potential Exit');
  assert.equal(result.exitQualified, true);
});
test('inactive and dormant remain distinct until new participation occurs', () => {
  for (const status of ['Inactive', 'Dormant']) {
    const app = { incubationStatus: status, incubationStatusChangedAt: ago(5), lastParticipationAt: ago(10) };
    assert.equal(incubationState(app, {}, null, now).status, status);
    assert.equal(incubationState(app, {}, now - 86400000, now).status, 'Active');
  }
});
test('late-recorded participation also restores Active when newer than the activity used for the status decision', () => {
  const app = { incubationStatus: 'Potential Exit', incubationStatusChangedAt: ago(1), incubationStatusActivityAt: ago(90) };
  assert.equal(incubationState(app, {}, now - 10 * 86400000, now).status, 'Active');
});
test('onboarding baseline is labelled, never presented as real activity', () => {
  const result = incubationState({ createdAt: ago(90) }, {}, null, now);
  assert.equal(result.status, 'Potential Exit');
  assert.equal(result.lastParticipationAt, null);
  assert.equal(result.inactivityBaselineSource, 'onboarding');
});
test('unknown, invalid and future dates cannot qualify an SME for exit', () => {
  for (const date of [undefined, 'invalid', ago(-1)]) {
    const result = incubationState({ createdAt: date, lastParticipationAt: date }, {}, null, now);
    assert.equal(result.inactiveDays, null);
    assert.equal(result.exitQualified, false);
  }
});
test('already exited records are never reactivated automatically', () => {
  assert.equal(incubationState({ incubationStatus: 'Exited', incubationStatusChangedAt: ago(20) }, {}, now - 86400000, now).status, 'Exited');
});
test('group completion, no-shows, cancelled work and generic edits are not participation', () => {
  const time = ago(1);
  assert.equal(latestSmeActivity([
    { groupKey: 'group', assignmentStatus: 'completed', completedAt: time },
    { assignmentStatus: 'cancelled', participantConfirmedAt: time },
    { updatedAt: time, sessionAttendanceByAppointment: { a: { outcome: 'no_show', date: time } } },
    { sessionAttendanceByAppointment: { a: { outcome: 'attended', held: false, date: time } } }
  ], [
    { attendance: { status: 'absent', checkedInAt: time } },
    { status: 'scheduled', updatedAt: time },
    { status: 'cancelled', attendance: { status: 'attended', checkedInAt: time } }
  ], now), null);
});
test('individual attendance uses the session date rather than the later data-entry date', () => {
  assert.equal(latestSmeActivity([{ sessionAttendanceByAppointment: { a: { outcome: 'attended', date: ago(85), recordedAt: ago(1) } } }], [], now), Date.parse(ago(85)));
});
test('completed individual work, confirmations and check-ins count; latest date wins', () => {
  const result = latestSmeActivity([{ assignmentStatus: 'completed', completedAt: ago(10) }, { groupKey: 'g', participantConfirmedAt: ago(5) }], [{ attendance: { checkedInAt: { seconds: (now - 86400000) / 1000 } } }], now);
  assert.equal(result, now - 86400000);
});
test('legacy statuses normalise without conflating inactive and dormant', () => {
  assert.equal(normalizeSmeStatus('Potential exit'), 'Potential Exit');
  assert.equal(normalizeSmeStatus('non-active'), 'Inactive');
  assert.equal(normalizeSmeStatus('Dormant'), 'Dormant');
});
