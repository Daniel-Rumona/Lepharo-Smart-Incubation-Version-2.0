// Pure calibration of the digital twin's demand model from real records. No Firebase, no I/O.
// A pilot mixes learning-curve behaviour with steady behaviour, so every measure is reported three ways:
//   all     : the whole history (for reference only)
//   first   : the first N weeks of each programme (people still learning the system)
//   recent  : the last N weeks (closest to how the next programme will run)
// plus a trend by 4-week period and a stable/changed verdict per metric. Output is aggregate only: ids are used to
// group rows in memory and are never returned, and groups under MIN_GROUP rows are suppressed.
const DAY = 86400000, OFFSET = 7200000, WEEK = 7 * DAY;
const MIN_GROUP = 5;

const ms = v => {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const dayNo = t => Math.floor((t + OFFSET) / DAY);
const isTrue = c => c === true || (c && typeof c === 'object' && c.confirmed === true);
const lower = v => String(v ?? '').trim().toLowerCase();
const isSynthetic = r => r?.dataOrigin === 'synthetic' || String(r?.id || '').startsWith('dtseed_') || String(r?.programId || '').startsWith('dtseed_') || String(r?.participantId || '').startsWith('dtseed_');

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
function dist(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < MIN_GROUP) return { n: v.length, suppressed: true };
  return { n: v.length, p25: r1(quantile(v, .25)), median: r1(quantile(v, .5)), p75: r1(quantile(v, .75)), p90: r1(quantile(v, .9)), max: r1(v.at(-1)), mean: r1(v.reduce((a, b) => a + b, 0) / v.length) };
}
const share = (part, whole) => whole ? Math.round(part / whole * 1000) / 10 : null;
function groupBy(rows, keyOf) { const m = new Map(); for (const r of rows) { const k = keyOf(r); if (k == null || k === '') continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; }

function analyze(data, opts = {}) {
  const now = opts.now ?? Date.now(), weeks = opts.weeks ?? 8, keep = r => opts.includeSynthetic || !isSynthetic(r);
  const apps = (data.applications || []).filter(keep), plans = (data.diagnosticPlans || []).filter(keep);
  const assignmentsAll = (data.assignedInterventions || []).filter(keep), sessionsAll = (data.appointmentSessions || []).filter(keep), appointmentsAll = (data.appointments || []).filter(keep);

  // ---- Normalise once ----
  const accepted = apps.filter(a => lower(a.applicationStatus) === 'accepted');
  const acceptedAt = new Map(); let fallback = 0, noDate = 0; const programOf = new Map();
  for (const a of accepted) {
    let t = ms(a.acceptedAt); if (t == null) { t = ms(a.updatedAt) ?? ms(a.createdAt); if (t != null) fallback++; else noDate++; }
    if (t != null && a.participantId && (!acceptedAt.has(a.participantId) || t < acceptedAt.get(a.participantId))) { acceptedAt.set(a.participantId, t); programOf.set(a.participantId, a.programId || ''); }
  }
  const planKey = p => `${p.participantId}|${p.programId || ''}`;
  const latestPlan = new Map();
  for (const p of plans) { if (!p.participantId) continue; const k = planKey(p), t = ms(p.createdAt) ?? 0; if (!latestPlan.has(k) || t > (ms(latestPlan.get(k).createdAt) ?? 0)) latestPlan.set(k, p); }
  const planRows = [...latestPlan.values()].map(p => {
    const items = Array.isArray(p.interventions) ? p.interventions : [];
    const ids = new Set(items.map(i => String(i.id || i.interventionId || '')).filter(Boolean));
    const depts = groupBy(items, i => i.departmentId || i.area || 'unknown');
    // Real plans carry finalConfirmation (+ finalConfirmationAt); department confirmations are plain booleans by department id.
    // The older object shape ({ confirmed, confirmedAt } per department, both sides) is still understood.
    const deptMap = p.confirmedByDeptId || {}, smeMap = p.incubateeDepartmentConfirmationsByDeptId || {};
    const deptIds = [...depts.keys()].filter(d => d !== 'unknown');
    const finalOk = p.finalConfirmation === true;
    const trues = m => Object.values(m || {}).filter(isTrue).length;
    const legacyOk = deptIds.length > 0 && deptIds.every(d => isTrue(deptMap[d]) && isTrue(smeMap[d]));
    // Department keys in plan items can be names while confirmations are keyed by id (or the reverse), so also compare counts.
    const deptTrue = Math.max(trues(deptMap), trues(p.confirmed)), smeTrue = Math.max(trues(smeMap), trues(p.incubateeDepartmentConfirmations), trues(p.smmeConfirmedByDeptId));
    const countOk = !legacyOk && deptIds.length > 0 && deptTrue >= deptIds.length && smeTrue >= deptIds.length;
    const smeOk = p.incubateeConfirmation === true;
    const signed = finalOk || smeOk || legacyOk || countOk;
    const finalAt = ms(p.finalConfirmationAt);
    const times = [finalAt, ms(p.incubateeConfirmationAt), ...Object.values(p.incubateeDepartmentConfirmations || {}).map(c => isTrue(c) ? ms(c.confirmedAt) : null), ...Object.values(smeMap).map(c => isTrue(c) ? ms(c.confirmedAt) : null), ...Object.values(deptMap).map(c => isTrue(c) && typeof c === 'object' ? ms(c.confirmedAt) : null)].filter(t => t != null);
    const signedAt = signed && times.length ? (finalOk && finalAt != null ? finalAt : Math.max(...times)) : null;
    return { pid: p.participantId, program: p.programId || '', created: ms(p.createdAt), size: ids.size, compulsory: items.filter(i => lower(i.source) === 'compulsory').length, departments: deptIds.length, perDept: [...depts.values()].map(v => v.length), signed, signedAt, deptItems: new Map([...depts].map(([d, v]) => [d, new Set(v.map(i => String(i.id || i.interventionId || '')).filter(Boolean))])), deptMap, smeMap,
      signedBy: finalOk ? 'final' : smeOk ? 'smeConfirmation' : legacyOk ? 'departments' : countOk ? 'counts' : 'none',
      shape: { final: finalOk, finalDate: finalAt != null, smeConfirmation: smeOk, deptMapEntries: Object.keys(deptMap).length > 0, deptTrue: deptTrue > 0, legacyNameMap: Object.keys(p.confirmed || {}).length > 0, smeMapEntries: Object.keys(smeMap).length > 0, smeTrue: smeTrue > 0, smeLegacyMap: Object.keys(p.incubateeDepartmentConfirmations || {}).length > 0, hasItems: items.length > 0, itemsWithDepartmentId: items.filter(i => i.departmentId).length > 0, itemsWithArea: items.filter(i => i.area || i.areaOfSupport).length > 0 }, ids };
  });
  const assignments = assignmentsAll.map(a => ({
    id: a.id, pid: a.participantId, program: a.programId || '', iv: String(a.interventionId || ''), sub: String(a.subInterventionId || ''), dept: String(a.departmentId || a.areaOfSupport || 'unknown'),
    cycle: String(a.cycleKey || ''), mode: lower(a.scheduleMode || (a.recurrence ? 'recurring' : '')), freq: lower(a.frequency), planned: Number(a.plannedSessions),
    status: lower(a.assignmentStatus), created: ms(a.assignedAt) ?? ms(a.createdAt), completed: ms(a.completedAt), grouped: !!a.groupKey
  })).filter(a => a.pid && a.iv);
  const live = assignments.filter(a => a.status !== 'cancelled');
  const deptSignoffs = [];
  for (const p of planRows) for (const [d, idSet] of p.deptItems) {
    if (d === 'unknown' || !idSet.size || !(isTrue(p.deptMap[d]) && isTrue(p.smeMap[d]))) continue;
    const t = [ms(p.smeMap[d]?.confirmedAt), typeof p.deptMap[d] === 'object' ? ms(p.deptMap[d].confirmedAt) : null].filter(x => x != null);
    deptSignoffs.push({ pid: p.pid, program: p.program, ids: idSet, signedAt: t.length ? Math.max(...t) : null });
  }
  const perSmeAll = groupBy(live, a => a.pid);
  const sessionById = new Map(sessionsAll.map(s => [s.id, { iv: String(s.interventionId || ''), program: s.programId || '', type: lower(s.sessionType), start: ms(s.startAt), status: lower(s.status), who: String(s.assigneeId || '') }]));

  // ---- Each programme's own start: the earliest acceptance or first assignment ----
  const starts = new Map();
  const note = (program, t) => { if (t != null && (!starts.has(program) || t < starts.get(program))) starts.set(program, t); };
  for (const [pid, t] of acceptedAt) note(programOf.get(pid) || '', t);
  for (const a of live) note(a.program, a.created);
  const globalStart = starts.size ? Math.min(...starts.values()) : now;

  // ---- Windows ----
  const WINDOWS = {
    all: { label: 'whole history', inside: (t, program) => t != null && t <= now, origin: () => globalStart, weeks: Math.max(1, Math.min(52, Math.ceil((now - globalStart) / WEEK))) },
    first: { label: `first ${weeks} weeks of each programme`, inside: (t, program) => { const s = starts.get(program); return t != null && s != null && t >= s && t < s + weeks * WEEK; }, origin: program => starts.get(program) ?? globalStart, weeks },
    recent: { label: `last ${weeks} weeks`, inside: (t) => t != null && t >= now - weeks * WEEK && t <= now, origin: () => now - weeks * WEEK, weeks }
  };

  function measure(name) {
    const W = WINDOWS[name];
    const weekly = (events) => { const b = Array(W.weeks).fill(0); for (const [t, program] of events) { const i = Math.floor((t - W.origin(program)) / WEEK); if (i >= 0 && i < W.weeks) b[i]++; } return b; };
    const out = { window: W.label };

    // Enrolment
    const acc = [...acceptedAt].map(([pid, t]) => [t, programOf.get(pid) || '']).filter(([t, p]) => W.inside(t, p));
    out.enrolment = { acceptedSmes: acc.length, perWeek: dist(weekly(acc)) };

    // Developmental plans (anchored on full sign-off, else creation)
    const pl = planRows.filter(p => W.inside(p.signedAt ?? p.created, p.program));
    out.developmentalPlans = {
      plans: pl.length, fullySigned: pl.filter(p => p.signed).length,
      interventionsPerSme: dist(pl.map(p => p.size)), compulsoryPerSme: dist(pl.map(p => p.compulsory)), departmentsPerSme: dist(pl.map(p => p.departments)),
      interventionsPerSmePerDepartment: dist(pl.flatMap(p => p.perDept)),
      daysAcceptedToFullySigned: dist(pl.map(p => p.signedAt != null && acceptedAt.has(p.pid) ? (p.signedAt - acceptedAt.get(p.pid)) / DAY : NaN))
    };

    // Assignments created in the window
    const made = live.filter(a => W.inside(a.created, a.program));
    const recurring = made.filter(a => a.mode === 'recurring' || (a.cycle && a.cycle !== 'single-cycle'));
    const cyclesPerPair = groupBy(recurring, a => `${a.pid}|${a.iv}|${a.sub}`);
    const planned = made.filter(a => Number.isFinite(a.planned) && a.planned > 0);
    out.assignments = {
      created: made.length, createdPerWeek: dist(weekly(made.map(a => [a.created, a.program]))), recurringShare: share(recurring.length, made.length),
      cyclesCreatedPerSmeAndIntervention: dist([...cyclesPerPair.values()].map(v => new Set(v.map(a => a.cycle)).size)),
      plannedSessions: dist(planned.map(a => a.planned)), percentNeedingMoreThanOneSession: share(planned.filter(a => a.planned > 1).length, planned.length), plannedSessionsMissing: made.length - planned.length
    };

    // Pace: SMEs whose plan was fully signed in the window, followed up to now
    const weeksList = [2, 4, 8, 12, 26], cohort = pl.filter(p => p.signedAt != null && p.size > 0), fromCreated = [];
    for (const p of pl.filter(p => p.created != null && p.size > 0)) { const mine = (perSmeAll.get(p.pid) || []).filter(a => p.ids.has(a.iv) && a.created != null); if (mine.length) fromCreated.push((Math.min(...mine.map(a => a.created)) - p.created) / DAY); }
    const first = [], before = [], byWeeks = Object.fromEntries(weeksList.map(w => [w, { count: [], pct: [] }]));
    for (const p of cohort) {
      const mine = (perSmeAll.get(p.pid) || []).filter(a => p.ids.has(a.iv) && a.created != null), days = mine.map(a => (a.created - p.signedAt) / DAY);
      if (days.length) first.push(Math.min(...days)); before.push(days.filter(d => d < 0).length);
      for (const w of weeksList) {
        if (now - p.signedAt < w * WEEK) continue; // only SMEs signed at least w weeks ago, so recent sign-offs are not unfairly counted as slow
        const opened = new Set(mine.filter(a => (a.created - p.signedAt) / DAY <= w * 7).map(a => a.iv)).size;
        byWeeks[w].count.push(opened); byWeeks[w].pct.push(opened / p.size * 100);
      }
    }
    out.pace = { smes: cohort.length, plansWithAssignmentsFromPlanCreation: fromCreated.length, daysFromPlanCreatedToFirstAssignment: dist(fromCreated), daysFromFullSignOffToFirstAssignment: dist(first), assignmentsCreatedBeforeSignOffPerSme: dist(before),
      openedWithinWeeks: Object.fromEntries(weeksList.map(w => [`${w}w`, { smesOldEnough: byWeeks[w].count.length, distinctInterventionsOpened: dist(byWeeks[w].count), percentOfRequiredListOpened: dist(byWeeks[w].pct) }])) };

    // Pace per SME x department: from that department's sign-off to its interventions being opened.
    const pairs = deptSignoffs.filter(x => x.signedAt != null && W.inside(x.signedAt, x.program));
    const dFirst = [], dBefore = [], dByWeeks = Object.fromEntries(weeksList.map(w => [w, { count: [], pct: [] }]));
    for (const x of pairs) {
      const mine = (perSmeAll.get(x.pid) || []).filter(a => x.ids.has(a.iv) && a.created != null), days = mine.map(a => (a.created - x.signedAt) / DAY);
      if (days.length) dFirst.push(Math.min(...days)); dBefore.push(days.filter(v => v < 0).length);
      for (const w of weeksList) {
        if (now - x.signedAt < w * WEEK) continue;
        const opened = new Set(mine.filter(a => (a.created - x.signedAt) / DAY <= w * 7).map(a => a.iv)).size;
        dByWeeks[w].count.push(opened); dByWeeks[w].pct.push(opened / x.ids.size * 100);
      }
    }
    out.departmentPace = { smeDepartmentPairsSigned: pairs.length, interventionsRequiredPerPair: dist(pairs.map(x => x.ids.size)), daysFromDepartmentSignOffToFirstAssignment: dist(dFirst), pairsWithNoAssignmentYetPercent: share(pairs.length - dFirst.length, pairs.length), assignmentsCreatedBeforeSignOffPerPair: dist(dBefore),
      openedWithinWeeks: Object.fromEntries(weeksList.map(w => [`${w}w`, { pairsOldEnough: dByWeeks[w].count.length, distinctInterventionsOpened: dist(dByWeeks[w].count), percentOfDepartmentListOpened: dist(dByWeeks[w].pct) }])) };

    // Sessions held in the window
    const usable = [...sessionById.entries()].filter(([, s]) => s.status !== 'cancelled' && W.inside(s.start, s.program)).map(([id, s]) => ({ id, ...s }));
    const inWin = new Set(usable.map(s => s.id)), perAssignment = new Map();
    for (const ap of appointmentsAll) { if (lower(ap.status) === 'cancelled' || !inWin.has(ap.appointmentSessionId)) continue; const s = sessionById.get(ap.appointmentSessionId); if (!perAssignment.has(ap.assignedInterventionId)) perAssignment.set(ap.assignedInterventionId, new Map()); perAssignment.get(ap.assignedInterventionId).set(ap.appointmentSessionId, s.start); }
    const counts = [], gaps = [];
    for (const m of perAssignment.values()) { const st = [...m.values()].sort((a, b) => a - b); counts.push(st.length); for (let i = 1; i < st.length; i++) gaps.push(dayNo(st[i]) - dayNo(st[i - 1])); }
    const individual = usable.filter(s => s.type !== 'group' && s.iv);
    const perIvDay = groupBy(individual, s => `${s.iv}|${dayNo(s.start)}`), perWhoDay = groupBy(usable.filter(s => s.who), s => `${s.who}|${dayNo(s.start)}`);
    out.sessions = {
      held: usable.length, perAssignment: dist(counts), daysBetweenConsecutiveSessionsOfOneAssignment: dist(gaps), percentOfGapsOnTheSameDay: share(gaps.filter(g => g === 0).length, gaps.length), percentOfGapsWithin7Days: share(gaps.filter(g => g <= 7).length, gaps.length),
      sameInterventionSameDay: { interventionDaysChecked: perIvDay.size, percentWithMoreThanOneSession: share([...perIvDay.values()].filter(v => v.length > 1).length, perIvDay.size), sessionsPerInterventionPerDay: dist([...perIvDay.values()].map(v => v.length)) },
      perFacilitatorPerDay: dist([...perWhoDay.values()].map(v => v.length))
    };
    return out;
  }

  const result = { generatedAt: new Date(now).toISOString(), note: 'Aggregates only. Real records only unless includeSynthetic was set. The pilot mixes learning with steady behaviour: prefer the recent window for the model.', includeSynthetic: !!opts.includeSynthetic, windowWeeks: weeks,
    counts: { applications: apps.length, acceptedWithDate: acceptedAt.size, acceptedWithoutAnyDate: noDate, acceptanceDateFromFallback: fallback, diagnosticPlans: plans.length, assignments: assignmentsAll.length, sessions: sessionsAll.length, appointments: appointmentsAll.length, programmes: starts.size } };
  const planSmes = new Set(planRows.map(p => p.pid)), inPlan = live.filter(a => planSmes.has(a.pid));
  const planFor = new Map(planRows.map(p => [p.pid + '|' + p.program, p])), matched = inPlan.filter(a => planFor.get(a.pid + '|' + a.program)?.ids.has(a.iv) || [...planRows].some(p => p.pid === a.pid && p.ids.has(a.iv)));
  result.dataQuality = { plansSignedByFinalConfirmation: planRows.filter(p => p.signedBy === 'final').length, plansSignedByDepartmentAndSmeConfirmations: planRows.filter(p => p.signedBy === 'departments').length, plansSignedBySmeConfirmation: planRows.filter(p => p.signedBy === 'smeConfirmation').length, plansSignedByCountingConfirmations: planRows.filter(p => p.signedBy === 'counts').length,
    planFieldCensus: Object.fromEntries(Object.keys(planRows[0]?.shape || {}).map(k => [k, planRows.filter(p => p.shape[k]).length])), plansSignedWithADate: planRows.filter(p => p.signedAt != null).length, plansNotSigned: planRows.filter(p => !p.signed).length,
    smeDepartmentPairsSigned: deptSignoffs.length, smeDepartmentPairsSignedWithADate: deptSignoffs.filter(x => x.signedAt != null).length, assignmentsOfSmesWithAPlan: inPlan.length, percentOfThoseThatAreInThePlanList: share(matched.length, inPlan.length), assignmentsWithoutAPlan: live.length - inPlan.length };
  result.all = measure('all'); result.first = measure('first'); result.recent = measure('recent');

  // Current open load is a snapshot of now, so it is reported once.
  const isOpen = a => a.status !== 'completed' && a.completed == null, openRows = live.filter(isOpen);
  result.openNow = { open: openRows.length, perSme: dist([...groupBy(openRows, a => a.pid).values()].map(v => v.length)), perSmePerDepartment: dist([...groupBy(openRows, a => `${a.pid}|${a.dept}`).values()].map(v => v.length)),
    openCyclesPerSmeAndIntervention: dist([...groupBy(openRows.filter(a => a.mode === 'recurring' || (a.cycle && a.cycle !== 'single-cycle')), a => `${a.pid}|${a.iv}|${a.sub}`).values()].map(v => v.length)) };

  // ---- Trend by 4-week period since the first activity ----
  const bucket = t => Math.floor((t - globalStart) / (4 * WEEK)), nBuckets = Math.min(30, Math.max(1, bucket(now) + 1));
  const series = Array.from({ length: nBuckets }, (_, i) => ({ periodStart: new Date(globalStart + i * 4 * WEEK).toISOString().slice(0, 10), acceptedSmes: 0, assignmentsCreated: 0, sessionsHeld: 0, daysFromSignOffToFirstAssignment: null }));
  for (const t of acceptedAt.values()) { const b = bucket(t); if (b >= 0 && b < nBuckets) series[b].acceptedSmes++; }
  for (const a of live) if (a.created != null) { const b = bucket(a.created); if (b >= 0 && b < nBuckets) series[b].assignmentsCreated++; }
  for (const s of sessionById.values()) if (s.status !== 'cancelled' && s.start != null && s.start <= now) { const b = bucket(s.start); if (b >= 0 && b < nBuckets) series[b].sessionsHeld++; }
  const firstDays = new Map();
  for (const p of planRows) { if (p.signedAt == null || now - p.signedAt < 4 * WEEK) continue; const mine = (perSmeAll.get(p.pid) || []).filter(a => p.ids.has(a.iv) && a.created != null); if (!mine.length) continue; const b = bucket(p.signedAt); if (b < 0 || b >= nBuckets) continue; if (!firstDays.has(b)) firstDays.set(b, []); firstDays.get(b).push(Math.min(...mine.map(a => (a.created - p.signedAt) / DAY))); }
  for (const [b, v] of firstDays) if (v.length >= MIN_GROUP) series[b].daysFromSignOffToFirstAssignment = r1(quantile([...v].sort((x, y) => x - y), .5));
  result.trendBy4Weeks = series;

  // ---- First vs recent: is the pilot's early behaviour representative? ----
  const med = d => d && !d.suppressed ? d.median : null, mean = d => d && !d.suppressed ? d.mean : null;
  const metrics = [
    ['SMEs accepted per week', mean(result.first.enrolment.perWeek), mean(result.recent.enrolment.perWeek)],
    ['Interventions in a developmental plan', med(result.first.developmentalPlans.interventionsPerSme), med(result.recent.developmentalPlans.interventionsPerSme)],
    ['Days from acceptance to fully signed plan', med(result.first.developmentalPlans.daysAcceptedToFullySigned), med(result.recent.developmentalPlans.daysAcceptedToFullySigned)],
    ['Days from department sign-off to first assignment', med(result.first.departmentPace.daysFromDepartmentSignOffToFirstAssignment), med(result.recent.departmentPace.daysFromDepartmentSignOffToFirstAssignment)],
    ['Department list opened within 4 weeks (%)', med(result.first.departmentPace.openedWithinWeeks['4w'].percentOfDepartmentListOpened), med(result.recent.departmentPace.openedWithinWeeks['4w'].percentOfDepartmentListOpened)],
    ['Assignments created per week', mean(result.first.assignments.createdPerWeek), mean(result.recent.assignments.createdPerWeek)],
    ['Planned sessions per assignment', mean(result.first.assignments.plannedSessions), mean(result.recent.assignments.plannedSessions)],
    ['Days between sessions of one assignment', med(result.first.sessions.daysBetweenConsecutiveSessionsOfOneAssignment), med(result.recent.sessions.daysBetweenConsecutiveSessionsOfOneAssignment)]
  ];
  result.firstVersusRecent = metrics.map(([metric, first, recent]) => {
    if (first == null || recent == null) return { metric, first, recent, verdict: 'not enough data in one of the windows' };
    const ratio = first === 0 ? (recent === 0 ? 1 : Infinity) : recent / first;
    return { metric, first, recent, ratioRecentToFirst: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null, verdict: ratio >= 0.75 && ratio <= 1.33 ? 'stable: the whole pilot is a fair guide' : 'changed: use the recent window, the early weeks were a learning period' };
  });
  return result;
}

module.exports = { analyze, dist, ms, isSynthetic, MIN_GROUP };
