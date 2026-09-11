import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Alert,
    Card,
    Col,
    Descriptions,
    Divider,
    Input,
    Modal,
    Row,
    Segmented,
    Select,
    Space,
    Table,
    Tag,
    Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ClockCircleOutlined,
    CoffeeOutlined,
    EnvironmentOutlined,
    FileTextOutlined,
    LinkOutlined,
    PhoneOutlined,
    SearchOutlined,
    TeamOutlined,
    UserOutlined,
    VideoCameraOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import * as appointmentService from '@/services/appointmentService'

dayjs.extend(customParseFormat)

const { Text, Paragraph, Title } = Typography
const { Search } = Input

export type AppointmentFoodSelection = {
    itemId?: string
    menuItemId?: string
    itemName?: string
    name?: string
    participantId?: string
    participantName?: string
    participantEmail?: string
    category?: string
    itemCategory?: string
    quantity?: number
    [key: string]: any
}

export type AppointmentMember = {
    id?: string
    participantId?: string
    participantName?: string
    participantEmail?: string
    beneficiaryName?: string
    email?: string
    smeConfirmation?: string
    userConfirmation?: string
    beneficiaryConfirmation?: string
    confirmationStatus?: string
    appointmentResponseStatus?: string
    status?: string
    smeDeclineReason?: string | null
    declineReason?: string | null
    userRejectionReason?: string | null
    foodSelections?: AppointmentFoodSelection[]
    [key: string]: any
}

export type AppointmentFoodMenuItem = {
    id?: string
    itemId?: string
    name?: string
    label?: string
    category?: string
    description?: string
    dietaryNote?: string
    quantityAvailable?: number | null
    [key: string]: any
}

export type AppointmentDetailsRecord = {
    id: string
    title?: string
    interventionTitle?: string
    sessionTitle?: string
    appointmentType?: string
    date?: string
    start?: any
    end?: any
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
    deliveryMethod?: string
    delivery?: {
        mode?: string
        location?: {
            venue?: string
            address?: string
        } | null
        meeting?: {
            platform?: string
            link?: string
        } | null
    }
    location?: string
    meetingLink?: string
    description?: string
    status?: string
    declineReason?: string
    userConfirmation?: string
    beneficiaryConfirmation?: string
    participantId?: string
    participantName?: string
    participantEmail?: string
    coordinatorId?: string
    coordinatorName?: string
    coordinatorEmail?: string
    assigneeId?: string
    allocationType?: string
    isGroupAppointment?: boolean
    groupKey?: string
    groupTitle?: string
    groupMemberCount?: number
    groupParticipantCount?: number
    groupMembers?: AppointmentMember[]
    _displayType?: 'single' | 'group'
    _groupMembers?: AppointmentMember[]
    foodMenuEnabled?: boolean
    foodMenu?: AppointmentFoodMenuItem[]
    foodSelections?: AppointmentFoodSelection[]
    attendance?: {
        summary?: {
            count?: number
            checkedInEmails?: string[]
            checkedOutEmails?: string[]
            lastCheckInAt?: any
            lastCheckOutAt?: any
        }
        checkIns?: any[]
        checkOuts?: any[]
        session?: any
    }
    attendanceSummary?: {
        count?: number
        checkedOutCount?: number
        currentlyPresentCount?: number
        checkedInEmails?: string[]
        checkedOutEmails?: string[]
        lastCheckInAt?: any
        lastCheckOutAt?: any
    }
    attendeeCheckIns?: any[]
    attendeeCheckOuts?: any[]
    meetingNotes?: {
        latest?: {
            held?: boolean
            discussed?: string
            issues?: string
            reasonNotHeld?: string
            createdAt?: any
            createdByName?: string
        }
    }
    sessionCoverage?: {
        title?: string
        plannedCoverage?: string[]
        latest?: {
            held?: boolean
            title?: string
            coveredPoints?: string[]
            notes?: string
            reasonNotHeld?: string
            createdAt?: any
            createdByName?: string
        }
        history?: any[]
    }
    plannedCoverage?: string[]
    snapshot?: {
        beneficiaryName?: string
        assigneeName?: string
        interventionTitle?: string
        departmentName?: string
        groupTitle?: string | null
    }
    [key: string]: any
}

type Props = {
    open: boolean
    onClose: () => void
    appointment?: AppointmentDetailsRecord | null
    width?: number | string
    title?: React.ReactNode
}

type MemberRow = {
    key: string
    name: string
    email: string
    confirmationStatus?: string
    status?: string
    checkedIn?: boolean
    checkedOut?: boolean
    attendanceStatus?: appointmentService.AttendanceStatus
    foodSelections?: AppointmentFoodSelection[]
}

const lower = (value: any) =>
    String(value || '')
        .trim()
        .toLowerCase()

const capitalize = (value?: string) => {
    const text = String(value || '').trim()
    if (!text) return '-'
    return text
        .replace(/[-_]/g, ' ')
        .replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
}

const normalizeStatus = (value?: string) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s|_/g, '-')

const statusLabel = (value?: string) => {
    const normalized = normalizeStatus(value)
    if (['confirmed', 'accepted', 'approved', 'yes', 'attended'].includes(normalized))
        return 'confirmed'
    if (['pending', 'awaiting', 'invited', 'requested', 'scheduled'].includes(normalized))
        return 'pending'
    if (['declined', 'rejected', 'no', 'cancelled', 'canceled'].includes(normalized))
        return 'declined'
    return normalized || 'unknown'
}

const statusTag = (value?: string) => {
    const normalized = statusLabel(value)

    if (normalized === 'confirmed') return <Tag color="green">Confirmed</Tag>
    if (normalized === 'pending') return <Tag color="orange">Pending</Tag>
    if (normalized === 'declined') return <Tag color="red">Declined</Tag>
    if (normalized === 'unknown') return <Text type="secondary">-</Text>

    return <Tag>{capitalize(value)}</Tag>
}

const appointmentStatusTag = (value?: string) => {
    const normalized = normalizeStatus(value)

    if (!normalized) return <Text type="secondary">-</Text>
    if (['scheduled', 'pending'].includes(normalized)) return <Tag color="blue">Scheduled</Tag>
    if (['in-progress', 'in_progress'].includes(normalized))
        return <Tag color="processing">In Progress</Tag>
    if (['completed', 'done'].includes(normalized)) return <Tag color="green">Completed</Tag>
    if (['cancelled', 'canceled'].includes(normalized)) return <Tag color="red">Cancelled</Tag>

    return <Tag>{capitalize(value)}</Tag>
}

const isTimeOnly = (value: any) =>
    typeof value === 'string' && /^\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i.test(value.trim())

const normaliseDateKey = (value: any) => {
    const raw = String(value || '').trim()
    if (!raw) return ''

    const parsedStrict = dayjs(raw, ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY'], true)
    if (parsedStrict.isValid()) return parsedStrict.format('YYYY-MM-DD')

    const parsedLoose = dayjs(raw)
    return parsedLoose.isValid() ? parsedLoose.format('YYYY-MM-DD') : raw
}

const toDateFromFirestore = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value instanceof Date) return value
    if (typeof value === 'object' && typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000)
    }
    return null
}

const parseTimeOnly = (value: any, dateKey: string) => {
    if (!isTimeOnly(value) || !dateKey) return null

    const raw = String(value).trim().toUpperCase()
    const parsedTime = dayjs(raw, ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'hh:mm A'], true)
    if (!parsedTime.isValid()) return null

    const combined = dayjs(`${dateKey} ${parsedTime.format('HH:mm')}`, 'YYYY-MM-DD HH:mm', true)
    return combined.isValid() ? combined : null
}

const parseMaybeDateTime = (value: any, dateKey: string) => {
    if (!value) return { date: null as Dayjs | null, hasTime: false }

    const timeOnly = parseTimeOnly(value, dateKey)
    if (timeOnly) return { date: timeOnly, hasTime: true }

    const firestoreDate = toDateFromFirestore(value)
    if (firestoreDate) {
        const parsed = dayjs(firestoreDate)
        if (!parsed.isValid()) return { date: null as Dayjs | null, hasTime: false }

        const hasTime = parsed.hour() !== 0 || parsed.minute() !== 0 || parsed.second() !== 0
        if (dateKey && hasTime) {
            const combined = dayjs(`${dateKey} ${parsed.format('HH:mm')}`, 'YYYY-MM-DD HH:mm', true)
            return { date: combined.isValid() ? combined : parsed, hasTime: true }
        }

        return { date: parsed, hasTime }
    }

    if (typeof value === 'string') {
        const raw = value.trim()
        if (!raw) return { date: null as Dayjs | null, hasTime: false }

        const parsedStrict = dayjs(
            raw,
            [
                'YYYY-MM-DD HH:mm',
                'YYYY-MM-DDTHH:mm:ss',
                'YYYY-MM-DDTHH:mm:ssZ',
                'DD/MM/YYYY HH:mm',
                'DD-MM-YYYY HH:mm',
            ],
            true
        )

        const parsedLoose = parsedStrict.isValid() ? parsedStrict : dayjs(raw)
        if (!parsedLoose.isValid()) return { date: null as Dayjs | null, hasTime: false }

        const hasTime =
            parsedLoose.hour() !== 0 || parsedLoose.minute() !== 0 || parsedLoose.second() !== 0
        if (dateKey && hasTime) {
            const combined = dayjs(
                `${dateKey} ${parsedLoose.format('HH:mm')}`,
                'YYYY-MM-DD HH:mm',
                true
            )
            return { date: combined.isValid() ? combined : parsedLoose, hasTime: true }
        }

        return { date: parsedLoose, hasTime }
    }

    return { date: null as Dayjs | null, hasTime: false }
}

const getDateKey = (appointment?: AppointmentDetailsRecord | null) =>
    normaliseDateKey(
        appointment?.date ||
            appointment?.schedule?.dateKey ||
            appointment?.scheduledDate ||
            appointment?.appointmentDate ||
            ''
    )

const getStartCandidates = (appointment: AppointmentDetailsRecord) => [
    appointment.startTime,
    appointment.startTimeString,
    appointment.start,
    appointment.schedule?.startTime,
    appointment.schedule?.startAt,
    appointment.sessionStartTime,
    appointment.time,
]

const getEndCandidates = (appointment: AppointmentDetailsRecord) => [
    appointment.endTime,
    appointment.endTimeString,
    appointment.end,
    appointment.schedule?.endTime,
    appointment.schedule?.endAt,
    appointment.sessionEndTime,
]

const resolveFirstDateTime = (appointment: AppointmentDetailsRecord, values: any[]) => {
    const dateKey = getDateKey(appointment)

    for (const value of values) {
        const parsed = parseMaybeDateTime(value, dateKey)
        if (parsed.date?.isValid() && parsed.hasTime) return parsed
    }

    for (const value of values) {
        const parsed = parseMaybeDateTime(value, dateKey)
        if (parsed.date?.isValid()) return parsed
    }

    if (dateKey) {
        const fallback = dayjs(dateKey, 'YYYY-MM-DD', true)
        return { date: fallback.isValid() ? fallback : null, hasTime: false }
    }

    return { date: null as Dayjs | null, hasTime: false }
}

const resolveStart = (appointment: AppointmentDetailsRecord) =>
    resolveFirstDateTime(appointment, getStartCandidates(appointment))

const resolveEnd = (appointment: AppointmentDetailsRecord) =>
    resolveFirstDateTime(appointment, getEndCandidates(appointment))

const formatDate = (appointment?: AppointmentDetailsRecord | null) => {
    if (!appointment) return '-'
    const dateKey = getDateKey(appointment)
    const parsed = dateKey ? dayjs(dateKey, 'YYYY-MM-DD', true) : resolveStart(appointment).date
    return parsed?.isValid() ? parsed.format('DD MMM YYYY') : '-'
}

const formatTimeRange = (appointment?: AppointmentDetailsRecord | null) => {
    if (!appointment) return 'Time not set'

    const start = resolveStart(appointment)
    const end = resolveEnd(appointment)

    if (!start.date?.isValid() || !start.hasTime) return 'Time not set'

    const startLabel = start.date.format('HH:mm')
    const endLabel = end.date?.isValid() && end.hasTime ? end.date.format('HH:mm') : ''

    return endLabel ? `${startLabel} - ${endLabel}` : startLabel
}

const getAppointmentTitle = (appointment?: AppointmentDetailsRecord | null) =>
    String(
        appointment?.sessionTitle ||
            appointment?.groupTitle ||
            appointment?.interventionTitle ||
            appointment?.title ||
            appointment?.snapshot?.interventionTitle ||
            'Appointment'
    )

const getDeliveryMethod = (appointment?: AppointmentDetailsRecord | null) => {
    const raw = lower(appointment?.deliveryMethod || appointment?.delivery?.mode)

    if (raw === 'online') return 'virtual'
    if (raw === 'in-person' || raw === 'in person') return 'in_person'
    if (raw === 'telephonic' || raw === 'telephone') return 'telephonically'
    if (raw === 'hybrid') return 'hybrid'

    return raw
}

const deliveryTag = (appointment?: AppointmentDetailsRecord | null) => {
    const method = getDeliveryMethod(appointment)

    if (method === 'virtual') {
        return (
            <Tag color="blue" icon={<VideoCameraOutlined />}>
                Online
            </Tag>
        )
    }

    if (method === 'in_person') {
        return (
            <Tag color="cyan" icon={<EnvironmentOutlined />}>
                In Person
            </Tag>
        )
    }

    if (method === 'telephonically') {
        return (
            <Tag color="geekblue" icon={<PhoneOutlined />}>
                Telephonic
            </Tag>
        )
    }

    if (method === 'hybrid') {
        return (
            <Tag color="purple" icon={<TeamOutlined />}>
                Hybrid
            </Tag>
        )
    }

    return <Text type="secondary">-</Text>
}

const getMeetingLink = (appointment?: AppointmentDetailsRecord | null) =>
    String(
        appointment?.meetingLink ||
            appointment?.delivery?.meeting?.link ||
            appointment?.link ||
            appointment?.meetLink ||
            ''
    ).trim()

const getLocation = (appointment?: AppointmentDetailsRecord | null) =>
    String(
        appointment?.location ||
            appointment?.delivery?.location?.venue ||
            appointment?.delivery?.location?.address ||
            ''
    ).trim()

const getMembers = (appointment?: AppointmentDetailsRecord | null): AppointmentMember[] => {
    if (!appointment) return []

    if (Array.isArray(appointment._groupMembers) && appointment._groupMembers.length) {
        return appointment._groupMembers
    }

    if (Array.isArray(appointment.groupMembers) && appointment.groupMembers.length) {
        return appointment.groupMembers
    }

    if (
        appointment.participantId ||
        appointment.participantName ||
        appointment.snapshot?.beneficiaryName
    ) {
        return [
            {
                id: appointment.id,
                participantId: appointment.participantId,
                participantName:
                    appointment.participantName || appointment.snapshot?.beneficiaryName,
                participantEmail: appointment.participantEmail,
                userConfirmation: appointment.userConfirmation,
                beneficiaryConfirmation: appointment.beneficiaryConfirmation,
                status: appointment.status,
                foodSelections: appointment.foodSelections || [],
            },
        ]
    }

    return []
}

const isGroupAppointment = (appointment?: AppointmentDetailsRecord | null) =>
    appointment?._displayType === 'group' ||
    Boolean(appointment?.isGroupAppointment) ||
    appointment?.allocationType === 'group' ||
    getMembers(appointment).length > 1

const getMemberCount = (appointment?: AppointmentDetailsRecord | null) => {
    const members = getMembers(appointment)
    return Number(
        appointment?.groupParticipantCount || appointment?.groupMemberCount || members.length || 0
    )
}

const normalizeFoodMenuItems = (value: any): AppointmentFoodMenuItem[] => {
    if (!Array.isArray(value)) return []

    return value
        .map((item) => ({
            id: String(item?.id || item?.itemId || item?.name || ''),
            name: String(item?.name || item?.label || '').trim(),
            category: String(item?.category || 'meal').trim(),
            description: String(item?.description || '').trim(),
            dietaryNote: String(item?.dietaryNote || '').trim(),
            quantityAvailable: item?.quantityAvailable ?? null,
        }))
        .filter((item) => item.name)
}

const getFoodSelectionItemName = (
    selection: AppointmentFoodSelection,
    menu: AppointmentFoodMenuItem[]
) => {
    const directName = String(selection.itemName || selection.name || '').trim()
    if (directName) return directName

    const selectedItemId = String(selection.menuItemId || selection.itemId || '').trim()
    const menuItem = menu.find((item) =>
        [item.id, item.itemId].some((value) => String(value || '').trim() === selectedItemId)
    )

    return String(menuItem?.name || menuItem?.label || 'Unknown menu item').trim()
}

const getFoodSelections = (
    appointment?: AppointmentDetailsRecord | null
): AppointmentFoodSelection[] => {
    if (!appointment) return []

    const ownSelections = (
        Array.isArray(appointment.foodSelections) ? appointment.foodSelections : []
    ).map((selection) => ({
        ...selection,
        participantId: selection.participantId || appointment.participantId,
        participantName:
            selection.participantName ||
            appointment.participantName ||
            appointment.snapshot?.beneficiaryName,
        participantEmail: selection.participantEmail || appointment.participantEmail,
    }))
    const memberSelections = getMembers(appointment).flatMap((member) =>
        (Array.isArray(member.foodSelections) ? member.foodSelections : []).map((selection) => ({
            ...selection,
            participantId: selection.participantId || member.participantId || member.id,
            participantName:
                selection.participantName || member.participantName || member.beneficiaryName,
            participantEmail: selection.participantEmail || member.participantEmail || member.email,
        }))
    )

    const seen = new Set<string>()
    return [...ownSelections, ...memberSelections].filter((selection, index) => {
        const participantKey = selection.participantId || selection.participantEmail || ''
        const itemKey =
            selection.menuItemId || selection.itemId || selection.itemName || selection.name || ''
        const key =
            participantKey || itemKey
                ? `${participantKey}|${itemKey}|${selection.quantity || 1}`
                : `selection:${index}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

const checkedInEmails = (appointment?: AppointmentDetailsRecord | null) =>
    Array.from(
        new Set(
            [
                ...((appointment?.attendance?.summary?.checkedInEmails as string[]) || []),
                ...((appointment?.attendanceSummary?.checkedInEmails as string[]) || []),
            ]
                .map((email) =>
                    String(email || '')
                        .trim()
                        .toLowerCase()
                )
                .filter(Boolean)
        )
    )

const checkedOutEmails = (appointment?: AppointmentDetailsRecord | null) =>
    Array.from(
        new Set(
            [
                ...((appointment?.attendance?.summary?.checkedOutEmails as string[]) || []),
                ...((appointment?.attendanceSummary?.checkedOutEmails as string[]) || []),
            ]
                .map((email) =>
                    String(email || '')
                        .trim()
                        .toLowerCase()
                )
                .filter(Boolean)
        )
    )

const isEmailInList = (email: string, list: string[]) =>
    Boolean(email) &&
    list.includes(
        String(email || '')
            .trim()
            .toLowerCase()
    )

const GroupHero: React.FC<{ appointment?: AppointmentDetailsRecord | null }> = ({
    appointment,
}) => {
    const count = getMemberCount(appointment)

    if (!isGroupAppointment(appointment)) return null

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                padding: '14px 16px',
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(114,46,209,.12), rgba(22,119,255,.09))',
                border: '1px solid rgba(114,46,209,.18)',
                marginBottom: 14,
                flexWrap: 'wrap',
            }}
        >
            <Space align="center" size={12}>
                <div
                    style={{
                        width: 42,
                        height: 42,
                        borderRadius: 14,
                        display: 'grid',
                        placeItems: 'center',
                        background: '#fff',
                        color: '#722ed1',
                        boxShadow: '0 8px 20px rgba(114,46,209,.14)',
                    }}
                >
                    <TeamOutlined style={{ fontSize: 20 }} />
                </div>
                <div>
                    <Text strong style={{ display: 'block' }}>
                        Group Session
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {count} SME{count === 1 ? '' : 's'} linked to this appointment slot
                    </Text>
                </div>
            </Space>

            <Tag
                style={{
                    borderRadius: 999,
                    padding: '5px 12px',
                    marginInlineEnd: 0,
                    fontWeight: 700,
                    border: '1px solid rgba(114,46,209,.25)',
                    color: '#391085',
                    background: '#fff',
                }}
            >
                {appointment?.groupTitle || 'Grouped appointment'}
            </Tag>
        </div>
    )
}

const AppointmentDetailsModal: React.FC<Props> = ({
    open,
    onClose,
    appointment,
    width = 980,
    title = 'Appointment Details',
}) => {
    const [participantQuery, setParticipantQuery] = useState('')
    const [confirmationFilter, setConfirmationFilter] = useState<string>('all')
    const [activeSection, setActiveSection] = useState<string>('overview')

    useEffect(() => {
        if (!open) return
        console.log('AppointmentDetails opened with appointment:', appointment)
        setActiveSection('overview')
        setParticipantQuery('')
        setConfirmationFilter('all')
    }, [open, appointment?.id])

    const members = useMemo<MemberRow[]>(() => {
        return appointmentService.getAppointmentMembers(appointment as any).map((member, index) => {
            return {
                key: String(member.id || member.participantId || index),
                name: String(
                    member.participantName ||
                        member.beneficiaryName ||
                        member.participantId ||
                        'Unknown SME'
                ),
                email: String(member.participantEmail || member.email || '').trim(),
                confirmationStatus:
                    member.smeConfirmation ||
                    member.userConfirmation ||
                    member.beneficiaryConfirmation ||
                    member.confirmationStatus ||
                    member.appointmentResponseStatus,
                status: member.status,
                checkedIn: ['checked-in', 'checked-out'].includes(member.attendanceStatus || ''),
                checkedOut: member.attendanceStatus === 'checked-out',
                attendanceStatus: member.attendanceStatus,
                declineReason: appointmentService.getAppointmentDeclineReason(member),
                foodSelections: member.foodSelections || [],
            }
        })
    }, [appointment])

    const filteredMembers = useMemo(() => {
        const query = participantQuery.trim().toLowerCase()

        return members.filter((member) => {
            const matchesQuery =
                !query ||
                member.name.toLowerCase().includes(query) ||
                member.email.toLowerCase().includes(query)

            const matchesStatus =
                confirmationFilter === 'all' ||
                statusLabel(member.confirmationStatus) === confirmationFilter

            return matchesQuery && matchesStatus
        })
    }, [members, participantQuery, confirmationFilter])

    if (!appointment) {
        return (
            <Modal
                centered
                open={open}
                onCancel={onClose}
                footer={null}
                title={title}
                width={width}
            >
                <Text type="secondary">No appointment selected.</Text>
            </Modal>
        )
    }

    const metrics = appointmentService.getAppointmentMetrics(appointment as any)
    const memberCount = metrics.total
    const attendanceCount = metrics.checkedIn
    const absentCount = metrics.absent
    const foodMenu = normalizeFoodMenuItems(appointment.foodMenu)
    const foodSelections = getFoodSelections(appointment)
    const isGroup = isGroupAppointment(appointment)
    const hasFood = Boolean(
        foodMenu.length ||
            foodSelections.length ||
            members.some((member) => member.foodSelections?.length)
    )
    const meetingLink = appointmentService.getMeetingLink(appointment as any)
    const location = appointmentService.getLocation(appointment as any)
    const method = appointmentService.getDeliveryMethod(appointment as any)
    const topics = appointmentService.getAppointmentTopics(appointment as any)
    const declinedMembers = members.filter(
        (member) => statusLabel(member.confirmationStatus) === 'declined'
    )
    const getFoodSelectionCountForItem = (item: AppointmentFoodMenuItem) => {
        const itemIds = new Set(
            [item.id, item.itemId].map((value) => String(value || '').trim()).filter(Boolean)
        )
        const itemName = lower(item.name || item.label)

        return foodSelections.filter((selection) => {
            const selectionId = String(selection.menuItemId || selection.itemId || '').trim()
            if (selectionId && itemIds.has(selectionId)) return true

            return lower(getFoodSelectionItemName(selection, foodMenu)) === itemName
        }).length
    }

    const columns: ColumnsType<MemberRow> = [
        {
            title: 'SME',
            dataIndex: 'name',
            key: 'name',
            render: (_: string, row) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{row.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {row.email || 'No email on file'}
                    </Text>
                </Space>
            ),
        },
        {
            title: 'Confirmation',
            dataIndex: 'confirmationStatus',
            key: 'confirmationStatus',
            width: 150,
            render: (value, row) => (
                <Space direction="vertical" size={2}>
                    {statusTag(value)}
                    {statusLabel(value) === 'declined' && row.declineReason ? (
                        <Text type="danger" style={{ fontSize: 12 }}>
                            {row.declineReason}
                        </Text>
                    ) : null}
                </Space>
            ),
        },
        {
            title: 'Attendance',
            key: 'attendance',
            width: 180,
            render: (_, row) => {
                if (row.attendanceStatus === 'absent') return <Tag color="red">Absent</Tag>
                if (row.attendanceStatus === 'declined') return <Tag color="default">Declined</Tag>
                if (row.attendanceStatus === 'checked-out')
                    return <Tag color="green">Attended · Checked Out</Tag>
                if (row.attendanceStatus === 'checked-in')
                    return <Tag color="processing">Checked In</Tag>
                return <Tag color="blue">Expected</Tag>
            },
        },
        ...(hasFood
            ? [
                  {
                      title: 'Food Choice',
                      key: 'foodSelections',
                      width: 220,
                      render: (_, row) => {
                          if (!row.foodSelections?.length) return <Text type="secondary">-</Text>
                          return (
                              <Space wrap>
                                  {row.foodSelections.map((selection, index) => (
                                      <Tag
                                          key={`${
                                              selection.menuItemId ||
                                              selection.itemId ||
                                              selection.itemName ||
                                              index
                                          }`}
                                          color="purple"
                                      >
                                          {getFoodSelectionItemName(selection, foodMenu)}
                                      </Tag>
                                  ))}
                              </Space>
                          )
                      },
                  },
              ]
            : []),
    ]

    return (
        <Modal
            centered
            open={open}
            onCancel={onClose}
            footer={[
                <Button danger key="close" onClick={onClose}>
                    Close
                </Button>,
            ]}
            title={title}
            width={width}
            destroyOnClose
            styles={{ body: { maxHeight: '76vh', overflowY: 'auto', overflowX: 'hidden' } }}
        >
            <div style={{ padding: 8 }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 14,
                        flexWrap: 'wrap',
                        marginBottom: 14,
                    }}
                >
                    <Space align="start" size={12}>
                        <div
                            style={{
                                width: 46,
                                height: 46,
                                borderRadius: 14,
                                display: 'grid',
                                placeItems: 'center',
                                background: 'rgba(22,119,255,.1)',
                                color: '#1677ff',
                            }}
                        >
                            <CalendarOutlined style={{ fontSize: 21 }} />
                        </div>
                        <div>
                            <Title level={5} style={{ margin: 0 }}>
                                {getAppointmentTitle(appointment)}
                            </Title>
                            <Text type="secondary">
                                {appointment.snapshot?.departmentName ||
                                    appointment.departmentName ||
                                    'Appointment schedule details'}
                            </Text>
                        </div>
                    </Space>

                    <Space wrap>
                        {appointmentStatusTag(appointment.status)}
                        {deliveryTag(appointment)}
                    </Space>
                </div>

                <GroupHero appointment={appointment} />

                <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
                    <Col xs={12} md={6}>
                        <MotionCard.Metric
                            title="SMEs"
                            value={memberCount}
                            icon={<TeamOutlined style={{ color: '#1677ff' }} />}
                            iconBg="rgba(22,119,255,.1)"
                        />
                    </Col>
                    <Col xs={12} md={6}>
                        <MotionCard.Metric
                            title="Confirmed"
                            value={metrics.confirmed}
                            icon={<CheckCircleOutlined style={{ color: '#16a34a' }} />}
                            iconBg="rgba(22,163,74,.1)"
                        />
                    </Col>
                    <Col xs={12} md={6}>
                        <MotionCard.Metric
                            title="Attended"
                            value={attendanceCount}
                            icon={<UserOutlined style={{ color: '#722ed1' }} />}
                            iconBg="rgba(114,46,209,.1)"
                        />
                    </Col>
                    <Col xs={12} md={6}>
                        <MotionCard.Metric
                            title="Absent"
                            value={absentCount}
                            icon={<CloseCircleOutlined style={{ color: '#dc2626' }} />}
                            iconBg="rgba(220,38,38,.1)"
                        />
                    </Col>
                </Row>

                <MotionCard size="small" style={{ marginBottom: 16 }}>
                    <Segmented
                        block
                        value={activeSection}
                        onChange={(value) => setActiveSection(String(value))}
                        options={[
                            { label: 'Overview', value: 'overview' },
                            {
                                label: `Attendance (${attendanceCount}/${memberCount})`,
                                value: 'smes',
                            },
                            { label: 'Topics', value: 'topics' },
                            ...(hasFood ? [{ label: 'Catering', value: 'catering' }] : []),
                        ]}
                        style={{ marginBottom: 16 }}
                    />
                    {activeSection === 'overview' ? (
                        <Descriptions bordered column={1} size="middle">
                            <Descriptions.Item label="Date">
                                <Space>
                                    <CalendarOutlined />
                                    <span>{formatDate(appointment)}</span>
                                </Space>
                            </Descriptions.Item>

                            <Descriptions.Item label="Time">
                                <Space>
                                    <ClockCircleOutlined />
                                    <span>{formatTimeRange(appointment)}</span>
                                </Space>
                            </Descriptions.Item>

                            {!isGroupAppointment(appointment) ? (
                                <Descriptions.Item label="SME">
                                    <Space>
                                        <UserOutlined />
                                        <span>
                                            {appointment.participantName ||
                                                appointment.snapshot?.beneficiaryName ||
                                                appointment.participantId ||
                                                '-'}
                                        </span>
                                    </Space>
                                </Descriptions.Item>
                            ) : null}

                            <Descriptions.Item label="Delivery Details">
                                {method === 'virtual' ? (
                                    meetingLink ? (
                                        <a href={meetingLink} target="_blank" rel="noreferrer">
                                            <Space>
                                                <LinkOutlined />
                                                Open meeting
                                            </Space>
                                        </a>
                                    ) : (
                                        <Text type="secondary">No meeting link provided</Text>
                                    )
                                ) : method === 'in_person' ? (
                                    location ? (
                                        <Space>
                                            <EnvironmentOutlined />
                                            {location}
                                        </Space>
                                    ) : (
                                        <Text type="secondary">No location provided</Text>
                                    )
                                ) : method === 'telephonically' ? (
                                    <Space>
                                        <PhoneOutlined />
                                        Telephonic appointment
                                    </Space>
                                ) : (
                                    <Text type="secondary">-</Text>
                                )}
                            </Descriptions.Item>
                        </Descriptions>
                    ) : null}

                    {activeSection === 'overview' && declinedMembers.length ? (
                        <Alert
                            type="warning"
                            showIcon
                            style={{ marginTop: 14 }}
                            message={`${declinedMembers.length} SME${
                                declinedMembers.length === 1 ? '' : 's'
                            } declined this appointment`}
                            description={
                                <Space direction="vertical" size={6}>
                                    {declinedMembers.map((member) => (
                                        <div key={member.key}>
                                            <Text strong>{member.name}: </Text>
                                            <Text>
                                                {member.declineReason ||
                                                    (declinedMembers.length === 1
                                                        ? appointmentService.getAppointmentDeclineReason(
                                                              appointment as any
                                                          )
                                                        : '') ||
                                                    'No reason was recorded.'}
                                            </Text>
                                        </div>
                                    ))}
                                </Space>
                            }
                        />
                    ) : null}

                    {activeSection === 'overview' &&
                    appointment.smeRescheduleRequest?.status === 'proposed' ? (
                        <Card
                            size="small"
                            title="SME requested a new time"
                            style={{ marginTop: 14, borderColor: '#faad14' }}
                        >
                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                <Text>
                                    <Text strong>Reason: </Text>
                                    {appointment.smeRescheduleRequest.reasonText ||
                                        'No reason provided.'}
                                </Text>
                                {(appointment.smeRescheduleRequest.proposals || []).map(
                                    (proposal: any, index: number) => {
                                        const start = toDateFromFirestore(proposal.startTime)
                                        const end = toDateFromFirestore(proposal.endTime)
                                        return (
                                            <Card key={proposal.id || index} size="small">
                                                <Space>
                                                    <CalendarOutlined />
                                                    {start
                                                        ? dayjs(start).format(
                                                              'ddd, DD MMM YYYY HH:mm'
                                                          )
                                                        : 'Proposed time unavailable'}
                                                    {end ? ` – ${dayjs(end).format('HH:mm')}` : ''}
                                                </Space>
                                            </Card>
                                        )
                                    }
                                )}
                                <Text type="secondary">
                                    Open Appointments to accept a proposed time or choose another
                                    slot.
                                </Text>
                            </Space>
                        </Card>
                    ) : null}

                    {activeSection === 'smes' && members.length ? (
                        <>
                            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                {isGroup ? (
                                    <Space
                                        wrap
                                        style={{ width: '100%', justifyContent: 'space-between' }}
                                    >
                                        <Search
                                            allowClear
                                            prefix={<SearchOutlined />}
                                            placeholder="Search SME"
                                            onChange={(event) =>
                                                setParticipantQuery(event.target.value)
                                            }
                                            style={{ maxWidth: 320 }}
                                        />
                                        <Select
                                            value={confirmationFilter}
                                            onChange={setConfirmationFilter}
                                            style={{ width: 180 }}
                                            options={[
                                                { label: 'All confirmations', value: 'all' },
                                                { label: 'Confirmed', value: 'confirmed' },
                                                { label: 'Pending', value: 'pending' },
                                                { label: 'Declined', value: 'declined' },
                                            ]}
                                        />
                                    </Space>
                                ) : null}

                                <Table
                                    rowKey="key"
                                    size="small"
                                    dataSource={filteredMembers}
                                    columns={columns}
                                    pagination={{
                                        pageSize: 6,
                                        hideOnSinglePage: true,
                                        showSizeChanger: false,
                                    }}
                                />
                            </Space>
                        </>
                    ) : null}

                    {activeSection === 'catering' && (foodMenu.length || foodSelections.length) ? (
                        <>
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                {foodMenu.length ? (
                                    <Table
                                        rowKey={(item) => String(item.id || item.name)}
                                        size="small"
                                        pagination={false}
                                        dataSource={foodMenu}
                                        columns={[
                                            {
                                                title: 'Item',
                                                dataIndex: 'name',
                                                key: 'name',
                                                render: (
                                                    _: string,
                                                    item: AppointmentFoodMenuItem
                                                ) => (
                                                    <Space direction="vertical" size={0}>
                                                        <Text strong>{item.name}</Text>
                                                        {item.description ? (
                                                            <Text
                                                                type="secondary"
                                                                style={{ fontSize: 12 }}
                                                            >
                                                                {item.description}
                                                            </Text>
                                                        ) : null}
                                                    </Space>
                                                ),
                                            },
                                            {
                                                title: 'Category',
                                                dataIndex: 'category',
                                                key: 'category',
                                                width: 120,
                                                render: (value) => (
                                                    <Tag icon={<CoffeeOutlined />}>
                                                        {capitalize(value)}
                                                    </Tag>
                                                ),
                                            },
                                            {
                                                title: 'Qty',
                                                dataIndex: 'quantityAvailable',
                                                key: 'quantityAvailable',
                                                width: 90,
                                                render: (value) => value ?? '-',
                                            },
                                            {
                                                title: 'Selected by',
                                                key: 'selectedCount',
                                                width: 120,
                                                render: (
                                                    _: unknown,
                                                    item: AppointmentFoodMenuItem
                                                ) => {
                                                    const count = getFoodSelectionCountForItem(item)
                                                    return (
                                                        <Tag color={count ? 'purple' : 'default'}>
                                                            {count} SME{count === 1 ? '' : 's'}
                                                        </Tag>
                                                    )
                                                },
                                            },
                                        ]}
                                        scroll={{ x: 700 }}
                                    />
                                ) : null}
                            </Space>
                        </>
                    ) : null}

                    {activeSection === 'topics' ? (
                        <>
                            <Card size="small" title="Topics and meeting notes">
                                {appointment.sessionCoverage?.latest ? (
                                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                        <Space wrap>
                                            <FileTextOutlined />
                                            <Text strong>
                                                {appointment.sessionCoverage.latest.title ||
                                                    appointment.sessionCoverage.title ||
                                                    'Session coverage'}
                                            </Text>
                                            <Tag
                                                color={
                                                    appointment.sessionCoverage.latest.held
                                                        ? 'green'
                                                        : 'red'
                                                }
                                            >
                                                {appointment.sessionCoverage.latest.held
                                                    ? 'Held'
                                                    : 'Not Held'}
                                            </Tag>
                                        </Space>
                                        {appointment.sessionCoverage.latest.held ? (
                                            <Space direction="vertical" size={8}>
                                                {appointment.sessionCoverage.latest.coveredPoints?.some(
                                                    (point) =>
                                                        point.trim().toLowerCase() !==
                                                        String(
                                                            appointment.sessionCoverage?.latest
                                                                ?.notes || ''
                                                        )
                                                            .trim()
                                                            .toLowerCase()
                                                ) ? (
                                                    <Space wrap>
                                                        {appointment.sessionCoverage.latest.coveredPoints.map(
                                                            (point) => (
                                                                <Tag key={point} color="blue">
                                                                    {point}
                                                                </Tag>
                                                            )
                                                        )}
                                                    </Space>
                                                ) : null}
                                                <Text>
                                                    {appointment.sessionCoverage.latest.notes ||
                                                        appointment.sessionCoverage.latest.coveredPoints?.join(
                                                            '; '
                                                        ) ||
                                                        'No coverage summary captured.'}
                                                </Text>
                                            </Space>
                                        ) : (
                                            <Text type="secondary">
                                                {appointment.sessionCoverage.latest.reasonNotHeld ||
                                                    '-'}
                                            </Text>
                                        )}
                                    </Space>
                                ) : appointment.meetingNotes?.latest ? (
                                    <Space direction="vertical" size={8}>
                                        <Text strong>
                                            {appointment.meetingNotes.latest.held
                                                ? 'Meeting held'
                                                : 'Meeting not held'}
                                        </Text>
                                        <Text>
                                            {appointment.meetingNotes.latest.discussed ||
                                                appointment.meetingNotes.latest.reasonNotHeld ||
                                                '-'}
                                        </Text>
                                    </Space>
                                ) : topics.planned.length ? (
                                    <Space direction="vertical" size={8}>
                                        <Text strong>Planned topics</Text>
                                        <Space wrap>
                                            {topics.planned.map((topic) => (
                                                <Tag key={topic}>{topic}</Tag>
                                            ))}
                                        </Space>
                                    </Space>
                                ) : (
                                    <Text type="secondary">
                                        No topics or meeting notes have been recorded.
                                    </Text>
                                )}
                            </Card>
                        </>
                    ) : null}
                </MotionCard>
            </div>
        </Modal>
    )
}

export default AppointmentDetailsModal
