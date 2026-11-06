// Tests the pure certification rules in trainingProgressDomain.ts without a
// build: the TypeScript source is transpiled in memory.
//   node --test functions/src/trainingProgressDomain.test.cjs
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '..')] }))

const source = fs.readFileSync(path.join(__dirname, 'trainingProgressDomain.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
const mod = { exports: {} }
new Function('module', 'exports', 'require', outputText)(mod, mod.exports, require)
const { evaluate, effectiveCertification, missingCompanyDocuments, progressChanged, DEFAULT_CERTIFICATION } = mod.exports

const NOW = '2026-10-27T10:00:00.000Z'
const inv = (over = {}) => ({ planGroup: null, category: null, held: true, attended: true, ...over })
const base = (over = {}) => ({
    rules: {},
    invitations: [],
    categories: [],
    courses: null,
    planTitles: {},
    documentsOk: true,
    documentsMissing: [],
    overridden: false,
    certificateId: null,
    now: NOW,
    ...over,
})

test('a training overrides the global defaults rule by rule', () => {
    const settings = effectiveCertification(
        { enabled: true, rules: { minAttendancePercent: 75, requiredDocuments: true } },
        { awardTo: 'company', rules: { perCategoryMinSessions: 2 } }
    )
    assert.equal(settings.enabled, true)
    assert.equal(settings.awardTo, 'company')
    assert.deepEqual(settings.rules, { minAttendancePercent: 75, requiredDocuments: true, perCategoryMinSessions: 2 })
    assert.deepEqual(settings.signatories, DEFAULT_CERTIFICATION.signatories)
})

test('attendance below the minimum keeps someone in progress; reaching it makes them eligible', () => {
    const rules = { minAttendancePercent: 80 }
    const low = evaluate(base({ rules, invitations: [inv(), inv(), inv({ attended: false }), inv({ attended: false })] }))
    assert.equal(low.attendancePercent, 50)
    assert.equal(low.eligibility.status, 'in_progress')
    assert.match(low.eligibility.missing[0], /80%.*50% so far/)
    const ok = evaluate(base({ rules, invitations: [inv(), inv(), inv(), inv(), inv({ attended: false })] }))
    assert.equal(ok.eligibility.status, 'eligible')
})

test('sessions not yet held do not count against attendance', () => {
    const p = evaluate(base({ rules: { minAttendancePercent: 100 }, invitations: [inv(), inv({ held: false, attended: false })] }))
    assert.equal(p.sessionsInvited, 2)
    assert.equal(p.sessionsHeld, 1)
    assert.equal(p.eligibility.status, 'eligible')
})

test('a required session only applies to people invited to it; any occurrence of a series counts', () => {
    const rules = { requiredPlanSessionIds: ['series_a', 'ps_finance'] }
    const p = evaluate(base({
        rules,
        planTitles: { series_a: 'Bookkeeping' },
        invitations: [inv({ planGroup: 'series_a', attended: false }), inv({ planGroup: 'series_a' })],
    }))
    assert.deepEqual(p.eligibility.met, ['Attend Bookkeeping'])
    assert.equal(p.eligibility.missing.length, 0)
    assert.equal(p.eligibility.status, 'eligible')
})

test('each of the person\'s categories needs its minimum number of attended sessions', () => {
    const p = evaluate(base({
        rules: { perCategoryMinSessions: 2 },
        categories: ['Finance', 'Marketing'],
        invitations: [inv({ category: 'Finance' }), inv({ category: 'Finance' }), inv({ category: 'Marketing' })],
    }))
    assert.deepEqual(p.byCategory, { Finance: { held: 2, attended: 2 }, Marketing: { held: 1, attended: 1 } })
    assert.deepEqual(p.eligibility.missing, ['Attend 2 Marketing sessions (1 so far)'])
})

test('course rules apply only to someone who takes courses', () => {
    const rules = { requiredCourseIds: ['c1'], minAverageScore: 70 }
    const employee = evaluate(base({ rules, invitations: [inv()], courses: null }))
    assert.equal(employee.eligibility.missing.length, 0)
    const director = evaluate(base({ rules, invitations: [inv()], courses: [{ courseId: 'c1', title: 'Cash flow', required: 4, completed: 3, scores: [60] }] }))
    assert.deepEqual(director.courses, { c1: { required: 4, completed: 3, score: 60 } })
    assert.equal(director.eligibility.missing.length, 2)
})

test('a staff override makes someone eligible; an issued certificate makes them certified', () => {
    const rules = { minAttendancePercent: 90 }
    const invitations = [inv({ attended: false })]
    assert.equal(evaluate(base({ rules, invitations, overridden: true })).eligibility.status, 'eligible')
    assert.equal(evaluate(base({ rules, invitations, certificateId: 'cert1' })).eligibility.status, 'certified')
})

test('no rules enabled means not eligible yet rather than eligible by default', () => {
    assert.equal(evaluate(base({ invitations: [] })).eligibility.status, 'not_started')
})

test('company documents are checked against the training list, including older fixed slots', () => {
    assert.deepEqual(missingCompanyDocuments({ documents: [{ label: 'CIPC' }] }, ['CIPC', 'Bank confirmation']), ['Bank confirmation'])
    assert.deepEqual(missingCompanyDocuments({ cvDocument: { url: 'x' } }, ['CV']), [])
})

test('re-evaluating with the same facts is not a change', () => {
    const a = evaluate(base({ invitations: [inv()] }))
    const b = evaluate(base({ invitations: [inv()], now: '2026-11-01T00:00:00.000Z' }))
    assert.equal(progressChanged(a, b), false)
    assert.equal(progressChanged(a, evaluate(base({ invitations: [inv(), inv()] }))), true)
})
