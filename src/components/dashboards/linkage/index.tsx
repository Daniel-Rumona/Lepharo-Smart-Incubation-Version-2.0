import { useEffect, useState } from 'react'
import { Col, Empty, Row, Space, message } from 'antd'
import { Helmet } from 'react-helmet'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { fetchAppointments } from '@/services/appointmentService'
import DepartmentInterventionsStatus from '../charts/InterventionsBreakdown'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import AppointmentsCalendarModal from '@/components/modals/AppointmentsCalender'
import AppointmentDetailsModal from '@/components/modals/AppointmentDetails'
import { loadInterventionMetrics, type InterventionMetricSummary } from '@/services/interventionMetricsService'
import InterventionMetricsGrid from '../metrics/InterventionMetricsGrid'

type DenormInterventionEntry = {
    departmentId?: string
}

type InterventionBuckets = {
    required?: DenormInterventionEntry[]
}

const MarketLinkagesDashboard = () => {
    const { user } = useFullIdentity() as any
    const { activeProgramId } = useActiveProgramId()
    const programId = activeProgramId || null
    const { nameOf } = useDepartmentRoles()
    const departmentId: string = user?.departmentId || ''

    const [appointments, setAppointments] = useState<any[]>([])
    const [calendarVisible, setCalendarVisible] = useState(false)
    const [selectedAppointment, setSelectedAppointment] = useState<any>(null)
    const [appointmentDetailsVisible, setAppointmentDetailsVisible] = useState(false)
    const [interventionMetrics, setInterventionMetrics] = useState<InterventionMetricSummary>({
        totalRequired: 0,
        assigned: 0,
        pendingAssignment: 0,
        inProgress: 0,
        completed: 0
    })

    const matchesDept = (entry: DenormInterventionEntry) => !departmentId || entry?.departmentId === departmentId

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
                    assignedFilters: departmentId ? { departmentId } : {},
                    assignedMatches: row => !departmentId || row.departmentId === departmentId,
                    requiredMatches: matchesDept
                })
                setInterventionMetrics(metrics)
            } catch (error) {
                console.error('Error fetching linkage dashboard metrics:', error)
                message.error('Failed to load linkage dashboard metrics.')
            }
        }

        fetchInterventionsMetrics()
    }, [programId, departmentId])

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>{`${nameOf(departmentId, 'Market Linkages')} Dashboard | Smart Incubation`}</title>
            </Helmet>

            <InterventionMetricsGrid metrics={interventionMetrics} />

            <Row gutter={[24, 24]} style={{ marginTop: 15 }}>
                <Col xs={24} xl={14}>
                    {programId ? (
                        <DepartmentInterventionsStatus
                            departmentId={departmentId}
                            programId={programId || undefined}
                            pageSize={6}
                        />
                    ) : (
                        <Empty description="No program selected." />
                    )}
                </Col>

                <Col xs={24} xl={10}>
                    <Space direction="vertical" size={24} style={{ width: '100%' }}>
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
