import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Row,
    Col,
    Table,
    Tag,
    Progress,
    Space,
    Select,
    Button,
    Typography,
    Form,
    Empty,
    Tooltip
} from 'antd'
import {
    FileSearchOutlined,
    RiseOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    TeamOutlined,
    CalendarOutlined,
    ArrowRightOutlined,
    ScheduleOutlined,
    ExclamationCircleOutlined,
    ReloadOutlined
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs, { Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { motion } from 'framer-motion'
import { GlobalEventModal } from '@/components/modals/Events'
import EventsCalendarModal from '@/components/modals/EventsCalender'
import EventDetailsModal from '@/components/modals/EventDetails'

// Highcharts
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { DashboardHeaderCard, MotionCard } from '../metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { Helmet } from 'react-helmet'

const { Text, Title } = Typography
const { Option } = Select

const capitalize = (s?: string) =>
    s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

// ---- Types ----
interface AppDoc {
    id: string
    participantId?: string
    beneficiaryName?: string
    email?: string
    stage?: string
    applicationStatus?: string
    complianceScore?: number
    gapGroup?: 'A' | 'B' | 'C'
    graduationStatus?: string
}

interface ParticipantDoc {
    id: string
    beneficiaryName?: string
    email?: string
    stage?: string
}

interface EventItem {
    id: string
    title: string
    date: string // YYYY-MM-DD
    startTime?: string // HH:mm
    endTime?: string // HH:mm
    type?: 'meeting' | 'deadline' | 'event' | 'workshop' | string
    format?: 'virtual' | 'in-person' | string
    location?: string
    link?: string
    description?: string
    participants?: Array<{
        id?: string
        email?: string
        type?: string
        confirmationStatus?: string
    }>
    time?: Dayjs
}

const ROMDashboard: React.FC = () => {
    const [applications, setApplications] = useState<AppDoc[]>([])
    const [participants, setParticipants] = useState<ParticipantDoc[]>([])
    const [events, setEvents] = useState<EventItem[]>([])
    const [filteredEvents, setFilteredEvents] = useState<EventItem[]>([])
    const [loading, setLoading] = useState(true)
    const [calendarVisible, setCalendarVisible] = useState(false)
    const [eventModalOpen, setEventModalOpen] = useState(false)
    const [eventForm] = Form.useForm()
    const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null)
    const [detailsModalVisible, setDetailsModalVisible] = useState(false)

    // filters UI
    const [filterType, setFilterType] = useState<string | null>(null)
    const [filterDate, setFilterDate] = useState<Dayjs | null>(null)

    const navigate = useNavigate()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()

    const fetchData = async (programId: string) => {
        if (!programId) return
        setLoading(true)

        // applications (programId)
        const appsSnap = await getDocs(
            query(
                collection(db, 'applications'),
                where('programId', '==', programId)
            )
        )

        const apps = appsSnap.docs.map(d => {
            const data = d.data() as any
            return {
                id: d.id,
                ...data,
                gapGroup: (data.gapGroup || 'N/A') as 'A' | 'B' | 'C',
                complianceScore: data.complianceScore ?? null
            }
        }) as AppDoc[]

        setApplications(apps)

        const acceptedParticipantIds = new Set(apps.map(a => a.participantId))

        // participants - only those linked to accepted applications
        const partsSnap = await getDocs(query(collection(db, 'participants')))
        const enriched = partsSnap.docs
            .filter(d => acceptedParticipantIds.has(d.id))
            .map(d => {
                const data = d.data() as any
                return {
                    id: d.id,
                    beneficiaryName: data.beneficiaryName,
                    email: data.email,
                    stage: data.stage ?? null
                } as ParticipantDoc
            })
        setParticipants(enriched)

        // events (programId)
        const evSnap = await getDocs(
            query(
                collection(db, 'events'),
                where('programId', '==', programId)
            )
        )
        const list = evSnap.docs.map(d => {
            const data = d.data() as any
            const full = `${data.date}T${data.startTime || '00:00'}`
            return {
                id: d.id,
                ...data,
                time: dayjs(full),
                date: data.date
            } as EventItem
        })

        setEvents(list)
        setFilteredEvents(list)
        setLoading(false)
    }

    // Refetch wheneveractiveProgramId changes
    useEffect(() => {
        if (!activeProgramId) return
        fetchData(activeProgramId)
    }, [activeProgramId])

    useEffect(() => {
        let filtered = [...events]
        if (filterType) filtered = filtered.filter(e => e.type === filterType)
        if (filterDate)
            filtered = filtered.filter(e => dayjs(e.date).isSame(filterDate, 'day'))
        setFilteredEvents(filtered)
    }, [filterType, filterDate, events])

    const getEventIcon = (type?: string) => {
        switch (type) {
            case 'meeting':
                return <ScheduleOutlined style={{ color: '#1677ff' }} />
            case 'deadline':
                return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
            case 'event':
                return <CalendarOutlined style={{ color: '#52c41a' }} />
            case 'workshop':
                return <FileSearchOutlined style={{ color: '#722ed1' }} />
            default:
                return <CalendarOutlined style={{ color: '#1677ff' }} />
        }
    }

    // ---- KPIs ----

    const validApplications = applications.filter(
        a => !(a.email || '').toLowerCase().endsWith('@quantilytix.co.za')
    )

    const pendingApplications = validApplications.filter(
        a => a.applicationStatus === 'pending'
    ).length
    const totalParticipants = validApplications.filter(
        a => a.applicationStatus?.toLowerCase() === 'accepted'
    ).length
    const dropouts = validApplications.filter(
        a => a.applicationStatus?.toLowerCase() === 'withdrawn'
    ).length
    const graduated = validApplications.filter(
        a => (a.graduationStatus || '').toLowerCase() === 'graduated'
    ).length

    const attritionRate = totalParticipants
        ? Math.round((dropouts / totalParticipants) * 100)
        : 0
    const graduationRate = totalParticipants
        ? Math.round((graduated / totalParticipants) * 100)
        : 0

    const groupCounts = useMemo(() => {
        const counts: Record<'A' | 'B' | 'C', number> = { A: 0, B: 0, C: 0 }
        applications.forEach(app => {
            if (app.gapGroup && counts[app.gapGroup] !== undefined) {
                counts[app.gapGroup] += 1
            }
        })
        return counts
    }, [applications])

    // ---- Highcharts Donut for Group Distribution ----
    const groupTotal = groupCounts.A + groupCounts.B + groupCounts.C
    const data = [
        { name: 'Group A', y: groupCounts.A, color: '#ff4d4f' },
        { name: 'Group B', y: groupCounts.B, color: '#faad14' },
        { name: 'Group C', y: groupCounts.C, color: '#52c41a' }
    ].filter(p => p.y > 0)

    const groupChartOptions: Highcharts.Options = {
        chart: { type: 'pie', height: 300, backgroundColor: 'transparent' },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: true, align: 'center', verticalAlign: 'bottom' },
        tooltip: {
            pointFormat:
                '<b>{point.name}: {point.y}</b> participants ({point.percentage:.0f}%)'
        },
        plotOptions: {
            pie: {
                innerSize: '60%',
                allowPointSelect: true,
                cursor: 'pointer',
                showInLegend: true,
                dataLabels: {
                    enabled: true,
                    format: '{point.name}: {point.y} ({point.percentage:.0f}%)',
                    color: '#000',
                    style: { fontWeight: 'bold', textOutline: 'none' },
                    filter: { property: 'y', operator: '>', value: 0 }
                }
            }
        },
        series: [{ type: 'pie', name: 'Participants', data }]
    }

    // ---- Table Columns ----
    const groupColumns = [
        {
            title: 'Beneficiary Name',
            dataIndex: 'beneficiaryName',
            key: 'beneficiaryName'
        },
        {
            title: 'Stage',
            dataIndex: 'stage',
            key: 'stage',
            render: (s: string) => <Tag>{s || '—'}</Tag>
        },
        {
            title: 'Group',
            dataIndex: 'gapGroup',
            key: 'gapGroup',
            render: (g: 'A' | 'B' | 'C') => (
                <Tag color={g === 'A' ? 'red' : g === 'B' ? 'gold' : 'green'}>{g}</Tag>
            )
        },
        {
            title: 'Compliance Score',
            dataIndex: 'complianceScore',
            key: 'complianceScore',
            render: (score: number) => <Progress percent={score || 0} size='small' />
        }
    ]

    const latestPendingApps = validApplications
        .filter(a => a.applicationStatus === 'pending')
        .slice(0, 5)

    const applicationColumns = [
        { title: 'Company', dataIndex: 'beneficiaryName', key: 'beneficiaryName' },
        { title: 'Email', dataIndex: 'email', key: 'email' },
        { title: 'Stage', dataIndex: 'stage', key: 'stage' },
        {
            title: 'Status',
            dataIndex: 'applicationStatus',
            key: 'applicationStatus',
            render: (status: string) => <Tag color='orange'>{capitalize(status)}</Tag>
        }
    ]

    const upcomingNext7 = useMemo(() => {
        const start = dayjs().startOf('day')
        const end = dayjs().add(7, 'day').endOf('day')

        return events
            .map(e => {
                const t = e.time || dayjs(`${e.date}T${e.startTime || '00:00'}`)
                return { ...e, _t: t }
            })
            .filter(e => e._t.isAfter(start) && e._t.isBefore(end))
            .sort((a, b) => a._t.valueOf() - b._t.valueOf())
    }, [events])

    const upcomingCols = [
        {
            title: 'Date',
            dataIndex: 'date',
            render: (_: any, r: any) => r._t.format('YYYY-MM-DD'),
            width: 110
        },
        {
            title: 'Time',
            key: 'time',
            render: (_: any, r: any) =>
                [r.startTime, r.endTime].filter(Boolean).join(' – ') ||
                r._t.format('HH:mm'),
            width: 110
        },
        {
            title: 'Title',
            dataIndex: 'title',
            render: (text: string, r: any) => (
                <Space>
                    {getEventIcon(r.type)}
                    <span>{text}</span>
                </Space>
            )
        },
        {
            title: 'Type',
            dataIndex: 'type',
            width: 120,
            render: (t: string) => (
                <Tag
                    color={
                        t === 'deadline'
                            ? 'red'
                            : t === 'meeting'
                                ? 'blue'
                                : t === 'workshop'
                                    ? 'purple'
                                    : 'green'
                    }
                >
                    {t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Event'}
                </Tag>
            )
        },
        {
            title: 'Location',
            dataIndex: 'location',
            ellipsis: true,
            render: (v: string, r: any) => v || r.format || '—',
            width: 160
        }
    ]

    const participantTableData = useMemo(() => {
        return applications
            .map(app => {
                const participant = participants.find(p => p.id === app.participantId)

                const email = participant?.email || app.email

                return {
                    key: app.id,
                    id: app.id,
                    beneficiaryName: participant?.beneficiaryName || app.beneficiaryName,
                    email,
                    stage: participant?.stage || app.stage,
                    gapGroup: app.gapGroup,
                    complianceScore: app.complianceScore
                }
            })
            .filter(row => {
                const email = row.email?.toLowerCase() || ''
                return !email.endsWith('@quantilytix.co.za')
            })
    }, [applications, participants])

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>ROM Dashboard | Smart Incubation</title>
            </Helmet>
            {/* Header */}
            <DashboardHeaderCard
                title='Recruitment, Onboarding and Maintainance Overview'
                subtitle='Stay on top of participants, interventions and events.'
                extraRight={
                    <Space>
                        <Button
                            icon={<CalendarOutlined />}
                            onClick={() => setCalendarVisible(true)}
                        >
                            Open Calendar
                        </Button>
                        <Tooltip title='Refresh'>
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={() => {
                                    if (activeProgramId) {
                                        fetchData(activeProgramId)
                                    }
                                }}
                                disabled={!activeProgramId}
                            />
                        </Tooltip>
                    </Space>
                }
            />

            {/* KPI Cards */}
            <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                marginBottom: 12
                            }}
                        >
                            <div
                                style={{
                                    background: '#fffbe6',
                                    padding: 8,
                                    borderRadius: '50%',
                                    marginRight: 12,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                            >
                                <ClockCircleOutlined
                                    style={{ fontSize: 18, color: '#faad14' }}
                                />
                            </div>
                            <Text strong>Pending Applications</Text>
                        </div>
                        <Title level={3} style={{ margin: 0, color: '#faad14' }}>
                            {pendingApplications}
                        </Title>
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                marginBottom: 12
                            }}
                        >
                            <div
                                style={{
                                    background: '#fff2f0',
                                    padding: 8,
                                    borderRadius: '50%',
                                    marginRight: 12,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                            >
                                <RiseOutlined style={{ fontSize: 18, color: '#ff4d4f' }} />
                            </div>
                            <Text strong>Attrition Rate</Text>
                        </div>
                        <Title level={3} style={{ margin: 0, color: '#ff4d4f' }}>
                            {attritionRate}%
                        </Title>
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                marginBottom: 12
                            }}
                        >
                            <div
                                style={{
                                    background: '#f6ffed',
                                    padding: 8,
                                    borderRadius: '50%',
                                    marginRight: 12,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                            >
                                <CheckCircleOutlined
                                    style={{ fontSize: 18, color: '#52c41a' }}
                                />
                            </div>
                            <Text strong>Graduation Rate</Text>
                        </div>
                        <Title level={3} style={{ margin: 0, color: '#52c41a' }}>
                            {graduationRate}%
                        </Title>
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                marginBottom: 12
                            }}
                        >
                            <div
                                style={{
                                    background: '#e6f7ff',
                                    padding: 8,
                                    borderRadius: '50%',
                                    marginRight: 12,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                            >
                                <TeamOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                            </div>
                            <Text strong>Active Participants</Text>
                        </div>
                        <Title level={3} style={{ margin: 0, color: '#1677ff' }}>
                            {Math.max(totalParticipants - dropouts, 0)}
                        </Title>
                    </MotionCard>
                </Col>
            </Row>

            <Row gutter={16} style={{ marginTop: 16 }}>
                {/* Left column */}
                <Col span={14}>
                    <MotionCard
                        title='Group Movement Overview'
                        extra={
                            <Button
                                type='link'
                                onClick={() => navigate('/operations/participants')}
                            >
                                View All <ArrowRightOutlined />
                            </Button>
                        }
                    >
                        <Table
                            dataSource={participantTableData}
                            columns={groupColumns as any}
                            loading={loading}
                            pagination={{ pageSize: 5, showSizeChanger: false }}
                        />
                    </MotionCard>

                    <MotionCard
                        title='Pending Applications'
                        style={{ marginTop: 16 }}
                        extra={
                            <Button type='link' onClick={() => navigate('/applications')}>
                                View All <ArrowRightOutlined />
                            </Button>
                        }
                    >
                        <Table
                            dataSource={latestPendingApps.map((a, index) => ({
                                ...a,
                                key: index
                            }))}
                            columns={applicationColumns as any}
                            pagination={false}
                            size='small'
                            loading={loading}
                        />
                    </MotionCard>
                </Col>

                {/* Right column */}
                <Col span={10}>
                    <MotionCard title='Group Distribution'>
                        {groupTotal === 0 ? (
                            <Empty description='No participants yet' />
                        ) : (
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={groupChartOptions}
                            />
                        )}
                    </MotionCard>
                    <MotionCard
                        title='Upcoming Events (Next 7 Days)'
                        extra={
                            <Button type='link' onClick={() => setCalendarVisible(true)}>
                                View All <ArrowRightOutlined />
                            </Button>
                        }
                        style={{ marginTop: 16 }}
                    >
                        {upcomingNext7.length === 0 ? (
                            <Empty description='No events in the next 7 days' />
                        ) : (
                            <Table
                                rowKey='id'
                                size='small'
                                dataSource={upcomingNext7}
                                columns={upcomingCols as any}
                                pagination={{ pageSize: 5 }}
                                onRow={record => ({
                                    onClick: () => {
                                        setSelectedEvent(record as any)
                                        setDetailsModalVisible(true)
                                    }
                                })}
                            />
                        )}
                    </MotionCard>
                </Col>
            </Row>

        </div>
    )
}

export default ROMDashboard
