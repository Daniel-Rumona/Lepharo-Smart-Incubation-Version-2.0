const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const ts = require('typescript')

// Load TypeScript (and its ./ipmReminderLogic import) straight from source.
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename)
const { summarise, currentPhase, isRunning } = require('./performanceSummaryLogic.ts')
const app = require(join(__dirname, '..', '..', 'src', 'routes', 'operations', 'hr', 'performance', 'ipm.ts'))

const cycle = { ...app.buildCycle(2026), status: 'active' }
const DIRECTOR = 'ceo'
const signed = (at = '2026-04-20') => ({ uid: 'x', at })
const person = (uid, extra = {}) => ({ uid, name: uid.toUpperCase(), lineManagerId: 'hod', compact: null, checkInDates: [], reviews: {}, ...extra })

test('a cycle runs from compacting until its year-end window closes', () => {
    assert.equal(isRunning(cycle, cycle.windows.compacting.from), true)
    assert.equal(isRunning(cycle, cycle.windows.yearEnd.to), true)
    assert.equal(isRunning({ ...cycle, status: 'closed' }, cycle.windows.midYear.from), false)
    assert.deepEqual(currentPhase(cycle, cycle.windows.midYear.from), { phase: 'midYear', open: true })
    const between = cycle.windows.midYear.to.slice(0, 8) + '28'
    assert.equal(currentPhase(cycle, between > cycle.windows.midYear.to ? between : cycle.windows.midYear.to).phase, 'midYear')
})

test('compacts are counted and the director sees what waits on them', () => {
    const today = cycle.windows.midYear.from
    const agreed = { signoff: { manager: signed(), employee: signed() } }
    const staff = [
        person('a', { compact: agreed, lineManagerId: DIRECTOR, checkInDates: [today], reviews: { midYear: { selfSubmittedAt: 'x' } } }),
        person('b', { compact: { signoff: { manager: signed() } } }),
        person('c', { lineManagerId: null }),
        person('d', { compact: agreed, checkInDates: [today], reviews: { midYear: { selfSubmittedAt: 'x', managerSubmittedAt: 'y', signoff: { manager: signed(), employee: signed() }, calibration: { at: 'z' } } } }),
    ]
    const summary = summarise(cycle, today, staff, DIRECTOR)
    assert.equal(summary.staff, 4)
    assert.equal(summary.noLineManager, 1)
    assert.deepEqual(summary.compacts, { agreed: 2, awaitingSignature: 1, notStarted: 1 })
    assert.equal(summary.reviews.phase, 'midYear')
    assert.equal(summary.reviews.awaitingValidation, 1)
    assert.equal(summary.reviews.notStarted, 2)
    assert.equal(summary.reviews.inProgress, 1)
    const texts = summary.waitingOnYou.map(line => line.text)
    assert.ok(texts.some(t => t.includes('1 mid-year review calibrated and awaiting your validation')), texts.join(' | '))
    assert.ok(texts.some(t => t === "Complete A's mid-year review assessment"), 'the people they line-manage are named: ' + texts.join(' | '))
    assert.ok(!texts.some(t => t.includes("B's")), "someone else's report isn't theirs")
})

test('in the compacting window there are no review counts', () => {
    const summary = summarise(cycle, cycle.windows.compacting.from, [person('a')], DIRECTOR)
    assert.equal(summary.phase, 'compacting')
    assert.equal(summary.reviews, null)
})
