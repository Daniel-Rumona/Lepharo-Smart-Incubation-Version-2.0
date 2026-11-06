import dayjs, { type Dayjs } from 'dayjs'
import {
    SOURCE_CONFIGS,
    OP_LABEL,
    buildPeriodKey,
    nextTargetPeriodStart,
    parsePeriodKeyToDayjs,
    targetPeriodHasStarted,
    type CalculationType,
    type CountMode,
    type DisplayKpiType,
    type KPI,
    type KpiFilter,
    type KpiKind,
    type SharedContributorConfig,
    type SharedKpiMode,
    type SourceType,
    type TargetPeriodType,
    type Unit
} from './kpiModel'

/**
 * The KPI builder's working state and everything derived from it: defaults,
 * loading an existing KPI, per-step validation, the unit (worked out from the
 * measurement rather than asked), the live summary and the save payload.
 * Pure functions only — the components and the save service build on these.
 */

export type Ownership = 'department' | 'shared'
export type Scope = 'program' | 'all'
/** Live = computed from platform data; manual = someone records the actual each period. */
export type Tracking = 'live' | 'manual'
/** The builder's calculation choice; mapped to the stored displayKpiType/calculationType on save. */
export type Calc = 'count' | 'total' | 'average' | 'percentage'
export type PartMode = 'count_records' | 'sum_field' | 'avg_field'

export interface RatioDraft {
    mode: PartMode
    field: string | null
    filters: KpiFilter[]
}

export interface KpiDraft {
    kpiLabel: string
    kpiKind: KpiKind

    ownership: Ownership
    /** Owning department's id for a department KPI (stored as `leadDepartmentId`). */
    departmentId: string
    sharedKpiMode: SharedKpiMode
    contributorDepartmentIds: string[]
    leadDepartmentId: string | null
    scope: Scope

    tracking: Tracking
    sourceType: SourceType | null
    interventionIds: string[]
    calc: Calc | null
    countMode: CountMode
    field: string | null
    filters: KpiFilter[]
    numerator: RatioDraft
    denominator: RatioDraft
    /** Unit for a manually tracked number; live KPIs derive theirs. */
    manualUnit: Unit

    deliverable: string
    measurementIndicator: string

    /** Target period for numbers; check-off frequency for deliverables; reminder cadence for manual KPIs. */
    periodType: TargetPeriodType
    periodKey: Dayjs | null
    target: number | null
}

export interface Department {
    id: string
    name: string
    [key: string]: any
}

export interface DraftContext {
    departments: Department[]
    interventions: any[]
    userDepartmentId?: string | null
    userDepartmentName?: string | null
    /** Main departments can configure shared KPIs and own KPIs for other departments. */
    canControlContributors: boolean
    activeProgramId?: string | null
    /** The active programme's name, shown in place of "this programme". */
    activeProgramName?: string | null
    isAllPrograms: boolean
}

/**
 * The department that owns a department KPI. Only main departments can choose
 * it; everyone else's KPIs always belong to their own department.
 */
export const ownerDepartmentId = (d: KpiDraft, ctx: DraftContext) =>
    ctx.canControlContributors ? d.departmentId : ctx.userDepartmentId || ''

export const ownerDepartmentName = (d: KpiDraft, ctx: DraftContext) => {
    const id = ownerDepartmentId(d, ctx)
    if (!id) return ''
    return ctx.departments.find(dep => dep.id === id)?.name
        || (id === ctx.userDepartmentId ? ctx.userDepartmentName || '' : '')
}

/** The programme a programme-scoped KPI belongs to, by name where it's known. */
export const programLabel = (ctx: DraftContext) => ctx.activeProgramName || 'This programme'

export const METRIC_FIELDS = SOURCE_CONFIGS.metrics.fields.filter(f => f.isNumeric)

export const SOURCE_LABELS: Record<SourceType, string> = {
    applications: 'Applications',
    interventions: 'Interventions',
    metrics: 'Business metrics'
}

const emptyRatio = (): RatioDraft => ({ mode: 'count_records', field: null, filters: [] })

export const emptyDraft = (ctx: DraftContext): KpiDraft => ({
    kpiLabel: '',
    kpiKind: 'numeric',
    ownership: 'department',
    departmentId: ctx.userDepartmentId || '',
    sharedKpiMode: 'allocated',
    contributorDepartmentIds: [],
    leadDepartmentId: null,
    // With no single active programme selected, "this programme" isn't possible.
    scope: ctx.activeProgramId && !ctx.isAllPrograms ? 'program' : 'all',
    tracking: 'live',
    sourceType: null,
    interventionIds: [],
    calc: null,
    countMode: 'records',
    field: null,
    filters: [],
    numerator: emptyRatio(),
    denominator: emptyRatio(),
    manualUnit: 'count',
    deliverable: '',
    measurementIndicator: '',
    periodType: 'monthly',
    periodKey: nextTargetPeriodStart('monthly'),
    target: null
})

/* --- Calculation ↔ stored fields ------------------------------------------ */

/** The calculations a source supports. Only Business metrics carry numeric values to total or average. */
export const calcOptionsFor = (sourceType: SourceType | null): Calc[] =>
    !sourceType ? [] : sourceType === 'metrics' ? ['total', 'average', 'percentage'] : ['count', 'percentage']

export const CALC_LABELS: Record<Calc, string> = {
    count: 'Count',
    total: 'Total',
    average: 'Average',
    percentage: 'Percentage'
}

const isMoneyField = (field: string | null) => field === 'monthlyRevenue'

/** The unit follows from what is measured: counts are counts, revenue is rands, ratios are percent. */
export const deriveUnit = (d: KpiDraft): Unit => {
    if (d.kpiKind === 'qualitative') return 'count'
    if (d.tracking === 'manual') return d.manualUnit
    if (d.calc === 'percentage') return 'percent'
    if (d.calc === 'total' || d.calc === 'average') return isMoneyField(d.field) ? 'ZAR' : 'count'
    return 'count'
}

export const toDisplayType = (d: KpiDraft): DisplayKpiType | null => {
    switch (d.calc) {
        case 'count': return 'total_number'
        // Legacy shape: a non-money metric total is stored as total_number + sum.
        case 'total': return isMoneyField(d.field) ? 'total_amount' : 'total_number'
        case 'average': return 'average'
        case 'percentage': return 'percentage'
        default: return null
    }
}

const toCalculationType = (d: KpiDraft): CalculationType => {
    switch (d.calc) {
        case 'total': return 'sum'
        case 'average': return 'average'
        case 'percentage': return 'ratio'
        default: return 'count'
    }
}

const fromStoredCalc = (kpi: KPI): Calc | null => {
    if (kpi.displayKpiType === 'percentage' || kpi.calculationType === 'ratio') return 'percentage'
    if (kpi.displayKpiType === 'average' || kpi.calculationType === 'average') return 'average'
    if (kpi.sourceType === 'metrics') return 'total'
    if (kpi.displayKpiType === 'total_amount' || kpi.calculationType === 'sum') return 'total'
    return kpi.sourceType ? 'count' : null
}

/** Load a stored KPI into the builder for editing. */
export const draftFromKpi = (kpi: KPI, ctx: DraftContext): KpiDraft => {
    const shared = kpi.belongsToMe === false
    const tracking: Tracking = kpi.trackingMode === 'manual' && kpi.kpiKind !== 'qualitative' ? 'manual' : 'live'
    const ratio = (part?: KPI['numerator']): RatioDraft => ({
        mode: (part?.calculationType as PartMode) || 'count_records',
        field: part?.field || null,
        filters: Array.isArray(part?.filters) ? part!.filters : []
    })
    return {
        ...emptyDraft(ctx),
        kpiLabel: kpi.kpiLabel || '',
        kpiKind: kpi.kpiKind || 'numeric',
        ownership: shared ? 'shared' : 'department',
        departmentId: shared ? '' : kpi.leadDepartmentId || '',
        sharedKpiMode: kpi.sharedKpiMode || 'allocated',
        contributorDepartmentIds: shared ? kpi.contributorDepartmentIds || [] : [],
        leadDepartmentId: shared ? kpi.leadDepartmentId || null : null,
        scope: kpi.appliesToAllPrograms || !kpi.programId ? 'all' : 'program',
        tracking,
        sourceType: tracking === 'live' ? kpi.sourceType || null : null,
        interventionIds: kpi.interventionIds || [],
        calc: tracking === 'live' ? fromStoredCalc(kpi) : null,
        countMode: kpi.countMode || 'records',
        field: kpi.field || null,
        filters: Array.isArray(kpi.filters) ? kpi.filters : [],
        numerator: ratio(kpi.numerator),
        denominator: ratio(kpi.denominator),
        manualUnit: kpi.unit || 'count',
        deliverable: kpi.deliverable || '',
        measurementIndicator: kpi.measurementIndicator || '',
        periodType: kpi.reminderCadence || kpi.latestTargetPeriodType || 'monthly',
        periodKey: kpi.latestTargetPeriodKey
            ? parsePeriodKeyToDayjs(kpi.latestTargetPeriodType || undefined, kpi.latestTargetPeriodKey)
            : nextTargetPeriodStart('monthly'),
        target: kpi.latestTarget ?? null
    }
}

/* --- Interventions ---------------------------------------------------------- */

export const interventionBelongsToDepartment = (intervention: any, department: { id: string }) =>
    !!department.id && String(intervention?.departmentId || '').trim() === department.id

export const interventionLabel = (i: any) => i?.interventionTitle || i?.title || i?.name || i?.id || 'Intervention'

/** The departments whose interventions this KPI can draw on. */
export const relevantDepartments = (d: KpiDraft, ctx: DraftContext): Department[] => {
    if (d.ownership === 'shared') return ctx.departments.filter(dep => d.contributorDepartmentIds.includes(dep.id))
    const own = ctx.departments.find(dep => dep.id === ownerDepartmentId(d, ctx))
    return own ? [own] : []
}

/* --- Validation --------------------------------------------------------------- */

const filterComplete = (f: KpiFilter) =>
    !!f.field && !!f.op && (f.op === 'in'
        ? Array.isArray(f.value) && f.value.length > 0
        : f.value !== undefined && f.value !== null && String(f.value).trim() !== '')

/**
 * The problems that stop this step from continuing, in plain language. An
 * empty list means the step is complete. `isNew` adds the target step's rules.
 */
export const validateStep = (step: number, d: KpiDraft, ctx: DraftContext, isNew: boolean): string[] => {
    const errors: string[] = []

    if (step === 0) {
        if (!d.kpiLabel.trim()) errors.push('Give the KPI a name.')
        if (d.ownership === 'department' && !ownerDepartmentId(d, ctx)) {
            errors.push(ctx.canControlContributors
                ? 'Choose the department that owns this KPI.'
                : 'Your account isn’t linked to a department, so it can’t own a KPI yet. Ask an administrator to set your department.')
        }
        if (d.ownership === 'shared') {
            if (!ctx.canControlContributors) errors.push('Shared KPIs are set up by a main department.')
            if (d.contributorDepartmentIds.length < 2) errors.push('A shared KPI needs at least two departments.')
            if (!d.leadDepartmentId || !d.contributorDepartmentIds.includes(d.leadDepartmentId)) errors.push('Choose a lead department from the contributing departments.')
            if (d.sharedKpiMode === 'collaborative' && d.kpiKind === 'qualitative') {
                errors.push('A collaborative outcome tracks each department’s interventions, so it can’t be a deliverable. Use allocated contribution instead.')
            }
        }
        if (d.scope === 'program' && (!ctx.activeProgramId || ctx.isAllPrograms)) {
            errors.push('Select a single programme first, or apply this KPI to all programmes.')
        }
    }

    if (step === 1) {
        if (d.kpiKind === 'qualitative') {
            if (!d.deliverable.trim()) errors.push('Describe the deliverable.')
            if (!d.measurementIndicator.trim()) errors.push('Describe how completion is verified.')
        } else if (d.tracking === 'live') {
            if (!d.sourceType) errors.push('Choose what is being measured.')
            if (d.sourceType === 'interventions' && d.interventionIds.length === 0) errors.push('Choose at least one intervention.')
            if (d.ownership === 'shared' && d.sharedKpiMode === 'collaborative') {
                if (d.sourceType !== 'interventions') errors.push('A collaborative outcome must be measured from interventions.')
                const missing = relevantDepartments(d, ctx).find(dep => !d.interventionIds.some(id => {
                    const iv = ctx.interventions.find(x => x.id === id)
                    return iv && interventionBelongsToDepartment(iv, dep)
                }))
                if (missing) errors.push(`Add at least one required intervention for ${missing.name}.`)
            }
            if (d.sourceType && !d.calc) errors.push('Choose how it is calculated.')
            if ((d.calc === 'total' || d.calc === 'average') && !METRIC_FIELDS.some(f => f.key === d.field)) errors.push('Choose which business metric to use.')
            if (d.calc === 'percentage') {
                for (const [name, part] of [['top', d.numerator], ['bottom', d.denominator]] as const) {
                    if (part.mode !== 'count_records' && !METRIC_FIELDS.some(f => f.key === part.field)) errors.push(`Choose the value for the ${name} group.`)
                    if (part.filters.some(f => !filterComplete(f))) errors.push(`Finish or remove the incomplete ${name}-group condition.`)
                }
            } else if (d.filters.some(f => !filterComplete(f))) {
                errors.push('Finish or remove the incomplete condition.')
            }
        }
    }

    if (step === 2 && isNew && d.kpiKind === 'numeric') {
        if (!d.periodKey) errors.push('Choose the first target period.')
        else if (targetPeriodHasStarted(d.periodType, buildPeriodKey(d.periodType, d.periodKey))) {
            errors.push('The first target must be for a period that hasn’t started yet.')
        }
        if (d.target == null || !(d.target > 0)) errors.push('Enter a target greater than zero.')
        else if (deriveUnit(d) === 'percent' && d.target > 100) errors.push('A percentage target can’t be more than 100.')
    }

    return errors
}

/* --- Save payload --------------------------------------------------------------- */

/** The kpiDefinitions document for this draft — the same shape the register and tracker already read. */
export const draftToPayload = (d: KpiDraft, ctx: DraftContext, editing?: KPI | null) => {
    const shared = d.ownership === 'shared'
    const leadDepartmentId = (shared ? d.leadDepartmentId : ownerDepartmentId(d, ctx)) || null
    const department = shared
        ? ctx.departments.find(dep => dep.id === leadDepartmentId)?.name || ''
        : ownerDepartmentName(d, ctx)
    const contributorDepartmentIds = shared
        ? d.contributorDepartmentIds
        : leadDepartmentId ? [leadDepartmentId] : []
    const contributorDepartmentNames = contributorDepartmentIds
        .map(id => ctx.departments.find(dep => dep.id === id)?.name || '')
        .filter(Boolean)
    const sharedContributors: SharedContributorConfig[] = shared
        ? d.contributorDepartmentIds.map(id => {
            const dep = ctx.departments.find(x => x.id === id)
            return {
                departmentId: id,
                departmentName: dep?.name || id,
                role: d.leadDepartmentId === id ? 'lead' : 'contributor',
                ...(d.sharedKpiMode === 'collaborative'
                    ? {
                        requiredInterventionIds: d.interventionIds.filter(ivId => {
                            const iv = ctx.interventions.find(x => x.id === ivId)
                            return !!dep && !!iv && interventionBelongsToDepartment(iv, dep)
                        })
                    }
                    : {})
            }
        })
        : []

    const base = {
        programId: d.scope === 'all' ? null : ctx.activeProgramId || null,
        appliesToAllPrograms: d.scope === 'all',
        belongsToMe: !shared,
        sharedKpiMode: shared ? d.sharedKpiMode : null,
        leadDepartmentId,
        leadDepartmentName: department || null,
        department,
        kpiLabel: d.kpiLabel.trim(),
        description: editing?.description || '',
        contributorDepartmentIds,
        contributorDepartmentNames,
        sharedContributors,
        createdAt: editing?.createdAt ?? new Date(),
        updatedAt: new Date(),
        active: true
    }

    if (d.kpiKind === 'qualitative') {
        return {
            ...base,
            unit: 'count' as Unit,
            kpiKind: 'qualitative' as KpiKind,
            deliverable: d.deliverable.trim(),
            measurementIndicator: d.measurementIndicator.trim(),
            sourceType: null,
            sourceCollection: null,
            countMode: null,
            dateField: null,
            displayKpiType: null,
            calculationType: 'count' as CalculationType,
            filters: [],
            field: null,
            numerator: null,
            denominator: null,
            interventionIds: [],
            trackingMode: 'manual' as const,
            reminderCadence: d.periodType
        }
    }

    if (d.tracking === 'manual') {
        // No live source: someone records the actual each period, with reminders.
        return {
            ...base,
            unit: d.manualUnit,
            kpiKind: 'numeric' as KpiKind,
            deliverable: null,
            measurementIndicator: null,
            sourceType: null,
            sourceCollection: null,
            countMode: null,
            dateField: null,
            displayKpiType: null,
            calculationType: 'count' as CalculationType,
            filters: [],
            field: null,
            numerator: null,
            denominator: null,
            interventionIds: [],
            trackingMode: 'manual' as const,
            reminderCadence: d.periodType
        }
    }

    const st = d.sourceType as SourceType
    const displayKpiType = toDisplayType(d)
    const calculationType = toCalculationType(d)
    const part = (r: RatioDraft) => ({
        calculationType: r.mode,
        field: r.mode === 'count_records' ? null : r.field,
        filters: r.filters
    })
    return {
        ...base,
        unit: deriveUnit(d),
        kpiKind: 'numeric' as KpiKind,
        deliverable: null,
        measurementIndicator: null,
        sourceType: st,
        sourceCollection: SOURCE_CONFIGS[st].collection,
        // Applications always count accepted applications (one per SME at a time).
        countMode: calculationType === 'count' ? (st === 'applications' ? 'records' : d.countMode) : null,
        dateField: 'createdAt' as const,
        displayKpiType,
        calculationType,
        filters: d.calc === 'percentage' ? [] : d.filters,
        field: d.calc === 'total' || d.calc === 'average' ? d.field : null,
        numerator: d.calc === 'percentage' ? part(d.numerator) : null,
        denominator: d.calc === 'percentage' ? part(d.denominator) : null,
        interventionIds: st === 'interventions' ? d.interventionIds : [],
        trackingMode: 'computed' as const,
        reminderCadence: null
    }
}

/* --- Live summary ------------------------------------------------------------------ */

const fieldLabel = (st: SourceType | null, key?: string | null) =>
    (st && SOURCE_CONFIGS[st].fields.find(f => f.key === key)?.label) || key || ''

const enumLabel = (st: SourceType | null, key: string, value: any, departments: Department[] = []) => {
    const f = st ? SOURCE_CONFIGS[st].fields.find(x => x.key === key) : undefined
    const label = (v: any) =>
        (f?.type === 'department' ? departments.find(dep => dep.id === v)?.name : f?.enumOptions?.find(o => o.value === v)?.label)
        || String(v)
    return Array.isArray(value) ? value.map(label).join(', ') : label(value)
}

export const describeFilters = (st: SourceType | null, filters: KpiFilter[], departments: Department[] = []) =>
    filters
        .filter(filterComplete)
        .map(f => `${fieldLabel(st, f.field)} ${OP_LABEL[f.op]} ${enumLabel(st, f.field, f.value, departments)}`)
        .join(' · ')

const describePart = (st: SourceType | null, part: RatioDraft, departments: Department[]) => {
    const what = part.mode === 'count_records'
        ? `${st === 'applications' ? 'applications' : st === 'interventions' ? 'interventions' : 'records'}`
        : `${part.mode === 'sum_field' ? 'total' : 'average'} ${fieldLabel(st, part.field).toLowerCase() || 'value'}`
    const where = describeFilters(st, part.filters, departments)
    return where ? `${what} where ${where}` : `all ${what}`
}

const periodText = (type: TargetPeriodType, key: Dayjs | null) =>
    !key ? '' : type === 'quarterly' ? `Q${key.quarter()} ${key.year()}` : key.format('MMM YYYY')

export const formatTarget = (value: number, unit: Unit) =>
    unit === 'ZAR'
        ? new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
        : unit === 'percent' ? `${value}%` : new Intl.NumberFormat('en-ZA').format(value)

export type SummaryRow = { key: string; label: string; value: string; pending?: boolean }

/** What the KPI will do, in plain words, as the builder fills in. Unfinished parts read as pending. */
export const summarise = (d: KpiDraft, ctx: DraftContext, isNew: boolean): { title: string; sentence: string; rows: SummaryRow[] } => {
    const title = d.kpiLabel.trim() || 'Untitled KPI'
    const depName = (id: string | null) => ctx.departments.find(x => x.id === id)?.name || ''

    const owner = d.ownership === 'shared'
        ? d.contributorDepartmentIds.length
            ? `Shared · ${d.sharedKpiMode === 'collaborative' ? 'collaborative outcome' : 'allocated contribution'} · ${d.contributorDepartmentIds.map(depName).filter(Boolean).join(', ')}${d.leadDepartmentId ? ` (lead: ${depName(d.leadDepartmentId)})` : ''}`
            : ''
        : ownerDepartmentName(d, ctx)

    let measure = ''
    if (d.kpiKind === 'qualitative') {
        measure = d.deliverable.trim() ? `Deliverable: ${d.deliverable.trim()}` : ''
    } else if (d.tracking === 'manual') {
        measure = `Recorded manually (${deriveUnit(d) === 'ZAR' ? 'rand amount' : deriveUnit(d) === 'percent' ? 'percentage' : 'count'})`
    } else if (d.sourceType && d.calc) {
        const st = d.sourceType
        const ivs = d.interventionIds.map(id => interventionLabel(ctx.interventions.find(x => x.id === id))).filter(Boolean)
        const ivText = st === 'interventions' && ivs.length ? `: ${ivs.slice(0, 3).join(', ')}${ivs.length > 3 ? ` +${ivs.length - 3} more` : ''}` : ''
        const where = d.calc === 'percentage' ? '' : describeFilters(st, d.filters, ctx.departments)
        if (d.calc === 'count') {
            measure = st === 'applications'
                ? 'Counts accepted applications'
                : d.countMode === 'distinct' ? `Counts unique SMEs with a completed intervention${ivText}` : `Counts completed interventions${ivText}`
        } else if (d.calc === 'total' || d.calc === 'average') {
            measure = `${d.calc === 'total' ? 'Totals' : 'Averages'} ${fieldLabel('metrics', d.field).toLowerCase() || 'a business metric'}`
        } else {
            measure = `Percentage: ${describePart(st, d.numerator, ctx.departments)} ÷ ${describePart(st, d.denominator, ctx.departments)}`
        }
        if (where) measure += ` where ${where}`
    }

    const unit = deriveUnit(d)
    let target = ''
    if (d.kpiKind === 'qualitative') {
        target = `Checked off ${d.periodType === 'quarterly' ? 'each quarter' : 'each month'}`
    } else if (!isNew) {
        target = 'Managed in Manage targets'
    } else if (d.target && d.periodKey) {
        target = `${formatTarget(d.target, unit)} for ${periodText(d.periodType, d.periodKey)} · then ${d.periodType}`
    }

    const rows: SummaryRow[] = [
        { key: 'owner', label: 'Owned by', value: owner || 'Not chosen yet', pending: !owner },
        { key: 'scope', label: 'Applies to', value: d.scope === 'all' ? 'All programmes' : programLabel(ctx) },
        { key: 'measure', label: d.kpiKind === 'qualitative' ? 'Deliverable' : 'Measurement', value: measure || 'Not set up yet', pending: !measure },
        ...(d.kpiKind === 'numeric' ? [{ key: 'unit', label: 'Unit', value: unit === 'ZAR' ? 'Rand (R)' : unit === 'percent' ? 'Percent (%)' : 'Count' }] : []),
        { key: 'target', label: d.kpiKind === 'qualitative' ? 'Frequency' : 'Target', value: target || 'Not set yet', pending: !target }
    ]

    const sentence = measure
        ? `${title}: ${measure.charAt(0).toLowerCase()}${measure.slice(1)}${target && d.kpiKind === 'numeric' && isNew ? ` — target ${target.split(' · ')[0]}` : ''}.`
        : `${title}: finish the measurement to see what this KPI will track.`

    return { title, sentence, rows }
}

/** For the first target period picker: periods that have already started can't take a committed target. */
export const periodStarted = (type: TargetPeriodType, value: Dayjs) =>
    targetPeriodHasStarted(type, buildPeriodKey(type, value))

export const toPeriodStart = (type: TargetPeriodType, value: Dayjs) =>
    type === 'quarterly' ? value.startOf('quarter') : value.startOf('month')

export { dayjs }
