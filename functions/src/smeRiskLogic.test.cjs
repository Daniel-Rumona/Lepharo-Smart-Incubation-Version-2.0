const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'smeRiskLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

const base = {
    daysSinceLastService: 10,
    hasNeverReceivedService: false,
    docsMissing: 0,
    docsQueried: 0,
    docsRejected: 0,
    missingDepartmentsCount: 0,
    smePendingAcceptanceCount: 0,
    smePendingConfirmationCount: 0,
    declinedTouches: 0
}

test('the original register formula is unchanged when no early-warning signals are given', () => {
    assert.equal(L.computeRiskScore(base).score, 15)
    assert.equal(L.computeRiskScore({ ...base, daysSinceLastService: 200 }).score, 80)
    assert.equal(L.computeRiskScore({ ...base, hasNeverReceivedService: true, docsMissing: 5 }).score, 97)
    // Three items waiting on the SME lift the score to the 85 floor.
    assert.equal(L.computeRiskScore({ ...base, smePendingAcceptanceCount: 2, smePendingConfirmationCount: 1 }).score, 85)
    assert.equal(L.computeRiskScore({ ...base, declinedTouches: 2 }).score, 23)
    assert.equal(L.computeRiskScore({ ...base, daysSinceLastService: 400, docsMissing: 9, docsRejected: 9 }).score, 100)
})

test('early-warning signals add capped points with plain reasons', () => {
    const result = L.computeRiskScore({ ...base, missedAppointments: 5, expiredComplianceDocs: 1, emailBounced: true })
    assert.equal(result.score, 15 + 18 + 5 + 6)
    assert.equal(result.level, 'Medium')
    assert.ok(result.breakdown.some(item => item.label === 'Missed 5 appointments in the last 90 days'))
    assert.ok(result.breakdown.some(item => item.label === '1 compliance document expired'))
})

test('revenue drop penalty steps up for a severe fall', () => {
    assert.equal(L.computeRiskScore({ ...base, revenueDropPercent: 20 }).score, 15)
    assert.equal(L.computeRiskScore({ ...base, revenueDropPercent: 30 }).score, 25)
    assert.equal(L.computeRiskScore({ ...base, revenueDropPercent: 60 }).score, 30)
})

test('revenueDropPercent compares the last three months with the three before', () => {
    const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
    const rows = months.map((month, i) => ({ month, revenue: i < 3 ? 100 : 50 }))
    assert.equal(L.revenueDropPercent(rows), 50)
    assert.equal(L.revenueDropPercent(rows.slice(0, 3)), null)
    assert.equal(L.revenueDropPercent(months.map(month => ({ month, revenue: 100 }))), 0)
})

test('alerts fire only on a move up into High or Critical', () => {
    assert.equal(L.shouldAlert(null, 'High'), true)
    assert.equal(L.shouldAlert('Medium', 'High'), true)
    assert.equal(L.shouldAlert('High', 'Critical'), true)
    assert.equal(L.shouldAlert('High', 'High'), false)
    assert.equal(L.shouldAlert('Critical', 'High'), false)
    assert.equal(L.shouldAlert(null, 'Medium'), false)
})

test('trend needs a five point move', () => {
    assert.equal(L.riskTrend(undefined, 40), 'new')
    assert.equal(L.riskTrend(40, 44), 'same')
    assert.equal(L.riskTrend(40, 45), 'up')
    assert.equal(L.riskTrend(40, 35), 'down')
})

test('the suggestion follows the biggest driver beyond the inactivity baseline', () => {
    const result = L.computeRiskScore({ ...base, daysSinceLastService: 100, expiredComplianceDocs: 3, missedAppointments: 1 })
    const suggestion = L.suggestNextStep(result)
    assert.equal(suggestion.driver, 'expired')
    assert.equal(suggestion.departmentRole, 'financialCompliance')
    assert.equal(L.suggestNextStep(L.computeRiskScore(base)), null)
})

test('deriveRiskInputs reads service dates, waiting items, overdue work and missed sessions', () => {
    const now = Date.UTC(2026, 9, 28)
    const days = (n) => new Date(now - n * 86400000)
    const inputs = L.deriveRiskInputs({
        assignments: [
            { assigneeCompletedAt: days(40), assigneeCompletionStatus: 'done', participantCompletionStatus: 'pending', participantAcceptanceStatus: 'accepted' },
            { participantAcceptanceStatus: 'pending', dueDate: days(5) },
            { participantAcceptanceStatus: 'declined', assignmentStatus: 'cancelled' },
            { participantAcceptanceStatus: 'accepted', feedback: { rating: 1 }, completedAt: days(10), assigneeCompletionStatus: 'done', participantCompletionStatus: 'confirmed' }
        ],
        appointments: [
            { startAt: days(20), attendance: { status: 'absent' } },
            { startAt: days(30), smeConfirmation: 'declined' },
            { startAt: days(200), attendance: { status: 'absent' } }
        ],
        monthlyRevenue: [],
        followUps: [{ dueAt: days(3), status: 'due' }, { dueAt: days(3), answer: 'yes' }],
        openQueries: 2,
        emailBounced: false,
        compliance: { missing: 1, queried: 0, rejected: 0, expired: 2 }
    }, now)
    assert.equal(inputs.daysSinceLastService, 10)
    assert.equal(inputs.hasNeverReceivedService, false)
    assert.equal(inputs.smePendingAcceptanceCount, 1)
    assert.equal(inputs.smePendingConfirmationCount, 1)
    assert.equal(inputs.declinedTouches, 1)
    assert.equal(inputs.overdueInterventions, 1)
    assert.equal(inputs.missedAppointments, 1)
    assert.equal(inputs.declinedAppointments, 1)
    assert.equal(inputs.overdueFollowUps, 1)
    assert.equal(inputs.poorFeedbackCount, 1)
    assert.equal(inputs.expiredComplianceDocs, 2)
})

test('an SME with work assigned but nothing delivered has never been serviced', () => {
    const inputs = L.deriveRiskInputs({
        assignments: [{ participantAcceptanceStatus: 'accepted' }],
        appointments: [], monthlyRevenue: [], followUps: [], openQueries: 0, emailBounced: false,
        compliance: { missing: 0, queried: 0, rejected: 0, expired: 0 }
    }, Date.now())
    assert.equal(inputs.hasNeverReceivedService, true)
    assert.equal(inputs.daysSinceLastService, null)
})

test('inactivity is counted in missed cycles of the SME own schedule', () => {
    // Without a schedule the original 30/90/180-day bands are unchanged.
    for (const [days, score] of [[29, 15], [30, 45], [89, 45], [90, 65], [179, 65], [180, 80]]) {
        assert.equal(L.computeRiskScore({ ...base, daysSinceLastService: days }).score, score, `${days} days`)
        assert.equal(L.computeRiskScore({ ...base, daysSinceLastService: days, expectedServiceIntervalDays: null }).score, score)
    }
    // Weekly support: 1, 3 and 6 missed weeks.
    const weekly = (days) => L.computeRiskScore({ ...base, daysSinceLastService: days, expectedServiceIntervalDays: 7 })
    assert.deepEqual([6, 7, 21, 42].map(d => weekly(d).score), [15, 45, 65, 80])
    assert.equal(weekly(21).breakdown[0].label, 'No service for 3 scheduled cycles (expected every 7 days)')
    // A monthly schedule gives the same score as no schedule, with a schedule label.
    assert.equal(L.computeRiskScore({ ...base, daysSinceLastService: 95, expectedServiceIntervalDays: 30 }).score, 65)
    // Never serviced and unknown dates are unaffected.
    assert.equal(L.computeRiskScore({ ...base, hasNeverReceivedService: true, expectedServiceIntervalDays: 7 }).score, 85)
})

test('the expected interval is the shortest recent recurring assignment', () => {
    const now = Date.parse('2026-11-01T00:00:00Z')
    const day = 24 * 60 * 60 * 1000
    const at = (daysAgo) => new Date(now - daysAgo * day).toISOString()
    const row = (recurrence, patch = {}) => ({ scheduleMode: 'recurring', recurrence, assignedAt: at(10), interventionId: 'iv', ...patch })
    assert.equal(L.expectedServiceIntervalDays([row({ every: 1, unit: 'month', strict: false }), row({ every: 2, unit: 'week' })], now), 14)
    assert.equal(L.expectedServiceIntervalDays([row({ every: 1, unit: 'weeks' })], now), 7)
    assert.equal(L.expectedServiceIntervalDays([row(null, { scheduleMode: 'ad-hoc' }), row(null, { scheduleMode: 'once-off' })], now), null)
    assert.equal(L.expectedServiceIntervalDays([row({ every: 1, unit: 'week' }, { scheduleMode: 'ad-hoc' })], now), null)
    assert.equal(L.expectedServiceIntervalDays([row({ every: 1, unit: 'week' }, { assignedAt: at(200) })], now), null)
    assert.equal(L.expectedServiceIntervalDays([row({ every: 1, unit: 'week' }, { assignmentStatus: 'cancelled' })], now), null)
    assert.equal(L.expectedServiceIntervalDays([row({ every: 1, unit: 'week' }, { supportClosedAt: at(1) })], now), null)
    assert.equal(L.expectedServiceIntervalDays([row({ every: 1, unit: 'week' })], now, new Set(['iv'])), null)
})

test('department coverage counts departments still needing follow-up', () => {
    const departmentsById = { legal: { interventionsDepartment: true }, finance: { interventionsDepartment: true }, hr: { interventionsDepartment: false } }
    const plan = {
        interventions: [
            { id: 'contracts', departmentId: 'legal' }, { id: 'tax', departmentId: 'finance' },
            { id: 'payroll', departmentId: 'hr' }, { id: 'closed-one', departmentId: 'finance' }
        ],
        confirmedByDeptId: { legal: true, finance: { confirmed: true } },
        smmeConfirmedByDeptId: { legal: { confirmed: true } },
        incubateeDepartmentConfirmationsByDeptId: { finance: true }
    }
    const assignments = [{ departmentId: 'legal', interventionId: 'contracts' }]
    // Legal: confirmed both ways and serviced. Finance: confirmed, nothing assigned. HR: not an intervention department.
    assert.deepEqual(L.departmentCoverage({ plan, departmentsById }, assignments), { expected: 2, missing: 1, fullyConfirmed: 2, awaitingSme: 0, staffDelays: 1 })
    // Closing finance's only open intervention removes it from what's expected.
    const closed = new Set(['tax', 'closed-one'])
    assert.deepEqual(L.departmentCoverage({ plan, departmentsById, closedInterventionIds: closed }, assignments), { expected: 1, missing: 0, fullyConfirmed: 1, awaitingSme: 0, staffDelays: 0 })
    assert.deepEqual(L.departmentCoverage({ plan: null, departmentsById }, assignments), { expected: 0, missing: 0, fullyConfirmed: 0, awaitingSme: 0, staffDelays: 0 })
})

test('deriveRiskInputs uses coverage and a service time known from elsewhere', () => {
    const now = Date.parse('2026-11-01T00:00:00Z'), day = 86400000
    const empty = { assignments: [], appointments: [], monthlyRevenue: [], followUps: [], openQueries: 0, emailBounced: false, compliance: { missing: 0, queried: 0, rejected: 0, expired: 0 } }
    const plan = { interventions: [{ id: 'a', departmentId: 'legal' }], confirmedByDeptId: { legal: true }, smmeConfirmedByDeptId: { legal: true } }
    const coverage = { plan, departmentsById: { legal: { interventionsDepartment: true } } }
    const confirmedNothingAssigned = L.deriveRiskInputs({ ...empty, coverage }, now)
    // Confirmed both ways but nothing assigned is the department's delay, not the SME's risk.
    assert.equal(confirmedNothingAssigned.missingDepartmentsCount, 0)
    assert.equal(confirmedNothingAssigned.staffDelayDepartments, 1)
    // Nothing assigned: waiting on the department, not "never serviced".
    assert.equal(confirmedNothingAssigned.hasNeverReceivedService, false)
    assert.equal(confirmedNothingAssigned.waitingOnStaff, true)
    const scored = L.computeRiskScore(confirmedNothingAssigned)
    assert.equal(scored.score, 15)
    assert.equal(scored.breakdown[0].label, 'No support assigned yet: waiting on 1 department')
    // Once something is assigned but not delivered, it is never serviced again.
    const assignedNotDelivered = L.deriveRiskInputs({ ...empty, coverage, assignments: [{ departmentId: 'legal', interventionId: 'a' }] }, now)
    assert.equal(assignedNotDelivered.hasNeverReceivedService, true)
    assert.equal(assignedNotDelivered.waitingOnStaff, false)
    assert.equal(L.deriveRiskInputs(empty, now).hasNeverReceivedService, false)
    const known = L.deriveRiskInputs({ ...empty, coverage, knownServiceAt: now - 10 * day }, now)
    assert.equal(known.daysSinceLastService, 10)
    assert.equal(known.lastServiceAt, now - 10 * day)
    assert.equal(known.hasNeverReceivedService, false)
})

test('a new SME gets a grace period for its first service', () => {
    const unserved = { ...base, daysSinceLastService: null }
    assert.equal(L.computeRiskScore({ ...unserved, daysSinceJoined: 5 }).score, 15)
    assert.equal(L.computeRiskScore({ ...unserved, daysSinceJoined: 5 }).breakdown[0].label, 'New SME: joined 5 days ago, first service not yet due')
    assert.equal(L.computeRiskScore({ ...unserved, hasNeverReceivedService: true, daysSinceJoined: 29 }).score, 15)
    // After 30 days, or without a join date, the old rules apply.
    assert.equal(L.computeRiskScore({ ...unserved, daysSinceJoined: 30 }).score, 70)
    assert.equal(L.computeRiskScore({ ...unserved, hasNeverReceivedService: true, daysSinceJoined: 45 }).score, 85)
    assert.equal(L.computeRiskScore(unserved).score, 70)
    // Other signals still add on top, and a serviced SME is unaffected.
    assert.equal(L.computeRiskScore({ ...unserved, daysSinceJoined: 5, docsMissing: 2 }).score, 23)
    assert.equal(L.computeRiskScore({ ...base, daysSinceLastService: 40, daysSinceJoined: 5 }).score, 45)
})

test('join date comes from the application first, then the participant', () => {
    const at = '2026-10-01T00:00:00Z', t = Date.parse(at)
    assert.equal(L.smeJoinedAt({ acceptedAt: at, createdAt: '2025-01-01' }, null), t)
    assert.equal(L.smeJoinedAt({}, { createdAt: { seconds: t / 1000 } }), t)
    assert.equal(L.smeJoinedAt({}, {}), null)
    const now = Date.parse('2026-10-11T00:00:00Z')
    const empty = { assignments: [], appointments: [], monthlyRevenue: [], followUps: [], openQueries: 0, emailBounced: false, compliance: { missing: 0, queried: 0, rejected: 0, expired: 0 } }
    assert.equal(L.deriveRiskInputs({ ...empty, joinedAt: t }, now).daysSinceJoined, 10)
})

test('only plans waiting on the SME count against the SME', () => {
    const departmentsById = { a: { interventionsDepartment: true }, b: { interventionsDepartment: true }, c: { interventionsDepartment: true } }
    const plan = {
        interventions: [{ id: '1', departmentId: 'a' }, { id: '2', departmentId: 'b' }, { id: '3', departmentId: 'c' }],
        confirmedByDeptId: { a: true, b: true },     // c: the department hasn't confirmed
        smmeConfirmedByDeptId: { b: true }           // a: waiting on the SME
    }
    const cov = L.departmentCoverage({ plan, departmentsById }, [{ departmentId: 'b' }])
    assert.equal(cov.awaitingSme, 1)
    assert.equal(cov.staffDelays, 1)
    assert.equal(cov.missing, 2)
    const scored = L.computeRiskScore({ ...base, missingDepartmentsCount: cov.awaitingSme, staffDelayDepartments: cov.staffDelays })
    assert.equal(scored.score, 20)
    assert.equal(scored.breakdown[1].label, '1 department plan awaiting SME confirmation')
})
