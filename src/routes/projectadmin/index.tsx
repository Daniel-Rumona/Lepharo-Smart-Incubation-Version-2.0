import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Table,
    Tag,
    Button,
    Space,
    message,
    DatePicker,
    Segmented,
    Empty,
    Typography,
    Modal
} from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import isoWeek from 'dayjs/plugin/isoWeek'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import {
    ArrowRightOutlined,
    FileDoneOutlined,
    SolutionOutlined,
    TeamOutlined,
    PercentageOutlined
} from '@ant-design/icons'
import {
    getDocs,
    collection,
    query,
    where,
    QueryConstraint
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useNavigate } from 'react-router-dom'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useDashboardDateRange } from '@/lib/useDashboardDateRange'
import ProjectAdminProgramPulse from '@/components/dashboards/projectadmin/ProjectAdminProgramPulse'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

dayjs.extend(isBetween)
dayjs.extend(isoWeek)
dayjs.extend(quarterOfYear)

const { RangePicker } = DatePicker
const { Text } = Typography

type MovStatusName = 'Confirmed' | 'Pending'

type DeltaDirection = 'up' | 'down' | 'flat'

type MetricDelta = {
    value: number
    percent: number
    direction: DeltaDirection
    label: string
}

const getDateRangeLengthInDays = (range: [Dayjs, Dayjs] | null) => {
    if (!range) return 0
    return Math.max(1, range[1].diff(range[0], 'day') + 1)
}

const getPreviousRange = (range: [Dayjs, Dayjs] | null): [Dayjs, Dayjs] | null => {
    if (!range) return null

    const [start, end] = range
    const days = getDateRangeLengthInDays(range)

    const previousEnd = start.subtract(1, 'day').endOf('day')
    const previousStart = previousEnd.subtract(days - 1, 'day').startOf('day')

    return [previousStart, previousEnd]
}

const isOnOrBefore = (date: Dayjs, end: Dayjs) => {
    return date.isValid() && (date.isBefore(end, 'day') || date.isSame(end, 'day'))
}

const isWithinRange = (date: Dayjs, range: [Dayjs, Dayjs] | null) => {
    if (!range) return true
    return date.isValid() && date.isBetween(range[0], range[1], 'day', '[]')
}

const getParticipantAcceptedDate = (row: any): Dayjs => {
    const candidates = [
        row?.acceptedAt,
        row?.applicationAcceptedAt,
        row?.approvedAt,
        row?.updatedAt,
        row?.createdAt
    ]

    for (const candidate of candidates) {
        const parsed = toDayjs(candidate)
        if (parsed.isValid()) return parsed
    }

    return dayjs('')
}

const roundNumber = (value: number, decimals = 1) => {
    if (!Number.isFinite(value)) return 0
    return Number(value.toFixed(decimals))
}

const buildDelta = (
    currentValue: number,
    previousValue: number,
    label = 'vs previous period',
    decimals = 1
): MetricDelta => {
    const rawValue = currentValue - previousValue
    const value = roundNumber(rawValue, decimals)

    const rawPercent =
        previousValue > 0
            ? (rawValue / previousValue) * 100
            : currentValue > 0
                ? 100
                : 0

    const percent = roundNumber(rawPercent, decimals)

    return {
        value,
        percent,
        direction: value > 0 ? 'up' : value < 0 ? 'down' : 'flat',
        label
    }
}

const formatDeltaNumber = (value: number, decimals = 1) => {
    if (!Number.isFinite(value)) return '0'

    return value % 1 === 0
        ? value.toFixed(0)
        : value.toFixed(decimals)
}

const renderDelta = (delta: MetricDelta) => {
    const color =
        delta.direction === 'up'
            ? '#52c41a'
            : delta.direction === 'down'
                ? '#ff4d4f'
                : 'rgba(0,0,0,.45)'

    const valueSign = delta.value > 0 ? '+' : ''
    const percentSign = delta.percent > 0 ? '+' : ''

    return (
        <span style={{ color, fontWeight: 600 }}>
            {valueSign}
            {formatDeltaNumber(delta.value)} ({percentSign}
            {formatDeltaNumber(delta.percent)}%) {delta.label}
        </span>
    )
}

const toDayjs = (val: any): Dayjs => {
    if (!val) return dayjs('')
    if (dayjs.isDayjs(val)) return val
    if (val?.toDate) return dayjs(val.toDate())
    if (val?.seconds) return dayjs(val.seconds * 1000)
    return dayjs(val)
}

const getAnyDate = (row: any): Dayjs => {
    const candidates = [
        row?.completedAt,
        row?.submissionDate,
        row?.submittedAt,
        row?.updatedAt,
        row?.createdAt,
        row?.dueDate,
        row?.interventionDate,
        row?.date
    ]

    for (const candidate of candidates) {
        const parsed = toDayjs(candidate)
        if (parsed.isValid()) return parsed
    }

    return dayjs('')
}

const getParticipantKey = (row: any): string | null => {
    return (
        row?.participantId ||
        row?.beneficiaryId ||
        row?.applicationId ||
        row?.smeId ||
        row?.clientId ||
        row?.beneficiaryName ||
        row?.companyName ||
        row?.email ||
        null
    )
}

const CenterCoordinatorDashboard: React.FC = () => {
    const {
        user,
        loading: identityLoading
    } = useFullIdentity()
    const { programId, activeProgramId, isAllPrograms } = useActiveProgramId()
    const navigate = useNavigate()

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'center-coordinator-dashboard',
            pageTitle: 'Center Coordinator Dashboard',
            guides: [
                {
                    id: 'center-coordinator-overview',
                    title: 'Quick tour',
                    description:
                        'Understand the reporting period, programme indicators, upcoming appointments and performance metrics available on the dashboard.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('cc-dashboard-header'),
                            popover: {
                                title: 'Dashboard reporting period',
                                description:
                                    'This dashboard shows the current month by default. Use the reporting period filter in the top bar to switch to today, this week, a quarter, year to date or a custom range.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('cc-dashboard-metrics'),
                            popover: {
                                title: 'Programme summary',
                                description:
                                    'These cards summarise participants, MOV submissions, inquiries and participation for the selected reporting period, including comparison with the previous period.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('cc-upcoming-appointments'),
                            popover: {
                                title: 'Upcoming appointments',
                                description:
                                    'Review the programme appointments that are coming up and need coordinator awareness.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('cc-project-metrics'),
                            popover: {
                                title: 'Metrics',
                                description:
                                    'This section combines programme revenue movement and employment indicators for the selected reporting period.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'center-coordinator-metrics',
                    title: 'Metrics',
                    description:
                        'Understand programme revenue, SME movement and employment indicators for the selected reporting period.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: guideTarget('project-metrics-overview'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Metrics',
                                description:
                                    'The metrics section brings together monthly finance reporting and job-contract activity for SMEs in the current programme scope.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('project-metrics-revenue'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Reported revenue',
                                description:
                                    'See combined SME revenue for the selected complete reporting months and how it changed against the previous comparable period.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('project-metrics-revenue-chart'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Monthly revenue comparison',
                                description:
                                    'The compact chart compares monthly programme revenue from the previous period with the selected period. It appears when monthly revenue data is available.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('project-metrics-sme-movement'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'SME movement',
                                description:
                                    'This shows how many comparable SMEs increased, maintained or decreased their reported revenue between the two periods.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('project-metrics-jobs'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Jobs',
                                description:
                                    'Review unique jobs active during the period, the permanent and temporary split, movement from the previous period, and how many jobs remained active at month-end.',
                                side: 'left',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'center-coordinator-movs',
                    title: 'Review MOV submissions',
                    description:
                        'Open the MOV summary and review confirmed or pending consolidated submissions.',
                    kind: 'task',
                    order: 3,
                    steps: [
                        {
                            element: guideTarget('cc-total-movs-metric'),
                            waitForElement: 1500,
                            advanceOnClick: true,
                            popover: {
                                title: 'Total MOVs',
                                description:
                                    'Select the Total MOVs metric to open the recent consolidated MOV submissions for the current reporting period.',
                                side: 'bottom',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-cc-movs-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Recent MOV submissions',
                                description:
                                    'Review the total, confirmed and pending MOV counts and filter the submission list by confirmation status.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('cc-mov-status-filter'),
                            waitForElement: 1500,
                            popover: {
                                title: 'MOV status',
                                description:
                                    'Switch between all, confirmed and pending consolidated MOV submissions.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('cc-mov-table'),
                            waitForElement: 1500,
                            popover: {
                                title: 'MOV submissions',
                                description:
                                    'Review the department, submission date and current confirmation status for each consolidated MOV.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('cc-view-all-movs'),
                            waitForElement: 1500,
                            popover: {
                                title: 'Open MOV workspace',
                                description:
                                    'Continue to the full MOV approvals workspace when you need to review or process all submissions.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    const [inquiries, setInquiries] = useState<any[]>([])
    const [interventions, setInterventions] = useState<any[]>([])
    const [consolidatedMovs, setConsolidatedMovs] = useState<any[]>([])
    const [participants, setParticipants] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    /*
      The reporting window comes from the topbar filter rather than a control on
      this page. It defaults to the current month, which is what the local preset
      defaulted to, so the landing view is unchanged.
    */
    const { range: dateRange } = useDashboardDateRange()
    const [movStatusFilter, setMovStatusFilter] = useState<MovStatusName | null>(null)
    const [movModalOpen, setMovModalOpen] = useState(false)
    const [branchMap, setBranchMap] = useState<Record<string, string>>({})

    const assignedBranch = user?.assignedBranch

    const stepMap: Record<
        string,
        'hod_submission' | 'validation' | 'final_confirmation'
    > = {
        operations: 'validation',
        projectmanager: 'validation',
        projectadmin: 'final_confirmation'
    }

    const roleStep =
        stepMap[(user?.role || '').toLowerCase()] || 'final_confirmation'

    const hasApproval = (row: any, step: string) =>
        Array.isArray(row?.approvals) &&
        row.approvals.some((a: any) => a?.step === step)

    const normalizeConsolidatedMovStatus = React.useCallback(
        (row: any): MovStatusName => {
            if (hasApproval(row, roleStep)) return 'Confirmed'

            const confirmedByProjectAdmin = row?.confirmedByProjectAdmin
            if (
                roleStep === 'final_confirmation' &&
                (confirmedByProjectAdmin === true ||
                    String(confirmedByProjectAdmin).toLowerCase() === 'true' ||
                    String(confirmedByProjectAdmin).toLowerCase() === 'confirmed')
            ) {
                return 'Confirmed'
            }

            const genericStatus = String(
                row?.status || row?.movStatus || row?.approvalStatus || ''
            ).toLowerCase()

            if (
                genericStatus === 'confirmed' ||
                genericStatus === 'approved' ||
                genericStatus === 'validated'
            ) {
                return 'Confirmed'
            }

            return 'Pending'
        },
        [roleStep]
    )

    const matchesAssignedBranch = React.useCallback(
        (row: any) => {
            if (!assignedBranch) return true

            const candidates = [
                row?.branchId,
                row?.assignedBranch,
                row?.branch?.id,
                row?.branchCode
            ].filter(Boolean)

            if (!candidates.length) return true

            return candidates.includes(assignedBranch)
        },
        [assignedBranch]
    )

    useEffect(() => {
        const loadBranches = async () => {
            try {
                const snap = await getDocs(
                    query(
                        collection(db, 'branches'),
                    )
                )

                const nextMap: Record<string, string> = {}
                snap.docs.forEach(doc => {
                    const branch = doc.data() as any
                    nextMap[doc.id] = branch.name || branch.branchName || '—'
                })
                setBranchMap(nextMap)
            } catch (err) {
                console.error('[CC Dashboard] failed to load branches', err)
            }
        }

        loadBranches()
    }, [])

    useEffect(() => {
        // Do not query until the full identity has resolved.
        if (identityLoading || !user) return

        let cancelled = false

        const fetchData = async () => {
            setLoading(true)

            try {
                const inquiryConstraints: QueryConstraint[] = []
                const interventionConstraints: QueryConstraint[] = []
                const consolidatedMovConstraints: QueryConstraint[] = []

                if (!isAllPrograms && activeProgramId) {
                    interventionConstraints.push(
                        where('programId', '==', activeProgramId)
                    )

                    consolidatedMovConstraints.push(
                        where('programId', '==', activeProgramId)
                    )
                }

                if (assignedBranch) {
                    inquiryConstraints.push(
                        where('branchId', '==', assignedBranch)
                    )
                }

                const participantConstraints: QueryConstraint[] = [
                    where('applicationStatus', 'in', ['Accepted', 'accepted'])
                ]

                if (!isAllPrograms && activeProgramId) {
                    participantConstraints.push(
                        where('programId', '==', activeProgramId)
                    )
                }

                const [
                    inquiriesSnap,
                    interventionsSnap,
                    consolidatedMovsSnap,
                    participantsSnap
                ] = await Promise.all([
                    getDocs(
                        query(
                            collection(db, 'inquiries'),
                            ...inquiryConstraints
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'assignedInterventions'),
                            ...interventionConstraints
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'consolidatedMOVs'),
                            ...consolidatedMovConstraints
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'applications'),
                            ...participantConstraints
                        )
                    )
                ])

                // Ignore results from an outdated effect run.
                if (cancelled) return

                const inquiryRows = inquiriesSnap.docs.map(docSnap => ({
                    id: docSnap.id,
                    ...docSnap.data()
                }))

                const interventionRows = interventionsSnap.docs
                    .map(docSnap => ({
                        id: docSnap.id,
                        ...docSnap.data()
                    }))
                    .filter(matchesAssignedBranch)

                const consolidatedMovRows = consolidatedMovsSnap.docs
                    .map(docSnap => ({
                        id: docSnap.id,
                        ...docSnap.data()
                    }))
                    .filter(matchesAssignedBranch)

                const participantRows = participantsSnap.docs
                    .map(docSnap => ({
                        id: docSnap.id,
                        ...docSnap.data()
                    }))
                    .filter(matchesAssignedBranch)

                setInquiries(inquiryRows)
                setInterventions(interventionRows)
                setConsolidatedMovs(consolidatedMovRows)
                setParticipants(participantRows)
            } catch (err) {
                if (cancelled) return

                console.error('[CC Dashboard] load failed', {
                    err,
                    programId,
                    activeProgramId,
                    isAllPrograms,
                    assignedBranch
                })

                message.error('Failed to load coordinator dashboard data.')
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        fetchData()

        return () => {
            cancelled = true
        }
    }, [
        identityLoading,
        user?.id,
        assignedBranch,
        programId,
        activeProgramId,
        isAllPrograms,
        matchesAssignedBranch
    ])

    const filterByDate = React.useCallback(
        (rows: any[], dateGetter: (row: any) => Dayjs) => {
            if (!dateRange) return rows

            const [start, end] = dateRange

            return rows.filter(row => {
                const dt = dateGetter(row)
                return dt.isValid() && dt.isBetween(start, end, 'day', '[]')
            })
        },
        [dateRange]
    )

    const filteredInquiries = useMemo(
        () => filterByDate(inquiries, row => getAnyDate(row)),
        [inquiries, filterByDate]
    )

    const filteredInterventions = useMemo(
        () => filterByDate(interventions, row => getAnyDate(row)),
        [interventions, filterByDate]
    )

    const filteredConsolidatedMovs = useMemo(
        () => filterByDate(consolidatedMovs, row => getAnyDate(row)),
        [consolidatedMovs, filterByDate]
    )

    const filteredParticipants = useMemo(
        () => filterByDate(participants, row => getAnyDate(row)),
        [participants, filterByDate]
    )

    const confirmedCount = useMemo(
        () =>
            filteredConsolidatedMovs.filter(
                row => normalizeConsolidatedMovStatus(row) === 'Confirmed'
            ).length,
        [filteredConsolidatedMovs, normalizeConsolidatedMovStatus]
    )

    const pendingCount = useMemo(
        () =>
            filteredConsolidatedMovs.filter(
                row => normalizeConsolidatedMovStatus(row) === 'Pending'
            ).length,
        [filteredConsolidatedMovs, normalizeConsolidatedMovStatus]
    )

    const previousDateRange = useMemo(
        () => getPreviousRange(dateRange),
        [dateRange]
    )

    const filterRowsByExplicitRange = React.useCallback(
        (rows: any[], range: [Dayjs, Dayjs] | null, dateGetter: (row: any) => Dayjs) => {
            if (!range) return []

            const [start, end] = range

            return rows.filter(row => {
                const dt = dateGetter(row)
                return dt.isValid() && dt.isBetween(start, end, 'day', '[]')
            })
        },
        []
    )

    const previousFilteredInquiries = useMemo(
        () => filterRowsByExplicitRange(inquiries, previousDateRange, row => getAnyDate(row)),
        [inquiries, previousDateRange, filterRowsByExplicitRange]
    )

    const previousFilteredInterventions = useMemo(
        () => filterRowsByExplicitRange(interventions, previousDateRange, row => getAnyDate(row)),
        [interventions, previousDateRange, filterRowsByExplicitRange]
    )

    const previousFilteredConsolidatedMovs = useMemo(
        () => filterRowsByExplicitRange(consolidatedMovs, previousDateRange, row => getAnyDate(row)),
        [consolidatedMovs, previousDateRange, filterRowsByExplicitRange]
    )

    const currentPeriodEnd = dateRange?.[1] || dayjs().endOf('day')
    const previousPeriodEnd = previousDateRange?.[1] || null

    const cumulativeParticipants = useMemo(() => {
        return participants.filter(row => {
            const acceptedDate = getParticipantAcceptedDate(row)
            return isOnOrBefore(acceptedDate, currentPeriodEnd)
        })
    }, [participants, currentPeriodEnd])

    const previousCumulativeParticipants = useMemo(() => {
        if (!previousPeriodEnd) return []

        return participants.filter(row => {
            const acceptedDate = getParticipantAcceptedDate(row)
            return isOnOrBefore(acceptedDate, previousPeriodEnd)
        })
    }, [participants, previousPeriodEnd])

    const totalParticipants = cumulativeParticipants.length
    const previousTotalParticipants = previousCumulativeParticipants.length

    const totalMovs = filteredConsolidatedMovs.length
    const previousTotalMovs = previousFilteredConsolidatedMovs.length

    const totalInquiries = filteredInquiries.length
    const previousTotalInquiries = previousFilteredInquiries.length

    const participantsWithInterventionsCount = useMemo(() => {
        const validParticipantKeys = new Set(
            cumulativeParticipants
                .map(row => getParticipantKey(row))
                .filter(Boolean)
                .map(String)
        )

        const activeKeys = new Set<string>()

        filteredInterventions.forEach(row => {
            const key = getParticipantKey(row)
            if (!key) return

            const normalizedKey = String(key)

            if (validParticipantKeys.has(normalizedKey)) {
                activeKeys.add(normalizedKey)
            }
        })

        return activeKeys.size
    }, [filteredInterventions, cumulativeParticipants])

    const previousParticipantsWithInterventionsCount = useMemo(() => {
        const validParticipantKeys = new Set(
            previousCumulativeParticipants
                .map(row => getParticipantKey(row))
                .filter(Boolean)
                .map(String)
        )

        const activeKeys = new Set<string>()

        previousFilteredInterventions.forEach(row => {
            const key = getParticipantKey(row)
            if (!key) return

            const normalizedKey = String(key)

            if (validParticipantKeys.has(normalizedKey)) {
                activeKeys.add(normalizedKey)
            }
        })

        return activeKeys.size
    }, [previousFilteredInterventions, previousCumulativeParticipants])

    const participationRate =
        totalParticipants > 0
            ? Math.min(
                100,
                Number(((participantsWithInterventionsCount / totalParticipants) * 100).toFixed(1))
            )
            : 0

    const previousParticipationRate =
        previousTotalParticipants > 0
            ? Math.min(
                100,
                Number(
                    (
                        (previousParticipantsWithInterventionsCount / previousTotalParticipants) *
                        100
                    ).toFixed(1)
                )
            )
            : 0

    const participantDelta = useMemo(
        () => buildDelta(totalParticipants, previousTotalParticipants),
        [totalParticipants, previousTotalParticipants]
    )

    const movDelta = useMemo(
        () => buildDelta(totalMovs, previousTotalMovs),
        [totalMovs, previousTotalMovs]
    )

    const inquiryDelta = useMemo(
        () => buildDelta(totalInquiries, previousTotalInquiries),
        [totalInquiries, previousTotalInquiries]
    )

    const participationRateDelta = useMemo(
        () =>
            buildDelta(
                participationRate,
                previousParticipationRate,
                'pp vs previous period',
                1
            ),
        [participationRate, previousParticipationRate]
    )


    const movTableData = useMemo(
        () =>
            filteredConsolidatedMovs
                .filter(
                    row =>
                        !movStatusFilter ||
                        normalizeConsolidatedMovStatus(row) === movStatusFilter
                )
                .sort((a, b) => getAnyDate(b).valueOf() - getAnyDate(a).valueOf()),
        [filteredConsolidatedMovs, movStatusFilter, normalizeConsolidatedMovStatus]
    )

    const metrics = [
        {
            title: 'Total Participants',
            value: totalParticipants,
            subtitle: renderDelta(participantDelta),
            icon: <TeamOutlined style={{ fontSize: 20, color: '#1677ff' }} />
        },
        {
            title: 'Total MOVs',
            value: totalMovs,
            subtitle: (
                <Space direction='vertical' size={0}>
                    {renderDelta(movDelta)}
                </Space>
            ),
            icon: <FileDoneOutlined style={{ fontSize: 20, color: '#13c2c2' }} />,
            clickable: true,
            onClick: () => {
                setMovStatusFilter(null)
                setMovModalOpen(true)
            }
        },
        {
            title: 'Total Inquiries',
            value: totalInquiries,
            subtitle: renderDelta(inquiryDelta),
            icon: <SolutionOutlined style={{ fontSize: 20, color: '#722ed1' }} />
        },
        {
            title: 'Participation Rate',
            value: `${participationRate}%`,
            subtitle: (
                <Space direction='vertical' size={0}>
                    {renderDelta(participationRateDelta)}
                </Space>
            ),
            icon: <PercentageOutlined style={{ fontSize: 20, color: '#52c41a' }} />
        }
    ]

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Row
                data-guide="cc-dashboard-metrics"
                gutter={[16, 16]}
                style={{ marginBottom: 24 }}
            >
                {metrics.map(metric => (
                    <Col
                        xs={24}
                        sm={12}
                        xl={6}
                        key={metric.title}
                        data-guide={
                            metric.title === 'Total MOVs'
                                ? 'cc-total-movs-metric'
                                : undefined
                        }
                    >
                        <MotionCard.Metric
                            loading={loading}
                            icon={metric.icon}
                            iconBg='rgba(22,119,255,0.08)'
                            title={metric.title}
                            value={metric.value}
                            subtitle={metric.subtitle}
                            clickable={'clickable' in metric ? metric.clickable : false}
                            onClick={'onClick' in metric ? metric.onClick : undefined}
                            wrapperStyle={{ minHeight: 82 }}
                        />
                    </Col>
                ))}
            </Row>

            <Row gutter={[16, 16]} align='stretch'>
                <Col xs={24} lg={14}>
                    <div data-guide="cc-upcoming-appointments">
                        <UpcomingAppointmentsCard
                            title='Upcoming Appointments'
                            programId={isAllPrograms ? null : activeProgramId || null}
                            daysAhead={null}
                            limit={null}
                        />
                    </div>
                </Col>

                <Col xs={24} lg={10}>
                    <div data-guide="cc-project-metrics">
                        <ProjectAdminProgramPulse
                            programId={isAllPrograms ? null : activeProgramId || null}
                            dateRange={dateRange}
                        />
                    </div>
                </Col>
            </Row>

            <Modal
                className="guide-cc-movs-modal"
                open={movModalOpen}
                title='Recent MOV Submissions'
                centered
                width={860}
                onCancel={() => setMovModalOpen(false)}
                footer={[
                    <Button key='close' onClick={() => setMovModalOpen(false)}>
                        Close
                    </Button>,
                    <Button
                        data-guide="cc-view-all-movs"
                        key='view-all'
                        type='primary'
                        icon={<ArrowRightOutlined />}
                        onClick={() => {
                            setMovModalOpen(false)
                            navigate('/projectadmin/movs')
                        }}
                    >
                        View All MOVs
                    </Button>
                ]}
            >
                <Space direction='vertical' size={14} style={{ width: '100%' }}>
                    <Row gutter={[8, 8]} align='middle' justify='space-between'>
                        <Col>
                            <Space size={[6, 6]} wrap>
                                <Tag>{totalMovs} total</Tag>
                                <Tag color='green'>{confirmedCount} confirmed</Tag>
                                <Tag color='orange'>{pendingCount} pending</Tag>
                            </Space>
                        </Col>

                        <Col>
                            <div data-guide="cc-mov-status-filter">
                                <Segmented
                                    value={movStatusFilter || 'all'}
                                    onChange={value =>
                                        setMovStatusFilter(
                                            value === 'all'
                                                ? null
                                                : (value as MovStatusName)
                                        )
                                    }
                                    options={[
                                        { label: 'All', value: 'all' },
                                        { label: 'Confirmed', value: 'Confirmed' },
                                        { label: 'Pending', value: 'Pending' }
                                    ]}
                                />
                            </div>
                        </Col>
                    </Row>

                    <div data-guide="cc-mov-table">
                        <Table
                            dataSource={movTableData}
                            rowKey='id'
                            size='middle'
                            pagination={{
                                pageSize: 6,
                                showSizeChanger: false,
                                position: ['bottomCenter']
                            }}
                            scroll={{ x: 700 }}
                            locale={{
                                emptyText: 'No MOV submissions match the selected status.'
                            }}
                            columns={[
                                {
                                    title: 'Department',
                                    render: (_: any, record: any) =>
                                        record.department ||
                                        record.departmentName ||
                                        record.areaOfSupport ||
                                        '—'
                                },
                                {
                                    title: 'Submission Date',
                                    render: (_: any, record: any) => {
                                        const dt = getAnyDate(record)
                                        return dt.isValid()
                                            ? dt.format('DD MMM YYYY')
                                            : '—'
                                    }
                                },
                                {
                                    title: 'Status',
                                    width: 120,
                                    render: (_: any, row: any) => {
                                        const status =
                                            normalizeConsolidatedMovStatus(row)

                                        return (
                                            <Tag
                                                color={
                                                    status === 'Confirmed'
                                                        ? 'green'
                                                        : 'orange'
                                                }
                                            >
                                                {status}
                                            </Tag>
                                        )
                                    }
                                }
                            ]}
                        />
                    </div>
                </Space>
            </Modal>
        </div>
    )
}

export default CenterCoordinatorDashboard
