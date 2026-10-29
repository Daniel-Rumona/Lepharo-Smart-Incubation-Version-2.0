import dayjs, { Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { computeKpi } from '@/services/kpiCalculationService'

dayjs.extend(quarterOfYear)

/**
 * The tracker's model: KPI definitions as the tracker reads them, their
 * targets, and how a KPI's progress for a period is worked out and judged.
 */

export type Unit = 'count' | 'ZAR' | 'percent' | 'text'
export type SourceType = 'applications' | 'interventions' | 'metrics'
export type CalculationType = 'count' | 'sum' | 'average' | 'ratio'
export type CountMode = 'records' | 'distinct'
export type TargetPeriodType = 'monthly' | 'quarterly'

type KpiFilter = { field: string; op: '==' | '!=' | 'in'; value: any }
type RatioPartConfig = { calculationType: 'count_records' | 'sum_field' | 'avg_field'; field?: string | null; filters: KpiFilter[] }

export type KpiDef = {
    id: string
    departmentId: string
    department: string
    kpiLabel: string
    unit: Unit
    sourceType: SourceType
    calculationType: CalculationType
    countMode?: CountMode | null
    field?: string | null
    filters?: KpiFilter[]
    interventionIds?: string[]
    numerator?: RatioPartConfig | null
    denominator?: RatioPartConfig | null
    appliesToAllPrograms?: boolean
    programId?: string | null
    trackingMode: 'computed' | 'manual'
    kpiKind: 'numeric' | 'qualitative'
    deliverable?: string | null
    measurementIndicator?: string | null
    reminderCadence?: TargetPeriodType | null
}

export type TargetDoc = {
    id: string
    target: number
    periodKey: string
    periodType: TargetPeriodType
    actual?: number | null
}

export type KpiStatus = 'achieved' | 'on-track' | 'behind' | 'to-update' | 'no-target'

export type KpiRow = {
    def: KpiDef
    /** The period the KPI is judged over: its target's period (a month or a quarter). */
    periodType: TargetPeriodType
    periodKey: string
    targetId: string | null
    target: number | null
    actual: number | null
    /** Share of the target reached, 0–100+. */
    percent: number | null
    /** Share of the period gone by on the viewed day (1 for a finished period). */
    elapsed: number
    /** What the actual should be by now at an even pace (in-progress periods only). */
    expected: number | null
    status: KpiStatus
}

export const STATUS_META: Record<KpiStatus, { label: string; short: string; tone: 'success' | 'info' | 'danger' | 'warning' | 'neutral' }> = {
    achieved: { label: 'Achieved', short: 'Achieved', tone: 'success' },
    'on-track': { label: 'On track', short: 'On track', tone: 'info' },
    behind: { label: 'Behind', short: 'Behind', tone: 'danger' },
    'to-update': { label: 'Needs an update', short: 'To update', tone: 'warning' },
    'no-target': { label: 'No target', short: 'No target', tone: 'neutral' }
}

/** Order for "what needs a look first". */
export const STATUS_ORDER: Record<KpiStatus, number> = { behind: 0, 'to-update': 1, 'no-target': 2, 'on-track': 3, achieved: 4 }

/** Behind pace by more than this share of the expected value counts as behind. */
const PACE_TOLERANCE = 0.8

export const quarterKeyOf = (month: Dayjs) => `${month.year()}-Q${month.quarter()}`

export const periodStart = (periodType: TargetPeriodType, periodKey: string) => {
    if (periodType === 'quarterly') {
        const [year, q] = periodKey.split('-Q')
        return dayjs(`${year}-01-01`).add((Number(q) - 1) * 3, 'month').startOf('month')
    }
    return dayjs(`${periodKey}-01`).startOf('month')
}

export const periodEnd = (periodType: TargetPeriodType, periodKey: string) =>
    periodStart(periodType, periodKey).add(periodType === 'quarterly' ? 2 : 0, 'month').endOf('month')

/** "Q3 2026" / "Nov 2026". */
export const periodLabel = (periodType: TargetPeriodType, periodKey: string) => {
    if (periodType === 'quarterly') {
        const [year, q] = periodKey.split('-Q')
        return `Q${q} ${year}`
    }
    return periodStart(periodType, periodKey).format('MMM YYYY')
}

/** How much of the period has passed, measured at `asOf` (today, or the end of a past month). */
const elapsedShare = (periodType: TargetPeriodType, periodKey: string, asOf: Dayjs) => {
    const start = periodStart(periodType, periodKey)
    const end = periodEnd(periodType, periodKey)
    if (!asOf.isBefore(end)) return 1
    if (asOf.isBefore(start)) return 0
    return Math.min(1, Math.max(0, asOf.diff(start, 'day', true) / end.diff(start, 'day', true)))
}

/** The target covering a month: its own monthly target first, else its quarter's. */
export const targetForMonth = (targets: TargetDoc[], month: Dayjs) =>
    targets.find(t => t.periodType === 'monthly' && t.periodKey === month.format('YYYY-MM'))
    || targets.find(t => t.periodType === 'quarterly' && t.periodKey === quarterKeyOf(month))
    || null

/** The period a KPI with no target yet would be recorded against. */
const defaultPeriod = (def: KpiDef, month: Dayjs): { periodType: TargetPeriodType; periodKey: string } =>
    def.reminderCadence === 'quarterly'
        ? { periodType: 'quarterly', periodKey: quarterKeyOf(month) }
        : { periodType: 'monthly', periodKey: month.format('YYYY-MM') }

const judge = (target: number, actual: number, elapsed: number): { status: KpiStatus; expected: number | null } => {
    if (actual >= target) return { status: 'achieved', expected: null }
    if (elapsed >= 1) return { status: 'behind', expected: null }
    const expected = target * elapsed
    return { status: actual >= expected * PACE_TOLERANCE ? 'on-track' : 'behind', expected }
}

const computeActual = async (def: KpiDef, periodType: TargetPeriodType, periodKey: string, target: number | null) => {
    const result = await computeKpi({
        kpi: {
            id: def.id,
            sourceType: def.sourceType,
            calculationType: def.calculationType,
            field: def.field || null,
            filters: def.filters || [],
            interventionIds: def.interventionIds || [],
            numerator: def.numerator || null,
            denominator: def.denominator || null,
            countMode: (def.countMode || 'records') as CountMode,
            appliesToAllPrograms: !!def.appliesToAllPrograms
        },
        // Each KPI is computed against its own programme, never whichever one is active.
        programId: def.appliesToAllPrograms ? null : def.programId || null,
        isAllPrograms: !!def.appliesToAllPrograms,
        periodType,
        periodKey,
        target
    })
    return result.actual
}

/**
 * A KPI's standing for the viewed month. It is judged over its target's own
 * period, so a quarterly target is compared with the quarter to date rather
 * than one month's figure; an unfinished period is judged against an even pace.
 */
export const computeRow = async (def: KpiDef, targets: TargetDoc[], month: Dayjs): Promise<KpiRow> => {
    const t = targetForMonth(targets, month)
    const { periodType, periodKey } = t || defaultPeriod(def, month)
    // A past month is judged as at its end; the current month as at today.
    const asOf = month.isSame(dayjs(), 'month') ? dayjs() : month.endOf('month')
    const elapsed = elapsedShare(periodType, periodKey, asOf)
    const base = { def, periodType, periodKey, targetId: t?.id ?? null, elapsed, expected: null }

    // Deliverables: done or not done for the period; no separate target step.
    if (def.kpiKind === 'qualitative') {
        const actual = t?.actual ?? null
        return {
            ...base,
            target: 1,
            actual,
            percent: actual == null ? null : actual >= 1 ? 100 : 0,
            status: actual == null ? 'to-update' : actual >= 1 ? 'achieved' : 'behind'
        }
    }

    if (!t || !t.target) {
        let actual: number | null = null
        if (def.trackingMode === 'computed') {
            try {
                actual = await computeActual(def, periodType, periodKey, null)
            } catch (err) {
                console.error(`Failed to compute KPI: ${def.kpiLabel}`, err)
            }
        }
        return { ...base, target: null, actual, percent: null, status: 'no-target' }
    }

    let actual: number | null = null
    if (def.trackingMode === 'manual') {
        actual = t.actual ?? null
    } else {
        try {
            actual = await computeActual(def, periodType, periodKey, t.target)
        } catch (err) {
            console.error(`Failed to compute KPI: ${def.kpiLabel}`, err)
        }
    }
    if (actual == null) return { ...base, target: t.target, actual: null, percent: null, status: 'to-update' }

    const { status, expected } = judge(t.target, actual, elapsed)
    return { ...base, target: t.target, actual, percent: Math.round((actual / t.target) * 100), expected, status }
}

/** Target vs actual for the KPI's last few target periods up to the viewed month. */
export type TrendPoint = { label: string; target: number; actual: number | null }

export const computeTrend = async (def: KpiDef, targets: TargetDoc[], month: Dayjs, count = 6): Promise<TrendPoint[]> => {
    const upTo = month.endOf('month')
    const periods = targets
        .filter(t => t.target && !periodStart(t.periodType, t.periodKey).isAfter(upTo))
        .sort((a, b) => periodStart(a.periodType, a.periodKey).valueOf() - periodStart(b.periodType, b.periodKey).valueOf())
        .slice(-count)
    return Promise.all(periods.map(async t => {
        let actual: number | null = t.actual ?? null
        if (def.kpiKind !== 'qualitative' && def.trackingMode === 'computed') {
            try {
                actual = await computeActual(def, t.periodType, t.periodKey, t.target)
            } catch {
                actual = null
            }
        }
        return { label: periodLabel(t.periodType, t.periodKey), target: t.target, actual }
    }))
}

/** A value in the KPI's unit: R 25 000, 40%, 120. */
export const formatValue = (unit: Unit, value: number | null | undefined) => {
    if (value == null || Number.isNaN(value)) return '—'
    if (unit === 'ZAR') return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
    const n = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 1 }).format(value)
    return unit === 'percent' ? `${n}%` : n
}

export const readDef = (id: string, data: any): KpiDef => ({
    id,
    departmentId: String(data.leadDepartmentId || '').trim(),
    department: String(data.department || '').trim(),
    kpiLabel: String(data.kpiLabel || id),
    unit: (data.unit || 'count') as Unit,
    sourceType: data.sourceType as SourceType,
    calculationType: data.calculationType as CalculationType,
    countMode: (data.countMode || 'records') as CountMode,
    field: data.field || null,
    filters: Array.isArray(data.filters) ? data.filters : [],
    interventionIds: Array.isArray(data.interventionIds) ? data.interventionIds : [],
    numerator: data.numerator || null,
    denominator: data.denominator || null,
    appliesToAllPrograms: !!data.appliesToAllPrograms,
    programId: data.programId || null,
    trackingMode: data.trackingMode === 'manual' ? 'manual' : 'computed',
    kpiKind: data.kpiKind === 'qualitative' ? 'qualitative' : 'numeric',
    deliverable: data.deliverable || null,
    measurementIndicator: data.measurementIndicator || null,
    reminderCadence: data.reminderCadence === 'quarterly' ? 'quarterly' : 'monthly'
})

export const readTarget = (id: string, row: any): TargetDoc & { kpiId: string } => ({
    id,
    kpiId: row.kpiId,
    target: Number(row.target || 0),
    periodKey: row.periodKey,
    periodType: row.periodType as TargetPeriodType,
    actual: row.actual === undefined || row.actual === null ? null : Number(row.actual)
})
