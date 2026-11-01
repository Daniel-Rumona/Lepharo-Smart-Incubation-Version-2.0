import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear'

dayjs.extend(weekOfYear)

// The one reader for intervention schedules. Definitions and assignments have
// stored recurrence in several generations of fields (assignmentMode,
// recurring, recurrencePreset, frequency, recurrenceFrequency, recurrence);
// readSchedule understands all of them. See
// docs/intervention-recurrence-consolidation-plan.md.

export type ScheduleMode = 'recurring' | 'once-off' | 'ad-hoc'
/** day, quarter and year are only read from older records; the screens offer week and month. */
export type RecurrenceUnit = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type Recurrence = { every: number; unit: RecurrenceUnit }
export type SchedulePreset = 'as-needed' | 'weekly' | 'bi-weekly' | 'monthly'

export type Schedule = {
    scheduleMode: ScheduleMode
    /** Set only when scheduleMode is 'recurring'. */
    recurrence: Recurrence | null
    /** Whether every cycle is expected; null when the record doesn't say. */
    strict: boolean | null
    /** 'default' when no record said anything, which reads as once-off. */
    source: 'stored' | 'default'
}

type ScheduleRecord = Record<string, any> | null | undefined

const RECURRENCE_UNITS: RecurrenceUnit[] = ['day', 'week', 'month', 'quarter', 'year']

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()

const modeFromWord = (value: unknown): ScheduleMode | null => {
    const mode = lower(value).replace(/[\s_]/g, '-')
    if (['once-off', 'onceoff', 'once'].includes(mode)) return 'once-off'
    if (['ad-hoc', 'adhoc'].includes(mode)) return 'ad-hoc'
    if (mode === 'recurring') return 'recurring'
    return null
}

const recurrenceFromObject = (value: any): Recurrence | null => {
    if (!value || typeof value !== 'object') return null
    const unit = lower(value.unit).replace(/s$/, '') as RecurrenceUnit
    if (!RECURRENCE_UNITS.includes(unit)) return null
    const every = Number(value.every ?? value.interval ?? 1)
    return { every: Number.isFinite(every) && every > 0 ? every : 1, unit }
}

/** A frequency word: null recurrence means "not recurring", undefined means "not a frequency". */
const recurrenceFromWord = (value: unknown): Recurrence | null | undefined => {
    const word = lower(value)
    if (['as-needed', 'as needed', 'ad-hoc', 'ad hoc', 'once-off', 'once off', 'once'].includes(word)) return null
    if (word === 'weekly') return { every: 1, unit: 'week' }
    if (['bi-weekly', 'biweekly', 'fortnightly', 'every two weeks'].includes(word)) return { every: 2, unit: 'week' }
    if (['monthly', 'once a month'].includes(word)) return { every: 1, unit: 'month' }
    if (word === 'quarterly') return { every: 1, unit: 'quarter' }
    if (word === 'yearly' || word === 'annually') return { every: 1, unit: 'year' }
    return undefined
}

/** Whether every cycle is expected, from the first record that says; null when none does. */
export function storedStrict(...records: ScheduleRecord[]): boolean | null {
    for (const record of records) {
        if (typeof record?.recurrence?.strict === 'boolean') return record.recurrence.strict
        if (typeof record?.recurrenceStrict === 'boolean') return record.recurrenceStrict
    }
    return null
}

const fromRecord = (record: Record<string, any>): Omit<Schedule, 'source'> | null => {
    const strict = storedStrict(record)
    const mode = modeFromWord(
        record.scheduleMode || record.assignmentMode || record.interventionMode || record.deliveryScheduleType
    )
    if (mode === 'once-off' || mode === 'ad-hoc') return { scheduleMode: mode, recurrence: null, strict }

    const stored = recurrenceFromObject(record.recurrence)
    if (stored) return { scheduleMode: 'recurring', recurrence: stored, strict }

    // Each word is tried on its own: the editor saves as-needed with
    // recurrenceFrequency 'other', which must not hide frequency 'as-needed'.
    for (const value of [record.recurrencePreset, record.frequency, record.recurrenceFrequency]) {
        const recurrence = recurrenceFromWord(value)
        if (recurrence === undefined) continue
        return recurrence
            ? { scheduleMode: 'recurring', recurrence, strict }
            : { scheduleMode: 'once-off', recurrence: null, strict }
    }

    return null
}

/** The schedule from the first record that states one, e.g. readSchedule(assignment, definition). */
export function readSchedule(...records: ScheduleRecord[]): Schedule {
    for (const record of records) {
        if (!record) continue
        const schedule = fromRecord(record)
        if (schedule) return { ...schedule, source: 'stored' }
    }

    return { scheduleMode: 'once-off', recurrence: null, strict: null, source: 'default' }
}

export function schedulePreset(schedule: Schedule): SchedulePreset | null {
    if (schedule.scheduleMode !== 'recurring') return 'as-needed'
    const { every, unit } = schedule.recurrence || {}
    if (unit === 'week' && every === 1) return 'weekly'
    if (unit === 'week' && every === 2) return 'bi-weekly'
    if (unit === 'month' && every === 1) return 'monthly'
    return null
}

/** The preset the records state, or null when none is stored or it isn't one the screens offer. */
export function presetFrom(...records: ScheduleRecord[]): SchedulePreset | null {
    const schedule = readSchedule(...records)
    return schedule.source === 'stored' ? schedulePreset(schedule) : null
}

export function presetRecurrence(preset: SchedulePreset | string | null | undefined): Recurrence | null {
    return recurrenceFromWord(preset) || null
}

/** Older schedule fields. Writers remove them; readSchedule still reads them on records not yet migrated. */
export const LEGACY_SCHEDULE_FIELDS = [
    'recurring',
    'assignmentMode',
    'recurrencePreset',
    'recurrenceStrict',
    'frequency',
    'recurrenceFrequency'
] as const

export type StoredRecurrence = Recurrence & { strict: boolean }

/**
 * The only shape writers store: scheduleMode plus recurrence (with strict).
 * As-needed is stored as `nonRecurringMode`: ad-hoc (described each time it's
 * assigned) unless once-off is asked for.
 */
export function scheduleFields(
    preset: SchedulePreset,
    options: { strict?: boolean | null; nonRecurringMode?: 'ad-hoc' | 'once-off' } = {}
): { scheduleMode: ScheduleMode; recurrence: StoredRecurrence | null } {
    const recurrence = preset === 'as-needed' ? null : presetRecurrence(preset)
    if (!recurrence) return { scheduleMode: options.nonRecurringMode || 'ad-hoc', recurrence: null }
    return { scheduleMode: 'recurring', recurrence: { ...recurrence, strict: options.strict ?? true } }
}

/**
 * The page-level summary the assignments screens work with. `recurring` is
 * true only when there is an interval to schedule by.
 */
export function recurrenceMeta(...records: ScheduleRecord[]) {
    const schedule = readSchedule(...records)
    const recurring = schedule.scheduleMode === 'recurring'
    return {
        recurring,
        recurrencePreset: recurring ? schedulePreset(schedule) : null,
        recurrence: schedule.recurrence,
        recurrenceStrict: schedule.strict
    }
}

export function formatRecurrence(rec?: Recurrence | null, empty = '—') {
    if (!rec) return empty
    const unitLabel = `${rec.unit}(s)`
    return rec.every === 1 ? `Every ${unitLabel}` : `Every ${rec.every} ${unitLabel}`
}

// Cycle keys are stored on assignments and compared later, so their format
// must not change without a migration: weeks use dayjs week() with year(),
// and `every` is ignored.
export function toCycleKey(rec: Recurrence | null, due: dayjs.Dayjs) {
    if (!rec) return null
    if (rec.unit === 'day') return due.format('YYYY-MM-DD')
    if (rec.unit === 'week') return `${due.year()}-W${String(due.week()).padStart(2, '0')}`
    if (rec.unit === 'month') return due.format('YYYY-MM')
    // By hand: dayjs' quarter helpers need the quarterOfYear plugin, which the
    // app never registers. month() is 0-indexed, so Jan–Mar lands in Q1.
    if (rec.unit === 'quarter') return `${due.year()}-Q${Math.floor(due.month() / 3) + 1}`
    if (rec.unit === 'year') return `${due.year()}`
    return null
}

export function cycleKeyForMode(mode: ScheduleMode, rec: Recurrence | null, due: dayjs.Dayjs) {
    if (mode === 'recurring' && rec) return toCycleKey(rec, due)
    return due.format('YYYY-MM')
}

/** A sortable rank for cycle keys, so earlier cycles compare reliably. */
export function cycleKeyToRank(unit: RecurrenceUnit, key: string): number | null {
    const k = String(key || '').trim()
    if (!k) return null

    if (unit === 'year') {
        const y = Number(k)
        return Number.isFinite(y) ? y : null
    }
    if (unit === 'quarter') {
        const m = k.match(/^(\d{4})-Q([1-4])$/)
        return m ? Number(m[1]) * 10 + Number(m[2]) : null
    }
    if (unit === 'month') {
        const m = k.match(/^(\d{4})-(\d{2})$/)
        if (!m) return null
        const mm = Number(m[2])
        return mm >= 1 && mm <= 12 ? Number(m[1]) * 100 + mm : null
    }
    if (unit === 'week') {
        const m = k.match(/^(\d{4})-W(\d{2})$/)
        if (!m) return null
        const w = Number(m[2])
        return w >= 1 && w <= 53 ? Number(m[1]) * 100 + w : null
    }
    if (unit === 'day') {
        const m = k.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (!m) return null
        const mm = Number(m[2])
        const dd = Number(m[3])
        return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 ? Number(m[1]) * 10000 + mm * 100 + dd : null
    }
    return null
}
