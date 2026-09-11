import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    DatePicker,
    Divider,
    Empty,
    Grid,
    Input,
    List,
    Modal,
    Pagination,
    Radio,
    Row,
    Col,
    Select,
    Space,
    Table,
    Tag,
    Typography,
    message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    EnvironmentOutlined,
    HomeOutlined,
    LinkOutlined,
    PhoneOutlined,
    TeamOutlined,
    UserOutlined,
    VideoCameraOutlined
} from '@ant-design/icons'
import {
    Timestamp,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    updateDoc,
    where
} from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { requestOpenAccountSettings } from '@/lib/accountSettings'
import { acceptAssignedIntervention, declineAssignedIntervention } from '@/lib/interventions'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import {
    formatAppointmentDate,
    formatAppointmentTime,
    formatDeliveryMethod,
    getAppointmentAssigneeName,
    getAppointmentDate,
    getAppointmentTitle,
    isPastAppointment,
    normalizeAppointmentRecord,
    resolveAppointmentStart
} from '@/services/appointmentService'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import {
    APPOINTMENT_DECLINE_REASON_OPTIONS,
    appointmentDeclineReasonAllowsTimeProposal,
    buildAppointmentDeclineReason,
    type AppointmentDeclineReasonCode
} from '@/lib/appointmentDeclineReasons'
import AppointmentRescheduleProposalFields, {
    buildAppointmentRescheduleProposals,
    createAppointmentProposalDraft,
    type AppointmentProposalDraft
} from '@/components/appointments/AppointmentRescheduleProposalFields'
import '@/styles/incubatee-appointments.css'

const { RangePicker } = DatePicker
const { Paragraph, Text, Title } = Typography
const { useBreakpoint } = Grid

type UserConfirmation = 'pending' | 'confirmed' | 'declined'
type AppointmentRow = Record<string, any> & { id: string }
type DateRange = [Dayjs, Dayjs] | null

const confirmationTag = (value?: UserConfirmation) => {
    const map: Record<UserConfirmation, { color: string; label: string }> = {
        pending: { color: 'processing', label: 'Pending' },
        confirmed: { color: 'success', label: 'Confirmed' },
        declined: { color: 'error', label: 'Declined' }
    }
    const meta = map[value || 'pending'] || map.pending
    return <Tag color={meta.color}>{meta.label}</Tag>
}

const getFoodMenuItems = (appointment: AppointmentRow) => {
    if (!Array.isArray(appointment?.foodMenu)) return []
    return appointment.foodMenu.filter((item: any) => item?.id && item?.name)
}

const getFoodItemCategory = (appointment: AppointmentRow, itemId?: string | null) => {
    const item = getFoodMenuItems(appointment).find((menuItem: any) => menuItem.id === itemId)
    return String(item?.category || '').trim().toLowerCase()
}

const getMealMenuItems = (appointment: AppointmentRow) =>
    getFoodMenuItems(appointment).filter(
        (item: any) => getFoodItemCategory(appointment, item.id) !== 'drink'
    )

const getDrinkMenuItems = (appointment: AppointmentRow) =>
    getFoodMenuItems(appointment).filter(
        (item: any) => getFoodItemCategory(appointment, item.id) === 'drink'
    )

const getFoodSelectionsForParticipant = (appointment: AppointmentRow, _participantId: string | null) =>
    Array.isArray(appointment?.foodSelections) ? appointment.foodSelections : []

const formatFoodSelections = (
    appointment: AppointmentRow,
    participantId: string | null
) =>
    getFoodSelectionsForParticipant(appointment, participantId)
        .map((selection: any) => getFoodMenuItems(appointment).find((item: any) => item.id === selection.menuItemId)?.name || 'Selected')
        .join(', ')

const getDepartmentId = (appointment: AppointmentRow) =>
    String(
        appointment.departmentId ||
        appointment.department?.id ||
        appointment.snapshot?.departmentId ||
        'unassigned'
    ).trim()

const getStoredDepartmentName = (appointment: AppointmentRow) =>
    String(
        appointment.departmentName ||
        appointment.department?.name ||
        appointment.snapshot?.departmentName ||
        ''
    ).trim()

const deliveryIcon = (method: string) => {
    if (method === 'in_person') return <HomeOutlined />
    if (method === 'virtual') return <VideoCameraOutlined />
    return <PhoneOutlined />
}

const UserAppointments: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const [appointments, setAppointments] = useState<AppointmentRow[]>([])
    const [loading, setLoading] = useState(true)
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [dateRange, setDateRange] = useState<DateRange>(null)
    const [departmentFilter, setDepartmentFilter] = useState('all')
    const [departmentNames, setDepartmentNames] = useState<Record<string, string>>({})
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(8)

    const [declineModalOpen, setDeclineModalOpen] = useState(false)
    const [declineReasonCode, setDeclineReasonCode] =
        useState<AppointmentDeclineReasonCode | undefined>()
    const [declineReason, setDeclineReason] = useState('')
    const [declineProposals, setDeclineProposals] =
        useState<AppointmentProposalDraft[]>([createAppointmentProposalDraft()])
    const [selectedApptId, setSelectedApptId] = useState<string | null>(null)

    const [foodMenuModalOpen, setFoodMenuModalOpen] = useState(false)
    const [selectedFoodAppt, setSelectedFoodAppt] = useState<AppointmentRow | null>(null)
    const [selectedMealItemId, setSelectedMealItemId] = useState<string | null>(null)
    const [selectedDrinkItemId, setSelectedDrinkItemId] = useState<string | null>(null)
    const [savingFoodSelection, setSavingFoodSelection] = useState(false)

    /**
     * A past appointment's food choice is a record, not a decision — the
     * catering was ordered and served against whatever was picked beforehand.
     * The modal still opens so the SME can see what they chose; it just stops
     * accepting changes.
     */
    const foodMenuLocked = Boolean(selectedFoodAppt && isPastAppointment(selectedFoodAppt))

    useEffect(() => {
        let cancelled = false
        const resolveParticipant = async () => {
            const email = String(user?.email || '').trim()
            if (!email) {
                setParticipantId(null)
                setLoading(false)
                return
            }

            try {
                const candidateIds = Array.from(
                    new Set(
                        [
                            user?.participantId,
                            user?.participantDocId,
                            user?.profileId,
                            user?.id,
                            user?.uid
                        ]
                            .map(value => String(value || '').trim())
                            .filter(Boolean)
                    )
                )

                let participantDoc: any = null
                for (const id of candidateIds) {
                    const snapshot = await getDoc(doc(db, 'participants', id))
                    if (snapshot.exists()) {
                        participantDoc = snapshot
                        break
                    }
                }

                if (!participantDoc) {
                    const exact = await getDocs(
                        query(collection(db, 'participants'), where('email', '==', email))
                    )
                    participantDoc = exact.docs[0] || null
                }

                if (!participantDoc) {
                    const normalizedEmail = email.toLowerCase()
                    const allParticipants = await getDocs(collection(db, 'participants'))
                    participantDoc =
                        allParticipants.docs.find(
                            item =>
                                String(item.data()?.email || '').trim().toLowerCase() ===
                                normalizedEmail
                        ) || null
                }

                if (!cancelled) {
                    setParticipantId(String(participantDoc?.id || '').trim() || null)
                }
            } catch (error) {
                console.error('Failed to resolve appointment participant:', error)
                if (!cancelled) {
                    setParticipantId(String(user?.participantId || '').trim() || null)
                    setLoading(false)
                }
            }
        }

        resolveParticipant()
        return () => {
            cancelled = true
        }
    }, [user?.email, user?.id, user?.participantDocId, user?.participantId, user?.profileId, user?.uid])

    useEffect(() => {
        let cancelled = false
        const loadAppointments = async () => {
            if (!participantId) {
                setAppointments([])
                setLoading(false)
                return
            }

            setLoading(true)
            try {
                const snapshot = await getDocs(
                    activeProgramId
                        ? query(
                            collection(db, 'appointments'),
                            where('smeId', '==', participantId),
                            where('programId', '==', activeProgramId)
                        )
                        : query(
                            collection(db, 'appointments'),
                            where('smeId', '==', participantId)
                        )
                )
                if (!cancelled) {
                    const hydrated = await hydrateAppointmentViews(
                        snapshot.docs.map(item => ({ id: item.id, data: item.data() as any }))
                    )
                    setAppointments(hydrated.map(item => normalizeAppointmentRecord(item.id, item)))
                }
            } catch (error) {
                console.error('Failed to load appointments:', error)
                message.error('Failed to load your appointments.')
                if (!cancelled) setAppointments([])
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        loadAppointments()
        return () => {
            cancelled = true
        }
    }, [activeProgramId, participantId])

    useEffect(() => {
        let cancelled = false
        const departmentIds = Array.from(
            new Set(
                appointments
                    .map(getDepartmentId)
                    .filter(id => id && id !== 'unassigned')
            )
        )

        if (!departmentIds.length) {
            setDepartmentNames({})
            return
        }

        const resolveDepartments = async () => {
            try {
                const snapshots = await Promise.all(
                    departmentIds.map(id => getDoc(doc(db, 'departments', id)))
                )
                const names: Record<string, string> = {}
                snapshots.forEach(snapshot => {
                    if (!snapshot.exists()) return
                    const data = snapshot.data() as any
                    names[snapshot.id] = String(
                        data?.name || data?.departmentName || snapshot.id
                    ).trim()
                })
                if (!cancelled) setDepartmentNames(names)
            } catch (error) {
                console.error('Failed to resolve appointment departments:', error)
                if (!cancelled) setDepartmentNames({})
            }
        }

        resolveDepartments()
        return () => {
            cancelled = true
        }
    }, [appointments])

    const resolveDepartmentName = (appointment: AppointmentRow) => {
        const departmentId = getDepartmentId(appointment)
        return (
            departmentNames[departmentId] ||
            getStoredDepartmentName(appointment) ||
            (departmentId !== 'unassigned' ? departmentId : 'Unassigned department')
        )
    }

    const totalAppointments = appointments.length
    const upcomingAppointments = useMemo(
        () =>
            appointments.filter(appointment => {
                const start = resolveAppointmentStart(appointment).date
                return (
                    appointment.status === 'scheduled' &&
                    !!start?.isValid() &&
                    start.isAfter(dayjs())
                )
            }).length,
        [appointments]
    )
    const pendingAppointments = useMemo(
        () =>
            appointments.filter(
                appointment =>
                    appointment.status === 'scheduled' &&
                    appointment.userConfirmation !== 'confirmed' &&
                    appointment.userConfirmation !== 'declined' &&
                    !isPastAppointment(appointment)
            ).length,
        [appointments]
    )
    const completedAppointments = useMemo(
        () => appointments.filter(appointment => appointment.status === 'completed').length,
        [appointments]
    )

    const metrics: DashboardMetric[] = [
        {
            key: 'total',
            title: 'Total appointments',
            mobileTitle: 'Total',
            value: totalAppointments,
            subtitle: 'All appointments assigned to you',
            mobileSubtitle: 'Assigned to you',
            icon: <CalendarOutlined style={{ color: '#1677ff' }} />,
            iconBg: 'rgba(22,119,255,.12)'
        },
        {
            key: 'upcoming',
            title: 'Upcoming',
            value: upcomingAppointments,
            subtitle: 'Scheduled for a future date',
            mobileSubtitle: 'Scheduled ahead',
            icon: <ClockCircleOutlined style={{ color: '#16a34a' }} />,
            iconBg: 'rgba(22,163,74,.12)',
            important: true
        },
        {
            key: 'pending',
            title: 'Awaiting response',
            mobileTitle: 'To respond',
            value: pendingAppointments,
            subtitle: 'Appointments requiring your response',
            mobileSubtitle: 'Needs your reply',
            icon: <CloseCircleOutlined style={{ color: '#d97706' }} />,
            iconBg: 'rgba(217,119,6,.12)',
            important: true
        },
        {
            key: 'completed',
            title: 'Completed',
            value: completedAppointments,
            subtitle: 'Appointments already completed',
            mobileSubtitle: 'Already completed',
            icon: <CheckCircleOutlined style={{ color: '#0891b2' }} />,
            iconBg: 'rgba(8,145,178,.12)'
        }
    ]

    const departmentOptions = useMemo(() => {
        const departments = new Map<string, string>()
        appointments.forEach(appointment => {
            departments.set(getDepartmentId(appointment), resolveDepartmentName(appointment))
        })
        return [
            { value: 'all', label: 'All departments' },
            ...Array.from(departments.entries())
                .map(([value, label]) => ({ value, label }))
                .sort((a, b) => a.label.localeCompare(b.label))
        ]
    }, [appointments, departmentNames])

    const filteredAppointments = useMemo(() => {
        const rows = appointments.filter(appointment => {
            const appointmentDate = getAppointmentDate(appointment)
            const matchesDate =
                !dateRange ||
                (!!appointmentDate &&
                    !appointmentDate.isBefore(dateRange[0].startOf('day')) &&
                    !appointmentDate.isAfter(dateRange[1].endOf('day')))
            const matchesDepartment =
                departmentFilter === 'all' ||
                getDepartmentId(appointment) === departmentFilter
            return matchesDate && matchesDepartment
        })

        return rows.sort((a, b) => {
            const aStart = resolveAppointmentStart(a).date
            const bStart = resolveAppointmentStart(b).date
            const aPast = isPastAppointment(a)
            const bPast = isPastAppointment(b)
            if (aPast !== bPast) return aPast ? 1 : -1
            if (!aStart || !bStart) return 0
            return aPast ? bStart.valueOf() - aStart.valueOf() : aStart.valueOf() - bStart.valueOf()
        })
    }, [appointments, dateRange, departmentFilter])

    useEffect(() => {
        setPage(1)
    }, [dateRange, departmentFilter])

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAppointments.length / pageSize))
        if (page > maxPage) setPage(maxPage)
    }, [filteredAppointments.length, page, pageSize])

    const paginatedAppointments = useMemo(
        () => filteredAppointments.slice((page - 1) * pageSize, page * pageSize),
        [filteredAppointments, page, pageSize]
    )

    const handleAccept = async (id: string) => {
        if (!user?.signatureURL) {
            Modal.confirm({
                title: 'Signature required',
                content: 'Please add your signature in Account Settings before confirming an appointment.',
                okText: 'Go to Account Settings',
                cancelText: 'Cancel',
                onOk: () => requestOpenAccountSettings()
            })
            return
        }

        try {
            await updateDoc(doc(db, 'appointments', id), {
                smeConfirmation: 'confirmed',
                updatedAt: Timestamp.now()
            })

            // Responding to an appointment doubles as accepting the underlying
            // intervention assignment when it's still awaiting that decision.
            // A no-op (already accepted, or a later appointment in the same
            // intervention) throws and is safe to ignore here.
            const assignedInterventionId = String(
                appointments.find(appointment => appointment.id === id)?.assignedInterventionId || ''
            ).trim()
            if (assignedInterventionId) {
                try {
                    await acceptAssignedIntervention(db, assignedInterventionId)
                } catch {
                    // Not awaiting acceptance - nothing to do.
                }
            }

            setAppointments(previous =>
                previous.map(appointment =>
                    appointment.id === id
                        ? { ...appointment, userConfirmation: 'confirmed' }
                        : appointment
                )
            )
            message.success('Appointment confirmed.')
        } catch (error) {
            console.error('Failed to confirm appointment:', error)
            message.error('Failed to confirm appointment.')
        }
    }

    const openDecline = (appointment: AppointmentRow) => {
        if (isPastAppointment(appointment)) {
            message.warning('A past appointment can no longer be declined.')
            return
        }
        setSelectedApptId(appointment.id)
        setDeclineReasonCode(undefined)
        setDeclineReason('')
        setDeclineProposals([createAppointmentProposalDraft()])
        setDeclineModalOpen(true)
    }

    const submitDecline = async () => {
        if (!selectedApptId) return
        const selectedAppointment = appointments.find(
            appointment => appointment.id === selectedApptId
        )
        if (!selectedAppointment || isPastAppointment(selectedAppointment)) {
            message.warning('This appointment has passed and can no longer be declined.')
            setDeclineModalOpen(false)
            setSelectedApptId(null)
            return
        }
        let reason
        try {
            reason = buildAppointmentDeclineReason(declineReasonCode, declineReason)
        } catch (error: any) {
            message.error(error?.message || 'Please provide a reason.')
            return
        }
        const canProposeTime =
            selectedAppointment.isGroupAppointment !== true &&
            appointmentDeclineReasonAllowsTimeProposal(reason.code)
        let rescheduleProposals: ReturnType<typeof buildAppointmentRescheduleProposals> = []
        try {
            rescheduleProposals = canProposeTime
                ? buildAppointmentRescheduleProposals(declineProposals)
                : []
        } catch (error: any) {
            message.error(error?.message || 'Check the proposed appointment times.')
            return
        }

        try {
            await updateDoc(doc(db, 'appointments', selectedApptId), {
                smeConfirmation: 'declined',
                smeDeclineReason: reason.text,
                smeRescheduleRequest: rescheduleProposals.length
                    ? {
                        status: 'proposed',
                        reasonCode: reason.code,
                        reasonText: reason.text,
                        proposals: rescheduleProposals
                    }
                    : null,
                updatedAt: Timestamp.now()
            })

            // Declining an appointment that's still awaiting the SME's initial
            // acceptance declines the underlying assignment too. A no-op
            // (already resolved, or a later appointment in the same
            // intervention) throws and is safe to ignore here.
            const assignedInterventionId = String(
                (selectedAppointment as any)?.assignedInterventionId || ''
            ).trim()
            if (assignedInterventionId) {
                try {
                    await declineAssignedIntervention(db, assignedInterventionId, reason.text)
                } catch {
                    // Not awaiting acceptance - nothing to do.
                }
            }

            setAppointments(previous =>
                previous.map(appointment =>
                    appointment.id === selectedApptId
                        ? {
                            ...appointment,
                            userConfirmation: 'declined',
                            declineReasonCode: reason.code,
                            declineReasonLabel: reason.label,
                            declineReasonDetails: reason.details,
                            declineReason: reason.text,
                            userRejectionReason: reason.text,
                            rescheduleRequest: rescheduleProposals.length
                                ? {
                                    status: 'proposed',
                                    reasonCode: reason.code,
                                    reasonText: reason.text,
                                    proposals: rescheduleProposals
                                }
                                : null
                        }
                        : appointment
                )
            )
            message.success('Appointment declined.')
            setDeclineModalOpen(false)
            setSelectedApptId(null)
            setDeclineReasonCode(undefined)
            setDeclineReason('')
            setDeclineProposals([createAppointmentProposalDraft()])
        } catch (error) {
            console.error('Failed to decline appointment:', error)
            message.error('Failed to decline appointment.')
        }
    }

    const openFoodMenu = (appointment: AppointmentRow) => {
        if (!participantId) {
            message.error('Unable to resolve your participant identity.')
            return
        }
        if (appointment.deliveryMethod !== 'in_person') {
            message.warning('Food selection is only available for in-person appointments.')
            return
        }
        if (!appointment.foodMenuEnabled || !getFoodMenuItems(appointment).length) {
            message.warning('No food menu is available for this appointment.')
            return
        }

        const selections = getFoodSelectionsForParticipant(appointment, participantId)
        const selectedMeal = selections.find((selection: any) => {
            const category =
                String(selection.category || '').toLowerCase() ||
                getFoodItemCategory(appointment, selection.menuItemId)
            return category !== 'drink'
        })
        const selectedDrink = selections.find((selection: any) => {
            const category =
                String(selection.category || '').toLowerCase() ||
                getFoodItemCategory(appointment, selection.menuItemId)
            return category === 'drink'
        })

        setSelectedFoodAppt(appointment)
        setSelectedMealItemId(selectedMeal?.menuItemId || null)
        setSelectedDrinkItemId(selectedDrink?.menuItemId || null)
        setFoodMenuModalOpen(true)
    }

    const saveFoodSelection = async () => {
        if (!selectedFoodAppt || !participantId) return

        // The controls are disabled and the Save button is not rendered when
        // locked, but neither of those is an invariant.
        if (isPastAppointment(selectedFoodAppt)) {
            message.warning('This appointment has passed, so the food selection can no longer be changed.')
            return
        }
        const mealItems = getMealMenuItems(selectedFoodAppt)
        const drinkItems = getDrinkMenuItems(selectedFoodAppt)

        if (mealItems.length && !selectedMealItemId) {
            message.error('Please choose a meal.')
            return
        }
        if (drinkItems.length && !selectedDrinkItemId) {
            message.error('Please choose a drink.')
            return
        }

        const selectedItems = [selectedMealItemId, selectedDrinkItemId]
            .filter(Boolean)
            .map(itemId =>
                getFoodMenuItems(selectedFoodAppt).find(
                    (menuItem: any) => menuItem.id === itemId
                )
            )
            .filter(Boolean)

        if (!selectedItems.length) {
            message.error('Please choose from the menu.')
            return
        }

        setSavingFoodSelection(true)
        try {
            const newSelections = selectedItems.map((item: any) => ({
                menuItemId: item.id,
                quantity: 1
            }))
            const updatedSelections = newSelections

            await updateDoc(doc(db, 'appointments', selectedFoodAppt.id), {
                foodSelections: updatedSelections,
                updatedAt: Timestamp.now()
            })
            setAppointments(previous =>
                previous.map(appointment =>
                    appointment.id === selectedFoodAppt.id
                        ? { ...appointment, foodSelections: updatedSelections }
                        : appointment
                )
            )
            message.success('Food selection saved.')
            closeFoodMenu()
        } catch (error) {
            console.error('Failed to save food selection:', error)
            message.error('Failed to save food selection.')
        } finally {
            setSavingFoodSelection(false)
        }
    }

    const closeFoodMenu = () => {
        setFoodMenuModalOpen(false)
        setSelectedFoodAppt(null)
        setSelectedMealItemId(null)
        setSelectedDrinkItemId(null)
    }

    const renderLocation = (appointment: AppointmentRow) => {
        if (appointment.deliveryMethod === 'virtual' && appointment.meetingLink) {
            if (isPastAppointment(appointment)) return null
            return (
                <a href={appointment.meetingLink} target="_blank" rel="noopener noreferrer">
                    <LinkOutlined /> Join meeting
                </a>
            )
        }
        if (appointment.deliveryMethod === 'in_person' && appointment.location) {
            return <Text><EnvironmentOutlined /> {appointment.location}</Text>
        }
        return null
    }

    const renderActions = (appointment: AppointmentRow, compact = false) => {
        const isPast = isPastAppointment(appointment)
        const buttons: React.ReactNode[] = []

        if (
            appointment.status === 'scheduled' &&
            appointment.userConfirmation !== 'confirmed'
        ) {
            buttons.push(
                <Button
                    key="accept"
                    size={compact ? 'small' : 'middle'}
                    icon={<CheckCircleOutlined />}
                    color="primary"
                    variant="outlined"
                    onClick={() => handleAccept(appointment.id)}
                >
                    Accept
                </Button>
            )
        }
        if (
            appointment.status === 'scheduled' &&
            appointment.userConfirmation !== 'declined' &&
            !isPast
        ) {
            buttons.push(
                <Button
                    key="decline"
                    size={compact ? 'small' : 'middle'}
                    icon={<CloseCircleOutlined />}
                    color="danger"
                    variant="outlined"
                    onClick={() => openDecline(appointment)}
                >
                    Decline
                </Button>
            )
        }
        if (
            appointment.deliveryMethod === 'in_person' &&
            appointment.foodMenuEnabled &&
            getFoodMenuItems(appointment).length > 0
        ) {
            buttons.push(
                <Button
                    key="food"
                    size={compact ? 'small' : 'middle'}
                    color="default"
                    variant="outlined"
                    onClick={() => openFoodMenu(appointment)}
                >
                    {isPast ? 'View food choice' : 'Food menu'}
                </Button>
            )
        }

        return (
            <div className={`appointment-actions${compact ? ' appointment-actions--mobile' : ''}`}>
                {isPast && <Tag className="appointment-past-label">Past appointment</Tag>}
                {buttons.length > 0 && (
                    <div className="appointment-action-buttons">{buttons}</div>
                )}
            </div>
        )
    }

    const columns: ColumnsType<AppointmentRow> = [
        {
            title: 'Appointment',
            key: 'appointment',
            width: 220,
            render: (_, appointment) => (
                <Space direction="vertical" size={3}>
                    <Text strong>{getAppointmentTitle(appointment)}</Text>
                    <Text type="secondary">
                        <UserOutlined /> {getAppointmentAssigneeName(appointment) || 'Unassigned'}
                    </Text>
                </Space>
            )
        },
        {
            title: 'When',
            key: 'when',
            width: 190,
            render: (_, appointment) => (
                <Space direction="vertical" size={2}>
                    <Text><CalendarOutlined /> {formatAppointmentDate(appointment)}</Text>
                    <Text type="secondary"><ClockCircleOutlined /> {formatAppointmentTime(appointment)}</Text>
                </Space>
            )
        },
        {
            title: 'Delivery',
            key: 'delivery',
            width: 150,
            render: (_, appointment) => (
                <Space direction="vertical" size={5}>
                    <Tag icon={deliveryIcon(appointment.deliveryMethod)}>
                        {formatDeliveryMethod(appointment)}
                    </Tag>
                    {renderLocation(appointment)}
                </Space>
            )
        },
        {
            title: 'Food',
            key: 'food',
            width: 140,
            render: (_, appointment) => {
                if (
                    appointment.deliveryMethod !== 'in_person' ||
                    !appointment.foodMenuEnabled ||
                    !getFoodMenuItems(appointment).length
                ) {
                    return <Text type="secondary">Not applicable</Text>
                }
                const selection = formatFoodSelections(appointment, participantId)
                return selection
                    ? <Tag color="purple">{selection}</Tag>
                    : <Text type="secondary">Not selected</Text>
            }
        },
        {
            title: 'Confirmation',
            key: 'confirmation',
            width: 130,
            render: (_, appointment) => confirmationTag(appointment.userConfirmation)
        },
        {
            title: 'Actions',
            key: 'actions',
            fixed: 'right',
            width: 230,
            render: (_, appointment) => renderActions(appointment)
        }
    ]

    const filterBar = (
        <Row gutter={[12, 12]} className="appointments-filter-row">
            <Col xs={24} md={9}>
                <RangePicker
                    allowClear
                    value={dateRange}
                    onChange={value =>
                        setDateRange(
                            value?.[0] && value?.[1]
                                ? [value[0], value[1]]
                                : null
                        )
                    }
                    placeholder={['Start date', 'End date']}
                    style={{ width: '100%' }}
                />
            </Col>
            <Col xs={24} md={9}>
                <Select
                    showSearch
                    optionFilterProp="label"
                    value={departmentFilter}
                    onChange={setDepartmentFilter}
                    options={departmentOptions}
                    style={{ width: '100%' }}
                    aria-label="Filter by department"
                />
            </Col>
            <Col xs={24} md={6}>
                <Button
                    type="primary"
                    ghost
                    icon={<CalendarOutlined />}
                    onClick={() => navigate('/calendar')}
                    block
                >
                    View calendar
                </Button>
            </Col>
        </Row>
    )

    return (
        <main className="incubatee-appointments-page">
            <Helmet>
                <title>My Appointments | Smart Incubation</title>
            </Helmet>

            <MetricsGrid metrics={metrics} />

            <MotionCard
                className="appointments-table-card"
                filterBar={filterBar}
            >
                {isMobile ? (
                    <>
                        <List
                            loading={loading}
                            dataSource={paginatedAppointments}
                            locale={{
                                emptyText: <Empty description="No appointments match these filters" />
                            }}
                            renderItem={appointment => (
                                <List.Item className="appointment-mobile-list-item">
                                    <article className="appointment-mobile-card">
                                        <div className="appointment-mobile-card__header">
                                            <div>
                                                <Text strong>{getAppointmentTitle(appointment)}</Text>
                                                <Text type="secondary">
                                                    {resolveDepartmentName(appointment)}
                                                </Text>
                                            </div>
                                            {confirmationTag(appointment.userConfirmation)}
                                        </div>
                                        <div className="appointment-mobile-card__meta">
                                            <Text>
                                                <CalendarOutlined /> {formatAppointmentDate(appointment)}
                                            </Text>
                                            <Text>
                                                <ClockCircleOutlined /> {formatAppointmentTime(appointment)}
                                            </Text>
                                            <Text>
                                                <UserOutlined /> {getAppointmentAssigneeName(appointment) || 'Unassigned'}
                                            </Text>
                                            <Tag icon={deliveryIcon(appointment.deliveryMethod)}>
                                                {formatDeliveryMethod(appointment)}
                                            </Tag>
                                            {renderLocation(appointment)}
                                        </div>
                                        <div className="appointment-mobile-card__actions">
                                            {renderActions(appointment, true)}
                                        </div>
                                    </article>
                                </List.Item>
                            )}
                        />
                        {filteredAppointments.length > 0 && (
                            <Pagination
                                className="appointments-mobile-pagination"
                                current={page}
                                pageSize={pageSize}
                                total={filteredAppointments.length}
                                showSizeChanger
                                pageSizeOptions={[5, 8, 10, 20]}
                                onChange={(nextPage, nextSize) => {
                                    setPage(nextPage)
                                    setPageSize(nextSize)
                                }}
                                showTotal={total => `${total} appointments`}
                            />
                        )}
                    </>
                ) : (
                    <Table<AppointmentRow>
                        rowKey="id"
                        loading={loading}
                        columns={columns}
                        dataSource={filteredAppointments}
                        scroll={{ x: 1240 }}
                        locale={{
                            emptyText: <Empty description="No appointments match these filters" />
                        }}
                        pagination={{
                            current: page,
                            pageSize,
                            showSizeChanger: false,
                            position: ['bottomCenter'],
                            onChange: (nextPage, nextSize) => {
                                setPage(nextPage)
                                setPageSize(nextSize)
                            }
                        }}
                    />
                )}
            </MotionCard>

            <Modal
                title="Decline appointment"
                open={declineModalOpen}
                onOk={submitDecline}
                onCancel={() => {
                    setDeclineModalOpen(false)
                    setSelectedApptId(null)
                    setDeclineReasonCode(undefined)
                    setDeclineReason('')
                    setDeclineProposals([createAppointmentProposalDraft()])
                }}
                okText="Submit decline"
                okButtonProps={{ danger: true }}
                centered
            >
                <Paragraph type="secondary">
                    Please tell the facilitator why you cannot attend.
                </Paragraph>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Select
                        value={declineReasonCode}
                        onChange={value => {
                            setDeclineReasonCode(value)
                            if (value !== 'other') setDeclineReason('')
                        }}
                        placeholder="Select a reason"
                        style={{ width: '100%' }}
                        options={APPOINTMENT_DECLINE_REASON_OPTIONS.map(option => ({
                            value: option.value,
                            label: option.label
                        }))}
                    />
                    {declineReasonCode === 'other' ? (
                        <Input.TextArea
                            rows={4}
                            value={declineReason}
                            onChange={event => setDeclineReason(event.target.value)}
                            placeholder="Provide your reason in your own words"
                            maxLength={500}
                            showCount
                        />
                    ) : null}
                    {selectedApptId &&
                        appointments.find(appointment => appointment.id === selectedApptId)?.isGroupAppointment !== true &&
                        appointmentDeclineReasonAllowsTimeProposal(declineReasonCode) ? (
                        <>
                            <Divider style={{ margin: '4px 0' }} />
                            <AppointmentRescheduleProposalFields
                                value={declineProposals}
                                onChange={setDeclineProposals}
                            />
                        </>
                    ) : null}
                </Space>
            </Modal>

            <Modal
                title={
                    selectedFoodAppt
                        ? `${foodMenuLocked ? 'Food selected for' : 'Select food for'} ${getAppointmentTitle(selectedFoodAppt)}`
                        : 'Select food'
                }
                open={foodMenuModalOpen}
                onOk={saveFoodSelection}
                onCancel={closeFoodMenu}
                okText="Save selection"
                confirmLoading={savingFoodSelection}
                // Once the meeting is over the catering has already happened, so
                // the choice is a record rather than a decision. Close is the
                // only action left.
                footer={foodMenuLocked ? (
                    <Button onClick={closeFoodMenu}>Close</Button>
                ) : undefined}
                destroyOnClose
                centered
            >
                {selectedFoodAppt ? (
                    <Space direction="vertical" style={{ width: '100%' }} size={16}>
                        {foodMenuLocked ? (
                            <Alert
                                type="info"
                                showIcon
                                message="This appointment has passed"
                                description="Your food choice is shown for reference and can no longer be changed."
                            />
                        ) : (
                            <Text type="secondary">
                                Food selection is available for this in-person appointment.
                            </Text>
                        )}
                        <div className="appointment-food-summary">
                            <Text strong>{getAppointmentTitle(selectedFoodAppt)}</Text>
                            <Text>
                                {formatAppointmentDate(selectedFoodAppt)} ·{' '}
                                {formatAppointmentTime(selectedFoodAppt)}
                            </Text>
                            {selectedFoodAppt.location && (
                                <Text>
                                    <EnvironmentOutlined /> {selectedFoodAppt.location}
                                </Text>
                            )}
                        </div>

                        {getMealMenuItems(selectedFoodAppt).length > 0 && (
                            <>
                                <Divider orientation="left">Meal</Divider>
                                <Radio.Group
                                    value={selectedMealItemId}
                                    onChange={event => setSelectedMealItemId(event.target.value)}
                                    disabled={foodMenuLocked}
                                    style={{ width: '100%' }}
                                >
                                    <Space direction="vertical" style={{ width: '100%' }}>
                                        {getMealMenuItems(selectedFoodAppt).map((item: any) => (
                                            <Radio key={item.id} value={item.id}>
                                                <Space direction="vertical" size={1}>
                                                    <Text>{item.name}</Text>
                                                    {item.dietaryNote && (
                                                        <Text type="secondary">{item.dietaryNote}</Text>
                                                    )}
                                                </Space>
                                            </Radio>
                                        ))}
                                    </Space>
                                </Radio.Group>
                            </>
                        )}

                        {getDrinkMenuItems(selectedFoodAppt).length > 0 && (
                            <>
                                <Divider orientation="left">Drink</Divider>
                                <Radio.Group
                                    value={selectedDrinkItemId}
                                    onChange={event => setSelectedDrinkItemId(event.target.value)}
                                    disabled={foodMenuLocked}
                                    style={{ width: '100%' }}
                                >
                                    <Space direction="vertical" style={{ width: '100%' }}>
                                        {getDrinkMenuItems(selectedFoodAppt).map((item: any) => (
                                            <Radio key={item.id} value={item.id}>
                                                <Space direction="vertical" size={1}>
                                                    <Text>{item.name}</Text>
                                                    {item.dietaryNote && (
                                                        <Text type="secondary">{item.dietaryNote}</Text>
                                                    )}
                                                </Space>
                                            </Radio>
                                        ))}
                                    </Space>
                                </Radio.Group>
                            </>
                        )}
                    </Space>
                ) : (
                    <Empty description="No food menu available" />
                )}
            </Modal>
        </main>
    )
}

export default UserAppointments
