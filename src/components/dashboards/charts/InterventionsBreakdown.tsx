
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Card,
    Empty,
    Grid,
    List,
    Skeleton,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography,
    DatePicker,
    Modal,
    Progress,
    theme
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import dayjs, { type Dayjs } from 'dayjs'
import {
    collection,
    getDocs,
    query,
    where,
    type DocumentData,
    type QueryConstraint
} from 'firebase/firestore'
import { db } from '@/firebase'
import { ShopOutlined, UserOutlined } from '@ant-design/icons'
import { AnimatePresence, motion } from 'framer-motion'

const { Text } = Typography
const { useBreakpoint } = Grid

type Props = {
    departmentName: string
    matchesDepartment?: (entry: Record<string, any>) => boolean
    programId?: string
    pageSize?: number

    /** Card heading. */
    title?: string

    /**
     * 'all' shows every workflow bucket. 'open' drops Completed and Cancelled,
     * which a dashboard's metrics row already reports — leaving only the buckets
     * that need someone to act.
     */
    bucketScope?: 'all' | 'open'

    /**
     * 'inline' keeps the record table under the chart. 'modal' moves it behind a
     * click on a bar, which keeps the card short enough to sit beside other
     * panels.
     *
     * Defaults preserve the original layout, so the dashboards that have not
     * been migrated are unaffected.
     */
    tableMode?: 'inline' | 'modal'

    /**
     * Reporting window supplied by the page.
     *
     * When present the card is controlled: it uses this window and hides its own
     * picker, because a page-level filter and a card-level one showing different
     * periods side by side is worse than either alone. Omit it and the card keeps
     * its own picker, which is how the un-migrated dashboards still use it.
     */
    dateRange?: [Dayjs, Dayjs] | null
}

type Acceptance = 'pending' | 'accepted' | 'declined'
type Completion = 'pending' | 'done' | 'confirmed' | 'rejected'
type InterventionCohort = 'carried' | 'current'

type ProgressShape = {
    percentage?: number
    hoursLogged?: number
    sessionsLogged?: number
    documentsUploaded?: any[]
    updates?: any[]
}

type Row = {
    id: string

    beneficiaryName?: string
    participantName?: string
    businessName?: string
    companyName?: string
    participantId?: string

    assigneeName?: string
    assigneeEmail?: string


    interventionTitle?: string
    title?: string
    subInterventionTitle?: string
    subInterventionName?: string
    subIntervention?: string

    status?: string
    completionStatus?: string

    assigneeAcceptanceStatus?: string
    participantAcceptanceStatus?: string
    assigneeCompletionStatus?: string
    participantCompletionStatus?: string
    beneficiaryCompletionStatus?: string

    progress?: number | ProgressShape
    computedProgress?: number

    dueDate?: any
    assignedAt?: any
    createdAt?: any
    updatedAt?: any
    startDate?: any

    areaOfSupport?: string
    departmentName?: string
    programId?: string

    groupId?: string
    groupKey?: string
    groupAssignmentId?: string

    snapshot?: {
        beneficiaryName?: string
        assigneeName?: string
        interventionTitle?: string
        departmentName?: string
        selectedSubIntervention?: {
            subId?: string
            title?: string
        } | null
    }
}

type WorkflowState = {
    bucket: string
    waitingOn: string
    description: string
    tagColor: string
    chartColor: string
    rank: number
}

const norm = (v: any) => String(v ?? '').trim().toLowerCase()

const toTitle = (s: string) =>
    String(s || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim()

const asDay = (v: any) => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return dayjs(v.toDate())
    if (v?.seconds) return dayjs(v.seconds * 1000)
    return dayjs(v)
}

const formatDate = (value: any) => {
    const d = asDay(value)
    return d && d.isValid() ? d.format('YYYY-MM-DD') : '—'
}

const clampPercent = (value: any) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return 0
    return Math.max(0, Math.min(100, Math.round(num)))
}

const getProgressPercent = (r: Row) => {
    const computed = Number(r.computedProgress)
    if (Number.isFinite(computed)) return clampPercent(computed)

    if (typeof r.progress === 'number') return clampPercent(r.progress)

    const progressPercentage = Number((r.progress as ProgressShape | undefined)?.percentage)
    if (Number.isFinite(progressPercentage)) return clampPercent(progressPercentage)

    return 0
}

const getBeneficiaryName = (r: Row) =>
    r.beneficiaryName ||
    r.participantName ||
    r.businessName ||
    r.companyName ||
    r.snapshot?.beneficiaryName ||
    r.participantId ||
    '—'

const getFacilitatorName = (r: Row) =>
    r.assigneeName ||
    r.assigneeName ||
    r.snapshot?.assigneeName ||
    r.assigneeEmail ||
    r.assigneeEmail ||
    '—'

const getInterventionTitle = (r: Row) =>
    r.interventionTitle ||
    r.title ||
    r.snapshot?.interventionTitle ||
    '—'

const getSubInterventionTitle = (r: Row) =>
    r.subInterventionTitle ||
    r.subInterventionName ||
    r.subIntervention ||
    r.snapshot?.selectedSubIntervention?.title ||
    ''

const getAssignedAt = (r: Row) => r.assignedAt || r.createdAt || r.startDate || null

type DateRangeValue = [Dayjs, Dayjs] | null

/**
 * Quick ranges for the period picker.
 *
 * Built per call rather than as a module constant so a dashboard left open
 * overnight does not keep resolving "This Month" against the day it mounted.
 * The quarter bounds are derived by hand because dayjs' quarter helpers need
 * the quarterOfYear plugin, which this app does not register — startOf('quarter')
 * fails silently without it rather than throwing.
 */
// Returns non-null tuples: Ant Design's `presets` cannot express "no range".
const buildRangePresets = (): { label: string; value: [Dayjs, Dayjs] }[] => {
    const now = dayjs()
    const quarterStartMonth = Math.floor(now.month() / 3) * 3

    return [
        { label: 'This Month', value: [now.startOf('month'), now.endOf('month')] },
        {
            label: 'Last Month',
            value: [
                now.subtract(1, 'month').startOf('month'),
                now.subtract(1, 'month').endOf('month')
            ]
        },
        { label: 'Last 30 Days', value: [now.subtract(29, 'day').startOf('day'), now.endOf('day')] },
        {
            label: 'This Quarter',
            value: [
                now.month(quarterStartMonth).startOf('month'),
                now.month(quarterStartMonth + 2).endOf('month')
            ]
        },
        { label: 'Year to Date', value: [now.startOf('year'), now.endOf('day')] }
    ]
}

const getGroupKey = (r: Row) => {
    const clean = String(r.groupAssignmentId || r.groupId || r.groupKey || '').trim()
    return clean || null
}

const getSmeAcceptance = (r: Row): Acceptance => {
    const value = norm(r.participantAcceptanceStatus || r.participantAcceptanceStatus)

    if (value === 'accepted' || value === 'confirmed') return 'accepted'
    if (value === 'declined' || value === 'rejected') return 'declined'

    return 'pending'
}

const getFacilitatorAcceptance = (r: Row): Acceptance => {
    const value = norm(r.assigneeAcceptanceStatus || r.assigneeAcceptanceStatus)

    if (value === 'accepted' || value === 'confirmed') return 'accepted'
    if (value === 'declined' || value === 'rejected') return 'declined'

    return 'pending'
}

const getFacilitatorCompletion = (r: Row): Completion => {
    const direct = norm(r.assigneeCompletionStatus || r.assigneeCompletionStatus)
    const completionStatus = norm(r.completionStatus)

    if (direct === 'done' || direct === 'completed' || direct === 'confirmed') return 'done'
    if (direct === 'rejected') return 'rejected'

    if (
        completionStatus === 'submitted' ||
        completionStatus === 'done' ||
        completionStatus === 'completed' ||
        completionStatus === 'confirmed'
    ) {
        return 'done'
    }

    return 'pending'
}

const getSmeCompletion = (r: Row): Completion => {
    const direct = norm(r.participantCompletionStatus || r.beneficiaryCompletionStatus)
    const completionStatus = norm(r.completionStatus)

    if (direct === 'confirmed' || direct === 'accepted') return 'confirmed'
    if (direct === 'done' || direct === 'completed') return 'done'
    if (direct === 'rejected' || direct === 'declined') return 'rejected'

    if (completionStatus === 'confirmed' || completionStatus === 'completed') return 'confirmed'
    if (completionStatus === 'rejected') return 'rejected'

    return 'pending'
}

const isFullyCompleted = (r: Row) => {
    const fac = getFacilitatorCompletion(r)
    const sme = getSmeCompletion(r)

    return fac === 'done' && (sme === 'confirmed' || sme === 'done')
}

const isCompletedLegacy = (r: Row) => {
    const status = norm(r.status)
    const completionStatus = norm(r.completionStatus)
    const participantCompletionStatus = norm(r.participantCompletionStatus || r.beneficiaryCompletionStatus)

    return (
        status === 'completed' ||
        completionStatus === 'confirmed' ||
        completionStatus === 'completed' ||
        participantCompletionStatus === 'confirmed' ||
        participantCompletionStatus === 'done' ||
        participantCompletionStatus === 'completed'
    )
}

const isCancelled = (r: Row) => {
    const status = norm(r.status)
    return status === 'cancelled' || status === 'canceled'
}

/** Is this record open — i.e. still needs someone to do something? */
const isOpenRecord = (r: Row) =>
    !isCancelled(r) && !isFullyCompleted(r) && !isCompletedLegacy(r)

const getWorkflowState = (r: Row): WorkflowState => {
    const rawStatus = norm(r.status)
    const facAcc = getFacilitatorAcceptance(r)
    const smeAcc = getSmeAcceptance(r)
    const facDone = getFacilitatorCompletion(r)
    const smeDone = getSmeCompletion(r)

    if (isCancelled(r)) {
        return {
            bucket: 'Cancelled',
            waitingOn: 'No Action',
            description: 'This assigned intervention was cancelled.',
            tagColor: 'volcano',
            chartColor: '#f5222d',
            rank: 90
        }
    }

    if (isFullyCompleted(r) || isCompletedLegacy(r)) {
        return {
            bucket: 'Completed',
            waitingOn: 'No Action',
            description: 'Facilitator delivery and SME confirmation are complete.',
            tagColor: 'green',
            chartColor: '#52c41a',
            rank: 80
        }
    }

    if (facAcc === 'declined') {
        return {
            bucket: 'Facilitator Declined',
            waitingOn: 'Reassignment',
            description: 'The facilitator declined this intervention. It needs reassignment or administrator action.',
            tagColor: 'red',
            chartColor: '#ff4d4f',
            rank: 15
        }
    }

    if (facDone === 'rejected') {
        return {
            bucket: 'Delivery Rejected',
            waitingOn: 'Facilitator Correction',
            description: 'The facilitator delivery update was rejected and needs correction.',
            tagColor: 'red',
            chartColor: '#cf1322',
            rank: 55
        }
    }

    if (smeDone === 'rejected') {
        return {
            bucket: 'SME Rejected Completion',
            waitingOn: 'Facilitator Correction',
            description: 'The SME rejected the completion confirmation. The facilitator must correct or update the delivery.',
            tagColor: 'red',
            chartColor: '#d4380d',
            rank: 60
        }
    }

    if (smeAcc === 'declined') {
        return {
            bucket: 'SME Declined',
            waitingOn: 'SME Follow-up',
            description: 'The SME declined the intervention.',
            tagColor: 'red',
            chartColor: '#ff7875',
            rank: 25
        }
    }

    if (smeAcc === 'pending') {
        return {
            bucket: 'Awaiting SME Acceptance',
            waitingOn: 'SME Acceptance',
            description: 'The SME has not accepted the intervention yet.',
            tagColor: 'orange',
            chartColor: '#fa8c16',
            rank: 20
        }
    }

    if (facDone === 'pending') {
        return {
            bucket: 'In Delivery',
            waitingOn: 'Facilitator Delivery',
            description: 'The facilitator must deliver or update progress.',
            tagColor: 'geekblue',
            chartColor: '#2f54eb',
            rank: 40
        }
    }

    if (facDone === 'done' && smeDone === 'pending') {
        return {
            bucket: 'Awaiting SME Confirmation',
            waitingOn: 'SME Completion Confirm',
            description: 'The facilitator marked delivery as done. The SME must confirm completion.',
            tagColor: 'purple',
            chartColor: '#722ed1',
            rank: 50
        }
    }

    return {
        bucket: toTitle(rawStatus || 'Active'),
        waitingOn: 'Review',
        description: 'This intervention has a status that does not match the standard workflow rules.',
        tagColor: 'blue',
        chartColor: '#1677ff',
        rank: 70
    }
}

const bucketStatus = (r: Row) => getWorkflowState(r).bucket

const isOverdueRecord = (r: Row) => {
    if (isCancelled(r) || isFullyCompleted(r) || isCompletedLegacy(r)) return false

    const due = asDay(r.dueDate)
    if (!due || !due.isValid()) return false

    return due.isBefore(dayjs(), 'day')
}

const renderWorkflowTag = (record: Row) => {
    const state = getWorkflowState(record)

    return (
        <Tooltip title={state.description}>
            <Tag color={state.tagColor}>{state.bucket}</Tag>
        </Tooltip>
    )
}

const renderWaitingOn = (record: Row) => {
    const state = getWorkflowState(record)

    if (state.waitingOn === 'No Action') {
        return <Text type="secondary">—</Text>
    }

    return (
        <Tooltip title={state.description}>
            <Tag color={state.tagColor}>{state.waitingOn}</Tag>
        </Tooltip>
    )
}

const DepartmentInterventionsStatus: React.FC<Props> = ({
    departmentName,
    matchesDepartment,
    programId,
    pageSize = 4,
    title = 'Interventions by Status',
    bucketScope = 'all',
    tableMode = 'inline',
    dateRange: controlledDateRange
}) => {
    const { token } = theme.useToken()
    const isControlledRange = controlledDateRange !== undefined
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState<Row[]>([])
    const [activeBucket, setActiveBucket] = useState<string | null>(null)
    const [activeCohort, setActiveCohort] = useState<InterventionCohort | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Defaults to the current month. Showing every intervention ever assigned
    // made this a register rather than a dashboard panel.
    const [ownDateRange, setOwnDateRange] = useState<DateRangeValue>(() => [
        dayjs().startOf('month'),
        dayjs().endOf('month')
    ])

    const dateRange = isControlledRange ? controlledDateRange ?? null : ownDateRange
    const setDateRange = setOwnDateRange

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const clauses: QueryConstraint[] = []

            if (departmentName && !matchesDepartment) {
                clauses.push(where('areaOfSupport', '==', departmentName))
            }

            if (programId) {
                clauses.push(where('programId', '==', programId))
            }

            const snap = await getDocs(
                query(collection(db, 'assignedInterventions'), ...clauses)
            )

            const list: Row[] = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as DocumentData)
            }))

            setRows(matchesDepartment ? list.filter(matchesDepartment) : list)
        } catch (e: any) {
            console.error('Failed to load department intervention status:', e)
            setRows([])
            setError(e?.message || 'Failed to load interventions')
        } finally {
            setLoading(false)
        }
    }, [departmentName, programId, matchesDepartment])

    useEffect(() => {
        setActiveBucket(null)
        setActiveCohort(null)
        void load()
    }, [load])

    /** Records assigned inside the selected period. */
    const inPeriodRows = useMemo(() => {
        if (!dateRange) return rows

        const [from, to] = dateRange
        const start = from.startOf('day')
        const end = to.endOf('day')

        return rows.filter(r => {
            const assigned = asDay(getAssignedAt(r))
            // A record with no usable assigned date is kept rather than dropped:
            // silently hiding work because a timestamp is missing is worse than
            // showing it in the wrong period.
            if (!assigned || !assigned.isValid()) return true
            return !assigned.isBefore(start) && !assigned.isAfter(end)
        })
    }, [rows, dateRange])

    /** Still-open work assigned before the period: the carried-over backlog. */
    const olderOpenRows = useMemo(() => {
        if (!dateRange) return []

        const start = dateRange[0].startOf('day')
        const inPeriod = new Set(inPeriodRows.map(r => r.id))

        return rows.filter(r => {
            if (inPeriod.has(r.id)) return false
            if (!isOpenRecord(r)) return false

            const assigned = asDay(getAssignedAt(r))
            return Boolean(assigned?.isValid() && assigned.isBefore(start))
        })
    }, [rows, inPeriodRows, dateRange])

    const currentOpenRows = useMemo(
        () => inPeriodRows.filter(isOpenRecord),
        [inPeriodRows]
    )

    /**
     * What the chart and drill-down actually cover.
     *
     * In 'open' scope the terminal buckets are dropped, so this card stops
     * re-reporting the Completed and Assigned totals that sit in the metrics row
     * directly above it and shows only work that is still waiting on someone.
     */
    const chartRows = useMemo(
        () =>
            bucketScope === 'open'
                ? [...currentOpenRows, ...olderOpenRows]
                : inPeriodRows,
        [bucketScope, currentOpenRows, inPeriodRows, olderOpenRows]
    )

    const currentOpenIds = useMemo(
        () => new Set(currentOpenRows.map(row => row.id)),
        [currentOpenRows]
    )
    const carriedOpenIds = useMemo(
        () => new Set(olderOpenRows.map(row => row.id)),
        [olderOpenRows]
    )

    const buckets = useMemo(() => {
        const m = new Map<string, { count: number; state: WorkflowState }>()

        chartRows.forEach(r => {
            const state = getWorkflowState(r)
            const current = m.get(state.bucket)

            m.set(state.bucket, {
                count: (current?.count || 0) + 1,
                state
            })
        })

        return Array.from(m.entries())
            .map(([name, entry]) => ({
                name,
                y: entry.count,
                color: entry.state.chartColor,
                rank: entry.state.rank,
                tagColor: entry.state.tagColor,
                description: entry.state.description
            }))
            .filter(p => p.y > 0)
            .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    }, [chartRows])

    const filteredRows = useMemo(() => {
        let base = activeBucket
            ? chartRows.filter(r => bucketStatus(r) === activeBucket)
            : chartRows

        if (activeCohort === 'current') {
            base = base.filter(row => currentOpenIds.has(row.id))
        } else if (activeCohort === 'carried') {
            base = base.filter(row => carriedOpenIds.has(row.id))
        }

        return [...base].sort((a, b) => {
            const stateA = getWorkflowState(a)
            const stateB = getWorkflowState(b)

            if (stateA.rank !== stateB.rank) return stateA.rank - stateB.rank

            const dueA = asDay(a.dueDate)
            const dueB = asDay(b.dueDate)

            const dueATime = dueA?.isValid() ? dueA.valueOf() : Number.MAX_SAFE_INTEGER
            const dueBTime = dueB?.isValid() ? dueB.valueOf() : Number.MAX_SAFE_INTEGER

            return dueATime - dueBTime
        })
    }, [activeBucket, activeCohort, carriedOpenIds, chartRows, currentOpenIds])

    const tableKey = useMemo(
        () => `${activeBucket || 'all'}:${activeCohort || 'all'}:${filteredRows.map(r => r.id).join(',')}`,
        [activeBucket, activeCohort, filteredRows]
    )

    /*
      Ordered by workflow rank, not by size.

      A donut was the wrong shape for this data. It answers "what fraction of the
      whole is each bucket", but the question this card exists to answer is
      "where is work stuck" — and for that:

        - there are up to ten buckets, well past the four or five a donut stays
          readable at, and the labels ("Awaiting SME Confirmation") collide
        - a circle discards the rank the buckets already carry, which is the
          actual workflow order
        - Completed is usually the largest slice and the least actionable, so it
          crowded out the small stuck buckets that need attention

      Horizontal bars in rank order read as a pipeline, keep long labels legible
      on the axis, and make similar counts directly comparable.
    */
    const barData = useMemo(
        () =>
            buckets.map(p => ({
                name: p.name,
                y: p.y,
                color: p.color,
                custom: { displayValue: p.y },
                // Dim the rest rather than moving anything, so bar positions stay
                // stable while filtering.
                opacity: !activeBucket || activeBucket === p.name ? 1 : 0.28,
                borderColor: activeBucket === p.name ? p.color : 'transparent',
                borderWidth: activeBucket === p.name ? 2 : 0
            })),
        [buckets, activeBucket]
    )

    const cohortBarData = useMemo(() => {
        const countByBucket = (source: Row[]) => {
            const counts = new Map<string, number>()
            source.forEach(row => {
                const bucket = bucketStatus(row)
                counts.set(bucket, (counts.get(bucket) || 0) + 1)
            })
            return counts
        }

        const currentCounts = countByBucket(currentOpenRows)
        const carriedCounts = countByBucket(olderOpenRows)

        const current = buckets.map(bucket => {
            const count = currentCounts.get(bucket.name) || 0
            const selected = activeBucket === bucket.name && activeCohort === 'current'
            return {
                name: bucket.name,
                y: count,
                color: '#1677ff',
                custom: { cohort: 'current' as const, displayValue: count },
                opacity: !activeBucket || selected ? 1 : 0.24
            }
        })

        const carried = buckets.map(bucket => {
            const count = carriedCounts.get(bucket.name) || 0
            const selected = activeBucket === bucket.name && activeCohort === 'carried'
            return {
                name: bucket.name,
                y: -count,
                color: '#fa8c16',
                custom: { cohort: 'carried' as const, displayValue: count },
                opacity: !activeBucket || selected ? 1 : 0.24
            }
        })

        return {
            current,
            carried,
            hasCarriedOver: carried.some(point => point.custom.displayValue > 0),
            currentTotal: currentOpenRows.length,
            carriedTotal: olderOpenRows.length
        }
    }, [activeBucket, activeCohort, buckets, currentOpenRows, olderOpenRows])

    const chartSeries = useMemo<Highcharts.SeriesOptionsType[]>(() => {
        if (bucketScope !== 'open') {
            return [{ type: 'bar', name: 'Interventions', data: barData }]
        }

        const series: Highcharts.SeriesOptionsType[] = []
        if (cohortBarData.hasCarriedOver) {
            series.push({
                type: 'bar',
                name: `Carried over (${cohortBarData.carriedTotal})`,
                color: '#fa8c16',
                data: cohortBarData.carried
            })
        }
        series.push({
            type: 'bar',
            name: dateRange
                ? `Current period (${cohortBarData.currentTotal})`
                : `Open interventions (${cohortBarData.currentTotal})`,
            color: '#1677ff',
            data: cohortBarData.current
        })
        return series
    }, [barData, bucketScope, cohortBarData, dateRange])

    const cohortAxisMax = useMemo(
        () =>
            Math.max(
                1,
                ...cohortBarData.current.map(point => point.custom.displayValue),
                ...cohortBarData.carried.map(point => point.custom.displayValue)
            ),
        [cohortBarData]
    )

    const options: Highcharts.Options = useMemo(
        () => ({
            chart: {
                type: 'bar',
                backgroundColor: 'transparent',
                height: Math.max(190, buckets.length * (isMobile ? 28 : 30) + 70),
                spacingLeft: 0,
                spacingRight: 0
            },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            // Colours come from lib/highchartsTheme.ts, which follows the app's
            // colour mode. The previous options hardcoded #000 for labels and
            // legend, which is unreadable on a dark panel.
            xAxis: {
                categories: buckets.map(b => b.name),
                lineWidth: 0,
                tickLength: 0,
                labels: { style: { fontSize: isMobile ? '11px' : '12px' } }
            },
            yAxis: {
                title: { text: undefined },
                allowDecimals: false,
                min:
                    bucketScope === 'open' && cohortBarData.hasCarriedOver
                        ? -cohortAxisMax
                        : 0,
                max:
                    bucketScope === 'open' && cohortBarData.hasCarriedOver
                        ? cohortAxisMax
                        : undefined,
                gridLineWidth: 1,
                labels: {
                    enabled: !isMobile,
                    formatter: function () {
                        return String(Math.abs(Number(this.value)))
                    }
                },
                plotLines:
                    bucketScope === 'open' && cohortBarData.hasCarriedOver
                        ? [{ value: 0, width: 1, color: '#bfbfbf', zIndex: 3 }]
                        : undefined
            },
            tooltip: {
                headerFormat: '',
                pointFormat:
                    '<b>{point.name}</b><br/>{series.name}: {point.custom.displayValue} intervention(s)'
            },
            plotOptions: {
                bar: {
                    borderRadius: 6,
                    pointWidth: isMobile ? 10 : 12,
                    grouping: false,
                    colorByPoint: bucketScope !== 'open',
                    pointPadding: 0.22,
                    groupPadding: 0.18,
                    cursor: 'pointer',
                    animation: { duration: 250 },
                    dataLabels: {
                        enabled: true,
                        formatter: function () {
                            const value = Math.abs(Number(this.y || 0))
                            return value > 0 ? String(value) : ''
                        },
                        style: {
                            textOutline: 'none',
                            fontWeight: '600',
                            fontSize: isMobile ? '11px' : '12px'
                        }
                    },
                    point: {
                        events: {
                            click: function () {
                                const name = String((this as Highcharts.Point).name || '')
                                const cohort = (this.options as any)?.custom?.cohort as
                                    | InterventionCohort
                                    | undefined
                                setActiveBucket(name)
                                setActiveCohort(cohort || null)
                            }
                        }
                    }
                }
            },
            legend: {
                enabled: bucketScope === 'open',
                align: 'center',
                verticalAlign: 'top',
                symbolRadius: 6,
                itemStyle: { fontSize: isMobile ? '11px' : '12px' }
            },
            series: chartSeries
        }),
        [
            bucketScope,
            buckets,
            chartSeries,
            cohortAxisMax,
            cohortBarData.hasCarriedOver,
            isMobile
        ]
    )

    const renderPeopleIdentity = (record: Row) => {
        const identityIconStyle: React.CSSProperties = {
            width: 28,
            height: 28,
            flex: '0 0 28px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8
        }

        return (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span
                        style={{
                            ...identityIconStyle,
                            color: token.colorPrimary,
                            background: token.colorPrimaryBg
                        }}
                    >
                        <ShopOutlined />
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                            Beneficiary
                        </Text>
                        <Text strong>{getBeneficiaryName(record)}</Text>
                        {getGroupKey(record) ? (
                            <Tag color="purple" style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>
                                Grouped
                            </Tag>
                        ) : null}
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span
                        style={{
                            ...identityIconStyle,
                            color: token.colorSuccess,
                            background: token.colorSuccessBg
                        }}
                    >
                        <UserOutlined />
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                            Facilitator
                        </Text>
                        <Text>{getFacilitatorName(record)}</Text>
                    </div>
                </div>
            </Space>
        )
    }

    const renderWorkflowProgress = (record: Row) => {
        const percent = getProgressPercent(record)

        return (
            <Space direction="vertical" size={7} style={{ width: '100%' }}>
                {renderWorkflowTag(record)}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <Progress
                        percent={percent}
                        showInfo={false}
                        size="small"
                        strokeColor={percent >= 100 ? token.colorSuccess : token.colorPrimary}
                        trailColor={token.colorFillSecondary}
                        style={{ flex: 1, minWidth: 64, margin: 0 }}
                    />
                    <Text strong style={{ minWidth: 38, textAlign: 'right', fontSize: 12 }}>
                        {percent}%
                    </Text>
                </div>
            </Space>
        )
    }

    const columns: ColumnsType<Row> = [
        {
            title: 'Beneficiary & facilitator',
            key: 'people',
            width: 280,
            render: (_: any, r: Row) => renderPeopleIdentity(r)
        },
        {
            title: 'Intervention',
            key: 'intervention',
            render: (_: any, r: Row) => (
                <Space direction="vertical" size={2}>
                    <Text>{getInterventionTitle(r)}</Text>
                    {getSubInterventionTitle(r) ? (
                        <Tag color="purple">{getSubInterventionTitle(r)}</Tag>
                    ) : null}
                </Space>
            )
        },
        {
            title: 'Workflow',
            key: 'workflow',
            width: 250,
            render: (_: any, r: Row) => renderWorkflowProgress(r)
        },
        {
            title: 'Due',
            key: 'due',
            width: 130,
            render: (_: any, r: Row) => {
                const overdue = isOverdueRecord(r)

                return (
                    <Text strong={overdue} style={{ color: overdue ? token.colorError : undefined }}>
                        {formatDate(r.dueDate)}
                    </Text>
                )
            }
        }
    ]

    const renderMobileCard = (record: Row) => {
        const overdue = isOverdueRecord(record)
        const state = getWorkflowState(record)

        return (
            <Card
                key={record.id}
                size="small"
                style={{
                    marginBottom: 12,
                    borderRadius: 12,
                    border: '1px solid #d6e4ff'
                }}
            >
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {renderPeopleIdentity(record)}

                    <Text type="secondary">{getInterventionTitle(record)}</Text>
                    {getSubInterventionTitle(record) ? (
                        <Tag color="purple" style={{ width: 'fit-content' }}>
                            {getSubInterventionTitle(record)}
                        </Tag>
                    ) : null}

                    {renderWorkflowProgress(record)}

                    <Text type="secondary">{state.description}</Text>

                    <Space direction="vertical" size={2}>
                        <Text type="secondary">
                            Assigned: {formatDate(getAssignedAt(record))}
                        </Text>
                        <Text
                            type={overdue ? undefined : 'secondary'}
                            strong={overdue}
                            style={{ color: overdue ? token.colorError : undefined }}
                        >
                            Due: {formatDate(record.dueDate)}
                        </Text>
                    </Space>

                    <Space wrap>
                        {renderWaitingOn(record)}
                    </Space>
                </Space>
            </Card>
        )
    }

    // Shared by both table modes so the inline and modal drill-downs cannot drift.
    const activeCohortLabel =
        activeCohort === 'carried'
            ? 'Carried over'
            : activeCohort === 'current'
                ? dateRange
                    ? 'Current period'
                    : 'Open interventions'
                : null

    const recordsView = (
        <AnimatePresence mode="wait">
            <motion.div
                key={tableKey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
            >
                {isMobile ? (
                    <List
                        dataSource={filteredRows}
                        renderItem={renderMobileCard}
                        pagination={{
                            pageSize,
                            showSizeChanger: false,
                            position: 'bottom',
                            align: 'center'
                        }}
                    />
                ) : (
                    <Table
                        rowKey="id"
                        size="small"
                        dataSource={filteredRows}
                        columns={columns}
                        scroll={{ x: 1000 }}
                        pagination={{
                            pageSize: 3,
                            showSizeChanger: false,
                            position: ['bottomCenter']
                        }}
                    />
                )}
            </motion.div>
        </AnimatePresence>
    )

    return (
        <Card
            title={
                <Space direction="vertical" size={2}>
                    <Text strong>{title}</Text>
                </Space>
            }
            extra={
                <Space wrap>
                    {/* Hidden when the page controls the window — see the
                        dateRange prop. */}
                    {isControlledRange ? null : (
                        <DatePicker.RangePicker
                            value={dateRange}
                            onChange={value => {
                                setDateRange(value?.[0] && value?.[1] ? [value[0], value[1]] : null)
                                setActiveBucket(null)
                                setActiveCohort(null)
                            }}
                            presets={buildRangePresets()}
                            format="DD MMM YYYY"
                            allowClear
                            // Clearing falls back to every record, which is the
                            // old behaviour — kept as an explicit choice rather
                            // than the default.
                            placeholder={['All time', 'All time']}
                            size={isMobile ? 'small' : 'middle'}
                            style={{ width: isMobile ? 210 : 250 }}
                        />
                    )}

                </Space>
            }
            style={{
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                transition: 'all 0.3s ease',
                borderRadius: 12,
                border: '1px solid #d6e4ff'
            }}
        >
            {error ? (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Could not load assigned interventions"
                    description={error}
                />
            ) : null}

            {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {Array.from({ length: 5 }).map((_, index) => (
                            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <Skeleton.Input
                                    active
                                    size="small"
                                    style={{ width: 120 + (index % 3) * 20 }}
                                />
                                <Skeleton.Input
                                    active
                                    size="small"
                                    style={{
                                        flex: 1,
                                        height: 16,
                                        borderRadius: 999,
                                        maxWidth: `${90 - index * 12}%`
                                    }}
                                />
                            </div>
                        ))}
                    </div>

                    <Skeleton active title={false} paragraph={{ rows: 3 }} />
                </div>
            ) : chartRows.length === 0 ? (
                <Empty
                    description={
                        bucketScope === 'open'
                            ? 'No still-open interventions found.'
                            : dateRange
                                ? `No interventions assigned between ${dateRange[0].format('DD MMM YYYY')} and ${dateRange[1].format('DD MMM YYYY')}.`
                                : 'No assigned interventions found.'
                    }
                />
            ) : (
                <>
                    <HighchartsReact highcharts={Highcharts} options={options} />

                    <div style={{ height: 12 }} />

                    {tableMode === 'inline' ? (
                        <>
                            {recordsView}
                        </>
                    ) : (
                        <Text type="secondary">
                            {chartRows.length} intervention{chartRows.length === 1 ? '' : 's'}
                            {bucketScope === 'open' ? ' still open' : ''} · select a bar to see the records
                        </Text>
                    )}
                </>
            )}

            {/*
                Drill-down. In modal mode the bar click that used to filter an
                inline table opens it here instead, so the card stays short
                enough to sit beside other panels on a dashboard.
            */}
            {tableMode === 'modal' ? (
                <Modal
                    open={Boolean(activeBucket)}
                    onCancel={() => {
                        setActiveBucket(null)
                        setActiveCohort(null)
                    }}
                    title={
                        activeBucket
                            ? `${activeBucket}${activeCohortLabel ? ` · ${activeCohortLabel}` : ''}`
                            : 'Interventions'
                    }
                    width="min(1100px, 94vw)"
                    footer={null}
                    destroyOnClose
                    centered
                >
                    {recordsView}
                </Modal>
            ) : null}
        </Card>
    )
}

export default DepartmentInterventionsStatus
