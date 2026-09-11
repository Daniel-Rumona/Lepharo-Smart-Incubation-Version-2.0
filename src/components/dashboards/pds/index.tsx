import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Row,
    Col,
    Card,
    Tag,
    Space,
    Table,
    DatePicker,
    Button,
    Typography,
    Empty,
    Spin,
    message,
    Modal
} from 'antd'
import {
    StarOutlined,
    FunnelPlotOutlined,
    ExpandOutlined,
    CalendarOutlined,
    ArrowRightOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { Helmet } from 'react-helmet'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { db } from '@/firebase'
import {
    collection,
    documentId,
    getDocs,
    onSnapshot,
    query,
    where,
    Timestamp
} from 'firebase/firestore'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useNavigate } from 'react-router-dom'
import { MotionCard } from '../metrics/Header'
import InterventionMetricsGrid from '../metrics/InterventionMetricsGrid'
import UpcomingAppointmentsCard, {
    type UpcomingAppointment
} from '@/components/modals/UpcomingAppointmentsCard'
import AppointmentsCalendarModal from '@/components/modals/AppointmentsCalender'
import AppointmentDetailsModal from '@/components/modals/AppointmentDetails'
import { fetchAppointments, type AppointmentRecord } from '@/services/appointmentService'
import {
    resolveAssignmentLifecycle,
    assignmentAssignedDate
} from '@/services/assignmentLifecycleService'
import { loadInterventionMetrics, type InterventionMetricSummary } from '@/services/interventionMetricsService'

if (!(dayjs as any).prototype.isBetween) dayjs.extend(isBetween)

const { Title, Text } = Typography
const { RangePicker } = DatePicker

// ---------- Types ----------
interface AssignedIntervention {
    id: string
    participantId: string
    participantName?: string
    assigneeId?: string
    assigneeName?: string
    interventionId?: string
    interventionTitle?: string
    departmentId?: string
    programId?: string
    status?: string
    feedback?: { rating?: number; comment?: string }
    confirmedAt?: Timestamp
    assignedAt?: any
    createdAt?: any
    startDate?: any
    assignmentStatus?: string
    assigneeAcceptanceStatus?: string
    participantAcceptanceStatus?: string
    assigneeCompletionStatus?: string
    participantCompletionStatus?: string
}

interface ParticipantDoc {
    id: string
    beneficiaryName?: string
    participantName?: string
    sector?: string
    branch?: string
    email?: string
}

// Assignment date is rarely `confirmedAt` (that field is only set much later
// in a doc's lifecycle) — every other dashboard falls back through
// assignedAt/createdAt/startDate instead. See InterventionsBreakdown.tsx.
const getAssignedAt = (r: AssignedIntervention): Dayjs | null => {
    const d = assignmentAssignedDate(r as any)
    return d ? dayjs(d) : null
}

// `status` is a deprecated field stripped from every write by
// assignedInterventionService — the real workflow state is derived from
// assigneeAcceptanceStatus/participantAcceptanceStatus/completion fields.
// Mirrors getCompositeStatus() in routes/operations/assignments/index.tsx.
const ANTD_TAG_HEX: Record<string, string> = {
    red: '#ff4d4f',
    orange: '#faad14',
    green: '#52c41a',
    blue: '#1677ff',
    geekblue: '#2f54eb',
    purple: '#722ed1',
    magenta: '#eb2f96'
}

const getCompositeStatus = (r: AssignedIntervention) => {
    const lifecycle = resolveAssignmentLifecycle(r as any)
    if (!r.assigneeId && lifecycle.key !== 'cancelled') {
        return { key: 'needs-reassignment', label: 'Needs Reassignment', color: 'magenta' }
    }
    return { key: lifecycle.key, label: lifecycle.label, color: lifecycle.color }
}

// ---------- Component ----------
const PDSDashboard: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const navigate = useNavigate()
    const [loading, setLoading] = useState<boolean>(true)

    const [rows, setRows] = useState<AssignedIntervention[]>([])
    const [interventionMetrics, setInterventionMetrics] = useState<InterventionMetricSummary>({
        totalRequired: 0,
        assigned: 0,
        pendingAssignment: 0,
        inProgress: 0,
        completed: 0
    })
    const [participantsMap, setParticipantsMap] = useState<
        Record<string, ParticipantDoc>
    >({})
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)

    // charts expand modal
    const [expanded, setExpanded] = useState<null | 'monthly' | 'status'>(null)

    // appointments (real-time-ish; refetched on identity change)
    const [appointments, setAppointments] = useState<AppointmentRecord[]>([])
    const [calendarOpen, setCalendarOpen] = useState(false)
    const [selectedAppointment, setSelectedAppointment] =
        useState<AppointmentRecord | UpcomingAppointment | null>(null)
    const [appointmentDetailsOpen, setAppointmentDetailsOpen] = useState(false)


    // ---------- Realtime data: assigned interventions ----------
    useEffect(() => {
        if (identityLoading) return

        if (!user?.departmentId || !activeProgramId) {
            setRows([])
            setParticipantsMap({})
            setLoading(false)
            return
        }

        setLoading(true)

        // Strictly scoped to BOTH the user's department and the active program.
        // This prevents data from another program from entering any KPI/chart/table.
        const aiQ = query(
            collection(db, 'assignedInterventions'),
            where('departmentId', '==', user.departmentId),
            where('programId', '==', activeProgramId)
        )

        const unsubAI = onSnapshot(
            aiQ,
            snap => {
                const list = snap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                })) as AssignedIntervention[]

                // Defensive check as well as the Firestore where() constraint.
                const programRows = list.filter(
                    row => String(row.programId || '') === String(activeProgramId)
                )

                // Sort by assigned/created date desc in-memory.
                programRows.sort((a, b) => {
                    const ta = getAssignedAt(a)?.valueOf() || 0
                    const tb = getAssignedAt(b)?.valueOf() || 0
                    return tb - ta
                })

                setRows(programRows)
                console.log(
                    '[PDSDashboard] Realtime assigned interventions updated:',
                    {
                        activeProgramId,
                        departmentId: user.departmentId,
                        count: programRows.length
                    }
                )
                setLoading(false)
            },
            err => {
                console.error(err)
                setRows([])
                message.error('Failed to load interventions.')
                setLoading(false)
            }
        )

        return () => unsubAI()
    }, [identityLoading, user?.departmentId, activeProgramId])

    useEffect(() => {
        const run = async () => {
            if (!user?.departmentId || !activeProgramId) {
                setInterventionMetrics({
                    totalRequired: 0,
                    assigned: 0,
                    pendingAssignment: 0,
                    inProgress: 0,
                    completed: 0
                })
                return
            }

            try {
                const metrics = await loadInterventionMetrics({
                    programId: activeProgramId,
                    assignedFilters: { departmentId: user.departmentId },
                    requiredMatches: entry =>
                        String(entry.departmentId || '') === String(user.departmentId) ||
                        String(entry.areaOfSupport || entry.area || '').trim().toLowerCase() ===
                        String(user.departmentName || '').trim().toLowerCase()
                })
                setInterventionMetrics(metrics)
            } catch (error) {
                console.error('[PDSDashboard] intervention metrics failed', error)
                setInterventionMetrics({
                    totalRequired: 0,
                    assigned: 0,
                    pendingAssignment: 0,
                    inProgress: 0,
                    completed: 0
                })
            }
        }

        run()
    }, [user?.departmentId, user?.departmentName, activeProgramId])

    // ---------- Appointments (feeds the upcoming-appointments card + calendar) ----------
    useEffect(() => {
        if (!user?.departmentId || !activeProgramId) {
            setAppointments([])
            return
        }

        let cancelled = false

        fetchAppointments({
            departmentId: user.departmentId,
            programId: activeProgramId
        })
            .then(list => {
                if (cancelled) return

                // Keep a defensive in-memory program guard too, in case a legacy
                // service implementation returns a broader result set.
                const programAppointments = (list || []).filter(
                    appointment =>
                        String((appointment as any)?.programId || '') ===
                        String(activeProgramId)
                )

                setAppointments(programAppointments)
            })
            .catch(err => {
                console.error(err)
                if (!cancelled) setAppointments([])
            })

        return () => {
            cancelled = true
        }
    }, [user?.departmentId, activeProgramId])

    // Participants — resolved ONLY from participant ids referenced by the
    // active-program assigned interventions above.
    const fetchedParticipantIds = useRef<Set<string>>(new Set())

    useEffect(() => {
        fetchedParticipantIds.current.clear()
        setParticipantsMap({})
    }, [activeProgramId])
    useEffect(() => {
        const ids = Array.from(new Set(rows.map(r => r.participantId).filter(Boolean)))
        const missingIds = ids.filter(id => !fetchedParticipantIds.current.has(id))
        if (!missingIds.length) return
        missingIds.forEach(id => fetchedParticipantIds.current.add(id))

        const chunks: string[][] = []
        for (let i = 0; i < missingIds.length; i += 30) {
            chunks.push(missingIds.slice(i, i + 30))
        }

        let cancelled = false
        Promise.all(
            chunks.flatMap(chunk => [
                getDocs(query(collection(db, 'participants'), where(documentId(), 'in', chunk))),
                getDocs(query(collection(db, 'perticipants'), where(documentId(), 'in', chunk)))
            ])
        )
            .then(snaps => {
                if (cancelled) return
                const map: Record<string, ParticipantDoc> = {}
                snaps.forEach(snap =>
                    snap.docs.forEach(
                        d => (map[d.id] = { id: d.id, ...(d.data() as any) })
                    )
                )
                if (Object.keys(map).length) {
                    setParticipantsMap(prev => ({ ...prev, ...map }))
                }
            })
            .catch(err => console.error(err))

        return () => {
            cancelled = true
        }
    }, [rows])

    // ---------- Filtering ----------
    const filteredRows = useMemo(() => {
        let data = rows
        if (dateRange?.[0] && dateRange?.[1]) {
            const [start, end] = dateRange
            data = data.filter(r => {
                const dt = getAssignedAt(r)
                if (!dt) return false
                return (
                    (dt.isAfter(start, 'day') || dt.isSame(start, 'day')) &&
                    (dt.isBefore(end, 'day') || dt.isSame(end, 'day'))
                )
            })
        }
        console.log('Filtered rows updated:', data.length)
        return data

    }, [rows, dateRange])

    // ---------- Charts ----------

    const perMonth = useMemo(() => {
        const counts: Record<string, number> = {}
        filteredRows.forEach(r => {
            const dt = getAssignedAt(r)
            if (!dt) return
            const key = dt.format('YYYY-MM')
            counts[key] = (counts[key] || 0) + 1
        })
        const keys = Object.keys(counts).sort()
        const categories = keys.map(k => dayjs(k).format('MMM YY'))
        const series = keys.map(k => counts[k])
        return { categories, series }
    }, [filteredRows])

    const statusBreakdown = useMemo(() => {
        const map: Record<string, { label: string; color: string; count: number }> = {}
        filteredRows.forEach(r => {
            const { key, label, color } = getCompositeStatus(r)
            if (!map[key]) map[key] = { label, color, count: 0 }
            map[key].count += 1
        })
        return Object.values(map)
    }, [filteredRows])

    const hasMonthlyData = perMonth.series.length > 0
    const hasStatusData = statusBreakdown.length > 0

    const labelStyle = {
        color: '#111111',
        fontWeight: 600 as const,
        textOutline: 'none' as const
    }

    const monthlyChart: Highcharts.Options = {
        chart: {
            type: 'spline',
            height: 300,
            backgroundColor: 'transparent'
        },
        title: { text: undefined },
        exporting: { enabled: false },
        credits: { enabled: false },
        xAxis: {
            categories: perMonth.categories,
            lineColor: '#e5e7eb',
            labels: {
                style: { color: '#111' }
            }
        },
        yAxis: {
            title: { text: 'Interventions' },
            gridLineColor: '#f1f5f9',
            labels: {
                style: { color: '#111' }
            },
            allowDecimals: false
        },
        tooltip: {
            shared: true
        },
        plotOptions: {
            spline: {
                lineWidth: 3,
                marker: {
                    enabled: true,
                    radius: 5
                },
                dataLabels: {
                    enabled: true,
                    format: '{y}',
                    y: -10,
                    crop: false,
                    overflow: 'allow',
                    style: labelStyle
                }
            }
        },
        series: [
            {
                type: 'spline',
                name: 'Interventions',
                data: perMonth.series,
                color: '#1677ff'
            }
        ]
    }

    const statusPie: Highcharts.Options = {
        chart: { type: 'pie', height: 300, backgroundColor: 'transparent' },
        title: { text: undefined },
        exporting: { enabled: false },
        credits: { enabled: false },
        legend: {
            enabled: true,
            align: 'center',
            verticalAlign: 'bottom',
            itemStyle: { color: '#111', fontWeight: '600' }
        },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
        plotOptions: {
            pie: {
                innerSize: '60%',
                dataLabels: {
                    enabled: true,
                    distance: 12,
                    style: labelStyle,
                    formatter: function () {
                        const p = this.point as Highcharts.Point
                        return `${p.name}: ${p.y}`
                    }
                },
                showInLegend: true,
                connectorColor: '#999'
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Status',
                data: statusBreakdown.map(({ label, color, count }) => ({
                    name: label,
                    y: count,
                    color: ANTD_TAG_HEX[color] || color
                }))
            }
        ]
    }

    // ---------- Table ----------
    const columns = [
        {
            title: 'Participant',
            key: 'participant',
            render: (_: any, r: AssignedIntervention) => {
                const p = participantsMap[r.participantId]
                return (
                    p?.beneficiaryName ||
                    p?.participantName ||
                    r.participantName ||
                    r.participantId ||
                    '—'
                )
            }
        },
        {
            title: 'Intervention',
            dataIndex: 'interventionTitle',
            key: 'interventionTitle',
            ellipsis: true
        },
        { title: 'Assignee', dataIndex: 'assigneeName', key: 'assigneeName' },
        {
            title: 'Status',
            key: 'status',
            render: (_: any, r: AssignedIntervention) => {
                const { label, color } = getCompositeStatus(r)
                return <Tag color={color}>{label}</Tag>
            }
        },
        {
            title: 'Feedback',
            dataIndex: 'feedback',
            key: 'feedback',
            render: (fb: AssignedIntervention['feedback']) =>
                typeof fb?.rating === 'number' ? `${fb.rating.toFixed(1)} / 5` : '—'
        },
        {
            title: 'Assigned',
            key: 'assignedAt',
            render: (_: any, r: AssignedIntervention) => {
                const dt = getAssignedAt(r)
                return dt ? dt.format('DD MMM YYYY') : '—'
            }
        }
    ]

    const resetFilters = () => {
        setDateRange(null)
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Department Dashboard | Smart Incubator</title>
            </Helmet>

            {/* Header */}
            <MotionCard
                style={{
                    background: 'linear-gradient(90deg,#eef4ff,#f9fbff)',
                    marginBottom: 12
                }}
            >
                <Row align='middle' justify='space-between'>
                    <Col>
                        <Title level={4} style={{ margin: 0 }}>
                            {user?.departmentName || 'Department'} — Interventions
                        </Title>
                        <Text type='secondary'>
                            Real-time interventions, progress & appointments
                        </Text>
                    </Col>
                    <Col>
                        <Space wrap>
                            <RangePicker
                                value={dateRange}
                                onChange={value =>
                                    setDateRange(value as [Dayjs, Dayjs] | null)
                                }
                            />
                            <Button
                                icon={<CalendarOutlined />}
                                onClick={() => setCalendarOpen(true)}
                            >
                                Open Calendar
                            </Button>
                            <Button onClick={resetFilters}>Reset</Button>
                        </Space>
                    </Col>
                </Row>
            </MotionCard>

            {loading ? (
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: 240
                    }}
                >
                    <Spin size='large' />
                </div>
            ) : (
                <>
                    {/* KPIs */}
                    <div style={{ marginBottom: 12 }}>
                        <InterventionMetricsGrid metrics={interventionMetrics} loading={loading} />
                    </div>

                    {/* Charts */}
                    <Row gutter={16} style={{ marginBottom: 12 }}>
                        <Col xs={24} md={12}>
                            {/* Interventions per Month */}
                            <MotionCard
                                title='Interventions per Month'
                                extra={
                                    <Button
                                        size='small'
                                        type='text'
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpanded('monthly')}
                                        disabled={!hasMonthlyData}
                                    />
                                }
                            >
                                {hasMonthlyData ? (
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        options={monthlyChart}
                                    />
                                ) : (
                                    <Empty description='No data for selected period' />
                                )}
                            </MotionCard>
                        </Col>
                        <Col xs={24} md={12}>
                            {/* Status Breakdown */}
                            <MotionCard
                                title='Status Breakdown'
                                extra={
                                    <Button
                                        size='small'
                                        type='text'
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpanded('status')}
                                        disabled={!hasStatusData}
                                    />
                                }
                            >
                                {hasStatusData ? (
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        options={statusPie}
                                    />
                                ) : (
                                    <Empty description='No data to summarize' />
                                )}
                            </MotionCard>
                        </Col>
                    </Row>

                    <Row gutter={16} style={{ marginBottom: 12 }}>
                        <Col xs={24} md={14}>
                            <MotionCard
                                title={
                                    <Space>
                                        <FunnelPlotOutlined /> Recent Interventions
                                    </Space>
                                }
                                extra={
                                    <Button
                                        type='link'
                                        onClick={() => navigate('/operations/assignments')}
                                    >
                                        View All <ArrowRightOutlined />
                                    </Button>
                                }
                            >
                                {filteredRows.length ? (
                                    <Table
                                        rowKey='id'
                                        dataSource={filteredRows}
                                        columns={columns as any}
                                        pagination={{ pageSize: 10 }}
                                    />
                                ) : (
                                    <Empty description='No interventions match your filters' />
                                )}
                            </MotionCard>
                        </Col>

                        <Col xs={24} md={10}>
                            <UpcomingAppointmentsCard
                                departmentId={user?.departmentId}
                                programId={activeProgramId}
                                appointments={appointments}
                                onViewCalendar={() => setCalendarOpen(true)}
                                onAppointmentClick={appt => {
                                    setSelectedAppointment(appt)
                                    setAppointmentDetailsOpen(true)
                                }}
                            />
                        </Col>
                    </Row>

                    {/* Chart expand modal */}
                    <Modal
                        open={!!expanded}
                        onCancel={() => setExpanded(null)}
                        footer={null}
                        width={960}
                        title={
                            expanded === 'monthly'
                                ? 'Interventions per Month'
                                : 'Status Breakdown'
                        }
                    >
                        {expanded === 'monthly' ? (
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={{
                                    ...monthlyChart,
                                    chart: { ...monthlyChart.chart, height: 520 }
                                }}
                            />
                        ) : (
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={{
                                    ...statusPie,
                                    chart: { ...statusPie.chart, height: 520 }
                                }}
                            />
                        )}
                    </Modal>

                    <AppointmentsCalendarModal
                        open={calendarOpen}
                        onClose={() => setCalendarOpen(false)}
                        appointments={appointments}
                        departmentId={user?.departmentId}
                        onAppointmentClick={appt => {
                            setSelectedAppointment(appt)
                            setAppointmentDetailsOpen(true)
                        }}
                    />

                    <AppointmentDetailsModal
                        open={appointmentDetailsOpen}
                        onClose={() => setAppointmentDetailsOpen(false)}
                        appointment={selectedAppointment as any}
                    />
                </>
            )}
        </div>
    )
}

export default PDSDashboard
