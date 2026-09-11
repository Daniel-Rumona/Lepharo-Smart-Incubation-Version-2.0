import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Table,
    Progress,
    Tag,
    Form,
    Button,
    Space,
    Modal,
    Result,
    Spin
} from 'antd'
import {
    ReloadOutlined,
    FullscreenOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    query,
    where,
    Timestamp,
    DocumentData
} from 'firebase/firestore'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import dayjs from 'dayjs'

import { GlobalEventModal } from '@/components/modals/Events'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import EventDetailsModal from '@/components/modals/EventDetails'
import EventsCalendarModal from '@/components/modals/EventsCalender'
import {
    MotionCard,
    DashboardHeaderCard
} from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import AppointmentsCard from '../charts/AppointmentsCard'
import { loadInterventionMetrics, type InterventionMetricSummary } from '@/services/interventionMetricsService'
import InterventionMetricsGrid from '../metrics/InterventionMetricsGrid'

type FirestoreDateLike =
    | Timestamp
    | Date
    | string
    | number
    | { toDate?: () => Date; seconds?: number; nanoseconds?: number }
    | null
    | undefined

interface InterventionRecord {
    id: string
    participantId?: string
    assigneeId?: string
    assigneeName?: string
    interventionId?: string
    interventionTitle?: string
    areaOfSupport?: string
    status?: string
    assignmentStatus?: string
    participantCompletionStatus?: string
    assigneeCompletionStatus?: string
    progress?: number
    computedProgress?: number
    progressUpdates?: Array<any>
    tracking?: {
        sessionsLogged?: number
        timeSpentHours?: number
    }
    feedback?: { rating?: number }
    confirmedAt?: FirestoreDateLike
    dueDate?: FirestoreDateLike
    createdAt?: FirestoreDateLike
}

interface ConsultantStats {
    consultantId: string
    consultantName: string
    assigned: number
    completed: number
    avgRating: number
}

interface EventRecord {
    id: string
    title: string
    eventDate: FirestoreDateLike
    startTime?: string
    endTime?: string
    location?: string
    meetingLink?: string
    link?: string
    format?: 'virtual' | 'in-person' | 'hybrid' | string
    participants?: Array<{ email?: string; type?: string }>
    description?: string
    areaOfSupport?: string
}

type CanonicalInterventionState =
    | 'assigned'
    | 'in_progress'
    | 'completed'
    | 'pending_confirmation'

const DEPARTMENT = 'Wellness'
const NORMALIZED_DEPARTMENT = DEPARTMENT.toLowerCase().trim()

const normalizeText = (value: any) =>
    String(value || '')
        .trim()
        .toLowerCase()

const toDate = (value: FirestoreDateLike): Date | null => {
    if (!value) return null
    if (value instanceof Date) return isNaN(+value) ? null : value
    if (typeof (value as any)?.toDate === 'function') {
        const d = (value as any).toDate()
        return d instanceof Date && !isNaN(+d) ? d : null
    }
    if (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as any).seconds === 'number'
    ) {
        const d = new Date((value as any).seconds * 1000)
        return isNaN(+d) ? null : d
    }
    const d = new Date(value as any)
    return isNaN(+d) ? null : d
}

const hasStartedWork = (row: InterventionRecord) => {
    const directProgress =
        typeof row.progress === 'number'
            ? row.progress
            : typeof row.computedProgress === 'number'
                ? row.computedProgress
                : 0

    return (
        directProgress > 0 ||
        (Array.isArray(row.progressUpdates) && row.progressUpdates.length > 0) ||
        Number(row.tracking?.sessionsLogged || 0) > 0 ||
        Number(row.tracking?.timeSpentHours || 0) > 0
    )
}

const normalizeInterventionState = (
    row: InterventionRecord
): CanonicalInterventionState => {
    const status = normalizeText(row.assignmentStatus)
    const userCompletion = normalizeText(row.participantCompletionStatus)
    const consultantCompletion = normalizeText(row.assigneeCompletionStatus)

    const completedTokens = new Set([
        'completed',
        'complete',
        'done',
        'finished',
        'closed',
        'finalized',
        'confirmed',
        'verified',
        'approved'
    ])

    const inProgressTokens = new Set([
        'in progress',
        'in-progress',
        'inprogress',
        'ongoing',
        'active',
        'running',
        'started',
        'underway'
    ])

    const assignedTokens = new Set([
        'assigned',
        'new',
        'pending',
        'awaiting',
        'queued',
        'accepted',
        'acknowledged',
        'submitted',
        'not started',
        'not-started'
    ])

    if (
        completedTokens.has(status) ||
        completedTokens.has(userCompletion) ||
        completedTokens.has(consultantCompletion)
    ) {
        return 'completed'
    }

    if (
        userCompletion === 'pending' ||
        userCompletion === 'awaiting' ||
        userCompletion === 'awaiting confirmation' ||
        userCompletion === 'pending confirmation'
    ) {
        if (
            completedTokens.has(consultantCompletion) ||
            status === 'pending confirmation'
        ) {
            return 'pending_confirmation'
        }
    }

    if (inProgressTokens.has(status) || hasStartedWork(row)) {
        return 'in_progress'
    }

    if (assignedTokens.has(status) || !status) {
        return 'assigned'
    }

    return 'assigned'
}

const normalizeFormat = (
    e: EventRecord
): 'virtual' | 'in-person' | 'hybrid' | 'unknown' => {
    const raw = normalizeText(e.format)

    if (raw === 'virtual' || raw === 'online') return 'virtual'
    if (raw === 'in-person' || raw === 'in person' || raw === 'onsite')
        return 'in-person'
    if (raw === 'hybrid') return 'hybrid'
    if ((e.meetingLink || e.link) && !e.location) return 'virtual'
    if (e.location && !(e.meetingLink || e.link)) return 'in-person'
    return 'unknown'
}

const toISODate = (value: FirestoreDateLike) =>
    dayjs(toDate(value) || new Date()).format('YYYY-MM-DD')

const buildConsultantStats = (rows: InterventionRecord[]): ConsultantStats[] => {
    const map = new Map<
        string,
        {
            consultantId: string
            consultantName: string
            assigned: number
            completed: number
            ratingTotal: number
            ratingCount: number
        }
    >()

    for (const row of rows) {
        const consultantId = row.assigneeId || 'unassigned'
        const consultantName =
            row.assigneeName?.trim() || 'Unassigned'

        if (!map.has(consultantId)) {
            map.set(consultantId, {
                consultantId,
                consultantName,
                assigned: 0,
                completed: 0,
                ratingTotal: 0,
                ratingCount: 0
            })
        }

        const bucket = map.get(consultantId)!
        bucket.assigned += 1

        if (normalizeInterventionState(row) === 'completed') {
            bucket.completed += 1
        }

        if (typeof row.feedback?.rating === 'number') {
            bucket.ratingTotal += row.feedback.rating
            bucket.ratingCount += 1
        }
    }

    return Array.from(map.values())
        .map(item => ({
            consultantId: item.consultantId,
            consultantName: item.consultantName,
            assigned: item.assigned,
            completed: item.completed,
            avgRating: item.ratingCount
                ? +(item.ratingTotal / item.ratingCount).toFixed(1)
                : 0
        }))
        .sort((a, b) => b.assigned - a.assigned)
}

const WellnessDashboard: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [loading, setLoading] = useState(true)
    const [reloadKey, setReloadKey] = useState(0)

    const [interventions, setInterventions] = useState<InterventionRecord[]>([])
    const [assignedWellness, setAssignedWellness] = useState<
        InterventionRecord[]
    >([])
    const [interventionMetrics, setInterventionMetrics] = useState<InterventionMetricSummary>({
        totalRequired: 0,
        assigned: 0,
        pendingAssignment: 0,
        inProgress: 0,
        completed: 0
    })
    const [consultantStats, setConsultantStats] = useState<ConsultantStats[]>([])
    const [wellnessEvents, setWellnessEvents] = useState<EventRecord[]>([])

    const [eventModalOpen, setEventModalOpen] = useState(false)
    const [eventForm] = Form.useForm()

    const [expanded, setExpanded] = useState<null | 'status' | 'consultant'>(null)
    const [calendarOpen, setCalendarOpen] = useState(false)
    const [detailsOpen, setDetailsOpen] = useState(false)
    const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null)

    const fetchAll = useCallback(async () => {

        setLoading(true)

        try {
            const constraints: any[] = []

            if (!isAllPrograms && activeProgramId) {
                constraints.push(where('programId', '==', activeProgramId))
            }

            const assignedQuery = query(
                collection(db, 'assignedInterventions'),
                ...constraints
            )

            const assignedSnap = await getDocs(assignedQuery)

            const allAssigned = assignedSnap.docs.map(docSnap => ({
                id: docSnap.id,
                ...(docSnap.data() as any)
            })) as InterventionRecord[]

            const wellnessAssigned = allAssigned.filter(row => {
                const rowDept = normalizeText(row.areaOfSupport)
                return rowDept === NORMALIZED_DEPARTMENT
            })

            setAssignedWellness(wellnessAssigned)
            setInterventions(wellnessAssigned)
            setConsultantStats(buildConsultantStats(wellnessAssigned))

            const metrics = await loadInterventionMetrics({
                programId: isAllPrograms ? null : activeProgramId,
                assignedMatches: row => normalizeText(row.areaOfSupport || row.departmentName) === NORMALIZED_DEPARTMENT,
                requiredMatches: entry => normalizeText(entry.areaOfSupport || entry.area || entry.departmentName) === NORMALIZED_DEPARTMENT
            })
            setInterventionMetrics(metrics)

            const me = normalizeText(user?.email)
            const todayStart = dayjs().startOf('day')

        } catch (error) {
            console.error('Wellness dashboard load error:', error)
            setInterventions([])
            setAssignedWellness([])
            setInterventionMetrics({
                totalRequired: 0,
                assigned: 0,
                pendingAssignment: 0,
                inProgress: 0,
                completed: 0
            })
            setConsultantStats([])
            setWellnessEvents([])
        } finally {
            setLoading(false)
        }
    }, [user?.email, activeProgramId, isAllPrograms])

    useEffect(() => {
        fetchAll()
    }, [fetchAll, reloadKey])

    const totalInterventions = interventions.length
    const uniqueParticipants = new Set(
        interventions.map(item => item.participantId).filter(Boolean)
    ).size

    const pendingCompletions = useMemo(
        () =>
            assignedWellness.filter(
                item => normalizeInterventionState(item) === 'pending_confirmation'
            ).length,
        [assignedWellness]
    )

    const averageRating = useMemo(() => {
        const rated = interventions.filter(
            item => typeof item.feedback?.rating === 'number'
        )
        if (!rated.length) return 0
        const total = rated.reduce((sum, item) => sum + (item.feedback?.rating || 0), 0)
        return +(total / rated.length).toFixed(1)
    }, [interventions])

    const completionRate = useMemo(() => {
        if (!assignedWellness.length) return 0
        const completed = assignedWellness.filter(
            item => normalizeInterventionState(item) === 'completed'
        ).length
        return Math.round((completed / assignedWellness.length) * 100)
    }, [assignedWellness])

    const statusCounts = useMemo(() => {
        const counts = {
            assigned: 0,
            inProgress: 0,
            completed: 0,
            pending: 0
        }

        assignedWellness.forEach(item => {
            const state = normalizeInterventionState(item)
            if (state === 'completed') counts.completed += 1
            else if (state === 'in_progress') counts.inProgress += 1
            else if (state === 'pending_confirmation') counts.pending += 1
            else counts.assigned += 1
        })

        return counts
    }, [assignedWellness])

    const hasStatusData = assignedWellness.length > 0
    const hasConsultantData = consultantStats.length > 0
    const hasEventsData = wellnessEvents.length > 0

    const statusDonut: Highcharts.Options = {
        chart: { type: 'pie', backgroundColor: 'transparent', height: 320 },
        title: { text: undefined },
        credits: { enabled: false },
        exporting: { enabled: false },
        legend: { enabled: true, align: 'center', verticalAlign: 'bottom' },
        tooltip: {
            pointFormat: '<b>{point.y}</b> interventions ({point.percentage:.1f}%)'
        },
        plotOptions: {
            pie: {
                innerSize: '60%',
                showInLegend: true,
                dataLabels: {
                    enabled: true,
                    distance: 12,
                    style: { textOutline: 'none', fontWeight: 600 },
                    formatter() {
                        const point = this.point as Highcharts.Point
                        return `${point.name}: ${point.y}`
                    }
                }
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Interventions',
                data: [
                    { name: 'Completed', y: statusCounts.completed, color: '#52c41a' },
                    { name: 'In Progress', y: statusCounts.inProgress, color: '#1677ff' },
                    { name: 'Assigned', y: statusCounts.assigned, color: '#faad14' },
                    { name: 'Pending Confirmation', y: statusCounts.pending, color: '#b37feb' }
                ]
            }
        ]
    }

    const byConsultant = useMemo(() => {
        return {
            names: consultantStats.map(item => item.consultantName),
            assigned: consultantStats.map(item => item.assigned),
            completed: consultantStats.map(item => item.completed)
        }
    }, [consultantStats])

    const consultantBar: Highcharts.Options = {
        chart: { type: 'column', backgroundColor: 'transparent', height: 320 },
        title: { text: undefined },
        credits: { enabled: false },
        exporting: { enabled: false },
        xAxis: { categories: byConsultant.names, lineColor: '#e5e7eb' },
        yAxis: {
            title: { text: 'Count' },
            gridLineColor: '#f1f5f9',
            allowDecimals: false
        },
        tooltip: { shared: true },
        plotOptions: {
            column: {
                borderRadius: 4,
                dataLabels: { enabled: true }
            }
        },
        series: [
            {
                type: 'column',
                name: 'Assigned',
                data: byConsultant.assigned,
                color: '#1677ff'
            },
            {
                type: 'column',
                name: 'Completed',
                data: byConsultant.completed,
                color: '#52c41a'
            }
        ]
    }

    const expandedOptions = (options: Highcharts.Options): Highcharts.Options => ({
        ...options,
        chart: { ...(options.chart || {}), height: 520 }
    })

    const consultantColumns = [
        {
            title: 'Consultant',
            dataIndex: 'consultantName',
            key: 'consultantName'
        },
        {
            title: 'Assigned',
            dataIndex: 'assigned',
            key: 'assigned'
        },
        {
            title: 'Completed',
            dataIndex: 'completed',
            key: 'completed'
        },
        {
            title: 'Completion Rate',
            key: 'rate',
            render: (_: any, row: ConsultantStats) => {
                const rate = row.assigned
                    ? Math.round((row.completed / row.assigned) * 100)
                    : 0

                return (
                    <Tag color={rate >= 80 ? 'green' : rate >= 50 ? 'orange' : 'red'}>
                        {rate}%
                    </Tag>
                )
            }
        },
        {
            title: 'Avg Rating',
            key: 'rating',
            render: (_: any, row: ConsultantStats) => `${row.avgRating.toFixed(1)} ★`
        }
    ]

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <DashboardHeaderCard
                title='Wellness Services – Overview'
                subtitle='Participation, completion, consultant delivery, and upcoming sessions.'
                onOpenCalendar={() => setCalendarOpen(true)}
                extraRight={
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={() => setReloadKey(prev => prev + 1)}
                    >
                        Refresh
                    </Button>
                }
            />

            <div style={{ marginTop: 12 }}>
                <InterventionMetricsGrid metrics={interventionMetrics} loading={loading} />
            </div>


            <Row gutter={16} style={{ marginTop: 12 }}>
                <Col xs={24} md={12}>
                    <MotionCard
                        title='Interventions by Status'
                        extra={
                            <Button
                                type='text'
                                icon={<FullscreenOutlined />}
                                onClick={() => setExpanded('status')}
                                disabled={!hasStatusData}
                            >
                                Expand
                            </Button>
                        }
                    >
                        {loading ? (
                            <div style={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                                <Spin size='large' />
                            </div>
                        ) : !hasStatusData ? (
                            <Result
                                status='info'
                                title='No wellness intervention data yet'
                                subTitle='Once Wellness interventions are assigned, their status breakdown will appear here.'
                            />
                        ) : (
                            <HighchartsReact highcharts={Highcharts} options={statusDonut} />
                        )}
                    </MotionCard>
                </Col>

                <Col xs={24} md={12}>
                    <MotionCard
                        title='Assigned vs Completed by Consultant'
                        extra={
                            <Button
                                type='text'
                                icon={<FullscreenOutlined />}
                                onClick={() => setExpanded('consultant')}
                                disabled={!hasConsultantData}
                            >
                                Expand
                            </Button>
                        }
                    >
                        {loading ? (
                            <div style={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                                <Spin size='large' />
                            </div>
                        ) : !hasConsultantData ? (
                            <Result
                                status='info'
                                title='No consultant activity yet'
                                subTitle='This chart appears once Wellness interventions are linked to consultants.'
                            />
                        ) : (
                            <HighchartsReact highcharts={Highcharts} options={consultantBar} />
                        )}
                    </MotionCard>
                </Col>
            </Row>

            <Row gutter={16} style={{ marginTop: 12 }}>
                <Col xs={24} md={14}>
                    <MotionCard title='Consultant Delivery Summary'>
                        {loading ? (
                            <div style={{ minHeight: 260, display: 'grid', placeItems: 'center' }}>
                                <Spin size='large' />
                            </div>
                        ) : !hasConsultantData ? (
                            <Result
                                status='info'
                                title='No consultant summary available'
                                subTitle='There are no Wellness consultant records to summarize yet.'
                            />
                        ) : (
                            <Table
                                columns={consultantColumns as any}
                                dataSource={consultantStats}
                                rowKey='consultantId'
                                pagination={{ pageSize: 6 }}
                                locale={{ emptyText: 'No consultant data available' }}
                            />
                        )}
                    </MotionCard>
                </Col>

                <Col xs={24} md={10}>
                    <AppointmentsCard
                        departmentId={user?.departmentId}
                        programId={activeProgramId}
                        pageSize={5}
                    />
                    {false && (
                        <MotionCard
                            title='Upcoming Events'
                        >
                            {loading ? (
                                <div style={{ minHeight: 260, display: 'grid', placeItems: 'center' }}>
                                    <Spin size='large' />
                                </div>
                            ) : !hasEventsData ? (
                                <Result
                                    status='info'
                                    title='No upcoming events'
                                    subTitle='Upcoming Wellness sessions assigned to Operations will appear here.'
                                />
                            ) : (
                                <Table
                                    dataSource={wellnessEvents}
                                    rowKey='id'
                                    pagination={false}
                                    locale={{ emptyText: 'No upcoming events' }}
                                    columns={[
                                        {
                                            title: 'Title',
                                            dataIndex: 'title',
                                            key: 'title'
                                        },
                                        {
                                            title: 'Date & Time',
                                            key: 'datetime',
                                            render: (_: any, row: EventRecord) => {
                                                const date = dayjs(
                                                    toDate(row.eventDate) || new Date()
                                                ).format('YYYY-MM-DD')

                                                return (
                                                    <div>
                                                        <div>{date}</div>
                                                        <div>
                                                            {row.startTime || '—'}
                                                            {row.endTime ? ` - ${row.endTime}` : ''}
                                                        </div>
                                                    </div>
                                                )
                                            }
                                        },
                                        {
                                            title: 'Where',
                                            key: 'where',
                                            render: (_: any, row: EventRecord) => {
                                                const fmt = normalizeFormat(row)
                                                const join = row.meetingLink || row.link

                                                if (fmt === 'virtual') {
                                                    return (
                                                        <>
                                                            <Tag color='blue'>Online</Tag>
                                                            {join && (
                                                                <div>
                                                                    <a
                                                                        href={join}
                                                                        target='_blank'
                                                                        rel='noopener noreferrer'
                                                                    >
                                                                        Join Meeting
                                                                    </a>
                                                                </div>
                                                            )}
                                                        </>
                                                    )
                                                }

                                                if (fmt === 'in-person') {
                                                    return (
                                                        <>
                                                            <Tag color='green'>In-Person</Tag>
                                                            <div>{row.location || '—'}</div>
                                                        </>
                                                    )
                                                }

                                                if (fmt === 'hybrid') {
                                                    return (
                                                        <>
                                                            <Tag color='purple'>Hybrid</Tag>
                                                            <div>{row.location || '—'}</div>
                                                            {join && (
                                                                <div>
                                                                    <a
                                                                        href={join}
                                                                        target='_blank'
                                                                        rel='noopener noreferrer'
                                                                    >
                                                                        Join Online
                                                                    </a>
                                                                </div>
                                                            )}
                                                        </>
                                                    )
                                                }

                                                return (
                                                    <>
                                                        <Tag>—</Tag>
                                                        <div>{row.location || (join ? 'Online' : '—')}</div>
                                                        {join && (
                                                            <div>
                                                                <a
                                                                    href={join}
                                                                    target='_blank'
                                                                    rel='noopener noreferrer'
                                                                >
                                                                    Join
                                                                </a>
                                                            </div>
                                                        )}
                                                    </>
                                                )
                                            }
                                        }
                                    ]}
                                />
                            )}
                        </MotionCard>
                    )}
                </Col>
            </Row>

            <Modal
                open={!!expanded}
                onCancel={() => setExpanded(null)}
                footer={null}
                width={1000}
                title={
                    expanded === 'status'
                        ? 'Interventions by Status'
                        : 'Assigned vs Completed by Consultant'
                }
                destroyOnClose
            >
                {expanded === 'status' &&
                    (hasStatusData ? (
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={expandedOptions(statusDonut)}
                        />
                    ) : (
                        <Result
                            status='info'
                            title='No data to expand'
                            subTitle='There is no Wellness intervention status data yet.'
                        />
                    ))}

                {expanded === 'consultant' &&
                    (hasConsultantData ? (
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={expandedOptions(consultantBar)}
                        />
                    ) : (
                        <Result
                            status='info'
                            title='No data to expand'
                            subTitle='There is no consultant activity data yet.'
                        />
                    ))}
            </Modal>
        </div>
    )
}

export default WellnessDashboard
