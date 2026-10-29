const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'planRoadmapLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

const now = new Date(2026, 9, 9, 7, 0)
const day = (n) => new Date(2026, 9, 9 + n, 12, 0)

test('reminderStage walks upcoming -> due -> overdue and never repeats a stage', () => {
    assert.equal(L.reminderStage({ dueAt: day(10) }, now), null)
    assert.equal(L.reminderStage({ dueAt: day(5) }, now), 'upcoming')
    assert.equal(L.reminderStage({ dueAt: day(5), lastStage: 'upcoming' }, now), null)
    assert.equal(L.reminderStage({ dueAt: day(0) }, now), 'due')
    assert.equal(L.reminderStage({ dueAt: day(0), lastStage: 'due' }, now), null)
    assert.equal(L.reminderStage({ dueAt: day(-2), lastStage: 'due', lastRemindedAt: day(-4) }, now), 'overdue')
    assert.equal(L.reminderStage({ dueAt: day(-2), lastRemindedAt: day(-1) }, now), null)
    assert.equal(L.reminderStage({ dueAt: day(-2), status: 'done' }, now), null)
    assert.equal(L.reminderStage({ dueAt: null }, now), null)
})

test('milestone escalation fires once after enough overdue nudges', () => {
    assert.equal(L.shouldEscalateMilestone({ dueAt: day(-5), overdueReminders: 2 }, now), false)
    assert.equal(L.shouldEscalateMilestone({ dueAt: day(-5), overdueReminders: 3 }, now), true)
    assert.equal(L.shouldEscalateMilestone({ dueAt: day(-5), overdueReminders: 3, escalatedAt: day(-1) }, now), false)
    assert.equal(L.shouldEscalateMilestone({ dueAt: day(1), overdueReminders: 9 }, now), false)
})

test('monthly check-in and missed-check-in rules', () => {
    assert.equal(L.checkInDue('2026-09', now), true)
    assert.equal(L.checkInDue('2026-10', now), false)
    assert.equal(L.checkInMissed(null, null), false)
    assert.equal(L.checkInMissed(day(-30), null), true)
    assert.equal(L.checkInMissed(day(-30), day(-10)), false)
    assert.equal(L.checkInMissed(day(-30), day(-40)), true)
    assert.equal(L.shouldEscalateMissedCheckIns(2, false), true)
    assert.equal(L.shouldEscalateMissedCheckIns(2, true), false)
    assert.equal(L.shouldEscalateMissedCheckIns(1, false), false)
})

test('nextDueDate clamps month ends and ignores one-offs', () => {
    assert.equal(L.nextDueDate(new Date(2026, 0, 31), 'monthly').getDate(), 28)
    assert.equal(L.nextDueDate(new Date(2026, 10, 30), 'quarterly').getMonth(), 1)
    assert.equal(L.nextDueDate(new Date(2026, 9, 9), 'weekly').getDate(), 16)
    assert.equal(L.nextDueDate(new Date(2026, 9, 9), 'none'), null)
})

test('summarizeProgress counts done, overdue and at-risk', () => {
    const s = L.summarizeProgress([
        { status: 'done', dueAt: day(-5) },
        { status: 'in_progress', dueAt: day(-1) },
        { status: 'at_risk', dueAt: day(4) },
        { status: 'not_started', dueAt: null },
    ], now)
    assert.deepEqual({ ...s }, { total: 4, done: 1, overdue: 1, atRisk: 1, percentDone: 25 })
})
