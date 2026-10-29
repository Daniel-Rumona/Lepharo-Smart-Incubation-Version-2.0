const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
require('../node26-shim.cjs');
const { analyze, dist } = require('./demand-analysis.cjs');
const D = 86400000, T0 = Date.parse('2026-01-05T08:00:00Z'), now = T0 + 100 * D;
const iso = t => new Date(t).toISOString();

function world(smeCount = 6) {
  const data = { applications: [], diagnosticPlans: [], assignedInterventions: [], appointments: [], appointmentSessions: [] };
  for (let i = 0; i < smeCount; i++) {
    const pid = 'sme' + i;
    data.applications.push({ id: 'app' + i, participantId: pid, programId: 'p1', applicationStatus: 'accepted', acceptedAt: iso(T0 - 5 * D) });
    data.diagnosticPlans.push({ id: 'dp' + i, participantId: pid, programId: 'p1', createdAt: iso(T0 - 4 * D),
      interventions: [{ id: 'iv1', departmentId: 'd1', source: 'compulsory' }, { id: 'iv2', departmentId: 'd1' }, { id: 'iv3', departmentId: 'd1' }],
      confirmedByDeptId: { d1: { confirmed: true, confirmedAt: iso(T0) } }, incubateeDepartmentConfirmationsByDeptId: { d1: { confirmed: true, confirmedAt: iso(T0 - D) } } });
    [['iv1', 1], ['iv2', 10], ['iv3', 40]].forEach(([iv, day]) => data.assignedInterventions.push({ id: `a_${pid}_${iv}`, participantId: pid, programId: 'p1', interventionId: iv, departmentId: 'd1', assignmentStatus: iv === 'iv1' ? 'completed' : 'assigned', plannedSessions: iv === 'iv2' ? 3 : 1, createdAt: iso(T0 + day * D), scheduleMode: iv === 'iv3' ? 'recurring' : 'once-off', cycleKey: iv === 'iv3' ? '2026-02' : 'single-cycle' }));
  }
  return data;
}

test('plan size, sign-off timing and pace are computed from hand-checkable numbers', () => {
  const r = analyze(world(), { now }).all;
  assert.equal(r.enrolment.acceptedSmes, 6);
  assert.equal(r.developmentalPlans.interventionsPerSme.median, 3);
  assert.equal(r.developmentalPlans.compulsoryPerSme.median, 1);
  assert.equal(r.developmentalPlans.fullySigned, 6);
  assert.equal(r.developmentalPlans.daysAcceptedToFullySigned.median, 5);              // accepted T0-5, fully signed T0
  assert.equal(r.pace.daysFromFullSignOffToFirstAssignment.median, 1);
  assert.equal(r.pace.openedWithinWeeks['2w'].distinctInterventionsOpened.median, 2); // iv1 (day 1), iv2 (day 10)
  assert.equal(r.pace.openedWithinWeeks['4w'].distinctInterventionsOpened.median, 2); // iv3 only on day 40
  assert.equal(r.pace.openedWithinWeeks['8w'].distinctInterventionsOpened.median, 3);
  assert.equal(r.pace.openedWithinWeeks['8w'].percentOfRequiredListOpened.median, 100);
  assert.equal(r.pace.openedWithinWeeks['26w'].smesOldEnough, 0);                      // signed only 100 days ago: not mature for 26 weeks
});

test('open load, recurrence and planned sessions', () => {
  const full = analyze(world(), { now }), r = full.all;
  assert.equal(r.assignments.created, 18); assert.equal(full.openNow.open, 12);      // iv1 is completed for every SME
  assert.equal(full.openNow.perSme.median, 2);
  assert.equal(r.assignments.recurringShare, 33.3);                                    // iv3 only
  assert.equal(r.assignments.percentNeedingMoreThanOneSession, 33.3);                  // iv2 needs 3
  assert.equal(r.assignments.plannedSessions.max, 3);
});

test('session gaps and same-intervention same-day load, including the one-per-day rule', () => {
  const data = world();
  const sessions = [], appointments = [];
  [0, 7, 14].forEach((d, i) => { sessions.push({ id: 's' + i, interventionId: 'iv2', sessionType: 'individual', startAt: iso(now - (30 - d) * D), status: 'completed', assigneeId: 'f1' }); appointments.push({ id: 'ap' + i, assignedInterventionId: 'a_sme0_iv2', appointmentSessionId: 's' + i, status: 'scheduled' }); });
  ['x', 'y'].forEach(k => { sessions.push({ id: 'd' + k, interventionId: 'iv9', sessionType: 'individual', startAt: iso(now - 5 * D), status: 'completed', assigneeId: 'f' + k }); appointments.push({ id: 'ad' + k, assignedInterventionId: 'a_sme1_iv1', appointmentSessionId: 'd' + k, status: 'scheduled' }); });
  sessions.push({ id: 'dz', interventionId: 'iv9', sessionType: 'individual', startAt: iso(now - 5 * D), status: 'cancelled', assigneeId: 'fz' });
  for (let i = 0; i < 4; i++) sessions.push({ id: 'o' + i, interventionId: 'iv' + (20 + i), sessionType: 'individual', startAt: iso(now - (3 + i) * D), status: 'completed', assigneeId: 'f' + i });
  data.appointmentSessions = sessions; data.appointments = appointments;
  const r = analyze(data, { now }).all.sessions;
  assert.equal(r.sameInterventionSameDay.interventionDaysChecked, 8);                  // iv2 on 3 days, iv9 on 1 day, four others
  assert.equal(r.sameInterventionSameDay.percentWithMoreThanOneSession, 12.5);         // only iv9 has two
  assert.equal(r.sameInterventionSameDay.sessionsPerInterventionPerDay.max, 2);
  assert.equal(r.percentOfGapsOnTheSameDay, 33.3);                                     // gaps 7, 7 for one assignment and 0 for the iv9 pair
});

test('a slow early cohort and a fast recent cohort are separated, and flagged as changed', () => {
  const P0 = T0, today = P0 + 300 * D;
  const data = { applications: [], diagnosticPlans: [], assignedInterventions: [], appointments: [], appointmentSessions: [] };
  const add = (tag, i, acceptedDay, signLag, firstOpen, secondOpen) => {
    const pid = `${tag}${i}`, accepted = P0 + acceptedDay * D, signed = accepted + signLag * D;
    data.applications.push({ id: 'app_' + pid, participantId: pid, programId: 'p1', applicationStatus: 'accepted', acceptedAt: iso(accepted) });
    data.diagnosticPlans.push({ id: 'dp_' + pid, participantId: pid, programId: 'p1', createdAt: iso(accepted), interventions: [{ id: 'iv1', departmentId: 'd1' }, { id: 'iv2', departmentId: 'd1' }],
      confirmedByDeptId: { d1: { confirmed: true, confirmedAt: iso(signed) } }, incubateeDepartmentConfirmationsByDeptId: { d1: { confirmed: true, confirmedAt: iso(signed) } } });
    [['iv1', firstOpen], ['iv2', secondOpen]].forEach(([iv, lag]) => data.assignedInterventions.push({ id: `a_${pid}_${iv}`, participantId: pid, programId: 'p1', interventionId: iv, departmentId: 'd1', assignmentStatus: 'assigned', plannedSessions: 1, createdAt: iso(signed + lag * D) }));
  };
  for (let i = 0; i < 6; i++) add('early', i, i, 2, 30, 40);        // pilot start: 2 days to sign, then a month before anything is opened
  for (let i = 0; i < 6; i++) add('late', i, 250 + i, 1, 3, 10);     // recent: signed in a day, opened within days
  const r = analyze(data, { now: today, weeks: 8 });
  assert.equal(r.first.enrolment.acceptedSmes, 6); assert.equal(r.recent.enrolment.acceptedSmes, 6);
  assert.equal(r.first.pace.daysFromFullSignOffToFirstAssignment.median, 30);
  assert.equal(r.recent.pace.daysFromFullSignOffToFirstAssignment.median, 3);
  assert.equal(r.all.pace.daysFromFullSignOffToFirstAssignment.median, 16.5);          // blending both would describe nobody
  assert.equal(r.first.pace.openedWithinWeeks['4w'].percentOfRequiredListOpened.median, 0);
  assert.equal(r.recent.pace.openedWithinWeeks['4w'].percentOfRequiredListOpened.median, 100);
  const lag = r.firstVersusRecent.find(m => m.metric === 'Days from department sign-off to first assignment');
  assert.deepEqual([lag.first, lag.recent], [30, 3]); assert.match(lag.verdict, /^changed/);
  assert.match(r.firstVersusRecent.find(m => m.metric === 'Interventions in a developmental plan').verdict, /^stable/);
  assert.equal(r.trendBy4Weeks[0].daysFromSignOffToFirstAssignment, 30);              // first 4-week period
  assert.equal(r.trendBy4Weeks[9].daysFromSignOffToFirstAssignment, 3);               // the period holding the recent sign-offs
  assert.equal(r.trendBy4Weeks[0].acceptedSmes, 6);
});

test('real-shaped plans (finalConfirmation plus boolean department flags) are recognised as signed', () => {
  const data = { applications: [], diagnosticPlans: [], assignedInterventions: [], appointments: [], appointmentSessions: [] };
  for (let i = 0; i < 6; i++) {
    const pid = 'r' + i, signed = T0 + i * D;
    data.applications.push({ id: 'ra' + i, participantId: pid, programId: 'p9', applicationStatus: 'accepted', acceptedAt: iso(signed - 3 * D) });
    data.diagnosticPlans.push({ id: 'rp' + i, participantId: pid, programId: 'p9', createdAt: iso(signed - 2 * D), interventions: [{ id: 'x1', area: 'Legal' }, { id: 'x2', area: 'Finance' }],
      confirmedByDeptId: { deptA: true, deptB: true }, incubateeDepartmentConfirmationsByDeptId: { deptA: { confirmed: true } }, finalConfirmation: true, finalConfirmationAt: iso(signed) });
    data.assignedInterventions.push({ id: 'ra_' + i, participantId: pid, programId: 'p9', interventionId: 'x1', assignmentStatus: 'assigned', createdAt: iso(signed + 6 * D) });
  }
  const r = analyze(data, { now: T0 + 200 * D });
  assert.equal(r.dataQuality.plansSignedByFinalConfirmation, 6); assert.equal(r.dataQuality.plansNotSigned, 0); assert.equal(r.dataQuality.plansSignedWithADate, 6);
  assert.equal(r.all.pace.daysFromFullSignOffToFirstAssignment.median, 6);
  assert.equal(r.all.pace.daysFromPlanCreatedToFirstAssignment.median, 8);             // plan created 2 days before sign-off
  assert.equal(r.all.developmentalPlans.daysAcceptedToFullySigned.median, 3);
  assert.equal(r.dataQuality.percentOfThoseThatAreInThePlanList, 100);
});

test('pace is measured per SME x department from that department being signed by both sides', () => {
  const data = { applications: [], diagnosticPlans: [], assignedInterventions: [], appointments: [], appointmentSessions: [] };
  for (let i = 0; i < 6; i++) {
    const pid = 'd' + i, t1 = T0, t2 = T0 + 10 * D;
    data.diagnosticPlans.push({ id: 'dp' + i, participantId: pid, programId: 'p7', createdAt: iso(T0 - D),
      interventions: [{ id: 'a1', departmentId: 'D1' }, { id: 'a2', departmentId: 'D1' }, { id: 'b1', departmentId: 'D2' }, { id: 'b2', departmentId: 'D2' }, { id: 'b3', departmentId: 'D2' }, { id: 'c1', departmentId: 'D3' }],
      confirmedByDeptId: { D1: true, D2: true, D3: true },                                   // plain booleans, as in real plans
      incubateeDepartmentConfirmationsByDeptId: { D1: { confirmed: true, confirmedAt: iso(t1) }, D2: { confirmed: true, confirmedAt: iso(t2) } } }); // D3 not signed by the SME
    [['a1', 2, 'D1'], ['a2', 9, 'D1'], ['b1', 15, 'D2'], ['c1', 1, 'D3']].forEach(([iv, day, dept]) => data.assignedInterventions.push({ id: `x_${pid}_${iv}`, participantId: pid, programId: 'p7', interventionId: iv, departmentId: dept, assignmentStatus: 'assigned', createdAt: iso(T0 + day * D) }));
  }
  const r = analyze(data, { now: T0 + 200 * D }), p = r.all.departmentPace;
  assert.equal(p.smeDepartmentPairsSigned, 12);                                          // D1 and D2 for each of 6 SMEs; D3 is not signed by the SME
  assert.equal(p.interventionsRequiredPerPair.median, 2.5);                              // six pairs of 2 and six pairs of 3
  assert.equal(p.daysFromDepartmentSignOffToFirstAssignment.median, 3.5);                // D1: first at +2 days; D2: first at +5 days
  assert.equal(p.openedWithinWeeks['2w'].distinctInterventionsOpened.median, 1.5);       // D1 opened 2, D2 opened 1 (b1 at +5 days)
  assert.equal(Math.round(p.openedWithinWeeks['2w'].percentOfDepartmentListOpened.median), 67);
  assert.equal(r.dataQuality.smeDepartmentPairsSigned, 12);
});

test('small groups are suppressed so individuals cannot be read from the output', () => {
  assert.deepEqual(dist([1, 2, 3, 4]), { n: 4, suppressed: true });
  assert.equal(dist([1, 2, 3, 4, 5]).median, 3);
  const r = analyze(world(3), { now }).all;
  assert.equal(r.developmentalPlans.interventionsPerSme.suppressed, true);
  assert.equal(r.pace.daysFromFullSignOffToFirstAssignment.suppressed, true);
});

test('synthetic demo records are excluded by default and counted only when asked', () => {
  const { generate } = require('./dataset.cjs');
  const by = {};
  for (const rec of generate().records) { const [c] = rec.path.split('/'); (by[c] ||= []).push({ id: rec.data.id || rec.path.split('/')[1], ...rec.data }); }
  const data = { applications: by.applications, diagnosticPlans: by.diagnosticPlans, assignedInterventions: by.assignedInterventions, appointments: by.appointments, appointmentSessions: by.appointmentSessions };
  const real = analyze(data, { now: Date.parse('2026-10-12T00:00:00Z') });
  assert.equal(real.counts.assignments, 0); assert.equal(real.counts.diagnosticPlans, 0);
  const demo = analyze(data, { now: Date.parse('2026-10-12T00:00:00Z'), includeSynthetic: true });
  assert.ok(demo.counts.assignments > 0 && demo.all.developmentalPlans.plans > 0);
  assert.ok(demo.firstVersusRecent.length > 0 && demo.trendBy4Weeks.length > 0);
  const text = JSON.stringify(demo);
  assert.ok(!/dtseed_|@/.test(text), 'output must not contain ids or emails');
});

test('the live loader is strictly read-only and fetches only masked fields', () => {
  const src = fs.readFileSync(path.join(__dirname, 'analyze-demand.cjs'), 'utf8');
  // The only allowed .delete( is closing our own local Firebase connection (app.delete()), which touches no data.
  assert.equal((src.match(/app\.delete\(/g) || []).length, 1, 'exactly one app teardown');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n').split('await app.delete()').join('');
  for (const forbidden of ['.set(', '.update(', '.delete(', '.create(', '.add(', '.batch(', '.runTransaction(', '.commit(', 'bulkWriter', 'recursiveDelete'])
    assert.ok(!code.includes(forbidden), `loader must not call ${forbidden}`);
  assert.ok(code.includes('.select(...fields).get()'));
  const { FIELDS } = require('./analyze-demand.cjs');
  for (const list of Object.values(FIELDS)) for (const f of list) assert.ok(!/email|phone|name/i.test(f), `mask must not request ${f}`);
  assert.ok(!/console\.(log|error)\([^)]*\bkey\b/.test(code), 'credential must never be printed');
});
