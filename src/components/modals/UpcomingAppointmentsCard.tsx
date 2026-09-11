// import React from 'react'
// import {
//     Button,
//     Card,
//     Empty,
//     Form,
//     Space,
//     Skeleton,
//     Table,
//     Tag,
//     Typography
// } from 'antd'
// import {
//     ArrowRightOutlined,
//     CalendarOutlined,
//     CheckCircleOutlined,
//     ClockCircleOutlined,
//     EnvironmentOutlined,
//     PhoneOutlined,
//     PlusOutlined,
//     UserOutlined,
//     VideoCameraOutlined
// } from '@ant-design/icons'
// import dayjs from 'dayjs'
// import isBetween from 'dayjs/plugin/isBetween'
// import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
// import AppointmentDetailsModal from './AppointmentDetails'
// import { GlobalEventModal } from '@/components/modals/Events'
// import {
//     fetchAppointments,
//     formatAppointmentTime,
//     getAppointmentDate,
//     getAppointmentStatus,
//     getAppointmentMembers,
//     getConfirmationStatus,
//     getAppointmentTitle,
//     getDeliveryMethod,
//     groupAppointments,
//     resolveAppointmentStart,
//     type AppointmentRecord
// } from '@/services/appointmentService'

// dayjs.extend(isBetween)

// export type UpcomingAppointment = AppointmentRecord & {
//     id: string
//     interventionTitle?: string
//     title?: string
//     consultantName?: string
//     participantName?: string
//     deliveryMethod?: string
//     date?: string
//     startTime?: any
//     endTime?: any
//     start?: any
//     end?: any
//     status?: string
//     departmentId?: string
//     departmentName?: string
//     programId?: string
//     [key: string]: any
// }

// type Props = {
//     departmentId?: string | null
//     departmentIds?: string[]
//     programId?: string | null
//     appointments?: UpcomingAppointment[]
//     title?: React.ReactNode
//     daysAhead?: number | null
//     limit?: number | null
//     onViewCalendar?: () => void
//     onAppointmentClick?: (appointment: UpcomingAppointment) => void

//     /**
//      * Controls whether the Add Event action is shown.
//      * Defaults to false.
//      */
//     showAddEvent?: boolean

//     /** Called after GlobalEventModal successfully creates an event. */
//     onEventCreated?: (event?: any) => void
// }

// const { Text } = Typography

// const methodTag = (method?: string) => {
//     if (method === 'virtual') {
//         return (
//             <Tag color='blue' icon={<VideoCameraOutlined />}>
//                 Online
//             </Tag>
//         )
//     }

//     if (method === 'in_person') {
//         return (
//             <Tag color='green' icon={<EnvironmentOutlined />}>
//                 In Person
//             </Tag>
//         )
//     }

//     if (method === 'telephonically') {
//         return (
//             <Tag color='orange' icon={<PhoneOutlined />}>
//                 Telephonic
//             </Tag>
//         )
//     }

//     return <Tag>{method || 'Appointment'}</Tag>
// }

// const statusTag = (status?: string) => {
//     const value = String(status || 'scheduled').toLowerCase()

//     if (value === 'completed') return <Tag color='green'>Completed</Tag>
//     if (value === 'cancelled') return <Tag color='red'>Cancelled</Tag>
//     if (value === 'scheduled') return <Tag color='blue'>Scheduled</Tag>

//     return <Tag>{status || 'Scheduled'}</Tag>
// }

// const hasSmeTimeProposal = (appointment: UpcomingAppointment) =>
//     appointment?.smeRescheduleRequest?.status === 'proposed' &&
//     Array.isArray(appointment?.smeRescheduleRequest?.proposals) &&
//     appointment.smeRescheduleRequest.proposals.length > 0

// const getSmeResponse = (appointment: UpcomingAppointment) => {
//     if (hasSmeTimeProposal(appointment)) return 'New time proposed'
//     const statuses = getAppointmentMembers(appointment as any).map(member =>
//         getConfirmationStatus(member.userConfirmation || member.beneficiaryConfirmation || member.confirmationStatus)
//     )
//     if (statuses.some(status => status === 'declined')) return 'Declined'
//     if (statuses.length && statuses.every(status => status === 'confirmed')) return 'Confirmed'
//     if (statuses.some(status => status === 'confirmed')) return 'Partially confirmed'
//     if (statuses.some(status => status === 'pending')) return 'Pending response'
//     return 'No response'
// }


// const getGroupedResponseCounts = (appointment: UpcomingAppointment) => {
//     const members = getAppointmentMembers(appointment as any)

//     const counts = {
//         confirmed: 0,
//         declined: 0,
//         pending: 0
//     }

//     members.forEach(member => {
//         const status = getConfirmationStatus(
//             member.userConfirmation ||
//             member.beneficiaryConfirmation ||
//             member.confirmationStatus
//         )

//         if (status === 'confirmed') counts.confirmed += 1
//         else if (status === 'declined') counts.declined += 1
//         else counts.pending += 1
//     })

//     return {
//         memberCount: members.length,
//         ...counts
//     }
// }

// const isGroupedAppointment = (appointment: UpcomingAppointment) => {
//     const responseCounts = getGroupedResponseCounts(appointment)

//     return (
//         responseCounts.memberCount > 1 ||
//         Boolean(
//             appointment?.groupId ||
//             appointment?.appointmentGroupId ||
//             appointment?.isGroup ||
//             appointment?.isGrouped
//         )
//     )
// }

// const UpcomingAppointmentsCard: React.FC<Props> = ({
//     departmentId,
//     departmentIds,
//     programId,
//     appointments: providedAppointments,
//     title = (
//         <Space>
//             <CalendarOutlined />
//             <span>Upcoming Week</span>
//         </Space>
//     ),
//     daysAhead = 7,
//     limit = 6,
//     onViewCalendar,
//     onAppointmentClick,
//     showAddEvent = false,
//     onEventCreated
// }) => {
//     const [eventForm] = Form.useForm()

//     const [loading, setLoading] = React.useState(false)
//     const [appointments, setAppointments] = React.useState<UpcomingAppointment[]>([])
//     const [selectedAppointment, setSelectedAppointment] =
//         React.useState<UpcomingAppointment | null>(null)
//     const [eventModalOpen, setEventModalOpen] = React.useState(false)

//     const stats = React.useMemo(() => {
//         const isStatus = (row: UpcomingAppointment, status: string) =>
//             getAppointmentStatus(row) === status

//         return {
//             total: appointments.length,
//             completed: appointments.filter(row => isStatus(row, 'completed')).length,
//             scheduled: appointments.filter(row => isStatus(row, 'scheduled')).length,
//         }
//     }, [appointments])

//     const breakdown: DashboardMetric[] = [
//         {
//             title: 'Total',
//             value: stats.total,
//             icon: <CalendarOutlined style={{ color: '#1677ff' }} />
//         },
//         {
//             title: 'Completed',
//             value: stats.completed,
//             icon: <CheckCircleOutlined style={{ color: '#16a34a' }} />
//         },
//         {
//             title: 'Scheduled',
//             value: stats.scheduled,
//             icon: <ClockCircleOutlined style={{ color: '#d97706' }} />
//         },
//     ]

//     React.useEffect(() => {
//         const run = async () => {
//             setLoading(true)

//             try {
//                 const sourceRows =
//                     providedAppointments ||
//                     (await fetchAppointments({
//                         departmentId,
//                         departmentIds,
//                         programId
//                     }))

//                 const rows = groupAppointments(sourceRows) as UpcomingAppointment[]

//                 const now = dayjs()
//                 const to = daysAhead === null ? null : now.add(daysAhead, 'day')

//                 const allUpcoming = rows
//                     .map(row => ({
//                         ...row,
//                         _start: resolveAppointmentStart(row).date
//                     }))
//                     .filter(row => {
//                         if (!row._start?.isValid()) return false

//                         const isTodayOrLater =
//                             row._start.isSame(now, 'day') ||
//                             row._start.isAfter(now, 'day')

//                         if (!isTodayOrLater) return false
//                         if (!to) return true

//                         return (
//                             row._start.isSame(to, 'day') ||
//                             row._start.isBefore(to, 'day')
//                         )
//                     })
//                     .sort(
//                         (a, b) =>
//                             (a._start?.valueOf() || 0) -
//                             (b._start?.valueOf() || 0)
//                     )

//                 setAppointments(
//                     limit === null ? allUpcoming : allUpcoming.slice(0, limit)
//                 )
//             } catch (err) {
//                 console.error('Error loading appointments', err)
//                 setAppointments([])
//             } finally {
//                 setLoading(false)
//             }
//         }

//         run()
//     }, [
//         departmentId,
//         departmentIds,
//         programId,
//         providedAppointments,
//         daysAhead,
//         limit
//     ])

//     const handleEventCreated = (event?: any) => {
//         setEventModalOpen(false)
//         onEventCreated?.(event)
//     }

//     const cardExtra =
//         showAddEvent || onViewCalendar ? (
//             <Space wrap>
//                 {showAddEvent && (
//                     <Button
//                         type='primary'
//                         icon={<PlusOutlined />}
//                         onClick={() => setEventModalOpen(true)}
//                     >
//                         Add Event
//                     </Button>
//                 )}

//                 {onViewCalendar && (
//                     <Button icon={<ArrowRightOutlined />} shape='round' onClick={onViewCalendar}>
//                         View Calendar
//                     </Button>
//                 )}
//             </Space>
//         ) : null

//     return (
//         <>
//             <Card
//                 style={{
//                     width: '100%',
//                     maxWidth: '100%',
//                     minWidth: 0,
//                     overflow: 'hidden',
//                     boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
//                     transition: 'all 0.3s ease',
//                     borderRadius: 8,
//                     border: '1px solid #d6e4ff'
//                 }}
//                 title={title}
//                 extra={cardExtra}
//             >
//                 {loading ? (
//                     <Space
//                         direction='vertical'
//                         size={16}
//                         style={{ width: '100%' }}
//                     >
//                         <div
//                             style={{
//                                 display: 'grid',
//                                 gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
//                                 gap: 12
//                             }}
//                         >
//                             {Array.from({ length: 3 }).map((_, index) => (
//                                 <div
//                                     key={index}
//                                     style={{
//                                         border: '1px solid #f0f0f0',
//                                         borderRadius: 10,
//                                         padding: '10px 12px'
//                                     }}
//                                 >
//                                     <Skeleton
//                                         active
//                                         title={false}
//                                         paragraph={{
//                                             rows: 2,
//                                             width: ['65%', '35%']
//                                         }}
//                                     />
//                                 </div>
//                             ))}
//                         </div>

//                         <Skeleton
//                             active
//                             title={false}
//                             paragraph={{
//                                 rows: 5,
//                                 width: ['100%', '100%', '100%', '100%', '75%']
//                             }}
//                         />
//                     </Space>
//                 ) : appointments.length === 0 ? (
//                     <Empty
//                         image={Empty.PRESENTED_IMAGE_SIMPLE}
//                         description='No appointments in this period.'
//                     />
//                 ) : (
//                     <Space
//                         direction='vertical'
//                         size={16}
//                         style={{ width: '100%' }}
//                     >
//                         <MetricsGrid metrics={breakdown} desktopSpan={8} />

//                         <div
//                             style={{
//                                 width: '100%',
//                                 maxWidth: '100%',
//                                 minWidth: 0,
//                                 overflow: 'hidden'
//                             }}
//                         >
//                             <Table
//                                 rowKey='id'
//                                 size='small'
//                                 dataSource={appointments}
//                                 style={{
//                                     width: '100%',
//                                     maxWidth: '100%'
//                                 }}
//                                 scroll={{
//                                     x: 820
//                                 }}
//                                 onRow={row => ({
//                                     onClick: () => {
//                                         if (onAppointmentClick) {
//                                             onAppointmentClick(row)
//                                         } else {
//                                             setSelectedAppointment(row)
//                                         }
//                                     },
//                                     style: { cursor: 'pointer' }
//                                 })}
//                                 pagination={{
//                                     pageSize: 4,
//                                     showSizeChanger: false,
//                                     position: ['bottomCenter']
//                                 }}
//                                 columns={[
//                                     {
//                                         title: 'Date & time',
//                                         key: 'dateTime',
//                                         width: 112,
//                                         render: (
//                                             _: any,
//                                             row: UpcomingAppointment
//                                         ) => (
//                                             <Space direction='vertical' size={0}>
//                                                 <Text
//                                                     style={{
//                                                         whiteSpace: 'nowrap'
//                                                     }}
//                                                 >
//                                                     {getAppointmentDate(row)?.format(
//                                                         'DD MMM YYYY'
//                                                     ) ||
//                                                         row.date ||
//                                                         '-'}
//                                                 </Text>

//                                                 <Text
//                                                     type='secondary'
//                                                     style={{
//                                                         whiteSpace: 'nowrap'
//                                                     }}
//                                                 >
//                                                     {formatAppointmentTime(row)}
//                                                 </Text>
//                                             </Space>
//                                         )
//                                     },
//                                     {
//                                         title: 'Appointment',
//                                         key: 'appointment',
//                                         width: 175,
//                                         render: (
//                                             _: any,
//                                             row: UpcomingAppointment
//                                         ) => {
//                                             const appointmentTitle =
//                                                 getAppointmentTitle(row)

//                                             const responseCounts =
//                                                 getGroupedResponseCounts(row)

//                                             const grouped =
//                                                 isGroupedAppointment(row)

//                                             const participantName = grouped
//                                                 ? `${responseCounts.memberCount} participants`
//                                                 : row.participantName || 'Participant'

//                                             return (
//                                                 <Space
//                                                     direction='vertical'
//                                                     size={2}
//                                                     style={{
//                                                         width: '100%',
//                                                         minWidth: 0
//                                                     }}
//                                                 >
//                                                     <Text
//                                                         strong
//                                                         ellipsis={{
//                                                             tooltip: appointmentTitle
//                                                         }}
//                                                         style={{
//                                                             display: 'block',
//                                                             maxWidth: '100%'
//                                                         }}
//                                                     >
//                                                         {appointmentTitle}
//                                                     </Text>

//                                                     <Text
//                                                         type='secondary'
//                                                         ellipsis={{
//                                                             tooltip: participantName
//                                                         }}
//                                                         style={{
//                                                             display: 'block',
//                                                             maxWidth: '100%'
//                                                         }}
//                                                     >
//                                                         <UserOutlined />{' '}
//                                                         {participantName}
//                                                     </Text>
//                                                 </Space>
//                                             )
//                                         }
//                                     },
//                                     {
//                                         title: 'Method',
//                                         dataIndex: 'deliveryMethod',
//                                         width: 110,
//                                         render: (
//                                             _: any,
//                                             row: UpcomingAppointment
//                                         ) => methodTag(getDeliveryMethod(row))
//                                     },
//                                     {
//                                         title: 'Status',
//                                         dataIndex: 'status',
//                                         width: 105,
//                                         render: (
//                                             _: any,
//                                             row: UpcomingAppointment
//                                         ) =>
//                                             statusTag(getAppointmentStatus(row))
//                                     },
//                                     {
//                                         title: 'SME response',
//                                         key: 'response',
//                                         width: 230,
//                                         render: (
//                                             _: any,
//                                             row: UpcomingAppointment
//                                         ) => {
//                                             const grouped =
//                                                 isGroupedAppointment(row)

//                                             if (grouped) {
//                                                 const counts =
//                                                     getGroupedResponseCounts(row)

//                                                 return (
//                                                     <Space size={[4, 4]} wrap>
//                                                         {counts.confirmed > 0 ? (
//                                                             <Tag color='green'>
//                                                                 Confirmed: {counts.confirmed}
//                                                             </Tag>
//                                                         ) : null}

//                                                         {counts.declined > 0 ? (
//                                                             <Tag color='red'>
//                                                                 Declined: {counts.declined}
//                                                             </Tag>
//                                                         ) : null}

//                                                         {counts.pending > 0 ? (
//                                                             <Tag color='gold'>
//                                                                 Pending: {counts.pending}
//                                                             </Tag>
//                                                         ) : null}
//                                                     </Space>
//                                                 )
//                                             }

//                                             const response = getSmeResponse(row)

//                                             if (hasSmeTimeProposal(row)) {
//                                                 return (
//                                                     <Tag color='orange'>
//                                                         New time proposed
//                                                     </Tag>
//                                                 )
//                                             }

//                                             if (response === 'Declined') {
//                                                 return <Tag color='red'>Declined</Tag>
//                                             }

//                                             if (response === 'Confirmed') {
//                                                 return (
//                                                     <Tag color='green'>Confirmed</Tag>
//                                                 )
//                                             }

//                                             if (response === 'Partially confirmed') {
//                                                 return (
//                                                     <Tag color='blue'>
//                                                         Partially confirmed
//                                                     </Tag>
//                                                 )
//                                             }

//                                             return (
//                                                 <Tag color='gold'>
//                                                     {response}
//                                                 </Tag>
//                                             )
//                                         }
//                                     },
//                                     {
//                                         title: '',
//                                         key: 'view',
//                                         width: 72,
//                                         render: (
//                                             _: any,
//                                             row: UpcomingAppointment
//                                         ) => (
//                                             <Button
//                                                 size='small'
//                                                 shape='round'
//                                                 variant='outlined'
//                                                 style={{ border: '1px solid dodgerblue' }}
//                                                 onClick={event => {
//                                                     event.stopPropagation()

//                                                     if (onAppointmentClick) {
//                                                         onAppointmentClick(row)
//                                                     } else {
//                                                         setSelectedAppointment(row)
//                                                     }
//                                                 }}
//                                             >
//                                                 View
//                                             </Button>
//                                         )
//                                     }
//                                 ]}
//                             />
//                         </div>
//                     </Space>
//                 )}

//                 <AppointmentDetailsModal
//                     open={Boolean(selectedAppointment)}
//                     appointment={selectedAppointment}
//                     onClose={() => setSelectedAppointment(null)}
//                 />
//             </Card>

//             {showAddEvent && (
//                 <GlobalEventModal
//                     open={eventModalOpen}
//                     form={eventForm}
//                     onCancel={() => setEventModalOpen(false)}
//                     onSuccess={handleEventCreated}
//                 />
//             )}
//         </>
//     )
// }

// export default UpcomingAppointmentsCard
import React from 'react'
import {
    Button,
    Card,
    Empty,
    Form,
    Grid,
    Skeleton,
    Space,
    Table,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    ArrowRightOutlined,
    CalendarOutlined,
    EnvironmentOutlined,
    PhoneOutlined,
    PlusOutlined,
    UserOutlined,
    VideoCameraOutlined
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { GlobalEventModal } from '@/components/modals/Events'
import AppointmentDetailsModal from './AppointmentDetails'
import {
    fetchAppointments,
    formatAppointmentTime,
    getAppointmentDate,
    getAppointmentStatus,
    getAppointmentMembers,
    getConfirmationStatus,
    getAppointmentTitle,
    getDeliveryMethod,
    groupAppointments,
    resolveAppointmentStart,
    type AppointmentRecord
} from '@/services/appointmentService'

export type UpcomingAppointment = AppointmentRecord & {
    id: string
    interventionTitle?: string
    title?: string
    consultantName?: string
    participantName?: string
    deliveryMethod?: string
    date?: string
    startTime?: any
    endTime?: any
    start?: any
    end?: any
    status?: string
    departmentId?: string
    departmentName?: string
    programId?: string
    location?: string
    meetingLink?: string
    [key: string]: any
}

type Props = {
    departmentId?: string | null
    departmentIds?: string[]
    programId?: string | null
    appointments?: UpcomingAppointment[]
    title?: React.ReactNode
    daysAhead?: number | null
    limit?: number | null
    onViewCalendar?: () => void
    onAppointmentClick?: (appointment: UpcomingAppointment) => void
    showAddEvent?: boolean
    onEventCreated?: (event?: any) => void
}

const { Text } = Typography
const { useBreakpoint } = Grid

const methodLabel = (method?: string) => {
    if (method === 'virtual') return 'Online'
    if (method === 'in_person') return 'In person'
    if (method === 'telephonically') return 'Telephonic'
    return method || 'Appointment'
}

const methodIcon = (method?: string) => {
    if (method === 'virtual') return <VideoCameraOutlined />
    if (method === 'in_person') return <EnvironmentOutlined />
    if (method === 'telephonically') return <PhoneOutlined />
    return <CalendarOutlined />
}

const methodTagColor = (method?: string) => {
    if (method === 'virtual') return 'blue'
    if (method === 'in_person') return 'green'
    if (method === 'telephonically') return 'orange'
    return 'default'
}

const getLocationLabel = (appointment: UpcomingAppointment) => {
    const method = getDeliveryMethod(appointment)

    if (method === 'virtual') {
        return (
            appointment?.meetingPlatform ||
            appointment?.delivery?.meeting?.platform ||
            'Online meeting'
        )
    }

    if (method === 'telephonically') {
        return 'Phone call'
    }

    return (
        appointment?.location ||
        appointment?.venue ||
        appointment?.delivery?.location?.venue ||
        appointment?.delivery?.location?.address ||
        ''
    )
}

const hasSmeTimeProposal = (appointment: UpcomingAppointment) =>
    appointment?.smeRescheduleRequest?.status === 'proposed' &&
    Array.isArray(appointment?.smeRescheduleRequest?.proposals) &&
    appointment.smeRescheduleRequest.proposals.length > 0

const getGroupedResponseCounts = (appointment: UpcomingAppointment) => {
    const members = getAppointmentMembers(appointment as any)

    const counts = {
        confirmed: 0,
        declined: 0,
        pending: 0
    }

    members.forEach(member => {
        const status = getConfirmationStatus(
            member.userConfirmation ||
            member.beneficiaryConfirmation ||
            member.confirmationStatus
        )

        if (status === 'confirmed') counts.confirmed += 1
        else if (status === 'declined') counts.declined += 1
        else counts.pending += 1
    })

    return {
        memberCount: members.length,
        ...counts
    }
}

const isGroupedAppointment = (appointment: UpcomingAppointment) => {
    const responseCounts = getGroupedResponseCounts(appointment)

    return (
        responseCounts.memberCount > 1 ||
        Boolean(
            appointment?.groupId ||
            appointment?.appointmentGroupId ||
            appointment?.isGroup ||
            appointment?.isGrouped
        )
    )
}

const getSingleResponse = (appointment: UpcomingAppointment) => {
    if (hasSmeTimeProposal(appointment)) return 'New time proposed'

    const statuses = getAppointmentMembers(appointment as any).map(member =>
        getConfirmationStatus(
            member.userConfirmation ||
            member.beneficiaryConfirmation ||
            member.confirmationStatus
        )
    )

    if (statuses.some(status => status === 'declined')) return 'Declined'
    if (statuses.length && statuses.every(status => status === 'confirmed')) {
        return 'Confirmed'
    }
    if (statuses.some(status => status === 'confirmed')) {
        return 'Partially confirmed'
    }
    if (statuses.some(status => status === 'pending')) return 'Pending'
    return 'No response'
}

const responseTag = (appointment: UpcomingAppointment) => {
    if (isGroupedAppointment(appointment)) {
        const counts = getGroupedResponseCounts(appointment)

        return (
            <Space
                size={[4, 4]}
                wrap
                style={{
                    width: '100%',
                    justifyContent: 'flex-end'
                }}
            >
                {counts.confirmed > 0 && (
                    <Tag color="green" style={{ marginInlineEnd: 0 }}>
                        {counts.confirmed} confirmed
                    </Tag>
                )}

                {counts.declined > 0 && (
                    <Tag color="red" style={{ marginInlineEnd: 0 }}>
                        {counts.declined} declined
                    </Tag>
                )}

                {counts.pending > 0 && (
                    <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                        {counts.pending} pending
                    </Tag>
                )}
            </Space>
        )
    }

    const response = getSingleResponse(appointment)

    if (response === 'New time proposed') {
        return <Tag color="orange">New time proposed</Tag>
    }

    if (response === 'Declined') {
        return <Tag color="red">Declined</Tag>
    }

    if (response === 'Confirmed') {
        return <Tag color="green">Confirmed</Tag>
    }

    if (response === 'Partially confirmed') {
        return <Tag color="blue">Partially confirmed</Tag>
    }

    if (response === 'Pending') {
        return <Tag color="gold">Pending</Tag>
    }

    return <Tag>No response</Tag>
}

const getStatusAccent = (appointment: UpcomingAppointment) => {
    const status = String(getAppointmentStatus(appointment) || 'scheduled').toLowerCase()

    if (status === 'completed') return '#52c41a'
    if (status === 'cancelled') return '#ff4d4f'
    if (status === 'in-progress') return '#722ed1'
    return '#1677ff'
}

const UpcomingAppointmentsCard: React.FC<Props> = ({
    departmentId,
    departmentIds,
    programId,
    appointments: providedAppointments,
    title = (
        <Space size={8}>
            <CalendarOutlined />
            <span>Upcoming Appointments</span>
        </Space>
    ),
    limit = 6,
    onViewCalendar,
    onAppointmentClick,
    showAddEvent = false,
    onEventCreated
}) => {
    const { token } = theme.useToken()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const [eventForm] = Form.useForm()

    const [loading, setLoading] = React.useState(false)
    const [appointments, setAppointments] = React.useState<UpcomingAppointment[]>([])
    const [selectedAppointment, setSelectedAppointment] =
        React.useState<UpcomingAppointment | null>(null)
    const [eventModalOpen, setEventModalOpen] = React.useState(false)
    const [selectedDate, setSelectedDate] = React.useState<Dayjs>(dayjs().startOf('day'))

    const weekDays = React.useMemo(() => {
        const today = dayjs().startOf('day')
        const daysSinceMonday = (today.day() + 6) % 7
        const monday = today.subtract(daysSinceMonday, 'day')

        return Array.from({ length: 5 }, (_, index) =>
            monday.add(index, 'day')
        )
    }, [])

    React.useEffect(() => {
        const run = async () => {
            setLoading(true)

            try {
                const sourceRows =
                    providedAppointments ||
                    (await fetchAppointments({
                        departmentId,
                        departmentIds,
                        programId
                    }))

                const groupedRows = groupAppointments(sourceRows) as UpcomingAppointment[]

                const today = dayjs().startOf('day')
                const workWeekStart = weekDays[0].startOf('day')
                const workWeekEnd = weekDays[4].endOf('day')

                const upcoming = groupedRows
                    .map(row => ({
                        ...row,
                        _start: resolveAppointmentStart(row).date
                    }))
                    .filter(row => {
                        if (!row._start?.isValid()) return false

                        const appointmentDay = row._start.startOf('day')

                        if (appointmentDay.isBefore(today, 'day')) return false
                        if (appointmentDay.isBefore(workWeekStart, 'day')) return false
                        if (appointmentDay.isAfter(workWeekEnd, 'day')) return false

                        return true
                    })
                    .sort(
                        (a, b) =>
                            (a._start?.valueOf() || 0) -
                            (b._start?.valueOf() || 0)
                    )

                setAppointments(upcoming)

                const todayIsWorkDay = weekDays.some(day =>
                    day.isSame(today, 'day')
                )

                const todayHasAppointments = upcoming.some(row =>
                    getAppointmentDate(row)?.isSame(today, 'day')
                )

                if (todayHasAppointments) {
                    setSelectedDate(today)
                } else if (upcoming.length > 0) {
                    const firstDate = getAppointmentDate(upcoming[0])

                    if (firstDate?.isValid()) {
                        setSelectedDate(firstDate.startOf('day'))
                    }
                } else if (todayIsWorkDay) {
                    setSelectedDate(today)
                } else {
                    setSelectedDate(weekDays[0])
                }
            } catch (err) {
                console.error('Error loading appointments', err)
                setAppointments([])
            } finally {
                setLoading(false)
            }
        }

        run()
    }, [
        departmentId,
        departmentIds,
        programId,
        providedAppointments,
        weekDays
    ])

    const appointmentsByDate = React.useMemo(() => {
        const map = new Map<string, UpcomingAppointment[]>()

        appointments.forEach(appointment => {
            const date = getAppointmentDate(appointment)
            if (!date?.isValid()) return

            const key = date.format('YYYY-MM-DD')
            const existing = map.get(key) || []
            existing.push(appointment)
            map.set(key, existing)
        })

        return map
    }, [appointments])

    const selectedAppointments = React.useMemo(() => {
        const key = selectedDate.format('YYYY-MM-DD')
        const rows = appointmentsByDate.get(key) || []

        return limit === null ? rows : rows.slice(0, limit)
    }, [appointmentsByDate, selectedDate, limit])

    const openAppointment = (row: UpcomingAppointment) => {
        if (onAppointmentClick) {
            onAppointmentClick(row)
            return
        }

        setSelectedAppointment(row)
    }

    const handleEventCreated = (event?: any) => {
        setEventModalOpen(false)
        onEventCreated?.(event)
    }

    const cardExtra =
        showAddEvent || onViewCalendar ? (
            <Space wrap size={8}>
                {showAddEvent && (
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => setEventModalOpen(true)}
                    >
                        Add Event
                    </Button>
                )}

                {onViewCalendar && (
                    <Button
                        icon={<ArrowRightOutlined />}
                        shape="round"
                        onClick={onViewCalendar}
                    >
                        Calendar
                    </Button>
                )}
            </Space>
        ) : null

    const dayStrip = (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${weekDays.length}, minmax(0, 1fr))`,
                gap: isMobile ? 6 : 9,
                width: '100%',
                padding: '2px 0 6px'
            }}
        >
            {weekDays.map(day => {
                const key = day.format('YYYY-MM-DD')
                const count = appointmentsByDate.get(key)?.length || 0
                const hasAppointments = count > 0
                const selected = day.isSame(selectedDate, 'day')
                const today = day.isSame(dayjs(), 'day')

                return (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedDate(day)}
                        aria-label={`${day.format('dddd D MMMM')}, ${count} appointment${count === 1 ? '' : 's'
                            }`}
                        style={{
                            position: 'relative',
                            width: '100%',
                            minWidth: 0,
                            height: hasAppointments ? 72 : 60,
                            borderRadius: 13,
                            border: selected
                                ? `1px solid ${token.colorPrimary}`
                                : `1px solid ${token.colorBorderSecondary}`,
                            background: selected
                                ? token.colorPrimary
                                : token.colorBgContainer,
                            color: selected
                                ? token.colorTextLightSolid
                                : token.colorText,
                            boxShadow: selected
                                ? `0 8px 20px ${token.colorPrimaryBgHover}`
                                : '0 4px 12px rgba(0,0,0,.05)',
                            cursor: 'pointer',
                            transition:
                                'height .18s ease, transform .18s ease, box-shadow .18s ease, border-color .18s ease',
                            transform: selected
                                ? 'translateY(-1px)'
                                : 'translateY(0)',
                            padding: '7px 4px 8px'
                        }}
                    >
                        <div
                            style={{
                                fontSize: 15,
                                fontWeight: 700,
                                lineHeight: 1.1
                            }}
                        >
                            {day.format('D')}
                        </div>

                        <div
                            style={{
                                marginTop: 3,
                                fontSize: 10,
                                opacity: selected ? 0.85 : 0.62,
                                lineHeight: 1.1
                            }}
                        >
                            {day.format('ddd')}
                        </div>

                        {today && !selected && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: 5,
                                    right: 5,
                                    width: 5,
                                    height: 5,
                                    borderRadius: 999,
                                    background: token.colorPrimary
                                }}
                            />
                        )}

                        {hasAppointments && (
                            <div
                                style={{
                                    position: 'absolute',
                                    bottom: 7,
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4
                                }}
                            >
                                <span
                                    style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: 999,
                                        background: selected
                                            ? token.colorError
                                            : token.colorError
                                    }}
                                />
                                {count > 1 && (
                                    <span
                                        style={{
                                            fontSize: 9,
                                            fontWeight: 700,
                                            opacity: selected ? 0.9 : 0.7
                                        }}
                                    >
                                        {count}
                                    </span>
                                )}
                            </div>
                        )}
                    </button>
                )
            })}
        </div>
    )

    return (
        <>
            <Card
                style={{
                    width: '100%',
                    maxWidth: '100%',
                    minWidth: 0,
                    overflow: 'hidden',
                    borderRadius: 14,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: '0 10px 30px rgba(0,0,0,.08)'
                }}
                styles={{
                    header: {
                        minHeight: 54,
                        paddingInline: isMobile ? 14 : 18
                    },
                    body: {
                        padding: isMobile ? 14 : 18
                    }
                }}
                title={title}
                extra={cardExtra}
            >
                {loading ? (
                    <Space direction="vertical" size={14} style={{ width: '100%' }}>
                        <div
                            style={{
                                display: 'flex',
                                gap: 8,
                                overflow: 'hidden'
                            }}
                        >
                            {Array.from({ length: 7 }).map((_, index) => (
                                <Skeleton.Button
                                    key={index}
                                    active
                                    style={{
                                        width: 56,
                                        height: index % 3 === 0 ? 72 : 60,
                                        borderRadius: 13
                                    }}
                                />
                            ))}
                        </div>

                        <Skeleton
                            active
                            title={false}
                            paragraph={{
                                rows: 4,
                                width: ['100%', '100%', '100%', '75%']
                            }}
                        />
                    </Space>
                ) : (
                    <>
                        {dayStrip}

                        <div
                            style={{
                                marginTop: 14,
                                borderTop: `1px solid ${token.colorBorderSecondary}`,
                                paddingTop: 10
                            }}
                        >
                            {selectedAppointments.length === 0 ? (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description={`No appointments on ${selectedDate.format(
                                        'dddd, D MMMM'
                                    )}.`}
                                    style={{
                                        marginBlock: 22
                                    }}
                                />
                            ) : (
                                <Table
                                    rowKey="id"
                                    size="small"
                                    dataSource={selectedAppointments}
                                    showHeader={!isMobile}
                                    pagination={false}
                                    tableLayout="fixed"
                                    onRow={row => ({
                                        onClick: () => openAppointment(row),
                                        style: {
                                            cursor: 'pointer'
                                        }
                                    })}
                                    columns={[
                                        {
                                            title: 'Appointment',
                                            key: 'appointment',
                                            render: (_: any, row: UpcomingAppointment) => {
                                                const titleText = getAppointmentTitle(row)
                                                const grouped = isGroupedAppointment(row)
                                                const counts = getGroupedResponseCounts(row)
                                                const participantLabel = grouped
                                                    ? `${counts.memberCount} participants`
                                                    : row.participantName || 'Participant'

                                                const method = getDeliveryMethod(row)
                                                const location = getLocationLabel(row)
                                                const accent = getStatusAccent(row)

                                                return (
                                                    <div
                                                        style={{
                                                            display: 'grid',
                                                            gridTemplateColumns: '3px minmax(0, 1fr)',
                                                            gap: 10,
                                                            alignItems: 'stretch',
                                                            paddingBlock: 5
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                width: 3,
                                                                minHeight: 46,
                                                                borderRadius: 999,
                                                                background: accent
                                                            }}
                                                        />

                                                        <div
                                                            style={{
                                                                minWidth: 0
                                                            }}
                                                        >
                                                            <Space
                                                                size={[6, 4]}
                                                                wrap
                                                                style={{
                                                                    marginBottom: 3
                                                                }}
                                                            >
                                                                <Text
                                                                    strong
                                                                    ellipsis={{
                                                                        tooltip: titleText
                                                                    }}
                                                                    style={{
                                                                        display: 'inline-block',
                                                                        maxWidth: isMobile ? 180 : 300,
                                                                        verticalAlign: 'middle'
                                                                    }}
                                                                >
                                                                    {titleText}
                                                                </Text>

                                                                <Tag
                                                                    color={methodTagColor(method)}
                                                                    icon={methodIcon(method)}
                                                                    style={{
                                                                        marginInlineEnd: 0,
                                                                        borderRadius: 999
                                                                    }}
                                                                >
                                                                    {methodLabel(method)}
                                                                </Tag>
                                                            </Space>

                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 8,
                                                                    minWidth: 0
                                                                }}
                                                            >
                                                                <Text
                                                                    type="secondary"
                                                                    ellipsis={{
                                                                        tooltip: participantLabel
                                                                    }}
                                                                    style={{
                                                                        fontSize: 12,
                                                                        minWidth: 0
                                                                    }}
                                                                >
                                                                    <UserOutlined /> {participantLabel}
                                                                </Text>

                                                                {location && !isMobile && (
                                                                    <>
                                                                        <span
                                                                            style={{
                                                                                width: 3,
                                                                                height: 3,
                                                                                borderRadius: 999,
                                                                                background: token.colorTextQuaternary,
                                                                                flex: '0 0 auto'
                                                                            }}
                                                                        />
                                                                        <Text
                                                                            type="secondary"
                                                                            ellipsis={{
                                                                                tooltip: location
                                                                            }}
                                                                            style={{
                                                                                fontSize: 12,
                                                                                minWidth: 0
                                                                            }}
                                                                        >
                                                                            {location}
                                                                        </Text>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            }
                                        },
                                        {
                                            title: 'Time',
                                            key: 'time',
                                            width: isMobile ? 86 : 110,
                                            align: 'right' as const,
                                            render: (_: any, row: UpcomingAppointment) => (
                                                <Text
                                                    type="secondary"
                                                    style={{
                                                        whiteSpace: 'nowrap',
                                                        fontSize: 12
                                                    }}
                                                >
                                                    {formatAppointmentTime(row)}
                                                </Text>
                                            )
                                        },
                                        ...(!isMobile
                                            ? [
                                                {
                                                    title: 'Response',
                                                    key: 'response',
                                                    width: 170,
                                                    align: 'right' as const,
                                                    render: (_: any, row: UpcomingAppointment) => (
                                                        <div
                                                            style={{
                                                                width: '100%',
                                                                display: 'flex',
                                                                justifyContent: 'flex-end'
                                                            }}
                                                        >
                                                            {responseTag(row)}
                                                        </div>
                                                    )
                                                }
                                            ]
                                            : [])
                                    ]}
                                />
                            )}
                        </div>
                    </>
                )}

                <AppointmentDetailsModal
                    open={Boolean(selectedAppointment)}
                    appointment={selectedAppointment}
                    onClose={() => setSelectedAppointment(null)}
                />
            </Card>

            {showAddEvent && (
                <GlobalEventModal
                    open={eventModalOpen}
                    form={eventForm}
                    onCancel={() => setEventModalOpen(false)}
                    onSuccess={handleEventCreated}
                />
            )}
        </>
    )
}

export default UpcomingAppointmentsCard
