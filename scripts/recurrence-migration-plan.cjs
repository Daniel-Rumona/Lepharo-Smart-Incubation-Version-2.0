// Pure planning for scripts/migrate-intervention-recurrence.cjs: given one
// stored record, work out the patch that leaves only the target schedule shape
// (scheduleMode + recurrence {every, unit, strict}). No Firestore access here,
// so it can be tested with plain fixtures (recurrence-migration-plan.test.cjs).
//
// Phase 3 of docs/intervention-recurrence-consolidation-plan.md. Records are
// read with src/lib/recurrence.ts itself, so the migration writes exactly what
// the app already reads. Nothing is guessed: a record whose fields disagree,
// that holds a value the app doesn't know, or that uses an interval the
// screens don't offer (day, quarter, year) is reported and left alone.
// Values already in the target shape are left as they are, so a re-run plans
// nothing new.

const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const LIB = path.join(__dirname, '..', 'src', 'lib', 'recurrence.ts')
const lib = new Module(LIB, module)
lib.paths = module.paths
lib._compile(ts.transpileModule(fs.readFileSync(LIB, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText, LIB)
const { readSchedule, storedStrict, LEGACY_SCHEDULE_FIELDS } = lib.exports

const OFFERED_UNITS = new Set(['week', 'month'])
const MODE_FIELDS = ['scheduleMode', 'assignmentMode', 'interventionMode', 'deliveryScheduleType']
const WORD_FIELDS = ['recurrencePreset', 'frequency', 'recurrenceFrequency']
// Words that mean "no answer" rather than a frequency.
const NO_ANSWER = new Set(['', 'other', 'custom', 'none', 'null'])

const lower = (v) => String(v ?? '').trim().toLowerCase()
const intervalKey = (rec) => (rec ? `${rec.every}/${rec.unit}` : null)

/** What each field on its own says: recurring at an interval, or not recurring. */
function claimsOf(record) {
    const claims = []
    const unknown = []
    for (const field of MODE_FIELDS) {
        if (!lower(record[field])) continue
        // A bare 'recurring' mode says nothing about the interval.
        if (lower(record[field]).replace(/[s_]/g, '-') === 'recurring') {
            claims.push({ field, recurring: true, interval: null })
            continue
        }
        const s = readSchedule({ [field]: record[field] })
        if (s.source === 'default') unknown.push(field)
        else claims.push({ field, recurring: false, interval: null })
    }
    if (record.recurrence && typeof record.recurrence === 'object') {
        const s = readSchedule({ recurrence: record.recurrence })
        if (s.source === 'default') unknown.push('recurrence')
        else claims.push({ field: 'recurrence', recurring: true, interval: intervalKey(s.recurrence) })
    }
    for (const field of WORD_FIELDS) {
        if (NO_ANSWER.has(lower(record[field]))) continue
        const s = readSchedule({ [field]: record[field] })
        if (s.source === 'default') unknown.push(field)
        else claims.push({ field, recurring: s.scheduleMode === 'recurring', interval: intervalKey(s.recurrence) })
    }
    if (typeof record.recurring === 'boolean') claims.push({ field: 'recurring', recurring: record.recurring, interval: null })
    return { claims, unknown }
}

function problemsOf(record) {
    const { claims, unknown } = claimsOf(record)
    const problems = unknown.map((field) => `unknown value in ${field}`)
    const recurringSays = new Set(claims.map((c) => c.recurring))
    if (recurringSays.size > 1) {
        problems.push(`recurring and not recurring: ${claims.map((c) => `${c.field}=${c.recurring ? 'recurring' : 'not'}`).join(', ')}`)
    }
    const intervals = new Set(claims.map((c) => c.interval).filter(Boolean))
    if (intervals.size > 1) problems.push(`different intervals: ${[...intervals].join(' vs ')}`)
    const strictValues = [record.recurrence?.strict, record.recurrenceStrict].filter((v) => typeof v === 'boolean')
    if (new Set(strictValues).size > 1 && readSchedule(record).scheduleMode === 'recurring') {
        problems.push('recurrence.strict and recurrenceStrict disagree')
    }
    return problems
}

const sameRecurrence = (a, b) =>
    (a == null && b == null) ||
    (!!a && !!b && a.every === b.every && a.unit === b.unit && a.strict === b.strict && Object.keys(a).length === 3)

/**
 * The patch for one record: `set` holds the target fields, `remove` the old
 * fields to delete. With `requireStated`, a record that states no schedule is
 * reported instead of defaulting to once-off.
 */
function planRecord(record, { defaultStrict = true, requireStated = false } = {}) {
    const problems = problemsOf(record)
    if (problems.length) return { action: 'review', problems }

    const schedule = readSchedule(record)
    if (schedule.source === 'default' && requireStated) {
        return { action: 'review', problems: ['states no schedule'] }
    }
    if (schedule.scheduleMode === 'recurring' && !OFFERED_UNITS.has(schedule.recurrence.unit)) {
        return { action: 'review', problems: [`interval not offered on screens: every ${schedule.recurrence.every} ${schedule.recurrence.unit}`] }
    }

    const strict = storedStrict(record) ?? defaultStrict
    const target = {
        scheduleMode: schedule.scheduleMode,
        recurrence: schedule.scheduleMode === 'recurring' ? { ...schedule.recurrence, strict } : null
    }

    const set = {}
    if (record.scheduleMode !== target.scheduleMode) set.scheduleMode = target.scheduleMode
    if (!Object.hasOwn(record, 'recurrence') || !sameRecurrence(record.recurrence ?? null, target.recurrence)) {
        set.recurrence = target.recurrence
    }
    const remove = LEGACY_SCHEDULE_FIELDS.filter((field) => Object.hasOwn(record, field))

    if (!Object.keys(set).length && !remove.length) return { action: 'none' }
    return { action: 'update', set, remove, defaulted: schedule.source === 'default' }
}

// Definitions: nothing stated means once-off; a missing strict means every cycle, as the editor shows it.
const planDefinition = (data) => planRecord(data, { defaultStrict: true })

// Assignments: only the assignment's own fields, as the app reads them. A
// missing strict reads as false, as assignedInterventionService already does.
// One that states no schedule is reported: the app's readers disagree on it
// (the service says once-off, the assignments page uses the definition).
const planAssignment = (data) => planRecord(data, { defaultStrict: false, requireStated: true })

const PLAN_COPY_FIELDS = ['scheduleMode', 'recurrence', 'recurrenceEnd', ...LEGACY_SCHEDULE_FIELDS]

/** A plan's copies of definitions lose their schedule fields; the live definition is always read instead. */
function planPlanCopies(interventions) {
    if (!Array.isArray(interventions)) return { action: 'none' }
    let stripped = 0
    const next = interventions.map((item) => {
        if (!item || typeof item !== 'object') return item
        const keys = PLAN_COPY_FIELDS.filter((field) => Object.hasOwn(item, field))
        if (!keys.length) return item
        stripped++
        return Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key)))
    })
    return stripped ? { action: 'update', interventions: next, stripped } : { action: 'none' }
}

module.exports = { planDefinition, planAssignment, planPlanCopies, readSchedule }
