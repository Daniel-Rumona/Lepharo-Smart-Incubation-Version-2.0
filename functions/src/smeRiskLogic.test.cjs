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
