const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'followUpBuckets.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { followUpBucket, countDueFollowUps, dueLabel, rescheduleOptions, nextWorkingMorning } = mod.exports

// Friday 6 November 2026, 14:30.
const now = new Date(2026, 10, 6, 14, 30)
const at = (d, h = 0, m = 0) => new Date(2026, 10, d, h, m)

test('a follow-up due earlier today is Today, not overdue', () => {
    assert.equal(followUpBucket({ status: 'Pending', scheduledDate: at(6, 9) }, now), 'today')
    assert.equal(followUpBucket({ status: 'Pending', scheduledDate: at(6) }, now), 'today')
    // The service marks past ones "Overdue"; the day decides, not that label.
    assert.equal(followUpBucket({ status: 'Overdue', scheduledDate: at(6, 9) }, now), 'today')
})

test('before today is overdue, after today is upcoming', () => {
    assert.equal(followUpBucket({ status: 'Pending', scheduledDate: at(5, 23, 59) }, now), 'overdue')
    assert.equal(followUpBucket({ status: 'Overdue', scheduledDate: at(2) }, now), 'overdue')
    assert.equal(followUpBucket({ status: 'Pending', scheduledDate: at(7) }, now), 'upcoming')
})

test('completed and cancelled are done whatever the date', () => {
    assert.equal(followUpBucket({ status: 'Completed', scheduledDate: at(2) }, now), 'done')
    assert.equal(followUpBucket({ status: 'Cancelled', scheduledDate: at(9) }, now), 'done')
})

test('an open follow-up with no date counts as due today', () => {
    assert.equal(followUpBucket({ status: 'Pending', scheduledDate: undefined }, now), 'today')
})

test('due counts overdue and today, open only', () => {
    const list = [
        { status: 'Pending', scheduledDate: at(3) },
        { status: 'Overdue', scheduledDate: at(6, 8) },
        { status: 'Pending', scheduledDate: at(9) },
        { status: 'Completed', scheduledDate: at(2) }
    ]
    assert.equal(countDueFollowUps(list, now), 2)
})

test('due labels read as days, with a time only when one was set', () => {
    assert.equal(dueLabel(at(5), now), '1 day overdue')
    assert.equal(dueLabel(at(3, 10), now), '3 days overdue')
    assert.equal(dueLabel(at(6), now), 'Today')
    assert.equal(dueLabel(at(6, 10, 5), now), 'Today, 10:05')
    assert.equal(dueLabel(at(7, 9), now), 'Tomorrow, 09:00')
    assert.equal(dueLabel(at(9), now), 'Mon 9 Nov')
    assert.equal(dueLabel(null, now), 'No date set')
})

test('quick reschedule never lands on a weekend, and keeps the time', () => {
    // From Friday 6 Nov: the next working day is Monday 9, a week on is Friday 13.
    const [next, week] = rescheduleOptions(at(4, 11, 15), now)
    assert.deepEqual(next.date, at(9, 11, 15))
    assert.deepEqual(week.date, at(13, 11, 15))
    // From Tuesday 10 Nov: Wednesday 11 and Tuesday 17.
    const fromTuesday = rescheduleOptions(null, at(10, 8))
    assert.deepEqual(fromTuesday.map(o => o.date), [at(11), at(17)])
    // From Saturday 7 Nov: Monday 9, and a week on (Saturday 14) moves to Monday 16.
    const fromSaturday = rescheduleOptions(null, at(7, 8))
    assert.deepEqual(fromSaturday.map(o => o.date), [at(9), at(16)])
})

test('escalated follow-ups get their own tab in reception, and leave its due count', () => {
    const escalated = { status: 'Pending', scheduledDate: at(3), escalatedToUids: ['coord1'] }
    assert.equal(followUpBucket(escalated, now, true), 'escalated')
    // A department coordinator's view keeps sorting by due date.
    assert.equal(followUpBucket(escalated, now), 'overdue')
    // Once done it is done, wherever it was.
    assert.equal(followUpBucket({ ...escalated, status: 'Completed' }, now, true), 'done')
    // Handed back (no one left on it): reception's again.
    assert.equal(followUpBucket({ ...escalated, escalatedToUids: [] }, now, true), 'overdue')
    assert.equal(countDueFollowUps([escalated, { status: 'Pending', scheduledDate: at(6) }], now), 1)
})

test('a new portal inquiry is due at 09:00 on the next working day', () => {
    assert.deepEqual(nextWorkingMorning(now), at(9, 9)) // Friday → Monday
    assert.deepEqual(nextWorkingMorning(at(10, 16)), at(11, 9)) // Tuesday → Wednesday
    assert.deepEqual(nextWorkingMorning(at(7, 10)), at(9, 9)) // Saturday → Monday
})
