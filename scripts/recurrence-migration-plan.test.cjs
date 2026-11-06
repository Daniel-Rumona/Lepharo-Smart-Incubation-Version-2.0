const assert = require('node:assert/strict')
const test = require('node:test')
const { planDefinition, planAssignment, planPlanCopies, readSchedule } = require('./recurrence-migration-plan.cjs')

const month = { every: 1, unit: 'month' }
const week = { every: 1, unit: 'week' }

// The combinations found in the test project (2026-10-31).
test('editor recurring definition keeps its interval and strictness, old fields go', () => {
    const plan = planDefinition({
        frequency: 'monthly', recurrenceFrequency: 'monthly', recurrencePreset: 'monthly', recurrence: month,
        recurring: true, recurrenceStrict: false, assignmentMode: 'recurring'
    })
    assert.deepEqual(plan.set, { scheduleMode: 'recurring', recurrence: { ...month, strict: false } })
    assert.deepEqual(plan.remove, ['recurring', 'assignmentMode', 'recurrencePreset', 'recurrenceStrict', 'frequency', 'recurrenceFrequency'])
})

test('editor as-needed definition becomes ad-hoc', () => {
    const plan = planDefinition({ frequency: 'as-needed', recurrenceFrequency: 'other', recurrencePreset: null, recurrence: null, recurring: false, assignmentMode: 'ad-hoc', recurrenceStrict: null })
    assert.deepEqual(plan.set, { scheduleMode: 'ad-hoc' })
    assert.equal(plan.action, 'update')
})

test('seeded once-off stays once-off', () => {
    const plan = planDefinition({ assignmentMode: 'once-off', recurring: false, recurrencePreset: 'as-needed', recurrence: null, recurrenceStrict: false, frequency: 'as-needed', recurrenceFrequency: 'other' })
    assert.deepEqual(plan.set, { scheduleMode: 'once-off' })
})

test('nothing stated becomes an explicit once-off', () => {
    const plan = planDefinition({ interventionTitle: 'x' })
    assert.deepEqual(plan, { action: 'update', set: { scheduleMode: 'once-off', recurrence: null }, remove: [], defaulted: true })
    assert.equal(planDefinition({ recurring: false }).set.scheduleMode, 'once-off')
})

test('missing strict on a recurring definition means every cycle', () => {
    assert.deepEqual(planDefinition({ recurrence: week, assignmentMode: 'recurring' }).set.recurrence, { ...week, strict: true })
})

test('a definition already in the target shape plans nothing, so a re-run is empty', () => {
    assert.deepEqual(planDefinition({ scheduleMode: 'recurring', recurrence: { ...month, strict: true } }), { action: 'none' })
    assert.deepEqual(planDefinition({ scheduleMode: 'ad-hoc', recurrence: null }), { action: 'none' })
    const first = planDefinition({ assignmentMode: 'once-off', frequency: 'as-needed' })
    const migrated = { scheduleMode: first.set.scheduleMode, recurrence: null }
    assert.deepEqual(planDefinition(migrated), { action: 'none' })
})

test('disagreeing fields are reported, not guessed', () => {
    assert.equal(planDefinition({ frequency: 'weekly', recurrence: month }).action, 'review')
    assert.equal(planDefinition({ recurring: false, recurrence: month }).action, 'review')
    assert.equal(planDefinition({ assignmentMode: 'ad-hoc', recurrencePreset: 'weekly' }).action, 'review')
    assert.equal(planDefinition({ recurrence: { ...month, strict: true }, recurrenceStrict: false }).action, 'review')
    assert.match(planDefinition({ frequency: 'sometimes' }).problems[0], /unknown value in frequency/)
})

test('intervals the screens do not offer are reported', () => {
    assert.match(planDefinition({ frequency: 'quarterly' }).problems[0], /every 1 quarter/)
    assert.equal(planDefinition({ recurrence: { every: 1, unit: 'year' } }).action, 'review')
})

test('assignments keep their own schedule and normalise the interval', () => {
    assert.deepEqual(planAssignment({ scheduleMode: 'recurring', recurrence: { ...month, strict: true } }, null), { action: 'none' })
    const plan = planAssignment({ scheduleMode: 'recurring', recurrence: { interval: 2, unit: 'weeks' } }, null)
    assert.deepEqual(plan.set, { recurrence: { every: 2, unit: 'week', strict: false } })
    const adhoc = planAssignment({ scheduleMode: 'ad-hoc', recurrence: null, recurring: false, recurrencePreset: null })
    assert.deepEqual(adhoc, { action: 'update', set: {}, remove: ['recurring', 'recurrencePreset'], defaulted: false })
})

test('an assignment that states no schedule is reported, never given its definition', () => {
    assert.deepEqual(planAssignment({ recurrence: null }), { action: 'review', problems: ['states no schedule'] })
    assert.deepEqual(planAssignment({ scheduleMode: 'recurring', recurrence: month }).set, { recurrence: { ...month, strict: false } })
})

test('plan copies lose schedule fields and keep everything else', () => {
    const plan = planPlanCopies([
        { id: 'a', title: 'A', scheduleMode: 'ad-hoc', recurrence: null, frequency: 'as-needed', compulsory: true },
        { id: 'b', title: 'B' }
    ])
    assert.equal(plan.stripped, 1)
    assert.deepEqual(plan.interventions, [{ id: 'a', title: 'A', compulsory: true }, { id: 'b', title: 'B' }])
    assert.deepEqual(planPlanCopies([{ id: 'b' }]), { action: 'none' })
})

test('what is written reads back as what was read before', () => {
    for (const record of [
        { assignmentMode: 'recurring', recurrencePreset: 'bi-weekly', recurrence: { every: 2, unit: 'week' }, recurrenceStrict: true },
        { assignmentMode: 'ad-hoc', frequency: 'as-needed', recurrenceFrequency: 'other' },
        { frequency: 'weekly' }
    ]) {
        const before = readSchedule(record)
        const plan = planDefinition(record)
        const after = { ...record, ...plan.set }
        for (const field of plan.remove) delete after[field]
        const read = readSchedule(after)
        assert.equal(read.scheduleMode, before.scheduleMode)
        assert.deepEqual(read.recurrence, before.recurrence)
    }
})
