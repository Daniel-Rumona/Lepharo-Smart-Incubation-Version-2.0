import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Row,
    Col,
    Table,
    Tag,
    Space,
    Button,
    Typography,
    Form,
    Empty,
    Tooltip,
    Statistic
} from 'antd'
import {
    TeamOutlined,
    CalendarOutlined,
    ReloadOutlined,
    FileTextOutlined,
    UserAddOutlined,
    CheckCircleOutlined
} from '@ant-design/icons'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs, { Dayjs } from 'dayjs'
import { motion } from 'framer-motion'
import { useFullIdentity } from '@/hooks/useFullIdentity'

// charts (new)
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'

// Event modals
import { GlobalEventModal } from '@/components/modals/Events'
import EventsCalendarModal from '@/components/modals/EventsCalender'
import EventDetailsModal from '@/components/modals/EventDetails'
import AppointmentsCard from '@/components/dashboards/charts/AppointmentsCard'

const { Title, Text } = Typography

// disable credits/export
Highcharts.setOptions({
    credits: { enabled: false },
    exporting: { enabled: false }
})

/** Shared style + animation */
const cardStyle: React.CSSProperties = {
    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
    transition: 'all 0.3s ease',
    borderRadius: 8,
    border: '1px solid #d6e4ff'
}
const MotionCard: React.FC<React.ComponentProps<typeof Card>> = ({
    children,
    style,
    ...rest
}) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
    >
        <Card {...rest} style={{ ...cardStyle, ...(style || {}) }}>
            {children}
        </Card>
    </motion.div>
)

/** Types */
interface HRUser {
    id: string
    name?: string
    email?: string
    role?: string
}
interface LeaveReq {
    id: string
    employeeName?: string
    type?: string
    from?: any
    to?: any
    days?: number
    status?: string
}
interface EventItem {
    id: string
    title: string
    date: string
    startTime?: string
    endTime?: string
    type?: string
    format?: string
    location?: string
    time?: Dayjs
    description?: string
    link?: string
}
interface JobPosting {
    id: string
    title?: string
    status?: 'open' | 'closed'
    department?: string
}

/** HR Dashboard */
const HRDashboard: React.FC = () => {
    const { user } = useFullIdentity()
    const [employees, setEmployees] = useState<HRUser[]>([])
    const [leaveRequests, setLeaveRequests] = useState<LeaveReq[]>([])
    const [jobPostings, setJobPostings] = useState<JobPosting[]>([])
    const [events, setEvents] = useState<EventItem[]>([])
    const [loading, setLoading] = useState(true)

    // Event modals state
    const [calendarVisible, setCalendarVisible] = useState(false)
    const [eventModalOpen, setEventModalOpen] = useState(false)
    const [eventForm] = Form.useForm()
    const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null)
    const [detailsModalVisible, setDetailsModalVisible] = useState(false)

    const fetchAll = async () => {
        setLoading(true)

        // Employees (users)
        const usersSnap = await getDocs(
            query(
                collection(db, 'users'),
                where('role', 'not-in', ['incubatee', 'Incubatee', 'funder'])
            )
        )
        setEmployees(usersSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))

        // Leave requests
        const leaveSnap = await getDocs(collection(db, 'leaveRequests'))
        setLeaveRequests(
            leaveSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
        )

        // Open roles (job postings)
        const jobsSnap = await getDocs(
            query(
                collection(db, 'resources'),
                where('type', '==', 'jobPosting')
            )
        )
        setJobPostings(jobsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))

        // Events
        const evSnap = await getDocs(collection(db, 'events'))
        setEvents(
            evSnap.docs.map(d => {
                const data = d.data() as any
                const t = dayjs(`${data.date}T${data.startTime || '00:00'}`)
                return { id: d.id, ...data, time: t }
            })
        )

        setLoading(false)
    }

    useEffect(() => {
        fetchAll()
    }, [])

    // HR KPIs
    const totalEmployees = employees.length
    const activeEmployees = employees.filter(
        e => (e.role || '').toLowerCase() !== 'inactive'
    ).length
    const pendingLeave = leaveRequests.filter(l => l.status === 'pending').length
    const openRoles = jobPostings.filter(
        j => (j.status || 'open') === 'open'
    ).length

    // Upcoming events (Next 7 days)
    const upcomingNext7 = useMemo(() => {
        const start = dayjs().startOf('day')
        const end = dayjs().add(7, 'day').endOf('day')
        return events
            .map(e => ({
                ...e,
                _t: e.time || dayjs(`${e.date}T${e.startTime || '00:00'}`)
            }))
            .filter(e => e._t.isAfter(start) && e._t.isBefore(end))
            .sort((a, b) => a._t.valueOf() - b._t.valueOf())
    }, [events])

    const eventTypeTag = (t?: string) => {
        const type = (t || 'event').toLowerCase()
        const color =
            type === 'deadline'
                ? 'red'
                : type === 'meeting'
                    ? 'blue'
                    : type === 'workshop'
                        ? 'purple'
                        : 'green'
        return (
            <Tag color={color}>{type.charAt(0).toUpperCase() + type.slice(1)}</Tag>
        )
    }

    const upcomingCols = [
        {
            title: 'Date',
            key: 'date',
            render: (_: any, r: any) => r._t.format('YYYY-MM-DD'),
            width: 110
        },
        {
            title: 'Time',
            key: 'time',
            render: (_: any, r: any) =>
                [r.startTime, r.endTime].filter(Boolean).join(' – ') ||
                r._t.format('HH:mm'),
            width: 120
        },
        {
            title: 'Title',
            dataIndex: 'title',
            render: (t: string) => <Text strong>{t}</Text>
        },
        {
            title: 'Type',
            dataIndex: 'type',
            render: (t: string) => eventTypeTag(t),
            width: 120
        },
        { title: 'Location', dataIndex: 'location', width: 180, ellipsis: true }
    ]

    // ---------- NEW: Donut (Leave Status Breakdown) ----------
    const leaveStatusCounts = useMemo(() => {
        const c = { Approved: 0, Pending: 0, Rejected: 0 }
        leaveRequests.forEach(l => {
            const s = (l.status || 'pending').toLowerCase()
            if (s === 'approved') c.Approved++
            else if (s === 'rejected') c.Rejected++
            else c.Pending++
        })
        return c
    }, [leaveRequests])

    const leaveDonutOptions: Highcharts.Options = {
        chart: { type: 'pie' },
        title: { text: undefined },
        legend: {
            enabled: true,
            align: 'center',
            verticalAlign: 'bottom'
        },
        tooltip: { pointFormat: '<b>{point.y}</b> requests' },
        plotOptions: {
            pie: {
                innerSize: '60%',
                showInLegend: true, // <- show items in legend
                dataLabels: {
                    enabled: true,
                    format: '{point.name}: {point.y}',
                    // hide the label if its value is 0
                    filter: { property: 'y', operator: '>', value: 0 }
                }
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Leave Status',
                data: [
                    { name: 'Approved', y: leaveStatusCounts.Approved, color: '#52c41a' },
                    { name: 'Pending', y: leaveStatusCounts.Pending, color: '#faad14' },
                    { name: 'Rejected', y: leaveStatusCounts.Rejected, color: '#f5222d' }
                ]
            }
        ]
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            {/* Header (payroll mention removed) */}
            <MotionCard
                style={{ background: 'linear-gradient(90deg,#eef4ff, #f9fbff)' }}
            >
                <Row align='middle' justify='space-between'>
                    <Col>
                        <Title level={4} style={{ margin: 0 }}>
                            Human Resources Overview
                        </Title>
                        <Text type='secondary'>Employees overview, leave, and events.</Text>
                    </Col>
                    <Col>
                        <Space>
                            <Button
                                icon={<CalendarOutlined />}
                                onClick={() => setCalendarVisible(true)}
                            >
                                Open Calendar
                            </Button>
                            <Tooltip title='Refresh'>
                                <Button icon={<ReloadOutlined />} onClick={fetchAll} />
                            </Tooltip>
                        </Space>
                    </Col>
                </Row>
            </MotionCard>

            {/* HR KPIs */}
            <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Space>
                            <TeamOutlined />
                            <div>
                                <Text strong>Total Employees</Text>
                                <div>
                                    <Statistic
                                        value={totalEmployees}
                                        valueStyle={{ fontSize: 22 }}
                                    />
                                </div>
                            </div>
                        </Space>
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Space>
                            <CheckCircleOutlined />
                            <div>
                                <Text strong>Active Employees</Text>
                                <div>
                                    <Statistic
                                        value={activeEmployees}
                                        valueStyle={{ fontSize: 22 }}
                                    />
                                </div>
                            </div>
                        </Space>
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Space>
                            <FileTextOutlined />
                            <div>
                                <Text strong>Pending Leave</Text>
                                <div>
                                    <Statistic
                                        value={pendingLeave}
                                        valueStyle={{ fontSize: 22 }}
                                    />
                                </div>
                            </div>
                        </Space>
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Space>
                            <UserAddOutlined />
                            <div>
                                <Text strong>Open Roles</Text>
                                <div>
                                    <Statistic value={openRoles} valueStyle={{ fontSize: 22 }} />
                                </div>
                            </div>
                        </Space>
                    </MotionCard>
                </Col>
            </Row>

            {/* Donut replaces the old Payroll snapshot + Upcoming events */}
            <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                <Col xs={24} md={10}>
                    <MotionCard title='Leave Status Breakdown'>
                        {leaveRequests.length === 0 ? (
                            <Empty description='No leave data yet' />
                        ) : (
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={leaveDonutOptions}
                            />
                        )}
                    </MotionCard>
                </Col>

                <Col xs={24} md={14}>
                    <AppointmentsCard
                        departmentId={user?.departmentId}
                        pageSize={6}
                    />
                </Col>
            </Row>

            {/* Calendar Modal */}
            <EventsCalendarModal
                open={calendarVisible}
                onClose={() => setCalendarVisible(false)}
                events={events}
                onEventClick={ev => {
                    setSelectedEvent(ev as any)
                    setDetailsModalVisible(true)
                }}
            />

            {/* Event Details Modal */}
            <EventDetailsModal
                open={detailsModalVisible}
                onClose={() => setDetailsModalVisible(false)}
                event={selectedEvent as any}
            />

            {/* Create Event Modal */}
            <GlobalEventModal
                open={eventModalOpen}
                onCancel={() => setEventModalOpen(false)}
                form={eventForm}
                onSuccess={(newEvent: any) => setEvents(prev => [...prev, newEvent])}
            />
        </div>
    )
}

export default HRDashboard
