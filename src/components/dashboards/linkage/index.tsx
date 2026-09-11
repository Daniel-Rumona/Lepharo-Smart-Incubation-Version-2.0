import { useEffect, useMemo, useState } from 'react'
import { Button, Col, Empty, Progress, Row, Space, Spin, Tag, Typography, message } from 'antd'
import {
    ArrowRightOutlined,
    DollarOutlined,
    LinkOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { collection, getDocs } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { fetchAppointments } from '@/services/appointmentService'
import DepartmentInterventionsStatus from '../charts/InterventionsBreakdown'
import { MotionCard } from '../metrics/Header'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import AppointmentsCalendarModal from '@/components/modals/AppointmentsCalender'
import AppointmentDetailsModal from '@/components/modals/AppointmentDetails'
import { loadInterventionMetrics, type InterventionMetricSummary } from '@/services/interventionMetricsService'
import InterventionMetricsGrid from '../metrics/InterventionMetricsGrid'

const { Text } = Typography

type LinkageType = 'funding' | 'facilitation'

type LinkageRecord = {
    id: string
    type?: LinkageType
    status?: string
    value?: number
    quantity?: number
    programId?: string
}

type DenormInterventionEntry = {
    departmentId?: string
    departmentName?: string
    area?: string
    areaOfSupport?: string
}

type InterventionBuckets = {
    required?: DenormInterventionEntry[]
}

const LINKAGES_ROUTE = '/coordinator/interventions/Linkages'

const normaliseType = (value: unknown): LinkageType | undefined => {
    const type = String(value || '').toLowerCase()
    if (type === 'funding') return 'funding'
    if (type === 'facilitation') return 'facilitation'
    return undefined
}

const LinkagesParticipantsCard = ({ linkages, loading }: { linkages: LinkageRecord[]; loading: boolean }) => {
    const navigate = useNavigate()

    const totals = useMemo(() => {
        const funding = linkages.filter(row => normaliseType(row.type) === 'funding')
        const facilitation = linkages.filter(row => normaliseType(row.type) === 'facilitation')
        const totalValue = funding.reduce((sum, row) => sum + Number(row.value || 0), 0)
        const facilitationConnections = facilitation.reduce((sum, row) => sum + Number(row.quantity || 0), 0)

        return {
            total: linkages.length,
            funding: funding.length,
            facilitation: facilitation.length,
            totalValue,
            facilitationConnections
        }
    }, [linkages])

    const fundingPercent = totals.total ? Math.round((totals.funding / totals.total) * 100) : 0
    const facilitationPercent = totals.total ? Math.round((totals.facilitation / totals.total) * 100) : 0

    return (
        <MotionCard
            title={
                <Space>
                    <LinkOutlined />
                    <span>Linkages Distribution</span>
                </Space>
            }
            extra={
                <Button
                    variant="filled"
                    color="geekblue"
                    style={{ border: '1px solid dodgerblue' }}
                    shape="round"
                    icon={<ArrowRightOutlined />}
                    onClick={() => navigate(LINKAGES_ROUTE)}
                >
                    View All
                </Button>
            }
        >
            <Spin spinning={loading}>
                {totals.total > 0 ? (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            <Col xs={24} md={8}>
                                <MotionCard.Metric
                                    title="Total Linkages"
                                    value={totals.total}
                                    icon={<LinkOutlined style={{ color: '#1677ff' }} />}
                                    iconBg="rgba(22,119,255,.12)"
                                    wrapperStyle={{
                                        padding: 14,
                                        borderRadius: 8,
                                        border: '1px solid #e6efff',
                                        background: '#f8fbff'
                                    }}
                                />
                            </Col>

                            <Col xs={24} md={8}>
                                <MotionCard.Metric
                                    title="Funding"
                                    value={totals.funding}
                                    subtitle={`R ${totals.totalValue.toLocaleString()}`}
                                    icon={<DollarOutlined style={{ color: '#52c41a' }} />}
                                    iconBg="rgba(82,196,26,.14)"
                                    wrapperStyle={{
                                        padding: 14,
                                        borderRadius: 8,
                                        border: '1px solid #e6f4ea',
                                        background: '#fbfffb'
                                    }}
                                />
                            </Col>

                            <Col xs={24} md={8}>
                                <MotionCard.Metric
                                    title="Facilitation"
                                    value={totals.facilitation}
                                    subtitle={`${totals.facilitationConnections} connections`}
                                    icon={<TeamOutlined style={{ color: '#fa8c16' }} />}
                                    iconBg="rgba(250,140,22,.14)"
                                    wrapperStyle={{
                                        padding: 14,
                                        borderRadius: 8,
                                        border: '1px solid #ffe7ba',
                                        background: '#fffaf0'
                                    }}
                                />
                            </Col>
                        </Row>

                        <div
                            style={{
                                padding: 14,
                                borderRadius: 8,
                                border: '1px solid #f0f0f0',
                                background: '#fff'
                            }}
                        >
                            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                <Row justify="space-between" align="middle">
                                    <Col>
                                        <Text strong>Linkage Type Distribution</Text>
                                    </Col>
                                    <Col>
                                        <Tag color="blue">{totals.total} total</Tag>
                                    </Col>
                                </Row>

                                <div>
                                    <Row justify="space-between" style={{ marginBottom: 4 }}>
                                        <Col>
                                            <Text>Funding</Text>
                                        </Col>
                                        <Col>
                                            <Text strong>
                                                {totals.funding} / {totals.total}
                                            </Text>
                                        </Col>
                                    </Row>
                                    <Progress percent={fundingPercent} status="active" strokeColor="#52c41a" />
                                </div>

                                <div>
                                    <Row justify="space-between" style={{ marginBottom: 4 }}>
                                        <Col>
                                            <Text>Facilitation</Text>
                                        </Col>
                                        <Col>
                                            <Text strong>
                                                {totals.facilitation} / {totals.total}
                                            </Text>
                                        </Col>
                                    </Row>
                                    <Progress percent={facilitationPercent} strokeColor="#fa8c16" />
                                </div>
                            </Space>
                        </div>
                    </Space>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No linkage records found yet" />
                )}
            </Spin>
        </MotionCard>
    )
}

const MarketLinkagesDashboard = () => {
    const { user } = useFullIdentity() as any
    const { activeProgramId } = useActiveProgramId()
    const programId = activeProgramId || null
    const deptName = String(user?.departmentName || '').toLowerCase().trim()

    const [appointments, setAppointments] = useState<any[]>([])
    const [calendarVisible, setCalendarVisible] = useState(false)
    const [selectedAppointment, setSelectedAppointment] = useState<any>(null)
    const [appointmentDetailsVisible, setAppointmentDetailsVisible] = useState(false)
    const [linkages, setLinkages] = useState<LinkageRecord[]>([])
    const [linkagesLoading, setLinkagesLoading] = useState(false)
    const [interventionMetrics, setInterventionMetrics] = useState<InterventionMetricSummary>({
        totalRequired: 0,
        assigned: 0,
        pendingAssignment: 0,
        inProgress: 0,
        completed: 0
    })

    const matchesDept = (entry: DenormInterventionEntry) => {
        if (!deptName) return true
        if (user?.departmentId && entry?.departmentId === user.departmentId) return true
        const area = String(entry?.areaOfSupport || entry?.area || '').toLowerCase().trim()
        const department = String(entry?.departmentName || '').toLowerCase().trim()
        return area === deptName || department === deptName
    }

    useEffect(() => {
        const fetchDashboardAppointments = async () => {
            try {
                const rows = await fetchAppointments({
                    departmentId: user?.departmentId,
                    programId: activeProgramId
                })
                setAppointments(rows)
            } catch (error) {
                console.error('Error fetching appointments:', error)
                setAppointments([])
            }
        }

        fetchDashboardAppointments()
    }, [user?.departmentId, activeProgramId])

    useEffect(() => {
        const fetchLinkages = async () => {
            setLinkagesLoading(true)
            try {
                const snap = await getDocs(collection(db, 'linkages'))
                const rows = snap.docs.map(docSnap => ({
                    id: docSnap.id,
                    ...(docSnap.data() as Omit<LinkageRecord, 'id'>)
                }))

                setLinkages(
                    rows.filter(row => !programId || !row.programId || row.programId === programId)
                )
            } catch (error) {
                console.error('Error fetching linkages:', error)
                setLinkages([])
            } finally {
                setLinkagesLoading(false)
            }
        }

        fetchLinkages()
    }, [programId])

    useEffect(() => {
        if (!programId) {
            setInterventionMetrics({
                totalRequired: 0,
                assigned: 0,
                pendingAssignment: 0,
                inProgress: 0,
                completed: 0
            })
            return
        }

        const fetchInterventionsMetrics = async () => {
            try {
                const metrics = await loadInterventionMetrics({
                    programId,
                    assignedFilters: deptName ? { departmentId: user.departmentId } : {},
                    assignedMatches: row => !deptName ||
                        (user?.departmentId && row.departmentId === user.departmentId) ||
                        String(row.areaOfSupport || row.departmentName || '').toLowerCase().trim() === deptName,
                    requiredMatches: matchesDept
                })
                setInterventionMetrics(metrics)
            } catch (error) {
                console.error('Error fetching linkage dashboard metrics:', error)
                message.error('Failed to load linkage dashboard metrics.')
            }
        }

        fetchInterventionsMetrics()
    }, [programId, user?.departmentId, deptName])

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Market Linkages Dashboard | Smart Incubation</title>
            </Helmet>

            <InterventionMetricsGrid metrics={interventionMetrics} />

            <Row gutter={[24, 24]} style={{ marginTop: 15 }}>
                <Col xs={24} xl={14}>
                    {programId ? (
                        <DepartmentInterventionsStatus
                            departmentName={user?.departmentName}
                            programId={programId || undefined}
                            pageSize={6}
                        />
                    ) : (
                        <Empty description="No program selected." />
                    )}
                </Col>

                <Col xs={24} xl={10}>
                    <Space direction="vertical" size={24} style={{ width: '100%' }}>
                        <LinkagesParticipantsCard linkages={linkages} loading={linkagesLoading} />

                        <UpcomingAppointmentsCard
                            departmentId={user?.departmentId}
                            programId={activeProgramId}
                            appointments={appointments}
                            daysAhead={7}
                            limit={8}
                            onViewCalendar={() => setCalendarVisible(true)}
                        />
                    </Space>
                </Col>
            </Row>

            <AppointmentsCalendarModal
                open={calendarVisible}
                onClose={() => setCalendarVisible(false)}
                appointments={appointments}
                departmentId={user?.departmentId}
                onAppointmentClick={appointment => {
                    setSelectedAppointment(appointment)
                    setAppointmentDetailsVisible(true)
                }}
            />

            <AppointmentDetailsModal
                open={appointmentDetailsVisible}
                onClose={() => {
                    setAppointmentDetailsVisible(false)
                    setSelectedAppointment(null)
                }}
                appointment={selectedAppointment}
            />
        </div>
    )
}

export default MarketLinkagesDashboard
