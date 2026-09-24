
import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Col,
    DatePicker,
    Empty,
    Form,
    Input,
    InputNumber,
    Modal,
    Pagination,
    Popconfirm,
    Row,
    Select,
    Skeleton,
    Space,
    Statistic,
    Table,
    Tag,
    Tooltip,
    Typography,
    theme,
    message
} from 'antd'
import {
    AimOutlined,
    ApartmentOutlined,
    BarChartOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    DatabaseOutlined,
    DeleteOutlined,
    EditOutlined,
    FileTextOutlined,
    FilterOutlined,
    LeftOutlined,
    LineChartOutlined,
    MinusCircleOutlined,
    NumberOutlined,
    PercentageOutlined,
    PlusOutlined,
    ProjectOutlined,
    RightOutlined,
    SaveOutlined,
    SearchOutlined,
    SettingOutlined,
    TeamOutlined,
    DollarOutlined,
    HistoryOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDocs,
    limit,
    query,
    updateDoc,
    where,
    orderBy
} from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import { motion } from 'framer-motion'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { AddKpiFlowModal, type CreateFromCandidatesInput } from '@/components/kpis/AddKpiFlowModal'

dayjs.extend(quarterOfYear)
dayjs.extend(customParseFormat)
dayjs.extend(isSameOrBefore)

const { Option } = Select
const { Text } = Typography

// A module-level constant so every render that falls back to "no selection
// yet" shares the exact same array reference. `Form.useWatch(...) || []`
// instead would mint a brand-new [] every render, which breaks useMemo/
// useEffect dependency comparisons downstream (they compare by reference) -
// that was the actual cause of this page's "Maximum update depth exceeded"
// loop: an effect fed by that fresh array kept calling setState with a new
// (but logically identical) array every render, and React never bailed out.
const EMPTY_STRING_ARRAY: string[] = []
const EMPTY_FILTER_ARRAY: KpiFilter[] = []

type FilterOp = '==' | '!=' | 'in'
type SourceType = 'applications' | 'interventions' | 'metrics'
type FieldType = 'string' | 'number' | 'date' | 'enum'
type Unit = 'count' | 'ZAR' | 'percent'
type TargetPeriodType = 'monthly' | 'quarterly'
type SharedKpiMode = 'allocated' | 'collaborative'
type CountMode = 'records' | 'distinct'

type CalculationType = 'count' | 'sum' | 'average' | 'ratio'
type DisplayKpiType = 'total_number' | 'total_amount' | 'average' | 'percentage'

type MetricField =
    | 'monthlyRevenue'
    | 'jobsCreated'
    | 'jobsSustained'

type FieldKey =
    | 'gapGroup'
    | 'gender'
    | 'ageGroup'
    | 'stage'
    | 'applicationStatus'
    | 'province'
    | 'sector'
    | 'areaOfSupport'
    | 'status'
    | 'movStatus'
    | MetricField
    | 'createdAt'
    | 'contractType'

interface SourceField {
    key: FieldKey
    label: string
    type: FieldType
    sourceFieldKey?: string
    enumOptions?: Array<{ label: string; value: any }>
    suggestFromDb?: boolean
    isCondition?: boolean
    isNumeric?: boolean
}

interface SourceConfig {
    sourceType: SourceType
    label: string
    collection: string
    defaultDateField: 'createdAt'
    fields: SourceField[]
}

interface KpiFilter {
    field: string
    op: FilterOp
    value: any
}

interface RatioPartConfig {
    calculationType: 'count_records' | 'sum_field' | 'avg_field'
    field?: string | null
    filters: KpiFilter[]
}

interface SharedContributorConfig {
    departmentId: string
    departmentName: string
    role: 'lead' | 'contributor'
    requiredInterventionIds?: string[]
}

interface KPI {
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
}

interface KpiTargetDoc {
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

interface KpiTargetRevision {
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

interface KpiTargetAuditLog {
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

const OP_LABEL: Record<FilterOp, string> = {
    '==': 'is',
    '!=': 'is not',
    in: 'is one of'
}

const SOURCE_CONFIGS: Record<SourceType, SourceConfig> = {
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
            { key: 'areaOfSupport', label: 'Department / Area', type: 'string', suggestFromDb: true, isCondition: true },
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

const prettySourceLabel = (st?: SourceType | null) => (st ? SOURCE_CONFIGS[st]?.label || st : '-')

const compactDepartmentLabel = (name?: string | null) => {
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

const prettyFilters = (filters?: KpiFilter[], st?: SourceType | null) => {
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

const parsePeriodKeyToSortValue = (periodKey?: string | null) => {
    if (!periodKey) return 0
    if (periodKey.includes('-Q')) {
        const [y, qRaw] = periodKey.split('-Q')
        return Number(y) * 10 + Number(qRaw)
    }
    const [y, m] = periodKey.split('-')
    return Number(y) * 100 + Number(m)
}

const buildPeriodKey = (periodType: TargetPeriodType, value: Dayjs) =>
    periodType === 'quarterly' ? `${value.year()}-Q${value.quarter()}` : value.format('YYYY-MM')

const parsePeriodKeyToDayjs = (periodType: TargetPeriodType | undefined, periodKey?: string | null) => {
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

const targetPeriodHasStarted = (periodType: TargetPeriodType, periodKey: string) =>
    parsePeriodKeyToDayjs(periodType, periodKey).startOf('day').isSameOrBefore(dayjs().startOf('day'))

const nextTargetPeriodStart = (periodType: TargetPeriodType) =>
    periodType === 'quarterly'
        ? dayjs().startOf('quarter').add(1, 'quarter')
        : dayjs().startOf('month').add(1, 'month')

interface FilterListSectionProps {
    title: string
    hideHeader?: boolean
    listName: 'filters' | 'numeratorFilters' | 'denominatorFilters'
    st?: SourceType
    form: any
    renderValueInput: (
        st: SourceType | undefined,
        fieldKey?: string,
        rowIndex?: number,
        listName?: 'filters' | 'numeratorFilters' | 'denominatorFilters'
    ) => React.ReactNode
}

const FilterListSection: React.FC<FilterListSectionProps> = ({
    title,
    hideHeader = false,
    listName,
    st,
    form,
    renderValueInput
}) => (
    <Form.List name={listName}>
        {(fields, { add, remove }) => (
            <>
                {!hideHeader && (
                    <div style={{ marginBottom: 8 }}>
                        <Space wrap>
                            <Tag color='purple'>{title}</Tag>
                            {st ? (
                                <Button
                                    shape='round'
                                    type='dashed'
                                    htmlType='button'
                                    onClick={() => add({ field: undefined, op: '==', value: undefined })}
                                >
                                    Add condition
                                </Button>
                            ) : (
                                <Text type='secondary'>Choose source first</Text>
                            )}
                        </Space>
                    </div>
                )}

                {fields.map(({ key, name, ...restField }) => (
                    <Row key={key} gutter={[8, 8]} align='middle' style={{ marginBottom: 8 }}>
                        <Col xs={24} md={7}>
                            <Form.Item
                                {...restField}
                                name={[name, 'field']}
                                rules={[{ required: true, message: 'Choose a condition' }]}
                                style={{ marginBottom: 0 }}
                            >
                                <Select
                                    placeholder='Condition'
                                    onChange={() => {
                                        form.setFields([{ name: [listName, name, 'value'], value: undefined }])
                                    }}
                                >
                                    {(st ? SOURCE_CONFIGS[st].fields.filter(f => f.isCondition) : []).map(f => (
                                        <Option key={f.key} value={f.key}>
                                            {f.label}
                                        </Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={6}>
                            <Form.Item
                                {...restField}
                                name={[name, 'op']}
                                initialValue='=='
                                rules={[{ required: true, message: 'Choose' }]}
                                style={{ marginBottom: 0 }}
                            >
                                <Select
                                    placeholder='Choice'
                                    onChange={() => {
                                        form.setFields([{ name: [listName, name, 'value'], value: undefined }])
                                    }}
                                >
                                    <Option value='=='>is</Option>
                                    <Option value='!='>is not</Option>
                                    <Option value='in'>is one of</Option>
                                </Select>
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={10}>
                            <Form.Item
                                noStyle
                                shouldUpdate={(prev, next) =>
                                    prev?.[listName]?.[name]?.field !== next?.[listName]?.[name]?.field ||
                                    prev?.[listName]?.[name]?.op !== next?.[listName]?.[name]?.op
                                }
                            >
                                {() => {
                                    const currentFieldKey = form.getFieldValue([listName, name, 'field']) as string | undefined
                                    const currentOp = (form.getFieldValue([listName, name, 'op']) as FilterOp) || '=='

                                    return (
                                        <Form.Item
                                            {...restField}
                                            name={[name, 'value']}
                                            style={{ marginBottom: 0 }}
                                            rules={[
                                                {
                                                    validator: async (_, value) => {
                                                        if (currentOp === 'in') {
                                                            if (!Array.isArray(value) || value.length === 0) {
                                                                throw new Error('Choose one or more values')
                                                            }
                                                            return
                                                        }
                                                        if (value === undefined || value === null || String(value).trim() === '') {
                                                            throw new Error('Choose a value')
                                                        }
                                                    }
                                                }
                                            ]}
                                        >
                                            {currentFieldKey
                                                ? renderValueInput(st, currentFieldKey, name, listName)
                                                : <Input disabled placeholder='Choose value' />}
                                        </Form.Item>
                                    )
                                }}
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={1} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Tooltip title='Remove condition'>
                                <Button
                                    shape='round'
                                    danger
                                    type='text'
                                    htmlType='button'
                                    icon={<MinusCircleOutlined />}
                                    onClick={() => remove(name)}
                                    style={{ padding: 0 }}
                                />
                            </Tooltip>
                        </Col>
                    </Row>
                ))}
            </>
        )}
    </Form.List>
)

const StepPanel: React.FC<{ visible: boolean; children: React.ReactNode }> = ({ visible, children }) => (
    <div style={{ display: visible ? 'block' : 'none' }}>{children}</div>
)

const DISPLAY_TYPE_LABELS: Record<DisplayKpiType, string> = {
    total_number: 'Total number',
    total_amount: 'Total amount',
    average: 'Average',
    percentage: 'Percentage'
}

const getKpiTypeLabel = (kpi: KPI) => {
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

const getUnitLabel = (unit?: Unit | null) => {
    const labels: Record<Unit, string> = {
        count: 'Count',
        ZAR: 'ZAR',
        percent: 'Percent'
    }
    return unit ? labels[unit] || unit : '-'
}

const KpiTypingPrompt: React.FC<{ text: string }> = ({ text }) => {
    const [visibleText, setVisibleText] = useState('')

    useEffect(() => {
        if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setVisibleText(text)
            return
        }

        setVisibleText('')
        let index = 0
        const timer = window.setInterval(() => {
            index += 1
            setVisibleText(text.slice(0, index))
            if (index >= text.length) window.clearInterval(timer)
        }, 32)

        return () => window.clearInterval(timer)
    }, [text])

    return <>{visibleText}{visibleText.length < text.length ? <span style={{ marginLeft: 2 }}>|</span> : null}</>
}

const KPIManager: React.FC = () => {
    const [form] = Form.useForm()
    const [targetForm] = Form.useForm()
    const { user } = useFullIdentity()
    const { programId, isAllPrograms, activeProgramId } = useActiveProgramId()

    const [kpis, setKpis] = useState<KPI[]>([])
    const [kpiSearch, setKpiSearch] = useState('')
    const [selectedKpiId, setSelectedKpiId] = useState<string | null>(null)
    const [addKpiFlowVisible, setAddKpiFlowVisible] = useState(false)
    const [kpiListPage, setKpiListPage] = useState(1)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [modalVisible, setModalVisible] = useState(false)
    const [editingKPI, setEditingKPI] = useState<KPI | null>(null)
    const [editingStepPicker, setEditingStepPicker] = useState(false)
    const [scopeSelected, setScopeSelected] = useState(false)
    const [basicStage, setBasicStage] = useState<'ownership' | 'sharedMode' | 'scope' | 'identity'>('ownership')
    const [hoveredChoice, setHoveredChoice] = useState<string | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [hasConditions, setHasConditions] = useState<boolean | null>(null)
    const [draftConditionField, setDraftConditionField] = useState<string | undefined>(undefined)
    const [draftConditionOp, setDraftConditionOp] = useState<FilterOp>('==')
    const [returnToReview, setReturnToReview] = useState(false)

    const [departments, setDepartments] = useState<any[]>([])
    const [departmentsLoading, setDepartmentsLoading] = useState(false)

    const [interventions, setInterventions] = useState<any[]>([])
    const [filteredInterventions, setFilteredInterventions] = useState<any[]>([])
    const [interventionDepartmentId, setInterventionDepartmentId] = useState<string | undefined>()
    const [isMainDept, setIsMainDept] = useState(false)
    const [isMonitoringDept, setIsMonitoringDept] = useState(false)

    const [valueSuggestions, setValueSuggestions] = useState<Record<string, string[]>>({})
    const [suggestionLoadingKey, setSuggestionLoadingKey] = useState<string | null>(null)

    const [step, setStep] = useState(0)

    const [targetsModalOpen, setTargetsModalOpen] = useState(false)
    const [targetsKpi, setTargetsKpi] = useState<KPI | null>(null)
    const [targetRows, setTargetRows] = useState<KpiTargetDoc[]>([])
    const [targetAuditRows, setTargetAuditRows] = useState<KpiTargetAuditLog[]>([])
    const [targetsLoading, setTargetsLoading] = useState(false)
    const [targetsSaving, setTargetsSaving] = useState(false)
    const [editingTarget, setEditingTarget] = useState<KpiTargetDoc | null>(null)
    const [targetsDeletingId, setTargetsDeletingId] = useState<string | null>(null)
    const [targetModalSection, setTargetModalSection] = useState<'plan' | 'periods' | 'trail'>('plan')

    const belongsToMe = Form.useWatch('belongsToMe', form) as boolean | undefined
    const sharedKpiMode = Form.useWatch('sharedKpiMode', form) as SharedKpiMode | undefined
    const leadDepartmentId = Form.useWatch('leadDepartmentId', { form, preserve: true }) as string | undefined
    const appliesToAllPrograms = Form.useWatch('appliesToAllPrograms', form) as boolean | undefined
    const kpiLabel = Form.useWatch('kpiLabel', form) as string | undefined
    const selectedSourceType = Form.useWatch('sourceType', form) as SourceType | undefined
    const selectedUnit = Form.useWatch('unit', form) as Unit | undefined
    const selectedDisplayKpiType = Form.useWatch('displayKpiType', form) as DisplayKpiType | undefined
    const selectedCountMode = Form.useWatch('countMode', form) as CountMode | undefined
    const selectedField = Form.useWatch('field', form) as string | undefined
    const selectedNumeratorField = Form.useWatch('numeratorField', form) as string | undefined
    const selectedDenominatorField = Form.useWatch('denominatorField', form) as string | undefined
    const selectedPeriodType = Form.useWatch('periodType', form) as TargetPeriodType | undefined
    const selectedPeriodKey = Form.useWatch('periodKey', form) as string | undefined
    const selectedTarget = Form.useWatch('target', form) as number | undefined
    const selectedDepartment = Form.useWatch('department', form) as string | undefined
    const numeratorMode = Form.useWatch('numeratorMode', form) as 'count_records' | 'sum_field' | 'avg_field' | undefined
    const denominatorMode = Form.useWatch('denominatorMode', form) as 'count_records' | 'sum_field' | 'avg_field' | undefined
    const canControlContributors = isMainDept
    const { token } = theme.useToken()

    const targetPeriodType = Form.useWatch('periodType', targetForm) as TargetPeriodType | undefined
    const editingCommittedTarget = Boolean(
        editingTarget && targetPeriodHasStarted(editingTarget.periodType, editingTarget.periodKey)
    )

    const resolvedSourceType = selectedSourceType || (form.getFieldValue('sourceType') as SourceType | undefined) || editingKPI?.sourceType
    const resolvedUnit = selectedUnit || (form.getFieldValue('unit') as Unit | undefined) || editingKPI?.unit
    const sourceCfg = resolvedSourceType ? SOURCE_CONFIGS[resolvedSourceType] : undefined

    const numericFields = useMemo(() => {
        if (!sourceCfg) return []
        return sourceCfg.fields.filter(f => f.isNumeric)
    }, [sourceCfg])

    const metricFieldOptions = useMemo(() => {
        return SOURCE_CONFIGS.metrics.fields.filter(f => f.isNumeric)
    }, [])

    const availableDisplayTypes = useMemo(() => {
        if (!resolvedSourceType || !resolvedUnit) return []

        const hasNumeric = SOURCE_CONFIGS[resolvedSourceType].fields.some(f => f.isNumeric)
        const items: Array<{ value: DisplayKpiType; label: string }> = []

        if (resolvedUnit === 'count') items.push({ value: 'total_number', label: 'Total number' })
        if (resolvedUnit === 'percent') items.push({ value: 'percentage', label: 'Percentage' })
        if (resolvedUnit === 'ZAR' && hasNumeric) {
            items.push({ value: 'total_amount', label: 'Total amount' })
            items.push({ value: 'average', label: 'Average amount' })
        }
        if (resolvedUnit === 'count' && hasNumeric) {
            items.push({ value: 'average', label: 'Average' })
        }

        return items
    }, [resolvedSourceType, resolvedUnit])

    useEffect(() => {
        // When a source has one valid calculation (Applications and
        // Interventions with Count), select it for the user and show the useful
        // count detail instead of a redundant one-card choice.
        if (availableDisplayTypes.length === 1 && selectedDisplayKpiType !== availableDisplayTypes[0].value) {
            form.setFieldsValue({ displayKpiType: availableDisplayTypes[0].value })
        }
    }, [availableDisplayTypes, form, selectedDisplayKpiType])

    const orderedKpis = useMemo(() => {
        const search = kpiSearch.trim().toLowerCase()
        return kpis
            .filter(kpi => {
                if (!search) return true
                return [kpi.kpiLabel, kpi.department, kpi.sourceType, kpi.description]
                    .filter(Boolean)
                    .some(value => String(value).toLowerCase().includes(search))
            })
            .sort((a, b) => a.kpiLabel.localeCompare(b.kpiLabel))
    }, [kpis, kpiSearch])

    const kpiListPageSize = 3
    const pagedKpis = useMemo(() => {
        const start = (kpiListPage - 1) * kpiListPageSize
        return orderedKpis.slice(start, start + kpiListPageSize)
    }, [kpiListPage, orderedKpis])

    const selectedKpi = useMemo(
        () => orderedKpis.find(kpi => kpi.id === selectedKpiId) || null,
        [orderedKpis, selectedKpiId]
    )

    const targetSummary = useMemo(() => {
        const committed = targetRows.filter(row => targetPeriodHasStarted(row.periodType, row.periodKey))
        const future = targetRows.length - committed.length
        return { committed: committed.length, future, total: targetRows.length }
    }, [targetRows])

    useEffect(() => {
        const pageCount = Math.max(1, Math.ceil(orderedKpis.length / kpiListPageSize))
        setKpiListPage(current => Math.min(current, pageCount))

        if (!orderedKpis.length) {
            setSelectedKpiId(null)
            return
        }

        if (!selectedKpiId || !orderedKpis.some(kpi => kpi.id === selectedKpiId)) {
            setSelectedKpiId(orderedKpis[0].id)
        }
    }, [orderedKpis, selectedKpiId])

    const checkIfMainDept = async () => {
        try {
            if (!user?.departmentId) {
                setIsMainDept(false)
                setIsMonitoringDept(false)
                return
            }
            const snap = await getDocs(collection(db, 'departments'))
            const deptDoc = snap.docs.find(d => d.id === user.departmentId)
            setIsMainDept(Boolean(deptDoc?.data()?.isMain))
            setIsMonitoringDept(Boolean(deptDoc?.data()?.isMonitoring))
        } catch (err) {
            console.error(err)
            setIsMainDept(false)
            setIsMonitoringDept(false)
        }
    }

    const fetchDepartments = async () => {
        try {
            setDepartmentsLoading(true)
            const snap = await getDocs(collection(db, 'departments'))

            const rows = snap.docs
                .map(d => ({ id: d.id, ...(d.data() as any) }))
                .filter(row => String(row?.name || '').trim())

            setDepartments(rows)
        } catch (err) {
            console.error(err)
            setDepartments([])
            message.error('Failed to load departments')
        } finally {
            setDepartmentsLoading(false)
        }
    }

    const fetchInterventions = async () => {
        try {
            const qRef = query(
                collection(db, 'interventions'),
                limit(600)
            )

            const snap = await getDocs(qRef)
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))

            setInterventions(rows)
        } catch (err) {
            console.error(err)
            setInterventions([])
            message.error('Failed to load interventions')
        }
    }

    const fetchKPIs = async () => {
        setLoading(true)
        try {
            const snap = await getDocs(collection(db, 'kpiDefinitions'))

            const allKpis = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            })) as KPI[]

            const programScopedKpis = allKpis.filter(k => {
                if (k.appliesToAllPrograms) return true
                if (isAllPrograms) return true
                return k.programId === activeProgramId
            })

            const visibleKpis =
                !isMainDept && user?.departmentName
                    ? programScopedKpis.filter(k => k.department === user.departmentName)
                    : programScopedKpis

            const targetSnap = await getDocs(query(collection(db, 'kpiTargets'), limit(1500)))

            const targets = targetSnap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            })) as KpiTargetDoc[]

            const latestByKpiId = new Map<string, KpiTargetDoc>()
            for (const t of targets) {
                const existing = latestByKpiId.get(t.kpiId)
                if (!existing || parsePeriodKeyToSortValue(t.periodKey) > parsePeriodKeyToSortValue(existing.periodKey)) {
                    latestByKpiId.set(t.kpiId, t)
                }
            }

            setKpis(
                visibleKpis.map(kpi => {
                    const latest = latestByKpiId.get(kpi.id)
                    return {
                        ...kpi,
                        latestTargetPeriodType: latest?.periodType || null,
                        latestTargetPeriodKey: latest?.periodKey || null,
                        latestTarget: typeof latest?.target === 'number' ? latest.target : null
                    }
                })
            )
        } catch (err) {
            console.error(err)
            message.error('Failed to load KPIs')
        } finally {
            setLoading(false)
        }
    }

    const fetchTargetsForKpi = async (kpiId: string) => {
        setTargetsLoading(true)
        try {
            const [targetsSnap, auditSnap] = await Promise.all([
                getDocs(
                    query(
                        collection(db, 'kpiTargets'),
                        where('kpiId', '==', kpiId)
                    )
                ),
                getDocs(
                    query(
                        collection(db, 'kpiTargetAuditLogs'),
                        where('kpiId', '==', kpiId),
                        limit(500)
                    )
                )
            ])

            const rows = targetsSnap.docs
                .map(d => ({ id: d.id, ...(d.data() as any) }) as KpiTargetDoc)
                .sort((a, b) => parsePeriodKeyToSortValue(b.periodKey) - parsePeriodKeyToSortValue(a.periodKey))

            setTargetRows(rows)

            const auditRows = auditSnap.docs
                .map(d => ({ id: d.id, ...(d.data() as any) }) as KpiTargetAuditLog)
                .sort((a, b) => {
                    const aTime = a.changedAt?.seconds || new Date(a.changedAt || 0).getTime() || 0
                    const bTime = b.changedAt?.seconds || new Date(b.changedAt || 0).getTime() || 0
                    return bTime - aTime
                })

            setTargetAuditRows(auditRows)
        } catch (err) {
            console.error(err)
            message.error('Failed to load target history')
        } finally {
            setTargetsLoading(false)
        }
    }

    useEffect(() => {
        checkIfMainDept()
    }, [user?.departmentId])

    useEffect(() => {
        if (!user) return
        fetchDepartments()
        fetchInterventions()
        fetchKPIs()
    }, [user?.departmentName, isMainDept, activeProgramId, isAllPrograms])

    const selectedContributorDepartmentIdsRaw =
        (Form.useWatch('contributorDepartmentIds', { form, preserve: true }) as string[] | undefined) || EMPTY_STRING_ARRAY
    const selectedInterventionIds =
        (Form.useWatch('interventionIds', { form, preserve: true }) as string[] | undefined) || EMPTY_STRING_ARRAY
    const filters =
        (Form.useWatch('filters', { form, preserve: true }) as KpiFilter[] | undefined) || EMPTY_FILTER_ARRAY

    useEffect(() => {
        if (step !== 2) return
        setHasConditions(prev => prev ?? filters.length > 0)
    }, [step, filters])

    const selectedContributorDepartmentIds = useMemo(() => {
        if (!canControlContributors) {
            return user?.departmentId ? [user.departmentId] : []
        }

        if (belongsToMe && user?.departmentId) {
            return [user.departmentId]
        }

        return selectedContributorDepartmentIdsRaw
    }, [canControlContributors, belongsToMe, selectedContributorDepartmentIdsRaw, user?.departmentId])

    useEffect(() => {
        if (!modalVisible || !canControlContributors) return

        if (belongsToMe) {
            form.setFieldsValue({
                contributorDepartmentIds: user?.departmentId ? [user.departmentId] : []
            })
        }
    }, [belongsToMe, modalVisible, canControlContributors, form, user?.departmentId])

    useEffect(() => {
        if (!selectedContributorDepartmentIdsRaw.length) {
            setInterventionDepartmentId(undefined)
            return
        }

        if (!interventionDepartmentId || !selectedContributorDepartmentIdsRaw.includes(interventionDepartmentId)) {
            setInterventionDepartmentId(selectedContributorDepartmentIdsRaw[0])
        }
    }, [selectedContributorDepartmentIdsRaw, interventionDepartmentId])

    const interventionBelongsToDepartment = (intervention: any, department: { id: string; name: string }) => {
        // Newer intervention documents carry an ID. Older documents only have the
        // department name, so retain that as a backwards-compatible fallback.
        const ownerIds = [
            intervention.departmentId,
            intervention.areaOfSupportId,
            intervention.areaId
        ].map(value => String(value || '').trim()).filter(Boolean)

        if (ownerIds.length) return ownerIds.includes(department.id)

        const ownerNames = [intervention.areaOfSupport, intervention.area, intervention.department]
            .map(value => String(value || '').trim())
            .filter(Boolean)

        return ownerNames.includes(String(department.name || '').trim())
    }

    useEffect(() => {
        const selectedDepartments = departments.filter(d => selectedContributorDepartmentIds.includes(d.id))

        if (!selectedDepartments.length) {
            if (isMainDept) {
                setFilteredInterventions(interventions)
            } else if (user?.departmentName) {
                setFilteredInterventions(
                    interventions.filter(i =>
                        [i.areaOfSupport, i.area, i.department]
                            .map(v => String(v || '').trim())
                            .includes(String(user.departmentName || '').trim())
                    )
                )
            } else {
                setFilteredInterventions([])
            }
            return
        }

        setFilteredInterventions(
            interventions.filter(intervention => selectedDepartments.some(department => interventionBelongsToDepartment(intervention, department)))
        )
    }, [
        interventions,
        departments,
        selectedContributorDepartmentIds,
        isMainDept,
        user?.departmentName
    ])

    const selectedInterventionDepartment = departments.find(department => department.id === interventionDepartmentId)
    const interventionsForSelectedDepartment = selectedInterventionDepartment
        ? filteredInterventions.filter(intervention => interventionBelongsToDepartment(intervention, selectedInterventionDepartment))
        : []

    const ensureSuggestions = async (st: SourceType, fieldKey: string) => {
        const cacheKey = `${st}|${fieldKey}`
        if (valueSuggestions[cacheKey]) return

        const cfg = SOURCE_CONFIGS[st]
        const field = cfg.fields.find(f => f.key === fieldKey)
        const firestoreKey = field?.sourceFieldKey || fieldKey

        try {
            setSuggestionLoadingKey(cacheKey)
            // participantMonthlyMetrics only holds what revenueMetricsSyncCron has
            // synced so far (and jobs never live there at all - see
            // kpiCalculationService's isJobsField branch), so Business Metrics
            // condition values are suggested from the participant records they
            // actually describe instead, same as the cross-source "sector" field.
            const targetCollection = (st === 'metrics' || fieldKey === 'sector') ? 'participants' : cfg.collection

            const qRef = query(collection(db, targetCollection), limit(350))

            const snap = await getDocs(qRef)
            const uniques = new Set<string>()

            snap.docs.forEach(d => {
                const data: any = d.data()
                const raw = data?.[firestoreKey]
                if (raw === undefined || raw === null) return

                if (Array.isArray(raw)) {
                    raw.forEach(v => String(v).trim() && uniques.add(String(v).trim()))
                } else {
                    String(raw).trim() && uniques.add(String(raw).trim())
                }
            })

            setValueSuggestions(prev => ({
                ...prev,
                [cacheKey]: Array.from(uniques).slice(0, 120)
            }))
        } catch (e) {
            console.error(e)
        } finally {
            setSuggestionLoadingKey(null)
        }
    }

    const renderValueInput = (
        st: SourceType | undefined,
        fieldKey?: string,
        rowIndex?: number,
        listName: 'filters' | 'numeratorFilters' | 'denominatorFilters' = 'filters',
        opOverride?: FilterOp
    ) => {
        if (!st || !fieldKey) return null
        const cfg = SOURCE_CONFIGS[st]
        const field = cfg.fields.find(f => f.key === fieldKey)
        const currentOp: FilterOp = opOverride || (rowIndex !== undefined ? form.getFieldValue([listName, rowIndex, 'op']) : undefined) || '=='
        if (!field) return null

        if (field.type === 'enum' && field.enumOptions?.length) {
            if (currentOp === 'in') {
                return (
                    <Select mode='multiple' placeholder='Choose value(s)'>
                        {field.enumOptions.map(opt => (
                            <Option key={String(opt.value)} value={opt.value}>
                                {opt.label}
                            </Option>
                        ))}
                    </Select>
                )
            }
            return (
                <Select placeholder='Choose a value' allowClear>
                    {field.enumOptions.map(opt => (
                        <Option key={String(opt.value)} value={opt.value}>
                            {opt.label}
                        </Option>
                    ))}
                </Select>
            )
        }

        const cacheKey = `${st}|${fieldKey}`
        const options = valueSuggestions[cacheKey] || []
        const loadingOpts = suggestionLoadingKey === cacheKey

        const commonProps: any = {
            loading: loadingOpts,
            showSearch: true,
            onDropdownVisibleChange: (open: boolean) => open && ensureSuggestions(st, fieldKey),
            options: options.map(v => ({ label: v, value: v })),
            notFoundContent: 'No options yet',
            filterOption: (input: string, option: any) =>
                String(option?.label || option?.value || '').toLowerCase().includes(input.toLowerCase())
        }

        if (currentOp === 'in') return <Select mode='multiple' placeholder='Choose value(s)' {...commonProps} />
        return <Select placeholder='Choose a value' allowClear {...commonProps} />
    }

    const renderPercentageMeasurementChoices = (
        modeName: 'numeratorMode' | 'denominatorMode',
        fieldName: 'numeratorField' | 'denominatorField',
        selectedMode: 'count_records' | 'sum_field' | 'avg_field' | undefined,
        groupLabel: 'Top' | 'Bottom'
    ) => {
        const choices = [
            { value: 'count_records' as const, title: 'Count records', icon: <NumberOutlined style={{ color: '#1677ff' }} /> },
            ...(numericFields.length ? [
                { value: 'sum_field' as const, title: 'Total a value', icon: <DollarOutlined style={{ color: '#52c41a' }} /> },
                { value: 'avg_field' as const, title: 'Average a value', icon: <BarChartOutlined style={{ color: '#fa8c16' }} /> }
            ] : [])
        ]
        const selectedNumericField = modeName === 'numeratorMode' ? selectedNumeratorField : selectedDenominatorField

        return (
            <>
                <Form.Item name={modeName} hidden rules={[{ required: true, message: 'Choose an option' }]}><Input /></Form.Item>
                <Text type='secondary' style={{ display: 'block', marginBottom: 8 }}>{groupLabel} group calculation</Text>
                <Row gutter={[8, 8]}>
                    {choices.map(choice => {
                        const selected = selectedMode === choice.value
                        const choiceKey = `${modeName}-${choice.value}`
                        const hovered = hoveredChoice === choiceKey
                        const chooseMode = () => form.setFieldsValue({
                            [modeName]: choice.value,
                            [fieldName]: choice.value === 'count_records' ? null : (numericFields[0]?.key || null)
                        })
                        return (
                            <Col xs={24} sm={choices.length === 1 ? 24 : 12} key={choice.value}>
                                <Card
                                    hoverable role='button' tabIndex={0}
                                    onClick={chooseMode}
                                    onKeyDown={event => {
                                        if (event.key !== 'Enter' && event.key !== ' ') return
                                        event.preventDefault()
                                        chooseMode()
                                    }}
                                    onMouseEnter={() => setHoveredChoice(choiceKey)}
                                    onMouseLeave={() => setHoveredChoice(null)}
                                    style={{ cursor: 'pointer', borderColor: selected ? token.colorPrimary : (hovered ? token.colorPrimaryBorderHover : undefined), background: selected ? token.colorPrimaryBg : undefined, transition: 'all .2s ease' }}
                                    bodyStyle={{ padding: '9px 11px' }}
                                >
                                    <Space size={8}>{choice.icon}<Text strong>{choice.title}</Text></Space>
                                </Card>
                            </Col>
                        )
                    })}
                </Row>

                {selectedMode !== 'count_records' && (
                    <div style={{ marginTop: 12 }}>
                        <Form.Item name={fieldName} hidden rules={[{ required: true, message: 'Choose a numeric field' }]}><Input /></Form.Item>
                        <Text type='secondary' style={{ display: 'block', marginBottom: 8 }}>{groupLabel} group value</Text>
                        <Row gutter={[8, 8]}>
                            {numericFields.map(field => {
                                const selected = selectedNumericField === field.key
                                const choiceKey = `${fieldName}-${field.key}`
                                const hovered = hoveredChoice === choiceKey
                                const chooseField = () => form.setFieldsValue({ [fieldName]: field.key })
                                return (
                                    <Col xs={24} key={field.key}>
                                        <Card
                                            hoverable role='button' tabIndex={0}
                                            onClick={chooseField}
                                            onKeyDown={event => {
                                                if (event.key !== 'Enter' && event.key !== ' ') return
                                                event.preventDefault()
                                                chooseField()
                                            }}
                                            onMouseEnter={() => setHoveredChoice(choiceKey)}
                                            onMouseLeave={() => setHoveredChoice(null)}
                                            style={{ cursor: 'pointer', borderColor: selected ? token.colorPrimary : (hovered ? token.colorPrimaryBorderHover : undefined), background: selected ? token.colorPrimaryBg : undefined, transition: 'all .2s ease' }}
                                            bodyStyle={{ padding: '8px 10px' }}
                                        >
                                            <Space size={8}><BarChartOutlined style={{ color: '#52c41a' }} /><Text strong>{field.label}</Text></Space>
                                        </Card>
                                    </Col>
                                )
                            })}
                        </Row>
                    </div>
                )}
            </>
        )
    }

    const resetWizard = () => {
        setStep(0)
        setBasicStage(canControlContributors ? 'ownership' : 'scope')
        setHasConditions(null)
        setDraftConditionField(undefined)
        setDraftConditionOp('==')
        setReturnToReview(false)
    }

    const mapDisplayTypeToCalculationType = (displayType: DisplayKpiType): CalculationType => {
        if (displayType === 'total_number') return 'count'
        if (displayType === 'total_amount') return 'sum'
        if (displayType === 'average') return 'average'
        return 'ratio'
    }

    const applySourceOrUnitDefaults = () => {
        const st = form.getFieldValue('sourceType') as SourceType | undefined
        const unit = form.getFieldValue('unit') as Unit | undefined
        const currentDisplayType = form.getFieldValue('displayKpiType') as DisplayKpiType | undefined

        if (!st || !unit) return

        const hasNumeric = SOURCE_CONFIGS[st].fields.some(f => f.isNumeric)
        const firstNumeric = SOURCE_CONFIGS[st].fields.find(f => f.isNumeric)?.key || null

        const nextValues: any = {}
        let changed = false

        // Do not silently turn an Amount KPI into a Count KPI. Source cards make
        // the incompatible sources unavailable and explain why instead.
        const compatibleUnit: Unit = unit

        const allowed: DisplayKpiType[] = []
        if (compatibleUnit === 'count') allowed.push('total_number')
        if (compatibleUnit === 'percent') allowed.push('percentage')
        if (compatibleUnit === 'ZAR' && hasNumeric) {
            allowed.push('total_amount', 'average')
        }
        if (compatibleUnit === 'count' && hasNumeric) {
            allowed.push('average')
        }

        if (!currentDisplayType || !allowed.includes(currentDisplayType)) {
            nextValues.displayKpiType = allowed[0]
            changed = true
        }

        if ((form.getFieldValue('filters') || []).length > 0) {
            nextValues.filters = []
            changed = true
        }
        if ((form.getFieldValue('numeratorFilters') || []).length > 0) {
            nextValues.numeratorFilters = []
            changed = true
        }
        if ((form.getFieldValue('denominatorFilters') || []).length > 0) {
            nextValues.denominatorFilters = []
            changed = true
        }

        const resolvedDisplay = nextValues.displayKpiType || currentDisplayType

        if ((resolvedDisplay === 'total_amount' || resolvedDisplay === 'average' || (resolvedDisplay === 'total_number' && st === 'metrics')) && form.getFieldValue('field') !== firstNumeric) {
            nextValues.field = firstNumeric
            changed = true
        }

        if (resolvedDisplay === 'percentage') {
            if (!form.getFieldValue('numeratorMode')) {
                nextValues.numeratorMode = 'count_records'
                changed = true
            }
            if (!form.getFieldValue('denominatorMode')) {
                nextValues.denominatorMode = 'count_records'
                changed = true
            }
            if (firstNumeric && !form.getFieldValue('numeratorField')) {
                nextValues.numeratorField = firstNumeric
                changed = true
            }
            if (firstNumeric && !form.getFieldValue('denominatorField')) {
                nextValues.denominatorField = firstNumeric
                changed = true
            }
        }

        if (changed) form.setFieldsValue(nextValues)
    }

    const validateFiltersForSource = (filters: KpiFilter[], st: SourceType) => {
        const cfg = SOURCE_CONFIGS[st]
        const validFieldKeys = new Set(cfg.fields.map(f => f.key))
        const allowedConditionKeys = new Set(cfg.fields.filter(f => f.isCondition).map(f => f.key))

        for (const f of filters) {
            if (!f?.field || !f?.op) throw new Error('Each condition must have a condition and a choice')
            if (!validFieldKeys.has(f.field as FieldKey)) throw new Error('A condition is invalid')
            if (!allowedConditionKeys.has(f.field as FieldKey)) throw new Error('Please use the listed conditions only')

            if (f.op === 'in') {
                if (!Array.isArray(f.value) || f.value.length === 0) throw new Error('Choose one or more values')
            } else {
                if (f.value === undefined || f.value === null || String(f.value).trim() === '') {
                    throw new Error('Please choose a value for each condition')
                }
            }
        }
    }

    const validateNumericField = (sourceType: SourceType, field?: string | null) => {
        const cfg = SOURCE_CONFIGS[sourceType]
        const numeric = new Set(cfg.fields.filter(f => f.isNumeric).map(f => f.key))
        if (!field || !numeric.has(field as FieldKey)) {
            throw new Error('Please choose a numeric field')
        }
    }

    const validateConfig = (values: any) => {
        if (!values.sourceType) throw new Error('Please choose what you are measuring')
        if (!values.unit) throw new Error('Please choose a unit')
        if (!values.displayKpiType) throw new Error('Please choose the KPI type')

        const st = values.sourceType as SourceType
        const displayType = values.displayKpiType as DisplayKpiType

        if (!values.appliesToAllPrograms && !activeProgramId) {
            throw new Error('Please select an active program first or mark this KPI as All Programs')
        }

        const belongs = !!values.belongsToMe
        if (
            canControlContributors &&
            !belongs &&
            (!Array.isArray(values.contributorDepartmentIds) || values.contributorDepartmentIds.length === 0)
        ) {
            throw new Error('Please select the contributing departments')
        }

        if (!belongs && (!values.leadDepartmentId || !values.contributorDepartmentIds?.includes(values.leadDepartmentId))) {
            throw new Error('Choose a lead department from the contributing departments')
        }

        if (st === 'interventions') {
            if (!Array.isArray(values.interventionIds) || values.interventionIds.length === 0) {
                throw new Error('Please select the interventions to measure')
            }
        }

        if (!belongs && values.sharedKpiMode === 'collaborative') {
            if (st !== 'interventions') {
                throw new Error('Collaborative outcomes must use Interventions so each department’s required work can be tracked')
            }

            const selectedIds = Array.isArray(values.interventionIds) ? values.interventionIds : []
            const missingDepartment = (values.contributorDepartmentIds || [])
                .map((departmentId: string) => departments.find(department => department.id === departmentId))
                .find(department => department && !selectedIds.some((interventionId: string) => {
                    const intervention = interventions.find(item => item.id === interventionId)
                    return intervention && interventionBelongsToDepartment(intervention, department)
                }))

            if (missingDepartment) {
                throw new Error(`Add at least one required intervention for ${missingDepartment.name}`)
            }
        }

        if (displayType !== 'percentage') {
            validateFiltersForSource((values.filters || []) as KpiFilter[], st)
        }

        if (displayType === 'total_amount' || displayType === 'average') {
            validateNumericField(st, values.field)
        }

        if (displayType === 'percentage') {
            validateFiltersForSource((values.numeratorFilters || []) as KpiFilter[], st)
            validateFiltersForSource((values.denominatorFilters || []) as KpiFilter[], st)

            const numeratorMode = values.numeratorMode as 'count_records' | 'sum_field' | 'avg_field'
            const denominatorMode = values.denominatorMode as 'count_records' | 'sum_field' | 'avg_field'

            if (!numeratorMode || !denominatorMode) {
                throw new Error('Please complete the percentage setup')
            }

            if (numeratorMode !== 'count_records') validateNumericField(st, values.numeratorField)
            if (denominatorMode !== 'count_records') validateNumericField(st, values.denominatorField)

            if (values.unit !== 'percent') {
                throw new Error('Percentage KPI type must use Percent as the unit')
            }
        }

        if (displayType === 'total_number') {
            if (st === 'metrics') {
                validateNumericField(st, values.field)
            } else {
                const countMode = values.countMode || 'records'

                if (!['records', 'distinct'].includes(countMode)) {
                    throw new Error('Please choose how this KPI should be counted')
                }
            }
        }

        if (values.unit === 'ZAR' && displayType === 'total_number') {
            throw new Error('ZAR KPIs cannot use Total number')
        }

        if (values.unit === 'ZAR' && displayType === 'percentage') {
            throw new Error('ZAR KPIs cannot use Percentage')
        }

        if (values.unit === 'ZAR' && !SOURCE_CONFIGS[st].fields.some(field => field.isNumeric)) {
            throw new Error('Amount KPIs must use Business Metrics, which provides numeric values to total or average')
        }
    }

    const writeTargetAuditLog = async (params: {
        action: 'created' | 'updated' | 'revised' | 'deleted'
        kpi: KPI
        targetDocId?: string
        periodType: TargetPeriodType
        periodKey: string
        oldTarget: number | null
        newTarget: number | null
        changeReason?: string
        revisionId?: string
    }) => {
        await addDoc(collection(db, 'kpiTargetAuditLogs'), {
            kpiId: params.kpi.id,
            targetDocId: params.targetDocId || null,
            kpiLabel: params.kpi.kpiLabel,
            department: params.kpi.department,
            periodType: params.periodType,
            periodKey: params.periodKey,
            action: params.action,
            oldTarget: params.oldTarget,
            newTarget: params.newTarget,
            changeReason: params.changeReason || '',
            changedAt: new Date(),
            changedBy: user?.uid || 'system',
            revisionId: params.revisionId || null,
            approvedBy: params.action === 'revised' ? (user?.uid || 'system') : null,
            approvedAt: params.action === 'revised' ? new Date() : null
        })
    }

    const createApprovedTargetRevision = async (params: {
        target: KpiTargetDoc
        kpi: KPI
        revisedTarget: number
        reason: string
    }) => {
        const revisionRef = await addDoc(collection(db, 'kpiTargetRevisions'), {
            targetDocId: params.target.id,
            kpiId: params.kpi.id,
            kpiLabel: params.kpi.kpiLabel,
            department: params.kpi.department,
            periodType: params.target.periodType,
            periodKey: params.target.periodKey,
            committedTarget: params.target.target,
            revisedTarget: params.revisedTarget,
            reason: params.reason,
            status: 'approved',
            approvedBy: user?.uid || 'system',
            approvedAt: new Date(),
            createdAt: new Date()
        })

        await writeTargetAuditLog({
            action: 'revised',
            kpi: params.kpi,
            targetDocId: params.target.id,
            periodType: params.target.periodType,
            periodKey: params.target.periodKey,
            oldTarget: params.target.target,
            newTarget: params.revisedTarget,
            changeReason: params.reason,
            revisionId: revisionRef.id
        })
    }

    const saveInitialTarget = async (kpiId: string, values: any, kpiForAudit: KPI) => {
        const periodType = values.periodType as TargetPeriodType
        const periodKey = buildPeriodKey(periodType, values.periodKey)
        const periodStartAt = parsePeriodKeyToDayjs(periodType, periodKey).toDate()
        const targetValue = Number(values.target || 0)

        if (!Number.isFinite(targetValue) || targetValue <= 0) {
            throw new Error('Target must be greater than zero')
        }

        if (targetPeriodHasStarted(periodType, periodKey)) {
            throw new Error('Committed targets must be set before their reporting period begins. Use Manage Targets to record a formal revision instead.')
        }

        const snap = await getDocs(
            query(
                collection(db, 'kpiTargets'),
                where('kpiId', '==', kpiId),
                where('periodKey', '==', periodKey)
            )
        )

        if (!snap.empty) {
            const existingDoc = snap.docs[0]
            const existing = existingDoc.data() as any
            await updateDoc(doc(db, 'kpiTargets', existingDoc.id), {
                kpiId,
                kpiLabel: values.kpiLabel,
                department: values.department,
                periodType,
                periodKey,
                periodStartAt,
                target: targetValue,
                updatedAt: new Date(),
                updatedBy: user?.uid || 'system'
            })

            await writeTargetAuditLog({
                action: 'updated',
                kpi: kpiForAudit,
                targetDocId: existingDoc.id,
                periodType,
                periodKey,
                oldTarget: typeof existing.target === 'number' ? existing.target : null,
                newTarget: targetValue,
                changeReason: 'Initial target updated from KPI wizard'
            })
        } else {
            const ref = await addDoc(collection(db, 'kpiTargets'), {
                kpiId,
                kpiLabel: values.kpiLabel,
                department: values.department,
                periodType,
                periodKey,
                periodStartAt,
                target: targetValue,
                createdAt: new Date(),
                updatedAt: new Date(),
                createdBy: user?.uid || 'system',
                updatedBy: user?.uid || 'system'
            })

            await writeTargetAuditLog({
                action: 'created',
                kpi: kpiForAudit,
                targetDocId: ref.id,
                periodType,
                periodKey,
                oldTarget: null,
                newTarget: targetValue,
                changeReason: 'Initial target created from KPI wizard'
            })
        }
    }

    const handleDelete = async (record: KPI) => {
        try {
            setDeletingId(record.id)

            const withThisKpi = interventions
                .filter(i => Array.isArray(i.kpiIds) && i.kpiIds.includes(record.id))
                .map(i => i.id as string)

            await Promise.all(
                withThisKpi.map(id =>
                    updateDoc(doc(db, 'interventions', id), { kpiIds: arrayRemove(record.id) })
                )
            )

            {
                const targetSnap = await getDocs(query(collection(db, 'kpiTargets'), where('kpiId', '==', record.id)))

                await Promise.all(
                    targetSnap.docs.map(async d => {
                        const target = d.data() as any
                        await writeTargetAuditLog({
                            action: 'deleted',
                            kpi: record,
                            targetDocId: d.id,
                            periodType: target.periodType,
                            periodKey: target.periodKey,
                            oldTarget: typeof target.target === 'number' ? target.target : null,
                            newTarget: null,
                            changeReason: 'Target removed because KPI was deleted'
                        })
                        await deleteDoc(doc(db, 'kpiTargets', d.id))
                    })
                )
            }

            await deleteDoc(doc(db, 'kpiDefinitions', record.id))
            message.success('KPI deleted')
            fetchKPIs()
        } catch (err) {
            console.error(err)
            message.error('Delete failed')
        } finally {
            setDeletingId(null)
        }
    }

    /**
     * Create one or more KPIs drafted by the Add KPI assistant. Targets are
     * written directly (not through saveInitialTarget's future-only guard) -
     * these come from an already-signed external letter, so the quarters it
     * names are historical fact, not something being newly declared now.
     */
    const handleCreateFromCandidates = async (input: CreateFromCandidatesInput) => {
        for (const decision of input.decisions) {
            const isComputed = decision.trackingMode === 'computed' && decision.sourceType
            const sourceType: SourceType = isComputed ? (decision.sourceType as SourceType) : 'applications'

            const payload: any = {
                programId: null,
                appliesToAllPrograms: true,
                belongsToMe: true,
                sharedKpiMode: null,
                leadDepartmentId: input.departmentId,
                leadDepartmentName: input.departmentName,
                department: input.departmentName,
                kpiLabel: decision.kpiName,
                unit: decision.unit,
                description: '',
                sourceType,
                sourceCollection: SOURCE_CONFIGS[sourceType].collection,
                countMode: isComputed && decision.calculationType === 'count' ? (decision.countMode || 'records') : null,
                dateField: 'createdAt',
                displayKpiType: null,
                calculationType: isComputed ? decision.calculationType : 'count',
                filters: isComputed ? decision.filters : [],
                field: isComputed ? decision.field || null : null,
                numerator: null,
                denominator: null,
                contributorDepartmentIds: [],
                contributorDepartmentNames: [],
                sharedContributors: [],
                interventionIds: [],
                trackingMode: decision.trackingMode,
                reminderCadence: decision.trackingMode === 'manual' ? (decision.reminderCadence || 'quarterly') : null,
                createdAt: new Date(),
                updatedAt: new Date(),
                active: true
            }

            const ref = await addDoc(collection(db, 'kpiDefinitions'), payload)
            const kpiForAudit: KPI = { ...payload, id: ref.id }

            const quarters: Array<[number, 'q1' | 'q2' | 'q3' | 'q4']> = [[0, 'q1'], [1, 'q2'], [2, 'q3'], [3, 'q4']]
            for (const [offset, key] of quarters) {
                const value = decision[key]
                if (!value) continue
                const periodDate = input.quarterStartDate.add(offset * 3, 'month')
                const periodKey = buildPeriodKey('quarterly', periodDate)
                const targetRef = await addDoc(collection(db, 'kpiTargets'), {
                    kpiId: ref.id,
                    kpiLabel: decision.kpiName,
                    department: input.departmentName,
                    periodType: 'quarterly' as TargetPeriodType,
                    periodKey,
                    periodStartAt: parsePeriodKeyToDayjs('quarterly', periodKey).toDate(),
                    target: value,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: user?.uid || 'system',
                    updatedBy: user?.uid || 'system'
                })
                await writeTargetAuditLog({
                    action: 'created',
                    kpi: kpiForAudit,
                    targetDocId: targetRef.id,
                    periodType: 'quarterly',
                    periodKey,
                    oldTarget: null,
                    newTarget: value,
                    changeReason: `Imported from KPI letter${input.fyLabel ? ` (${input.fyLabel})` : ''}`
                })
            }
        }

        await fetchKPIs()
    }

    const openTargetsModal = async (kpi: KPI) => {
        setTargetsKpi(kpi)
        setTargetsModalOpen(true)
        setEditingTarget(null)
        setTargetModalSection('plan')
        targetForm.resetFields()
        targetForm.setFieldsValue({
            periodType: 'monthly',
            periodKey: nextTargetPeriodStart('monthly'),
            target: undefined,
            changeReason: ''
        })
        void fetchTargetsForKpi(kpi.id)
    }

    const startEditTarget = (row: KpiTargetDoc) => {
        setEditingTarget(row)
        setTargetModalSection('plan')
        targetForm.setFieldsValue({
            periodType: row.periodType,
            periodKey: parsePeriodKeyToDayjs(row.periodType, row.periodKey),
            target: row.target,
            changeReason: ''
        })
    }

    const cancelEditTarget = () => {
        setEditingTarget(null)
        targetForm.resetFields()
        targetForm.setFieldsValue({
            periodType: 'monthly',
            periodKey: nextTargetPeriodStart('monthly'),
            target: undefined,
            changeReason: ''
        })
    }

    const syncKpiLinksOnInterventions = async (
        kpiId: string,
        nextInterventionIds: string[],
        prevInterventionIds: string[]
    ) => {
        const nextSet = new Set(nextInterventionIds || [])
        const prevSet = new Set(prevInterventionIds || [])

        const toAdd = [...nextSet].filter(id => !prevSet.has(id))
        const toRemove = [...prevSet].filter(id => !nextSet.has(id))

        await Promise.all([
            ...toAdd.map(id =>
                updateDoc(doc(db, 'interventions', id), {
                    kpiIds: arrayUnion(kpiId),
                    updatedAt: new Date()
                })
            ),
            ...toRemove.map(id =>
                updateDoc(doc(db, 'interventions', id), {
                    kpiIds: arrayRemove(kpiId),
                    updatedAt: new Date()
                })
            )
        ])
    }

    const handleSaveTargetFromDrawer = async () => {
        if (!targetsKpi) {
            message.error('Choose a KPI before saving a target')
            return
        }

        try {
            const values = await targetForm.validateFields()
            setTargetsSaving(true)

            const periodType = values.periodType as TargetPeriodType
            const periodKey = buildPeriodKey(periodType, values.periodKey)
            const periodStartAt = parsePeriodKeyToDayjs(periodType, periodKey).toDate()
            const newTarget = Number(values.target || 0)
            const changeReason = String(values.changeReason || '').trim()

            if (!Number.isFinite(newTarget) || newTarget <= 0) {
                throw new Error('Target must be greater than zero')
            }

            if (editingTarget) {
                const isCommittedPeriod = targetPeriodHasStarted(editingTarget.periodType, editingTarget.periodKey)

                if (isCommittedPeriod) {
                    if (periodType !== editingTarget.periodType || periodKey !== editingTarget.periodKey) {
                        throw new Error('The period for a committed target cannot be changed')
                    }
                    if (!changeReason) {
                        throw new Error('A reason is required to record a target revision')
                    }

                    await createApprovedTargetRevision({
                        target: editingTarget,
                        kpi: targetsKpi,
                        revisedTarget: newTarget,
                        reason: changeReason
                    })

                    message.success('Target revision recorded. The committed target remains unchanged for reporting.')
                } else {
                    const duplicateSnap = await getDocs(
                        query(
                            collection(db, 'kpiTargets'),
                            where('kpiId', '==', targetsKpi.id),
                            where('periodKey', '==', periodKey)
                        )
                    )
                    const duplicate = duplicateSnap.docs.find(row => row.id !== editingTarget.id)
                    if (duplicate) {
                        throw new Error('A target already exists for that period')
                    }

                    const oldTarget = typeof editingTarget.target === 'number' ? editingTarget.target : null

                    await updateDoc(doc(db, 'kpiTargets', editingTarget.id), {
                        kpiId: targetsKpi.id,
                        kpiLabel: targetsKpi.kpiLabel,
                        department: targetsKpi.department,
                        periodType,
                        periodKey,
                        periodStartAt,
                        target: newTarget,
                        updatedAt: new Date(),
                        updatedBy: user?.uid || 'system',
                        changeReason
                    })

                    await writeTargetAuditLog({
                        action: 'updated',
                        kpi: targetsKpi,
                        targetDocId: editingTarget.id,
                        periodType,
                        periodKey,
                        oldTarget,
                        newTarget,
                        changeReason
                    })

                    message.success('Target updated')
                }
            } else {
                if (targetPeriodHasStarted(periodType, periodKey)) {
                    throw new Error('Targets must be committed before their reporting period begins')
                }

                const snap = await getDocs(
                    query(
                        collection(db, 'kpiTargets'),
                        where('kpiId', '==', targetsKpi.id),
                        where('periodKey', '==', periodKey)
                    )
                )

                if (!snap.empty) {
                    const existingDoc = snap.docs[0]
                    const existing = existingDoc.data() as any
                    await updateDoc(doc(db, 'kpiTargets', existingDoc.id), {
                        kpiId: targetsKpi.id,
                        kpiLabel: targetsKpi.kpiLabel,
                        department: targetsKpi.department,
                        periodType,
                        periodKey,
                        periodStartAt,
                        target: newTarget,
                        updatedAt: new Date(),
                        updatedBy: user?.uid || 'system',
                        changeReason
                    })

                    await writeTargetAuditLog({
                        action: 'updated',
                        kpi: targetsKpi,
                        targetDocId: existingDoc.id,
                        periodType,
                        periodKey,
                        oldTarget: typeof existing.target === 'number' ? existing.target : null,
                        newTarget,
                        changeReason
                    })

                    message.success('Existing period target updated')
                } else {
                    const ref = await addDoc(collection(db, 'kpiTargets'), {
                        kpiId: targetsKpi.id,
                        kpiLabel: targetsKpi.kpiLabel,
                        department: targetsKpi.department,
                        periodType,
                        periodKey,
                        periodStartAt,
                        target: newTarget,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        createdBy: user?.uid || 'system',
                        updatedBy: user?.uid || 'system',
                        changeReason
                    })

                    await writeTargetAuditLog({
                        action: 'created',
                        kpi: targetsKpi,
                        targetDocId: ref.id,
                        periodType,
                        periodKey,
                        oldTarget: null,
                        newTarget,
                        changeReason
                    })

                    message.success('Target added')
                }
            }

            cancelEditTarget()
            // The write has completed at this point. Refreshing the wider KPI
            // list can wait on a slow Firestore read, so do not keep Save in a
            // loading state while those views catch up.
            void fetchTargetsForKpi(targetsKpi.id).catch(err => console.error('Failed to refresh target periods', err))
            void fetchKPIs().catch(err => console.error('Failed to refresh KPI list', err))
        } catch (err: any) {
            if (err?.errorFields) return
            console.error(err)
            message.error(err?.message || 'Failed to save target')
        } finally {
            setTargetsSaving(false)
        }
    }

    const handleDeleteTarget = async (row: KpiTargetDoc) => {
        if (!targetsKpi) return
        if (targetPeriodHasStarted(row.periodType, row.periodKey)) {
            message.error('Committed targets cannot be deleted. Record a revision instead.')
            return
        }
        try {
            setTargetsDeletingId(row.id)

            await writeTargetAuditLog({
                action: 'deleted',
                kpi: targetsKpi,
                targetDocId: row.id,
                periodType: row.periodType,
                periodKey: row.periodKey,
                oldTarget: typeof row.target === 'number' ? row.target : null,
                newTarget: null,
                changeReason: 'Target deleted manually'
            })

            await deleteDoc(doc(db, 'kpiTargets', row.id))
            message.success('Target deleted')

            await fetchTargetsForKpi(targetsKpi.id)
            await fetchKPIs()

            if (editingTarget?.id === row.id) {
                cancelEditTarget()
            }
        } catch (err) {
            console.error(err)
            message.error('Failed to delete target')
        } finally {
            setTargetsDeletingId(null)
        }
    }

    const openModal = (kpi?: KPI) => {
        resetWizard()

        if (kpi) {
            setEditingKPI(kpi)
            setEditingStepPicker(true)
            setScopeSelected(true)
            setBasicStage('identity')

            const displayKpiType =
                kpi.displayKpiType ||
                (kpi.calculationType === 'count'
                    ? 'total_number'
                    : kpi.calculationType === 'sum'
                        ? 'total_amount'
                        : kpi.calculationType === 'average'
                            ? 'average'
                            : 'percentage')

            form.setFieldsValue({
                appliesToAllPrograms: !!kpi.appliesToAllPrograms,
                // Existing KPI definitions pre-date shared ownership. Treat a missing
                // flag as a department KPI so legacy definitions do not become shared.
                belongsToMe: canControlContributors ? kpi.belongsToMe !== false : true,
                sharedKpiMode: kpi.sharedKpiMode || 'allocated',
                department: kpi.department,
                leadDepartmentId: kpi.leadDepartmentId || kpi.contributorDepartmentIds?.find(id => departments.find(department => department.id === id)?.name === kpi.department) || null,
                leadDepartmentName: kpi.leadDepartmentName || kpi.department || null,
                kpiLabel: kpi.kpiLabel,
                unit: kpi.unit,
                description: kpi.description || '',
                sourceType: kpi.sourceType,
                countMode: kpi.countMode || 'records',
                displayKpiType,
                field: kpi.field || null,
                filters: Array.isArray(kpi.filters) ? kpi.filters : [],
                contributorDepartmentIds: kpi.contributorDepartmentIds || [],
                interventionIds: kpi.interventionIds || [],
                numeratorMode: kpi.numerator?.calculationType || 'count_records',
                denominatorMode: kpi.denominator?.calculationType || 'count_records',
                numeratorField: kpi.numerator?.field || null,
                denominatorField: kpi.denominator?.field || null,
                numeratorFilters: kpi.numerator?.filters || [],
                denominatorFilters: kpi.denominator?.filters || [],
                periodType: kpi.latestTargetPeriodType || 'monthly',
                periodKey: parsePeriodKeyToDayjs(kpi.latestTargetPeriodType || undefined, kpi.latestTargetPeriodKey),
                target: kpi.latestTarget ?? undefined
            })
        } else {
            setEditingKPI(null)
            setEditingStepPicker(false)
            setScopeSelected(false)
            setBasicStage(canControlContributors ? 'ownership' : 'scope')
            form.resetFields()
            form.setFieldsValue({
                programId: isAllPrograms ? null : (activeProgramId || null),
                appliesToAllPrograms: isAllPrograms,
                belongsToMe: canControlContributors ? undefined : true,
                sharedKpiMode: undefined,
                department: user?.departmentName || '',
                leadDepartmentId: null,
                leadDepartmentName: null,
                kpiLabel: '',
                unit: 'count',
                description: '',
                sourceType: undefined,
                displayKpiType: undefined,
                countMode: 'records',
                field: null,
                filters: [],
                contributorDepartmentIds: [],
                interventionIds: [],
                numeratorMode: 'count_records',
                denominatorMode: 'count_records',
                numeratorField: null,
                denominatorField: null,
                numeratorFilters: [],
                denominatorFilters: [],
                periodType: 'monthly',
                periodKey: nextTargetPeriodStart('monthly'),
                target: undefined
            })
        }

        setModalVisible(true)
    }

    const handleSubmit = async (values: any) => {
        setSaving(true)
        try {
            validateConfig(values)

            const st = values.sourceType as SourceType
            const displayType = values.displayKpiType as DisplayKpiType
            const calc: CalculationType = st === 'metrics' && displayType === 'total_number'
                ? 'sum'
                : mapDisplayTypeToCalculationType(displayType)
            const cfg = SOURCE_CONFIGS[st]

            const resolvedBelongsToMe = canControlContributors ? !!values.belongsToMe : true

            const contributorDepartmentIds =
                resolvedBelongsToMe
                    ? (user?.departmentId ? [user.departmentId] : [])
                    : (Array.isArray(values.contributorDepartmentIds) ? values.contributorDepartmentIds : [])

            const contributorDepartmentNames =
                resolvedBelongsToMe
                    ? (user?.departmentName ? [user.departmentName] : [])
                    : departments
                        .filter(d => contributorDepartmentIds.includes(d.id))
                        .map(d => String(d.name || '').trim())
                        .filter(Boolean)

            const sharedMode = resolvedBelongsToMe ? null : (values.sharedKpiMode as SharedKpiMode || 'allocated')
            const sharedContributors: SharedContributorConfig[] = resolvedBelongsToMe
                ? []
                : contributorDepartmentIds.map(departmentId => {
                    const department = departments.find(item => item.id === departmentId)
                    const requiredInterventionIds = sharedMode === 'collaborative'
                        ? (Array.isArray(values.interventionIds) ? values.interventionIds : []).filter(interventionId => {
                            const intervention = interventions.find(item => item.id === interventionId)
                            return Boolean(department && intervention && interventionBelongsToDepartment(intervention, department))
                        })
                        : []

                    return {
                        departmentId,
                        departmentName: department?.name || departmentId,
                        role: values.leadDepartmentId === departmentId ? 'lead' : 'contributor',
                        ...(sharedMode === 'collaborative' ? { requiredInterventionIds } : {})
                    }
                })

            const payload: any = {
                programId: values.appliesToAllPrograms ? null : (activeProgramId || null),
                appliesToAllPrograms: !!values.appliesToAllPrograms,
                belongsToMe: resolvedBelongsToMe,
                sharedKpiMode: sharedMode,
                leadDepartmentId: resolvedBelongsToMe ? (user?.departmentId || null) : (values.leadDepartmentId || null),
                leadDepartmentName: resolvedBelongsToMe ? (user?.departmentName || null) : (values.leadDepartmentName || values.department || null),
                department: values.department,
                kpiLabel: values.kpiLabel,
                unit: values.unit,
                description: editingKPI?.description || '',
                sourceType: st,
                sourceCollection: cfg.collection,
                countMode: calc === 'count' ? (values.countMode || 'records') : null,
                dateField: 'createdAt',
                displayKpiType: displayType,
                calculationType: calc,
                filters: displayType === 'percentage' ? [] : (Array.isArray(values.filters) ? values.filters : []),
                field: displayType === 'total_amount' || displayType === 'average' || (st === 'metrics' && displayType === 'total_number') ? values.field : null,
                numerator: displayType === 'percentage'
                    ? {
                        calculationType: values.numeratorMode,
                        field: values.numeratorMode === 'count_records' ? null : values.numeratorField,
                        filters: Array.isArray(values.numeratorFilters) ? values.numeratorFilters : []
                    }
                    : null,
                denominator: displayType === 'percentage'
                    ? {
                        calculationType: values.denominatorMode,
                        field: values.denominatorMode === 'count_records' ? null : values.denominatorField,
                        filters: Array.isArray(values.denominatorFilters) ? values.denominatorFilters : []
                    }
                    : null,
                contributorDepartmentIds,
                contributorDepartmentNames,
                sharedContributors,
                interventionIds: st === 'interventions' && Array.isArray(values.interventionIds) ? values.interventionIds : [],
                createdAt: editingKPI?.createdAt ?? new Date(),
                updatedAt: new Date(),
                active: true
            }

            let kpiId = editingKPI?.id
            let auditKpi: KPI

            if (editingKPI) {
                await updateDoc(doc(db, 'kpiDefinitions', editingKPI.id), payload)

                if (st === 'interventions') {
                    await syncKpiLinksOnInterventions(
                        editingKPI.id,
                        payload.interventionIds || [],
                        editingKPI.interventionIds || []
                    )
                } else if (editingKPI.sourceType === 'interventions' && editingKPI.interventionIds?.length) {
                    await syncKpiLinksOnInterventions(editingKPI.id, [], editingKPI.interventionIds)
                }

                auditKpi = { ...editingKPI, ...payload, id: editingKPI.id }
                message.success('KPI updated successfully')
            } else {
                const ref = await addDoc(collection(db, 'kpiDefinitions'), payload)
                kpiId = ref.id

                if (st === 'interventions' && payload.interventionIds?.length) {
                    await syncKpiLinksOnInterventions(kpiId, payload.interventionIds, [])
                }

                auditKpi = { ...payload, id: ref.id }
                message.success('KPI added successfully')
            }

            if (!editingKPI && kpiId && values.target !== undefined && values.target !== null && values.periodKey) {
                await saveInitialTarget(kpiId, values, auditKpi)
            }

            setModalVisible(false)
            form.resetFields()
            resetWizard()
            await fetchKPIs()
            await fetchInterventions()
        } catch (err: any) {
            console.error(err)
            message.error(err?.message || 'Failed to save KPI')
        } finally {
            setSaving(false)
        }
    }

    const stepFieldMap = useMemo<Record<number, string[]>>(() => {
        return {
            0: basicStage === 'ownership'
                ? ['belongsToMe']
                : basicStage === 'sharedMode'
                    ? ['sharedKpiMode', 'contributorDepartmentIds', 'leadDepartmentId']
                    : basicStage === 'scope'
                        ? ['appliesToAllPrograms']
                        : ['department', 'kpiLabel', 'unit', 'appliesToAllPrograms'],
            1: selectedSourceType === 'interventions' ? ['sourceType', 'interventionIds'] : ['sourceType'],
            2: [],
            3: selectedDisplayKpiType === 'total_number'
                ? resolvedSourceType === 'metrics'
                    ? ['displayKpiType', 'field']
                    : ['displayKpiType', 'countMode']
                : ['displayKpiType'],
            4: ['periodType', 'periodKey', 'target'],
            5: []
        }
    }, [basicStage, selectedSourceType, resolvedSourceType, canControlContributors, belongsToMe, selectedDisplayKpiType])

    const validateStep = async (s: number) => {
        if (s === 0 && basicStage === 'scope' && !scopeSelected) {
            throw new Error('Choose whether this KPI applies to all programs or the current program')
        }

        await form.validateFields(stepFieldMap[s] || [])
        const values = form.getFieldsValue(true)

        if (s === 3) {
            validateConfig(values)
        }
    }

    const onNext = async () => {
        try {
            await validateStep(step)
            if (step === 0 && basicStage === 'ownership') {
                setBasicStage(belongsToMe ? 'scope' : 'sharedMode')
                return
            }
            if (step === 0 && basicStage === 'sharedMode') {
                setBasicStage('scope')
                return
            }
            if (step === 0 && basicStage === 'scope') {
                setBasicStage('identity')
                return
            }
            if (returnToReview) {
                setReturnToReview(false)
                setStep(5)
                return
            }
            setStep(s => Math.min(s + 1, 5))
        } catch (e: any) {
            if (e?.message) message.error(e.message)
        }
    }

    const onBack = () => {
        if (editingKPI) {
            if (editingStepPicker) {
                setModalVisible(false)
                form.resetFields()
                resetWizard()
                setEditingStepPicker(false)
                return
            }
            setEditingStepPicker(true)
            return
        }
        if (step === 0 && basicStage === 'identity') {
            setBasicStage('scope')
            return
        }
        if (step === 0 && basicStage === 'scope') {
            if (!canControlContributors) {
                // Same as the step-0 catch-all below: only reachable when
                // creating a new KPI, which only ever starts from the Add
                // KPI flow's "Configure manually" card.
                setModalVisible(false)
                form.resetFields()
                resetWizard()
                setAddKpiFlowVisible(true)
                return
            }
            setBasicStage(belongsToMe ? 'ownership' : 'sharedMode')
            return
        }
        if (step === 0 && basicStage === 'sharedMode') {
            setBasicStage('ownership')
            return
        }
        if (step === 0) {
            // The manual wizard is only ever opened (for a new KPI) from the
            // Add KPI flow's "Configure manually" card - stepping back off
            // its first screen should return there, not just close outright.
            setModalVisible(false)
            form.resetFields()
            resetWizard()
            setAddKpiFlowVisible(true)
            return
        }
        setReturnToReview(false)
        setStep(s => Math.max(s - 1, 0))
    }

    const onSave = async () => {
        try {
            await validateStep(step)
            await handleSubmit(form.getFieldsValue(true))
        } catch (e: any) {
            if (e?.message) {
                message.error(e.message)
            } else if (e?.errorFields?.length) {
                message.error('Please complete the required fields in this section before updating')
            }
        }
    }

    const selectEditSection = (nextStep: number) => {
        if (!editingKPI) return

        // Targets have their own audit-aware workspace. Keeping them out of the
        // definition form prevents an ordinary KPI update from changing history.
        if (nextStep === 4) {
            setEditingStepPicker(false)
            setModalVisible(false)
            void openTargetsModal(editingKPI)
            return
        }

        setStep(nextStep)
        if (nextStep === 0) {
            setBasicStage(canControlContributors ? 'ownership' : 'scope')
        }
        if (nextStep === 2) {
            setHasConditions((form.getFieldValue('filters') || []).length > 0)
        }
        setEditingStepPicker(false)
    }

    const goToReviewSection = (targetStep: number) => {
        setStep(targetStep)
        setReturnToReview(true)
        if (targetStep === 0) {
            // Land on the last sub-stage (title/unit) rather than the start of the
            // ownership flow - "Back" still reaches the earlier sub-stages from there.
            setBasicStage('identity')
        }
        if (targetStep === 2) {
            setHasConditions((form.getFieldValue('filters') || []).length > 0)
        }
    }

    const reviewFieldLabel = (key?: string | null) => {
        if (!key) return '-'
        const pool = resolvedSourceType === 'metrics' ? metricFieldOptions : numericFields
        return pool.find(f => f.key === key)?.label || key
    }

    const reviewModeLabel = (mode: 'count_records' | 'sum_field' | 'avg_field' | undefined, fieldKey: string | undefined) => {
        if (mode === 'sum_field') return `Sum of ${reviewFieldLabel(fieldKey)}`
        if (mode === 'avg_field') return `Average of ${reviewFieldLabel(fieldKey)}`
        return 'Count of records'
    }

    const reviewCalculationSummary = () => {
        if (!selectedDisplayKpiType) return 'Not set'
        if (selectedDisplayKpiType === 'total_number') {
            return resolvedSourceType === 'metrics'
                ? `Counting ${reviewFieldLabel(selectedField)}`
                : selectedCountMode === 'distinct' ? 'Counted once per SME' : 'Every matching record counted'
        }
        if (selectedDisplayKpiType === 'total_amount' || selectedDisplayKpiType === 'average') {
            return `${DISPLAY_TYPE_LABELS[selectedDisplayKpiType]} of ${reviewFieldLabel(selectedField)}`
        }
        return `${reviewModeLabel(numeratorMode, selectedNumeratorField)} ÷ ${reviewModeLabel(denominatorMode, selectedDenominatorField)}`
    }

    const reviewSections = useMemo(() => {
        const scopeLabel = appliesToAllPrograms ? 'All Programs' : 'Current Program'
        const ownershipSummary = belongsToMe === false
            ? `Shared KPI - ${sharedKpiMode === 'collaborative' ? 'Collaborative outcome' : 'Allocated contribution'}`
            : `Department KPI${selectedDepartment ? ` - ${selectedDepartment}` : ''}`
        const periodLabel = dayjs.isDayjs(selectedPeriodKey)
            ? selectedPeriodKey.format(selectedPeriodType === 'quarterly' ? '[Q]Q YYYY' : 'MMMM YYYY')
            : '-'

        return [
            {
                step: 0,
                title: 'Ownership, scope & identity',
                icon: <ProjectOutlined style={{ color: '#1677ff' }} />,
                background: 'rgba(22,119,255,.12)',
                summary: `${kpiLabel || 'Untitled KPI'} • ${getUnitLabel(selectedUnit)} • ${scopeLabel} • ${ownershipSummary}`
            },
            {
                step: 1,
                title: 'What is measured',
                icon: <FilterOutlined style={{ color: '#52c41a' }} />,
                background: 'rgba(82,196,26,.12)',
                summary: resolvedSourceType
                    ? `${SOURCE_CONFIGS[resolvedSourceType].label}${resolvedSourceType === 'interventions' ? ` • ${selectedInterventionIds.length} intervention${selectedInterventionIds.length === 1 ? '' : 's'}` : ''}`
                    : 'Not set'
            },
            {
                step: 2,
                title: 'Conditions',
                icon: <FilterOutlined style={{ color: '#13c2c2' }} />,
                background: 'rgba(19,194,194,.12)',
                summary: prettyFilters(filters, resolvedSourceType)
            },
            {
                step: 3,
                title: 'Calculation',
                icon: <BarChartOutlined style={{ color: '#722ed1' }} />,
                background: 'rgba(114,46,209,.12)',
                summary: `${selectedDisplayKpiType ? DISPLAY_TYPE_LABELS[selectedDisplayKpiType] : 'Not set'} • ${reviewCalculationSummary()}`
            },
            {
                step: 4,
                title: 'Target',
                icon: <CalendarOutlined style={{ color: '#fa8c16' }} />,
                background: 'rgba(250,140,22,.12)',
                summary: `${selectedPeriodType === 'quarterly' ? 'Quarterly' : 'Monthly'} • ${periodLabel} • Target ${selectedTarget ?? '-'}`
            }
        ]
    }, [
        kpiLabel, selectedUnit, appliesToAllPrograms, belongsToMe, sharedKpiMode, selectedDepartment,
        resolvedSourceType, selectedInterventionIds, filters, selectedDisplayKpiType, selectedCountMode,
        selectedField, numeratorMode, denominatorMode, selectedNumeratorField, selectedDenominatorField,
        selectedPeriodType, selectedPeriodKey, selectedTarget
    ])


    const columns = useMemo<ColumnsType<KPI>>(
        () => [
            ...(isMainDept ? [{ title: 'Department', dataIndex: 'department', key: 'department', width: 150 }] : []),
            {
                title: 'Program Scope',
                key: 'programScope',
                width: 180,
                render: (_: any, record: KPI) => {
                    if (record.appliesToAllPrograms) {
                        return <Tag color='volcano'>All Programs</Tag>
                    }
                    return <Tag color='blue'>Active Program</Tag>
                }
            },
            {
                title: 'Ownership',
                key: 'belongsToMe',
                width: 140,
                render: (_: any, record: KPI) =>
                    record.belongsToMe !== false
                        ? <Tag color='green'>Belongs to me</Tag>
                        : <Tag color='cyan'>Shared</Tag>
            },
            ...isMainDept ? [{
                title: 'Contributing Departments',
                key: 'contributorDepartmentNames',
                width: 260,
                render: (_: any, record: KPI) => {
                    if (record.belongsToMe !== false) {
                        return <Tag color='green'>{record.department || 'My Department'}</Tag>
                    }

                    const names = record.contributorDepartmentNames || []
                    if (!names.length) return <Text type='secondary'>-</Text>

                    return (
                        <Space size={[4, 4]} wrap>
                            {names.map(name => (
                                <Tag key={name} color='cyan'>
                                    {name}
                                </Tag>
                            ))}
                        </Space>
                    )
                }
            }] : [],
            { title: 'KPI Label', dataIndex: 'kpiLabel', key: 'kpiLabel', width: 240 },
            {
                title: 'Unit',
                dataIndex: 'unit',
                key: 'unit',
                width: 100,
                render: (u: Unit) => {
                    const color = u === 'percent' ? 'purple' : u === 'ZAR' ? 'green' : 'blue'
                    return <Tag color={color}>{getUnitLabel(u)}</Tag>
                }
            },
            {
                title: 'Target Period',
                key: 'latestTargetPeriodKey',
                width: 170,
                render: (_: any, record: KPI) => {
                    if (!record.latestTargetPeriodKey) return <Text type='secondary'>-</Text>
                    return (
                        <Space size={6}>
                            <Tag color={record.latestTargetPeriodType === 'quarterly' ? 'geekblue' : 'blue'}>
                                {record.latestTargetPeriodType || 'monthly'}
                            </Tag>
                            <span>{record.latestTargetPeriodKey}</span>
                        </Space>
                    )
                }
            },
            {
                title: 'Target',
                key: 'latestTarget',
                width: 120,
                render: (_: any, record: KPI) =>
                    record.latestTarget === null || record.latestTarget === undefined
                        ? <Text type='secondary'>-</Text>
                        : record.latestTarget
            },
            {
                title: 'Source',
                dataIndex: 'sourceType',
                key: 'sourceType',
                width: 180,
                render: (st: SourceType) => <Tag color='geekblue'>{prettySourceLabel(st)}</Tag>
            },
            {
                title: 'KPI Type',
                key: 'displayKpiType',
                width: 180,
                render: (_: any, record: KPI) => {
                    const type = record.displayKpiType ||
                        (record.calculationType === 'count'
                            ? 'total_number'
                            : record.calculationType === 'sum'
                                ? 'total_amount'
                                : record.calculationType === 'average'
                                    ? 'average'
                                    : 'percentage')

                    const labelMap: Record<string, string> = {
                        total_number: 'Total number',
                        total_amount: 'Total amount',
                        average: 'Average',
                        percentage: 'Percentage'
                    }

                    return <Tag color='blue'>{labelMap[type]}</Tag>
                }
            },
            {
                title: 'Conditions',
                key: 'conditions',
                width: 260,
                render: (_: any, record: KPI) => {
                    if (record.displayKpiType === 'percentage' || record.calculationType === 'ratio') {
                        return (
                            <Tooltip
                                title={`Top group: ${prettyFilters(record.numerator?.filters || [], record.sourceType)} | Bottom group: ${prettyFilters(record.denominator?.filters || [], record.sourceType)}`}
                            >
                                <Tag icon={<PercentageOutlined />} color='purple'>
                                    Percentage setup
                                </Tag>
                            </Tooltip>
                        )
                    }

                    return (
                        <Tooltip title={prettyFilters(record.filters, record.sourceType)}>
                            <Tag icon={<SettingOutlined />} color='gold'>
                                {record.filters?.length ? `${record.filters.length} condition(s)` : 'No conditions'}
                            </Tag>
                        </Tooltip>
                    )
                }
            },
            {
                title: 'Actions',
                key: 'actions',
                width: 280,
                fixed: 'right',
                render: (_: any, record: KPI) => (
                    <Space>
                        <Button shape='round' icon={<EditOutlined />} onClick={() => openModal(record)}>
                            Edit
                        </Button>

                        <Button shape='round' icon={<HistoryOutlined />} onClick={() => openTargetsModal(record)}>
                            Targets
                        </Button>

                        <Popconfirm
                            placement='left'
                            title='Delete KPI'
                            description='This removes the KPI, its targets, and detaches linked interventions.'
                            okText='Delete'
                            okButtonProps={{ danger: true, loading: deletingId === record.id }}
                            cancelText='Cancel'
                            onConfirm={() => handleDelete(record)}
                        >
                            <Button shape='round' danger icon={<DeleteOutlined />} loading={deletingId === record.id}>
                                Delete
                            </Button>
                        </Popconfirm>
                    </Space>
                )
            }
        ],
        [deletingId]
    )

    const targetColumns = useMemo<ColumnsType<KpiTargetDoc>>(
        () => [
            {
                title: 'Period Type',
                dataIndex: 'periodType',
                key: 'periodType',
                width: 120,
                render: (v: TargetPeriodType) => <Tag color={v === 'quarterly' ? 'geekblue' : 'blue'}>{v}</Tag>
            },
            { title: 'Period', dataIndex: 'periodKey', key: 'periodKey', width: 130 },
            { title: 'Target', dataIndex: 'target', key: 'target', width: 120 },
            {
                title: 'Status',
                key: 'status',
                width: 120,
                render: (_: any, row: KpiTargetDoc) => {
                    const committed = targetPeriodHasStarted(row.periodType, row.periodKey)
                    return <Tag color={committed ? 'gold' : 'blue'}>{committed ? 'Committed' : 'Future'}</Tag>
                }
            },
            {
                title: 'Updated',
                key: 'updatedAt',
                width: 180,
                render: (_: any, row: KpiTargetDoc) => {
                    const raw = row.updatedAt || row.createdAt
                    if (!raw) return '-'
                    const date = raw?.seconds ? dayjs.unix(raw.seconds) : dayjs(raw)
                    return date.isValid() ? date.format('DD MMM YYYY HH:mm') : '-'
                }
            },
            { title: 'By', dataIndex: 'updatedBy', key: 'updatedBy', width: 150, render: (v, row) => v || row.createdBy || '-' },
            {
                title: 'Actions',
                key: 'actions',
                width: 190,
                render: (_: any, row: KpiTargetDoc) => {
                    const committed = targetPeriodHasStarted(row.periodType, row.periodKey)
                    return (
                        <Space>
                            <Button shape='round' icon={<EditOutlined />} onClick={() => startEditTarget(row)}>
                                {committed ? 'Revise' : 'Edit'}
                            </Button>

                            {committed ? (
                                <Tooltip title='Committed targets cannot be deleted.'>
                                    <Button shape='round' danger disabled icon={<DeleteOutlined />}>Delete</Button>
                                </Tooltip>
                            ) : (
                                <Popconfirm
                                    title='Delete target'
                                    description='Delete this future target period?'
                                    okText='Delete'
                                    okButtonProps={{ danger: true, loading: targetsDeletingId === row.id }}
                                    cancelText='Cancel'
                                    onConfirm={() => handleDeleteTarget(row)}
                                >
                                    <Button shape='round' danger icon={<DeleteOutlined />} loading={targetsDeletingId === row.id}>
                                        Delete
                                    </Button>
                                </Popconfirm>
                            )}
                        </Space>
                    )
                }
            }
        ],
        [targetsDeletingId, editingTarget]
    )

    const auditColumns = useMemo<ColumnsType<KpiTargetAuditLog>>(
        () => [
            {
                title: 'When',
                key: 'changedAt',
                width: 180,
                render: (_: any, row: KpiTargetAuditLog) => {
                    const raw = row.changedAt
                    if (!raw) return '-'
                    const date = raw?.seconds ? dayjs.unix(raw.seconds) : dayjs(raw)
                    return date.isValid() ? date.format('DD MMM YYYY HH:mm') : '-'
                }
            },
            { title: 'Action', dataIndex: 'action', key: 'action', width: 110, render: v => <Tag>{v}</Tag> },
            { title: 'Period', dataIndex: 'periodKey', key: 'periodKey', width: 120 },
            { title: 'Old Target', dataIndex: 'oldTarget', key: 'oldTarget', width: 110, render: v => v ?? '-' },
            { title: 'New Target', dataIndex: 'newTarget', key: 'newTarget', width: 110, render: v => v ?? '-' },
            { title: 'Reason', dataIndex: 'changeReason', key: 'changeReason', ellipsis: true },
            { title: 'By', dataIndex: 'changedBy', key: 'changedBy', width: 150, render: v => v || '-' }
        ],
        []
    )

    return (
        <div style={{ padding: '5px 24px' }}>
                    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} md={12}>
                    <MotionCard.Metric
                        icon={<NumberOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
                        iconBg="rgba(22,119,255,0.12)"
                        title="Total KPIs"
                        value={kpis.length}
                        subtitle={isMainDept ? 'Across every department you can monitor' : 'Available to your department'}
                        loading={loading}
                        wrapperStyle={{ minHeight: 76 }}
                    />
                </Col>

                <Col xs={24} md={12}>
                    <MotionCard.Metric
                        icon={<LineChartOutlined style={{ color: '#faad14', fontSize: 18 }} />}
                        iconBg="rgba(250,173,20,0.12)"
                        title="Units"
                        value={new Set(kpis.map(k => k.unit)).size}
                        subtitle='Measurement types in use'
                        loading={loading}
                        wrapperStyle={{ minHeight: 76 }}
                    />
                </Col>
            </Row>

            <DashboardFilterBar marginBottom={16}>
                <Row gutter={[10, 10]}>
                    <Col xs={24} lg={18}>
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder='Search KPI name, department, source, or notes'
                            value={kpiSearch}
                            onChange={event => {
                                setKpiSearch(event.target.value)
                                setKpiListPage(1)
                            }}
                        />
                    </Col>
                    <Col xs={24} lg={6}>
                        <Button shape='round' block type='primary' icon={<PlusOutlined />} onClick={() => setAddKpiFlowVisible(true)}>
                            Add KPI
                        </Button>
                    </Col>
                </Row>
            </DashboardFilterBar>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                <Row gutter={[16, 16]} align='top'>
                    <Col xs={24} lg={6}>
                        <MotionCard>
                            <div>
                                {loading ? (
                                    <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                        {Array.from({ length: kpiListPageSize }).map((_, index) => (
                                            <Skeleton key={index} active avatar paragraph={{ rows: 1 }} />
                                        ))}
                                    </Space>
                                ) : (
                                    <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                        {pagedKpis.map(kpi => {
                                            const isSelected = selectedKpi?.id === kpi.id
                                            return (
                                                <Card
                                                    key={kpi.id}
                                                    size='small'
                                                    hoverable
                                                    onClick={() => setSelectedKpiId(kpi.id)}
                                                    style={{
                                                        borderColor: isSelected ? token.colorPrimary : undefined,
                                                        background: isSelected
                                                            ? token.colorPrimaryBg
                                                            : undefined,
                                                        boxShadow: isSelected ? token.boxShadowSecondary : undefined,
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    <Text strong ellipsis={{ tooltip: kpi.kpiLabel }} style={{ display: 'block', fontSize: 15 }}>
                                                        {kpi.kpiLabel}
                                                    </Text>
                                                    <Space size={4} wrap style={{ marginTop: 8 }}>
                                                        <Tag color={kpi.appliesToAllPrograms ? 'volcano' : 'blue'}>
                                                            {kpi.appliesToAllPrograms ? 'All Programs' : 'Active Program'}
                                                        </Tag>
                                                        {kpi.trackingMode === 'manual' && <Tag color='orange'>Manual</Tag>}
                                                    </Space>
                                                </Card>
                                            )
                                        })}
                                        {!pagedKpis.length && <Empty description='No KPIs yet.' />}
                                    </Space>
                                )}
                            </div>

                            <Pagination
                                current={kpiListPage}
                                total={orderedKpis.length}
                                pageSize={kpiListPageSize}
                                showSizeChanger={false}
                                hideOnSinglePage
                                size='small'
                                style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}
                                onChange={page => setKpiListPage(page)}
                            />
                        </MotionCard>
                    </Col>

                    <Col xs={24} lg={18}>
                        <MotionCard>
                            <div style={{ paddingBottom: 12 }}>
                                {loading ? (
                                    <Space direction='vertical' size={20} style={{ width: '100%' }}>
                                        <Skeleton active title={{ width: '45%' }} paragraph={{ rows: 1 }} />
                                        <Row gutter={[16, 16]}>
                                            {Array.from({ length: 6 }).map((_, index) => (
                                                <Col key={index} xs={24} sm={12} xl={8}>
                                                    <Skeleton active paragraph={{ rows: 1 }} />
                                                </Col>
                                            ))}
                                        </Row>
                                    </Space>
                                ) : selectedKpi ? (
                                    <Space direction='vertical' size={14} style={{ width: '100%' }}>
                                        <div
                                            style={{
                                                padding: '9px 12px',
                                                borderRadius: 10,
                                                background: token.colorPrimaryBg,
                                                border: `1px solid ${token.colorPrimaryBorder}`
                                            }}
                                        >
                                            <Space align='center' size={10} style={{ width: '100%', justifyContent: 'space-between' }}>
                                                <Space align='center' size={10} style={{ minWidth: 0 }}>
                                                    <MotionCard.IconChip
                                                        size={34}
                                                        bg={token.colorPrimaryBgHover}
                                                        icon={<AimOutlined style={{ color: token.colorPrimary, fontSize: 16 }} />}
                                                    />
                                                    <div style={{ minWidth: 0 }}>
                                                        <Text strong ellipsis={{ tooltip: selectedKpi.kpiLabel }} style={{ display: 'block', fontSize: 15 }}>
                                                            {selectedKpi.kpiLabel}
                                                        </Text>
                                                        <Text type='secondary' ellipsis={{ tooltip: selectedKpi.description }} style={{ display: 'block', fontSize: 12 }}>
                                                            {selectedKpi.description || 'No notes have been added for this KPI.'}
                                                        </Text>
                                                    </div>
                                                </Space>
                                                <Tag color={selectedKpi.appliesToAllPrograms ? 'volcano' : 'blue'} style={{ marginInlineEnd: 0 }}>
                                                    {selectedKpi.appliesToAllPrograms ? 'All Programs' : 'Current Program'}
                                                </Tag>
                                            </Space>
                                        </div>

                                        <Row gutter={[10, 10]}>
                                            {[
                                                ...(isMainDept ? [{ label: 'Department', value: compactDepartmentLabel(selectedKpi.department), tooltip: selectedKpi.department, icon: <ApartmentOutlined />, color: '#722ed1', background: 'rgba(114,46,209,.10)' }] : []),
                                                { label: 'Ownership', value: selectedKpi.belongsToMe !== false ? 'Owned by you' : 'Shared KPI', icon: <TeamOutlined />, color: '#13a8a8', background: 'rgba(19,168,168,.10)' },
                                                { label: 'Source', value: prettySourceLabel(selectedKpi.sourceType), icon: <DatabaseOutlined />, color: '#1677ff', background: 'rgba(22,119,255,.10)' },
                                                { label: 'Calculation', value: getKpiTypeLabel(selectedKpi), icon: <BarChartOutlined />, color: '#1677ff', background: 'rgba(22,119,255,.10)' },
                                                { label: 'Unit', value: getUnitLabel(selectedKpi.unit), icon: <LineChartOutlined />, color: selectedKpi.unit === 'percent' ? '#722ed1' : selectedKpi.unit === 'ZAR' ? '#52c41a' : '#1677ff', background: selectedKpi.unit === 'percent' ? 'rgba(114,46,209,.10)' : selectedKpi.unit === 'ZAR' ? 'rgba(82,196,26,.10)' : 'rgba(22,119,255,.10)' },
                                                { label: 'Committed target', value: selectedKpi.latestTarget ?? 'Not set', icon: <AimOutlined />, color: '#fa8c16', background: 'rgba(250,140,22,.10)' },
                                                { label: 'Target period', value: selectedKpi.latestTargetPeriodKey || 'Not set', icon: <CalendarOutlined />, color: '#fa8c16', background: 'rgba(250,140,22,.10)' },
                                                { label: 'Conditions', value: selectedKpi.filters?.length ? `${selectedKpi.filters.length} condition${selectedKpi.filters.length === 1 ? '' : 's'}` : 'All matching records', icon: <FilterOutlined />, color: '#d48806', background: 'rgba(250,173,20,.12)', tooltip: prettyFilters(selectedKpi.filters || [], selectedKpi.sourceType) }
                                            ].map(item => (
                                                <Col xs={24} sm={12} xl={8} key={item.label}>
                                                    <Tooltip title={item.tooltip}>
                                                        <Card size='small' style={{ height: '100%', borderRadius: 10, background: token.colorFillAlter }} bodyStyle={{ padding: '10px 12px' }}>
                                                            <Space size={9} align='center'>
                                                                <MotionCard.IconChip size={30} bg={item.background} icon={React.cloneElement(item.icon, { style: { color: item.color } })} />
                                                                <div>
                                                                    <Text type='secondary' style={{ display: 'block', fontSize: 11, lineHeight: 1.2 }}>{item.label}</Text>
                                                                    <Text strong ellipsis={{ tooltip: String(item.value) }} style={{ display: 'block', fontSize: 13, marginTop: 2 }}>{item.value}</Text>
                                                                </div>
                                                            </Space>
                                                        </Card>
                                                    </Tooltip>
                                                </Col>
                                            ))}
                                        </Row>

                                        {isMainDept && selectedKpi.belongsToMe === false && (selectedKpi.contributorDepartmentNames || []).length > 0 && (
                                            <div>
                                                <Text type='secondary'>Contributing departments</Text>
                                                <div style={{ marginTop: 8 }}>
                                                    <Space size={[4, 4]} wrap>
                                                        {selectedKpi.contributorDepartmentNames?.map(name => (
                                                            <Tag key={name} color='cyan'>{name}</Tag>
                                                        ))}
                                                    </Space>
                                                </div>
                                            </div>
                                        )}
                                    </Space>
                                ) : (
                                    <Empty description={loading ? 'Loading KPIs...' : 'Select a KPI to view its details.'} />
                                )}
                            </div>
                            {selectedKpi && (
                                <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 12 }}>
                                    <Row gutter={[10, 10]}>
                                        <Col xs={24} sm={8}>
                                            <Button shape='round' block icon={<EditOutlined />} onClick={() => openModal(selectedKpi)}>
                                                Edit KPI
                                            </Button>
                                        </Col>
                                        <Col xs={24} sm={8}>
                                            <Button shape='round' block type='primary' icon={<HistoryOutlined />} onClick={() => openTargetsModal(selectedKpi)}>
                                                Manage Targets
                                            </Button>
                                        </Col>
                                        <Col xs={24} sm={8}>
                                            <Popconfirm
                                                title='Delete KPI'
                                                description='This removes the KPI, its targets, and detaches linked interventions.'
                                                okText='Delete'
                                                okButtonProps={{ danger: true, loading: deletingId === selectedKpi.id }}
                                                cancelText='Cancel'
                                                onConfirm={() => handleDelete(selectedKpi)}
                                            >
                                                <Button shape='round' block danger icon={<DeleteOutlined />} loading={deletingId === selectedKpi.id}>
                                                    Delete KPI
                                                </Button>
                                            </Popconfirm>
                                        </Col>
                                    </Row>
                                </div>
                            )}
                        </MotionCard>
                    </Col>
                </Row>
            </motion.div>

            <Modal
                title={editingKPI ? 'Edit KPI' : 'Add KPI'}
                open={modalVisible}
                onCancel={() => {
                    setModalVisible(false)
                    form.resetFields()
                    resetWizard()
                    setEditingStepPicker(false)
                }}
                centered
                footer={
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                        <Button block shape='round' onClick={onBack} disabled={saving} icon={<LeftOutlined />}>
                            Back
                        </Button>
                        {editingKPI ? (
                            <Button block shape='round' type='primary' onClick={onSave} loading={saving} icon={<SaveOutlined />}>
                                Update KPI
                            </Button>
                        ) : step < 5 ? (
                            <Button block shape='round' type='primary' onClick={onNext} disabled={saving} icon={<RightOutlined />}>
                                Next
                            </Button>
                        ) : (
                            <Button block shape='round' type='primary' onClick={onSave} loading={saving} icon={<SaveOutlined />}>
                                Add KPI
                            </Button>
                        )}
                    </div>
                }
                width={960}
                destroyOnClose
                confirmLoading={saving}
            >
                <Form layout='vertical' form={form} onFinish={handleSubmit}>
                <div style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
                    {editingKPI && editingStepPicker ? (
                        <div style={{ padding: '8px 0 16px' }}>
                            <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 24px' }}>
                                What would you like to update?
                            </Text>
                            <Row gutter={[12, 12]}>
                                {[
                                    { step: 0, title: 'Ownership, scope & identity', detail: 'Ownership, program scope, title, and unit.', icon: <ProjectOutlined style={{ color: '#1677ff' }} />, background: 'rgba(22,119,255,.12)' },
                                    { step: 1, title: 'What is measured', detail: 'Source and interventions.', icon: <FilterOutlined style={{ color: '#52c41a' }} />, background: 'rgba(82,196,26,.12)' },
                                    { step: 2, title: 'Conditions', detail: 'Narrow this KPI to a subset of records.', icon: <FilterOutlined style={{ color: '#13c2c2' }} />, background: 'rgba(19,194,194,.12)' },
                                    { step: 3, title: 'Calculation', detail: 'Counting, value, or percentage setup.', icon: <BarChartOutlined style={{ color: '#722ed1' }} />, background: 'rgba(114,46,209,.12)' },
                                    { step: 4, title: 'Manage targets', detail: 'Plan future targets or revise a committed one.', icon: <CalendarOutlined style={{ color: '#fa8c16' }} />, background: 'rgba(250,140,22,.12)' }
                                ].map(option => {
                                    const choiceKey = `edit-step-${option.step}`
                                    const hovered = hoveredChoice === choiceKey
                                    return (
                                        <Col xs={24} sm={option.step === 4 ? 24 : 12} key={option.step}>
                                            <Card
                                                hoverable role='button' tabIndex={0}
                                                onClick={() => selectEditSection(option.step)}
                                                onKeyDown={event => {
                                                    if (event.key !== 'Enter' && event.key !== ' ') return
                                                    event.preventDefault()
                                                    selectEditSection(option.step)
                                                }}
                                                onMouseEnter={() => setHoveredChoice(choiceKey)}
                                                onMouseLeave={() => setHoveredChoice(null)}
                                                style={{ cursor: 'pointer', borderColor: hovered ? token.colorPrimaryBorderHover : token.colorBorder, background: hovered ? token.colorPrimaryBg : token.colorBgContainer, transform: hovered ? 'translateY(-3px)' : 'translateY(0)', transition: 'all .2s ease' }}
                                                bodyStyle={{ padding: 18 }}
                                            >
                                                <Space size={12} align='center'>
                                                    <MotionCard.IconChip size={42} bg={option.background} icon={option.icon} />
                                                    <div>
                                                        <Text strong style={{ display: 'block', fontSize: 16 }}>{option.title}</Text>
                                                        <Text type='secondary'>{option.detail}</Text>
                                                    </div>
                                                </Space>
                                            </Card>
                                        </Col>
                                    )
                                })}
                            </Row>
                        </div>
                    ) : (
                        <>
                            <StepPanel visible={step === 0}>
                                <Form.Item name='appliesToAllPrograms' hidden><Input /></Form.Item>
                                <Form.Item name='unit' hidden rules={[{ required: true, message: 'Choose a unit' }]}><Input /></Form.Item>
                                <Form.Item name='belongsToMe' hidden rules={[{ required: true, message: 'Choose KPI ownership' }]}><Input /></Form.Item>
                                <Form.Item name='sharedKpiMode' hidden rules={[{ required: !belongsToMe, message: 'Choose how departments work together' }]}><Input /></Form.Item>
                                <Form.Item name='leadDepartmentId' hidden><Input /></Form.Item>
                                <Form.Item name='leadDepartmentName' hidden><Input /></Form.Item>

                                <Space direction='vertical' size={16} style={{ width: '100%' }}>
                                    {basicStage === 'ownership' && (
                                        <div style={{ textAlign: 'center', paddingTop: 8 }}>
                                            <Text strong style={{ display: 'block', fontSize: 24, marginBottom: 8 }}>
                                                <KpiTypingPrompt text='Who owns this KPI?' />
                                            </Text>
                                            <Text type='secondary'>Choose whether one department owns the result or several departments share it.</Text>
                                            <Row gutter={[12, 12]} style={{ marginTop: 20, textAlign: 'left' }}>
                                                {[
                                                    { value: true, title: 'Department KPI', detail: 'One department owns and is measured against this KPI.', icon: <ProjectOutlined style={{ color: '#1677ff', fontSize: 20 }} />, background: 'rgba(22,119,255,.12)' },
                                                    { value: false, title: 'Shared KPI', detail: 'Several departments contribute to one shared result.', icon: <TeamOutlined style={{ color: '#722ed1', fontSize: 20 }} />, background: 'rgba(114,46,209,.12)' }
                                                ].map(option => {
                                                    const selected = belongsToMe === option.value
                                                    const choiceKey = `ownership-${option.value}`
                                                    const hovered = hoveredChoice === choiceKey
                                                    const disabled = !option.value && !canControlContributors
                                                    const choose = () => {
                                                        if (disabled) return
                                                        form.setFieldsValue({ belongsToMe: option.value, sharedKpiMode: option.value ? null : 'allocated', department: option.value ? (user?.departmentName || '') : undefined, leadDepartmentId: option.value ? (user?.departmentId || null) : null, leadDepartmentName: option.value ? (user?.departmentName || null) : null, contributorDepartmentIds: option.value ? (user?.departmentId ? [user.departmentId] : []) : [] })
                                                    }
                                                    return <Col xs={24} sm={12} key={option.title}>
                                                        <Card hoverable={!disabled} role='button' tabIndex={disabled ? -1 : 0} onClick={choose} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !disabled) { event.preventDefault(); choose() } }} onMouseEnter={() => !disabled && setHoveredChoice(choiceKey)} onMouseLeave={() => setHoveredChoice(null)} style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1, border: `2px solid ${selected ? token.colorPrimary : hovered ? token.colorPrimaryBorderHover : token.colorBorder}`, background: selected ? token.colorPrimaryBg : hovered ? token.colorFillAlter : token.colorBgContainer, boxShadow: selected || hovered ? token.boxShadowSecondary : token.boxShadowTertiary, transform: hovered ? 'translateY(-3px)' : 'translateY(0)', transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease' }}>
                                                            <Space align='start' size={12}><MotionCard.IconChip size={42} bg={option.background} icon={option.icon} /><div><Text strong style={{ display: 'block' }}>{option.title}</Text><Text type='secondary'>{disabled ? 'Shared KPIs are configured by a main department.' : option.detail}</Text></div></Space>
                                                        </Card>
                                                    </Col>
                                                })}
                                            </Row>
                                        </div>
                                    )}

                                    {basicStage === 'sharedMode' && (
                                        <div style={{ textAlign: 'center', paddingTop: 8 }}>
                                            <Text strong style={{ display: 'block', fontSize: 24, marginBottom: 8 }}>
                                                <KpiTypingPrompt text='How will departments work together?' />
                                            </Text>
                                            <Text type='secondary'>Choose how shared work becomes performance.</Text>
                                            <Row gutter={[12, 12]} style={{ marginTop: 20, textAlign: 'left' }}>
                                                {[
                                                    { value: 'allocated' as SharedKpiMode, title: 'Allocated contribution', detail: 'Each department owns a defined portion of the target.', icon: <BarChartOutlined style={{ color: '#1677ff', fontSize: 20 }} />, background: 'rgba(22,119,255,.12)' },
                                                    { value: 'collaborative' as SharedKpiMode, title: 'Collaborative outcome', detail: 'An outcome counts only when every required department completes its part.', icon: <TeamOutlined style={{ color: '#52c41a', fontSize: 20 }} />, background: 'rgba(82,196,26,.12)' }
                                                ].map(option => {
                                                    const selected = sharedKpiMode === option.value
                                                    const choiceKey = `shared-mode-${option.value}`
                                                    const hovered = hoveredChoice === choiceKey
                                                    return <Col xs={24} sm={12} key={option.value} style={{ display: 'flex' }}>
                                                        <Card hoverable role='button' tabIndex={0} onClick={() => form.setFieldsValue({ sharedKpiMode: option.value })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); form.setFieldsValue({ sharedKpiMode: option.value }) } }} onMouseEnter={() => setHoveredChoice(choiceKey)} onMouseLeave={() => setHoveredChoice(null)} style={{ cursor: 'pointer', width: '100%', height: '100%', border: `2px solid ${selected ? token.colorPrimary : hovered ? token.colorPrimaryBorderHover : token.colorBorder}`, background: selected ? token.colorPrimaryBg : hovered ? token.colorFillAlter : token.colorBgContainer, boxShadow: selected || hovered ? token.boxShadowSecondary : token.boxShadowTertiary, transform: hovered ? 'translateY(-3px)' : 'translateY(0)', transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease' }}>
                                                            <Space align='start' size={12}><MotionCard.IconChip size={42} bg={option.background} icon={option.icon} /><div><Text strong style={{ display: 'block' }}>{option.title}</Text><Text type='secondary'>{option.detail}</Text></div></Space>
                                                        </Card>
                                                    </Col>
                                                })}
                                            </Row>
                                            <Form.Item name='contributorDepartmentIds' hidden rules={[{ required: true, message: 'Select at least one contributing department' }]}><Input /></Form.Item>
                                            <div style={{ marginTop: 20, textAlign: 'left' }}>
                                                <Text strong style={{ display: 'block', fontSize: 16 }}>Which departments contribute?</Text>
                                                <Text type='secondary'>Add each department required for this shared KPI.</Text>
                                                <Select
                                                    value={undefined}
                                                    loading={departmentsLoading}
                                                    placeholder='Add a contributing department'
                                                    optionFilterProp='label'
                                                    style={{ width: '100%', marginTop: 10 }}
                                                    onChange={departmentId => {
                                                        const departmentOption = departments.find(item => item.id === departmentId)
                                                        form.setFieldsValue({
                                                            contributorDepartmentIds: [...selectedContributorDepartmentIdsRaw, departmentId],
                                                            department: selectedContributorDepartmentIdsRaw.length === 0 ? departmentOption?.name : form.getFieldValue('department'),
                                                            leadDepartmentId: selectedContributorDepartmentIdsRaw.length === 0 ? departmentId : leadDepartmentId,
                                                            leadDepartmentName: selectedContributorDepartmentIdsRaw.length === 0 ? departmentOption?.name : form.getFieldValue('leadDepartmentName')
                                                        })
                                                    }}
                                                    options={departments
                                                        .filter(departmentOption => !selectedContributorDepartmentIdsRaw.includes(departmentOption.id))
                                                        .map(departmentOption => ({ value: departmentOption.id, label: departmentOption.name }))}
                                                />
                                                <div style={{ marginTop: 12 }}>
                                                    {selectedContributorDepartmentIdsRaw.length === 0 ? (
                                                        <Text type='secondary'>No contributing departments added yet.</Text>
                                                    ) : (
                                                        <Row gutter={[10, 10]}>
                                                            {selectedContributorDepartmentIdsRaw.map(departmentId => {
                                                                const departmentOption = departments.find(item => item.id === departmentId)
                                                                if (!departmentOption) return null
                                                                const isLead = leadDepartmentId === departmentOption.id
                                                                const removeDepartment = () => {
                                                                    const nextIds = selectedContributorDepartmentIdsRaw.filter(id => id !== departmentId)
                                                                    const nextLead = isLead ? departments.find(item => item.id === nextIds[0]) : undefined
                                                                    form.setFieldsValue({ contributorDepartmentIds: nextIds, leadDepartmentId: isLead ? (nextLead?.id || null) : leadDepartmentId, leadDepartmentName: isLead ? (nextLead?.name || null) : form.getFieldValue('leadDepartmentName'), department: isLead ? (nextLead?.name || '') : form.getFieldValue('department') })
                                                                }
                                                                return <Col xs={24} sm={12} key={departmentId}>
                                                                    <Card size='small' style={{ border: `2px solid ${isLead ? token.colorPrimary : token.colorBorderSecondary}`, background: token.colorBgContainer, boxShadow: isLead ? token.boxShadowSecondary : 'none' }} bodyStyle={{ padding: '10px 12px' }}>
                                                                        <Space align='center' style={{ width: '100%', justifyContent: 'space-between' }}>
                                                                            <Space size={10}><MotionCard.IconChip size={32} bg={isLead ? token.colorPrimaryBgHover : token.colorFillAlter} icon={<TeamOutlined style={{ color: isLead ? token.colorPrimary : token.colorTextSecondary }} />} /><div><Space size={6}><Text strong={isLead} style={{ display: 'block' }}>{departmentOption.name}</Text>{isLead ? <Tag color='blue' style={{ margin: 0 }}>Lead</Tag> : null}</Space><Text type='secondary' style={{ display: 'block', fontSize: 12 }}>{isLead ? 'Accountable department' : 'Contributing department'}</Text></div></Space>
                                                                            <Space size={2}>
                                                                                {!isLead && <Button type='primary' shape='round' size='small' onClick={() => form.setFieldsValue({ leadDepartmentId: departmentOption.id, leadDepartmentName: departmentOption.name, department: departmentOption.name })}>Make lead</Button>}
                                                                                <Button danger shape='round' size='small' icon={<MinusCircleOutlined />} onClick={removeDepartment}>Remove</Button>
                                                                            </Space>
                                                                        </Space>
                                                                    </Card>
                                                                </Col>
                                                            })}
                                                        </Row>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ display: basicStage === 'scope' ? 'block' : 'none', textAlign: 'center', paddingTop: 8 }}>
                                        <Text type='secondary' style={{ display: 'block', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}>
                                            Step 1 of 6
                                        </Text>
                                        <Text strong style={{ display: 'block', fontSize: 24, marginTop: 8, minHeight: 32 }}>
                                            <KpiTypingPrompt text='Should this KPI apply to every program?' />
                                        </Text>
                                        <div style={{ marginTop: 4 }}>
                                            <Text type='secondary'>Choose the scope before defining the KPI.</Text>
                                        </div>
                                    </div>

                                    <Row gutter={[12, 12]} style={{ display: basicStage === 'scope' ? 'flex' : 'none' }}>
                                        {[
                                            {
                                                value: true,
                                                title: 'All Programs',
                                                detail: 'Use one KPI across every program.',
                                                icon: <ApartmentOutlined style={{ color: '#fa8c16', fontSize: 20 }} />,
                                                background: 'rgba(250,140,22,.12)'
                                            },
                                            {
                                                value: false,
                                                title: 'Current Program',
                                                detail: 'Use this KPI only for the active program.',
                                                icon: <ProjectOutlined style={{ color: '#1677ff', fontSize: 20 }} />,
                                                background: 'rgba(22,119,255,.12)'
                                            }
                                        ].map(option => {
                                            const selected = scopeSelected && appliesToAllPrograms === option.value
                                            const choiceKey = `scope-${option.value}`
                                            const hovered = hoveredChoice === choiceKey
                                            return (
                                                <Col xs={24} sm={12} key={option.title}>
                                                    <Card
                                                        hoverable
                                                        role='button'
                                                        tabIndex={0}
                                                        onClick={() => {
                                                            setScopeSelected(true)
                                                            form.setFieldsValue({
                                                                appliesToAllPrograms: option.value,
                                                                programId: option.value ? null : (activeProgramId || null)
                                                            })
                                                        }}
                                                        onKeyDown={event => {
                                                            if (event.key !== 'Enter' && event.key !== ' ') return
                                                            event.preventDefault()
                                                            setScopeSelected(true)
                                                            form.setFieldsValue({
                                                                appliesToAllPrograms: option.value,
                                                                programId: option.value ? null : (activeProgramId || null)
                                                            })
                                                        }}
                                                        onMouseEnter={() => setHoveredChoice(choiceKey)}
                                                        onMouseLeave={() => setHoveredChoice(null)}
                                                        style={{
                                                            cursor: 'pointer',
                                                            border: `2px solid ${selected ? token.colorPrimary : hovered ? token.colorPrimaryBorderHover : token.colorBorder}`,
                                                            background: selected ? token.colorPrimaryBg : hovered ? token.colorFillAlter : token.colorBgContainer,
                                                            boxShadow: selected || hovered ? token.boxShadowSecondary : token.boxShadowTertiary,
                                                            transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
                                                            transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease'
                                                        }}
                                                    >
                                                        <Space align='start' size={12}>
                                                            <MotionCard.IconChip size={40} bg={option.background} icon={option.icon} />
                                                            <div>
                                                                <Text strong style={{ display: 'block' }}>{option.title}</Text>
                                                                <Text type='secondary'>{option.detail}</Text>
                                                            </div>
                                                        </Space>
                                                    </Card>
                                                </Col>
                                            )
                                        })}
                                    </Row>

                                    {basicStage === 'identity' && (
                                        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                                            <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 20, marginBottom: 12 }}>
                                                <KpiTypingPrompt text='What is this KPI called?' />
                                            </Text>
                                            <Form.Item name='kpiLabel' rules={[{ required: true, message: 'Enter a KPI title' }]}>
                                                <Input autoFocus placeholder='For example, Jobs Created' />
                                            </Form.Item>
                                        </motion.div>
                                    )}

                                    {basicStage === 'identity' && String(kpiLabel || '').trim().length >= 1 && (
                                        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                                            <Text type='secondary' style={{ display: 'block', textAlign: 'center', fontSize: 14, fontWeight: 600 }}>
                                                Choose the reporting unit
                                            </Text>
                                            <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
                                                {[
                                                    { value: 'count' as Unit, title: 'Count', detail: 'A number of records or items.', icon: <NumberOutlined style={{ color: '#1677ff', fontSize: 20 }} />, background: 'rgba(22,119,255,.12)' },
                                                    { value: 'ZAR' as Unit, title: 'Amount', detail: 'A monetary value in ZAR.', icon: <DollarOutlined style={{ color: '#52c41a', fontSize: 20 }} />, background: 'rgba(82,196,26,.12)' },
                                                    { value: 'percent' as Unit, title: 'Percentage', detail: 'A ratio or achievement rate.', icon: <PercentageOutlined style={{ color: '#722ed1', fontSize: 20 }} />, background: 'rgba(114,46,209,.12)' }
                                                ].map(option => {
                                                    const selected = selectedUnit === option.value
                                                    const choiceKey = `unit-${option.value}`
                                                    const hovered = hoveredChoice === choiceKey
                                                    return (
                                                        <Col xs={24} sm={8} key={option.value}>
                                                            <Card
                                                                hoverable
                                                                role='button'
                                                                tabIndex={0}
                                                                onClick={() => {
                                                                    const amountNeedsMetricSource = option.value === 'ZAR' && selectedSourceType && !SOURCE_CONFIGS[selectedSourceType].fields.some(field => field.isNumeric)
                                                                    if (amountNeedsMetricSource) {
                                                                        message.info('Amount KPIs use Business Metrics. Choose that source next to continue.')
                                                                    }
                                                                    form.setFieldsValue({
                                                                        unit: option.value,
                                                                        ...(amountNeedsMetricSource ? { sourceType: undefined, interventionIds: [] } : {}),
                                                                        displayKpiType: undefined,
                                                                        field: null,
                                                                        filters: [],
                                                                        numeratorFilters: [],
                                                                        denominatorFilters: [],
                                                                        numeratorField: null,
                                                                        denominatorField: null,
                                                                        numeratorMode: 'count_records',
                                                                        denominatorMode: 'count_records'
                                                                    })
                                                                    applySourceOrUnitDefaults()
                                                                }}
                                                                onKeyDown={event => {
                                                                    if (event.key !== 'Enter' && event.key !== ' ') return
                                                                    event.preventDefault()
                                                                    const amountNeedsMetricSource = option.value === 'ZAR' && selectedSourceType && !SOURCE_CONFIGS[selectedSourceType].fields.some(field => field.isNumeric)
                                                                    if (amountNeedsMetricSource) {
                                                                        message.info('Amount KPIs use Business Metrics. Choose that source next to continue.')
                                                                    }
                                                                    form.setFieldsValue({ unit: option.value, ...(amountNeedsMetricSource ? { sourceType: undefined, interventionIds: [] } : {}) })
                                                                    applySourceOrUnitDefaults()
                                                                }}
                                                                onMouseEnter={() => setHoveredChoice(choiceKey)}
                                                                onMouseLeave={() => setHoveredChoice(null)}
                                                                style={{
                                                                    cursor: 'pointer',
                                                                    height: '100%',
                                                                    border: `2px solid ${selected ? token.colorPrimary : hovered ? token.colorPrimaryBorderHover : token.colorBorder}`,
                                                                    background: selected ? token.colorPrimaryBg : hovered ? token.colorFillAlter : token.colorBgContainer,
                                                                    boxShadow: selected || hovered ? token.boxShadowSecondary : token.boxShadowTertiary,
                                                                    transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
                                                                    transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease'
                                                                }}
                                                            >
                                                                <Space align='start' size={12}>
                                                                    <MotionCard.IconChip size={40} bg={option.background} icon={option.icon} />
                                                                    <div>
                                                                        <Text strong style={{ display: 'block' }}>{option.title}</Text>
                                                                        <Text type='secondary'>{option.detail}</Text>
                                                                    </div>
                                                                </Space>
                                                            </Card>
                                                        </Col>
                                                    )
                                                })}
                                            </Row>
                                        </motion.div>
                                    )}

                                    <Form.Item
                                        name='department'
                                        hidden={!isMainDept || !belongsToMe || basicStage !== 'identity'}
                                        label='Department'
                                        rules={[{ required: true, message: 'Select a department' }]}
                                    >
                                        <Select
                                            loading={departmentsLoading}
                                            placeholder='Select department'
                                            optionFilterProp='label'
                                            options={departments.map(d => ({ value: d.name, label: d.name }))}
                                        />
                                    </Form.Item>

                                </Space>
                            </StepPanel>

                            <StepPanel visible={step === 1}>
                                <Form.Item name='sourceType' hidden rules={[{ required: true, message: 'Choose what you are measuring' }]}><Input /></Form.Item>
                                <div style={{ width: '100%' }}>
                                    <Text type='secondary' style={{ display: 'block', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}>
                                        Step 2 of 6
                                    </Text>
                                    <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 24px', minHeight: 32 }}>
                                        <KpiTypingPrompt text='What are you measuring?' />
                                    </Text>
                                    <Row gutter={[12, 12]}>
                                        {[
                                            { value: 'applications' as SourceType, title: 'Applications', detail: 'Applicant and programme records.', icon: <FileTextOutlined style={{ color: '#1677ff', fontSize: 20 }} />, background: 'rgba(22,119,255,.12)' },
                                            { value: 'interventions' as SourceType, title: 'Interventions', detail: 'Delivery and support activity.', icon: <AimOutlined style={{ color: '#52c41a', fontSize: 20 }} />, background: 'rgba(82,196,26,.12)' },
                                            { value: 'metrics' as SourceType, title: 'Business Metrics', detail: 'Revenue and jobs data.', icon: <LineChartOutlined style={{ color: '#722ed1', fontSize: 20 }} />, background: 'rgba(114,46,209,.12)' }
                                        ].map(option => {
                                            const selected = selectedSourceType === option.value
                                            const choiceKey = `source-${option.value}`
                                            const hovered = hoveredChoice === choiceKey
                                            const incompatibleWithUnit = resolvedUnit === 'ZAR' && !SOURCE_CONFIGS[option.value].fields.some(field => field.isNumeric)
                                            const selectSource = () => {
                                                if (incompatibleWithUnit) {
                                                    message.info('Amount KPIs use Business Metrics. Applications and Interventions do not provide a numeric amount to total or average.')
                                                    return
                                                }
                                                form.setFieldsValue({
                                                    sourceType: option.value,
                                                    displayKpiType: undefined,
                                                    field: null,
                                                    filters: [],
                                                    numeratorFilters: [],
                                                    denominatorFilters: [],
                                                    numeratorField: null,
                                                    denominatorField: null,
                                                    interventionIds: []
                                                })
                                                applySourceOrUnitDefaults()
                                            }
                                            return (
                                                <Col xs={24} sm={8} key={option.value}>
                                                    <Card
                                                        hoverable={!incompatibleWithUnit}
                                                        role='button'
                                                        tabIndex={incompatibleWithUnit ? -1 : 0}
                                                        onClick={selectSource}
                                                        onKeyDown={event => {
                                                            if (event.key !== 'Enter' && event.key !== ' ') return
                                                            event.preventDefault()
                                                            selectSource()
                                                        }}
                                                        onMouseEnter={() => !incompatibleWithUnit && setHoveredChoice(choiceKey)}
                                                        onMouseLeave={() => setHoveredChoice(null)}
                                                        style={{
                                                            cursor: incompatibleWithUnit ? 'not-allowed' : 'pointer',
                                                            height: '100%',
                                                            border: `2px solid ${selected ? token.colorPrimary : hovered ? token.colorPrimaryBorderHover : token.colorBorder}`,
                                                            background: selected ? token.colorPrimaryBg : hovered ? token.colorFillAlter : token.colorBgContainer,
                                                            boxShadow: selected || hovered ? token.boxShadowSecondary : token.boxShadowTertiary,
                                                            transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
                                                            transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease',
                                                            opacity: incompatibleWithUnit ? .52 : 1
                                                        }}
                                                    >
                                                        <Space align='start' size={12}>
                                                            <MotionCard.IconChip size={42} bg={option.background} icon={option.icon} />
                                                            <div>
                                                                <Text strong style={{ display: 'block' }}>{option.title}</Text>
                                                                <Text type='secondary'>{incompatibleWithUnit ? 'Not available for Amount KPIs — use Business Metrics.' : option.detail}</Text>
                                                            </div>
                                                        </Space>
                                                    </Card>
                                                </Col>
                                            )
                                        })}
                                    </Row>
                                </div>

                                {selectedSourceType === 'interventions' && (
                                    !belongsToMe ? (
                                        <div style={{ marginTop: 24 }}>
                                            <Form.Item name='interventionIds' hidden rules={[{ required: true, message: 'Select at least one intervention' }]}><Input /></Form.Item>
                                            <Text strong style={{ display: 'block', fontSize: 16 }}>Required interventions</Text>
                                            <Text type='secondary'>Choose a contributing department first, then add one of its interventions.</Text>
                                            <Row gutter={[10, 10]} style={{ marginTop: 10 }}>
                                                <Col xs={24} sm={10}>
                                                    <Select
                                                        value={interventionDepartmentId}
                                                        placeholder='Contributing department'
                                                        optionFilterProp='label'
                                                        style={{ width: '100%' }}
                                                        onChange={setInterventionDepartmentId}
                                                        options={selectedContributorDepartmentIdsRaw.map(departmentId => {
                                                            const departmentOption = departments.find(item => item.id === departmentId)
                                                            return departmentOption ? { value: departmentOption.id, label: compactDepartmentLabel(departmentOption.name), title: departmentOption.name } : null
                                                        }).filter(Boolean) as { value: string; label: string; title: string }[]}
                                                    />
                                                </Col>
                                                <Col xs={24} sm={14}>
                                                    <Select
                                                        value={undefined}
                                                        disabled={!interventionDepartmentId}
                                                        placeholder={interventionDepartmentId ? 'Add an intervention' : 'Choose a department first'}
                                                        optionFilterProp='label'
                                                        style={{ width: '100%' }}
                                                        onChange={interventionId => form.setFieldsValue({ interventionIds: [...selectedInterventionIds, interventionId] })}
                                                        options={interventionsForSelectedDepartment
                                                            .filter(intervention => !selectedInterventionIds.includes(intervention.id))
                                                            .map(intervention => ({ value: intervention.id, label: intervention.interventionTitle || intervention.title || intervention.name || intervention.id }))}
                                                    />
                                                </Col>
                                            </Row>
                                            <div style={{ marginTop: 12, maxHeight: 220, overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
                                                {selectedInterventionIds.length === 0 ? (
                                                    <Text type='secondary'>No interventions added yet.</Text>
                                                ) : (
                                                    <Row gutter={[10, 10]}>
                                                        {selectedInterventionIds.map(interventionId => {
                                                            const intervention = filteredInterventions.find(item => item.id === interventionId)
                                                            if (!intervention) return null
                                                            const label = intervention.interventionTitle || intervention.title || intervention.name || intervention.id
                                                            const owner = intervention.areaOfSupport || intervention.area || intervention.department
                                                            return <Col xs={24} sm={12} key={interventionId}>
                                                                <Card size='small' style={{ background: token.colorFillAlter, borderColor: token.colorBorderSecondary }} bodyStyle={{ padding: '8px 10px' }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                                                        <MotionCard.IconChip size={28} bg='rgba(82,196,26,.12)' icon={<AimOutlined style={{ color: '#52c41a' }} />} />
                                                                        <div style={{ minWidth: 0, flex: 1 }}><Text strong style={{ display: 'block' }} ellipsis={{ tooltip: label }}>{label}</Text>{owner ? <Tag color='green' style={{ marginTop: 2 }}>{owner}</Tag> : null}</div>
                                                                        <Button danger shape='round' size='small' icon={<MinusCircleOutlined />} onClick={() => form.setFieldsValue({ interventionIds: selectedInterventionIds.filter(id => id !== interventionId) })}>Remove</Button>
                                                                    </div>
                                                                </Card>
                                                            </Col>
                                                        })}
                                                    </Row>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <Form.Item
                                            name='interventionIds'
                                            label='Which interventions contribute to this KPI?'
                                            rules={[{ required: true, message: 'Select at least one intervention' }]}
                                            extra='Only interventions from your department are shown.'
                                        >
                                            <Select mode='multiple' placeholder='Select interventions' optionFilterProp='label' options={filteredInterventions.map(i => ({ value: i.id, label: i.interventionTitle || i.title || i.name || i.id }))} />
                                        </Form.Item>
                                    )
                                )}

                            </StepPanel>

                            <StepPanel visible={step === 2}>
                                <div style={{ width: '100%' }}>
                                    <Text type='secondary' style={{ display: 'block', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}>
                                        Step 3 of 6
                                    </Text>
                                    <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 24px', minHeight: 32 }}>
                                        <KpiTypingPrompt text='Any conditions to narrow this down?' />
                                    </Text>

                                    <Alert
                                        type='info'
                                        showIcon
                                        style={{ marginBottom: 16 }}
                                        message="Conditions scope this KPI to a subset of records - for example, only female participants, or only one province. Leave it open to include everything that matches."
                                    />

                                    <Row gutter={[12, 12]}>
                                        {[
                                            { value: false, title: 'No, include everything', detail: 'Every matching record counts, with no extra narrowing.', icon: <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />, background: 'rgba(82,196,26,.12)' },
                                            { value: true, title: 'Yes, add conditions', detail: 'Narrow this KPI down to a specific subset of records.', icon: <FilterOutlined style={{ color: '#1677ff', fontSize: 20 }} />, background: 'rgba(22,119,255,.12)' }
                                        ].map(option => {
                                            const selected = (hasConditions ?? filters.length > 0) === option.value
                                            const choiceKey = `has-conditions-${option.value}`
                                            const hovered = hoveredChoice === choiceKey
                                            const selectOption = () => {
                                                setHasConditions(option.value)
                                                if (!option.value) {
                                                    form.setFieldsValue({ filters: [] })
                                                    setDraftConditionField(undefined)
                                                    setDraftConditionOp('==')
                                                }
                                            }
                                            return (
                                                <Col xs={24} sm={12} key={String(option.value)}>
                                                    <Card
                                                        hoverable role='button' tabIndex={0}
                                                        onClick={selectOption}
                                                        onKeyDown={event => {
                                                            if (event.key !== 'Enter' && event.key !== ' ') return
                                                            event.preventDefault()
                                                            selectOption()
                                                        }}
                                                        onMouseEnter={() => setHoveredChoice(choiceKey)}
                                                        onMouseLeave={() => setHoveredChoice(null)}
                                                        style={{
                                                            cursor: 'pointer',
                                                            border: `2px solid ${selected ? token.colorPrimary : hovered ? token.colorPrimaryBorderHover : token.colorBorder}`,
                                                            background: selected ? token.colorPrimaryBg : hovered ? token.colorFillAlter : token.colorBgContainer,
                                                            boxShadow: selected || hovered ? token.boxShadowSecondary : token.boxShadowTertiary,
                                                            transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease'
                                                        }}
                                                    >
                                                        <Space align='start' size={12}>
                                                            <MotionCard.IconChip size={38} bg={option.background} icon={option.icon} />
                                                            <div>
                                                                <Text strong style={{ display: 'block' }}>{option.title}</Text>
                                                                <Text type='secondary'>{option.detail}</Text>
                                                            </div>
                                                        </Space>
                                                    </Card>
                                                </Col>
                                            )
                                        })}
                                    </Row>

                                    {(hasConditions ?? filters.length > 0) && (
                                        <div style={{ marginTop: 24 }}>
                                            <Row gutter={[8, 8]} align='middle' style={{ marginBottom: 16 }}>
                                                <Col xs={24} md={8}>
                                                    <Select
                                                        placeholder='Condition'
                                                        style={{ width: '100%' }}
                                                        value={draftConditionField}
                                                        onChange={value => setDraftConditionField(value)}
                                                    >
                                                        {(resolvedSourceType ? SOURCE_CONFIGS[resolvedSourceType].fields.filter(f => f.isCondition) : []).map(f => (
                                                            <Option key={f.key} value={f.key}>{f.label}</Option>
                                                        ))}
                                                    </Select>
                                                </Col>
                                                <Col xs={24} md={5}>
                                                    <Select
                                                        style={{ width: '100%' }}
                                                        value={draftConditionOp}
                                                        onChange={value => setDraftConditionOp(value)}
                                                    >
                                                        <Option value='=='>is</Option>
                                                        <Option value='!='>is not</Option>
                                                        <Option value='in'>is one of</Option>
                                                    </Select>
                                                </Col>
                                                <Col xs={24} md={7}>
                                                    <Form.Item name='_conditionDraftValue' noStyle>
                                                        {draftConditionField
                                                            ? renderValueInput(resolvedSourceType, draftConditionField, undefined, 'filters', draftConditionOp)
                                                            : <Input disabled placeholder='Choose value' />}
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={4}>
                                                    <Button
                                                        block
                                                        shape='round'
                                                        type='dashed'
                                                        icon={<PlusOutlined />}
                                                        onClick={() => {
                                                            const draftValue = form.getFieldValue('_conditionDraftValue')
                                                            const isEmpty = draftValue === undefined || draftValue === null ||
                                                                (Array.isArray(draftValue) ? draftValue.length === 0 : String(draftValue).trim() === '')
                                                            if (!draftConditionField || isEmpty) {
                                                                message.warning('Choose a condition and a value first')
                                                                return
                                                            }
                                                            form.setFieldsValue({
                                                                filters: [...filters, { field: draftConditionField, op: draftConditionOp, value: draftValue }],
                                                                _conditionDraftValue: undefined
                                                            })
                                                            setDraftConditionField(undefined)
                                                            setDraftConditionOp('==')
                                                        }}
                                                    >
                                                        Add
                                                    </Button>
                                                </Col>
                                            </Row>

                                            {filters.length > 0 && (
                                                <Space direction='vertical' size={8} style={{ width: '100%' }}>
                                                    {filters.map((condition: KpiFilter, index: number) => {
                                                        const fieldDef = resolvedSourceType
                                                            ? SOURCE_CONFIGS[resolvedSourceType].fields.find(f => f.key === condition.field)
                                                            : undefined
                                                        const opLabel = condition.op === '==' ? 'is' : condition.op === '!=' ? 'is not' : 'is one of'
                                                        const valueLabel = Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value ?? '')
                                                        return (
                                                            <Card key={`${condition.field}-${index}`} size='small' style={{ background: token.colorFillAlter, borderColor: token.colorBorderSecondary }} bodyStyle={{ padding: '8px 12px' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                                                    <Text>
                                                                        <Text strong>{fieldDef?.label || condition.field}</Text>{' '}
                                                                        <Text type='secondary'>{opLabel}</Text>{' '}
                                                                        <Text strong>{valueLabel}</Text>
                                                                    </Text>
                                                                    <Tooltip title='Remove condition'>
                                                                        <Button
                                                                            shape='circle'
                                                                            danger
                                                                            type='text'
                                                                            size='small'
                                                                            icon={<DeleteOutlined />}
                                                                            onClick={() => form.setFieldsValue({ filters: filters.filter((_: KpiFilter, i: number) => i !== index) })}
                                                                        />
                                                                    </Tooltip>
                                                                </div>
                                                            </Card>
                                                        )
                                                    })}
                                                </Space>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </StepPanel>

                            <StepPanel visible={step === 3}>
                                <Form.Item name='displayKpiType' hidden rules={[{ required: true, message: 'Select a KPI type' }]}>
                                    <Input />
                                </Form.Item>

                                <Text type='secondary' style={{ display: 'block', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}>
                                    Step 4 of 6
                                </Text>
                                <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 24px', minHeight: 32 }}>
                                    <KpiTypingPrompt text='How should this KPI be calculated?' />
                                </Text>
                                {availableDisplayTypes.length > 1 && (
                                <Row gutter={[12, 12]}>
                                    {availableDisplayTypes.map(option => {
                                        const selected = selectedDisplayKpiType === option.value
                                        const choiceKey = `calculation-${option.value}`
                                        const hovered = hoveredChoice === choiceKey
                                        const optionMeta: Record<DisplayKpiType, { detail: string; icon: React.ReactNode; background: string }> = {
                                            total_number: { detail: 'Count the matching records.', icon: <NumberOutlined style={{ color: '#1677ff', fontSize: 20 }} />, background: 'rgba(22,119,255,.12)' },
                                            total_amount: { detail: 'Add the values from one metric.', icon: <DollarOutlined style={{ color: '#52c41a', fontSize: 20 }} />, background: 'rgba(82,196,26,.12)' },
                                            average: { detail: 'Find the average value of a metric.', icon: <BarChartOutlined style={{ color: '#fa8c16', fontSize: 20 }} />, background: 'rgba(250,140,22,.12)' },
                                            percentage: { detail: 'Compare one group against another.', icon: <PercentageOutlined style={{ color: '#722ed1', fontSize: 20 }} />, background: 'rgba(114,46,209,.12)' }
                                        }
                                        const meta = optionMeta[option.value]
                                        const selectType = () => {
                                            const firstNumeric = (resolvedSourceType === 'metrics' ? metricFieldOptions : numericFields)[0]?.key || null
                                            const nextValues: any = { displayKpiType: option.value }

                                            if (option.value === 'total_amount' || option.value === 'average' || (option.value === 'total_number' && resolvedSourceType === 'metrics')) nextValues.field = firstNumeric
                                            if (option.value === 'percentage') {
                                                nextValues.numeratorMode = 'count_records'
                                                nextValues.denominatorMode = 'count_records'
                                                nextValues.numeratorField = firstNumeric
                                                nextValues.denominatorField = firstNumeric
                                            } else {
                                                nextValues.numeratorFilters = []
                                                nextValues.denominatorFilters = []
                                                nextValues.numeratorField = null
                                                nextValues.denominatorField = null
                                            }

                                            form.setFieldsValue(nextValues)
                                        }

                                        return (
                                            <Col xs={24} sm={availableDisplayTypes.length === 1 ? 24 : 12} key={option.value}>
                                                <Card
                                                    hoverable
                                                    role='button'
                                                    tabIndex={0}
                                                    onClick={selectType}
                                                    onKeyDown={event => {
                                                        if (event.key !== 'Enter' && event.key !== ' ') return
                                                        event.preventDefault()
                                                        selectType()
                                                    }}
                                                    onMouseEnter={() => setHoveredChoice(choiceKey)}
                                                    onMouseLeave={() => setHoveredChoice(null)}
                                                    style={{
                                                        height: '100%',
                                                        cursor: 'pointer',
                                                        borderColor: selected ? token.colorPrimary : (hovered ? token.colorPrimaryBorderHover : undefined),
                                                        background: selected ? token.colorPrimaryBg : undefined,
                                                        boxShadow: selected ? `0 12px 26px ${token.colorPrimaryBgHover}` : (hovered ? token.boxShadowTertiary : undefined),
                                                        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
                                                        transition: 'all .2s ease'
                                                    }}
                                                    bodyStyle={{ padding: '12px 14px' }}
                                                >
                                                    <Space size={10} align='center'>
                                                        <div style={{ width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', background: meta.background }}>
                                                            {meta.icon}
                                                        </div>
                                                        <div>
                                                            <Text strong style={{ fontSize: 15 }}>{option.label}</Text>
                                                            <Text type='secondary' style={{ marginLeft: 8 }}>{meta.detail}</Text>
                                                        </div>
                                                    </Space>
                                                </Card>
                                            </Col>
                                        )
                                    })}
                                </Row>
                                )}

                                {selectedDisplayKpiType === 'total_number' && resolvedSourceType !== 'metrics' && (
                                    <div style={{ marginTop: 28 }}>
                                        <Form.Item name='countMode' hidden preserve={false} rules={[{ required: true, message: 'Choose how to count' }]}>
                                            <Input />
                                        </Form.Item>
                                        <Text strong style={{ display: 'block', marginBottom: 12 }}>How should this be counted?</Text>
                                        <Row gutter={[12, 12]}>
                                            {(resolvedSourceType === 'applications'
                                                ? [
                                                    { value: 'records' as CountMode, title: 'Count accepted applications', detail: 'Each accepted application is counted, even if the SME has more than one.', icon: <NumberOutlined style={{ color: '#1677ff', fontSize: 20 }} />, background: 'rgba(22,119,255,.12)' },
                                                    { value: 'distinct' as CountMode, title: 'Count unique SMEs', detail: 'Each SME with an accepted application is counted once.', icon: <TeamOutlined style={{ color: '#52c41a', fontSize: 20 }} />, background: 'rgba(82,196,26,.12)' }
                                                ]
                                                : [
                                                    { value: 'records' as CountMode, title: 'Count completed interventions', detail: 'Each completed selected intervention is counted.', icon: <NumberOutlined style={{ color: '#1677ff', fontSize: 20 }} />, background: 'rgba(22,119,255,.12)' },
                                                    { value: 'distinct' as CountMode, title: 'Count unique SMEs', detail: 'Each SME with one or more completed selected interventions is counted once.', icon: <TeamOutlined style={{ color: '#52c41a', fontSize: 20 }} />, background: 'rgba(82,196,26,.12)' }
                                                ]
                                            ).map(option => {
                                                const selected = selectedCountMode === option.value
                                                const choiceKey = `count-${option.value}`
                                                const hovered = hoveredChoice === choiceKey
                                                const selectCountMode = () => form.setFieldsValue({ countMode: option.value })
                                                return (
                                                    <Col xs={24} sm={12} key={option.value}>
                                                        <Card
                                                            hoverable
                                                            role='button'
                                                            tabIndex={0}
                                                            onClick={selectCountMode}
                                                            onKeyDown={event => {
                                                                if (event.key !== 'Enter' && event.key !== ' ') return
                                                                event.preventDefault()
                                                                selectCountMode()
                                                            }}
                                                            onMouseEnter={() => setHoveredChoice(choiceKey)}
                                                            onMouseLeave={() => setHoveredChoice(null)}
                                                            style={{
                                                                cursor: 'pointer',
                                                                borderColor: selected ? token.colorPrimary : (hovered ? token.colorPrimaryBorderHover : undefined),
                                                                background: selected ? token.colorPrimaryBg : undefined,
                                                                boxShadow: selected ? `0 12px 26px ${token.colorPrimaryBgHover}` : (hovered ? token.boxShadowTertiary : undefined),
                                                                transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
                                                                transition: 'all .2s ease'
                                                            }}
                                                            bodyStyle={{ padding: 18 }}
                                                        >
                                                            <Space size={12} align='center'>
                                                                <div style={{ width: 42, height: 42, borderRadius: 14, display: 'grid', placeItems: 'center', background: option.background }}>
                                                                    {option.icon}
                                                                </div>
                                                                <div>
                                                                    <Text strong style={{ display: 'block', fontSize: 16 }}>{option.title}</Text>
                                                                    <Text type='secondary'>{option.detail}</Text>
                                                                </div>
                                                            </Space>
                                                        </Card>
                                                    </Col>
                                                )
                                            })}
                                        </Row>
                                    </div>
                                )}

                                {(selectedDisplayKpiType === 'total_amount' || selectedDisplayKpiType === 'average' || (selectedDisplayKpiType === 'total_number' && resolvedSourceType === 'metrics')) && (() => {
                                    const fields = resolvedSourceType === 'metrics' ? metricFieldOptions : numericFields
                                    return (
                                        <div style={{ marginTop: 24 }}>
                                            <Form.Item name='field' hidden preserve={false} rules={[{ required: true, message: 'Choose a numeric field' }]}>
                                                <Input />
                                            </Form.Item>
                                            <Text strong style={{ display: 'block', marginBottom: 12 }}>
                                                {selectedDisplayKpiType === 'average'
                                                    ? 'Which value should be averaged?'
                                                    : selectedDisplayKpiType === 'total_number'
                                                        ? 'Which business metric should be totalled?'
                                                        : 'Which value should be totalled?'}
                                            </Text>
                                            <Row gutter={[10, 10]}>
                                                {fields.map(field => {
                                                    const selected = selectedField === field.key
                                                    const choiceKey = `metric-field-${field.key}`
                                                    const hovered = hoveredChoice === choiceKey
                                                    const selectField = () => form.setFieldsValue({ field: field.key })
                                                    return (
                                                        <Col xs={24} sm={12} key={field.key}>
                                                            <Card
                                                                hoverable
                                                                role='button'
                                                                tabIndex={0}
                                                                onClick={selectField}
                                                                onKeyDown={event => {
                                                                    if (event.key !== 'Enter' && event.key !== ' ') return
                                                                    event.preventDefault()
                                                                    selectField()
                                                                }}
                                                                onMouseEnter={() => setHoveredChoice(choiceKey)}
                                                                onMouseLeave={() => setHoveredChoice(null)}
                                                                style={{
                                                                    cursor: 'pointer',
                                                                    borderColor: selected ? token.colorPrimary : (hovered ? token.colorPrimaryBorderHover : undefined),
                                                                    background: selected ? token.colorPrimaryBg : undefined,
                                                                    transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
                                                                    transition: 'all .2s ease'
                                                                }}
                                                                bodyStyle={{ padding: '10px 14px' }}
                                                            >
                                                                <Space size={10}>
                                                                    <MotionCard.IconChip size={32} bg='rgba(82,196,26,.12)' icon={<BarChartOutlined style={{ color: '#52c41a' }} />} />
                                                                    <Text strong>{field.label}</Text>
                                                                </Space>
                                                            </Card>
                                                        </Col>
                                                    )
                                                })}
                                            </Row>
                                        </div>
                                    )
                                })()}

                                {selectedDisplayKpiType === 'percentage' && (
                                    <>
                                        <Alert
                                            type='warning'
                                            showIcon
                                            style={{ marginBottom: 12 }}
                                            message='Percentage setup'
                                            description='Define the top group and the bottom group in simple terms.'
                                        />

                                        <Row gutter={[12, 12]} align='stretch'>
                                            <Col xs={24} lg={12} style={{ display: 'flex' }}>
                                                <Card size='small' title='Top group' style={{ borderRadius: 10, width: '100%' }}>
                                                    {renderPercentageMeasurementChoices('numeratorMode', 'numeratorField', numeratorMode, 'Top')}

                                                    <div style={{ marginTop: 20 }}>
                                                        <FilterListSection
                                                            title='Top group filters'
                                                            listName='numeratorFilters'
                                                            st={resolvedSourceType}
                                                            form={form}
                                                            renderValueInput={renderValueInput}
                                                        />
                                                    </div>
                                                </Card>
                                            </Col>

                                            <Col xs={24} lg={12} style={{ display: 'flex' }}>
                                                <Card size='small' title='Bottom group' style={{ borderRadius: 10, width: '100%' }}>
                                                    {renderPercentageMeasurementChoices('denominatorMode', 'denominatorField', denominatorMode, 'Bottom')}

                                                    <div style={{ marginTop: 20 }}>
                                                        <FilterListSection
                                                            title='Bottom group filters'
                                                            listName='denominatorFilters'
                                                            st={resolvedSourceType}
                                                            form={form}
                                                            renderValueInput={renderValueInput}
                                                        />
                                                    </div>
                                                </Card>
                                            </Col>
                                        </Row>
                                    </>
                                )}
                            </StepPanel>

                            <StepPanel visible={step === 4}>
                                <Form.Item name='periodType' hidden rules={[{ required: true, message: 'Choose a target period type' }]}><Input /></Form.Item>
                                <div style={{ width: '100%' }}>
                                    <Text type='secondary' style={{ display: 'block', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}>
                                        Step 5 of 6
                                    </Text>
                                    <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 24px', minHeight: 32 }}>
                                        <KpiTypingPrompt text='When should this target be measured?' />
                                    </Text>
                                    <Row gutter={[12, 12]}>
                                        {[
                                            { value: 'monthly' as TargetPeriodType, title: 'Monthly', detail: 'Set a target for each month.', icon: <CalendarOutlined style={{ color: '#1677ff', fontSize: 20 }} />, background: 'rgba(22,119,255,.12)' },
                                            { value: 'quarterly' as TargetPeriodType, title: 'Quarterly', detail: 'Set a target for each quarter.', icon: <BarChartOutlined style={{ color: '#722ed1', fontSize: 20 }} />, background: 'rgba(114,46,209,.12)' }
                                        ].map(option => {
                                            const selected = selectedPeriodType === option.value
                                            const choiceKey = `period-${option.value}`
                                            const hovered = hoveredChoice === choiceKey
                                            const selectPeriod = () => form.setFieldsValue({
                                                periodType: option.value,
                                                periodKey: nextTargetPeriodStart(option.value)
                                            })
                                            return (
                                                <Col xs={24} sm={12} key={option.value}>
                                                    <Card
                                                        hoverable
                                                        role='button'
                                                        tabIndex={0}
                                                        onClick={selectPeriod}
                                                        onKeyDown={event => {
                                                            if (event.key !== 'Enter' && event.key !== ' ') return
                                                            event.preventDefault()
                                                            selectPeriod()
                                                        }}
                                                        onMouseEnter={() => setHoveredChoice(choiceKey)}
                                                        onMouseLeave={() => setHoveredChoice(null)}
                                                        style={{
                                                            cursor: 'pointer',
                                                            border: `2px solid ${selected ? token.colorPrimary : hovered ? token.colorPrimaryBorderHover : token.colorBorder}`,
                                                            background: selected ? token.colorPrimaryBg : hovered ? token.colorFillAlter : token.colorBgContainer,
                                                            boxShadow: selected || hovered ? token.boxShadowSecondary : token.boxShadowTertiary,
                                                            transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
                                                            transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease'
                                                        }}
                                                    >
                                                        <Space align='start' size={12}>
                                                            <MotionCard.IconChip size={42} bg={option.background} icon={option.icon} />
                                                            <div>
                                                                <Text strong style={{ display: 'block' }}>{option.title}</Text>
                                                                <Text type='secondary'>{option.detail}</Text>
                                                            </div>
                                                        </Space>
                                                    </Card>
                                                </Col>
                                            )
                                        })}
                                    </Row>

                                    {selectedPeriodType && (
                                        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} style={{ marginTop: 24 }}>
                                            <Row gutter={[12, 12]}>
                                                <Col xs={24} sm={12}>
                                                    <Form.Item name='periodKey' label={`Which ${selectedPeriodType === 'quarterly' ? 'quarter' : 'month'}?`} rules={[{ required: true, message: 'Select a period' }]}>
                                                        <DatePicker
                                                            style={{ width: '100%' }}
                                                            picker={selectedPeriodType === 'quarterly' ? 'quarter' : 'month'}
                                                            disabledDate={current => Boolean(current && current.startOf('day').isSameOrBefore(dayjs().startOf('day')))}
                                                        />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} sm={12}>
                                                    <Form.Item name='target' label='What is the target?' rules={[{ required: true, message: 'Enter a target value' }, { validator: (_rule, value) => Number(value) > 0 ? Promise.resolve() : Promise.reject(new Error('Target must be greater than zero')) }]}>
                                                        <InputNumber min={1} style={{ width: '100%' }} placeholder='Enter target' />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        </motion.div>
                                    )}
                                </div>
                            </StepPanel>

                            <StepPanel visible={step === 5}>
                                <div style={{ width: '100%' }}>
                                    <Text type='secondary' style={{ display: 'block', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}>
                                        Step 6 of 6
                                    </Text>
                                    <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 8px', minHeight: 32 }}>
                                        <KpiTypingPrompt text='Review before adding' />
                                    </Text>
                                    <Text type='secondary' style={{ display: 'block', textAlign: 'center', marginBottom: 20 }}>
                                        Select any section to jump back and change it.
                                    </Text>
                                    <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                        {reviewSections.map(section => {
                                            const choiceKey = `review-${section.step}`
                                            const hovered = hoveredChoice === choiceKey
                                            return (
                                                <Card
                                                    key={section.step}
                                                    hoverable role='button' tabIndex={0}
                                                    onClick={() => goToReviewSection(section.step)}
                                                    onKeyDown={event => {
                                                        if (event.key !== 'Enter' && event.key !== ' ') return
                                                        event.preventDefault()
                                                        goToReviewSection(section.step)
                                                    }}
                                                    onMouseEnter={() => setHoveredChoice(choiceKey)}
                                                    onMouseLeave={() => setHoveredChoice(null)}
                                                    style={{ cursor: 'pointer', borderColor: hovered ? token.colorPrimaryBorderHover : token.colorBorder, background: hovered ? token.colorFillAlter : token.colorBgContainer, transition: 'all .2s ease' }}
                                                    bodyStyle={{ padding: 14 }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                                        <Space align='start' size={12} style={{ minWidth: 0 }}>
                                                            <MotionCard.IconChip size={38} bg={section.background} icon={section.icon} />
                                                            <div style={{ minWidth: 0 }}>
                                                                <Text strong style={{ display: 'block' }}>{section.title}</Text>
                                                                <Text type='secondary' ellipsis={{ tooltip: section.summary }} style={{ display: 'block' }}>{section.summary}</Text>
                                                            </div>
                                                        </Space>
                                                        <EditOutlined style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
                                                    </div>
                                                </Card>
                                            )
                                        })}
                                    </Space>
                                </div>
                            </StepPanel>
                        </>
                    )}
                </div>
                </Form>
            </Modal>

            <Modal
                title={targetsKpi ? `Targets: ${targetsKpi.kpiLabel}` : 'Targets'}
                open={targetsModalOpen}
                onCancel={() => {
                    setTargetsModalOpen(false)
                    setTargetsKpi(null)
                    setTargetRows([])
                    setTargetAuditRows([])
                    setEditingTarget(null)
                    setTargetModalSection('plan')
                    targetForm.resetFields()
                }}
                centered
                footer={null}
                width={1100}
                styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', overflowX: 'hidden' } }}
                destroyOnClose
            >
                {!targetsKpi ? (
                    <Empty />
                ) : (
                    <>
                        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                            {[
                                { title: 'Target periods', value: targetSummary.total, icon: <CalendarOutlined style={{ color: '#1677ff' }} />, background: 'rgba(22,119,255,.12)' },
                                { title: 'Committed', value: targetSummary.committed, icon: <SaveOutlined style={{ color: '#fa8c16' }} />, background: 'rgba(250,140,22,.12)' },
                                { title: 'Future to plan', value: targetSummary.future, icon: <RightOutlined style={{ color: '#52c41a' }} />, background: 'rgba(82,196,26,.12)' }
                            ].map(item => (
                                <Col xs={24} sm={8} key={item.title}>
                                    <Card size='small' style={{ borderRadius: 14, background: token.colorFillAlter }} bodyStyle={{ padding: '13px 16px' }}>
                                        <Space size={10}>
                                            <MotionCard.IconChip size={34} bg={item.background} icon={item.icon} />
                                            <div>
                                                <Text type='secondary' style={{ display: 'block', fontSize: 12 }}>{item.title}</Text>
                                                <Text strong style={{ fontSize: 20 }}>{item.value}</Text>
                                            </div>
                                        </Space>
                                    </Card>
                                </Col>
                            ))}
                        </Row>

                        <Row gutter={[16, 16]} align='top'>
                            <Col xs={24} lg={6}>
                                <div style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, paddingRight: 12 }}>
                                    <Text type='secondary' style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Target workspace</Text>
                                    <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                        {[
                                            { key: 'plan' as const, label: 'Plan target', detail: 'Set or revise', icon: <PlusOutlined /> },
                                            { key: 'periods' as const, label: 'Target periods', detail: `${targetSummary.total} planned`, icon: <CalendarOutlined /> },
                                            { key: 'trail' as const, label: 'Revision trail', detail: `${targetAuditRows.length} entries`, icon: <HistoryOutlined /> }
                                        ].map(item => {
                                            const selected = targetModalSection === item.key
                                            return (
                                                <Button
                                                    key={item.key}
                                                    type={selected ? 'primary' : 'text'}
                                                    block
                                                    icon={item.icon}
                                                    onClick={() => setTargetModalSection(item.key)}
                                                    style={{ height: 52, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', borderRadius: 10 }}
                                                >
                                                    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.25 }}>
                                                        <span>{item.label}</span>
                                                        <span style={{ opacity: selected ? .78 : .55, fontSize: 11 }}>{item.detail}</span>
                                                    </span>
                                                </Button>
                                            )
                                        })}
                                    </Space>
                                </div>
                            </Col>
                            <Col xs={24} lg={18}>
                                {targetModalSection === 'plan' && <div>
                                    <Form form={targetForm} layout='vertical'>
                                        {editingCommittedTarget && (
                                            <Alert
                                                type='warning'
                                                showIcon
                                                style={{ marginBottom: 16 }}
                                                message={`Committed target: ${editingTarget?.target}`}
                                                description='Your revised value will be logged with your approval and reason. It will not overwrite the committed target used by standard performance reporting.'
                                            />
                                        )}
                                        <Form.Item name='periodType' hidden rules={[{ required: true, message: 'Select period type' }]}><Input /></Form.Item>
                                        <Text strong style={{ display: 'block', marginBottom: 10 }}>Reporting period</Text>
                                        <Row gutter={[10, 10]} style={{ marginBottom: 18 }}>
                                            {[
                                                { value: 'monthly' as TargetPeriodType, title: 'Monthly', detail: 'Set a target for one month.', icon: <CalendarOutlined style={{ color: '#1677ff' }} />, background: 'rgba(22,119,255,.12)' },
                                                { value: 'quarterly' as TargetPeriodType, title: 'Quarterly', detail: 'Set a target for one quarter.', icon: <BarChartOutlined style={{ color: '#722ed1' }} />, background: 'rgba(114,46,209,.12)' }
                                            ].map(option => {
                                                const selected = targetPeriodType === option.value
                                                const selectPeriodType = () => targetForm.setFieldsValue({ periodType: option.value, periodKey: nextTargetPeriodStart(option.value) })
                                                return (
                                                    <Col xs={24} sm={12} key={option.value}>
                                                        <Card
                                                            hoverable={!editingCommittedTarget}
                                                            role='button'
                                                            tabIndex={editingCommittedTarget ? -1 : 0}
                                                            onClick={editingCommittedTarget ? undefined : selectPeriodType}
                                                            onKeyDown={event => {
                                                                if (editingCommittedTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                                                                event.preventDefault()
                                                                selectPeriodType()
                                                            }}
                                                            style={{ cursor: editingCommittedTarget ? 'not-allowed' : 'pointer', borderColor: selected ? token.colorPrimary : token.colorBorder, background: selected ? token.colorPrimaryBg : token.colorBgContainer, opacity: editingCommittedTarget && !selected ? .55 : 1 }}
                                                            bodyStyle={{ padding: '12px 14px' }}
                                                        >
                                                            <Space size={10}>
                                                                <MotionCard.IconChip size={34} bg={option.background} icon={option.icon} />
                                                                <div><Text strong style={{ display: 'block' }}>{option.title}</Text><Text type='secondary' style={{ fontSize: 12 }}>{option.detail}</Text></div>
                                                            </Space>
                                                        </Card>
                                                    </Col>
                                                )
                                            })}
                                        </Row>

                                        <Form.Item name='periodKey' label={`Which ${targetPeriodType === 'quarterly' ? 'quarter' : 'month'}?`} rules={[{ required: true, message: 'Select period' }]}>
                                            <DatePicker
                                                style={{ width: '100%' }}
                                                picker={targetPeriodType === 'quarterly' ? 'quarter' : 'month'}
                                                disabled={editingCommittedTarget}
                                                disabledDate={current => Boolean(current && current.startOf('day').isSameOrBefore(dayjs().startOf('day')))}
                                            />
                                        </Form.Item>

                                        <Form.Item name='target' label='Target' rules={[{ required: true, message: 'Enter target' }, { validator: (_rule, value) => Number(value) > 0 ? Promise.resolve() : Promise.reject(new Error('Target must be greater than zero')) }]}>
                                            <InputNumber min={1} style={{ width: '100%' }} />
                                        </Form.Item>

                                <div style={{ display: 'grid', gridTemplateColumns: editingTarget ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 10 }}>
                                    {editingTarget && (
                                        <Button shape='round' block danger onClick={cancelEditTarget} disabled={targetsSaving}>
                                            Cancel edit
                                        </Button>
                                    )}
                                    <Button shape='round' block type='primary' htmlType='button' onClick={handleSaveTargetFromDrawer} icon={<SaveOutlined />} loading={targetsSaving}>
                                        {editingCommittedTarget ? 'Record revision' : editingTarget ? 'Update target' : 'Save target'}
                                    </Button>
                                </div>

                                    </Form>
                                </div>}

                                {targetModalSection === 'periods' && (
                                    <Card title='Committed target periods' extra={<Text type='secondary'>Revise active or past periods</Text>} style={{ borderRadius: 14 }}>
                                        {targetsLoading ? (
                                            <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                                <Skeleton active paragraph={{ rows: 1 }} />
                                                <Skeleton active paragraph={{ rows: 1 }} />
                                            </Space>
                                        ) : !targetRows.length ? (
                                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No target periods planned yet.' />
                                        ) : (
                                            <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                                {targetRows.map(row => {
                                                    const committed = targetPeriodHasStarted(row.periodType, row.periodKey)
                                                    const updated = row.updatedAt || row.createdAt
                                                    const updatedLabel = updated
                                                        ? (updated?.seconds ? dayjs.unix(updated.seconds) : dayjs(updated)).format('DD MMM YYYY')
                                                        : 'Not recorded'
                                                    return (
                                                <Card key={row.id} size='small' style={{ borderRadius: 12, borderColor: committed ? token.colorWarningBorder : token.colorPrimaryBorder, background: committed ? token.colorWarningBg : token.colorBgContainer }} bodyStyle={{ padding: '12px 14px' }}>
                                                            <Row gutter={[12, 10]} align='middle'>
                                                                <Col xs={24} sm={9}>
                                                                    <Space size={10}>
                                                                        <MotionCard.IconChip size={34} bg={committed ? 'rgba(250,173,20,.14)' : 'rgba(22,119,255,.12)'} icon={<CalendarOutlined style={{ color: committed ? '#d48806' : '#1677ff' }} />} />
                                                                        <div>
                                                                            <Text strong style={{ display: 'block' }}>{row.periodKey}</Text>
                                                                            <Text type='secondary' style={{ fontSize: 12 }}>{row.periodType === 'quarterly' ? 'Quarterly target' : 'Monthly target'}</Text>
                                                                        </div>
                                                                    </Space>
                                                                </Col>
                                                                <Col xs={12} sm={5}>
                                                                    <Text type='secondary' style={{ display: 'block', fontSize: 12 }}>Committed target</Text>
                                                                    <Text strong style={{ fontSize: 18 }}>{row.target}</Text>
                                                                </Col>
                                                                <Col xs={12} sm={4}>
                                                                    <Tag color={committed ? 'gold' : 'blue'}>{committed ? 'Committed' : 'Future'}</Tag>
                                                                    <Text type='secondary' style={{ display: 'block', fontSize: 11, marginTop: 5 }}>{updatedLabel}</Text>
                                                                </Col>
                                                                <Col xs={24} sm={6} style={{ textAlign: 'right' }}>
                                                                    <Space size={6} wrap>
                                                                        <Button shape='round' size='small' icon={<EditOutlined />} onClick={() => startEditTarget(row)}>{committed ? 'Revise' : 'Edit'}</Button>
                                                                        {!committed && (
                                                                            <Popconfirm title='Delete future target?' description='This does not affect committed performance history.' okText='Delete' okButtonProps={{ danger: true, loading: targetsDeletingId === row.id }} onConfirm={() => handleDeleteTarget(row)}>
                                                                                <Button shape='round' size='small' danger icon={<DeleteOutlined />} loading={targetsDeletingId === row.id}>Delete</Button>
                                                                            </Popconfirm>
                                                                        )}
                                                                    </Space>
                                                                </Col>
                                                            </Row>
                                                        </Card>
                                                    )
                                                })}
                                            </Space>
                                        )}
                                    </Card>
                                )}

                                {targetModalSection === 'trail' && (
                                    <Card title='Change & revision trail' extra={<Tag color='purple'>{targetAuditRows.length}</Tag>} style={{ borderRadius: 14 }}>
                                        {targetsLoading ? <Skeleton active paragraph={{ rows: 3 }} /> : !targetAuditRows.length ? (
                                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No changes recorded yet.' />
                                        ) : (
                                            <div style={{ position: 'relative' }}>
                                                {targetAuditRows.map(row => {
                                                    const changedAt = row.changedAt
                                                    const dateLabel = changedAt ? (changedAt?.seconds ? dayjs.unix(changedAt.seconds) : dayjs(changedAt)).format('DD MMM YYYY, HH:mm') : 'Date not recorded'
                                                    const actionMeta = {
                                                        created: { label: 'Target created', color: '#52c41a', background: 'rgba(82,196,26,.12)', icon: <PlusOutlined /> },
                                                        updated: { label: 'Future target updated', color: '#1677ff', background: 'rgba(22,119,255,.12)', icon: <EditOutlined /> },
                                                        revised: { label: 'Committed target revised', color: '#722ed1', background: 'rgba(114,46,209,.12)', icon: <HistoryOutlined /> },
                                                        deleted: { label: 'Future target deleted', color: '#ff4d4f', background: 'rgba(255,77,79,.10)', icon: <DeleteOutlined /> }
                                                    }[row.action]
                                                    return (
                                                        <div key={row.id} style={{ display: 'flex', gap: 12, paddingBottom: 16, position: 'relative' }}>
                                                            <div style={{ width: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                                                <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', color: actionMeta.color, background: actionMeta.background }}>
                                                                    {actionMeta.icon}
                                                                </div>
                                                                <div style={{ width: 1, flex: 1, background: token.colorBorderSecondary, marginTop: 6, minHeight: 18, visibility: row === targetAuditRows[targetAuditRows.length - 1] ? 'hidden' : 'visible' }} />
                                                            </div>
                                                            <div style={{ minWidth: 0, flex: 1, paddingBottom: 2 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                                                    <Text strong>{actionMeta.label}</Text>
                                                                    <Text type='secondary' style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{dateLabel}</Text>
                                                                </div>
                                                                <Space size={8} wrap style={{ marginTop: 4 }}>
                                                                    <Tag color='blue'>{row.periodKey}</Tag>
                                                                    <Text type='secondary'>Target</Text>
                                                                    <Text delete={row.oldTarget !== null && row.oldTarget !== undefined}>{row.oldTarget ?? '—'}</Text>
                                                                    <Text strong style={{ color: actionMeta.color }}>→ {row.newTarget ?? '—'}</Text>
                                                                </Space>
                                                                <div style={{ marginTop: 8, padding: '7px 9px', borderRadius: 8, background: token.colorFillAlter }}>
                                                                    <Text type='secondary' style={{ fontSize: 12 }}>{row.changeReason || 'No note added'}</Text>
                                                                </div>
                                                                <Text type='secondary' style={{ display: 'block', fontSize: 11, marginTop: 6 }}>Recorded by {row.changedBy || 'system'}</Text>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </Card>
                                )}
                            </Col>
                        </Row>
                    </>
                )}
            </Modal>

            <AddKpiFlowModal
                open={addKpiFlowVisible}
                onClose={() => setAddKpiFlowVisible(false)}
                departments={departments}
                defaultDepartmentId={user?.departmentId}
                isMonitoring={isMonitoringDept}
                onManualConfigure={() => {
                    setAddKpiFlowVisible(false)
                    openModal()
                }}
                onCreateCandidates={handleCreateFromCandidates}
            />
        </div>
    )
}

export default KPIManager
