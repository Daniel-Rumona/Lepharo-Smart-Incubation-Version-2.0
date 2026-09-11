// import React from 'react'
// import {
//     Badge,
//     Button,
//     Calendar,
//     DatePicker,
//     Modal,
//     Segmented,
//     Select,
//     Space,
//     Tag,
//     Typography
// } from 'antd'
// import {
//     CalendarOutlined,
//     ClockCircleOutlined,
//     TeamOutlined,
//     UserOutlined
// } from '@ant-design/icons'
// import type { Dayjs } from 'dayjs'
// import dayjs from 'dayjs'
// import customParseFormat from 'dayjs/plugin/customParseFormat'
// import * as appointmentService from '@/services/appointmentService'
// import EventDetailsModal, { type EventDetails } from '@/components/modals/EventDetails'

// dayjs.extend(customParseFormat)

// const { RangePicker } = DatePicker
// const { Text, Title } = Typography

// type AppointmentMember = {
//     id?: string
//     participantId?: string
//     participantName?: string
//     participantEmail?: string
//     beneficiaryName?: string
//     email?: string
//     userConfirmation?: string
//     beneficiaryConfirmation?: string
//     confirmationStatus?: string
//     status?: string
//     foodSelections?: any[]
//     [key: string]: any
// }

// export type CalendarAppointment = {
//     id: string
//     title?: string
//     interventionTitle?: string
//     sessionTitle?: string
//     groupTitle?: string
//     appointmentType?: string
//     time?: any
//     start?: any
//     end?: any
//     date?: string
//     startTime?: any
//     endTime?: any
//     startTimeString?: string
//     endTimeString?: string
//     sessionStartTime?: any
//     sessionEndTime?: any
//     schedule?: {
//         dateKey?: string
//         startTime?: any
//         endTime?: any
//         startAt?: any
//         endAt?: any
//     }
//     snapshot?: {
//         beneficiaryName?: string
//         interventionTitle?: string
//         groupTitle?: string | null
//         assigneeName?: string
//         departmentName?: string
//     }
//     departmentId?: string
//     coordinatorId?: string
//     coordinatorName?: string
//     coordinatorEmail?: string
//     assigneeId?: string
//     participantId?: string
//     participantName?: string
//     participantEmail?: string
//     deliveryMethod?: string
//     delivery?: {
//         mode?: string
//         location?: any
//         meeting?: any
//     }
//     status?: string
//     userConfirmation?: string
//     beneficiaryConfirmation?: string
//     allocationType?: string
//     isGroupAppointment?: boolean
//     groupKey?: string
//     groupId?: string
//     groupMemberCount?: number
//     groupParticipantCount?: number
//     groupMembers?: AppointmentMember[]
//     _displayType?: 'single' | 'group'
//     _groupMembers?: AppointmentMember[]
//     [key: string]: any
// }

// export type CalendarEvent = EventDetails & {
//     departmentId?: string
//     departmentName?: string
//     programId?: string
//     status?: string
//     createdBy?: string
//     createdByEmail?: string
//     organizerEmail?: string
//     ownerEmail?: string
//     [key: string]: any
// }

// type Props = {
//     open: boolean
//     onClose: () => void
//     appointments: CalendarAppointment[]
//     events?: CalendarEvent[]
//     onAppointmentClick?: (appointment: CalendarAppointment) => void
//     onEventClick?: (event: CalendarEvent) => void
//     height?: number | string
//     width?: number | string
//     title?: React.ReactNode
//     departmentId?: string | null
//     coordinatorId?: string | null
//     participantId?: string | null
//     userEmail?: string | null
//     groupAppointments?: boolean
// }

// type FilterKey = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM'
// type DeliveryFilter = 'all' | 'in_person' | 'virtual' | 'telephonically' | 'hybrid'
// type StatusFilter = 'all' | 'scheduled' | 'in-progress' | 'completed' | 'cancelled'

// type ResolvedDateTime = {
//     date: Dayjs | null
//     hasTime: boolean
// }

// const lower = (value: any) => String(value || '').trim().toLowerCase()

// const isTimeOnly = (value: any) =>
//     typeof value === 'string' && /^\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i.test(value.trim())

// const normaliseDateKey = (value: any) => {
//     const raw = String(value || '').trim()
//     if (!raw) return ''

//     const parsedStrict = dayjs(raw, ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY'], true)
//     if (parsedStrict.isValid()) return parsedStrict.format('YYYY-MM-DD')

//     const parsedLoose = dayjs(raw)
//     return parsedLoose.isValid() ? parsedLoose.format('YYYY-MM-DD') : raw
// }

// const toDateFromFirestore = (value: any): Date | null => {
//     if (!value) return null
//     if (typeof value?.toDate === 'function') return value.toDate()
//     if (value instanceof Date) return value
//     if (typeof value === 'object' && typeof value.seconds === 'number') {
//         return new Date(value.seconds * 1000)
//     }
//     return null
// }

// const parseTimeOnly = (value: any, dateKey: string): Dayjs | null => {
//     if (!isTimeOnly(value) || !dateKey) return null

//     const raw = String(value).trim().toUpperCase()
//     const parsedTime = dayjs(raw, ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'hh:mm A'], true)
//     if (!parsedTime.isValid()) return null

//     const combined = dayjs(`${dateKey} ${parsedTime.format('HH:mm')}`, 'YYYY-MM-DD HH:mm', true)
//     return combined.isValid() ? combined : null
// }

// const parseMaybeDateTime = (value: any, dateKey: string): ResolvedDateTime => {
//     if (!value) return { date: null, hasTime: false }

//     const timeOnly = parseTimeOnly(value, dateKey)
//     if (timeOnly) return { date: timeOnly, hasTime: true }

//     const firestoreDate = toDateFromFirestore(value)
//     if (firestoreDate) {
//         const parsed = dayjs(firestoreDate)
//         if (!parsed.isValid()) return { date: null, hasTime: false }

//         const hasTime = parsed.hour() !== 0 || parsed.minute() !== 0 || parsed.second() !== 0
//         if (dateKey && hasTime) {
//             const combined = dayjs(`${dateKey} ${parsed.format('HH:mm')}`, 'YYYY-MM-DD HH:mm', true)
//             return { date: combined.isValid() ? combined : parsed, hasTime: true }
//         }

//         return { date: parsed, hasTime }
//     }

//     if (typeof value === 'string') {
//         const raw = value.trim()
//         if (!raw) return { date: null, hasTime: false }

//         const parsedStrict = dayjs(raw, [
//             'YYYY-MM-DD HH:mm',
//             'YYYY-MM-DDTHH:mm:ss',
//             'YYYY-MM-DDTHH:mm:ssZ',
//             'DD/MM/YYYY HH:mm',
//             'DD-MM-YYYY HH:mm'
//         ], true)

//         const parsedLoose = parsedStrict.isValid() ? parsedStrict : dayjs(raw)
//         if (!parsedLoose.isValid()) return { date: null, hasTime: false }

//         const hasTime = parsedLoose.hour() !== 0 || parsedLoose.minute() !== 0 || parsedLoose.second() !== 0
//         if (dateKey && hasTime) {
//             const combined = dayjs(`${dateKey} ${parsedLoose.format('HH:mm')}`, 'YYYY-MM-DD HH:mm', true)
//             return { date: combined.isValid() ? combined : parsedLoose, hasTime: true }
//         }

//         return { date: parsedLoose, hasTime }
//     }

//     return { date: null, hasTime: false }
// }

// const getDateKey = (appointment: CalendarAppointment) =>
//     normaliseDateKey(
//         appointment.date ||
//         appointment.schedule?.dateKey ||
//         appointment.scheduledDate ||
//         appointment.appointmentDate ||
//         ''
//     )

// const getStartCandidates = (appointment: CalendarAppointment) => [
//     appointment.startTime,
//     appointment.startTimeString,
//     appointment.start,
//     appointment.schedule?.startTime,
//     appointment.schedule?.startAt,
//     appointment.sessionStartTime,
//     appointment.time
// ]

// const getEndCandidates = (appointment: CalendarAppointment) => [
//     appointment.endTime,
//     appointment.endTimeString,
//     appointment.end,
//     appointment.schedule?.endTime,
//     appointment.schedule?.endAt,
//     appointment.sessionEndTime
// ]

// const resolveFirstDateTime = (appointment: CalendarAppointment, values: any[]): ResolvedDateTime => {
//     const dateKey = getDateKey(appointment)

//     for (const value of values) {
//         const parsed = parseMaybeDateTime(value, dateKey)
//         if (parsed.date?.isValid() && parsed.hasTime) return parsed
//     }

//     for (const value of values) {
//         const parsed = parseMaybeDateTime(value, dateKey)
//         if (parsed.date?.isValid()) return parsed
//     }

//     if (dateKey) {
//         const fallback = dayjs(dateKey, 'YYYY-MM-DD', true)
//         return { date: fallback.isValid() ? fallback : null, hasTime: false }
//     }

//     return { date: null, hasTime: false }
// }

// const resolveStart = (appointment: CalendarAppointment) =>
//     resolveFirstDateTime(appointment, getStartCandidates(appointment))

// const resolveEnd = (appointment: CalendarAppointment) =>
//     resolveFirstDateTime(appointment, getEndCandidates(appointment))

// const getCalendarDate = (appointment: CalendarAppointment): Dayjs | null => {
//     const start = resolveStart(appointment)
//     if (start.date?.isValid()) return start.date

//     const dateKey = getDateKey(appointment)
//     const parsed = dateKey ? dayjs(dateKey, 'YYYY-MM-DD', true) : null
//     return parsed?.isValid() ? parsed : null
// }

// const timeLabel = (appointment: CalendarAppointment) => {
//     return appointmentService.formatAppointmentTime(appointment as any)
// }

// const timeSortValue = (appointment: CalendarAppointment) => {
//     const start = appointmentService.resolveAppointmentStart(appointment as any)
//     if (start.date?.isValid() && start.hasTime) return start.date.valueOf()

//     const calendarDate = appointmentService.getAppointmentDate(appointment as any)
//     return calendarDate?.isValid() ? calendarDate.valueOf() : 0
// }

// const getAppointmentTitle = (appointment: CalendarAppointment) =>
//     String(
//         appointment.sessionTitle ||
//         appointment.groupTitle ||
//         appointment.interventionTitle ||
//         appointment.title ||
//         appointment.snapshot?.interventionTitle ||
//         'Appointment'
//     )

// const getMembers = (appointment: CalendarAppointment): AppointmentMember[] => {
//     if (Array.isArray(appointment._groupMembers) && appointment._groupMembers.length) {
//         return appointment._groupMembers
//     }

//     if (Array.isArray(appointment.groupMembers) && appointment.groupMembers.length) {
//         return appointment.groupMembers
//     }

//     if (appointment.participantId || appointment.participantName || appointment.snapshot?.beneficiaryName) {
//         return [
//             {
//                 id: appointment.id,
//                 participantId: appointment.participantId,
//                 participantName: appointment.participantName || appointment.snapshot?.beneficiaryName,
//                 participantEmail: appointment.participantEmail,
//                 userConfirmation: appointment.userConfirmation,
//                 beneficiaryConfirmation: appointment.beneficiaryConfirmation,
//                 status: appointment.status,
//                 foodSelections: appointment.foodSelections || []
//             }
//         ]
//     }

//     return []
// }

// const isGroupAppointment = (appointment: CalendarAppointment) =>
//     appointment._displayType === 'group' ||
//     Boolean(appointment.isGroupAppointment) ||
//     appointment.allocationType === 'group' ||
//     getMembers(appointment).length > 1

// const getMemberCount = (appointment: CalendarAppointment) => {
//     const members = getMembers(appointment)
//     return Number(
//         appointment.groupParticipantCount ||
//         appointment.groupMemberCount ||
//         members.length ||
//         0
//     )
// }

// const getSessionGroupKey = (appointment: CalendarAppointment) => {
//     const groupKey = String(appointment.groupKey || appointment.groupId || '').trim()
//     const dateKey = getDateKey(appointment)
//     const start = resolveStart(appointment)
//     const end = resolveEnd(appointment)
//     const startPart = start.date?.isValid() && start.hasTime ? start.date.format('HH:mm') : 'no-start'
//     const endPart = end.date?.isValid() && end.hasTime ? end.date.format('HH:mm') : 'no-end'
//     const title = getAppointmentTitle(appointment)

//     return [groupKey || title, dateKey || 'no-date', startPart, endPart].join('__')
// }

// const dedupeGroupAppointments = (appointments: CalendarAppointment[]) => {
//     const output: CalendarAppointment[] = []
//     const groups = new Map<string, CalendarAppointment[]>()

//     appointments.forEach(appointment => {
//         if (appointment._displayType === 'group' && Array.isArray(appointment._groupMembers)) {
//             output.push(appointment)
//             return
//         }

//         const groupKey = String(appointment.groupKey || appointment.groupId || '').trim()
//         const shouldGroup = Boolean(groupKey && (appointment.isGroupAppointment || appointment.allocationType === 'group'))

//         if (!shouldGroup) {
//             output.push(appointment)
//             return
//         }

//         const sessionKey = getSessionGroupKey(appointment)
//         const rows = groups.get(sessionKey) || []
//         rows.push(appointment)
//         groups.set(sessionKey, rows)
//     })

//     groups.forEach((rows, sessionKey) => {
//         const first = rows[0]
//         const existingMembers = getMembers(first).filter(member => member.participantId || member.participantName || member.participantEmail)
//         const rowMembers = rows.map(row => ({
//             id: row.id,
//             participantId: row.participantId,
//             participantName: row.participantName || row.snapshot?.beneficiaryName,
//             participantEmail: row.participantEmail,
//             userConfirmation: row.userConfirmation,
//             beneficiaryConfirmation: row.beneficiaryConfirmation,
//             status: row.status,
//             foodSelections: row.foodSelections || []
//         }))

//         const members = existingMembers.length > 1 ? existingMembers : rowMembers
//         const count = Number(first.groupParticipantCount || first.groupMemberCount || members.length)

//         output.push({
//             ...first,
//             id: `group:${sessionKey}`,
//             _displayType: 'group',
//             _groupMembers: members,
//             isGroupAppointment: true,
//             allocationType: 'group',
//             groupMembers: members,
//             groupMemberCount: count,
//             groupParticipantCount: count,
//             participantName: `${count} SME${count === 1 ? '' : 's'}`,
//             title: first.groupTitle || first.sessionTitle || first.interventionTitle || first.title || 'Group Appointment'
//         })
//     })

//     return output
// }

// const getDeliveryMethod = (appointment: CalendarAppointment): DeliveryFilter | string => {
//     const raw = lower(appointment.deliveryMethod || appointment.delivery?.mode)

//     if (raw === 'online') return 'virtual'
//     if (raw === 'in-person' || raw === 'in person') return 'in_person'
//     if (raw === 'telephonic' || raw === 'telephone') return 'telephonically'
//     if (raw === 'hybrid') return 'hybrid'

//     return raw
// }

// const normalizeStatus = (value: any) => lower(value).replace(/_/g, '-')

// const getStatus = (appointment: CalendarAppointment): StatusFilter | string => {
//     const value = normalizeStatus(appointment.status)

//     if (value === 'in_progress') return 'in-progress'
//     if (value === 'canceled') return 'cancelled'

//     return value || 'scheduled'
// }

// const matchesPerson = (
//     appointment: CalendarAppointment,
//     userEmail?: string | null,
//     participantId?: string | null,
//     coordinatorId?: string | null
// ) => {
//     const email = lower(userEmail)
//     const pId = String(participantId || '').trim()
//     const cId = String(coordinatorId || '').trim()

//     if (!email && !pId && !cId) return true

//     const members = getMembers(appointment)
//     const memberEmails = members.map(member => lower(member.participantEmail || member.email))
//     const memberIds = members.map(member => String(member.participantId || member.id || '').trim())

//     const emailMatch = email
//         ? [
//             lower(appointment.participantEmail),
//             lower(appointment.coordinatorEmail),
//             lower(appointment.createdByEmail),
//             ...memberEmails
//         ].includes(email)
//         : false

//     const participantMatch = pId
//         ? String(appointment.participantId || '').trim() === pId || memberIds.includes(pId)
//         : false

//     const coordinatorMatch = cId
//         ? [appointment.coordinatorId, appointment.assigneeId]
//             .map(value => String(value || '').trim())
//             .includes(cId)
//         : false

//     return emailMatch || participantMatch || coordinatorMatch
// }

// const getEventDate = (event: CalendarEvent): Dayjs | null => {
//     const dateKey = normaliseDateKey(event.date)
//     if (!dateKey) return null

//     const start = parseMaybeDateTime(event.startTime, dateKey)
//     if (start.date?.isValid()) return start.date

//     const fallback = dayjs(dateKey, 'YYYY-MM-DD', true)
//     return fallback.isValid() ? fallback : null
// }

// const eventTimeLabel = (event: CalendarEvent) => {
//     const start = String(event.startTime || '').trim()
//     const end = String(event.endTime || '').trim()
//     if (start && end) return `${start} - ${end}`
//     return start || end || 'All day'
// }

// const eventSortValue = (event: CalendarEvent) => {
//     const date = getEventDate(event)
//     return date?.isValid() ? date.valueOf() : 0
// }

// const getEventDeliveryMethod = (event: CalendarEvent): DeliveryFilter | string => {
//     const value = lower(event.format)

//     if (value === 'online') return 'virtual'
//     if (value === 'in-person' || value === 'in person') return 'in_person'
//     if (value === 'telephonic' || value === 'telephone') return 'telephonically'
//     if (value === 'hybrid') return 'hybrid'

//     return value
// }

// const getEventStatus = (event: CalendarEvent): StatusFilter | string => {
//     const value = normalizeStatus(event.status)
//     if (value === 'canceled') return 'cancelled'
//     if (value === 'in_progress') return 'in-progress'
//     return value || 'scheduled'
// }

// const matchesEventPerson = (
//     event: CalendarEvent,
//     userEmail?: string | null,
//     participantId?: string | null,
//     coordinatorId?: string | null
// ) => {
//     const email = lower(userEmail)
//     const pId = String(participantId || '').trim()
//     const cId = String(coordinatorId || '').trim()

//     if (!email && !pId && !cId) return true

//     const participants = Array.isArray(event.participants) ? event.participants : []
//     const participantEmails = participants.map(participant => lower(participant.email))
//     const participantIds = participants.map(participant => String(participant.id || '').trim())

//     const emailMatch = email
//         ? [
//             lower(event.createdBy),
//             lower(event.createdByEmail),
//             lower(event.organizerEmail),
//             lower(event.ownerEmail),
//             ...participantEmails
//         ].includes(email)
//         : false

//     const participantMatch = pId ? participantIds.includes(pId) : false
//     const coordinatorMatch = cId ? participantIds.includes(cId) : false

//     return emailMatch || participantMatch || coordinatorMatch
// }

// type CalendarDayItem =
//     | { kind: 'appointment'; id: string; appointment: CalendarAppointment }
//     | { kind: 'event'; id: string; event: CalendarEvent }

// const eventColor = (event: CalendarEvent) => {
//     const type = lower(event.type)

//     if (type === 'deadline') return '#ff4d4f'
//     if (type === 'meeting') return '#1677ff'
//     if (type === 'webinar') return '#722ed1'
//     if (type === 'workshop') return '#eb2f96'
//     return '#52c41a'
// }

// const GroupPill: React.FC<{ count?: number; compact?: boolean }> = ({ count = 0, compact }) => (
//     <span
//         style={{
//             display: 'inline-flex',
//             alignItems: 'center',
//             gap: 5,
//             padding: compact ? '1px 7px' : '4px 10px',
//             borderRadius: 999,
//             background: 'linear-gradient(135deg, rgba(114,46,209,.14), rgba(22,119,255,.12))',
//             border: '1px solid rgba(114,46,209,.24)',
//             color: '#391085',
//             fontSize: compact ? 11 : 12,
//             fontWeight: 700,
//             whiteSpace: 'nowrap'
//         }}
//     >
//         <TeamOutlined />
//         <span>{compact ? 'Group' : 'Group Session'}</span>
//         {count ? <span style={{ opacity: 0.72 }}>· {count}</span> : null}
//     </span>
// )

// const getRangeForFilter = (filter: FilterKey, viewDate: Dayjs, customRange: [Dayjs, Dayjs] | null) => {
//     const today = dayjs()

//     if (filter === 'TODAY') return [today.startOf('day'), today.endOf('day')] as [Dayjs, Dayjs]
//     if (filter === 'THIS_WEEK') return [today.startOf('week'), today.endOf('week')] as [Dayjs, Dayjs]
//     if (filter === 'THIS_MONTH') return [today.startOf('month'), today.endOf('month')] as [Dayjs, Dayjs]
//     if (filter === 'CUSTOM' && customRange) return customRange

//     return [viewDate.startOf('month'), viewDate.endOf('month')] as [Dayjs, Dayjs]
// }

// const AppointmentsCalendarModal: React.FC<Props> = ({
//     open,
//     onClose,
//     appointments,
//     events = [],
//     onAppointmentClick,
//     onEventClick,
//     height = '75vh',
//     width = '90vw',
//     title = 'Appointments & Events Calendar',
//     departmentId,
//     coordinatorId,
//     participantId,
//     userEmail,
//     groupAppointments = true
// }) => {
//     const [viewDate, setViewDate] = React.useState<Dayjs>(() => dayjs())
//     const [filter, setFilter] = React.useState<FilterKey>('THIS_MONTH')
//     const [customRange, setCustomRange] = React.useState<[Dayjs, Dayjs] | null>(null)
//     const [deliveryFilter, setDeliveryFilter] = React.useState<DeliveryFilter>('all')
//     const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all')
//     const [selectedEvent, setSelectedEvent] = React.useState<CalendarEvent | null>(null)

//     React.useEffect(() => {
//         if (!open) return
//         const today = dayjs()
//         setViewDate(today)
//         setFilter('THIS_MONTH')
//         setCustomRange(null)
//         setSelectedEvent(null)
//     }, [open])

//     const activeRange = React.useMemo(
//         () => getRangeForFilter(filter, viewDate, customRange),
//         [filter, viewDate, customRange]
//     )

//     const filteredAppointments = React.useMemo(() => {
//         let rows = Array.isArray(appointments) ? [...appointments] : []

//         if (groupAppointments) rows = appointmentService.groupAppointments(rows as any) as CalendarAppointment[]

//         if (departmentId) {
//             rows = rows.filter(appointment => String(appointment.departmentId || '').trim() === departmentId)
//         }

//         rows = rows.filter(appointment => matchesPerson(appointment, userEmail, participantId, coordinatorId))

//         if (deliveryFilter !== 'all') {
//             rows = rows.filter(appointment => appointmentService.getDeliveryMethod(appointment as any) === deliveryFilter)
//         }

//         if (statusFilter !== 'all') {
//             rows = rows.filter(appointment => appointmentService.getAppointmentStatus(appointment as any) === statusFilter)
//         }

//         return rows
//     }, [appointments, departmentId, userEmail, participantId, coordinatorId, groupAppointments, deliveryFilter, statusFilter])

//     const filteredEvents = React.useMemo(() => {
//         let rows = Array.isArray(events) ? [...events] : []

//         if (departmentId) {
//             rows = rows.filter(event => String(event.departmentId || '').trim() === departmentId)
//         }

//         rows = rows.filter(event => matchesEventPerson(event, userEmail, participantId, coordinatorId))

//         if (deliveryFilter !== 'all') {
//             rows = rows.filter(event => getEventDeliveryMethod(event) === deliveryFilter)
//         }

//         if (statusFilter !== 'all') {
//             rows = rows.filter(event => getEventStatus(event) === statusFilter)
//         }

//         return rows
//     }, [events, departmentId, userEmail, participantId, coordinatorId, deliveryFilter, statusFilter])

//     const visibleAppointments = React.useMemo(() => {
//         const [from, to] = activeRange

//         return filteredAppointments.filter(appointment => {
//             const date = appointmentService.getAppointmentDate(appointment as any)
//             if (!date?.isValid()) return false
//             return !date.isBefore(from, 'day') && !date.isAfter(to, 'day')
//         })
//     }, [filteredAppointments, activeRange])

//     const visibleEvents = React.useMemo(() => {
//         const [from, to] = activeRange

//         return filteredEvents.filter(event => {
//             const date = getEventDate(event)
//             if (!date?.isValid()) return false
//             return !date.isBefore(from, 'day') && !date.isAfter(to, 'day')
//         })
//     }, [filteredEvents, activeRange])

//     const byDay = React.useMemo(() => {
//         const map: Record<string, CalendarDayItem[]> = {}

//         visibleAppointments.forEach(appointment => {
//             const date = appointmentService.getAppointmentDate(appointment as any)
//             if (!date?.isValid()) return

//             const key = date.format('YYYY-MM-DD')
//                 ; (map[key] ||= []).push({
//                     kind: 'appointment',
//                     id: `appointment:${appointment.id}`,
//                     appointment
//                 })
//         })

//         visibleEvents.forEach(event => {
//             const date = getEventDate(event)
//             if (!date?.isValid()) return

//             const key = date.format('YYYY-MM-DD')
//                 ; (map[key] ||= []).push({
//                     kind: 'event',
//                     id: `event:${event.id}`,
//                     event
//                 })
//         })

//         Object.keys(map).forEach(key => {
//             map[key].sort((a, b) => {
//                 const startA = a.kind === 'appointment'
//                     ? timeSortValue(a.appointment)
//                     : eventSortValue(a.event)
//                 const startB = b.kind === 'appointment'
//                     ? timeSortValue(b.appointment)
//                     : eventSortValue(b.event)

//                 if (startA === startB) {
//                     const titleA = a.kind === 'appointment'
//                         ? appointmentService.getAppointmentTitle(a.appointment as any)
//                         : a.event.title || 'Event'
//                     const titleB = b.kind === 'appointment'
//                         ? appointmentService.getAppointmentTitle(b.appointment as any)
//                         : b.event.title || 'Event'
//                     return titleA.localeCompare(titleB)
//                 }

//                 return startA - startB
//             })
//         })

//         return map
//     }, [visibleAppointments, visibleEvents])

//     const handleCalendarItemClick = (item: CalendarDayItem) => {
//         if (item.kind === 'appointment') {
//             onAppointmentClick?.(item.appointment)
//             return
//         }

//         setSelectedEvent(item.event)
//         onEventClick?.(item.event)
//     }

//     const setPresetFilter = (nextFilter: FilterKey) => {
//         const today = dayjs()
//         setFilter(nextFilter)
//         if (nextFilter !== 'CUSTOM') setCustomRange(null)
//         if (nextFilter === 'TODAY' || nextFilter === 'THIS_WEEK' || nextFilter === 'THIS_MONTH') {
//             setViewDate(today)
//         }
//     }

//     const jumpMonth = (amount: number) => {
//         const next = viewDate.add(amount, 'month')
//         setViewDate(next)
//         setFilter('CUSTOM')
//         setCustomRange([next.startOf('month'), next.endOf('month')])
//     }

//     const dateCellRender = (value: Dayjs) => {
//         const key = value.format('YYYY-MM-DD')
//         const items = byDay[key] || []
//         if (!items.length) return null

//         const maxShown = 4
//         const shown = items.slice(0, maxShown)
//         const more = items.length - shown.length

//         return (
//             <Space direction="vertical" size={4} style={{ width: '100%' }}>
//                 {shown.map(item => {
//                     if (item.kind === 'event') {
//                         const event = item.event

//                         return (
//                             <div
//                                 key={item.id}
//                                 onClick={clickEvent => {
//                                     clickEvent.stopPropagation()
//                                     handleCalendarItemClick(item)
//                                 }}
//                                 style={{
//                                     display: 'flex',
//                                     alignItems: 'center',
//                                     gap: 6,
//                                     cursor: 'pointer',
//                                     padding: '4px 7px',
//                                     borderRadius: 9,
//                                     background: '#f6ffed',
//                                     border: '1px solid #b7eb8f',
//                                     minWidth: 0
//                                 }}
//                             >
//                                 <Badge color={eventColor(event)} />
//                                 <Typography.Text style={{ fontSize: 12, flex: 1 }} ellipsis>
//                                     <span style={{ color: 'rgba(0,0,0,.58)', marginRight: 4 }}>
//                                         {eventTimeLabel(event)}
//                                     </span>
//                                     {event.title || 'Event'}
//                                 </Typography.Text>
//                                 <Tag color="green" style={{ marginInlineEnd: 0, fontSize: 10 }}>
//                                     Event
//                                 </Tag>
//                             </div>
//                         )
//                     }

//                     const appointment = item.appointment
//                     const delivery = appointmentService.getDeliveryMethod(appointment as any)
//                     const color = delivery === 'virtual'
//                         ? '#1677ff'
//                         : delivery === 'in_person'
//                             ? '#13c2c2'
//                             : delivery === 'telephonically'
//                                 ? '#2f54eb'
//                                 : '#722ed1'
//                     const memberCount = appointmentService.getMemberCount(appointment as any)
//                     const group = appointmentService.isGroupAppointment(appointment as any)

//                     return (
//                         <div
//                             key={item.id}
//                             onClick={clickEvent => {
//                                 clickEvent.stopPropagation()
//                                 handleCalendarItemClick(item)
//                             }}
//                             style={{
//                                 display: 'flex',
//                                 alignItems: 'center',
//                                 gap: 6,
//                                 cursor: 'pointer',
//                                 padding: '4px 7px',
//                                 borderRadius: 9,
//                                 background: group
//                                     ? 'linear-gradient(90deg, rgba(114,46,209,.08), rgba(22,119,255,.06))'
//                                     : '#f5f5f5',
//                                 border: group ? '1px solid rgba(114,46,209,.14)' : '1px solid transparent',
//                                 minWidth: 0
//                             }}
//                         >
//                             <Badge color={color} />
//                             <Typography.Text style={{ fontSize: 12, flex: 1 }} ellipsis>
//                                 <span style={{ color: 'rgba(0,0,0,.58)', marginRight: 4 }}>
//                                     {timeLabel(appointment)}
//                                 </span>
//                                 {appointmentService.getAppointmentTitle(appointment as any)}
//                             </Typography.Text>
//                             {group ? (
//                                 <GroupPill compact count={memberCount} />
//                             ) : (
//                                 <Tag color="blue" style={{ marginInlineEnd: 0, fontSize: 10 }}>
//                                     Appt
//                                 </Tag>
//                             )}
//                         </div>
//                     )
//                 })}

//                 {more > 0 ? (
//                     <Typography.Link
//                         onClick={clickEvent => {
//                             clickEvent.stopPropagation()
//                             handleCalendarItemClick(items[0])
//                         }}
//                         style={{ fontSize: 12 }}
//                     >
//                         +{more} more
//                     </Typography.Link>
//                 ) : null}
//             </Space>
//         )
//     }

//     const cellRender: React.ComponentProps<typeof Calendar>['cellRender'] = (current, info) => {
//         if (info.type !== 'date') return info.originNode
//         return dateCellRender(current as Dayjs)
//     }

//     const headerRender: React.ComponentProps<typeof Calendar>['headerRender'] = () => {
//         const [rangeStart, rangeEnd] = activeRange
//         const rangeLabel = rangeStart.isSame(rangeEnd, 'day')
//             ? rangeStart.format('DD MMM YYYY')
//             : rangeStart.isSame(rangeEnd, 'month')
//                 ? rangeStart.format('MMMM YYYY')
//                 : `${rangeStart.format('DD MMM YYYY')} - ${rangeEnd.format('DD MMM YYYY')}`

//         return (
//             <div
//                 style={{
//                     display: 'flex',
//                     alignItems: 'center',
//                     gap: 12,
//                     padding: '10px 12px',
//                     borderBottom: '1px solid #f0f0f0',
//                     flexWrap: 'wrap'
//                 }}
//             >
//                 <Space direction="vertical" size={1}>
//                     <Title level={5} style={{ margin: 0 }}>
//                         {viewDate.format('MMMM YYYY')}
//                     </Title>
//                     <Text type="secondary" style={{ fontSize: 12 }}>
//                         {visibleAppointments.length + visibleEvents.length} of {filteredAppointments.length + filteredEvents.length} item
//                         {filteredAppointments.length + filteredEvents.length === 1 ? '' : 's'} showing · {rangeLabel}
//                     </Text>
//                     <Space size={4} wrap>
//                         <Tag color="blue" style={{ marginInlineEnd: 0 }}>Appointments {visibleAppointments.length}</Tag>
//                         <Tag color="green" style={{ marginInlineEnd: 0 }}>Events {visibleEvents.length}</Tag>
//                     </Space>
//                 </Space>

//                 <Space size={8} style={{ marginLeft: 'auto' }} wrap>
//                     <Segmented
//                         value={filter}
//                         onChange={value => setPresetFilter(value as FilterKey)}
//                         options={[
//                             { label: 'Today', value: 'TODAY' },
//                             { label: 'This Week', value: 'THIS_WEEK' },
//                             { label: 'This Month', value: 'THIS_MONTH' },
//                             { label: 'Custom', value: 'CUSTOM' }
//                         ]}
//                     />

//                     <Select
//                         value={deliveryFilter}
//                         onChange={value => setDeliveryFilter(value)}
//                         style={{ width: 150 }}
//                         options={[
//                             { label: 'All delivery', value: 'all' },
//                             { label: 'Online', value: 'virtual' },
//                             { label: 'In person', value: 'in_person' },
//                             { label: 'Telephonic', value: 'telephonically' },
//                             { label: 'Hybrid', value: 'hybrid' }
//                         ]}
//                     />

//                     <Select
//                         value={statusFilter}
//                         onChange={value => setStatusFilter(value)}
//                         style={{ width: 150 }}
//                         options={[
//                             { label: 'All status', value: 'all' },
//                             { label: 'Scheduled', value: 'scheduled' },
//                             { label: 'In progress', value: 'in-progress' },
//                             { label: 'Completed', value: 'completed' },
//                             { label: 'Cancelled', value: 'cancelled' }
//                         ]}
//                     />

//                     {filter === 'CUSTOM' ? (
//                         <RangePicker
//                             value={customRange || undefined}
//                             onChange={values => {
//                                 if (!values || values.length !== 2 || !values[0] || !values[1]) {
//                                     setCustomRange(null)
//                                     return
//                                 }

//                                 const range: [Dayjs, Dayjs] = [
//                                     values[0].startOf('day'),
//                                     values[1].endOf('day')
//                                 ]

//                                 setCustomRange(range)
//                                 setViewDate(range[0])
//                             }}
//                             allowClear
//                             style={{ width: 300 }}
//                         />
//                     ) : null}

//                     <Button size="small" onClick={() => jumpMonth(-1)}>
//                         Prev
//                     </Button>
//                     <Button size="small" onClick={() => jumpMonth(1)}>
//                         Next
//                     </Button>
//                     <Button
//                         size="small"
//                         icon={<CalendarOutlined />}
//                         onClick={() => setPresetFilter('THIS_MONTH')}
//                     >
//                         Current
//                     </Button>
//                 </Space>
//             </div>
//         )
//     }

//     return (
//         <Modal
//             open={open}
//             title={title}
//             onCancel={onClose}
//             footer={null}
//             width={width}
//             styles={{
//                 body: {
//                     padding: 0
//                 }
//             }}
//             style={{ top: 24 }}
//             zIndex={1000}
//             destroyOnClose
//         >
//             <style>{`
//                 .appointments-calendar-modal-v2 .ant-picker-calendar-fullscreen
//                     .ant-picker-cell .ant-picker-calendar-date-content {
//                     min-height: 112px;
//                 }

//                 .appointments-calendar-modal-v2 .ant-picker-calendar-date-content {
//                     overflow-y: auto;
//                 }
//             `}</style>

//             <div
//                 className="appointments-calendar-modal-v2"
//                 style={{
//                     height,
//                     display: 'flex',
//                     flexDirection: 'column',
//                     overflow: 'hidden'
//                 }}
//             >
//                 <Calendar
//                     value={viewDate}
//                     onSelect={date => setViewDate(date)}
//                     onPanelChange={date => setViewDate(date)}
//                     mode="month"
//                     fullscreen
//                     headerRender={headerRender}
//                     cellRender={cellRender}
//                     style={{ flex: 1, overflow: 'auto', padding: 8 }}
//                 />
//             </div>

//             <EventDetailsModal
//                 open={Boolean(selectedEvent)}
//                 onClose={() => setSelectedEvent(null)}
//                 event={selectedEvent}
//             />
//         </Modal>
//     )
// }

// export default AppointmentsCalendarModal
// export { GroupPill }
import React from 'react'
import {
    Button,
    DatePicker,
    Empty,
    Grid,
    Modal,
    Segmented,
    Select,
    Space,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    CalendarOutlined,
    ClockCircleOutlined,
    EnvironmentOutlined,
    LeftOutlined,
    PhoneOutlined,
    RightOutlined,
    TeamOutlined,
    UserOutlined,
    VideoCameraOutlined
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import * as appointmentService from '@/services/appointmentService'
import EventDetailsModal, { type EventDetails } from '@/components/modals/EventDetails'

dayjs.extend(customParseFormat)
dayjs.extend(quarterOfYear)

const { RangePicker } = DatePicker
const { Text, Title } = Typography
const { useBreakpoint } = Grid

type AppointmentMember = {
    id?: string
    participantId?: string
    participantName?: string
    participantEmail?: string
    beneficiaryName?: string
    email?: string
    userConfirmation?: string
    beneficiaryConfirmation?: string
    confirmationStatus?: string
    status?: string
    foodSelections?: any[]
    [key: string]: any
}

export type CalendarAppointment = {
    id: string
    title?: string
    interventionTitle?: string
    sessionTitle?: string
    groupTitle?: string
    appointmentType?: string
    time?: any
    start?: any
    end?: any
    date?: string
    startTime?: any
    endTime?: any
    startTimeString?: string
    endTimeString?: string
    sessionStartTime?: any
    sessionEndTime?: any
    schedule?: {
        dateKey?: string
        startTime?: any
        endTime?: any
        startAt?: any
        endAt?: any
    }
    snapshot?: {
        beneficiaryName?: string
        interventionTitle?: string
        groupTitle?: string | null
        assigneeName?: string
        departmentName?: string
    }
    departmentId?: string
    coordinatorId?: string
    coordinatorName?: string
    coordinatorEmail?: string
    assigneeId?: string
    participantId?: string
    participantName?: string
    participantEmail?: string
    deliveryMethod?: string
    delivery?: {
        mode?: string
        location?: any
        meeting?: any
    }
    status?: string
    userConfirmation?: string
    beneficiaryConfirmation?: string
    allocationType?: string
    isGroupAppointment?: boolean
    groupKey?: string
    groupId?: string
    groupMemberCount?: number
    groupParticipantCount?: number
    groupMembers?: AppointmentMember[]
    _displayType?: 'single' | 'group'
    _groupMembers?: AppointmentMember[]
    [key: string]: any
}

export type CalendarEvent = EventDetails & {
    departmentId?: string
    departmentName?: string
    programId?: string
    status?: string
    createdBy?: string
    createdByEmail?: string
    organizerEmail?: string
    ownerEmail?: string
    [key: string]: any
}

type Props = {
    open: boolean
    onClose: () => void
    appointments: CalendarAppointment[]
    events?: CalendarEvent[]
    onAppointmentClick?: (appointment: CalendarAppointment) => void
    onEventClick?: (event: CalendarEvent) => void
    height?: number | string
    width?: number | string
    title?: React.ReactNode
    departmentId?: string | null
    coordinatorId?: string | null
    participantId?: string | null
    userEmail?: string | null
    groupAppointments?: boolean
}

type ViewMode = 'DAY' | 'WEEK' | 'MONTH'
type DeliveryFilter = 'all' | 'in_person' | 'virtual' | 'telephonically' | 'hybrid'
type StatusFilter = 'all' | 'scheduled' | 'in-progress' | 'completed' | 'cancelled'

type CalendarDayItem =
    | {
        kind: 'appointment'
        id: string
        appointment: CalendarAppointment
    }
    | {
        kind: 'event'
        id: string
        event: CalendarEvent
    }

const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

const lower = (value: any) =>
    String(value || '')
        .trim()
        .toLowerCase()

const normaliseDateKey = (value: any) => {
    const raw = String(value || '').trim()
    if (!raw) return ''

    const strict = dayjs(
        raw,
        ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY'],
        true
    )

    if (strict.isValid()) {
        return strict.format('YYYY-MM-DD')
    }

    const loose = dayjs(raw)
    return loose.isValid() ? loose.format('YYYY-MM-DD') : raw
}

const toDateFromFirestore = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value instanceof Date) return value

    if (
        typeof value === 'object' &&
        typeof value.seconds === 'number'
    ) {
        return new Date(value.seconds * 1000)
    }

    return null
}

const parseEventDateTime = (value: any, dateKey: string): Dayjs | null => {
    if (!value) return null

    const firestore = toDateFromFirestore(value)

    if (firestore) {
        const parsed = dayjs(firestore)

        if (!parsed.isValid()) return null

        if (dateKey) {
            const combined = dayjs(
                `${dateKey} ${parsed.format('HH:mm')}`,
                'YYYY-MM-DD HH:mm',
                true
            )

            return combined.isValid() ? combined : parsed
        }

        return parsed
    }

    const raw = String(value || '').trim()
    if (!raw) return null

    const timeOnly = dayjs(
        raw.toUpperCase(),
        ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'hh:mm A'],
        true
    )

    if (timeOnly.isValid() && dateKey) {
        const combined = dayjs(
            `${dateKey} ${timeOnly.format('HH:mm')}`,
            'YYYY-MM-DD HH:mm',
            true
        )

        return combined.isValid() ? combined : null
    }

    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed : null
}

const getEventDate = (event: CalendarEvent): Dayjs | null => {
    const dateKey = normaliseDateKey(event.date)
    if (!dateKey) return null

    const timed = parseEventDateTime(event.startTime, dateKey)
    if (timed?.isValid()) return timed

    const fallback = dayjs(dateKey, 'YYYY-MM-DD', true)
    return fallback.isValid() ? fallback : null
}

const eventTimeLabel = (event: CalendarEvent) => {
    const start = String(event.startTime || '').trim()
    const end = String(event.endTime || '').trim()

    if (start && end) return `${start} - ${end}`
    return start || end || 'All day'
}

const eventSortValue = (event: CalendarEvent) =>
    getEventDate(event)?.valueOf() || 0

const getMonday = (date: Dayjs) => {
    const daysSinceMonday = (date.day() + 6) % 7
    return date.subtract(daysSinceMonday, 'day').startOf('day')
}

const isBusinessDay = (date: Dayjs) => {
    const day = date.day()
    return day >= 1 && day <= 5
}

const nextBusinessDay = (date: Dayjs) => {
    let candidate = date.startOf('day')

    while (!isBusinessDay(candidate)) {
        candidate = candidate.add(1, 'day')
    }

    return candidate
}

const addBusinessDays = (date: Dayjs, amount: number) => {
    if (amount === 0) return nextBusinessDay(date)

    const direction = amount > 0 ? 1 : -1
    let remaining = Math.abs(amount)
    let candidate = date.startOf('day')

    while (remaining > 0) {
        candidate = candidate.add(direction, 'day')

        if (isBusinessDay(candidate)) {
            remaining -= 1
        }
    }

    return candidate
}

const dateWithinRange = (
    date: Dayjs,
    range: [Dayjs, Dayjs]
) =>
    !date.isBefore(range[0], 'day') &&
    !date.isAfter(range[1], 'day')

const getEventDeliveryMethod = (
    event: CalendarEvent
): DeliveryFilter | string => {
    const value = lower(event.format)

    if (value === 'online') return 'virtual'
    if (value === 'in-person' || value === 'in person') return 'in_person'
    if (value === 'telephonic' || value === 'telephone') return 'telephonically'
    if (value === 'hybrid') return 'hybrid'

    return value
}

const normalizeStatus = (value: any) =>
    lower(value).replace(/_/g, '-')

const getEventStatus = (
    event: CalendarEvent
): StatusFilter | string => {
    const value = normalizeStatus(event.status)

    if (value === 'canceled') return 'cancelled'
    if (value === 'in_progress') return 'in-progress'

    return value || 'scheduled'
}

const matchesAppointmentPerson = (
    appointment: CalendarAppointment,
    userEmail?: string | null,
    participantId?: string | null,
    coordinatorId?: string | null
) => {
    const email = lower(userEmail)
    const participant = String(participantId || '').trim()
    const coordinator = String(coordinatorId || '').trim()

    if (!email && !participant && !coordinator) {
        return true
    }

    const members =
        appointmentService.getAppointmentMembers?.(appointment as any) || []

    const memberEmails = members.map((member: any) =>
        lower(
            member.participantEmail ||
            member.email
        )
    )

    const memberIds = members.map((member: any) =>
        String(
            member.participantId ||
            member.id ||
            ''
        ).trim()
    )

    const emailMatch = email
        ? [
            lower(appointment.participantEmail),
            lower(appointment.coordinatorEmail),
            lower(appointment.createdByEmail),
            ...memberEmails
        ].includes(email)
        : false

    const participantMatch = participant
        ? String(appointment.participantId || '').trim() === participant ||
        memberIds.includes(participant)
        : false

    const coordinatorMatch = coordinator
        ? [appointment.coordinatorId, appointment.assigneeId]
            .map(value => String(value || '').trim())
            .includes(coordinator)
        : false

    return emailMatch || participantMatch || coordinatorMatch
}

const matchesEventPerson = (
    event: CalendarEvent,
    userEmail?: string | null,
    participantId?: string | null,
    coordinatorId?: string | null
) => {
    const email = lower(userEmail)
    const participant = String(participantId || '').trim()
    const coordinator = String(coordinatorId || '').trim()

    if (!email && !participant && !coordinator) {
        return true
    }

    const participants = Array.isArray(event.participants)
        ? event.participants
        : []

    const participantEmails = participants.map((person: any) =>
        lower(person.email)
    )

    const participantIds = participants.map((person: any) =>
        String(person.id || '').trim()
    )

    const emailMatch = email
        ? [
            lower(event.createdBy),
            lower(event.createdByEmail),
            lower(event.organizerEmail),
            lower(event.ownerEmail),
            ...participantEmails
        ].includes(email)
        : false

    const participantMatch = participant
        ? participantIds.includes(participant)
        : false

    const coordinatorMatch = coordinator
        ? participantIds.includes(coordinator)
        : false

    return emailMatch || participantMatch || coordinatorMatch
}

const eventColor = (event: CalendarEvent) => {
    const type = lower(event.type)

    if (type === 'deadline') return '#ff4d4f'
    if (type === 'meeting') return '#1677ff'
    if (type === 'webinar') return '#722ed1'
    if (type === 'workshop') return '#eb2f96'

    return '#52c41a'
}

const appointmentColor = (appointment: CalendarAppointment) => {
    const delivery =
        appointmentService.getDeliveryMethod(appointment as any)

    if (delivery === 'virtual') return '#1677ff'
    if (delivery === 'in_person') return '#13c2c2'
    if (delivery === 'telephonically') return '#2f54eb'

    return '#722ed1'
}

const appointmentDeliveryIcon = (
    appointment: CalendarAppointment
) => {
    const delivery =
        appointmentService.getDeliveryMethod(appointment as any)

    if (delivery === 'virtual') return <VideoCameraOutlined />
    if (delivery === 'in_person') return <EnvironmentOutlined />
    if (delivery === 'telephonically') return <PhoneOutlined />

    return <CalendarOutlined />
}

const appointmentDeliveryLabel = (
    appointment: CalendarAppointment
) => {
    const delivery =
        appointmentService.getDeliveryMethod(appointment as any)

    if (delivery === 'virtual') return 'Online'
    if (delivery === 'in_person') return 'In person'
    if (delivery === 'telephonically') return 'Telephonic'
    if (delivery === 'hybrid') return 'Hybrid'

    return 'Appointment'
}

const getAppointmentParticipantLabel = (
    appointment: CalendarAppointment
) => {
    const grouped =
        appointmentService.isGroupAppointment(appointment as any)

    if (grouped) {
        const count =
            appointmentService.getMemberCount(appointment as any)

        return `${count} SME${count === 1 ? '' : 's'}`
    }

    return (
        appointment.participantName ||
        appointment.snapshot?.beneficiaryName ||
        'Participant'
    )
}

const buildMonthCells = (month: Dayjs) => {
    const first = month.startOf('month')
    const last = month.endOf('month')

    const businessDates: Dayjs[] = []

    let cursor = first

    while (
        cursor.isBefore(last, 'day') ||
        cursor.isSame(last, 'day')
    ) {
        if (isBusinessDay(cursor)) {
            businessDates.push(cursor)
        }

        cursor = cursor.add(1, 'day')
    }

    if (!businessDates.length) {
        return [] as Array<Dayjs | null>
    }

    const firstWeekdayIndex =
        businessDates[0].day() - 1

    const cells: Array<Dayjs | null> = [
        ...Array.from(
            { length: Math.max(0, firstWeekdayIndex) },
            () => null
        ),
        ...businessDates
    ]

    while (cells.length % 5 !== 0) {
        cells.push(null)
    }

    return cells
}

const AppointmentsCalendarModal: React.FC<Props> = ({
    open,
    onClose,
    appointments,
    events = [],
    onAppointmentClick,
    onEventClick,
    height = '78vh',
    width = '94vw',
    title = 'Appointments & Events Calendar',
    departmentId,
    coordinatorId,
    participantId,
    userEmail,
    groupAppointments = true
}) => {
    const { token } = theme.useToken()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const today = dayjs().startOf('day')
    const defaultRange: [Dayjs, Dayjs] = [
        today.startOf('month'),
        today.endOf('month')
    ]

    const [viewMode, setViewMode] =
        React.useState<ViewMode>('MONTH')

    const [dateRange, setDateRange] =
        React.useState<[Dayjs, Dayjs]>(defaultRange)

    const [selectedDay, setSelectedDay] =
        React.useState<Dayjs>(
            nextBusinessDay(today)
        )

    const [viewDate, setViewDate] =
        React.useState<Dayjs>(today)

    const [deliveryFilter, setDeliveryFilter] =
        React.useState<DeliveryFilter>('all')

    const [statusFilter, setStatusFilter] =
        React.useState<StatusFilter>('all')

    const [selectedEvent, setSelectedEvent] =
        React.useState<CalendarEvent | null>(null)

    React.useEffect(() => {
        if (!open) return

        const now = dayjs().startOf('day')
        const nextWorkDay = nextBusinessDay(now)

        setViewMode('MONTH')
        setDateRange([
            now.startOf('month'),
            now.endOf('month')
        ])
        setSelectedDay(nextWorkDay)
        setViewDate(now)
        setDeliveryFilter('all')
        setStatusFilter('all')
        setSelectedEvent(null)
    }, [open])

    const rangePresets = React.useMemo(
        () => [
            {
                label: 'Today',
                value: [
                    today.startOf('day'),
                    today.endOf('day')
                ] as [Dayjs, Dayjs]
            },
            {
                label: 'This Week',
                value: [
                    getMonday(today),
                    getMonday(today)
                        .add(4, 'day')
                        .endOf('day')
                ] as [Dayjs, Dayjs]
            },
            {
                label: 'This Month',
                value: [
                    today.startOf('month'),
                    today.endOf('month')
                ] as [Dayjs, Dayjs]
            },
            {
                label: 'This Quarter',
                value: [
                    today.startOf('quarter'),
                    today.endOf('quarter')
                ] as [Dayjs, Dayjs]
            },
            {
                label: 'This Year',
                value: [
                    today.startOf('year'),
                    today.endOf('year')
                ] as [Dayjs, Dayjs]
            }
        ],
        [today.valueOf()]
    )

    const baseAppointments =
        React.useMemo(() => {
            let rows = Array.isArray(appointments)
                ? [...appointments]
                : []

            if (groupAppointments) {
                rows =
                    appointmentService.groupAppointments(
                        rows as any
                    ) as CalendarAppointment[]
            }

            if (departmentId) {
                rows = rows.filter(
                    appointment =>
                        String(
                            appointment.departmentId || ''
                        ).trim() === departmentId
                )
            }

            rows = rows.filter(appointment =>
                matchesAppointmentPerson(
                    appointment,
                    userEmail,
                    participantId,
                    coordinatorId
                )
            )

            if (deliveryFilter !== 'all') {
                rows = rows.filter(
                    appointment =>
                        appointmentService.getDeliveryMethod(
                            appointment as any
                        ) === deliveryFilter
                )
            }

            if (statusFilter !== 'all') {
                rows = rows.filter(
                    appointment =>
                        appointmentService.getAppointmentStatus(
                            appointment as any
                        ) === statusFilter
                )
            }

            return rows
        }, [
            appointments,
            groupAppointments,
            departmentId,
            userEmail,
            participantId,
            coordinatorId,
            deliveryFilter,
            statusFilter
        ])

    const baseEvents =
        React.useMemo(() => {
            let rows = Array.isArray(events)
                ? [...events]
                : []

            if (departmentId) {
                rows = rows.filter(
                    event =>
                        String(
                            event.departmentId || ''
                        ).trim() === departmentId
                )
            }

            rows = rows.filter(event =>
                matchesEventPerson(
                    event,
                    userEmail,
                    participantId,
                    coordinatorId
                )
            )

            if (deliveryFilter !== 'all') {
                rows = rows.filter(
                    event =>
                        getEventDeliveryMethod(event) ===
                        deliveryFilter
                )
            }

            if (statusFilter !== 'all') {
                rows = rows.filter(
                    event =>
                        getEventStatus(event) ===
                        statusFilter
                )
            }

            return rows
        }, [
            events,
            departmentId,
            userEmail,
            participantId,
            coordinatorId,
            deliveryFilter,
            statusFilter
        ])

    const rangedAppointments =
        React.useMemo(
            () =>
                baseAppointments.filter(
                    appointment => {
                        const date =
                            appointmentService.getAppointmentDate(
                                appointment as any
                            )

                        return Boolean(
                            date?.isValid() &&
                            dateWithinRange(
                                date,
                                dateRange
                            )
                        )
                    }
                ),
            [
                baseAppointments,
                dateRange
            ]
        )

    const rangedEvents =
        React.useMemo(
            () =>
                baseEvents.filter(event => {
                    const date =
                        getEventDate(event)

                    return Boolean(
                        date?.isValid() &&
                        dateWithinRange(
                            date,
                            dateRange
                        )
                    )
                }),
            [
                baseEvents,
                dateRange
            ]
        )

    const byDay = React.useMemo(() => {
        const map: Record<
            string,
            CalendarDayItem[]
        > = {}

        rangedAppointments.forEach(
            appointment => {
                const date =
                    appointmentService.getAppointmentDate(
                        appointment as any
                    )

                if (!date?.isValid()) return

                const key =
                    date.format('YYYY-MM-DD')

                    ; (map[key] ||= []).push({
                        kind: 'appointment',
                        id: `appointment:${appointment.id}`,
                        appointment
                    })
            }
        )

        rangedEvents.forEach(event => {
            const date =
                getEventDate(event)

            if (!date?.isValid()) return

            const key =
                date.format('YYYY-MM-DD')

                ; (map[key] ||= []).push({
                    kind: 'event',
                    id: `event:${event.id}`,
                    event
                })
        })

        Object.keys(map).forEach(key => {
            map[key].sort((a, b) => {
                const aValue =
                    a.kind === 'appointment'
                        ? appointmentService.resolveAppointmentStart(
                            a.appointment as any
                        ).date?.valueOf() || 0
                        : eventSortValue(
                            a.event
                        )

                const bValue =
                    b.kind === 'appointment'
                        ? appointmentService.resolveAppointmentStart(
                            b.appointment as any
                        ).date?.valueOf() || 0
                        : eventSortValue(
                            b.event
                        )

                return aValue - bValue
            })
        })

        return map
    }, [
        rangedAppointments,
        rangedEvents
    ])

    React.useEffect(() => {
        if (
            dateWithinRange(
                selectedDay,
                dateRange
            )
        ) {
            return
        }

        const candidate =
            dateWithinRange(
                today,
                dateRange
            )
                ? nextBusinessDay(today)
                : nextBusinessDay(
                    dateRange[0]
                )

        setSelectedDay(candidate)
        setViewDate(candidate)
    }, [
        dateRange,
        selectedDay,
        today
    ])

    const selectedDayItems =
        React.useMemo(
            () =>
                byDay[
                selectedDay.format(
                    'YYYY-MM-DD'
                )
                ] || [],
            [
                byDay,
                selectedDay
            ]
        )

    const currentWeekDays =
        React.useMemo(() => {
            const monday =
                getMonday(viewDate)

            return Array.from(
                { length: 5 },
                (_, index) =>
                    monday.add(index, 'day')
            )
        }, [viewDate])

    const monthCells =
        React.useMemo(
            () =>
                buildMonthCells(
                    viewDate
                ),
            [viewDate]
        )

    const handleItemClick = (
        item: CalendarDayItem
    ) => {
        if (
            item.kind === 'appointment'
        ) {
            onAppointmentClick?.(
                item.appointment
            )
            return
        }

        setSelectedEvent(item.event)
        onEventClick?.(item.event)
    }

    const selectDay = (
        date: Dayjs
    ) => {
        if (!isBusinessDay(date)) return

        setSelectedDay(
            date.startOf('day')
        )
        setViewDate(date)
    }

    const applyDateRange = (
        values:
            | [Dayjs | null, Dayjs | null]
            | null
    ) => {
        if (
            !values ||
            !values[0] ||
            !values[1]
        ) {
            return
        }

        const range: [Dayjs, Dayjs] = [
            values[0].startOf('day'),
            values[1].endOf('day')
        ]

        setDateRange(range)

        const days =
            range[1]
                .startOf('day')
                .diff(
                    range[0].startOf(
                        'day'
                    ),
                    'day'
                ) + 1

        const todayInRange =
            dateWithinRange(
                today,
                range
            )

        const nextSelected =
            nextBusinessDay(
                todayInRange
                    ? today
                    : range[0]
            )

        setSelectedDay(
            nextSelected
        )
        setViewDate(
            nextSelected
        )

        if (days <= 1) {
            setViewMode('DAY')
        } else if (days <= 7) {
            setViewMode('WEEK')
        } else {
            setViewMode('MONTH')
        }
    }

    const goCurrent = () => {
        const now = dayjs().startOf('day')
        const businessToday = nextBusinessDay(now)

        if (dateWithinRange(businessToday, dateRange)) {
            setSelectedDay(businessToday)
            setViewDate(now)
            return
        }

        const firstAvailable = nextBusinessDay(dateRange[0])
        setSelectedDay(firstAvailable)
        setViewDate(firstAvailable)
    }

    const shiftView = (
        amount: number
    ) => {
        if (viewMode === 'DAY') {
            const next = addBusinessDays(selectedDay, amount)

            if (!dateWithinRange(next, dateRange)) return

            setSelectedDay(next)
            setViewDate(next)
            return
        }

        if (viewMode === 'WEEK') {
            const next = viewDate.add(amount, 'week')
            const monday = getMonday(next)
            const friday = monday.add(4, 'day')

            const overlapsRange =
                !friday.isBefore(dateRange[0], 'day') &&
                !monday.isAfter(dateRange[1], 'day')

            if (!overlapsRange) return

            const currentColumn = Math.max(
                0,
                Math.min(4, selectedDay.day() - 1)
            )

            let nextSelected = monday.add(currentColumn, 'day')

            if (!dateWithinRange(nextSelected, dateRange)) {
                const visibleDays = Array.from({ length: 5 }, (_, index) =>
                    monday.add(index, 'day')
                ).filter(day => dateWithinRange(day, dateRange))

                nextSelected = visibleDays[0] || nextSelected
            }

            setViewDate(next)
            setSelectedDay(nextSelected)
            return
        }

        const next = viewDate.add(amount, 'month')
        const monthStart = next.startOf('month')
        const monthEnd = next.endOf('month')

        const overlapsRange =
            !monthEnd.isBefore(dateRange[0], 'day') &&
            !monthStart.isAfter(dateRange[1], 'day')

        if (!overlapsRange) return

        const candidateStart = monthStart.isBefore(dateRange[0], 'day')
            ? dateRange[0]
            : monthStart

        const firstBusinessDay = nextBusinessDay(candidateStart)

        setViewDate(next)

        if (dateWithinRange(firstBusinessDay, dateRange)) {
            setSelectedDay(firstBusinessDay)
        }
    }

    const weekdayHeader = (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns:
                    'repeat(5, minmax(0, 1fr))',
                gap: 10,
                width: '100%',
                paddingInline: 2,
                marginBottom: 8
            }}
        >
            {WEEKDAY_LABELS.map(label => (
                <div
                    key={label}
                    style={{
                        padding:
                            '0 10px 4px',
                        fontSize: 11,
                        color:
                            token.colorTextSecondary,
                        fontWeight: 500
                    }}
                >
                    {label}
                </div>
            ))}
        </div>
    )

    const renderPreviewItem = (
        item: CalendarDayItem,
        compact = false
    ) => {
        const isEvent =
            item.kind === 'event'

        const accent = isEvent
            ? eventColor(item.event)
            : appointmentColor(
                item.appointment
            )

        const label = isEvent
            ? item.event.title ||
            'Event'
            : appointmentService.getAppointmentTitle(
                item.appointment as any
            )

        const time = isEvent
            ? eventTimeLabel(
                item.event
            )
            : appointmentService.formatAppointmentTime(
                item.appointment as any
            )

        return (
            <button
                key={item.id}
                type="button"
                onClick={event => {
                    event.stopPropagation()
                    handleItemClick(item)
                }}
                style={{
                    width: '100%',
                    border: 0,
                    padding: 0,
                    background:
                        'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    minWidth: 0
                }}
            >
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            '3px minmax(0, 1fr)',
                        gap: compact
                            ? 5
                            : 7,
                        minWidth: 0,
                        alignItems:
                            'stretch'
                    }}
                >
                    <span
                        style={{
                            width: 3,
                            minHeight: compact
                                ? 17
                                : 30,
                            borderRadius: 999,
                            background:
                                accent
                        }}
                    />

                    <div
                        style={{
                            minWidth: 0
                        }}
                    >
                        <Text
                            ellipsis={{
                                tooltip:
                                    label
                            }}
                            style={{
                                display:
                                    'block',
                                fontSize: compact
                                    ? 10
                                    : 11,
                                lineHeight: 1.2,
                                fontWeight: 500
                            }}
                        >
                            {label}
                        </Text>

                        {!compact && (
                            <Text
                                type="secondary"
                                style={{
                                    display:
                                        'block',
                                    marginTop: 2,
                                    fontSize: 10
                                }}
                            >
                                {time}
                            </Text>
                        )}
                    </div>
                </div>
            </button>
        )
    }

    const renderDayCard = (
        date: Dayjs,
        size: 'week' | 'month'
    ) => {
        const key =
            date.format('YYYY-MM-DD')

        const items =
            byDay[key] || []

        const selected =
            date.isSame(
                selectedDay,
                'day'
            )

        const inRange =
            dateWithinRange(
                date,
                dateRange
            )

        const todayCard =
            date.isSame(
                today,
                'day'
            )

        const maxPreview =
            size === 'week'
                ? 5
                : 3

        const shown =
            items.slice(
                0,
                maxPreview
            )

        const more =
            Math.max(
                0,
                items.length -
                shown.length
            )

        return (
            <button
                key={key}
                type="button"
                disabled={!inRange}
                onClick={() =>
                    selectDay(date)
                }
                style={{
                    width: '100%',
                    minWidth: 0,
                    minHeight:
                        size === 'week'
                            ? 255
                            : 132,
                    padding:
                        size === 'week'
                            ? '14px 13px'
                            : '10px 10px',
                    borderRadius: 14,
                    border: selected
                        ? `1px solid ${token.colorPrimary}`
                        : `1px solid ${token.colorBorderSecondary}`,
                    background: selected
                        ? token.colorPrimaryBg
                        : token.colorBgContainer,
                    color:
                        token.colorText,
                    textAlign: 'left',
                    cursor: inRange
                        ? 'pointer'
                        : 'default',
                    opacity: inRange
                        ? 1
                        : 0.35,
                    boxShadow: selected
                        ? `0 0 0 1px ${token.colorPrimaryBorder}`
                        : 'none',
                    transition:
                        'border-color .18s ease, background .18s ease, box-shadow .18s ease'
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems:
                            'flex-start',
                        justifyContent:
                            'space-between',
                        gap: 6,
                        marginBottom:
                            size === 'week'
                                ? 20
                                : 12
                    }}
                >
                    <div>
                        <div
                            style={{
                                fontSize:
                                    size ===
                                        'week'
                                        ? 25
                                        : 19,
                                lineHeight: 1,
                                fontWeight: 650
                            }}
                        >
                            {date.format(
                                'D'
                            )}
                        </div>

                        {size ===
                            'week' && (
                                <Text
                                    type="secondary"
                                    style={{
                                        display:
                                            'block',
                                        marginTop: 4,
                                        fontSize: 10
                                    }}
                                >
                                    {date.format(
                                        'MMM'
                                    )}
                                </Text>
                            )}
                    </div>

                    {todayCard && (
                        <span
                            style={{
                                width: 7,
                                height: 7,
                                borderRadius:
                                    999,
                                background:
                                    token.colorPrimary,
                                marginTop: 2
                            }}
                        />
                    )}
                </div>

                {items.length ===
                    0 ? (
                    <Text
                        type="secondary"
                        style={{
                            fontSize: 10
                        }}
                    >
                        No schedule
                    </Text>
                ) : (
                    <Space
                        direction="vertical"
                        size={
                            size ===
                                'week'
                                ? 8
                                : 5
                        }
                        style={{
                            width: '100%'
                        }}
                    >
                        {shown.map(item =>
                            renderPreviewItem(
                                item,
                                size ===
                                'month'
                            )
                        )}

                        {more > 0 && (
                            <Text
                                type="secondary"
                                style={{
                                    fontSize: 10,
                                    fontWeight: 500
                                }}
                            >
                                +{more} more
                            </Text>
                        )}
                    </Space>
                )}
            </button>
        )
    }

    const agendaPanel = (
        <div
            style={{
                minWidth: 0
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems:
                        'center',
                    justifyContent:
                        'space-between',
                    gap: 10,
                    marginBottom: 14
                }}
            >
                <div>
                    <Title
                        level={5}
                        style={{
                            margin: 0
                        }}
                    >
                        {selectedDay.format(
                            'dddd, D MMMM'
                        )}
                    </Title>

                    <Text
                        type="secondary"
                        style={{
                            fontSize: 12
                        }}
                    >
                        Full day schedule
                    </Text>
                </div>

                <Tag
                    color={
                        selectedDayItems.length
                            ? 'blue'
                            : 'default'
                    }
                    style={{
                        marginInlineEnd: 0,
                        borderRadius: 999
                    }}
                >
                    {
                        selectedDayItems.length
                    }{' '}
                    item
                    {selectedDayItems.length ===
                        1
                        ? ''
                        : 's'}
                </Tag>
            </div>

            {selectedDayItems.length ===
                0 ? (
                <Empty
                    image={
                        Empty.PRESENTED_IMAGE_SIMPLE
                    }
                    description="Nothing scheduled for this day."
                    style={{
                        marginBlock: 42
                    }}
                />
            ) : (
                <Space
                    direction="vertical"
                    size={0}
                    style={{
                        width: '100%'
                    }}
                >
                    {selectedDayItems.map(
                        (item, index) => {
                            const isEvent =
                                item.kind ===
                                'event'

                            const accent =
                                isEvent
                                    ? eventColor(
                                        item.event
                                    )
                                    : appointmentColor(
                                        item.appointment
                                    )

                            const time =
                                isEvent
                                    ? eventTimeLabel(
                                        item.event
                                    )
                                    : appointmentService.formatAppointmentTime(
                                        item.appointment as any
                                    )

                            const titleText =
                                isEvent
                                    ? item.event
                                        .title ||
                                    'Event'
                                    : appointmentService.getAppointmentTitle(
                                        item.appointment as any
                                    )

                            const participant =
                                isEvent
                                    ? String(
                                        item.event
                                            .type ||
                                        'Event'
                                    )
                                    : getAppointmentParticipantLabel(
                                        item.appointment
                                    )

                            return (
                                <button
                                    key={
                                        item.id
                                    }
                                    type="button"
                                    onClick={() =>
                                        handleItemClick(
                                            item
                                        )
                                    }
                                    style={{
                                        width: '100%',
                                        border: 0,
                                        padding: 0,
                                        background:
                                            'transparent',
                                        cursor: 'pointer',
                                        textAlign:
                                            'left'
                                    }}
                                >
                                    <div
                                        style={{
                                            display:
                                                'grid',
                                            gridTemplateColumns:
                                                isMobile
                                                    ? '62px minmax(0, 1fr)'
                                                    : '84px minmax(0, 1fr)',
                                            gap: isMobile
                                                ? 10
                                                : 16,
                                            minWidth: 0
                                        }}
                                    >
                                        <div
                                            style={{
                                                paddingTop:
                                                    index ===
                                                        0
                                                        ? 3
                                                        : 16,
                                                textAlign:
                                                    'right'
                                            }}
                                        >
                                            <Text
                                                strong
                                                style={{
                                                    fontSize: 12,
                                                    whiteSpace:
                                                        'nowrap'
                                                }}
                                            >
                                                {time}
                                            </Text>
                                        </div>

                                        <div
                                            style={{
                                                position:
                                                    'relative',
                                                padding:
                                                    index ===
                                                        0
                                                        ? '0 0 14px 18px'
                                                        : '14px 0 14px 18px',
                                                borderLeft: `1px solid ${token.colorBorderSecondary}`
                                            }}
                                        >
                                            <span
                                                style={{
                                                    position:
                                                        'absolute',
                                                    left: -5,
                                                    top:
                                                        index ===
                                                            0
                                                            ? 7
                                                            : 21,
                                                    width: 9,
                                                    height: 9,
                                                    borderRadius:
                                                        999,
                                                    background:
                                                        accent,
                                                    boxShadow: `0 0 0 3px ${token.colorBgLayout}`
                                                }}
                                            />

                                            <div
                                                style={{
                                                    padding:
                                                        '12px 14px',
                                                    borderRadius: 13,
                                                    border: `1px solid ${token.colorBorderSecondary}`,
                                                    background:
                                                        token.colorBgContainer
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        height: 4,
                                                        borderRadius:
                                                            999,
                                                        background:
                                                            accent,
                                                        marginBottom: 10
                                                    }}
                                                />

                                                <Text
                                                    strong
                                                    style={{
                                                        display:
                                                            'block',
                                                        fontSize: 14
                                                    }}
                                                >
                                                    {
                                                        titleText
                                                    }
                                                </Text>

                                                <Text
                                                    type="secondary"
                                                    ellipsis={{
                                                        tooltip:
                                                            participant
                                                    }}
                                                    style={{
                                                        display:
                                                            'block',
                                                        marginTop: 4,
                                                        fontSize: 12
                                                    }}
                                                >
                                                    {isEvent ? (
                                                        <CalendarOutlined />
                                                    ) : appointmentService.isGroupAppointment(
                                                        item.appointment as any
                                                    ) ? (
                                                        <TeamOutlined />
                                                    ) : (
                                                        <UserOutlined />
                                                    )}{' '}
                                                    {
                                                        participant
                                                    }
                                                </Text>

                                                <Space
                                                    size={[
                                                        4,
                                                        4
                                                    ]}
                                                    wrap
                                                    style={{
                                                        marginTop: 9
                                                    }}
                                                >
                                                    <Tag
                                                        color={
                                                            isEvent
                                                                ? 'green'
                                                                : 'blue'
                                                        }
                                                        style={{
                                                            marginInlineEnd: 0
                                                        }}
                                                    >
                                                        {isEvent
                                                            ? 'Event'
                                                            : 'Appointment'}
                                                    </Tag>

                                                    {!isEvent && (
                                                        <Tag
                                                            icon={appointmentDeliveryIcon(
                                                                item.appointment
                                                            )}
                                                            style={{
                                                                marginInlineEnd: 0
                                                            }}
                                                        >
                                                            {appointmentDeliveryLabel(
                                                                item.appointment
                                                            )}
                                                        </Tag>
                                                    )}
                                                </Space>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            )
                        }
                    )}
                </Space>
            )}
        </div>
    )

    const renderDayView = () => (
        <div
            style={{
                maxWidth: 880,
                margin: '0 auto',
                width: '100%'
            }}
        >
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns:
                        isMobile
                            ? '1fr'
                            : '180px minmax(0, 1fr)',
                    gap: 20,
                    alignItems:
                        'start'
                }}
            >
                <div
                    style={{
                        padding:
                            '18px 18px 20px',
                        borderRadius: 16,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        background:
                            token.colorBgContainer,
                        textAlign:
                            'center'
                    }}
                >
                    <Text
                        type="secondary"
                        style={{
                            fontSize: 12,
                            textTransform:
                                'uppercase',
                            letterSpacing:
                                '.08em'
                        }}
                    >
                        {selectedDay.format(
                            'dddd'
                        )}
                    </Text>

                    <div
                        style={{
                            marginTop: 8,
                            fontSize: 54,
                            fontWeight: 700,
                            lineHeight: 1,
                            color:
                                token.colorText
                        }}
                    >
                        {selectedDay.format(
                            'D'
                        )}
                    </div>

                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            marginTop: 8
                        }}
                    >
                        {selectedDay.format(
                            'MMMM YYYY'
                        )}
                    </Text>

                    <div
                        style={{
                            marginTop: 16,
                            paddingTop: 14,
                            borderTop: `1px solid ${token.colorBorderSecondary}`
                        }}
                    >
                        <Text strong>
                            {
                                selectedDayItems.length
                            }
                        </Text>{' '}
                        <Text type="secondary">
                            scheduled item
                            {selectedDayItems.length ===
                                1
                                ? ''
                                : 's'}
                        </Text>
                    </div>
                </div>

                {agendaPanel}
            </div>
        </div>
    )

    const renderWeekView = () => (
        <div
            style={{
                minWidth: 0
            }}
        >
            <div
                style={{
                    minWidth: 760,
                    overflow: 'hidden'
                }}
            >
                {weekdayHeader}

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            'repeat(5, minmax(0, 1fr))',
                        gap: 10
                    }}
                >
                    {currentWeekDays.map(
                        day =>
                            renderDayCard(
                                day,
                                'week'
                            )
                    )}
                </div>
            </div>

            <div
                style={{
                    marginTop: 22,
                    paddingTop: 18,
                    borderTop: `1px solid ${token.colorBorderSecondary}`,
                    maxWidth: 920
                }}
            >
                {agendaPanel}
            </div>
        </div>
    )

    const renderMonthView = () => (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns:
                    isMobile
                        ? '1fr'
                        : 'minmax(0, 1fr) 320px',
                gap: 18,
                minWidth: 0,
                alignItems: 'start'
            }}
        >
            <div
                style={{
                    minWidth: 0,
                    overflowX: 'auto'
                }}
            >
                <div
                    style={{
                        minWidth: 760
                    }}
                >
                    {weekdayHeader}

                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns:
                                'repeat(5, minmax(0, 1fr))',
                            gap: 8
                        }}
                    >
                        {monthCells.map(
                            (date, index) =>
                                date ? (
                                    renderDayCard(
                                        date,
                                        'month'
                                    )
                                ) : (
                                    <div
                                        key={`blank-${index}`}
                                        style={{
                                            minHeight: 132
                                        }}
                                    />
                                )
                        )}
                    </div>
                </div>
            </div>

            <div
                style={{
                    minWidth: 0,
                    paddingLeft:
                        isMobile
                            ? 0
                            : 18,
                    borderLeft:
                        isMobile
                            ? undefined
                            : `1px solid ${token.colorBorderSecondary}`,
                    position:
                        isMobile
                            ? 'static'
                            : 'sticky',
                    top: 0
                }}
            >
                {agendaPanel}
            </div>
        </div>
    )

    const headerLabel =
        viewMode === 'DAY'
            ? selectedDay.format(
                'dddd, D MMMM YYYY'
            )
            : viewMode === 'WEEK'
                ? `${currentWeekDays[0].format(
                    'D MMM'
                )} - ${currentWeekDays[4].format(
                    'D MMM YYYY'
                )}`
                : viewDate.format(
                    'MMMM YYYY'
                )

    return (
        <Modal
            open={open}
            title={title}
            onCancel={onClose}
            footer={null}
            width={width}
            styles={{
                body: {
                    padding: 0
                }
            }}
            style={{
                top: 20
            }}
            destroyOnHidden
        >
            <div
                style={{
                    height,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}
            >
                <div
                    style={{
                        padding: isMobile
                            ? 12
                            : '12px 16px',
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        background:
                            token.colorBgContainer
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems:
                                'center',
                            gap: 10,
                            flexWrap: 'wrap'
                        }}
                    >
                        <div
                            style={{
                                marginRight:
                                    'auto',
                                minWidth: 200
                            }}
                        >
                            <Title
                                level={5}
                                style={{
                                    margin: 0
                                }}
                            >
                                {headerLabel}
                            </Title>

                            <Text
                                type="secondary"
                                style={{
                                    fontSize: 12
                                }}
                            >
                                {
                                    rangedAppointments.length
                                }{' '}
                                appointment
                                {rangedAppointments.length ===
                                    1
                                    ? ''
                                    : 's'}{' '}
                                ·{' '}
                                {
                                    rangedEvents.length
                                }{' '}
                                event
                                {rangedEvents.length ===
                                    1
                                    ? ''
                                    : 's'}{' '}
                                in selected range
                            </Text>
                        </div>

                        <Segmented
                            value={viewMode}
                            onChange={value => {
                                const next = value as ViewMode
                                setViewMode(next)
                                setViewDate(selectedDay)
                            }}
                            options={[
                                {
                                    label: 'Daily',
                                    value: 'DAY'
                                },
                                {
                                    label: 'Weekly',
                                    value: 'WEEK'
                                },
                                {
                                    label: 'Monthly',
                                    value: 'MONTH'
                                }
                            ]}
                        />

                        <RangePicker
                            value={
                                dateRange
                            }
                            presets={
                                rangePresets
                            }
                            allowClear={
                                false
                            }
                            onChange={
                                applyDateRange
                            }
                            format="DD MMM YYYY"
                            style={{
                                width: isMobile
                                    ? '100%'
                                    : 245
                            }}
                        />

                        <Select
                            value={
                                deliveryFilter
                            }
                            onChange={
                                setDeliveryFilter
                            }
                            style={{
                                width: 138
                            }}
                            options={[
                                {
                                    label: 'All delivery',
                                    value: 'all'
                                },
                                {
                                    label: 'Online',
                                    value: 'virtual'
                                },
                                {
                                    label: 'In person',
                                    value: 'in_person'
                                },
                                {
                                    label: 'Telephonic',
                                    value: 'telephonically'
                                },
                                {
                                    label: 'Hybrid',
                                    value: 'hybrid'
                                }
                            ]}
                        />

                        <Select
                            value={
                                statusFilter
                            }
                            onChange={
                                setStatusFilter
                            }
                            style={{
                                width: 132
                            }}
                            options={[
                                {
                                    label: 'All status',
                                    value: 'all'
                                },
                                {
                                    label: 'Scheduled',
                                    value: 'scheduled'
                                },
                                {
                                    label: 'In progress',
                                    value: 'in-progress'
                                },
                                {
                                    label: 'Completed',
                                    value: 'completed'
                                },
                                {
                                    label: 'Cancelled',
                                    value: 'cancelled'
                                }
                            ]}
                        />

                        <Space size={4}>
                            <Button
                                shape="circle"
                                size="small"
                                icon={
                                    <LeftOutlined />
                                }
                                onClick={() =>
                                    shiftView(
                                        -1
                                    )
                                }
                            />

                            <Button
                                size="small"
                                onClick={
                                    goCurrent
                                }
                            >
                                Current
                            </Button>

                            <Button
                                shape="circle"
                                size="small"
                                icon={
                                    <RightOutlined />
                                }
                                onClick={() =>
                                    shiftView(
                                        1
                                    )
                                }
                            />
                        </Space>
                    </div>
                </div>

                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: 'auto',
                        padding: isMobile
                            ? 12
                            : 16,
                        background:
                            token.colorBgLayout
                    }}
                >
                    {viewMode ===
                        'DAY'
                        ? renderDayView()
                        : viewMode ===
                            'WEEK'
                            ? renderWeekView()
                            : renderMonthView()}
                </div>
            </div>

            <EventDetailsModal
                open={Boolean(
                    selectedEvent
                )}
                onClose={() =>
                    setSelectedEvent(null)
                }
                event={selectedEvent}
            />
        </Modal>
    )
}

export default AppointmentsCalendarModal
