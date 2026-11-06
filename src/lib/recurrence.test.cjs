const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const dayjs = require('dayjs')

const filename = path.join(__dirname, 'recurrence.ts')
const loaded = new Module(filename, module)
loaded.paths = module.paths
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText, filename)
const {
    readSchedule, presetFrom, recurrenceMeta, presetRecurrence, formatRecurrence,
    toCycleKey, cycleKeyForMode, cycleKeyToRank
} = loaded.exports

const week = { every: 1, unit: 'week' }
const fortnight = { every: 2, unit: 'week' }
const month = { every: 1, unit: 'month' }

// Every combination found in the test project's definitions and assignments (2026-10-31).
const STORED = [
    ['editor recurring', { frequency: 'monthly', recurrenceFrequency: 'monthly', recurrencePreset: 'monthly', recurrence: month, recurring: true, recurrenceStrict: true, assignmentMode: 'recurring' }, 'recurring', month, true],
    ['wizard recurring, no words', { recurrencePreset: 'bi-weekly', recurrence: fortnight, recurring: true, recurrenceStrict: true }, 'recurring', fortnight, true],
    ['strict inside recurrence', { recurrence: { ...week, strict: false }, assignmentMode: 'recurring' }, 'recurring', week, false],
    ['editor as-needed', { frequency: 'as-needed', recurrenceFrequency: 'other', recurrencePreset: null, recurrence: null, recurring: false, assignmentMode: 'ad-hoc' }, 'ad-hoc', null, null],
    ['as-needed via other, no mode', { frequency: 'as-needed', recurrenceFrequency: 'other', recurrencePreset: null }, 'once-off', null, null],
    ['seeded once-off', { frequency: 'as-needed', recurrenceFrequency: 'other', recurrencePreset: 'as-needed', recurring: false, recurrenceStrict: false, assignmentMode: 'once-off' }, 'once-off', null, false],
    ['mode only', { recurring: false, assignmentMode: 'ad-hoc' }, 'ad-hoc', null, null],
    ['legacy frequency only', { frequency: 'weekly' }, 'recurring', week, null],
    ['legacy recurrenceFrequency only', { recurrenceFrequency: 'biweekly' }, 'recurring', fortnight, null],
    ['quarterly still reads', { frequency: 'quarterly' }, 'recurring', { every: 1, unit: 'quarter' }, null],
    ['assignment v3', { scheduleMode: 'recurring', recurrence: { every: 1, unit: 'months', strict: true } }, 'recurring', month, true],
    ['assignment interval', { scheduleMode: 'recurring', recurrence: { interval: 2, unit: 'week' } }, 'recurring', fortnight, null],
    ['assignment ad-hoc', { scheduleMode: 'ad-hoc', recurrence: null }, 'ad-hoc', null, null]
]

for (const [name, record, mode, recurrence, strict] of STORED) {
    test(`reads ${name}`, () => {
        assert.deepEqual(readSchedule(record), { scheduleMode: mode, recurrence, strict, source: 'stored' })
    })
}

test('nothing stated reads as once-off by default', () => {
    for (const record of [{}, { recurring: false }, { recurring: true }, { recurrenceFrequency: 'other' }, null]) {
        assert.deepEqual(readSchedule(record), { scheduleMode: 'once-off', recurrence: null, strict: null, source: 'default' })
    }
})

test('the first record that states a schedule wins', () => {
    const assignment = { scheduleMode: 'ad-hoc', recurrence: null }
    const definition = { recurrence: week, assignmentMode: 'recurring' }
    assert.equal(readSchedule(assignment, definition).scheduleMode, 'ad-hoc')
    assert.equal(readSchedule({}, definition).scheduleMode, 'recurring')
    assert.equal(readSchedule(definition, assignment).scheduleMode, 'recurring')
})

test('presetFrom gives the four screen presets, or null when unknown or unsupported', () => {
    assert.equal(presetFrom({ recurrence: fortnight }), 'bi-weekly')
    assert.equal(presetFrom({ frequency: 'as-needed', recurrenceFrequency: 'other' }), 'as-needed')
    assert.equal(presetFrom({ assignmentMode: 'once-off' }), 'as-needed')
    assert.equal(presetFrom({ frequency: 'quarterly' }), null)
    assert.equal(presetFrom({ recurring: false }), null)
    assert.equal(presetFrom({}, { recurrencePreset: 'weekly' }), 'weekly')
})

test('recurrenceMeta is recurring only with an interval', () => {
    assert.deepEqual(recurrenceMeta({ recurrence: month, recurrenceStrict: true }), {
        recurring: true, recurrencePreset: 'monthly', recurrence: month, recurrenceStrict: true
    })
    assert.deepEqual(recurrenceMeta({ recurring: true }), {
        recurring: false, recurrencePreset: null, recurrence: null, recurrenceStrict: null
    })
})

test('presetRecurrence and formatRecurrence', () => {
    assert.deepEqual(presetRecurrence('bi-weekly'), fortnight)
    assert.equal(presetRecurrence('as-needed'), null)
    assert.equal(presetRecurrence('custom'), null)
    assert.equal(formatRecurrence(week), 'Every week(s)')
    assert.equal(formatRecurrence(fortnight), 'Every 2 week(s)')
    assert.equal(formatRecurrence(null), '—')
    assert.equal(formatRecurrence(null, ''), '')
})

test('scheduleFields writes only the target shape, and reads back as written', () => {
    const { scheduleFields } = loaded.exports
    assert.deepEqual(scheduleFields('weekly'), { scheduleMode: 'recurring', recurrence: { ...week, strict: true } })
    assert.deepEqual(scheduleFields('bi-weekly', { strict: false }), { scheduleMode: 'recurring', recurrence: { ...fortnight, strict: false } })
    assert.deepEqual(scheduleFields('as-needed'), { scheduleMode: 'ad-hoc', recurrence: null })
    assert.deepEqual(scheduleFields('as-needed', { nonRecurringMode: 'once-off' }), { scheduleMode: 'once-off', recurrence: null })
    for (const [preset, options] of [['monthly', { strict: false }], ['as-needed', { nonRecurringMode: 'once-off' }], ['as-needed', {}]]) {
        const written = scheduleFields(preset, options)
        const read = readSchedule(written)
        assert.equal(read.scheduleMode, written.scheduleMode)
        assert.equal(presetFrom(written), preset)
    }
    // Stale legacy fields left on an edited record never override what was written.
    const edited = { ...scheduleFields('as-needed', { nonRecurringMode: 'once-off' }), assignmentMode: 'recurring', recurrencePreset: 'weekly', recurrenceStrict: true }
    assert.equal(readSchedule(edited).scheduleMode, 'once-off')
    const editedRecurring = { ...scheduleFields('monthly', { strict: false }), assignmentMode: 'ad-hoc', recurrenceStrict: true }
    assert.deepEqual(readSchedule(editedRecurring), { scheduleMode: 'recurring', recurrence: month, strict: false, source: 'stored' })
})

test('cycle keys keep their stored format', () => {
    const due = dayjs('2026-10-31')
    assert.equal(toCycleKey(month, due), '2026-10')
    assert.equal(toCycleKey(week, due), `2026-W${String(due.week()).padStart(2, '0')}`)
    assert.equal(toCycleKey(fortnight, due), toCycleKey(week, due))
    assert.equal(toCycleKey({ every: 1, unit: 'quarter' }, due), '2026-Q4')
    assert.equal(toCycleKey(null, due), null)
    assert.equal(cycleKeyForMode('recurring', week, due), toCycleKey(week, due))
    assert.equal(cycleKeyForMode('recurring', null, due), '2026-10')
    assert.equal(cycleKeyForMode('ad-hoc', week, due), '2026-10')
    assert.equal(cycleKeyForMode('once-off', null, due), '2026-10')
    assert.equal(cycleKeyToRank('month', '2026-10'), 202610)
    assert.equal(cycleKeyToRank('week', '2026-W44'), 202644)
    assert.equal(cycleKeyToRank('month', '2026-13'), null)
})
