import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Button,
    Checkbox,
    Col,
    Empty,
    Modal,
    Row,
    Select,
    Skeleton,
    Space,
    Typography
} from 'antd'
import { ArrowLeftOutlined, BulbOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'

import { MotionCard } from '@/components/dashboards/metrics/Header'
import { FilterPanel } from '@/components/workspace'
import {
    REPORT_CHART_COLORS,
    REPORT_CHART_PALETTE
} from '@/components/reports/reportChartTheme'
import type { ChartDataLabels } from '@/lib/highchartsTypes'
import './reach.css'
import { useDepartmentRoles } from '@/services/departmentRoles'

const { Text, Title } = Typography

const MONTHLY_DATA_LABELS: ChartDataLabels = {
    enabled: true,
    allowOverlap: true,
    crop: false,
    defer: false,
    overflow: 'allow',
    inside: false,
    y: -6,
    format: '{point.y}',
    // Text colour comes from the app's light/dark chart theme (lib/highchartsTheme.ts).
    style: {
        textOutline: 'none',
        fontWeight: '700',
        fontSize: '12px'
    }
}

type DateValue =
    | Dayjs
    | Date
    | string
    | number
    | {
        toDate?: () => Date
        seconds?: number
        nanoseconds?: number
        _seconds?: number
        _nanoseconds?: number
    }
    | null
    | undefined

type DemographicKey =
    | 'gender'
    | 'age'
    | 'beeLevel'
    | 'ward'
    | 'sector'
    | 'ownership'

export interface ReachAssignedIntervention {
    id: string

    participantId?: string
    beneficiaryId?: string
    participantName?: string
    beneficiaryName?: string
    participantEmail?: string
    beneficiaryEmail?: string
    smmeId?: string
    smmeNo?: string | null
    interventionTitle?: string

    departmentId?: string
    departmentName?: string
    snapshot?: {
        departmentName?: string
        beneficiaryName?: string
        participantName?: string
        participantEmail?: string
        beneficiaryEmail?: string
        smmeNo?: string | null
    } | null

    status?: string
    assignmentStatus?: string
    assigneeCompletionStatus?: string
    participantCompletionStatus?: string
    completionStatus?: string

    computedProgress?: number
    progress?:
    | number
    | {
        percentage?: number
    }

    completedAt?: DateValue
    updatedAt?: DateValue
    createdAt?: DateValue
}

export interface ReachParticipantProfile {
    id: string
    email?: string
    name?: string
    beneficiaryName?: string
    companyName?: string
    businessName?: string

    gender?: string
    age?: number | string
    idNumber?: string
    dateOfBirth?: DateValue

    sector?: string | string[]
    ward?: string | string[]
    hub?: string | string[]

    beeLevel?: number | string
    bbeeeLevel?: number | string
    beeStatus?: string

    blackOwnedPercent?: number
    femaleOwnedPercent?: number
    youthOwnedPercent?: number
}

export interface ReachDepartmentOption {
    label: string
    value: string
}

interface ReachAnalyticsProps {
    rows: readonly ReachAssignedIntervention[]
    participants: Record<string, ReachParticipantProfile>
    loading?: boolean

    /**
     * Main departments can switch between all departments and a specific one.
     * Non-main departments remain locked to departmentId and do not see a selector.
     */
    isMain?: boolean
    departmentId: string
    departmentOptions?: ReachDepartmentOption[]

    /**
     * When given, the Department / Intervention / charts pickers are handed to the
     * host (to show behind its own Filters button) instead of rendered in a card
     * above the charts. Called with null on unmount.
     */
    onControls?: (controls: ReachControls | null) => void
}

export type ReachControls = {
    panel: React.ReactNode
    /** Pickers changed from their defaults. */
    activeCount: number
    /** What each picker is set to, for a one-line summary; onClear is set when it is not the default. */
    summary: Array<{ label: string; value: string; onClear?: () => void }>
}

const ALL_DEMOGRAPHICS: DemographicKey[] = ['gender', 'age', 'beeLevel', 'ward', 'sector', 'ownership']

interface ReachItem {
    row: ReachAssignedIntervention
    participant?: ReachParticipantProfile

    departmentId: string
    departmentName: string

    gender: string
    ageBand: string
    sector: string
    ward: string
    beeLevel: string

    blackOwnedPercent: number | null
    femaleOwnedPercent: number | null
    youthOwnedPercent: number | null

    intervention: string
}


const normalizeIdentityValue = (value?: unknown): string =>
    String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')

const getReachSmeKey = (item: ReachItem): string => {
    const { row, participant } = item

    const candidates: Array<[string, unknown]> = [
        ['participant', row.participantId],
        ['beneficiary', row.beneficiaryId],
        ['smme', row.smmeId],
        ['smme-no', row.smmeNo || row.snapshot?.smmeNo],
        ['profile', participant?.id],
        ['id-number', participant?.idNumber],
        [
            'email',
            participant?.email ||
            row.participantEmail ||
            row.beneficiaryEmail ||
            row.snapshot?.participantEmail ||
            row.snapshot?.beneficiaryEmail
        ],
        [
            'business',
            participant?.companyName ||
            participant?.businessName
        ],
        [
            'name',
            participant?.beneficiaryName ||
            participant?.name ||
            row.beneficiaryName ||
            row.participantName ||
            row.snapshot?.beneficiaryName ||
            row.snapshot?.participantName
        ]
    ]

    for (const [prefix, rawValue] of candidates) {
        const value = normalizeIdentityValue(rawValue)

        if (value) {
            return `${prefix}:${value}`
        }
    }

    /*
     * Last resort only. A row ID represents an intervention assignment, not
     * an SME, so records reaching this fallback are reported separately in
     * the recommendations as unresolved participant identities.
     */
    return `assignment:${row.id}`
}

interface PieDatum {
    name: string
    y: number
    /** Interventions delivered / unique SMEs, for this bucket. */
    avgInterventions?: number
}

interface DepartmentActionRow {
    id: string
    name: string
    total: number
    completed: number
    open: number
    uniqueSmes: number
    missingParticipants: number
}

const DEMOGRAPHIC_OPTIONS: Array<{
    label: string
    value: DemographicKey
}> = [
        { label: 'Gender', value: 'gender' },
        { label: 'Age', value: 'age' },
        { label: 'B-BBEE Level', value: 'beeLevel' },
        { label: 'Ward / Hub', value: 'ward' },
        { label: 'Sector', value: 'sector' },
        { label: 'Ownership', value: 'ownership' }
    ]

const AGE_BUCKETS = [
    { label: '15-24', min: 15, max: 24 },
    { label: '25-34', min: 25, max: 34 },
    { label: '35-44', min: 35, max: 44 },
    { label: '45-54', min: 45, max: 54 },
    { label: '55-64', min: 55, max: 64 },
    { label: '65+', min: 65, max: 200 }
]


const normalizeText = (
    value?: unknown,
    fallback = 'Unspecified'
): string => {
    const text = String(value ?? '').trim()
    return text || fallback
}

const labelize = (value?: unknown): string => {
    const raw = normalizeText(value)

    if (raw === 'Unspecified') return raw

    return raw
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase())
}

const firstValue = (value?: string | string[] | null): string => {
    if (Array.isArray(value)) {
        return String(value.find(Boolean) || '').trim()
    }

    return String(value || '').trim()
}

const toDayjs = (value?: DateValue): Dayjs | null => {
    if (!value) return null

    if (dayjs.isDayjs(value)) {
        return value.isValid() ? value : null
    }

    if (value instanceof Date) {
        const parsed = dayjs(value)
        return parsed.isValid() ? parsed : null
    }

    if (
        typeof value === 'object' &&
        typeof value.toDate === 'function'
    ) {
        const parsed = dayjs(value.toDate())
        return parsed.isValid() ? parsed : null
    }

    if (
        typeof value === 'object' &&
        typeof value.seconds === 'number'
    ) {
        const milliseconds =
            value.seconds * 1000 +
            Math.floor(Number(value.nanoseconds || 0) / 1_000_000)

        const parsed = dayjs(milliseconds)
        return parsed.isValid() ? parsed : null
    }

    if (
        typeof value === 'object' &&
        typeof value._seconds === 'number'
    ) {
        const milliseconds =
            value._seconds * 1000 +
            Math.floor(Number(value._nanoseconds || 0) / 1_000_000)

        const parsed = dayjs(milliseconds)
        return parsed.isValid() ? parsed : null
    }

    const parsed = dayjs(value as any)
    return parsed.isValid() ? parsed : null
}

const getActivityDate = (row: ReachAssignedIntervention): Dayjs | null =>
    toDayjs(row.completedAt) ||
    toDayjs(row.updatedAt) ||
    toDayjs(row.createdAt)

const getProgressPercentage = (row: ReachAssignedIntervention): number => {
    if (typeof row.progress === 'number') {
        return row.progress
    }

    if (row.progress && typeof row.progress === 'object') {
        return Number(row.progress.percentage || 0)
    }

    return Number(row.computedProgress || 0)
}

const isCompletedRow = (row: ReachAssignedIntervention): boolean => {
    const status = String(row.status || row.assignmentStatus || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-')

    const assigneeCompletion = String(
        row.assigneeCompletionStatus || ''
    )
        .trim()
        .toLowerCase()

    const participantCompletion = String(
        row.participantCompletionStatus || ''
    )
        .trim()
        .toLowerCase()

    const completionStatus = String(row.completionStatus || '')
        .trim()
        .toLowerCase()

    return (
        status === 'completed' ||
        completionStatus === 'confirmed' ||
        (assigneeCompletion === 'completed' &&
            participantCompletion === 'confirmed') ||
        getProgressPercentage(row) >= 100
    )
}

const normalizePercentage = (value?: unknown): number | null => {
    const parsed = Number(value)

    if (!Number.isFinite(parsed)) return null

    return Math.min(100, Math.max(0, parsed))
}

const coerceBeeLevel = (value?: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }

    if (typeof value === 'string') {
        const matched = value.match(/\d+/)
        return matched ? Number(matched[0]) : null
    }

    return null
}

const getBeeLevelLabel = (
    participant?: ReachParticipantProfile
): string => {
    const level = coerceBeeLevel(
        participant?.beeLevel ?? participant?.bbeeeLevel
    )

    if (level != null) return `Level ${level}`

    return labelize(participant?.beeStatus || 'Unspecified')
}

const getParticipantAge = (
    participant?: ReachParticipantProfile
): number | null => {
    if (!participant) return null

    const directAge = Number(participant.age)

    if (Number.isFinite(directAge) && directAge > 0) {
        return directAge
    }

    if (participant.dateOfBirth) {
        const dateOfBirth = toDayjs(participant.dateOfBirth)

        if (dateOfBirth?.isValid()) {
            return dayjs().diff(dateOfBirth, 'year')
        }
    }

    const idNumber = String(participant.idNumber || '').replace(/\D/g, '')

    if (idNumber.length < 6) return null

    const shortYear = Number(idNumber.slice(0, 2))
    const month = Number(idNumber.slice(2, 4))
    const day = Number(idNumber.slice(4, 6))
    const currentShortYear = Number(dayjs().format('YY'))
    const fullYear =
        shortYear <= currentShortYear ? 2000 + shortYear : 1900 + shortYear

    const birthDate = new Date(fullYear, month - 1, day)

    const isValid =
        birthDate.getFullYear() === fullYear &&
        birthDate.getMonth() === month - 1 &&
        birthDate.getDate() === day

    if (!isValid) return null

    return dayjs().diff(dayjs(birthDate), 'year')
}

const getAgeBand = (age: number | null): string => {
    if (age == null || age < 15) return 'Unspecified'

    const bucket = AGE_BUCKETS.find(
        current => age >= current.min && age <= current.max
    )

    return bucket?.label || 'Unspecified'
}

const normalizeGender = (value: string): string => {
    const gender = value.trim().toLowerCase()

    if (gender.startsWith('female') || gender === 'woman') return 'Female'
    if (gender.startsWith('male') || gender === 'man') return 'Male'
    if (!gender || gender === 'unspecified') return 'Unspecified'

    return 'Other'
}

const averageKnownValues = (
    values: Array<number | null>
): number | null => {
    const knownValues = values.filter(
        (value): value is number =>
            typeof value === 'number' && Number.isFinite(value)
    )

    if (!knownValues.length) return null

    return (
        Math.round(
            (knownValues.reduce((sum, value) => sum + value, 0) /
                knownValues.length) *
            10
        ) / 10
    )
}

const countBy = <T,>(
    rows: readonly T[],
    getter: (row: T) => unknown
): PieDatum[] => {
    const counts: Record<string, number> = {}

    rows.forEach(row => {
        const key = labelize(getter(row))
        counts[key] = (counts[key] || 0) + 1
    })

    return Object.entries(counts)
        .map(([name, y]) => ({ name, y }))
        .sort((a, b) => b.y - a.y || a.name.localeCompare(b.name))
}

/**
 * Adds an "interventions delivered per SME, on average" figure to each bucket:
 * total intervention rows in that bucket (not deduplicated) over the unique-SME
 * count already in `smeCounts`.
 */
const withInterventionAverage = <T,>(
    smeCounts: PieDatum[],
    allRows: readonly T[],
    getter: (row: T) => unknown
): PieDatum[] => {
    const totalsByBucket = new Map(
        countBy(allRows, getter).map(entry => [entry.name, entry.y])
    )

    return smeCounts.map(entry => {
        const total = totalsByBucket.get(entry.name) || 0
        return {
            ...entry,
            avgInterventions: entry.y > 0 ? Math.round((total / entry.y) * 10) / 10 : 0
        }
    })
}

const hasPieData = (data: PieDatum[]): boolean =>
    data.some(item => item.y > 0)

const getTopEntry = (data: PieDatum[]): PieDatum | null => {
    const available = data.filter(
        item => item.name !== 'Unspecified' && item.y > 0
    )

    if (!available.length) return null

    return available.reduce((largest, current) =>
        current.y > largest.y ? current : largest
    )
}


const escapeDataLabelHtml = (value: unknown): string =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')

const PIE_DATA_LABELS: Highcharts.SeriesPieDataLabelsOptionsObject & Highcharts.DataLabelsOptions = {
    enabled: true,
    useHTML: true,
    allowOverlap: true,
    crop: false,
    defer: false,
    overflow: 'allow',
    distance: 22,
    connectorWidth: 1,
    padding: 2,
    formatter: function () {
        // Highcharts 12+ passes the point itself as `this`; older versions
        // passed a wrapper with `.point`. Accept either.
        const point = ((this as unknown as { point?: Highcharts.Point }).point ?? this) as Highcharts.Point & {
            name?: string
            avgInterventions?: number
        }

        const name = escapeDataLabelHtml(
            point.name || 'Unspecified'
        )
        const value = Number(this.y || 0)

        if (value <= 0) return null

        const avg = point.avgInterventions
        const avgSuffix = avg != null
            ? ` <span style="font-weight:500;opacity:.75">· ${avg} avg</span>`
            : ''

        return `<span style="font-size:12px;font-weight:700;white-space:nowrap">${name}: ${value}${avgSuffix}</span>`
    },
    style: {
        fontSize: '12px',
        fontWeight: '700',
        textOutline: 'none'
    }
}

/**
 * This matches the ROM demographic pie configuration and palette.
 */
const simplePieOptions = (
    data: PieDatum[],
    label: string
): Highcharts.Options => ({
    chart: {
        type: 'pie',
        height: 320,
        backgroundColor: 'transparent',
        spacingLeft: 28,
        spacingRight: 28
    },
    title: { text: '' },
    credits: { enabled: false },
    exporting: { enabled: false },
    tooltip: {
        pointFormat:
            '<b>{point.y}</b> ({point.percentage:.1f}%)<br/>' +
            '{#if point.avgInterventions}{point.avgInterventions} interventions delivered per SME on average{/if}'
    },
    legend: {
        enabled: true,
        layout: 'horizontal',
        align: 'center',
        verticalAlign: 'bottom',
        // Off, Highcharts widens every item to the longest label and drops
        // each onto its own row; on, it also left-aligns a short legend.
        alignColumns: false,
        itemDistance: 16,
        itemMarginBottom: 4,
        maxHeight: 110
    },
    plotOptions: {
        pie: {
            innerSize: '60%',
            showInLegend: true,
            size: '70%',
            dataLabels: PIE_DATA_LABELS
        }
    },
    series: [
        {
            type: 'pie',
            name: label,
            dataLabels: PIE_DATA_LABELS,
            data: data.map((item, index) => ({
                ...item,
                color:
                    REPORT_CHART_PALETTE[
                    index % REPORT_CHART_PALETTE.length
                    ],
                dataLabels: PIE_DATA_LABELS
            }))
        }
    ]
})

const ReachLoadingSkeleton: React.FC = () => (
    <Row gutter={[16, 16]}>
        <Col xs={24}>
            <MotionCard>
                <Skeleton active title={false} paragraph={{ rows: 4 }} />
            </MotionCard>
        </Col>

        <Col xs={24}>
            <MotionCard title='SMEs Reached vs Interventions Delivered'>
                <div style={{ minHeight: 340 }}>
                    <Skeleton active title={false} paragraph={{ rows: 8 }} />
                </div>
            </MotionCard>
        </Col>

        <Col xs={24} xl={12}>
            <MotionCard title='Demographic Analysis'>
                <div style={{ minHeight: 340 }}>
                    <Skeleton active title={false} paragraph={{ rows: 8 }} />
                </div>
            </MotionCard>
        </Col>

        <Col xs={24} xl={12}>
            <MotionCard title='Demographic Analysis'>
                <div style={{ minHeight: 340 }}>
                    <Skeleton active title={false} paragraph={{ rows: 8 }} />
                </div>
            </MotionCard>
        </Col>
    </Row>
)

type OwnershipMeasure = {
    /** Average share, 0–100, across SMEs with a value. */
    value: number | null
    /** SMEs with a value recorded. */
    known: number
}

/** Average ownership shares, each with how many SMEs it is based on. Colours: reach.css. */
const OwnershipProfile: React.FC<{
    black: OwnershipMeasure
    female: OwnershipMeasure
    youth: OwnershipMeasure
    total: number
}> = ({ black, female, youth, total }) => {
    const items = [
        { key: 'black', label: 'Black owned', measure: black },
        { key: 'female', label: 'Female owned', measure: female },
        { key: 'youth', label: 'Youth owned', measure: youth }
    ]

    if (!items.some(item => item.measure.value != null)) {
        return <Empty description='No ownership information available' />
    }

    return (
        <div className='reach-ownership'>
            <span className='reach-ownership-note'>Average ownership share across reached SMEs</span>
            {items.map(item => (
                <div key={item.key} className={`reach-ownership-row is-${item.key}`}>
                    <div className='reach-ownership-head'>
                        <span className='reach-ownership-label'>{item.label}</span>
                        <strong className='reach-ownership-value'>
                            {item.measure.value != null ? `${item.measure.value}%` : '—'}
                        </strong>
                    </div>
                    <span
                        className='reach-ownership-bar'
                        role='img'
                        aria-label={`${item.label}: ${item.measure.value ?? 'no data'}%`}
                    >
                        <i style={{ width: `${Math.min(100, item.measure.value || 0)}%` }} />
                    </span>
                    <span className='reach-ownership-basis'>
                        {item.measure.known
                            ? `Based on ${item.measure.known} of ${total} SMEs`
                            : 'No SMEs have this recorded'}
                    </span>
                </div>
            ))}
        </div>
    )
}


type ReachDrillSelection = {
    monthKey: string
    metric: 'smes' | 'delivered' | 'both'
}

interface ReachMonthlyDrilldownChartProps {
    rows: readonly ReachItem[]
    selection: ReachDrillSelection | null
    onSelectionChange: (
        selection: ReachDrillSelection | null
    ) => void
}

const ReachMonthlyDrilldownChart = React.memo(
    ({
        rows,
        selection,
        onSelectionChange
    }: ReachMonthlyDrilldownChartProps) => {
        const monthlyModel = useMemo(() => {
            const monthDeliveries = new Map<string, number>()
            const monthSmes = new Map<string, Set<string>>()

            const deliveredByMonth = new Map<
                string,
                Map<string, number>
            >()

            const smesByMonthAndIntervention = new Map<
                string,
                Map<string, Set<string>>
            >()

            rows.forEach(item => {
                const activityDate = getActivityDate(item.row)

                if (!activityDate) return

                const monthKey =
                    activityDate.format('YYYY-MM')

                const intervention = normalizeText(
                    item.intervention,
                    'Untitled'
                )

                const smeKey = getReachSmeKey(item)

                monthDeliveries.set(
                    monthKey,
                    (monthDeliveries.get(monthKey) || 0) + 1
                )

                if (!monthSmes.has(monthKey)) {
                    monthSmes.set(monthKey, new Set())
                }

                monthSmes.get(monthKey)!.add(smeKey)

                if (!deliveredByMonth.has(monthKey)) {
                    deliveredByMonth.set(
                        monthKey,
                        new Map()
                    )
                }

                const interventionDeliveries =
                    deliveredByMonth.get(monthKey)!

                interventionDeliveries.set(
                    intervention,
                    (
                        interventionDeliveries.get(
                            intervention
                        ) || 0
                    ) + 1
                )

                if (
                    !smesByMonthAndIntervention.has(
                        monthKey
                    )
                ) {
                    smesByMonthAndIntervention.set(
                        monthKey,
                        new Map()
                    )
                }

                const interventionSmes =
                    smesByMonthAndIntervention.get(
                        monthKey
                    )!

                if (!interventionSmes.has(intervention)) {
                    interventionSmes.set(
                        intervention,
                        new Set()
                    )
                }

                interventionSmes
                    .get(intervention)!
                    .add(smeKey)
            })

            const monthKeys = Array.from(
                new Set([
                    ...monthDeliveries.keys(),
                    ...monthSmes.keys()
                ])
            ).sort()

            return {
                monthKeys,
                monthDeliveries,
                monthSmes,
                deliveredByMonth,
                smesByMonthAndIntervention
            }
        }, [rows])

        const openDetail = useCallback(
            (
                monthKey: string,
                metric: ReachDrillSelection['metric']
            ) => {
                onSelectionChange({
                    monthKey,
                    metric
                })
            },
            [onSelectionChange]
        )

        const closeDetail = useCallback(() => {
            onSelectionChange(null)
        }, [onSelectionChange])

        const chartOptions = useMemo<Highcharts.Options>(() => {
            const baseYAxis: Highcharts.YAxisOptions = {
                min: 0,
                allowDecimals: false,
                title: {
                    text: 'Count'
                },
                labels: {}
            }

            const baseColumnOptions: Highcharts.PlotColumnOptions = {
                borderRadius: 4,
                pointPadding: 0.08,
                groupPadding: 0.18,
                dataLabels: MONTHLY_DATA_LABELS
            }

            if (selection) {
                const monthLabel = dayjs(
                    `${selection.monthKey}-01`
                ).format('MMMM YYYY')

                const deliveryMap =
                    monthlyModel.deliveredByMonth.get(
                        selection.monthKey
                    ) || new Map<string, number>()

                const smeMap =
                    monthlyModel
                        .smesByMonthAndIntervention
                        .get(selection.monthKey) ||
                    new Map<string, Set<string>>()

                const interventionNames = Array.from(
                    new Set([
                        ...deliveryMap.keys(),
                        ...smeMap.keys()
                    ])
                ).sort((a, b) => {
                    const deliveryDifference =
                        (deliveryMap.get(b) || 0) -
                        (deliveryMap.get(a) || 0)

                    return (
                        deliveryDifference ||
                        a.localeCompare(b)
                    )
                })

                const smeValues = interventionNames.map(
                    intervention =>
                        smeMap.get(intervention)?.size || 0
                )

                const deliveryValues =
                    interventionNames.map(
                        intervention =>
                            deliveryMap.get(intervention) || 0
                    )

                const detailTooltip: Highcharts.TooltipOptions = {
                    shared:
                        selection.metric === 'both',
                    useHTML: true,
                    formatter: function () {
                        const context = this as any
                        const pointIndex = Number(
                            context.x ?? 0
                        )

                        const intervention =
                            interventionNames[
                            pointIndex
                            ] || 'Untitled'

                        const points:
                            | Highcharts.Point[]
                            | undefined =
                            context.points

                        if (
                            selection.metric === 'both' &&
                            points?.length
                        ) {
                            const lines = points
                                .map(point => {
                                    const value =
                                        Number(
                                            point.y || 0
                                        )

                                    return `
                                        <span style="color:${point.color}">●</span>
                                        ${escapeDataLabelHtml(
                                        point.series.name
                                    )}:
                                        <b>${value}</b>
                                    `
                                })
                                .join('<br/>')

                            return `
                                <b>${escapeDataLabelHtml(
                                intervention
                            )}</b><br/>
                                ${lines}
                            `
                        }

                        const label =
                            selection.metric === 'smes'
                                ? 'Unique SMEs Reached'
                                : 'Interventions Delivered'

                        return `
                            <b>${escapeDataLabelHtml(
                            intervention
                        )}</b><br/>
                            ${label}: <b>${Number(
                            context.y || 0
                        )}</b>
                        `
                    }
                }

                const detailSeries:
                    Highcharts.SeriesOptionsType[] = []

                if (
                    selection.metric === 'smes' ||
                    selection.metric === 'both'
                ) {
                    detailSeries.push({
                        type: 'column',
                        name: 'Unique SMEs Reached',
                        color:
                            REPORT_CHART_COLORS.primary,
                        data: smeValues,
                        dataLabels:
                            MONTHLY_DATA_LABELS
                    })
                }

                if (
                    selection.metric === 'delivered' ||
                    selection.metric === 'both'
                ) {
                    detailSeries.push({
                        type: 'column',
                        name:
                            'Interventions Delivered',
                        color:
                            REPORT_CHART_COLORS.success,
                        data: deliveryValues,
                        dataLabels:
                            MONTHLY_DATA_LABELS
                    })
                }

                return {
                    chart: {
                        type: 'column',
                        height: 340,
                        backgroundColor: 'transparent'
                    },
                    title: {
                        text: undefined
                    },
                    exporting: {
                        enabled: false
                    },
                    credits: {
                        enabled: false
                    },
                    legend: {
                        enabled:
                            selection.metric === 'both',
                        align: 'center',
                        verticalAlign: 'bottom'
                    },
                    xAxis: {
                        categories:
                            interventionNames,
                        labels: {
                            autoRotation: [-35, -60]
                        }
                    },
                    yAxis: baseYAxis,
                    tooltip: detailTooltip,
                    plotOptions: {
                        column: baseColumnOptions
                    },
                    series: detailSeries
                }
            }

            const monthLabels =
                monthlyModel.monthKeys.map(monthKey =>
                    dayjs(`${monthKey}-01`).format(
                        'MMM YYYY'
                    )
                )

            const bindMonthLabelClicks = (
                chart: Highcharts.Chart
            ) => {
                const axis = chart.xAxis[0]

                Object.values(axis.ticks).forEach(
                    tick => {
                        const pointIndex = Number(
                            tick.pos
                        )
                        const monthKey =
                            monthlyModel.monthKeys[
                            pointIndex
                            ]
                        const element =
                            tick.label?.element as
                            | (SVGElement & {
                                onclick:
                                | (() => void)
                                | null
                            })
                            | undefined

                        if (!element || !monthKey) {
                            return
                        }

                        element.style.cursor =
                            'pointer'

                        element.onclick = () => {
                            openDetail(
                                monthKey,
                                'both'
                            )
                        }
                    }
                )
            }

            const rootTooltip: Highcharts.TooltipOptions = {
                shared: true,
                useHTML: true,
                formatter: function () {
                    const context = this as any
                    const points:
                        | Highcharts.Point[]
                        | undefined =
                        context.points

                    const firstPoint =
                        points?.[0] || context

                    const pointIndex = Number(
                        firstPoint.x ?? 0
                    )

                    const monthLabel =
                        monthLabels[pointIndex] ||
                        'Month'

                    const lines = (
                        points || [firstPoint]
                    )
                        .map(point => {
                            const value = Number(
                                point.y || 0
                            )

                            return `
                                <span style="color:${point.color}">●</span>
                                ${escapeDataLabelHtml(
                                point.series.name
                            )}:
                                <b>${value}</b>
                            `
                        })
                        .join('<br/>')

                    return `
                        <b>${escapeDataLabelHtml(
                        monthLabel
                    )}</b><br/>
                        ${lines}<br/>
                        <span style="color:#64748b">
                            Click a bar or month label for details
                        </span>
                    `
                }
            }

            return {
                chart: {
                    type: 'column',
                    height: 340,
                    backgroundColor: 'transparent',
                    events: {
                        load: function () {
                            bindMonthLabelClicks(this)
                        },
                        redraw: function () {
                            bindMonthLabelClicks(this)
                        }
                    }
                },
                title: {
                    text: undefined
                },
                exporting: {
                    enabled: false
                },
                credits: {
                    enabled: false
                },
                xAxis: {
                    categories: monthLabels,
                    // Clickable month names; reach.css keeps them link-coloured in dark mode.
                    className: 'reach-month-axis',
                    labels: {
                        style: {
                            // A link colour that reads on light and dark cards.
                            color: '#3b82f6',
                            cursor: 'pointer',
                            fontWeight: '600',
                            textDecoration:
                                'underline'
                        }
                    }
                },
                yAxis: baseYAxis,
                tooltip: rootTooltip,
                legend: {
                    align: 'center',
                    verticalAlign: 'bottom'
                },
                plotOptions: {
                    column: baseColumnOptions
                },
                series: [
                    {
                        type: 'column',
                        name: 'SMEs Reached',
                        color:
                            REPORT_CHART_COLORS.primary,
                        data:
                            monthlyModel.monthKeys.map(
                                monthKey =>
                                    monthlyModel.monthSmes.get(
                                        monthKey
                                    )?.size || 0
                            ),
                        dataLabels:
                            MONTHLY_DATA_LABELS,
                        cursor: 'pointer',
                        point: {
                            events: {
                                click: function () {
                                    const monthKey =
                                        monthlyModel.monthKeys[
                                        this.index
                                        ]

                                    if (monthKey) {
                                        openDetail(
                                            monthKey,
                                            'smes'
                                        )
                                    }
                                }
                            }
                        }
                    },
                    {
                        type: 'column',
                        name:
                            'Interventions Delivered',
                        color:
                            REPORT_CHART_COLORS.success,
                        data:
                            monthlyModel.monthKeys.map(
                                monthKey =>
                                    monthlyModel.monthDeliveries.get(
                                        monthKey
                                    ) || 0
                            ),
                        dataLabels:
                            MONTHLY_DATA_LABELS,
                        cursor: 'pointer',
                        point: {
                            events: {
                                click: function () {
                                    const monthKey =
                                        monthlyModel.monthKeys[
                                        this.index
                                        ]

                                    if (monthKey) {
                                        openDetail(
                                            monthKey,
                                            'delivered'
                                        )
                                    }
                                }
                            }
                        }
                    }
                ]
            }
        }, [
            selection,
            monthlyModel,
            openDetail
        ])

        const detailTitle = selection
            ? `${selection.metric === 'smes'
                ? 'Unique SMEs Reached'
                : selection.metric ===
                    'delivered'
                    ? 'Interventions Delivered'
                    : 'Reach'
            } by Intervention — ${dayjs(
                `${selection.monthKey}-01`
            ).format('MMMM YYYY')}`
            : null

        return (
            <div style={{ width: '100%' }}>
                {selection && (
                    <div
                        style={{
                            display: 'flex',
                            justifyContent:
                                'space-between',
                            alignItems: 'center',
                            gap: 12,
                            marginBottom: 8,
                            flexWrap: 'wrap'
                        }}
                    >
                        <Text strong>
                            {detailTitle}
                        </Text>

                        <Button
                            type='link'
                            icon={
                                <ArrowLeftOutlined />
                            }
                            onClick={closeDetail}
                        >
                            Back to monthly view
                        </Button>
                    </div>
                )}

                <HighchartsReact
                    key={
                        selection
                            ? `${selection.metric}-${selection.monthKey}`
                            : 'monthly-root'
                    }
                    highcharts={Highcharts}
                    options={chartOptions}
                    immutable
                />
            </div>
        )
    }
)

ReachMonthlyDrilldownChart.displayName =
    'ReachMonthlyDrilldownChart'

const ReachAnalytics: React.FC<ReachAnalyticsProps> = ({
    rows,
    participants,
    loading = false,
    isMain = false,
    departmentId,
    departmentOptions = [],
    onControls
}) => {
    const { nameOf } = useDepartmentRoles()
    const [selectedIntervention, setSelectedIntervention] = useState('all')
    const [selectedDepartmentId, setSelectedDepartmentId] = useState(
        isMain ? 'all' : departmentId
    )
    const [selectedDemographics, setSelectedDemographics] = useState<
        DemographicKey[]
    >(ALL_DEMOGRAPHICS)
    const [whatToDoOpen, setWhatToDoOpen] = useState(false)
    const [reachDrillSelection, setReachDrillSelection] =
        useState<ReachDrillSelection | null>(null)

    const selectedMonthKey =
        reachDrillSelection?.monthKey || null

    const handleReachDrillSelectionChange = useCallback(
        (selection: ReachDrillSelection | null) => {
            setReachDrillSelection(selection)
        },
        []
    )

    const resolvedDepartmentOptions = useMemo<ReachDepartmentOption[]>(() => {
        const optionsMap = new Map<string, string>()

        departmentOptions.forEach(option => {
            if (option.value) optionsMap.set(option.value, option.label)
        })

        rows.forEach(row => {
            const id = String(row.departmentId || '').trim()
            if (!id) return

            const name = nameOf(
                id,
                normalizeText(row.departmentName || row.snapshot?.departmentName, 'Unspecified Department')
            )

            if (!optionsMap.has(id)) optionsMap.set(id, name)
        })

        return Array.from(optionsMap.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label))
    }, [departmentOptions, rows, nameOf])

    const departmentNameById = useMemo(() => {
        return new Map(
            resolvedDepartmentOptions.map(option => [option.value, option.label])
        )
    }, [resolvedDepartmentOptions])

    const resolveDepartmentName = (
        row: ReachAssignedIntervention
    ): string => {
        const id = String(row.departmentId || '').trim()

        return normalizeText(
            departmentNameById.get(id) ||
            row.departmentName ||
            row.snapshot?.departmentName,
            'Unspecified Department'
        )
    }

    useEffect(() => {
        if (!isMain) {
            setSelectedDepartmentId(departmentId)
            return
        }

        if (selectedDepartmentId === 'all') return

        const stillAvailable = resolvedDepartmentOptions.some(
            option => option.value === selectedDepartmentId
        )

        if (!stillAvailable) setSelectedDepartmentId('all')
    }, [
        isMain,
        departmentId,
        selectedDepartmentId,
        resolvedDepartmentOptions
    ])

    const departmentScopedRows = useMemo(() => {
        if (isMain) {
            if (selectedDepartmentId === 'all') return [...rows]

            return rows.filter(
                row => String(row.departmentId || '') === selectedDepartmentId
            )
        }

        return rows.filter(
            row => String(row.departmentId || '') === departmentId
        )
    }, [rows, isMain, selectedDepartmentId, departmentId])

    const interventionOptions = useMemo(() => {
        const titles = Array.from(
            new Set<string>(
                departmentScopedRows.map(row =>
                    normalizeText(row.interventionTitle, 'Untitled')
                )
            )
        ).sort((a, b) => a.localeCompare(b))

        return [
            { label: 'All Interventions', value: 'all' },
            ...titles.map(title => ({ label: title, value: title }))
        ]
    }, [departmentScopedRows])

    useEffect(() => {
        if (selectedIntervention === 'all') return

        const stillAvailable = interventionOptions.some(
            option => option.value === selectedIntervention
        )

        if (!stillAvailable) setSelectedIntervention('all')
    }, [interventionOptions, selectedIntervention])

    // The pickers, for a host that shows them behind its own Filters button.
    useEffect(() => {
        if (!onControls) return
        const departmentChanged = isMain && selectedDepartmentId !== 'all'
        const interventionChanged = selectedIntervention !== 'all'
        const chartsChanged = selectedDemographics.length !== ALL_DEMOGRAPHICS.length
        const activeCount = [departmentChanged, interventionChanged, chartsChanged].filter(Boolean).length
        const departmentLabel =
            resolvedDepartmentOptions.find(option => option.value === selectedDepartmentId)?.label || 'All'
        onControls({
            activeCount,
            summary: [
                ...(isMain
                    ? [{
                        label: 'Department',
                        value: departmentChanged ? departmentLabel : 'All',
                        onClear: departmentChanged ? () => setSelectedDepartmentId('all') : undefined
                    }]
                    : []),
                {
                    label: 'Intervention',
                    value: interventionChanged ? selectedIntervention : 'All',
                    onClear: interventionChanged ? () => setSelectedIntervention('all') : undefined
                },
                ...(chartsChanged
                    ? [{
                        label: 'Charts',
                        value: `${selectedDemographics.length} of ${ALL_DEMOGRAPHICS.length}`,
                        onClear: () => setSelectedDemographics(ALL_DEMOGRAPHICS)
                    }]
                    : [])
            ],
            panel: (
                <FilterPanel
                    canReset={activeCount > 0}
                    onReset={() => {
                        if (isMain) setSelectedDepartmentId('all')
                        setSelectedIntervention('all')
                        setSelectedDemographics(ALL_DEMOGRAPHICS)
                    }}
                >
                    {isMain && (
                        <div>
                            <label className='ws-filter-label' htmlFor='reach-department'>Department</label>
                            <Select
                                id='reach-department'
                                value={selectedDepartmentId}
                                onChange={setSelectedDepartmentId}
                                style={{ width: '100%' }}
                                showSearch
                                optionFilterProp='label'
                                options={[{ label: 'All departments', value: 'all' }, ...resolvedDepartmentOptions]}
                            />
                        </div>
                    )}
                    <div>
                        <label className='ws-filter-label' htmlFor='reach-intervention'>Intervention</label>
                        <Select
                            id='reach-intervention'
                            value={selectedIntervention}
                            onChange={setSelectedIntervention}
                            options={interventionOptions}
                            style={{ width: '100%' }}
                            showSearch
                            optionFilterProp='label'
                        />
                    </div>
                    <div>
                        <span className='ws-filter-label' id='reach-charts-label'>Charts to show</span>
                        <Checkbox.Group
                            aria-labelledby='reach-charts-label'
                            className='reach-chart-picker'
                            value={selectedDemographics}
                            onChange={values => setSelectedDemographics(values as DemographicKey[])}
                            options={DEMOGRAPHIC_OPTIONS.map(option => ({ label: option.label, value: option.value }))}
                        />
                    </div>
                </FilterPanel>
            )
        })
    }, [onControls, isMain, selectedDepartmentId, selectedIntervention, selectedDemographics, resolvedDepartmentOptions, interventionOptions])

    useEffect(() => () => onControls?.(null), [onControls])

    const scopedRows = useMemo(() => {
        if (selectedIntervention === 'all') {
            return departmentScopedRows
        }

        return departmentScopedRows.filter(
            row =>
                normalizeText(row.interventionTitle, 'Untitled') ===
                selectedIntervention
        )
    }, [departmentScopedRows, selectedIntervention])

    useEffect(() => {
        setReachDrillSelection(null)
    }, [
        selectedDepartmentId,
        selectedIntervention,
        departmentId,
        isMain
    ])

    const deliveredRows = useMemo(
        () => scopedRows.filter(isCompletedRow),
        [scopedRows]
    )

    const selectedMonthRows = useMemo(() => {
        if (!selectedMonthKey) return scopedRows

        return scopedRows.filter(row => {
            const date = getActivityDate(row)
            return date?.format('YYYY-MM') === selectedMonthKey
        })
    }, [scopedRows, selectedMonthKey])

    const selectedMonthDeliveredRows = useMemo(
        () => selectedMonthRows.filter(isCompletedRow),
        [selectedMonthRows]
    )

    const reachRows = useMemo<ReachItem[]>(() => {
        return deliveredRows.map(row => {
            const participant = row.participantId
                ? participants[row.participantId]
                : undefined

            const age = getParticipantAge(participant)
            const ward =
                firstValue(participant?.ward) || firstValue(participant?.hub)
            const rowDepartmentId = String(row.departmentId || '').trim()

            return {
                row,
                participant,
                departmentId: rowDepartmentId || 'unassigned',
                departmentName: resolveDepartmentName(row),
                gender: normalizeGender(
                    normalizeText(participant?.gender, 'Unspecified')
                ),
                ageBand: getAgeBand(age),
                sector: labelize(firstValue(participant?.sector)),
                ward: labelize(ward),
                beeLevel: getBeeLevelLabel(participant),
                blackOwnedPercent: normalizePercentage(
                    participant?.blackOwnedPercent
                ),
                femaleOwnedPercent: normalizePercentage(
                    participant?.femaleOwnedPercent
                ),
                youthOwnedPercent: normalizePercentage(
                    participant?.youthOwnedPercent
                ),
                intervention: normalizeText(
                    row.interventionTitle,
                    'Untitled'
                )
            }
        })
    }, [deliveredRows, participants, departmentNameById])

    const demographicReachRows = useMemo(() => {
        if (!selectedMonthKey) return reachRows

        return reachRows.filter(item => {
            const date = getActivityDate(item.row)
            return date?.format('YYYY-MM') === selectedMonthKey
        })
    }, [reachRows, selectedMonthKey])

    /**
     * Filter to the drilled month first, then deduplicate SMEs. This means an
     * SME serviced several times in one month contributes once to each
     * demographic chart for that month.
     */
    const uniqueSmeRows = useMemo(() => {
        const uniqueMap = new Map<string, ReachItem>()

        demographicReachRows.forEach(item => {
            const key = getReachSmeKey(item)

            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, item)
            }
        })

        return Array.from(uniqueMap.values())
    }, [demographicReachRows])

    const monthlyData = useMemo(() => {
        const deliveries: Record<string, number> = {}
        const smes: Record<string, Set<string>> = {}

        reachRows.forEach(item => {
            const date = getActivityDate(item.row)
            if (!date) return

            const monthKey = date.format('YYYY-MM')
            deliveries[monthKey] = (deliveries[monthKey] || 0) + 1

            const smeKey = getReachSmeKey(item)

            if (!smes[monthKey]) {
                smes[monthKey] = new Set()
            }

            smes[monthKey].add(smeKey)
        })

        const keys = Array.from(
            new Set([...Object.keys(deliveries), ...Object.keys(smes)])
        ).sort()

        return {
            keys,
            deliveries: keys.map(key => deliveries[key] || 0),
            smes: keys.map(key => smes[key]?.size || 0)
        }
    }, [reachRows])

    /** ROM-equivalent demographic datasets, plus interventions delivered per SME on average. */
    const genderCounts = useMemo(
        () => withInterventionAverage(
            countBy<ReachItem>(uniqueSmeRows, item => item.gender),
            demographicReachRows,
            item => item.gender
        ),
        [uniqueSmeRows, demographicReachRows]
    )

    const beeCounts = useMemo(
        () => withInterventionAverage(
            countBy<ReachItem>(uniqueSmeRows, item => item.beeLevel),
            demographicReachRows,
            item => item.beeLevel
        ),
        [uniqueSmeRows, demographicReachRows]
    )

    const wardCounts = useMemo(
        () => withInterventionAverage(
            countBy<ReachItem>(uniqueSmeRows, item => item.ward),
            demographicReachRows,
            item => item.ward
        ),
        [uniqueSmeRows, demographicReachRows]
    )

    const sectorCounts = useMemo(
        () => withInterventionAverage(
            countBy<ReachItem>(uniqueSmeRows, item => item.sector),
            demographicReachRows,
            item => item.sector
        ),
        [uniqueSmeRows, demographicReachRows]
    )

    const ageDistribution = useMemo(() => {
        const count = (
            gender: 'male' | 'female',
            bucket: (typeof AGE_BUCKETS)[number]
        ) =>
            uniqueSmeRows.filter(item => {
                const age = getParticipantAge(item.participant)

                return (
                    age != null &&
                    age >= bucket.min &&
                    age <= bucket.max &&
                    item.gender.toLowerCase() === gender
                )
            }).length

        return {
            male: AGE_BUCKETS.map(bucket => count('male', bucket)),
            female: AGE_BUCKETS.map(bucket => count('female', bucket))
        }
    }, [uniqueSmeRows])

    const ownershipAverages = useMemo(() => {
        const measure = (values: Array<number | null>) => ({
            value: averageKnownValues(values),
            known: values.filter(value => typeof value === 'number' && Number.isFinite(value)).length
        })
        return {
            black: measure(uniqueSmeRows.map(item => item.blackOwnedPercent)),
            female: measure(uniqueSmeRows.map(item => item.femaleOwnedPercent)),
            youth: measure(uniqueSmeRows.map(item => item.youthOwnedPercent))
        }
    }, [uniqueSmeRows])

    const genderOptions = useMemo(
        () => simplePieOptions(genderCounts, 'SMEs'),
        [genderCounts]
    )

    const beeOptions = useMemo(
        () => simplePieOptions(beeCounts, 'SMEs'),
        [beeCounts]
    )

    const wardOptions = useMemo(
        () => simplePieOptions(wardCounts, 'SMEs'),
        [wardCounts]
    )

    const sectorOptions = useMemo(
        () => simplePieOptions(sectorCounts, 'SMEs'),
        [sectorCounts]
    )

    /**
     * This matches the ROM age population-pyramid chart.
     */
    const ageOptions: Highcharts.Options = useMemo(
        () => ({
            chart: {
                type: 'bar',
                height: 320,
                backgroundColor: 'transparent'
            },
            title: { text: '' },
            credits: { enabled: false },
            exporting: { enabled: false },
            xAxis: [
                {
                    categories: AGE_BUCKETS.map(bucket => bucket.label),
                    reversed: false
                },
                {
                    categories: AGE_BUCKETS.map(bucket => bucket.label),
                    reversed: false,
                    opposite: true,
                    linkedTo: 0
                }
            ],
            yAxis: {
                title: { text: '' }, // empty hides the axis title
                labels: {
                    formatter: function () {
                        return Math.abs(Number(this.value)).toString()
                    }
                }
            },
            tooltip: {
                formatter: function () {
                    return `<b>${this.series.name}</b><br/>${this.key}: <b>${Math.abs(
                        Number(this.y || 0)
                    )}</b>`
                }
            },
            plotOptions: {
                series: {
                    stacking: 'normal',
                    dataLabels: {
                        enabled: true,
                        crop: false,
                        overflow: 'allow',
                        formatter: function () {
                            const value = Math.abs(Number(this.y || 0))
                            return value > 0 ? String(value) : null
                        },
                        style: {
                            textOutline: 'none',
                            fontWeight: '700'
                        }
                    }
                }
            },
            series: [
                {
                    type: 'bar',
                    name: 'Male',
                    color: REPORT_CHART_COLORS.primary,
                    data: ageDistribution.male.map(value => -value)
                },
                {
                    type: 'bar',
                    name: 'Female',
                    color: REPORT_CHART_COLORS.success,
                    data: ageDistribution.female
                }
            ]
        }),
        [ageDistribution]
    )

    const departmentActionRows = useMemo<DepartmentActionRow[]>(() => {
        const grouped = new Map<
            string,
            {
                id: string
                name: string
                total: number
                completed: number
                open: number
                uniqueSmes: Set<string>
                missingParticipants: number
            }
        >()

        selectedMonthRows.forEach(row => {
            const id = String(row.departmentId || 'unassigned')
            const name = resolveDepartmentName(row)

            if (!grouped.has(id)) {
                grouped.set(id, {
                    id,
                    name,
                    total: 0,
                    completed: 0,
                    open: 0,
                    uniqueSmes: new Set(),
                    missingParticipants: 0
                })
            }

            const entry = grouped.get(id)!
            entry.total += 1

            if (isCompletedRow(row)) entry.completed += 1
            else entry.open += 1

            const participant = row.participantId
                ? participants[row.participantId]
                : undefined

            const reachItemForIdentity: ReachItem = {
                row,
                participant,
                departmentId: id,
                departmentName: name,
                gender: 'Unspecified',
                ageBand: 'Unspecified',
                sector: 'Unspecified',
                ward: 'Unspecified',
                beeLevel: 'Unspecified',
                blackOwnedPercent: null,
                femaleOwnedPercent: null,
                youthOwnedPercent: null,
                intervention: normalizeText(
                    row.interventionTitle,
                    'Untitled'
                )
            }

            entry.uniqueSmes.add(
                getReachSmeKey(
                    reachItemForIdentity
                )
            )

            if (row.participantId && !participants[row.participantId]) {
                entry.missingParticipants += 1
            }
        })

        return Array.from(grouped.values())
            .map(entry => ({
                id: entry.id,
                name: entry.name,
                total: entry.total,
                completed: entry.completed,
                open: entry.open,
                uniqueSmes: entry.uniqueSmes.size,
                missingParticipants: entry.missingParticipants
            }))
            .sort((a, b) => b.open - a.open || b.total - a.total)
    }, [selectedMonthRows, participants, departmentNameById])

    const scopeLabel = useMemo(() => {
        if (isMain && selectedDepartmentId === 'all') {
            return 'All Departments'
        }

        const activeDepartmentId = isMain
            ? selectedDepartmentId
            : departmentId

        return (
            departmentNameById.get(activeDepartmentId) ||
            departmentActionRows[0]?.name ||
            'Current Department'
        )
    }, [
        isMain,
        selectedDepartmentId,
        departmentId,
        departmentNameById,
        departmentActionRows
    ])

    const selectedMonthLabel = useMemo(
        () =>
            selectedMonthKey
                ? dayjs(`${selectedMonthKey}-01`).format('MMMM YYYY')
                : null,
        [selectedMonthKey]
    )

    const analysisScopeLabel = selectedMonthLabel
        ? `${scopeLabel} — ${selectedMonthLabel}`
        : scopeLabel

    const interpretation = useMemo(() => {
        const observations: string[] = []
        const actions: string[] = []

        if (!selectedMonthRows.length) {
            return {
                observations: [
                    `There are no intervention records for ${analysisScopeLabel} in the current selection.`
                ],
                actions: [
                    `Check the programme, date range, department and intervention filters for ${analysisScopeLabel}.`
                ]
            }
        }

        const completedCount = selectedMonthDeliveredRows.length
        const openCount = Math.max(
            selectedMonthRows.length - completedCount,
            0
        )
        const completionRate = selectedMonthRows.length
            ? Math.round((completedCount / selectedMonthRows.length) * 100)
            : 0

        observations.push(
            `${analysisScopeLabel} has completed ${completedCount} of ${selectedMonthRows.length} interventions (${completionRate}%). ${openCount} remain open.`
        )

        observations.push(
            `${uniqueSmeRows.length} unique SMEs were reached through completed interventions.`
        )

        const topGender = getTopEntry(genderCounts)
        const topAge = [
            ...AGE_BUCKETS.map((bucket, index) => ({
                name: bucket.label,
                y:
                    ageDistribution.male[index] +
                    ageDistribution.female[index]
            }))
        ].sort((a, b) => b.y - a.y)[0]
        const topSector = getTopEntry(sectorCounts)
        const topWard = getTopEntry(wardCounts)
        const topBee = getTopEntry(beeCounts)

        if (topGender) {
            observations.push(
                `${topGender.name} is the largest recorded gender group at ${topGender.y} SMEs.`
            )
        }

        if (topAge?.y) {
            observations.push(
                `${topAge.name} is the largest recorded age group at ${topAge.y} SMEs.`
            )
        }

        if (topSector) {
            observations.push(
                `${topSector.name} has the highest sector reach at ${topSector.y} SMEs.`
            )
        }

        if (topWard) {
            observations.push(
                `${topWard.name} has the highest ward or hub reach at ${topWard.y} SMEs.`
            )
        }

        if (topBee) {
            observations.push(
                `${topBee.name} is the most common recorded B-BBEE category at ${topBee.y} SMEs.`
            )
        }

        const ownershipText = [
            ownershipAverages.black.value != null
                ? `black ownership averages ${ownershipAverages.black.value}%`
                : null,
            ownershipAverages.female.value != null
                ? `female ownership averages ${ownershipAverages.female.value}%`
                : null,
            ownershipAverages.youth.value != null
                ? `youth ownership averages ${ownershipAverages.youth.value}%`
                : null
        ].filter(Boolean)

        if (ownershipText.length) {
            observations.push(
                `Across reached SMEs, ${ownershipText.join(', ')}.`
            )
        }

        /**
         * Main departments receive department-specific follow-up instructions.
         * A selected or non-main department receives instructions for its own scope.
         */
        if (isMain && selectedDepartmentId === 'all') {
            const departmentsWithOpenWork = departmentActionRows.filter(
                department => department.open > 0
            )

            departmentsWithOpenWork.forEach(department => {
                actions.push(
                    `Follow up with ${department.name}: ${department.open} of ${department.total} interventions are still open. Confirm the next appointments, delivery status and completion evidence.`
                )
            })

            if (!departmentsWithOpenWork.length) {
                actions.push(
                    'No department currently has open interventions in this selection. Continue monitoring new assignments and completion evidence.'
                )
            }
        } else {
            const department = departmentActionRows[0]

            if (department?.open) {
                actions.push(
                    `${department.name} must follow up on ${department.open} open interventions. Confirm the next appointment, delivery progress and completion evidence for each one.`
                )
            } else {
                actions.push(
                    `${analysisScopeLabel} has no open interventions in this selection. Continue monitoring new assignments and evidence quality.`
                )
            }
        }

        departmentActionRows
            .filter(department => department.missingParticipants > 0)
            .forEach(department => {
                actions.push(
                    `${department.name} must resolve ${department.missingParticipants} intervention records whose participant profiles could not be loaded.`
                )
            })

        const missingDemographics = [
            {
                label: 'gender',
                count:
                    genderCounts.find(item => item.name === 'Unspecified')?.y ||
                    0
            },
            {
                label: 'ward or hub',
                count:
                    wardCounts.find(item => item.name === 'Unspecified')?.y ||
                    0
            },
            {
                label: 'sector',
                count:
                    sectorCounts.find(item => item.name === 'Unspecified')?.y ||
                    0
            },
            {
                label: 'B-BBEE level',
                count:
                    beeCounts.find(item => item.name === 'Unspecified')?.y || 0
            }
        ].filter(item => item.count > 0)

        if (missingDemographics.length) {
            actions.push(
                `${analysisScopeLabel} must complete missing participant information: ${missingDemographics
                    .map(item => `${item.count} missing ${item.label}`)
                    .join(', ')}.`
            )
        }

        const topConcentration = [
            topSector
                ? {
                    label: topSector.name,
                    count: topSector.y,
                    dimension: 'sector'
                }
                : null,
            topWard
                ? {
                    label: topWard.name,
                    count: topWard.y,
                    dimension: 'ward or hub'
                }
                : null
        ].filter(Boolean) as Array<{
            label: string
            count: number
            dimension: string
        }>

        topConcentration.forEach(item => {
            if (!uniqueSmeRows.length) return

            const share = Math.round((item.count / uniqueSmeRows.length) * 100)

            if (share >= 50) {
                actions.push(
                    `${analysisScopeLabel} should confirm whether the ${share}% concentration in ${item.label} matches the programme's intended ${item.dimension} coverage.`
                )
            }
        })

        return { observations, actions }
    }, [
        selectedMonthRows,
        selectedMonthDeliveredRows,
        uniqueSmeRows,
        genderCounts,
        ageDistribution,
        sectorCounts,
        wardCounts,
        beeCounts,
        ownershipAverages,
        isMain,
        selectedDepartmentId,
        departmentActionRows,
        analysisScopeLabel
    ])

    if (loading) return <ReachLoadingSkeleton />

    const visibleDemographics = DEMOGRAPHIC_OPTIONS.filter(option =>
        selectedDemographics.includes(option.value)
    )

    const hasMonthlyData =
        monthlyData.deliveries.some(Boolean) || monthlyData.smes.some(Boolean)

    const renderDemographic = (key: DemographicKey) => {
        if (key === 'gender') {
            return hasPieData(genderCounts) ? (
                <HighchartsReact
                    highcharts={Highcharts}
                    options={genderOptions}
                />
            ) : (
                <Empty description='No gender information available' />
            )
        }

        if (key === 'age') {
            const hasAgeData =
                ageDistribution.male.some(Boolean) ||
                ageDistribution.female.some(Boolean)

            return hasAgeData ? (
                <HighchartsReact highcharts={Highcharts} options={ageOptions} />
            ) : (
                <Empty description='No age information available' />
            )
        }

        if (key === 'beeLevel') {
            return hasPieData(beeCounts) ? (
                <HighchartsReact highcharts={Highcharts} options={beeOptions} />
            ) : (
                <Empty description='No B-BBEE information available' />
            )
        }

        if (key === 'ward') {
            return hasPieData(wardCounts) ? (
                <HighchartsReact highcharts={Highcharts} options={wardOptions} />
            ) : (
                <Empty description='No ward or hub information available' />
            )
        }

        if (key === 'sector') {
            return hasPieData(sectorCounts) ? (
                <HighchartsReact
                    highcharts={Highcharts}
                    options={sectorOptions}
                />
            ) : (
                <Empty description='No sector information available' />
            )
        }

        return (
            <OwnershipProfile
                black={ownershipAverages.black}
                female={ownershipAverages.female}
                youth={ownershipAverages.youth}
                total={uniqueSmeRows.length}
            />
        )
    }

    const demographicTitle: Record<DemographicKey, string> = {
        gender: 'Gender Distribution',
        age: 'Age Distribution',
        beeLevel: 'B-BBEE Level Distribution',
        ward: 'Ward Distribution',
        sector: 'Sector Distribution',
        ownership: 'SME Ownership Profile'
    }

    const getDemographicTitle = (key: DemographicKey) =>
        selectedMonthLabel
            ? `${demographicTitle[key]} — ${selectedMonthLabel}`
            : demographicTitle[key]

    return (
        <>
            <Row gutter={[16, 16]}>
                {!onControls && (
                <Col xs={24}>
                    <MotionCard
                        filterBar={
                            <Space
                                direction='vertical'
                                size={14}
                                style={{ width: '100%' }}
                            >
                                {/* Row 1: selectors and action */}
                                <Row
                                    gutter={[12, 12]}
                                    align='bottom'
                                    style={{ width: '100%' }}
                                >
                                    {isMain && (
                                        <Col xs={24} md={9}>
                                            <Space
                                                direction='vertical'
                                                size={4}
                                                style={{ width: '100%' }}
                                            >
                                                <Text type='secondary'>Department</Text>

                                                <Select
                                                    value={selectedDepartmentId}
                                                    onChange={setSelectedDepartmentId}
                                                    style={{ width: '100%' }}
                                                    showSearch
                                                    optionFilterProp='label'
                                                    options={[
                                                        {
                                                            label: 'All Departments',
                                                            value: 'all'
                                                        },
                                                        ...resolvedDepartmentOptions
                                                    ]}
                                                />
                                            </Space>
                                        </Col>
                                    )}

                                    <Col
                                        xs={24}
                                        md={isMain ? 9 : 18}
                                    >
                                        <Space
                                            direction='vertical'
                                            size={4}
                                            style={{ width: '100%' }}
                                        >
                                            <Text type='secondary'>Intervention</Text>

                                            <Select
                                                value={selectedIntervention}
                                                onChange={setSelectedIntervention}
                                                options={interventionOptions}
                                                style={{ width: '100%' }}
                                                showSearch
                                                optionFilterProp='label'
                                            />
                                        </Space>
                                    </Col>



                                    <Col xs={24} md={6}>
                                        <Button
                                            block
                                            type='primary'
                                            icon={<BulbOutlined />}
                                            onClick={() => setWhatToDoOpen(true)}
                                        >
                                            What to do
                                        </Button>
                                    </Col>
                                </Row>

                                {/* Row 2: one-line demographics */}
                                <div style={{ width: '100%' }}>
                                    <Text
                                        type='secondary'
                                        style={{ display: 'block', marginBottom: 8 }}
                                    >
                                        Charts to show
                                    </Text>

                                    <Checkbox.Group
                                        value={selectedDemographics}
                                        onChange={values =>
                                            setSelectedDemographics(
                                                values as DemographicKey[]
                                            )
                                        }
                                        style={{ width: '100%' }}
                                    >
                                        <div
                                            className='reach-demographic-checkboxes'
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 22,
                                                width: '100%',
                                                flexWrap: 'nowrap',
                                                overflowX: 'auto',
                                                paddingBottom: 2,
                                                scrollbarWidth: 'none'
                                            }}
                                        >
                                            {DEMOGRAPHIC_OPTIONS.map(option => (
                                                <Checkbox
                                                    key={option.value}
                                                    value={option.value}
                                                    style={{
                                                        marginInlineStart: 0,
                                                        whiteSpace: 'nowrap',
                                                        flex: '0 0 auto'
                                                    }}
                                                >
                                                    {option.label}
                                                </Checkbox>
                                            ))}
                                        </div>
                                    </Checkbox.Group>
                                </div>

                                <Text type='secondary' style={{ fontSize: 12.5 }}>
                                    Each SME is counted once. Click a month in the chart
                                    below to see the demographics for that month only.
                                </Text>
                            </Space>
                        }
                        filterBarProps={{ marginBottom: 0 }}
                    />
                </Col>
                )}

                <Col xs={24}>
                    <MotionCard
                        title='SMEs reached and interventions delivered'
                        extra={
                            onControls ? (
                                <Button icon={<BulbOutlined />} onClick={() => setWhatToDoOpen(true)}>
                                    What to do
                                </Button>
                            ) : undefined
                        }
                    >
                        {onControls ? (
                            <Text type='secondary' className='reach-chart-hint'>
                                Each SME is counted once. Click a month to see the demographics for that month only.
                            </Text>
                        ) : null}
                        {hasMonthlyData ? (
                            <ReachMonthlyDrilldownChart
                                rows={reachRows}
                                selection={reachDrillSelection}
                                onSelectionChange={
                                    handleReachDrillSelectionChange
                                }
                            />
                        ) : (
                            <Empty description='No completed reach activity for this selection' />
                        )}
                    </MotionCard>
                </Col>

                {!visibleDemographics.length && (
                    <Col xs={24}>
                        <MotionCard>
                            <Empty description='Select at least one chart to show' />
                        </MotionCard>
                    </Col>
                )}

                {visibleDemographics.map(option => (
                    <Col
                        xs={24}
                        xl={visibleDemographics.length === 1 ? 24 : 12}
                        key={option.value}
                    >
                        <MotionCard
                            title={getDemographicTitle(option.value)}
                            style={{ height: '100%' }}
                        >
                            {renderDemographic(option.value)}
                        </MotionCard>
                    </Col>
                ))}
            </Row>

            <Modal
                title={`Reach Analysis — ${analysisScopeLabel}`}
                open={whatToDoOpen}
                onCancel={() => setWhatToDoOpen(false)}
                width={940}
                footer={
                    <Button
                        type='primary'
                        onClick={() => setWhatToDoOpen(false)}
                    >
                        Close
                    </Button>
                }
            >
                <Row gutter={[24, 20]}>
                    <Col xs={24} lg={12}>
                        <Title level={5}>What is happening</Title>

                        <ul
                            style={{
                                marginTop: 12,
                                marginBottom: 0,
                                paddingLeft: 20
                            }}
                        >
                            {interpretation.observations.map(observation => (
                                <li
                                    key={observation}
                                    style={{ marginBottom: 10 }}
                                >
                                    {observation}
                                </li>
                            ))}
                        </ul>
                    </Col>

                    <Col xs={24} lg={12}>
                        <Title level={5}>What to do next</Title>

                        <ol
                            style={{
                                marginTop: 12,
                                marginBottom: 0,
                                paddingLeft: 20
                            }}
                        >
                            {interpretation.actions.map(action => (
                                <li key={action} style={{ marginBottom: 10 }}>
                                    {action}
                                </li>
                            ))}
                        </ol>
                    </Col>
                </Row>
            </Modal>

            <style>{`
                .reach-demographic-checkboxes::-webkit-scrollbar {
                    display: none;
                }
            `}</style>
        </>
    )
}

export default React.memo(ReachAnalytics)
