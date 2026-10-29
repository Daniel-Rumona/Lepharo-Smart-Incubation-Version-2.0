import dayjs, { type Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(quarterOfYear)
dayjs.extend(isSameOrBefore)
dayjs.extend(customParseFormat)

/**
 * The KPI model shared by the register page and the create/edit modal: the
 * stored KPI shape, the live data sources a KPI can be computed from, and the
 * target-period helpers. Moved here verbatim from src/routes/kpis/index.tsx.
 */

export type FilterOp = '==' | '!=' | 'in'
export type SourceType = 'applications' | 'interventions' | 'metrics'
export type FieldType = 'string' | 'number' | 'date' | 'enum' | 'department'
export type Unit = 'count' | 'ZAR' | 'percent'
export type TargetPeriodType = 'monthly' | 'quarterly'
export type KpiKind = 'numeric' | 'qualitative'
export type SharedKpiMode = 'allocated' | 'collaborative'
export type CountMode = 'records' | 'distinct'

export type CalculationType = 'count' | 'sum' | 'average' | 'ratio'
export type DisplayKpiType = 'total_number' | 'total_amount' | 'average' | 'percentage'

export type MetricField =
    | 'monthlyRevenue'
    | 'jobsCreated'
    | 'jobsSustained'

export type FieldKey =
    | 'gapGroup'
    | 'gender'
    | 'ageGroup'
    | 'stage'
    | 'applicationStatus'
    | 'province'
    | 'sector'
    | 'departmentId'
    | 'status'
    | 'movStatus'
    | MetricField
    | 'createdAt'
    | 'contractType'

export interface SourceField {
    key: FieldKey
    label: string
    type: FieldType
    sourceFieldKey?: string
    enumOptions?: Array<{ label: string; value: any }>
    suggestFromDb?: boolean
    isCondition?: boolean
    isNumeric?: boolean
}

export interface SourceConfig {
    sourceType: SourceType
    label: string
    collection: string
    defaultDateField: 'createdAt'
    fields: SourceField[]
}

export interface KpiFilter {
    field: string
    op: FilterOp
    value: any
}

export interface RatioPartConfig {
    calculationType: 'count_records' | 'sum_field' | 'avg_field'
    field?: string | null
    filters: KpiFilter[]
}

export interface SharedContributorConfig {
    departmentId: string
    departmentName: string
    role: 'lead' | 'contributor'
    requiredInterventionIds?: string[]
}

export interface KPI {
    id: string

    department: string
    kpiLabel: string
    unit: Unit
    description?: string

    interventionIds?: string[]

    contributorDepartmentIds?: string[]
    contributorDepartmentNames?: string[]
    sharedContributors?: SharedContributorConfig[]

    programId?: string | null
    appliesToAllPrograms?: boolean

    belongsToMe?: boolean
    sharedKpiMode?: SharedKpiMode | null
    leadDepartmentId?: string | null
    leadDepartmentName?: string | null

    createdAt?: any
    updatedAt?: any
    active: boolean

    countMode?: CountMode

    sourceType: SourceType
    sourceCollection?: string | null
    dateField?: 'createdAt' | null

    calculationType: CalculationType
    displayKpiType?: DisplayKpiType
    filters: KpiFilter[]

    field?: string | null
    numerator?: RatioPartConfig | null
    denominator?: RatioPartConfig | null

    latestTargetPeriodType?: TargetPeriodType | null
    latestTargetPeriodKey?: string | null
    latestTarget?: number | null

    trackingMode?: 'computed' | 'manual' | null
    reminderCadence?: TargetPeriodType | null

    kpiKind?: KpiKind
    deliverable?: string | null
    measurementIndicator?: string | null
}

export interface KpiTargetDoc {
    id: string

    kpiId: string
    kpiLabel?: string
    department?: string
    periodType: TargetPeriodType
    periodKey: string
    periodStartAt?: any
    target: number
    createdAt?: any
    updatedAt?: any
    createdBy?: string
    updatedBy?: string
    changeReason?: string
}

export interface KpiTargetRevision {
    id: string
    targetDocId: string
    kpiId: string
    periodType: TargetPeriodType
    periodKey: string
    committedTarget: number
    revisedTarget: number
    reason: string
    status: 'approved'
    approvedBy: string
    approvedAt: any
}

export interface KpiTargetAuditLog {
    id: string

    kpiId: string
    targetDocId?: string
    kpiLabel?: string
    department?: string
    periodType: TargetPeriodType
    periodKey: string
    action: 'created' | 'updated' | 'revised' | 'deleted'
    oldTarget: number | null
    newTarget: number | null
    changeReason?: string
    changedAt?: any
    changedBy?: string
}

export const OP_LABEL: Record<FilterOp, string> = {
    '==': 'is',
    '!=': 'is not',
    in: 'is one of'
}

export const SOURCE_CONFIGS: Record<SourceType, SourceConfig> = {
    applications: {
        sourceType: 'applications',
        label: 'Applications',
        collection: 'applications',
        defaultDateField: 'createdAt',
        fields: [
            { key: 'gapGroup', label: 'Group', type: 'string', suggestFromDb: true, isCondition: true },
            {
                key: 'gender',
                label: 'Gender',
                type: 'enum',
                enumOptions: [
                    { label: 'Female', value: 'female' },
                    { label: 'Male', value: 'male' },
                    { label: 'Other', value: 'other' },
                    { label: 'Unknown', value: 'unknown' }
                ],
                isCondition: true
            },
            {
                key: 'ageGroup',
                label: 'Age Group',
                type: 'enum',
                enumOptions: [
                    { label: 'Youth (18–35)', value: 'youth' },
                    { label: '36–59', value: 'adult' },
                    { label: '60+', value: 'senior' }
                ],
                isCondition: true
            },
            { key: 'stage', label: 'Stage', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'applicationStatus', label: 'Application Status', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'province', label: 'Province', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'sector', label: 'Sector', type: 'string', suggestFromDb: true, sourceFieldKey: 'sector', isCondition: true },
            { key: 'createdAt', label: 'Date Created', type: 'date' }
        ]
    },
    interventions: {
        sourceType: 'interventions',
        label: 'Interventions',
        collection: 'interventions',
        defaultDateField: 'createdAt',
        fields: [
            { key: 'gapGroup', label: 'Group', type: 'string', suggestFromDb: true, isCondition: true },
            {
                key: 'gender',
                label: 'Gender',
                type: 'enum',
                enumOptions: [
                    { label: 'Female', value: 'female' },
                    { label: 'Male', value: 'male' },
                    { label: 'Other', value: 'other' },
                    { label: 'Unknown', value: 'unknown' }
                ],
                isCondition: true
            },
            {
                key: 'ageGroup',
                label: 'Age Group',
                type: 'enum',
                enumOptions: [
                    { label: 'Youth (18–35)', value: 'youth' },
                    { label: '36–59', value: 'adult' },
                    { label: '60+', value: 'senior' }
                ],
                isCondition: true
            },
            { key: 'stage', label: 'Stage', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'applicationStatus', label: 'Application Status', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'province', label: 'Province', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'sector', label: 'Sector', type: 'string', suggestFromDb: true, sourceFieldKey: 'sector', isCondition: true },
            { key: 'departmentId', label: 'Department', type: 'department', isCondition: true },
            { key: 'status', label: 'Intervention Status', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'movStatus', label: 'Verification Status', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'createdAt', label: 'Date Created', type: 'date' }
        ]
    },
    metrics: {
        sourceType: 'metrics',
        label: 'Performance Metrics',
        collection: 'participantMonthlyMetrics',
        defaultDateField: 'createdAt',
        fields: [
            { key: 'gapGroup', label: 'Group', type: 'string', suggestFromDb: true, isCondition: true },
            {
                key: 'gender',
                label: 'Gender',
                type: 'enum',
                enumOptions: [
                    { label: 'Female', value: 'female' },
                    { label: 'Male', value: 'male' },
                    { label: 'Other', value: 'other' },
                    { label: 'Unknown', value: 'unknown' }
                ],
                isCondition: true
            },
            {
                key: 'ageGroup',
                label: 'Age Group',
                type: 'enum',
                enumOptions: [
                    { label: 'Youth (18–35)', value: 'youth' },
                    { label: '36–59', value: 'adult' },
                    { label: '60+', value: 'senior' }
                ],
                isCondition: true
            },
            { key: 'stage', label: 'Stage', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'applicationStatus', label: 'Application Status', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'province', label: 'Province', type: 'string', suggestFromDb: true, isCondition: true },
            { key: 'sector', label: 'Sector', type: 'string', suggestFromDb: true, sourceFieldKey: 'sector', isCondition: true },
            // Jobs Created/Sustained are counted live from real HSE employment
            // contracts (hseJobContracts), not summed from this collection -
            // see the sourceType==='metrics' special case in computeKpi.
            // "Employees Permanent/Temporary" is the same underlying data as
            // Jobs Sustained, just narrowed with the Contract Type condition
            // below, so there's no separate field for it.
            { key: 'contractType', label: 'Contract Type (jobs only)', type: 'enum', enumOptions: [{ label: 'Permanent', value: 'permanent' }, { label: 'Temporal', value: 'temporal' }], isCondition: true },

            { key: 'monthlyRevenue', label: 'Monthly Revenue', type: 'number', isNumeric: true },
            { key: 'jobsCreated', label: 'Jobs Created', type: 'number', isNumeric: true },
            { key: 'jobsSustained', label: 'Jobs Sustained', type: 'number', isNumeric: true },

            { key: 'createdAt', label: 'Date Created', type: 'date' }
        ]
    }
}

export const prettySourceLabel = (st?: SourceType | null) => (st ? SOURCE_CONFIGS[st]?.label || st : '-')

export const compactDepartmentLabel = (name?: string | null) => {
    const fullName = String(name || '').trim()
    if (fullName.length <= 24) return fullName || '-'

    const explicitAbbreviation = fullName.match(/^([A-Z0-9]{2,8})\s*\(/)?.[1]
    if (explicitAbbreviation) return explicitAbbreviation

    const initials = fullName
        .split(/\s+/)
        .filter(word => word.length > 1 && !['and', 'of', 'the', 'for'].includes(word.toLowerCase()))
        .map(word => word[0])
        .join('')
        .toUpperCase()

    return initials.length >= 2 && initials.length <= 8 ? initials : fullName
}

export const prettyFilters = (filters?: KpiFilter[], st?: SourceType | null) => {
    if (!filters?.length) return 'No conditions'
    const cfg = st ? SOURCE_CONFIGS[st] : undefined
    const labelMap = cfg ? new Map(cfg.fields.map(f => [f.key, f.label])) : new Map<string, string>()

    return filters
        .map(f => {
            const fieldLabel = labelMap.get(f.field as FieldKey) || f.field
            const op = OP_LABEL[f.op] || f.op
            const val = Array.isArray(f.value) ? f.value.join(', ') : String(f.value)
            return `${fieldLabel} ${op} ${val}`
        })
        .join(' • ')
}

export const parsePeriodKeyToSortValue = (periodKey?: string | null) => {
    if (!periodKey) return 0
    if (periodKey.includes('-Q')) {
        const [y, qRaw] = periodKey.split('-Q')
        return Number(y) * 10 + Number(qRaw)
    }
    const [y, m] = periodKey.split('-')
    return Number(y) * 100 + Number(m)
}

export const buildPeriodKey = (periodType: TargetPeriodType, value: Dayjs) =>
    periodType === 'quarterly' ? `${value.year()}-Q${value.quarter()}` : value.format('YYYY-MM')

export const parsePeriodKeyToDayjs = (periodType: TargetPeriodType | undefined, periodKey?: string | null) => {
    if (!periodKey) return dayjs().startOf('month')
    const isQuarter = periodType === 'quarterly' || periodKey.includes('-Q')
    if (isQuarter) {
        const [yearRaw, quarterRaw] = periodKey.split('-Q')
        const year = Number(yearRaw)
        const quarter = Number(quarterRaw)
        return dayjs(`${year}-01-01`).startOf('year').add((quarter - 1) * 3, 'month').startOf('quarter')
    }
    return dayjs(periodKey, 'YYYY-MM')
}

export const targetPeriodHasStarted = (periodType: TargetPeriodType, periodKey: string) =>
    parsePeriodKeyToDayjs(periodType, periodKey).startOf('day').isSameOrBefore(dayjs().startOf('day'))

/** The first day of the month or quarter running today. */
export const currentTargetPeriodStart = (periodType: TargetPeriodType) =>
    dayjs().startOf(periodType === 'quarterly' ? 'quarter' : 'month')

export const nextTargetPeriodStart = (periodType: TargetPeriodType) =>
    periodType === 'quarterly'
        ? dayjs().startOf('quarter').add(1, 'quarter')
        : dayjs().startOf('month').add(1, 'month')

export const DISPLAY_TYPE_LABELS: Record<DisplayKpiType, string> = {
    total_number: 'Total number',
    total_amount: 'Total amount',
    average: 'Average',
    percentage: 'Percentage'
}

export const getKpiTypeLabel = (kpi: KPI) => {
    const type =
        kpi.displayKpiType ||
        (kpi.calculationType === 'count'
            ? 'total_number'
            : kpi.calculationType === 'sum'
                ? 'total_amount'
                : kpi.calculationType === 'average'
                    ? 'average'
                    : 'percentage')

    const labels = DISPLAY_TYPE_LABELS

    return labels[type as DisplayKpiType]
}

export const getUnitLabel = (unit?: Unit | null) => {
    const labels: Record<Unit, string> = {
        count: 'Count',
        ZAR: 'ZAR',
        percent: 'Percent'
    }
    return unit ? labels[unit] || unit : '-'
}
