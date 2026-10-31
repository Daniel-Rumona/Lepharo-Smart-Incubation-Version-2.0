const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

function load(sourcePath) {
    const mod = new Module(sourcePath, module)
    mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, sourcePath)
    return mod.exports
}

const server = load(join(__dirname, 'ipmReminderLogic.ts'))
const app = load(join(__dirname, '..', '..', 'src', 'routes', 'operations', 'hr', 'performance', 'ipm.ts'))
const { outstandingActions, cycleNeedsReminders, weekKey, recipientsOf, digestLines } = server

const cycle = { ...app.buildCycle(2026), status: 'active', reminders: true }
const sig = at => ({ uid: 'x', name: 'X', at })

test('the reminder job and the HR dashboard agree on every case', () => {
    const signoffs = [undefined, { manager: sig('2026-04-02') }, { employee: sig('2026-04-02') },
        { manager: sig('2026-04-02'), employee: sig('2026-04-03') }, { manager: sig('2026-04-02'), employee: sig('2026-04-03'), hr: sig('2026-04-04') }]
    const reviews = [undefined, { selfSubmittedAt: 'x' }, { managerSubmittedAt: 'x' }, { managerSubmittedAt: 'x', signoff: { employee: sig('x') } },
        { managerSubmittedAt: 'x', dispute: { reason: 'r' } }, { managerSubmittedAt: 'x', dispute: { reason: 'r', resolution: 'ok' } },
        { signoff: { manager: sig('x'), employee: sig('x') } }, { signoff: { manager: sig('x'), employee: sig('x') }, calibration: { score: 3 } },
        { validation: { by: 'ceo', at: 'x' } }]
    const days = ['2026-03-01', '2026-03-20', '2026-04-20', '2026-05-30', '2026-08-26', '2026-09-10', '2026-10-15', '2027-02-25', '2027-03-10', '2027-04-20', '2027-05-10']
    const checkIns = [[], ['2026-05-25'], ['2026-09-05', '2027-03-05']]
    let cases = 0
    for (const today of days) for (const signoff of signoffs) for (const midYear of reviews) for (const yearEnd of [undefined, reviews[2], reviews[7]])
        for (const checkInDates of checkIns) for (const lineManagerId of ['m', null]) {
            const state = { uid: 'e', lineManagerId, compact: signoff ? { signoff } : null, checkInDates, reviews: { midYear, yearEnd } }
            for (const status of ['active', 'closed']) {
                assert.deepEqual(outstandingActions({ ...cycle, status }, today, state), app.outstandingActions({ ...cycle, status }, today, state), JSON.stringify({ today, state, status }))
                cases++
            }
        }
    assert.ok(cases > 5000)
})

test('reminders run only for switched-on cycles, from compacting to the end of the year-end window', () => {
    assert.equal(cycleNeedsReminders(cycle, '2026-03-14'), false)
    assert.equal(cycleNeedsReminders(cycle, '2026-03-15'), true)
    assert.equal(cycleNeedsReminders(cycle, '2027-04-30'), true)
    assert.equal(cycleNeedsReminders(cycle, '2027-05-01'), false)
    assert.equal(cycleNeedsReminders({ ...cycle, reminders: false }, '2026-06-01'), false)
    assert.equal(cycleNeedsReminders({ ...cycle, reminders: undefined }, '2026-06-01'), false)
    assert.equal(cycleNeedsReminders({ ...cycle, status: 'closed' }, '2026-06-01'), false)
})

test('a week is keyed by its Monday', () => {
    assert.equal(weekKey('2026-11-02'), '2026-11-02')
    assert.equal(weekKey('2026-11-08'), '2026-11-02')
    assert.equal(weekKey('2026-11-09'), '2026-11-09')
})

test('actions go to the employee, their manager, or all of HR / the CEO', () => {
    const people = { hr: ['hr1', 'hr2'], ceo: ['ceo'] }
    assert.deepEqual(recipientsOf({ owner: 'employee', employeeUid: 'e' }, 'm', people), ['e'])
    assert.deepEqual(recipientsOf({ owner: 'manager', employeeUid: 'e' }, 'm', people), ['m'])
    assert.deepEqual(recipientsOf({ owner: 'manager', employeeUid: 'e' }, null, people), [])
    assert.deepEqual(recipientsOf({ owner: 'hr', employeeUid: 'e' }, 'm', people), ['hr1', 'hr2'])
    assert.deepEqual(recipientsOf({ owner: 'ceo', employeeUid: 'e' }, 'm', people), ['ceo'])
})

test('digests name the employee for managers and count reviews for HR and the CEO', () => {
    const names = { e1: 'Thandi', e2: 'Sipho' }
    const lines = digestLines([
        { action: { kind: 'self-assessment', owner: 'employee', employeeUid: 'e1', phase: 'midYear', overdue: true }, recipient: 'e1', cycleLabel: 'FY2026/27' },
        { action: { kind: 'manager-assessment', owner: 'manager', employeeUid: 'e1', phase: 'midYear' }, recipient: 'm', cycleLabel: 'FY2026/27' },
        { action: { kind: 'book-review', owner: 'manager', employeeUid: 'e2', phase: 'yearEnd' }, recipient: 'm', cycleLabel: 'FY2026/27' },
        { action: { kind: 'calibrate', owner: 'hr', employeeUid: 'e1', phase: 'midYear' }, recipient: 'hr', cycleLabel: 'FY2026/27' },
        { action: { kind: 'calibrate', owner: 'hr', employeeUid: 'e2', phase: 'midYear' }, recipient: 'hr', cycleLabel: 'FY2026/27' },
        { action: { kind: 'validate', owner: 'ceo', employeeUid: 'e2', phase: 'midYear' }, recipient: 'ceo', cycleLabel: 'FY2026/27' },
    ], uid => names[uid] || uid)
    assert.deepEqual(lines.get('e1'), [{ text: 'Complete your mid-year review self-assessment', overdue: true, kind: 'self-assessment', phase: 'midYear' }])
    assert.deepEqual(lines.get('m').map(l => l.text), ["Complete Thandi's mid-year review assessment", "Book Sipho's year-end review meeting: the window opens within a week"])
    assert.deepEqual(lines.get('hr').map(l => l.text), ['2 mid-year reviews signed and ready to calibrate (FY2026/27)'])
    assert.deepEqual(lines.get('ceo').map(l => l.text), ['1 mid-year review calibrated and awaiting your validation (FY2026/27)'])
})
