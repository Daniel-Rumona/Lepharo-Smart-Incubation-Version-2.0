import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    List,
    Button,
    Tag,
    Modal,
    Form,
    Select,
    DatePicker,
    Input,
    message,
    Space,
    Typography,
    Row,
    Col,
    Table,
    Grid,
    Divider,
    Alert,
    Descriptions,
    Popconfirm,
    Card,
    QRCode,
    Empty,
    Checkbox,
    Segmented,
    InputNumber,
    Steps,
    Pagination,
    Skeleton,
    Upload,
    Image,
    Progress
} from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import {
    CalendarOutlined,
    ClockCircleOutlined,
    UserOutlined,
    VideoCameraOutlined,
    HomeOutlined,
    PlusOutlined,
    CheckCircleOutlined,
    TeamOutlined,
    PhoneOutlined,
    LinkOutlined,
    EnvironmentOutlined,
    PhoneFilled,
    EditOutlined,
    EyeOutlined,
    QrcodeOutlined,
    StopOutlined,
    LoginOutlined,
    LogoutOutlined,
    BarChartOutlined,
    BookOutlined,
    FileDoneOutlined,
    SyncOutlined,
    PictureOutlined,
    UploadOutlined,
    DeleteOutlined
} from '@ant-design/icons'
import {
    collection,
    query as fsQuery,
    where,
    getDocs,
    addDoc,
    Timestamp,
    doc,
    documentId,
    getDoc,
    getDocFromServer,
    updateDoc,
    arrayUnion,
    writeBatch,
    runTransaction,
    limit,
    type QueryConstraint
} from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import isoWeek from 'dayjs/plugin/isoWeek'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { db, storage } from '@/firebase'
import { uploadCoveragePhotos, assertCoveragePhotosSaved } from '@/services/coveragePhotoService'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import { Helmet } from 'react-helmet'
import SessionReviewModal from './SessionReviewModal'
import CoveragePhotoGallery from '@/components/appointments/CoveragePhotoGallery'
import { appointmentMemberStatus } from '@/lib/appointmentMemberStatus'
import { normalizeAssignmentGroupKey } from '@/lib/assignmentIdentity'
import {
    assignmentCanOwnAppointment,
    assignmentDate,
    assignmentDateLabel,
    assignmentOptionLabel,
    distinctAppointmentAssignments,
    unambiguousAppointmentAssignment
} from '@/lib/appointmentAssignments'
import {
    acceptAppointmentRescheduleProposal,
    buildAppointmentGroupKey,
    getAppointmentGroupKey,
    titleCase
} from '@/services/appointmentService'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import {
    AppointmentSessionAlreadyExistsError,
    scheduleAppointmentSession
} from '@/services/appointmentSchedulingService'
import {
    dedupeAssignedInterventionViews,
    toAssignedInterventionView
} from '@/services/assignedInterventionService'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import AppointmentDateTimeFields from '@/components/appointments/AppointmentDateTimeFields'
import {
    departmentUsesTrainingCoverage,
    getDepartmentDescendants
} from '@/services/departmentCapabilities'
import { completeIntervention, completionFailureEvidence, loadInterventionCompletionContext, interventionCompletionError, mergeCompletionFailureContext, COMPLETION_SUCCESS_MESSAGE, type InterventionCompletionContext } from '@/services/interventionCompletionService'
import InterventionCompletionFields from '@/components/interventions/InterventionCompletionFields'
import { useSearchParams } from 'react-router-dom'

const COVERAGE_ATTENDANCE_PAGE_SIZE = 5

dayjs.extend(isBetween)
dayjs.extend(isoWeek)
dayjs.extend(customParseFormat)

const { Option } = Select
const { RangePicker } = DatePicker
const { Text, Title, Paragraph } = Typography
const { useBreakpoint } = Grid

type Delivery = 'in_person' | 'telephonically' | 'virtual'
type CompletionDelivery = Delivery | 'hybrid'

const APPOINTMENT_SAVE_TIMEOUT_MS = 30_000

const coverageNoteWordCount = (value: unknown) =>
    String(value || '').trim().split(/\s+/).filter(Boolean).length

const validateCoverageNotes = (_rule: unknown, value: unknown) =>
    coverageNoteWordCount(value) >= 5
        ? Promise.resolve()
        : Promise.reject(new Error('Enter at least 5 words.'))

const validatePlannedCoverage = (_rule: unknown, value: unknown) =>
    coverageNoteWordCount(value) > 5
        ? Promise.resolve()
        : Promise.reject(new Error('Enter more than 5 words.'))

const toAllocatedInterventionDeliveryMethod = (value: Delivery): string => {
    if (value === 'in_person') return 'in-person'
    if (value === 'virtual') return 'online'
    return 'telephonic'
}

const withAppointmentSaveTimeout = <T,>(promise: Promise<T>, operation: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            reject(new Error(`${operation} timed out. Check your connection and try again.`))
        }, APPOINTMENT_SAVE_TIMEOUT_MS)

        promise.then(
            value => {
                window.clearTimeout(timeoutId)
                resolve(value)
            },
            error => {
                window.clearTimeout(timeoutId)
                reject(error)
            }
        )
    })
type Status = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'pending' | 'postponed'
type StatusFilter =
    | 'scheduled'
    | 'in_progress'
    | 'awaiting_coverage'
    | 'completed'
    | 'cancelled'
    | 'postponed'
    | 'all'
type UserConfirmation = 'pending' | 'confirmed' | 'declined'
type MeetingHeld = 'yes' | 'no'
type SmeAttendanceOutcome = 'attended' | 'partially_attended' | 'no_show' | 'unverified'
type IndividualSmeAttendanceOutcome = 'attended' | 'no_show' | 'unverified'
type ScheduleMode = 'individual' | 'group'

type FoodCategory = 'meal' | 'snack' | 'drink' | 'other'

type FoodMenuItem = {
    id: string
    name: string
    category: FoodCategory
    description?: string
    dietaryNote?: string
    quantityAvailable?: number | null
}

type FoodSelection = {
    participantId: string
    participantName: string
    participantEmail?: string
    itemId: string
    /** Canonical v5 invitation records store the chosen menu item under this key. */
    menuItemId?: string
    itemName: string
    category?: FoodCategory | string
    itemCategory?: FoodCategory | string
    quantity?: number
    selectedAt?: Timestamp
    selectedByEmail?: string
    selectedByName?: string
}

type SessionCoverageEntry = {
    held: boolean
    smeAttendance?: SmeAttendanceOutcome
    title?: string
    plannedCoverage?: string[]
    coveredPoints?: string[]
    notHeldReasonCategory?: 'rescheduled' | 'no-show' | 'cancelled' | 'other'
    reasonNotHeld?: string
    notes?: string
    photos?: string[]
    interventionProgress?: number
    completionRequired?: boolean
    completionAssignmentIds?: string[]
    completionGroupKey?: string
    attendanceByParticipant?: Array<{
        participantId: string
        participantName: string
        participantEmail?: string
        outcome: IndividualSmeAttendanceOutcome
    }>
    createdAt: Timestamp
    createdByEmail?: string
    createdByName?: string
}

type SessionCoverage = {
    title?: string
    plannedTopics?: string[]
    plannedCoverage?: string[]
    latest?: SessionCoverageEntry | null
    history?: SessionCoverageEntry[]
}

type AttendanceSessionStatus = 'active' | 'closed'

type AttendanceSession = {
    token: string
    status: AttendanceSessionStatus
    startedAt: Timestamp
    expiresAt: Timestamp
    createdByEmail?: string
    createdByName?: string
    qrUrl?: string
}

type AttendanceSummary = {
    count?: number
    checkedOutCount?: number
    currentlyPresentCount?: number
    lastCheckInAt?: Timestamp
    lastCheckOutAt?: Timestamp
    checkedInEmails?: string[]
    checkedOutEmails?: string[]
}

type Appt = {
    id: string
    assigneeId: string
    assigneeName: string
    assigneeEmail?: string
    assigneeRole?: 'coordinator' | 'operations'
    participantId: string
    participantName: string
    participantEmail?: string
    departmentId?: string
    interventionId: string
    assignedInterventionId?: string
    assignmentAssignedAt?: Date | null
    interventionTitle: string
    deliveryMethod: Delivery
    date: string
    startTime: Date | Timestamp
    endTime: Date | Timestamp
    meetingLink?: string
    location?: string
    status: Status
    userConfirmation: UserConfirmation
    declineReason?: string
    smeRescheduleRequest?: any
    createdAt: Timestamp
    programId?: string
    programName?: string
    branchId?: string
    branchName?: string
    sessionTitle?: string
    plannedTopics?: string[]
    plannedCoverage?: string[]
    sessionCoverage?: SessionCoverage
    attendanceSession?: AttendanceSession
    attendanceSummary?: AttendanceSummary

    isGroupAppointment?: boolean
    groupKey?: string
    appointmentGroupKey?: string
    groupTemplateId?: string
    groupTitle?: string
    groupParticipantCount?: number

    foodMenuEnabled?: boolean
    foodMenu?: FoodMenuItem[]
    foodSelections?: FoodSelection[]

    attendanceSessionGroupEmails?: string[]
    attendanceSessionGroupNames?: string[]
}

type DepartmentOption = {
    id: string
    name: string
    isParent?: boolean
    parentDepartmentId?: string
    usesTrainingCoverage?: boolean
}

const DELIVERY_METHODS = [
    { label: 'In Person', value: 'in_person', icon: <HomeOutlined /> },
    { label: 'Telephonically', value: 'telephonically', icon: <PhoneOutlined /> },
    { label: 'Virtual', value: 'virtual', icon: <VideoCameraOutlined /> }
] as const

const FOOD_CATEGORY_OPTIONS: Array<{ label: string; value: FoodCategory }> = [
    { label: 'Meal', value: 'meal' },
    { label: 'Snack', value: 'snack' },
    { label: 'Drink', value: 'drink' },
    { label: 'Other', value: 'other' }
]

const norm = (v: any) => String(v ?? '').trim().toLowerCase()

const isDifferentAppointmentLocation = (location?: string) => {
    const value = String(location || '').trim()

    return Boolean(value) && norm(value) !== 'at center'
}

const isQuantilytixUser = (email?: string) =>
    String(email || '').trim().toLowerCase().endsWith('@quantilytix.co.za')

const resolveParticipantEmail = async (
    appointment: Partial<Appt> & { participantId?: string; participantEmail?: string }
): Promise<string> => {
    const directEmail = String(appointment.participantEmail || '').trim().toLowerCase()
    if (directEmail) return directEmail

    const participantId = String(appointment.participantId || '').trim()
    if (!participantId) return ''

    try {
        const participantSnap = await getDoc(doc(db, 'participants', participantId))
        const data = participantSnap.data() as any

        return String(
            data?.email ||
            data?.participantEmail ||
            data?.contactEmail ||
            data?.contactInfo?.email ||
            ''
        ).trim().toLowerCase()
    } catch (error) {
        console.error('[EMAIL][ERROR]', participantId, error)
        return ''
    }
}

const toDateSafe = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value?.seconds) return new Date(value.seconds * 1000)
    if (value instanceof Date) return value

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatAttendanceTime = (value: any) => {
    const date = toDateSafe(value)
    return date ? dayjs(date).format('HH:mm') : '—'
}

const getAttendanceEntryForEmail = (
    appointment: Appt | null,
    email: string,
    type: 'checkin' | 'checkout'
) => {
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!appointment || !normalizedEmail) return null

    const entries =
        type === 'checkin'
            ? [
                ...(((appointment as any)?.attendance?.checkIns as any[]) || []),
                ...(((appointment as any)?.attendeeCheckIns as any[]) || [])
            ]
            : [
                ...(((appointment as any)?.attendance?.checkOuts as any[]) || []),
                ...(((appointment as any)?.attendeeCheckOuts as any[]) || [])
            ]

    const matches = entries
        .filter(entry => String(entry?.email || '').trim().toLowerCase() === normalizedEmail)
        .sort((a, b) => {
            const aDate = toDateSafe(a.checkedInAt || a.checkedOutAt)?.getTime() || 0
            const bDate = toDateSafe(b.checkedInAt || b.checkedOutAt)?.getTime() || 0
            return bDate - aDate
        })

    return matches[0] || null
}

const getAttendanceTimingForMember = (
    appointment: Appt | null,
    member: Appt,
    participantEmails: Record<string, string>
) => {
    const email = String(
        participantEmails[member.participantId] ||
        member.participantEmail ||
        ''
    )
        .trim()
        .toLowerCase()

    // Canonical appointments keep an SME's attendance directly on that SME's
    // appointment. The arrays below are only relevant to older session records.
    const directAttendance = (member as any)?.attendance
    const checkInEntry = directAttendance?.checkedInAt
        ? { checkedInAt: directAttendance.checkedInAt }
        : getAttendanceEntryForEmail(appointment, email, 'checkin')
    const checkOutEntry = directAttendance?.checkedOutAt
        ? { checkedOutAt: directAttendance.checkedOutAt }
        : getAttendanceEntryForEmail(appointment, email, 'checkout')

    const checkInDate = toDateSafe(checkInEntry?.checkedInAt)
    const checkOutDate = toDateSafe(checkOutEntry?.checkedOutAt)

    const minutesSpent =
        checkInDate && checkOutDate && checkOutDate.getTime() >= checkInDate.getTime()
            ? Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 60000)
            : null

    return {
        email,
        checkInEntry,
        checkOutEntry,
        checkInTime: formatAttendanceTime(checkInEntry?.checkedInAt),
        checkOutTime: formatAttendanceTime(checkOutEntry?.checkedOutAt),
        minutesSpent
    }
}

const formatMinutesSpent = (minutes: number | null) => {
    if (minutes === null) return '—'
    if (minutes < 60) return `${minutes} min`

    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60

    return rest ? `${hours}h ${rest}m` : `${hours}h`
}

const makeFoodMenuItemId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `food-${crypto.randomUUID().replace(/-/g, '')}`
    }

    return `food-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const normalizeFoodMenuItems = (value: any): FoodMenuItem[] => {
    if (!Array.isArray(value)) return []

    return value
        .map(item => ({
            id: String(item?.id || makeFoodMenuItemId()),
            name: String(item?.name || '').trim(),
            category: (item?.category || 'meal') as FoodCategory,
            description: String(item?.description || '').trim(),
            dietaryNote: String(item?.dietaryNote || '').trim(),
            quantityAvailable:
                item?.quantityAvailable === undefined || item?.quantityAvailable === null || item?.quantityAvailable === ''
                    ? null
                    : Number(item.quantityAvailable)
        }))
        .filter(item => item.name)
}

const getFoodCategoryLabel = (value?: string) =>
    FOOD_CATEGORY_OPTIONS.find(item => item.value === value)?.label || 'Other'

const isGroupedIntervention = (ai: any) =>
    !!normalizeAssignmentGroupKey(ai)

const getRealGroupKey = (ai: any) =>
    normalizeAssignmentGroupKey(ai)

const getGroupKind = (ai: any): 'grouped_assignment' | 'grouped_by_cycle' | null => {
    if (isGroupedIntervention(ai)) return 'grouped_assignment'
    if (isEligibleForGroupScheduling(ai)) return 'grouped_by_cycle'
    return null
}

const getGroupKindLabel = (kind: ReturnType<typeof getGroupKind>) => {
    switch (kind) {
        case 'grouped_assignment':
            return 'Grouped Assignment'
        case 'grouped_by_cycle':
            return 'Grouped by Cycle'
        default:
            return ''
    }
}

const getCycleKey = (ai: any) =>
    String(
        ai?.cycleKey ||
        ai?.recurringCycleKey ||
        ai?.seriesCycleKey ||
        ''
    ).trim()

const NON_CYCLE_VALUES = new Set([
    'once',
    'one-time',
    'one_time',
    'single',
    'single-cycle',
    'single_cycle',
    'daily',
    'weekly',
    'biweekly',
    'bi-weekly',
    'monthly',
    'quarterly',
    'annually',
    'annual',
    'other'
])

const formatCycleLabel = (value: any) => {
    const dateValue = toDateSafe(value)
    if (dateValue) return dayjs(dateValue).format('MMMM YYYY')

    const raw = String(value || '').trim()
    if (!raw || NON_CYCLE_VALUES.has(raw.toLowerCase())) return ''

    const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December'
    ]

    const yearMonth = raw.match(/^(\d{4})[-_/](\d{1,2})(?:\D|$)/)
    if (yearMonth) {
        const monthIndex = Number(yearMonth[2]) - 1
        if (monthIndex >= 0 && monthIndex < 12) {
            return `${monthNames[monthIndex]} ${yearMonth[1]}`
        }
    }

    const monthYear = raw.match(/^(\d{1,2})[-_/](\d{4})(?:\D|$)/)
    if (monthYear) {
        const monthIndex = Number(monthYear[1]) - 1
        if (monthIndex >= 0 && monthIndex < 12) {
            return `${monthNames[monthIndex]} ${monthYear[2]}`
        }
    }

    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed.format('MMMM YYYY') : raw
}

const getCycleMonthKey = (value: any) => {
    const dateValue = toDateSafe(value)
    if (dateValue) return dayjs(dateValue).format('YYYY-MM')

    const raw = String(value || '').trim()
    return formatCycleLabel(raw) ? raw : ''
}

const getCycleDisplaySource = (ai: any) =>
    ai?.dueDate ||
    getCycleKey(ai)

const getCycleDisplayLabel = (ai: any) => formatCycleLabel(getCycleDisplaySource(ai))

const getCycleStorageKey = (ai: any) => {
    const directCycleKey = getCycleKey(ai)
    if (formatCycleLabel(directCycleKey)) return directCycleKey

    return getCycleMonthKey(getCycleDisplaySource(ai))
}

const getInterventionTemplateId = (ai: any) =>
    String(ai?.interventionId || ai?.id || '').trim()

const getSyntheticGroupKey = (ai: any) => {
    const interventionId = getInterventionTemplateId(ai)
    const cycleKey = getCycleStorageKey(ai) || 'single-cycle'
    const assigneeId = String(ai?.assigneeId || '').trim()
    const programId = String(ai?.programId || '').trim()
    const departmentId = String(ai?.departmentId || '').trim()

    if (!interventionId) return ''

    return [
        'synthetic',
        assigneeId || 'no-assignee',
        programId || 'no-program',
        departmentId || 'no-department',
        interventionId,
        cycleKey
    ].join('__')
}

const getSchedulableGroupKey = (ai: any) => {
    return getSyntheticGroupKey(ai)
}

const getGroupOptionMeta = (
    groups: Array<{
        key: string
        title: string
        count: number
        interventionId: string
        cycleKey: string
        cycleLabel: string
        kind: 'grouped_assignment' | 'grouped_by_cycle'
    }>,
    pickedGroupKey?: string
) => groups.find(g => g.key === pickedGroupKey)

const isEligibleForGroupScheduling = (ai: any) => {
    if (!isSchedulableAssigned(ai)) return false

    if (isGroupedIntervention(ai)) return !!getRealGroupKey(ai)

    const interventionId = getInterventionTemplateId(ai)

    return !!interventionId
}

const isSchedulableAssigned = (row: any) => {
    const s = norm(row?.assignmentStatus)
    return (
        s === 'assigned' ||
        s === 'in-progress' ||
        s === 'in_progress' ||
        s === 'ongoing' ||
        s === 'active'
    )
}

const belongsToCurrentUser = ({
    row,
    uid,
    email,
    coordinatorDocId
}: {
    row: any
    uid: string
    email: string
    coordinatorDocId: string | null
}) => {
    const assigneeId = String(row?.assigneeId || '')
    const assigneeEmail = String(row?.assigneeEmail || '').trim().toLowerCase()

    return (
        assigneeId === uid ||
        (!!coordinatorDocId && assigneeId === coordinatorDocId) ||
        (!!email && assigneeEmail === email)
    )
}

const Appointments: React.FC = () => {
    const { user } = useFullIdentity()
    const [searchParams, setSearchParams] = useSearchParams()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'appointments',
            pageTitle: 'Appointments',
            guides: [
                {
                    id: 'appointments-overview',
                    title: 'Quick tour',
                    description:
                        'Understand appointment workload, filters, scheduling and the actions available for each session.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('appointment-metrics'),
                            popover: {
                                title: 'Session overview',
                                description:
                                    'These metrics summarise sessions in the current programme, including upcoming and completed sessions and the SMEs involved.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('appointment-filters'),
                            popover: {
                                title: 'Filter appointments',
                                description:
                                    'Narrow the workspace by delivery method, beneficiary, workflow status, date range and department where applicable.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('appointment-table'),
                            popover: {
                                title: 'Appointment workspace',
                                description:
                                    'Each row combines the intervention and SME, schedule, delivery method, SME confirmation and the actions available for the current meeting state.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('schedule-appointment-action'),
                            popover: {
                                title: 'Schedule a session',
                                description:
                                    'Create an individual appointment or schedule a session for an existing grouped intervention.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('session-review-action'),
                            popover: {
                                title: 'Review delivery activity',
                                description:
                                    'Open Session Review to analyse attendance, delivery methods and coverage over a selected period.',
                                side: 'bottom',
                                align: 'end'
                            }
                        }
                    ]
                },
                {
                    id: 'schedule-appointment',
                    title: 'Schedule an appointment',
                    description:
                        'Walk through scheduling an individual or grouped intervention session.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: guideTarget('schedule-appointment-action'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Schedule',
                                description:
                                    'Select Schedule to open the appointment form.',
                                side: 'bottom',
                                align: 'end',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-schedule-appointment-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Schedule appointment',
                                description:
                                    'The same workspace handles one-on-one and grouped intervention sessions.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('schedule-type'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Choose the schedule type',
                                description:
                                    'Use Individual for one SME or Group for an existing grouped intervention.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('schedule-target'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Choose who the session is for',
                                description:
                                    'For Individual, search for the SME. For Group, choose the grouped intervention and its eligible members are loaded automatically.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('schedule-intervention'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Choose the intervention',
                                description:
                                    'For an individual SME, select one of their currently assigned interventions. Group scheduling already knows the intervention from the selected group.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('schedule-session-title'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Session title',
                                description:
                                    'Give the session a clear title describing the activity being scheduled.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('schedule-coverage'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Plan the coverage',
                                description:
                                    'Describe what should be covered or achieved during the session. Training sessions may also require formal planned topics.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('schedule-delivery'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Delivery method',
                                description:
                                    'Choose in-person, telephonic or virtual delivery. The location or meeting-link fields adjust to the selected method.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('schedule-datetime'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Date and time',
                                description:
                                    'Set when the session starts and ends. The appointment must fall within the allowed scheduling hours.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('schedule-submit'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Save the appointment',
                                description:
                                    'Save the appointment when the details are complete. In-person sessions can optionally continue to the food-menu step before saving.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'edit-appointment',
                    title: 'Edit an appointment',
                    description:
                        'Update the session details, delivery method or schedule and save the changes.',
                    kind: 'task',
                    order: 3,
                    steps: [
                        {
                            element: '[data-guide="appointment-edit-action"]',
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: 'Edit appointment',
                                description:
                                    'Select Edit to update a scheduled appointment. Meetings that have already started use the same form as a controlled reschedule.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-edit-appointment-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Edit appointment',
                                description:
                                    'Update the meeting details here. Material changes such as the schedule, delivery method, venue or meeting link require the SME to confirm again.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('edit-delivery'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Delivery details',
                                description:
                                    'Change how the session will be delivered. Venue or meeting-link fields adapt to the selected method.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('edit-session-content'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Session plan',
                                description:
                                    'Update the session title and planned coverage when the content of the appointment has changed.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('edit-datetime'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Date and time',
                                description:
                                    'Use the same appointment date and time controls used when scheduling to change the meeting slot.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('edit-reschedule-reason'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Reason',
                                description:
                                    'A reason is optional for normal future edits, but required when moving a meeting that has already started or ended.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-edit-appointment-submit',
                            waitForElement: 5000,
                            popover: {
                                title: 'Save changes',
                                description:
                                    'Save the updated appointment. SMEs are asked to reconfirm whenever material meeting details changed.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'postpone-appointment',
                    title: 'Postpone an appointment',
                    description:
                        'Move a scheduled meeting to a later date or time without cancelling it.',
                    kind: 'task',
                    order: 4,
                    steps: [
                        {
                            element: '[data-guide="appointment-postpone-action"]',
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: 'Postpone',
                                description:
                                    'Use Postpone when the meeting is still scheduled but must move to a later slot.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-postpone-appointment-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Choose a replacement slot',
                                description:
                                    'Postponing does not cancel the meeting. Choose the new date and time and the appointment remains scheduled.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('postpone-delivery'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Delivery method',
                                description:
                                    'The current meeting type is preselected. Keep it or choose a different delivery method for the postponed session.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('postpone-connection-details'),
                            waitForElement: 1200,
                            skipMissingElement: true,
                            popover: {
                                title: 'Meeting details',
                                description:
                                    'For virtual sessions, confirm or change the meeting link. For in-person sessions, keep At Center or choose a different location.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('postpone-datetime'),
                            waitForElement: 5000,
                            popover: {
                                title: 'New date and time',
                                description:
                                    'Use the same appointment date and time controls used when scheduling to select the replacement slot.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('postpone-reason'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Optional reason',
                                description:
                                    'Add a short reason when useful. The reason is saved in the appointment schedule history.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-postpone-submit',
                            waitForElement: 5000,
                            popover: {
                                title: 'Confirm postponement',
                                description:
                                    'Save the new slot. The SME confirmation resets to pending so the updated meeting can be confirmed again.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'appointment-coverage',
                    title: 'Record or review coverage',
                    description:
                        'Open meeting coverage after a session and record the delivery outcome.',
                    kind: 'task',
                    order: 5,
                    steps: [
                        {
                            element: '[data-guide="appointment-coverage-action"]',
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: 'Coverage',
                                description:
                                    'Use Coverage after a meeting ends. If coverage already exists, this opens the saved summary so it can be reviewed or edited.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-coverage-modal',
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Meeting coverage',
                                description:
                                    'Coverage records whether the meeting happened, SME attendance and what was actually delivered.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('coverage-form'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Record the session outcome',
                                description:
                                    'Confirm attendance and capture the coverage summary. QR attendance is reused automatically when available, while telephonic sessions use manual attendance.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-coverage-submit',
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Save coverage',
                                description:
                                    'Save the coverage record. Session-based intervention progress is then updated automatically from attended sessions.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'session-review',
                    title: 'Review sessions',
                    description:
                        'Analyse appointment delivery and attendance using the Session Review workspace.',
                    kind: 'task',
                    order: 6,
                    steps: [
                        {
                            element: guideTarget('session-review-action'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Open Session Review',
                                description:
                                    'Select Review to open the session analytics workspace.',
                                side: 'bottom',
                                align: 'end',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-session-review-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Session Review',
                                description:
                                    'This is an external component, but Guide Me can continue inside it because the guide targets the rendered modal elements.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('session-review-controls'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Choose the review period',
                                description:
                                    'Switch between Data and Story views, then review daily, weekly, monthly, quarterly or custom date ranges.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('session-review-metrics'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Attendance summary',
                                description:
                                    'See sessions held, unique SMEs invited, unique SMEs attended and the resulting attendance rate.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('session-review-insights'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Delivery insights',
                                description:
                                    'Compare delivery methods and the topics most frequently captured in meeting coverage.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('session-review-table'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Coverage details',
                                description:
                                    'Review the underlying sessions, attendance counts, delivery method and recorded coverage for the selected period.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    const screens = useBreakpoint()
    const appointmentPagePadding = screens.md ? '5px 24px' : '5px 12px'
    const filterSelectCol = {
        flex: '1 1 145px',
        style: { minWidth: 120 }
    }

    const filterStatusCol = {
        flex: '0.9 1 135px',
        style: { minWidth: 120 }
    }

    const filterDateCol = {
        flex: '1.35 1 220px',
        style: { minWidth: 190 }
    }

    const filterActionCol = {
        flex: '0 0 112px',
        style: { minWidth: 0 }
    }

    const filterReviewCol = {
        flex: '0 0 96px',
        style: { minWidth: 0 }
    }

    const [participantEmails, setParticipantEmails] = useState<Record<string, string>>({})
    const canScheduleForAssignedPeople = isQuantilytixUser(user?.email)

    const [qrModalOpen, setQrModalOpen] = useState(false)
    const [qrRecord, setQrRecord] = useState<Appt | null>(null)
    const [qrModalTab, setQrModalTab] = useState<'overview' | 'attendance' | 'code'>('overview')
    const [qrLoading, setQrLoading] = useState(false)

    const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)

    const [coverageModalOpen, setCoverageModalOpen] = useState(false)
    const [coverageRecord, setCoverageRecord] = useState<Appt | null>(null)
    const [coverageViewMode, setCoverageViewMode] = useState<'summary' | 'edit'>('edit')
    const [coverageAttendancePage, setCoverageAttendancePage] = useState(1)
    const [savingCoverage, setSavingCoverage] = useState(false)
    const savingCoverageRef = useRef(false)
    const [coverageForm] = Form.useForm()
    const [completionPrompt, setCompletionPrompt] = useState<{
        assignmentId: string
        assignmentIds: string[]
        groupKey?: string
        appointmentId: string
        interventionTitle: string
        sessionsCompleted: number
        plannedSessions: number
        deliveryMethod?: CompletionDelivery
    } | null>(null)
    const [appointmentCompletionStep, setAppointmentCompletionStep] = useState<0 | 1>(0)
    const [appointmentCompletionContext, setAppointmentCompletionContext] = useState<InterventionCompletionContext | null>(null)
    const [appointmentCompletionFailureMessage, setAppointmentCompletionFailureMessage] = useState('')
    const appointmentCompletionSavingRef = useRef(false)
    const [savingAppointmentCompletion, setSavingAppointmentCompletion] = useState(false)
    const [appointmentCompletionForm] = Form.useForm()
    // Optional photos for in-person sessions - never required.
    const [coveragePhotoFiles, setCoveragePhotoFiles] = useState<UploadFile[]>([])
    const coveragePhotoFilesRef = useRef<UploadFile[]>([])
    const [existingCoveragePhotoUrls, setExistingCoveragePhotoUrls] = useState<string[]>([])

    const [foodMenuModalOpen, setFoodMenuModalOpen] = useState(false)
    const [foodMenuRecord, setFoodMenuRecord] = useState<Appt | null>(null)
    const [foodMenuTab, setFoodMenuTab] = useState<'setup' | 'selections'>('setup')
    const [savingFoodMenu, setSavingFoodMenu] = useState(false)
    const [foodMenuForm] = Form.useForm()

    const [selectedCoverageRowKeys, setSelectedCoverageRowKeys] = useState<React.Key[]>([])
    const [selectedCoverageAppointmentIds, setSelectedCoverageAppointmentIds] = useState<string[]>([])
    const [coverageTargetMode, setCoverageTargetMode] = useState<'single' | 'same-day' | 'selected'>('single')

    const [monthReviewOpen, setMonthReviewOpen] = useState(false)
    const [reviewRange, setReviewRange] = useState<'day' | 'week' | 'month' | 'quarter'>('month')
    const [reviewDate, setReviewDate] = useState<Dayjs>(dayjs())
    const [clockNow, setClockNow] = useState<Dayjs>(() => dayjs())

    const [filterDelivery, setFilterDelivery] = useState<Delivery | undefined>()
    const [filterParticipant, setFilterParticipant] = useState<string | undefined>()
    const [filterDateRange, setFilterDateRange] = useState<[Dayjs, Dayjs] | null>(null)
    const [filterStatus, setFilterStatus] = useState<StatusFilter>('all')

    const [appointments, setAppointments] = useState<Appt[]>([])
    const [assignedInterventions, setAssignedInterventions] = useState<any[]>([])
    const [participantPhones, setParticipantPhones] = useState<Record<string, string>>({})
    const [coordinatorDocId, setCoordinatorDocId] = useState<string | null>(null)
    const [coordinatorAssigneeIds, setCoordinatorAssigneeIds] = useState<string[]>([])

    // Completion delivery is derived from the appointments attached to the
    // assignment. It is never entered or persisted on assignedInterventions.
    const deriveCompletionDelivery = (assignmentIds: string[], current?: Pick<Appt, 'id' | 'assignedInterventionId' | 'deliveryMethod'>): CompletionDelivery | '' => {
        const ids = new Set(assignmentIds.map(String))
        const methods = new Set<Delivery>()
        for (const appointment of appointments) {
            const matches = ids.has(String(appointment.assignedInterventionId || ''))
            const isRelevantStatus = !appointment.status || !['cancelled', 'postponed'].includes(appointment.status)
            if (matches && isRelevantStatus && appointment.deliveryMethod) methods.add(appointment.deliveryMethod)
        }
        if (current?.deliveryMethod) methods.add(current.deliveryMethod)
        if (methods.has('in_person') && methods.has('virtual')) return 'hybrid'
        if (methods.size === 1) return [...methods][0]
        return ''
    }

    const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('individual')
    const [pickedParticipantId, setPickedParticipantId] = useState<string | undefined>()
    const [pickedGroupKey, setPickedGroupKey] = useState<string | undefined>()

    const [modalOpen, setModalOpen] = useState(false)
    const [createStep, setCreateStep] = useState(0)
    const [appointmentDetailsDraft, setAppointmentDetailsDraft] = useState<Record<string, any>>({})
    const [editModalOpen, setEditModalOpen] = useState(false)
    const [postponeModalOpen, setPostponeModalOpen] = useState(false)
    const [postponeRecord, setPostponeRecord] = useState<Appt | null>(null)
    const [postponeLoading, setPostponeLoading] = useState(false)
    const [detailModalOpen, setDetailModalOpen] = useState(false)
    const [selectedAppt, setSelectedAppt] = useState<Appt | null>(null)
    const [detailModalTab, setDetailModalTab] = useState<'overview' | 'members' | 'food'>('overview')


    const openAppointmentDetails = (appointment: Appt) => {
        console.group('[Appointment Details] Opening')
        console.log('Appointment:', appointment)
        console.log('Appointment ID:', appointment.id)
        console.log('Program ID:', appointment.programId)
        console.log('Department ID:', appointment.departmentId)
        console.log('Assigned Intervention ID:', appointment.assignedInterventionId)
        console.log('Intervention ID:', appointment.interventionId)
        console.log('Participant:', {
            id: appointment.participantId,
            name: appointment.participantName,
            email: appointment.participantEmail
        })
        console.log('Assignee:', {
            id: appointment.assigneeId,
            name: appointment.assigneeName,
            email: appointment.assigneeEmail,
            role: appointment.assigneeRole
        })
        console.log('Full raw appointment:', appointment)
        console.groupEnd()

        // Open AFTER logging
        setSelectedAppt(appointment)
        setDetailModalTab('overview')
        setDetailModalOpen(true)
    }
    const [loading, setLoading] = useState(false)
    const [editLoading, setEditLoading] = useState(false)
    const [rescheduleDecisionLoading, setRescheduleDecisionLoading] = useState<string | null>(null)

    const [appointmentsLoading, setAppointmentsLoading] = useState(false)
    const [assignedLoading, setAssignedLoading] = useState(false)
    const [coordinatorLoading, setCoordinatorLoading] = useState(false)
    const appointmentsRequestIdRef = useRef(0)
    const assignedRequestIdRef = useRef(0)
    const coverageQueryHandledRef = useRef('')

    const [form] = Form.useForm()
    const [editForm] = Form.useForm()
    const [postponeForm] = Form.useForm()
    const createDeliveryMethod = Form.useWatch('deliveryMethod', form) as Delivery | undefined
    const postponeDeliveryMethod = Form.useWatch(
        'deliveryMethod',
        postponeForm
    )

    const hasPostponeConnectionDetails =
        postponeDeliveryMethod === 'in_person' ||
        postponeDeliveryMethod === 'virtual'

    const [departmentScopeOptions, setDepartmentScopeOptions] = useState<DepartmentOption[]>([])
    const [selectedDepartmentScope, setSelectedDepartmentScope] = useState<string>('all')
    const [isParentDepartmentView, setIsParentDepartmentView] = useState(false)
    const [allowedDepartmentIds, setAllowedDepartmentIds] = useState<string[]>([])

    const departmentNameMap = useMemo(() => {
        return departmentScopeOptions.reduce<Record<string, string>>((acc, opt) => {
            acc[opt.id] = opt.name
            return acc
        }, {})
    }, [departmentScopeOptions])
    const isTrainingAcademyCoverage = departmentScopeOptions.find(
        option => option.id === String(coverageRecord?.departmentId || user?.departmentId || '')
    )?.usesTrainingCoverage === true

    useEffect(() => {
        // Ignore any slower response from the previous program or route while
        // retaining its rows until the next scope has finished loading.
        appointmentsRequestIdRef.current += 1
        assignedRequestIdRef.current += 1

        // A route/program change must never retain a mutation spinner from the
        // previous view, including when Firestore was waiting for connectivity.
        setLoading(false)
        setEditLoading(false)
        setSavingCoverage(false)
        setSavingFoodMenu(false)
        setAppointmentDetailsDraft({})

        form.resetFields()
        editForm.resetFields()

        setSelectedAppt(null)
        setDetailModalOpen(false)
        setEditModalOpen(false)
        setPostponeModalOpen(false)
        setPostponeRecord(null)
        setPostponeLoading(false)
        postponeForm.resetFields()
        setModalOpen(false)
        setCoverageModalOpen(false)
        setCoverageRecord(null)
        setCompletionPrompt(null)
        setCoverageViewMode('edit')
        setCoverageAttendancePage(1)
        coverageForm.resetFields()
        setFoodMenuModalOpen(false)
        setFoodMenuRecord(null)
        setFoodMenuTab('setup')
        foodMenuForm.resetFields()
        setMonthReviewOpen(false)
        setReviewRange('month')
        setReviewDate(dayjs())

        setFilterDelivery(undefined)
        setFilterParticipant(undefined)
        setFilterDateRange(null)
        setFilterStatus('all')

        setScheduleMode('individual')
        setPickedParticipantId(undefined)
        setPickedGroupKey(undefined)
        setSelectedCoverageRowKeys([])
        setSelectedCoverageAppointmentIds([])
        setCoverageTargetMode('single')
    }, [activeProgramId, form, editForm, postponeForm, coverageForm, foodMenuForm])

    useEffect(() => {
        const timer = window.setInterval(() => setClockNow(dayjs()), 30_000)
        return () => window.clearInterval(timer)
    }, [])

    const parseAppointmentTime = (value: any, dateKey?: string): Dayjs | null => {
        if (!value) return null

        if (dayjs.isDayjs(value)) {
            return value.isValid() ? value : null
        }

        const asDate = toDateSafe(value)
        if (asDate) {
            const parsed = dayjs(asDate)
            return parsed.isValid() ? parsed : null
        }

        const raw = String(value || '').trim()
        if (!raw) return null

        const parsedAsTime = dayjs(raw, ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'hh:mm A'], true)
        if (parsedAsTime.isValid()) {
            const key = dateKey && dayjs(dateKey, 'YYYY-MM-DD', true).isValid()
                ? dateKey
                : dayjs().format('YYYY-MM-DD')

            return dayjs(`${key} ${parsedAsTime.format('HH:mm')}`, 'YYYY-MM-DD HH:mm', true)
        }

        const parsedAsDate = dayjs(raw)
        return parsedAsDate.isValid() ? parsedAsDate : null
    }

    const tsToDayjs = (t: Date | Timestamp | string, dateKey?: string): Dayjs =>
        parseAppointmentTime(t, dateKey) || dayjs('')

    const formatTime = (t: Date | Timestamp | string, dateKey?: string) => {
        const parsed = parseAppointmentTime(t, dateKey)
        return parsed?.isValid() ? parsed.format('HH:mm') : ''
    }

    const hasStarted = (a: Appt) => {
        const start = dayjs(`${a.date} ${formatTime(a.startTime)}`, 'YYYY-MM-DD HH:mm')
        return start.isValid() && start.isBefore(clockNow)
    }

    const hasEnded = (a: Appt) => {
        const end = dayjs(`${a.date} ${formatTime(a.endTime)}`, 'YYYY-MM-DD HH:mm')
        return end.isValid() && end.isBefore(clockNow)
    }

    // After the correction window, the historical appointment must be closed
    // through coverage (held or not held), never retrospectively cancelled or moved.
    const isCoverageOnly = (a: Appt) => {
        const end = dayjs(`${a.date} ${formatTime(a.endTime)}`, 'YYYY-MM-DD HH:mm')
        return end.isValid() && clockNow.isAfter(end.add(48, 'hour'))
    }

    // attendanceEvidence / canReschedule / rescheduleBlockReason are defined
    // below, next to getAttendanceCounts, which they depend on.

    const supportsQrAttendance = (a?: Appt | null) =>
        a?.deliveryMethod === 'in_person' || a?.deliveryMethod === 'virtual'

    const hasConfiguredFoodMenu = (a?: Appt | null) =>
        a?.deliveryMethod === 'in_person' &&
        Boolean(a.foodMenuEnabled) &&
        normalizeFoodMenuItems(a.foodMenu || []).length > 0

    const hasQrAttendance = (a?: Appt | null) =>
        Boolean(a && (
            (supportsQrAttendance(a) && a.attendanceSession?.token) ||
            a.attendance?.checkedInAt ||
            ((a as any)._groupMembers || []).some((member: Appt) => member.attendance?.checkedInAt)
        ))

    const canStartQrWindow = (a: Appt) => {
        const start = dayjs(`${a.date} ${formatTime(a.startTime)}`, 'YYYY-MM-DD HH:mm')
        if (!start.isValid()) return false
        return clockNow.isAfter(start.subtract(15, 'minute'))
    }

    const resolveDepartmentScope = async () => {
        const myDepartmentId = (user as any)?.departmentId as string | undefined

        let allowedDeptIds: string[] = []
        let scopeOptions: DepartmentOption[] = []
        let parentView = false

        if (myDepartmentId) {
            const depsSnap = await getDocs(
                collection(db, 'departments')
            )

            const allDepartments = depsSnap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            }))

            const myDepartment = allDepartments.find(d => d.id === myDepartmentId)
            const childDepartments = getDepartmentDescendants(myDepartmentId, allDepartments)

            parentView = childDepartments.length > 0
            setIsParentDepartmentView(parentView)

            if (parentView) {
                allowedDeptIds = Array.from(new Set([myDepartmentId, ...childDepartments.map(d => d.id)]))

                scopeOptions = [
                    { id: 'all', name: 'All Departments' },
                    ...(myDepartment
                        ? [
                            {
                                id: myDepartment.id,
                                name: myDepartment.name || 'Parent Department',
                                isParent: true,
                                parentDepartmentId: myDepartment.parentDepartmentId,
                                usesTrainingCoverage: departmentUsesTrainingCoverage(
                                    myDepartment.id,
                                    allDepartments
                                )
                            }
                        ]
                        : []),
                    ...childDepartments.map(d => ({
                        id: d.id,
                        name: d.name || 'Unnamed Department',
                        parentDepartmentId: d.parentDepartmentId,
                        usesTrainingCoverage: departmentUsesTrainingCoverage(d.id, allDepartments)
                    }))
                ]
            } else {
                allowedDeptIds = myDepartmentId ? [myDepartmentId] : []
                scopeOptions = myDepartment
                    ? [{
                        id: myDepartment.id,
                        name: myDepartment.name || 'Current Department',
                        parentDepartmentId: myDepartment.parentDepartmentId,
                        usesTrainingCoverage: departmentUsesTrainingCoverage(
                            myDepartment.id,
                            allDepartments
                        )
                    }]
                    : []
            }
        } else {
            const depsSnap = await getDocs(
                collection(db, 'departments')
            )

            const allDepartments = depsSnap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            }))

            allowedDeptIds = allDepartments.map(d => d.id)
            scopeOptions = [
                { id: 'all', name: 'All Departments' },
                ...allDepartments.map(d => ({
                    id: d.id,
                    name: d.name || 'Unnamed Department',
                    parentDepartmentId: d.parentDepartmentId,
                    usesTrainingCoverage: departmentUsesTrainingCoverage(d.id, allDepartments)
                }))
            ]
            setIsParentDepartmentView(true)
        }

        setAllowedDepartmentIds(allowedDeptIds)
        setDepartmentScopeOptions(scopeOptions)
        setSelectedDepartmentScope(prev => {
            if (!scopeOptions.length) return 'all'
            if (scopeOptions.some(opt => opt.id === prev)) return prev
            return scopeOptions.some(opt => opt.id === 'all') ? 'all' : scopeOptions[0].id
        })

        return { allowedDeptIds, scopeOptions, parentView }
    }

    const currentRole = String((user as any)?.role || '').toLowerCase()
    const isOperationsView = currentRole === 'operations'

    const lastAddAppointmentDisabledLogRef = useRef('')

    const addAppointmentDisabledReasons = useMemo(() => {
        const reasons: string[] = []

        if (!activeProgramId) {
            reasons.push(
                isAllPrograms
                    ? 'All Programs is selected. Select one specific program before adding an appointment.'
                    : 'No active program is selected.'
            )
        }

        if (coordinatorLoading) {
            reasons.push('Assignee profile lookup is still loading.')
        }

        if (assignedLoading) {
            reasons.push('Assigned interventions are still loading.')
        }

        if (
            !isOperationsView &&
            !canScheduleForAssignedPeople &&
            !coordinatorDocId &&
            !coordinatorLoading
        ) {
            reasons.push('No matching coordinator record was found for this user/email.')
        }

        if (
            isOperationsView &&
            !allowedDepartmentIds.length &&
            !assignedLoading &&
            !coordinatorLoading
        ) {
            reasons.push('Operations user has no department scope available.')
        }

        return reasons
    }, [
        activeProgramId,
        isAllPrograms,
        coordinatorLoading,
        assignedLoading,
        canScheduleForAssignedPeople,
        coordinatorDocId,
        isOperationsView,
        allowedDepartmentIds.length
    ])

    const isAddAppointmentDisabled = addAppointmentDisabledReasons.length > 0

    useEffect(() => {
        if (!isAddAppointmentDisabled) return

        const logPayload = {
            reasons: addAppointmentDisabledReasons,
            activeProgramId,
            isAllPrograms,
            coordinatorDocId,
            canScheduleForAssignedPeople,
            assignedLoading,
            coordinatorLoading,
            appointmentsLoading,
            assignedInterventionsCount: assignedInterventions.length,
            allowedDepartmentIds,
            user: {
                uid: user?.uid,
                email: user?.email,
                role: (user as any)?.role,
                departmentId: (user as any)?.departmentId
            }
        }

        const logKey = JSON.stringify(logPayload)

        if (lastAddAppointmentDisabledLogRef.current === logKey) return

        lastAddAppointmentDisabledLogRef.current = logKey

    }, [
        isAddAppointmentDisabled,
        addAppointmentDisabledReasons,
        activeProgramId,
        isAllPrograms,
        coordinatorDocId,
        canScheduleForAssignedPeople,
        assignedLoading,
        coordinatorLoading,
        appointmentsLoading,
        assignedInterventions.length,
        allowedDepartmentIds,
        user?.uid,
        user?.email,
        user?.departmentId,
        user?.role
    ])

    const DEFAULT_QR_DURATION_MINUTES = 90

    const generateQrToken = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID().replace(/-/g, '')
        }

        return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    }

    const buildQrUrl = (_appointmentSessionId: string, token: string) => {
        const origin =
            typeof window !== 'undefined' && window.location?.origin
                ? window.location.origin
                : ''

        // Session IDs are stable composite keys and can be very long for a
        // group intervention. Keep the QR small and reliably scannable; the
        // check-in page resolves the one active session from this random token.
        return `${origin}/meeting-checkin?token=${encodeURIComponent(token)}`
    }

    const isQrSessionActive = (a: Appt) => {
        const session = a.attendanceSession
        if (!session) return false
        if (session.status !== 'active') return false

        const expiresAt =
            typeof (session.expiresAt as any)?.toDate === 'function'
                ? (session.expiresAt as any).toDate()
                : session.expiresAt

        return dayjs(expiresAt).isAfter(dayjs())
    }

    const openQrModal = (appt: Appt) => {
        setQrRecord(appt)
        setQrModalTab('overview')
        setQrModalOpen(true)
    }

    const closeQrModal = () => {
        setQrModalOpen(false)
        setQrRecord(null)
        setQrModalTab('overview')
    }

    const startQrSession = async (appt: Appt) => {
        if (!user?.email) {
            message.error('You must be logged in.')
            return
        }

        if (!supportsQrAttendance(appt)) {
            message.warning('QR attendance is only available for in-person and online appointments.')
            return
        }

        if (!canStartQrWindow(appt)) {
            message.warning('QR attendance can only start 15 minutes before the meeting.')
            return
        }

        if (
            hasEnded(appt) ||
            appt.status === 'completed' ||
            appt.status === 'cancelled' ||
            appt.status === 'postponed'
        ) {
            message.warning('This appointment is no longer open for QR attendance.')
            return
        }

        setQrLoading(true)
        try {
            const appointmentSessionId = String((appt as any).appointmentSessionId || '').trim()
            if (!appointmentSessionId) {
                throw new Error('This appointment is not linked to a session.')
            }
            const rawGroupMembers = Array.isArray((appt as any)?._groupMembers)
                ? (appt as any)._groupMembers
                : []

            const validGroupMembers = rawGroupMembers.filter((m: Appt) => {
                const pid = String(m.participantId || '').trim()
                if (!pid) return false
                if (pid.startsWith('group-')) return false
                if (/^\d+\s+participants?$/i.test(String(m.participantName || '').trim())) return false
                return true
            })

            const resolvedGroupEmails = Array.from(
                new Set(
                    (
                        await Promise.all(
                            validGroupMembers.map(async (m: Appt) => {
                                const resolved = await resolveParticipantEmail({
                                    participantId: m.participantId,
                                    participantEmail: m.participantEmail
                                })

                                return resolved
                            })
                        )
                    ).filter(Boolean)
                )
            )

            const token = generateQrToken()
            const expiresAt = Timestamp.fromDate(
                dayjs().add(DEFAULT_QR_DURATION_MINUTES, 'minute').toDate()
            )
            const qrUrl = buildQrUrl(appointmentSessionId, token)

            const patch = {
                attendanceSession: {
                    token,
                    qrUrl,
                    status: 'active' as AttendanceSessionStatus,
                    startedAt: Timestamp.now(),
                    expiresAt,
                    closedAt: null
                },
                attendanceSessionGroupEmails: resolvedGroupEmails,
                attendanceSessionGroupNames: validGroupMembers
                    .map((m: Appt) => m.participantName)
                    .filter(Boolean),
                status: 'in_progress' as Status,
                startedAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            }

            const batch = writeBatch(db)
            batch.update(doc(db, 'appointmentSessions', appointmentSessionId), {
                attendanceSession: patch.attendanceSession,
                status: patch.status,
                updatedAt: patch.updatedAt
            })
            appointments
                .filter(item => String((item as any).appointmentSessionId || '') === appointmentSessionId)
                .forEach(item => batch.update(doc(db, 'appointments', item.id), {
                    status: 'in_progress',
                    updatedAt: patch.updatedAt
                }))
            await batch.commit()

            const updated: Appt = {
                ...appt,
                status: 'in_progress',
                attendanceSession: patch.attendanceSession,
                attendanceSessionGroupEmails: patch.attendanceSessionGroupEmails,
                attendanceSessionGroupNames: patch.attendanceSessionGroupNames
            }

            setAppointments(prev => prev.map(a => (a.id === appt.id ? updated : a)))
            setQrRecord(updated)
            setQrModalOpen(true)

            message.success('QR attendance started.')
        } catch (e: any) {
            console.error(e)
            message.error('Failed to start QR attendance.')
        } finally {
            setQrLoading(false)
        }
    }

    const closeQrSession = async (appt: Appt) => {
        setQrLoading(true)
        try {
            const appointmentSessionId = String((appt as any).appointmentSessionId || '').trim()
            if (!appointmentSessionId) throw new Error('This appointment is not linked to a session.')
            const current = appt.attendanceSession

            if (!current) {
                message.warning('No active QR session found.')
                return
            }

            const updatedSession: AttendanceSession = {
                ...current,
                status: 'closed'
            }

            await updateDoc(doc(db, 'appointmentSessions', appointmentSessionId), {
                attendanceSession: { ...updatedSession, closedAt: Timestamp.now() },
                updatedAt: Timestamp.now()
            } as any)

            const updated: Appt = {
                ...appt,
                attendanceSession: updatedSession
            }

            setAppointments(prev =>
                prev.map(a => (a.id === appt.id ? updated : a))
            )

            if (qrRecord?.id === appt.id) {
                setQrRecord(updated)
            }

            if (selectedAppt?.id === appt.id) {
                setSelectedAppt(updated)
            }

            message.success('QR attendance closed.')
        } catch (e) {
            console.error(e)
            message.error('Failed to close QR attendance.')
        } finally {
            setQrLoading(false)
        }
    }

    const checkOutParticipant = async (
        appointmentRow: Appt,
        member?: Appt,
        options: { silent?: boolean; manageLoading?: boolean } = {}
    ): Promise<'checked_out' | 'not_checked_in' | 'already_checked_out' | 'failed'> => {
        const { silent = false, manageLoading = true } = options
        if (!user?.email) {
            if (!silent) message.error('You must be logged in.')
            return 'failed'
        }

        const isGroup =
            (appointmentRow as any)?._displayType === 'group' &&
            Array.isArray((appointmentRow as any)?._groupMembers)

        const targetMember = member || appointmentRow

        let targetEmail = String(
            participantEmails[targetMember.participantId] ||
            targetMember.participantEmail ||
            ''
        )
            .trim()
            .toLowerCase()

        if (!targetEmail) {
            targetEmail = await resolveParticipantEmail(targetMember)
        }

        if (!targetEmail) {
            if (!silent) message.error(`Cannot check out ${targetMember.participantName || 'this SME'} because no email is available.`)
            return 'failed'
        }

        const appointmentIdToUpdate = targetMember.id
        const loadingKey = `${appointmentIdToUpdate}-${targetEmail}`

        if (manageLoading) setCheckoutLoading(loadingKey)

        try {
            // A display row can be an aggregate. Resolve the actual SME
            // appointment in this session before changing attendance.
            const memberSnapshot = await getDocs(fsQuery(
                collection(db, 'appointments'),
                where('appointmentSessionId', '==', appointmentRow.appointmentSessionId)
            ))
            const matchingMember = memberSnapshot.docs.find(item => {
                const data = item.data() as any
                return String(data.smeEmail || '').trim().toLowerCase() === targetEmail ||
                    String(data.smeId || '').trim() === String(targetMember.participantId || '').trim()
            })

            if (!matchingMember) {
                throw new Error('The SME appointment could not be found for this session.')
            }

            const ref = matchingMember.ref
            const sessionRef = doc(db, 'appointmentSessions', appointmentRow.appointmentSessionId)

            const result = await runTransaction(db, async transaction => {
                const [snap, sessionSnap] = await Promise.all([
                    transaction.get(ref),
                    transaction.get(sessionRef)
                ])

                if (!snap.exists()) {
                    throw new Error('Appointment not found.')
                }
                if (!sessionSnap.exists()) {
                    throw new Error('Appointment session not found.')
                }

                const raw = snap.data() as any
                const session = sessionSnap.data() as any
                const nowTs = Timestamp.now()
                if (raw.attendance?.status !== 'attended' || !raw.attendance?.checkedInAt) {
                    return {
                        status: 'not_checked_in',
                        checkedInEmails: [],
                        checkedOutEmails: []
                    }
                }

                if (raw.attendance?.checkedOutAt) {
                    return {
                        status: 'already_checked_out',
                        checkedInEmails: [],
                        checkedOutEmails: []
                    }
                }

                const checkedInCount = Number(session.attendanceSummary?.checkedInCount || 0)
                const checkedOutCount = Number(session.attendanceSummary?.checkedOutCount || 0) + 1
                transaction.update(ref, {
                    attendance: { ...raw.attendance, checkedOutAt: nowTs },
                    updatedAt: nowTs
                })
                transaction.update(sessionRef, {
                    attendanceSummary: {
                        ...session.attendanceSummary,
                        checkedInCount,
                        checkedOutCount
                    },
                    updatedAt: nowTs
                })

                return {
                    status: 'checked_out',
                    checkedInEmails: [],
                    checkedOutEmails: [],
                    checkedInCount,
                    checkedOutCount
                }
            })

            if (result.status === 'not_checked_in') {
                if (!silent) message.warning('This SME has not checked in yet.')
                return 'not_checked_in'
            }

            if (result.status === 'already_checked_out') {
                if (!silent) message.info('This SME has already checked out.')
                return 'already_checked_out'
            }

            const checkedOutAt = Timestamp.now()
            const patchSummary: AttendanceSummary = {
                count: result.checkedInCount,
                checkedOutCount: result.checkedOutCount,
                currentlyPresentCount: Math.max(
                    result.checkedInCount - result.checkedOutCount,
                    0
                ),
                lastCheckOutAt: checkedOutAt
            }

            setAppointments(prev =>
                prev.map(a =>
                    a.id === appointmentIdToUpdate
                        ? {
                            ...a,
                            attendance: { ...(a.attendance || {}), checkedOutAt },
                            attendanceSummary: {
                                ...(a.attendanceSummary || {}),
                                ...patchSummary
                            }
                        }
                        : a
                )
            )

            if (selectedAppt?.id === appointmentIdToUpdate) {
                setSelectedAppt({
                    ...selectedAppt,
                    attendanceSummary: {
                        ...(selectedAppt.attendanceSummary || {}),
                        ...patchSummary
                    }
                })
            }

            if (qrRecord?.id === appointmentIdToUpdate) {
                setQrRecord({
                    ...qrRecord,
                    attendanceSummary: {
                        ...(qrRecord.attendanceSummary || {}),
                        ...patchSummary
                    }
                })
            }

            if (!silent) message.success('SME checked out.')
            return 'checked_out'
        } catch (e: any) {
            console.error(e)
            const errorText = String(e?.message || e?.code || '').toLowerCase()
            if (!silent) {
                message.error(
                    errorText.includes('network') || errorText.includes('unavailable') || errorText.includes('deadline')
                        ? 'Checkout could not reach the server. Check the connection and try again.'
                        : errorText.includes('permission')
                            ? 'Checkout was blocked by your account permissions.'
                            : `Failed to check out ${targetMember.participantName || 'SME'}. Please try again.`
                )
            }
            return 'failed'
        } finally {
            if (manageLoading) setCheckoutLoading(null)
        }
    }

    const getBulkCheckoutEligibility = (appointmentRow: Appt) => {
        const members = Array.isArray((appointmentRow as any)?._groupMembers)
            ? ((appointmentRow as any)._groupMembers as Appt[])
            : []

        const eligibleMembers: Appt[] = []
        let notCheckedInCount = 0
        let alreadyCheckedOutCount = 0
        let missingEmailCount = 0

        members.forEach(member => {
            if (!isGroupMemberCheckedIn(appointmentRow, member, participantEmails)) {
                notCheckedInCount += 1
                return
            }

            if (isGroupMemberCheckedOut(appointmentRow, member, participantEmails)) {
                alreadyCheckedOutCount += 1
                return
            }

            const email = String(
                participantEmails[member.participantId] || member.participantEmail || ''
            ).trim()

            if (!email) {
                missingEmailCount += 1
                return
            }

            eligibleMembers.push(member)
        })

        return {
            eligibleMembers,
            notCheckedInCount,
            alreadyCheckedOutCount,
            missingEmailCount,
            excludedCount: members.length - eligibleMembers.length
        }
    }

    const checkOutAllPresent = async (appointmentRow: Appt) => {
        const { eligibleMembers, missingEmailCount } = getBulkCheckoutEligibility(appointmentRow)

        if (!eligibleMembers.length) {
            message.info(
                missingEmailCount
                    ? 'No SMEs can be checked out. Add the missing email details first.'
                    : 'There are no checked-in SMEs waiting to be checked out.'
            )
            return
        }

        const bulkLoadingKey = `${appointmentRow.id}-bulk`
        setCheckoutLoading(bulkLoadingKey)
        try {
            const results: Array<Awaited<ReturnType<typeof checkOutParticipant>>> = []
            for (const member of eligibleMembers) {
                results.push(await checkOutParticipant(appointmentRow, member, {
                    silent: true,
                    manageLoading: false
                }))
            }

            const completed = results.filter(result => result === 'checked_out').length
            const failed = results.filter(result => result === 'failed').length
            if (completed) {
                message.success(`${completed} SME${completed === 1 ? '' : 's'} checked out successfully.`)
            }
            if (failed) {
                message.warning(`${failed} checkout${failed === 1 ? '' : 's'} could not be completed. Check the SME email details and connection, then try again.`)
            }
        } finally {
            setCheckoutLoading(null)
        }
    }

    const isApptDone = (a: Appt) => {
        if (String(a.userConfirmation || '').toLowerCase() === 'declined') return false
        if (a.status === 'completed') return true
        if (a.status === 'cancelled' || a.status === 'postponed') return false
        return hasEnded(a)
    }

    const derivedStatus = (
        a: Appt
    ): 'scheduled' | 'in_progress' | 'awaiting_coverage' | 'completed' | 'cancelled' | 'postponed' => {
        if (a.status === 'cancelled') return 'cancelled'
        if (a.status === 'postponed') return 'postponed'
        if (a.sessionCoverage?.latest) return 'completed'

        if (hasEnded(a)) return 'awaiting_coverage'
        if (a.status === 'completed') return 'completed'

        const started = hasStarted(a)
        const activeQr = isQrSessionActive(a)

        if (a.status === 'in_progress' || activeQr || started) {
            return 'in_progress'
        }

        return 'scheduled'
    }

    const awaitingCoverageCount = useMemo(
        () => new Set(
            appointments
                .filter(a => derivedStatus(a) === 'awaiting_coverage')
                .map(a => getAppointmentGroupKey(a) || a.id)
        ).size,
        [appointments]
    )

    const displayStatus = (a: Appt) => {
        if (String(a.userConfirmation || '').toLowerCase() === 'declined') {
            return { label: 'SME DECLINED', color: 'red' as const, icon: <StopOutlined /> }
        }
        const status = derivedStatus(a)

        if (status === 'cancelled') {
            return { label: 'CANCELLED', color: 'red' as const, icon: <StopOutlined /> }
        }
        if (status === 'postponed') {
            return { label: 'POSTPONED', color: 'orange' as const, icon: <ClockCircleOutlined /> }
        }
        if (status === 'completed') {
            return { label: 'COMPLETED', color: 'green' as const, icon: <CheckCircleOutlined /> }
        }
        if (status === 'awaiting_coverage') {
            return { label: 'AWAITING COVERAGE', color: 'gold' as const, icon: <FileDoneOutlined /> }
        }
        if (status === 'in_progress') {
            return { label: 'IN PROGRESS', color: 'processing' as const, icon: <ClockCircleOutlined /> }
        }

        return { label: 'SCHEDULED', color: 'blue' as const, icon: <CalendarOutlined /> }
    }

    const rowStatusStyle = (a: Appt) => {
        const status = derivedStatus(a)
        if (status === 'completed') {
            return { backgroundColor: '#f6ffed' }
        }
        if (status === 'awaiting_coverage') {
            return { backgroundColor: '#fff7e6' }
        }
        if (status === 'cancelled' || status === 'postponed') {
            return { backgroundColor: '#fff1f0' }
        }
        return {}
    }

    const isGroupMemberCheckedIn = (
        groupAppt: Appt | null,
        member: Appt,
        participantEmails: Record<string, string>
    ) => {
        // Canonical v5 check-in is stored on each invitation. Do not rely on
        // an email list here: some valid SME invitations are linked by ID and
        // have no copied email address.
        if (['attended', 'checked-in', 'checked-out'].includes(String((member as any)?.attendance?.status || ''))) {
            return true
        }

        const checkedInEmails = new Set(
            (((groupAppt as any)?.attendanceSummary?.checkedInEmails as string[]) || [])
                .map(email => String(email || '').trim().toLowerCase())
                .filter(Boolean)
        )

        const memberEmail = String(
            participantEmails[member.participantId] ||
            member.participantEmail ||
            ''
        )
            .trim()
            .toLowerCase()

        if (!memberEmail) {
            return Number(member.attendanceSummary?.count || 0) > 0
        }

        return checkedInEmails.has(memberEmail)
    }

    const getCheckedInEmails = (a?: Appt | null) =>
        Array.from(
            new Set(
                [
                    ...(((a as any)?.attendance?.summary?.checkedInEmails as string[]) || []),
                    ...(((a as any)?.attendanceSummary?.checkedInEmails as string[]) || [])
                ]
                    .map(email => String(email || '').trim().toLowerCase())
                    .filter(Boolean)
            )
        )

    const getCheckedOutEmails = (a?: Appt | null) =>
        Array.from(
            new Set(
                [
                    ...(((a as any)?.attendance?.summary?.checkedOutEmails as string[]) || []),
                    ...(((a as any)?.attendanceSummary?.checkedOutEmails as string[]) || [])
                ]
                    .map(email => String(email || '').trim().toLowerCase())
                    .filter(Boolean)
            )
        )

    const isGroupMemberCheckedOut = (
        groupAppt: Appt | null,
        member: Appt,
        participantEmails: Record<string, string>
    ) => {
        if ((member as any)?.attendance?.checkedOutAt) return true

        const checkedOutEmails = new Set(getCheckedOutEmails(groupAppt))

        const memberEmail = String(
            participantEmails[member.participantId] ||
            member.participantEmail ||
            ''
        )
            .trim()
            .toLowerCase()

        if (!memberEmail) return false

        return checkedOutEmails.has(memberEmail)
    }

    const getAttendanceCounts = (appt: Appt | null) => {
        if (!appt) {
            return {
                confirmed: 0,
                total: 0,
                checkedIn: 0,
                checkedOut: 0,
                currentlyPresent: 0
            }
        }

        const isGroup =
            (appt as any)?._displayType === 'group' &&
            Array.isArray((appt as any)?._groupMembers)

        const members = isGroup ? ((appt as any)._groupMembers as Appt[]) : [appt]

        const confirmed = members.filter(m => m.userConfirmation === 'confirmed').length

        const checkedInEmails = getCheckedInEmails(appt)
        const checkedOutEmails = getCheckedOutEmails(appt)

        const checkedIn = isGroup
            ? members.filter(m => isGroupMemberCheckedIn(appt, m, participantEmails)).length
            : checkedInEmails.length > 0 || Number(appt.attendanceSummary?.count || 0) > 0
                ? 1
                : 0

        const checkedOut = isGroup
            ? members.filter(m => isGroupMemberCheckedOut(appt, m, participantEmails)).length
            : checkedOutEmails.length > 0
                ? 1
                : 0

        return {
            confirmed,
            total: members.length,
            checkedIn,
            checkedOut,
            currentlyPresent: Math.max(checkedIn - checkedOut, 0)
        }
    }

    /**
     * Evidence that this meeting actually ran, tied to its current date and time.
     *
     * Counts come from getAttendanceCounts, which resolves a group by asking
     * whether each *member* is checked in. Summing the per-member
     * attendanceSummary instead is wrong: every member of a group carries the
     * same merged summary, so a 29-SME meeting with 12 check-ins reported 348.
     */
    const attendanceEvidence = (a?: Appt | null) => {
        if (!a) return { checkedIn: 0, checkedOut: 0, total: 0, hasCoverage: false, has: false }

        const counts = getAttendanceCounts(a)

        const rows: Appt[] = Array.isArray((a as any)?._groupMembers) && (a as any)._groupMembers.length
            ? (a as any)._groupMembers
            : [a]
        const hasCoverage = rows.some(row => Boolean(row.sessionCoverage?.latest))

        return {
            checkedIn: counts.checkedIn,
            checkedOut: counts.checkedOut,
            total: counts.total,
            hasCoverage,
            has: counts.checkedIn > 0 || counts.checkedOut > 0 || hasCoverage
        }
    }

    /**
     * A meeting stops being movable once it has left evidence behind.
     *
     * Moving it rewrites date and time and clears attendanceSession, which would
     * orphan the check-ins recorded against the original slot — the record would
     * then claim people attended a session on a day it never ran. Such a meeting
     * is closed through Meeting Coverage instead.
     */
    const canReschedule = (a?: Appt | null) => {
        if (!a) return false
        if (isCoverageOnly(a)) return false
        return !attendanceEvidence(a).has
    }

    const rescheduleBlockReason = (a?: Appt | null) => {
        if (!a) return ''
        if (isCoverageOnly(a)) {
            return 'This meeting is outside the 48-hour correction window. Close it through Meeting Coverage.'
        }

        const evidence = attendanceEvidence(a)

        if (evidence.checkedIn > 0) {
            const who = evidence.total
                ? `${evidence.checkedIn} of ${evidence.total} attendees`
                : `${evidence.checkedIn} attendee${evidence.checkedIn === 1 ? '' : 's'}`
            return `${who} already checked in against this date and time. Record the outcome through Meeting Coverage rather than moving it.`
        }

        if (evidence.hasCoverage) {
            return 'Coverage has already been recorded for this meeting, so it cannot be moved. Update the coverage record instead.'
        }

        if (evidence.has) {
            return 'This meeting already has attendance recorded against its current date and time. Record the outcome through Meeting Coverage rather than moving it.'
        }

        return ''
    }

    const isMemberCheckedIn = (appt: Appt | null, member: Appt) => {
        if (!appt) return false

        const isGroup =
            (appt as any)?._displayType === 'group' &&
            Array.isArray((appt as any)?._groupMembers)

        if (isGroup) return isGroupMemberCheckedIn(appt, member, participantEmails)

        return getAttendanceCounts(appt).checkedIn > 0
    }

    // In-person and online sessions with a QR check-in already prove the
    // meeting happened and who attended, so the facilitator shouldn't be
    // asked to re-confirm it manually. Telephonic sessions have no QR
    // signal, so they keep the manual held/attendance fields.
    const getCoverageAttendanceMode = (appt: Appt | null): 'qr' | 'manual' => {
        const delivery = String(appt?.deliveryMethod || '').trim().toLowerCase()
        if (delivery.startsWith('telephon')) return 'manual'
        return getAttendanceCounts(appt).checkedIn > 0 ? 'qr' : 'manual'
    }

    const getSmeAttendanceOutcome = (appt: Appt | null): SmeAttendanceOutcome => {
        if (!appt) return 'unverified'

        const latest = appt.sessionCoverage?.latest
        if (latest?.smeAttendance) return latest.smeAttendance
        if (getAttendanceCounts(appt).checkedIn > 0) return 'attended'

        return 'unverified'
    }

    const smeAttendanceLabel = (outcome: SmeAttendanceOutcome) => {
        if (outcome === 'attended') return 'Attended'
        if (outcome === 'partially_attended') return 'Partially attended'
        if (outcome === 'no_show') return 'No-show'
        return 'Unverified'
    }

    const getMemberAttendanceOutcome = (appt: Appt, member: Appt): SmeAttendanceOutcome => {
        const recorded = appt.sessionCoverage?.latest?.attendanceByParticipant?.find(item =>
            String(item.participantId || '') === String(member.participantId || '')
        )?.outcome
        if (recorded) return recorded
        if ((appt as any)?._displayType === 'group') {
            return isGroupMemberCheckedIn(appt, member, participantEmails) ? 'attended' : 'unverified'
        }
        const invitationAttendance = String((member as any)?.attendance?.status || '').toLowerCase()
        if (['attended', 'checked-in', 'checked-out'].includes(invitationAttendance)) return 'attended'
        if (['absent', 'no-show', 'no_show'].includes(invitationAttendance)) return 'no_show'
        return getSmeAttendanceOutcome(appt)
    }

    const memberStatus = (appt: Appt, member: Appt) => appointmentMemberStatus(
        member.userConfirmation,
        getMemberAttendanceOutcome(appt, member),
        typeof appt.sessionCoverage?.latest?.held === 'boolean'
            ? appt.sessionCoverage.latest.held
            : null
    )

    const memberRsvpTag = (appt: Appt, member: Appt, includeOutcome = false) => {
        const status = memberStatus(appt, member)
        return (
            <Space wrap size={4}>
                <Tag color={status.rsvp.color}>{status.rsvp.label}</Tag>
                {includeOutcome && status.attendanceRecorded ? (
                    <Tag color={status.attendance.color}>{status.attendance.label}</Tag>
                ) : null}
            </Space>
        )
    }

    const memberAttendanceTag = (appt: Appt, member: Appt) => {
        const attendance = memberStatus(appt, member).attendance
        return <Tag color={attendance.color}>{attendance.label}</Tag>
    }

    const meetingOutcomeLabel = (appt: Appt | null) => {
        const latest = appt?.sessionCoverage?.latest
        if (!latest) return 'Not recorded'
        return latest.held ? 'Held' : 'Not held'
    }

    const buildAppointmentScopedAssignedQueries = ({
        assignedCol,
        activeProgramId,
        uid,
        email,
        coordinatorDocId
    }: {
        assignedCol: ReturnType<typeof collection>
        activeProgramId: string
        uid: string
        email: string
        coordinatorDocId: string | null
    }) => {
        const querySets: QueryConstraint[][] = []

        const pushSet = (constraints: QueryConstraint[]) => {
            querySets.push([
                ...constraints,
                where('programId', '==', activeProgramId)
            ])
        }

        pushSet([where('assigneeId', '==', uid)])

        if (email) {
            pushSet([where('assigneeEmail', '==', email)])
        }

        if (coordinatorDocId) {
            pushSet([where('assigneeId', '==', coordinatorDocId)])
        }

        return querySets.map(constraints => fsQuery(assignedCol, ...constraints))
    }

    const enrichAppointmentAssignmentDates = async (
        items: Appt[],
        knownAssignments?: Map<string, any>
    ): Promise<Appt[]> => {
        const byId = knownAssignments || new Map<string, any>()
        if (!knownAssignments) {
            const ids = [...new Set(items.map(item => item.assignedInterventionId).filter(Boolean))]
            for (let index = 0; index < ids.length; index += 10) {
                try {
                    const snapshot = await getDocs(fsQuery(
                        collection(db, 'assignedInterventions'),
                        where(documentId(), 'in', ids.slice(index, index + 10))
                    ))
                    snapshot.forEach(item => byId.set(item.id, item.data()))
                } catch (error) {
                    console.warn('Could not read linked assignment dates', error)
                }
            }
        }
        return items.map(item => ({
            ...item,
            assignmentAssignedAt: assignmentDate(byId.get(item.assignedInterventionId || '') || {})
        }))
    }

    const enrichAppointmentsWithBranches = async (items: Appt[]): Promise<Appt[]> => {
        if (!items.length) return items

        try {
            const [programsSnap, branchesSnap] = await Promise.all([
                getDocs(collection(db, 'programs')),
                getDocs(collection(db, 'branches'))
            ])

            const programsById = new Map<string, any>()
            const branchNamesById = new Map<string, string>()

            programsSnap.forEach(programDoc => {
                programsById.set(programDoc.id, programDoc.data() as any)
            })

            branchesSnap.forEach(branchDoc => {
                const data = branchDoc.data() as any
                const name = String(data.name || data.branchName || data.title || '').trim()
                if (name) branchNamesById.set(branchDoc.id, name)
            })

            return items.map(item => {
                const program = item.programId ? programsById.get(item.programId) : null
                const resolvedBranchId = String(
                    item.branchId ||
                    program?.branchId ||
                    program?.assignedBranch?.id ||
                    ''
                ).trim()

                const resolvedBranchName =
                    String(item.branchName || '').trim() ||
                    (resolvedBranchId ? branchNamesById.get(resolvedBranchId) : '') ||
                    String(program?.assignedBranch?.name || '').trim()
                const resolvedProgramName = String(
                    item.programName ||
                    program?.name ||
                    program?.programName ||
                    program?.title ||
                    ''
                ).trim()

                return {
                    ...item,
                    programName: resolvedProgramName || item.programName,
                    branchId: resolvedBranchId || item.branchId,
                    branchName: resolvedBranchName || item.branchName
                }
            })
        } catch (error) {
            console.warn('Failed to enrich appointments with branches', error)
            return items
        }
    }

    const loadAppointments = async (
        resolvedCoordinatorId?: string | null,
        resolvedDepartmentScope?: {
            allowedDeptIds: string[]
            parentView: boolean
        },
        resolvedAssigneeIds?: string[]
    ) => {
        const requestId = ++appointmentsRequestIdRef.current
        if (!user) {
            if (requestId === appointmentsRequestIdRef.current) setAppointments([])
            return
        }

        setAppointmentsLoading(true)
        try {
            if (isOperationsView) {
                const scopedDepartmentIds = resolvedDepartmentScope?.allowedDeptIds ?? allowedDepartmentIds
                const visibleDepartmentIds =
                    selectedDepartmentScope === 'all'
                        ? scopedDepartmentIds
                        : scopedDepartmentIds.includes(selectedDepartmentScope)
                            ? [selectedDepartmentScope]
                            : []

                if (!visibleDepartmentIds.length || (!activeProgramId && !isAllPrograms)) {
                    if (requestId === appointmentsRequestIdRef.current) setAppointments([])
                    return
                }

                const appointmentConstraints: QueryConstraint[] = []

                if (activeProgramId) {
                    appointmentConstraints.push(where('programId', '==', activeProgramId))
                }

                const assignmentConstraints: QueryConstraint[] = []
                if (activeProgramId) assignmentConstraints.push(where('programId', '==', activeProgramId))

                const [appointmentsSnap, assignmentsSnap] = await Promise.all([
                    getDocs(fsQuery(collection(db, 'appointments'), ...appointmentConstraints)),
                    getDocs(fsQuery(collection(db, 'assignedInterventions'), ...assignmentConstraints))
                ])

                const assignmentDepartmentById = new Map<string, string>()
                assignmentsSnap.forEach(assignmentDoc => {
                    const assignment = assignmentDoc.data() as any
                    const departmentId = String(assignment.departmentId || '').trim()
                    if (departmentId) assignmentDepartmentById.set(assignmentDoc.id, departmentId)
                })

                const canonicalRows = await hydrateAppointmentViews(
                    appointmentsSnap.docs.map(d => ({ id: d.id, data: d.data() as any }))
                )
                const visibleDepartmentSet = new Set(visibleDepartmentIds)
                const items = canonicalRows
                    .map(row => {
                        const assignmentDepartmentId = row.assignedInterventionId
                            ? assignmentDepartmentById.get(String(row.assignedInterventionId))
                            : ''
                        const resolvedDepartmentId = String(assignmentDepartmentId || row.departmentId || '').trim()

                        return {
                            ...row,
                            departmentId: resolvedDepartmentId || row.departmentId
                        }
                    })
                    .filter(row => visibleDepartmentSet.has(String(row.departmentId || '').trim()))

                const datedItems = await enrichAppointmentAssignmentDates(
                    items,
                    new Map(assignmentsSnap.docs.map(item => [item.id, item.data()]))
                )
                const enrichedItems = await enrichAppointmentsWithBranches(datedItems)
                if (requestId === appointmentsRequestIdRef.current) setAppointments(enrichedItems)
                return
            }

            const effectiveCoordinatorIds = Array.from(
                new Set(
                    [
                        ...(resolvedAssigneeIds || coordinatorAssigneeIds),
                        resolvedCoordinatorId ?? coordinatorDocId,
                        user.uid,
                        user.id,
                        user.assigneeId,
                        user.coordinatorId,
                        user.coordinatorDocId
                    ]
                        .map(value => String(value || '').trim())
                        .filter(Boolean)
                )
            )
            if (!effectiveCoordinatorIds.length || (!activeProgramId && !isAllPrograms)) {
                if (requestId === appointmentsRequestIdRef.current) setAppointments([])
                return
            }

            const snapshots = await Promise.all(
                effectiveCoordinatorIds.map(id => {
                    const appointmentConstraints: QueryConstraint[] = [
                        where('assigneeId', '==', id)
                    ]
                    if (activeProgramId) {
                        appointmentConstraints.push(where('programId', '==', activeProgramId))
                    }
                    return getDocs(
                        fsQuery(collection(db, 'appointments'), ...appointmentConstraints)
                    )
                })
            )
            const canonicalById = new Map<string, any>()
            snapshots.forEach(snapshot => {
                snapshot.docs.forEach(d => {
                    canonicalById.set(d.id, { id: d.id, data: d.data() as any })
                })
            })
            const items = await hydrateAppointmentViews(Array.from(canonicalById.values())) as Appt[]
            const enrichedItems = await enrichAppointmentsWithBranches(await enrichAppointmentAssignmentDates(items))
            if (requestId === appointmentsRequestIdRef.current) setAppointments(enrichedItems)
        } catch (e) {
            console.error(e)
            message.error('Failed to load appointments.')
        } finally {
            if (requestId === appointmentsRequestIdRef.current) setAppointmentsLoading(false)
        }
    }

    const loadAssignedInterventions = async (
        resolvedCoordinatorId?: string | null,
        resolvedDepartmentScope?: {
            allowedDeptIds: string[]
            parentView: boolean
        }
    ) => {
        const requestId = ++assignedRequestIdRef.current
        if (!user) {
            if (requestId === assignedRequestIdRef.current) setAssignedInterventions([])
            return
        }

        setAssignedLoading(true)
        try {
            const uid = user.uid
            const email = String(user.email || '').trim().toLowerCase()
            const effectiveCoordinatorId = resolvedCoordinatorId ?? coordinatorDocId
            const assignedCol = collection(db, 'assignedInterventions')

            if (isOperationsView) {
                const scopedDepartmentIds = resolvedDepartmentScope?.allowedDeptIds ?? allowedDepartmentIds
                const visibleDepartmentIds =
                    selectedDepartmentScope === 'all'
                        ? scopedDepartmentIds
                        : scopedDepartmentIds.includes(selectedDepartmentScope)
                            ? [selectedDepartmentScope]
                            : []

                if (!activeProgramId || !visibleDepartmentIds.length) {
                    if (requestId === assignedRequestIdRef.current) setAssignedInterventions([])
                    return
                }

                const [assignmentsSnap, applicationsSnap, diagnosticPlansSnap] = await Promise.all([
                    getDocs(fsQuery(assignedCol, where('programId', '==', activeProgramId))),
                    getDocs(fsQuery(collection(db, 'applications'), where('programId', '==', activeProgramId))),
                    getDocs(fsQuery(collection(db, 'diagnosticPlans'), where('programId', '==', activeProgramId)))
                ])

                // Keep the appointments picker aligned with the operations
                // assignment population: the SME must have an accepted
                // application and a Diagnostic Plan in the active programme.
                // The assigned-intervention intersection below also ensures
                // that every selectable SME has something that can actually
                // be scheduled.
                const acceptedParticipantIds = new Set(
                    applicationsSnap.docs
                        .map(applicationDoc => applicationDoc.data() as any)
                        .filter(application => norm(application?.applicationStatus) === 'accepted')
                        .map(application => String(application?.participantId || '').trim())
                        .filter(Boolean)
                )
                const participantIdsWithDiagnosticPlans = new Set(
                    diagnosticPlansSnap.docs
                        .map(planDoc => String((planDoc.data() as any)?.participantId || '').trim())
                        .filter(Boolean)
                )
                const visibleDepartmentSet = new Set(visibleDepartmentIds)
                const rows = assignmentsSnap.docs
                    .map(d => ({ id: d.id, ...(d.data() as any) }))
                    .filter(row => visibleDepartmentSet.has(String(row.departmentId || '').trim()))
                    .filter(row => {
                        const participantId = String(row.participantId || row.beneficiaryId || '').trim()
                        return (
                            acceptedParticipantIds.has(participantId) &&
                            participantIdsWithDiagnosticPlans.has(participantId)
                        )
                    })
                    .filter(isSchedulableAssigned)

                if (requestId === assignedRequestIdRef.current) setAssignedInterventions(rows)
                return
            }

            if (!uid || !activeProgramId) {
                if (requestId === assignedRequestIdRef.current) setAssignedInterventions([])
                return
            }

            const queryRefs = buildAppointmentScopedAssignedQueries({
                assignedCol,
                activeProgramId,
                uid,
                email,
                coordinatorDocId: effectiveCoordinatorId
            })

            const queryResults = await Promise.all(
                queryRefs.map(async qRef => {
                    try {
                        const snap = await getDocs(qRef)
                        return snap.docs.map(d => toAssignedInterventionView(d.id, d.data() as any))
                    } catch (err) {
                        console.warn('assignedInterventions query failed', err)
                        return []
                    }
                })
            )
            const raw = queryResults.flat()

            const byId: Record<string, any> = {}
            raw.forEach(row => {
                byId[row.id] = row
            })

            // Distinct allocation IDs can share a template and cycle. Keep
            // each one, preserving ownership and open lifecycle checks.
            const ownedRows = Object.values(byId)
                .filter(row =>
                    belongsToCurrentUser({
                        row,
                        uid,
                        email,
                        coordinatorDocId: effectiveCoordinatorId
                    })
                )
                .filter(row => resolveAssignmentLifecycle(row as any).isOpen)
            const rows = distinctAppointmentAssignments([
                ...ownedRows.filter(row => !isGroupedIntervention(row)),
                ...dedupeAssignedInterventionViews(ownedRows.filter(isGroupedIntervention))
            ])

            if (requestId === assignedRequestIdRef.current) setAssignedInterventions(rows)
        } catch (e) {
            console.error(e)
            message.error('Failed to load assigned interventions.')
        } finally {
            if (requestId === assignedRequestIdRef.current) setAssignedLoading(false)
        }
    }

    const closeCreateModal = () => {
        setModalOpen(false)
        setCreateStep(0)
        setAppointmentDetailsDraft({})
        setScheduleMode('individual')
        setPickedParticipantId(undefined)
        setPickedGroupKey(undefined)
        form.resetFields()
    }

    const closeEditModal = () => {
        setEditModalOpen(false)
        editForm.resetFields()
    }

    const closePostponeModal = () => {
        setPostponeModalOpen(false)
        setPostponeRecord(null)
        postponeForm.resetFields()
    }

    const closeCoverageModal = () => {
        setCoverageModalOpen(false)
        setCoverageRecord(null)
        setCoverageViewMode('edit')
        setCoverageAttendancePage(1)
        setCoverageTargetMode('single')
        coverageForm.resetFields()
    }

    const closeFoodMenuModal = () => {
        setFoodMenuModalOpen(false)
        setFoodMenuRecord(null)
        setFoodMenuTab('setup')
        foodMenuForm.resetFields()
    }

    const getFoodMenuTargetRows = (source: Appt) => {
        const members = Array.isArray((source as any)?._groupMembers)
            ? ((source as any)._groupMembers as Appt[])
            : [source]

        const targetIds = Array.from(new Set(members.map(row => row.id).filter(Boolean)))
        return appointments.filter(row => targetIds.includes(row.id))
    }

    /**
     * A row only counts as a food selection once an SME has actually picked
     * something.
     *
     * Placeholder rows carrying a default category but no item were being
     * rendered as real choices, and the empty-name fallback labelled them
     * "Selected item" — which reads like a menu item of that name rather than
     * an SME who has not chosen yet.
     */
    const isRealFoodSelection = (selection?: FoodSelection | null) =>
        Boolean(
            String(selection?.itemId || '').trim() ||
            String(selection?.menuItemId || '').trim() ||
            String(selection?.itemName || '').trim()
        )

    const getFoodSelectionsForRecord = (source?: Appt | null): FoodSelection[] => {
        if (!source) return []

        const menuItems = Array.isArray(source.foodMenu) ? source.foodMenu : []
        const candidates: Array<{ selection: FoodSelection; owner: Appt }> = [
            ...(Array.isArray(source.foodSelections)
                ? source.foodSelections.map(selection => ({ selection, owner: source }))
                : []),
            ...(Array.isArray((source as any)?._groupMembers)
                ? ((source as any)._groupMembers as Appt[]).flatMap(member =>
                    Array.isArray(member.foodSelections)
                        ? member.foodSelections.map(selection => ({ selection, owner: member }))
                        : []
                )
                : [])
        ]

        const combined = candidates.flatMap(({ selection, owner }) => {
            if (!isRealFoodSelection(selection)) return []

            const itemId = String(selection.itemId || selection.menuItemId || '').trim()
            const menuItem = menuItems.find(item => item.id === itemId)

            return [{
                ...selection,
                participantId: selection.participantId || owner.participantId,
                participantName: selection.participantName || owner.participantName,
                participantEmail: selection.participantEmail || owner.participantEmail,
                itemId,
                itemName: selection.itemName || menuItem?.name || '',
                category: selection.category || selection.itemCategory || menuItem?.category,
                itemCategory: selection.itemCategory || selection.category || menuItem?.category
            }]
        })
        const seen = new Set<string>()

        return combined.filter(selection => {
            const key = [
                selection.participantId || '',
                selection.itemId || selection.menuItemId || ''
            ].join('|')

            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
    }

    const getFoodSelectionCountForItem = (source: Appt, item: FoodMenuItem) => {
        const itemId = String(item.id || '').trim()
        const itemName = String(item.name || '').trim().toLowerCase()
        const itemCategory = String(item.category || '').trim().toLowerCase()

        return getFoodSelectionsForRecord(source).filter(selection => {
            const selectedItemId = String(selection.itemId || selection.menuItemId || '').trim()
            if (itemId && selectedItemId) return selectedItemId === itemId

            return (
                String(selection.itemName || '').trim().toLowerCase() === itemName &&
                String(selection.category || selection.itemCategory || '').trim().toLowerCase() === itemCategory
            )
        }).reduce((total, selection) => total + (Number(selection.quantity) || 1), 0)
    }

    const canManageFoodMenu = (appt?: Appt | null) => {
        if (!appt) return false
        if (appt.deliveryMethod !== 'in_person') return false
        const status = derivedStatus(appt)
        return !hasEnded(appt) && status !== 'completed' && status !== 'cancelled' && status !== 'awaiting_coverage'
    }

    const canViewFoodMenu = (appt?: Appt | null) => {
        return canManageFoodMenu(appt)
    }

    const openFoodMenu = (appt: Appt) => {
        const canManage = canManageFoodMenu(appt)
        const menu = normalizeFoodMenuItems(appt.foodMenu || [])

        if (!canManage) {
            message.info('Food menu changes are only available before the appointment is completed.')
            return
        }

        setFoodMenuRecord(appt)
        setFoodMenuTab(canManage ? 'setup' : selections.length ? 'selections' : 'setup')
        foodMenuForm.setFieldsValue({
            foodMenuEnabled: appt.foodMenuEnabled === true || menu.length > 0,
            foodMenu: menu.length
                ? menu
                : [
                    {
                        id: makeFoodMenuItemId(),
                        name: '',
                        category: 'meal',
                        description: '',
                        dietaryNote: '',
                        quantityAvailable: null
                    }
                ]
        })
        setFoodMenuModalOpen(true)
    }

    const saveFoodMenu = async (values: any) => {
        if (!foodMenuRecord) return

        const enabled = values.foodMenuEnabled !== false
        const menu = normalizeFoodMenuItems(values.foodMenu)

        if (enabled && !menu.length) {
            message.warning('Add at least one menu item or disable SME food selection.')
            return
        }

        const appointmentSessionId = String((foodMenuRecord as any).appointmentSessionId || '').trim()
        if (!appointmentSessionId) {
            message.warning('This appointment is not linked to a session.')
            return
        }

        setSavingFoodMenu(true)
        try {
            const patch = {
                foodMenu: enabled ? menu : [],
                updatedAt: Timestamp.now()
            }

            await updateDoc(doc(db, 'appointmentSessions', appointmentSessionId), patch)

            setAppointments(prev =>
                prev.map(row =>
                    String((row as any).appointmentSessionId || '') === appointmentSessionId
                        ? {
                            ...row,
                            foodMenuEnabled: patch.foodMenu.length > 0,
                            foodMenu: patch.foodMenu
                        }
                        : row
                )
            )

            if (selectedAppt && String((selectedAppt as any).appointmentSessionId || '') === appointmentSessionId) {
                setSelectedAppt({
                    ...selectedAppt,
                    attendance: { ...(selectedAppt.attendance || {}), checkedOutAt },
                    foodMenuEnabled: patch.foodMenu.length > 0,
                    foodMenu: patch.foodMenu
                })
            }

            message.success(
                'Food menu saved for this session.'
            )
            closeFoodMenuModal()
        } catch (e) {
            console.error(e)
            message.error('Failed to save food menu.')
        } finally {
            setSavingFoodMenu(false)
        }
    }

    const normalizePointList = (value: any): string[] => {
        const values = Array.isArray(value) ? value : [value]
        return Array.from(
            new Set(
                values
                    .map(item => String(item || '').trim())
                    .filter(Boolean)
            )
        )
    }

    const openCoverage = (appt: Appt) => {
        setCoverageRecord(appt)
        setCoverageAttendancePage(1)
        const latest = (appt as any)?.sessionCoverage?.latest as SessionCoverageEntry | undefined
        setCoveragePhotoFiles([])
        coveragePhotoFilesRef.current = []
        setExistingCoveragePhotoUrls(latest?.photos || [])
        const attendanceMode = getCoverageAttendanceMode(appt)
        setCoverageViewMode(latest ? 'summary' : 'edit')
        const heldDefault: MeetingHeld = attendanceMode === 'qr' ? 'yes' : latest?.held === false ? 'no' : 'yes'

        const groupMembers = Array.isArray((appt as any)?._groupMembers)
            ? ((appt as any)._groupMembers as Appt[])
            : []
        const savedAttendanceByParticipant = new Map(
            (latest?.attendanceByParticipant || []).map(item => [item.participantId, item.outcome])
        )
        const participantAttendance = groupMembers.reduce<Record<string, IndividualSmeAttendanceOutcome>>((result, member) => {
            const savedOutcome = savedAttendanceByParticipant.get(member.participantId)
            if (savedOutcome && savedOutcome !== 'unverified') {
                result[member.id] = savedOutcome
            } else if (isGroupMemberCheckedIn(appt, member, participantEmails)) {
                result[member.id] = 'attended'
            } else if (attendanceMode === 'qr') {
                // Group coverage relies entirely on QR check-ins: anyone who
                // didn't scan in is recorded as a no-show automatically.
                result[member.id] = 'no_show'
            }
            return result
        }, {})
        const linkedAssignment = assignedInterventions.find(
            assignment =>
                String(assignment?.id || '') === String(appt.assignedInterventionId || '')
        )
        coverageForm.setFieldsValue({
            held: latest ? (latest.held ? 'yes' : 'no') : heldDefault,
            smeAttendance:
                latest?.smeAttendance && latest.smeAttendance !== 'unverified'
                    ? latest.smeAttendance
                    : attendanceMode === 'qr'
                        ? 'attended'
                        : undefined,
            participantAttendance,
            title: latest?.title || appt.sessionTitle || appt.interventionTitle || '',
            coveredPoints: latest?.coveredPoints || [],
            notHeldReasonCategory: latest?.notHeldReasonCategory || undefined,
            reasonNotHeld: latest?.reasonNotHeld || '',
            notes: latest?.notes || latest?.coveredPoints?.join('; ') || '',
            usePlannedCoverage: false
        })

        if (!latest) coverageForm.setFieldsValue({ held: heldDefault })
        setCoverageModalOpen(true)
    }

    const resolveLinkedAssignments = async (appointmentRows: Appt[]) => {
        const directIds = Array.from(new Set(
            appointmentRows
                .map(row => String(row.assignedInterventionId || '').trim())
                .filter(Boolean)
        ))
        const directSnapshots = directIds.length
            ? await withAppointmentSaveTimeout(
                Promise.all(directIds.map(id => getDoc(doc(db, 'assignedInterventions', id)))),
                'Checking linked interventions'
            )
            : []
        const directAssignmentsById = new Map(
            directSnapshots
                .filter(snapshot => snapshot.exists())
                .map(snapshot => [snapshot.id, { id: snapshot.id, ...(snapshot.data() as any) }])
        )
        const candidatesByParticipant = new Map<string, any[]>()
        const queriedParticipantIds = new Set<string>()

        assignedInterventions.forEach(assignment => {
            const participantId = String(assignment?.participantId || assignment?.beneficiaryId || '').trim()
            if (!participantId) return
            const current = candidatesByParticipant.get(participantId) || []
            current.push(assignment)
            candidatesByParticipant.set(participantId, current)
        })

        const fetchParticipantCandidates = async (participantId: string) => {
            if (queriedParticipantIds.has(participantId)) {
                return candidatesByParticipant.get(participantId) || []
            }

            const snapshot = await withAppointmentSaveTimeout(
                getDocs(fsQuery(
                    collection(db, 'assignedInterventions'),
                    where('participantId', '==', participantId)
                )),
                'Finding the current linked intervention'
            )
            queriedParticipantIds.add(participantId)
            const candidatesById = new Map<string, any>()
                ; (candidatesByParticipant.get(participantId) || []).forEach(candidate => {
                    candidatesById.set(String(candidate.id || ''), candidate)
                })
            snapshot.docs.forEach(item => {
                candidatesById.set(item.id, { id: item.id, ...(item.data() as any) })
            })
            const candidates = Array.from(candidatesById.values())
            candidatesByParticipant.set(participantId, candidates)
            return candidates
        }

        const linkedByAppointmentId = new Map<string, string>()
        const repairedAppointmentIds: string[] = []
        const orphanAppointmentIds: string[] = []

        for (const appointment of appointmentRows) {
            const appointmentId = String(appointment.id || '').trim()
            const directId = String(appointment.assignedInterventionId || '').trim()

            const directAssignment = directAssignmentsById.get(directId)
            if (directAssignment && assignmentCanOwnAppointment(appointment, directAssignment)) {
                linkedByAppointmentId.set(appointmentId, directId)
                continue
            }

            const participantId = String(appointment.participantId || '').trim()
            const interventionId = String(appointment.interventionId || '').trim()
            if (!appointmentId || !participantId || !interventionId) {
                if (appointmentId) orphanAppointmentIds.push(appointmentId)
                continue
            }

            const replacement = unambiguousAppointmentAssignment(
                appointment,
                await fetchParticipantCandidates(participantId)
            )
            const replacementId = String(replacement?.id || '').trim()

            if (!replacementId) {
                orphanAppointmentIds.push(appointmentId)
                continue
            }

            linkedByAppointmentId.set(appointmentId, replacementId)
            repairedAppointmentIds.push(appointmentId)
        }

        return {
            linkedByAppointmentId,
            assignmentIds: Array.from(new Set(linkedByAppointmentId.values())),
            repairedAppointmentIds,
            orphanAppointmentIds
        }
    }

    const saveCoverage = async (_submittedValues: any) => {
        if (!coverageRecord || savingCoverageRef.current) return

        // `true` includes values stored for fields that are not currently
        // rendered because the attendance list is paginated.
        const values = coverageForm.getFieldsValue(true)
        if (!user?.email) {
            message.error('You must be logged in.')
            return
        }

        const held: MeetingHeld = values.held
        const heldBool = held === 'yes'
        const coverageAppointmentRows: Appt[] =
            (coverageRecord as any)?._displayType === 'group' && Array.isArray((coverageRecord as any)._groupMembers)
                ? (coverageRecord as any)._groupMembers
                : [coverageRecord]
        const isGroupCoverage = coverageAppointmentRows.length > 1
        const participantAttendanceValues = (
            coverageForm.getFieldValue('participantAttendance') ||
            values.participantAttendance ||
            {}
        ) as Record<string, IndividualSmeAttendanceOutcome>
        const attendanceByParticipant = isGroupCoverage
            ? coverageAppointmentRows.map(member => ({
                participantId: String(member.participantId || ''),
                participantName: member.participantName || '',
                participantEmail: String(participantEmails[member.participantId] || member.participantEmail || '').trim().toLowerCase(),
                outcome: participantAttendanceValues[member.id]
            }))
            : []
        const groupOutcomes = attendanceByParticipant.map(item => item.outcome).filter(Boolean)
        const smeAttendance: SmeAttendanceOutcome = isGroupCoverage
            ? groupOutcomes.length && groupOutcomes.every(outcome => outcome === 'attended')
                ? 'attended'
                : groupOutcomes.some(outcome => outcome === 'attended')
                    ? 'partially_attended'
                    : groupOutcomes.length && groupOutcomes.every(outcome => outcome === 'no_show')
                        ? 'no_show'
                        : 'unverified'
            : (values.smeAttendance || 'unverified') as SmeAttendanceOutcome
        const smeParticipated = smeAttendance === 'attended' || smeAttendance === 'partially_attended'
        const title = String(values.title || '').trim()
        const notHeldReasonCategory = String(values.notHeldReasonCategory || '').trim()
        const reasonNotHeld = String(values.reasonNotHeld || '').trim()
        const plannedCoverageForReuse = normalizePointList(
            coverageRecord.plannedCoverage || (coverageRecord as any)?.sessionCoverage?.plannedCoverage || []
        ).join(' ').trim()
        const notes = values.usePlannedCoverage === true
            ? plannedCoverageForReuse
            : String(values.notes || '').trim()
        const submittedTopics = normalizePointList(values.coveredPoints)
        // Preserve formal Training Academy module/unit-standard wording.
        // Other departments continue to complete only the summary field.
        const coveredPoints = isTrainingAcademyCoverage ? submittedTopics : notes ? [notes] : []
        if (!held) {
            message.warning('Please indicate if the session was held.')
            return
        }

        if (!title) {
            message.warning('Please add a session title.')
            return
        }

        if (!heldBool) {
            if (!notHeldReasonCategory) {
                message.warning('Please select a reason why the session was not held.')
                return
            }
            if (notHeldReasonCategory === 'rescheduled') {
                message.warning('Use Reschedule to set the replacement date and time. Do not record it as a not-held outcome.')
                return
            }
        } else if (isGroupCoverage) {
            const missingAttendance = coverageAppointmentRows.filter(
                member => !participantAttendanceValues[member.id]
            )

            if (missingAttendance.length) {
                message.warning(
                    `Please record attendance for ${missingAttendance.length} SME${missingAttendance.length === 1 ? '' : 's'
                    }.`
                )
                return
            }
        } else if (!isGroupCoverage && (!values.smeAttendance || values.smeAttendance === 'unverified')) {
            message.warning('Please record the SME attendance outcome.')
            return
        } else if (smeParticipated && isTrainingAcademyCoverage && !coveredPoints.length) {
            message.warning('Please add at least one formal topic or unit standard covered.')
            return
        } else if (values.usePlannedCoverage === true && coverageNoteWordCount(plannedCoverageForReuse) <= 5) {
            message.warning('Planned coverage needs more than 5 words before it can be reused.')
            return
        } else if (!notes || coverageNoteWordCount(notes) < 5) {
            message.warning('Please add a coverage summary of at least 5 words.')
            return
        }

        savingCoverageRef.current = true
        setSavingCoverage(true)
        try {
            const plannedCoverage = normalizePointList(
                coverageRecord.plannedCoverage || (coverageRecord as any)?.sessionCoverage?.plannedCoverage || []
            )

            // Photos are entirely optional - only uploaded if the facilitator
            // chose to attach any, never required.
            const uploadedPhotoUrls = await withAppointmentSaveTimeout(
                uploadCoveragePhotos(storage, coverageRecord.id, coveragePhotoFilesRef.current),
                'Uploading coverage photos'
            )
            const photos = [...new Set([...existingCoveragePhotoUrls, ...uploadedPhotoUrls])]
            const removedPhotoUrls = (coverageRecord.sessionCoverage?.latest?.photos || [])
                .filter(url => !existingCoveragePhotoUrls.includes(url))

            const row = coverageRecord
            const appointmentRows = coverageAppointmentRows
            const linkedAssignments = await resolveLinkedAssignments(appointmentRows)
            const assignmentIds = linkedAssignments.assignmentIds
            if (linkedAssignments.orphanAppointmentIds.length) {
                throw new Error('An appointment has no unique linked assignment. Ask an administrator to link the correct assignment before saving coverage; no assignment has been guessed.')
            }

            // Progress is fully automatic now: held sessions vs. planned
            // sessions, no manually-typed percentage. Pre-compute per
            // assignment so we know up front whether any of them just hit
            // their planned count (drives the completion prompt below).
            const attendedParticipantIdsForPlan = new Set(
                attendanceByParticipant
                    .filter(item => item.outcome === 'attended')
                    .map(item => item.participantId)
            )
            const progressInfoByAssignmentId = new Map<
                string,
                { outcome: IndividualSmeAttendanceOutcome; attendedCount: number; plannedSessions: number; reachedPlan: boolean }
            >()
            assignmentIds.forEach(id => {
                const linkedAppointment = appointmentRows.find(appointmentRow =>
                    linkedAssignments.linkedByAppointmentId.get(appointmentRow.id) === id
                )
                const outcome: IndividualSmeAttendanceOutcome = !heldBool
                    ? 'unverified'
                    : isGroupCoverage
                        ? attendanceByParticipant.find(item =>
                            item.participantId === String(linkedAppointment?.participantId || '')
                        )?.outcome || 'unverified'
                        : smeAttendance === 'attended'
                            ? 'attended'
                            : smeAttendance === 'no_show'
                                ? 'no_show'
                                : 'unverified'
                const sessionAppointmentId = String(linkedAppointment?.id || row.id)
                const assignment = assignedInterventions.find(candidate => String(candidate?.id || '') === id)
                const priorAttendance = ((assignment as any)?.sessionAttendanceByAppointment || {}) as Record<string, { outcome?: string }>
                const attendedCount = Object.entries(priorAttendance)
                    .filter(([apptId, record]) => apptId !== sessionAppointmentId && record?.outcome === 'attended')
                    .length + (outcome === 'attended' ? 1 : 0)
                const plannedSessions = Math.max(1, Number((assignment as any)?.plannedSessions) || 1)
                progressInfoByAssignmentId.set(id, {
                    outcome,
                    attendedCount,
                    plannedSessions,
                    reachedPlan: attendedCount >= plannedSessions
                })
            })
            const isEditingExistingCoverage = Boolean((coverageRecord as any)?.sessionCoverage?.latest)
            const completionRequested =
                heldBool &&
                smeParticipated &&
                !isEditingExistingCoverage &&
                (
                    Array.from(progressInfoByAssignmentId.values()).some(info => info.reachedPlan)
                )

            const entry: SessionCoverageEntry = {
                held: heldBool,
                ...(heldBool ? { smeAttendance } : {}),
                title,
                plannedCoverage,
                coveredPoints: heldBool && smeParticipated ? coveredPoints : [],
                photos,
                ...(heldBool
                    ? {}
                    : { notHeldReasonCategory: notHeldReasonCategory as SessionCoverageEntry['notHeldReasonCategory'] }),
                reasonNotHeld: heldBool ? '' : reasonNotHeld,
                notes: heldBool ? notes : '',
                ...(isGroupCoverage ? { attendanceByParticipant } : {}),
                createdAt: Timestamp.now(),
                createdByEmail: user.email,
                createdByName: user.name || ''
            }

            const appointmentSessionId = String((row as any)?.appointmentSessionId || '').trim()
            if (!appointmentSessionId) throw new Error('This appointment is not linked to a session.')
            const coverageRecordedAt = Timestamp.now()
            const rowPatch: any = heldBool
                ? { status: 'completed', completedAt: coverageRecordedAt, updatedAt: coverageRecordedAt }
                : { updatedAt: coverageRecordedAt }

            const completionGroupKey = assignmentIds
                .map(id => assignedInterventions.find(assignment => String(assignment?.id || '') === id))
                .map(assignment => normalizeAssignmentGroupKey(assignment))
                .find(Boolean) || ''
            if (completionRequested) {
                entry.completionRequired = true
                entry.completionAssignmentIds = assignmentIds
                if (completionGroupKey) entry.completionGroupKey = completionGroupKey
            }
            const attendedParticipantIds = new Set(
                attendanceByParticipant
                    .filter(item => item.outcome === 'attended')
                    .map(item => item.participantId)
            )
            const progressingAssignmentIds = new Set(
                appointmentRows
                    .filter(appointmentRow => !isGroupCoverage || attendedParticipantIds.has(String(appointmentRow.participantId || '')))
                    .map(appointmentRow => linkedAssignments.linkedByAppointmentId.get(appointmentRow.id))
                    .filter(Boolean) as string[]
            )

            if (linkedAssignments.repairedAppointmentIds.length) {
                console.info('[Appointments][Coverage] Repaired stale assignment links', {
                    appointmentId: row.id,
                    repairedAppointmentIds: linkedAssignments.repairedAppointmentIds,
                    assignmentIds
                })
            }
            if (linkedAssignments.orphanAppointmentIds.length) {
                console.warn('[Appointments][Coverage] Group members have no unique current assignment', {
                    appointmentId: row.id,
                    orphanAppointmentIds: linkedAssignments.orphanAppointmentIds
                })
            }

            if (appointmentRows.length + assignmentIds.length > 450) {
                throw new Error('This grouped coverage update is too large to save safely in one operation.')
            }

            const batch = writeBatch(db)
            batch.update(doc(db, 'appointmentSessions', appointmentSessionId), {
                title,
                plannedCoverage,
                coverage: {
                    held: heldBool,
                    outcomeSummary: heldBool ? notes : null,
                    coveredPoints: heldBool ? coveredPoints : [],
                    photos,
                    reasonNotHeld: heldBool ? null : reasonNotHeld || null,
                    recordedAt: coverageRecordedAt,
                    recordedById: user.uid || user.email || null,
                    smeAttendance: isGroupCoverage ? null : smeAttendance,
                    attendanceByParticipant: isGroupCoverage ? attendanceByParticipant : [],
                    completionRequired: completionRequested,
                    completionAssignmentIds: completionRequested ? assignmentIds : [],
                    completionGroupKey: completionRequested ? completionGroupKey || null : null
                },
                status: heldBool ? 'completed' : 'scheduled',
                ...(heldBool ? { completedAt: coverageRecordedAt } : {}),
                updatedAt: coverageRecordedAt
            })
            appointmentRows.forEach(appointmentRow => {
                const repairedAssignmentId = linkedAssignments.linkedByAppointmentId.get(appointmentRow.id)
                const recordedOutcome: IndividualSmeAttendanceOutcome = !heldBool
                    ? 'unverified'
                    : isGroupCoverage
                        ? participantAttendanceValues[appointmentRow.id] || 'unverified'
                        : smeAttendance === 'attended'
                            ? 'attended'
                            : smeAttendance === 'no_show'
                                ? 'no_show'
                                : 'unverified'
                batch.update(doc(db, 'appointments', appointmentRow.id), {
                    ...rowPatch,
                    // Coverage is where the facilitator records the final
                    // attendance outcome. Keep the canonical appointment in
                    // sync so the SME review and session progress agree.
                    attendance: {
                        ...(appointmentRow.attendance || {}),
                        status: recordedOutcome === 'attended'
                            ? 'attended'
                            : recordedOutcome === 'no_show'
                                ? 'absent'
                                : appointmentRow.attendance?.status || 'expected'
                    },
                    ...(repairedAssignmentId && repairedAssignmentId !== appointmentRow.assignedInterventionId
                        ? {
                            assignedInterventionId: repairedAssignmentId,
                            assignmentLinkRepairedAt: Timestamp.now()
                        }
                        : {})
                })
            })

            const wasAlreadyRecordedAsNotHeld =
                (row as any)?.sessionCoverage?.latest?.held === false
            if (!heldBool && !wasAlreadyRecordedAsNotHeld) {
                const reasonLabel = titleCase(notHeldReasonCategory || 'other')
                const department =
                    departmentNameMap[row.departmentId || ''] ||
                    user.departmentName ||
                    ''
            }

            assignmentIds.forEach(id => {
                const linkedAppointment = appointmentRows.find(appointmentRow =>
                    linkedAssignments.linkedByAppointmentId.get(appointmentRow.id) === id
                )
                const info = progressInfoByAssignmentId.get(id)
                const participantOutcome: IndividualSmeAttendanceOutcome = info?.outcome || 'unverified'
                const sessionAppointmentId = String(linkedAppointment?.id || row.id)
                const sessionAttendanceRecord = {
                    appointmentId: sessionAppointmentId,
                    groupAppointmentId: row.id,
                    date: linkedAppointment?.date || row.date,
                    title,
                    outcome: participantOutcome,
                    held: heldBool,
                    coveredPoints: participantOutcome === 'attended' ? coveredPoints : [],
                    notes,
                    recordedAt: entry.createdAt,
                    recordedByEmail: user.email
                }

                // Progress derives automatically from held vs. planned
                // sessions - no manual percentage. Once the planned count is
                // reached, completionRequested routes to the completion flow
                // instead of writing a further progress update here.
                const assignment = assignedInterventions.find(
                    candidate => String(candidate?.id || '') === id
                )
                const existingProgress = Math.max(
                    Number(assignment?.computedProgress || 0),
                    Number(assignment?.progress || 0),
                    Number(assignment?.deliveryWorkProgress || 0),
                    ...((assignment?.progressUpdates || []) as any[]).map(update =>
                        Number(update?.computedProgress || update?.deliveryWorkProgress || 0)
                    )
                )
                const sessionMilestoneProgress = info
                    ? Math.min(100, (info.attendedCount / info.plannedSessions) * 100)
                    : 0
                const isSessionTracked = !assignment?.target?.mode || assignment.target.mode === 'sessions'
                // Attendance is the source of truth for a session-based
                // assignment. Never retain an old 100% after the target has
                // been extended for further delivery.
                const derivedProgress = Math.min(
                    100,
                    isSessionTracked
                        ? sessionMilestoneProgress
                        : Math.max(existingProgress, sessionMilestoneProgress)
                )
                const shouldTrackAttendedSession =
                    heldBool && progressingAssignmentIds.has(id) && derivedProgress > 0
                const progressPatch =
                    shouldTrackAttendedSession
                        ? {
                            'tracking.sessionsLogged': info?.attendedCount ?? 0,
                            progressUpdates: arrayUnion({
                                by: user.uid || user.email,
                                source: 'appointment',
                                appointmentId: row.id,
                                note: notes || coveredPoints.join('; '),
                                createdAt: Timestamp.now(),
                                resources: photos.map((url, index) => ({
                                    type: 'image',
                                    label: `Session photo ${index + 1}`,
                                    link: url
                                })),
                                computedProgress: derivedProgress
                            }),
                            computedProgress: derivedProgress
                        }
                        : {}

                batch.update(doc(db, 'assignedInterventions', id), {
                    // Every coverage outcome belongs to the intervention, even
                    // when the meeting was not held or the SME did not attend.
                    lastSessionCoverage: entry,
                    lastAppointmentId: row.id,
                    lastAppointmentAt: Timestamp.now(),
                    [`sessionAttendanceByAppointment.${sessionAppointmentId}`]: sessionAttendanceRecord,
                    updatedAt: Timestamp.now(),
                    ...progressPatch
                })
            })

            await withAppointmentSaveTimeout(batch.commit(), 'Saving appointment coverage')

            // Check the server record, not the optimistic local preview, before claiming success.
            if (photos.length || removedPhotoUrls.length) {
                const savedSession = await withAppointmentSaveTimeout(
                    getDocFromServer(doc(db, 'appointmentSessions', appointmentSessionId)),
                    'Verifying saved coverage photos'
                )
                assertCoveragePhotosSaved(photos, savedSession.data()?.coverage?.photos, removedPhotoUrls)
            }

            const appointmentIds = new Set(appointmentRows.map(appointmentRow => appointmentRow.id))
            setAppointments(prev =>
                prev.map(a => {
                    if (!appointmentIds.has(a.id)) return a
                    const priorHistory = ((((a as any)?.sessionCoverage?.history as any[]) || []) as SessionCoverageEntry[])
                    const nextPlannedCoverage = normalizePointList(
                        a.plannedCoverage || (a as any)?.sessionCoverage?.plannedCoverage || plannedCoverage
                    )

                    return {
                        ...a,
                        status: heldBool ? 'completed' : a.status,
                        sessionTitle: title,
                        sessionCoverage: {
                            title,
                            plannedCoverage: nextPlannedCoverage,
                            latest: entry,
                            history: [...priorHistory, entry]
                        }
                    }
                })
            )

            setSelectedAppt(prev => {
                if (!prev || !appointmentIds.has(prev.id)) return prev

                return {
                    ...prev,
                    status: heldBool ? 'completed' : prev.status,
                    sessionTitle: title,
                    sessionCoverage: {
                        title,
                        plannedCoverage: normalizePointList(
                            prev.plannedCoverage || prev.sessionCoverage?.plannedCoverage || plannedCoverage
                        ),
                        latest: entry,
                        history: [...((prev.sessionCoverage?.history || []) as SessionCoverageEntry[]), entry]
                    }
                }
            })

            message.success(completionRequested
                ? 'Coverage saved. Complete the intervention workflow to finalise 100% and create the MOV.'
                : heldBool && smeParticipated && progressingAssignmentIds.size
                    ? `Session saved and ${progressingAssignmentIds.size} attended SME intervention progress record(s) updated.`
                    : heldBool && smeParticipated
                        ? 'Session saved. No matching intervention assignment was found to update.'
                        : heldBool
                            ? 'Session outcome saved without changing intervention progress.'
                            : 'Session coverage saved.')
            if (photos.length) message.success(`${photos.length} coverage photo(s) saved and verified.`)
            if (removedPhotoUrls.length) message.success(`${removedPhotoUrls.length} photo(s) removed from coverage.`)
            closeCoverageModal()
            if (completionRequested && assignmentIds.length) {
                const completionInfo = Array.from(progressInfoByAssignmentId.values())
                    .sort((left, right) => right.attendedCount - left.attendedCount)[0]
                setCompletionPrompt({
                    assignmentId: assignmentIds[0],
                    assignmentIds,
                    groupKey: completionGroupKey || undefined,
                    appointmentId: row.id,
                    interventionTitle: row.interventionTitle || title,
                    sessionsCompleted: completionInfo?.attendedCount || 0,
                    plannedSessions: completionInfo?.plannedSessions || 1,
                    deliveryMethod: deriveCompletionDelivery(assignmentIds, row)
                })
            } else if (
                !isGroupCoverage &&
                heldBool &&
                smeAttendance === 'no_show' &&
                assignmentIds.length
            ) {
                Modal.confirm({
                    centered: true,
                    title: 'Schedule a replacement appointment?',
                    content: 'No intervention progress was added because the SME did not attend. You can schedule a replacement now or do it later.',
                    okText: 'Schedule replacement',
                    cancelText: 'Not now',
                    onOk: () => {
                        setScheduleMode('individual')
                        setPickedParticipantId(row.participantId)
                        setCreateStep(0)
                        setAppointmentDetailsDraft({})
                        setModalOpen(true)
                        window.setTimeout(() => {
                            const existingLocation =
                                row.deliveryMethod === 'in_person'
                                    ? String(row.location || '').trim()
                                    : ''

                            form.setFieldsValue({
                                assignedIntervention: assignmentIds[0],
                                sessionTitle:
                                    row.sessionTitle ||
                                    row.interventionTitle ||
                                    title,
                                plannedCoverage:
                                    row.plannedCoverage ||
                                    row.sessionCoverage?.plannedCoverage ||
                                    [],
                                deliveryMethod: row.deliveryMethod,
                                meetingLink:
                                    row.deliveryMethod === 'virtual'
                                        ? row.meetingLink
                                        : undefined,
                                useDifferentLocation:
                                    row.deliveryMethod === 'in_person' &&
                                    isDifferentAppointmentLocation(existingLocation),
                                location:
                                    row.deliveryMethod === 'in_person'
                                        ? existingLocation || 'At Center'
                                        : undefined
                            })
                        }, 0)
                    }
                })
            }
        } catch (e: any) {
            console.error(e)
            message.error(e?.message || 'Failed to save session coverage.')
        } finally {
            savingCoverageRef.current = false
            setSavingCoverage(false)
        }
    }

    const openAppointmentCompletionEvidence = async () => {
        if (!completionPrompt || appointmentCompletionSavingRef.current) return
        appointmentCompletionSavingRef.current = true
        setSavingAppointmentCompletion(true)
        try {
            const context = await loadInterventionCompletionContext(db, completionPrompt.assignmentIds)
            setAppointmentCompletionContext(context)
            setAppointmentCompletionFailureMessage('')
            appointmentCompletionForm.resetFields()
            setAppointmentCompletionStep(1)
        } catch (error) {
            message.error(interventionCompletionError(error))
        } finally {
            appointmentCompletionSavingRef.current = false
            setSavingAppointmentCompletion(false)
        }
    }

    const submitAppointmentCompletion = async (values: any) => {
        if (appointmentCompletionSavingRef.current) return
        if (!completionPrompt || !appointmentCompletionContext) {
            message.error('Reopen completion to load the selected assignments.')
            return
        }
        appointmentCompletionSavingRef.current = true
        setSavingAppointmentCompletion(true)
        try {
            const result = await completeIntervention({
                db, storage,
                user: { uid: user?.uid, name: user?.name, email: user?.email, departmentName: user?.departmentName },
                assignmentIds: appointmentCompletionContext.assignments.map(row => row.id),
                files: values.files, notes: values.notes, recurrencePreset: values.recurrencePreset,
                deliveryMethod: completionPrompt.deliveryMethod
            })
            message.success(COMPLETION_SUCCESS_MESSAGE)
            setAssignedInterventions(previous => previous.map(row => result.assignmentIds.includes(row.id)
                ? { ...row, computedProgress: 100, assigneeCompletionStatus: 'completed' } : row))
            setCompletionPrompt(null)
            setAppointmentCompletionContext(null)
            setAppointmentCompletionFailureMessage('')
            setAppointmentCompletionStep(0)
            appointmentCompletionForm.resetFields()
        } catch (error) {
            console.error('[Appointment intervention completion] Completion failed', error)
            const errorMessage = interventionCompletionError(error)
            setAppointmentCompletionFailureMessage(errorMessage)
            setAppointmentCompletionContext(previous => mergeCompletionFailureContext(previous, error))
            message.error({ content: errorMessage, duration: 8 })
            if (completionFailureEvidence(error).length) {
                void loadInterventionCompletionContext(
                    db,
                    appointmentCompletionContext.assignments.map(row => row.id)
                ).then(setAppointmentCompletionContext).catch(refreshError => {
                    console.error('[Appointment intervention completion] Could not refresh retained evidence', refreshError)
                })
            }
        } finally {
            appointmentCompletionSavingRef.current = false
            setSavingAppointmentCompletion(false)
        }
    }

    const continueAppointmentDelivery = async () => {
        if (!completionPrompt) return

        setSavingAppointmentCompletion(true)
        try {
            const updatedAt = Timestamp.now()
            await Promise.all(
                completionPrompt.assignmentIds.map(assignmentId => {
                    const assignment = assignedInterventions.find(item => String(item?.id || '') === assignmentId)
                    const currentPlannedSessions = Math.max(1, Number(assignment?.plannedSessions) || 1)
                    const currentTargetSessions = Number(assignment?.target?.sessionsEstimate || 0)
                    const nextPlannedSessions = currentPlannedSessions + 1
                    return updateDoc(doc(db, 'assignedInterventions', assignmentId), {
                        // The session target has been reached, but the
                        // facilitator has confirmed more delivery is needed.
                        // Add one further session to the plan so progress
                        // reflects the continuing work instead of staying at
                        // 100% (for example, 1/2 rather than 1/1).
                        assignmentStatus: 'in-progress',
                        plannedSessions: nextPlannedSessions,
                        ...(assignment?.target?.mode === 'sessions'
                            ? {
                                target: {
                                    ...assignment.target,
                                    sessionsEstimate: Math.max(currentTargetSessions, currentPlannedSessions) + 1
                                }
                            }
                            : {}),
                        updatedAt
                    })
                })
            )

            setAssignedInterventions(previous => previous.map(assignment =>
                completionPrompt.assignmentIds.includes(String(assignment?.id || ''))
                    ? {
                        ...assignment,
                        plannedSessions: Math.max(1, Number(assignment?.plannedSessions) || 1) + 1,
                        ...(assignment?.target?.mode === 'sessions'
                            ? {
                                target: {
                                    ...assignment.target,
                                    sessionsEstimate: Math.max(
                                        Number(assignment.target.sessionsEstimate || 0),
                                        Number(assignment.plannedSessions || 1)
                                    ) + 1
                                }
                            }
                            : {}),
                        updatedAt
                    }
                    : assignment
            ))
            setCompletionPrompt(null)
            setAppointmentCompletionStep(0)
            setAppointmentCompletionContext(null)
            setAppointmentCompletionFailureMessage('')
            appointmentCompletionForm.resetFields()
            message.info('Completion deferred. The intervention remains in delivery until it is ready for final evidence.')
        } catch (error) {
            console.error(error)
            message.error('Could not defer completion. Please try again.')
        } finally {
            setSavingAppointmentCompletion(false)
        }
    }

    useEffect(() => {
        const run = async () => {
            if (!user) {
                setAppointments([])
                setAssignedInterventions([])
                setCoordinatorDocId(null)
                setCoordinatorAssigneeIds([])
                return
            }

            try {
                setCoordinatorLoading(true)

                if (isOperationsView) {
                    setCoordinatorDocId(null)
                    setCoordinatorAssigneeIds([])
                    const departmentScope = await resolveDepartmentScope()
                    await Promise.all([
                        loadAppointments(null, departmentScope),
                        loadAssignedInterventions(null, departmentScope)
                    ])
                    return
                }

                // Coordinators do not use the Operations department scope to load
                // appointments, but scheduling still needs the full department
                // hierarchy to determine whether their department inherits the
                // Training Academy topic requirement.
                await resolveDepartmentScope()

                const snap = await getDocs(collection(db, 'coordinators'))
                let coordinatorId: string | null = null
                const identityIds = new Set(
                    [
                        user.uid,
                        user.id,
                        user.assigneeId,
                        user.coordinatorId,
                        user.coordinatorDocId,
                        user.profileId
                    ]
                        .map(value => String(value || '').trim())
                        .filter(Boolean)
                )
                const normalizedEmail = String(user.email || '').trim().toLowerCase()
                const matchedAssigneeIds = new Set<string>()
                const coordinatorDocs = snap.docs.map(docSnap => ({
                    docSnap,
                    data: docSnap.data() as any
                }))
                const linkedIdsFor = (docSnap: (typeof snap.docs)[number], data: any) => {
                    const migratedFrom = String(data?.migratedFrom || '').trim()
                    const migratedSourceId = migratedFrom.includes('/')
                        ? migratedFrom.split('/').filter(Boolean).pop()
                        : migratedFrom

                    return [
                        docSnap.id,
                        data?.id,
                        data?.uid,
                        data?.userId,
                        data?.authUid,
                        data?.assigneeId,
                        data?.coordinatorId,
                        data?.legacyAssigneeId,
                        migratedSourceId
                    ]
                        .map(value => String(value || '').trim())
                        .filter(Boolean)
                }

                let matchedCoordinatorDocs = coordinatorDocs.filter(({ docSnap, data }) => {
                    const linkedIds = linkedIdsFor(docSnap, data)
                    const matchesIdentity = linkedIds.some(id => identityIds.has(id))
                    const matchesEmail =
                        Boolean(normalizedEmail) &&
                        String(data?.email || '').trim().toLowerCase() === normalizedEmail
                    return matchesIdentity || matchesEmail
                })

                matchedCoordinatorDocs.forEach(({ docSnap, data }) => {
                    coordinatorId ||= docSnap.id
                    linkedIdsFor(docSnap, data).forEach(id => matchedAssigneeIds.add(id))
                })

                const resolvedAssigneeIds = Array.from(matchedAssigneeIds)
                setCoordinatorDocId(coordinatorId)
                setCoordinatorAssigneeIds(resolvedAssigneeIds)

                await Promise.all([
                    loadAppointments(coordinatorId, undefined, resolvedAssigneeIds),
                    loadAssignedInterventions(coordinatorId)
                ])
            } catch (e) {
                console.error(e)
                message.error('Failed to load appointments data.')
            } finally {
                setCoordinatorLoading(false)
            }
        }

        run()
    }, [user?.email, user?.uid, user?.departmentId, user?.role, activeProgramId, isAllPrograms, selectedDepartmentScope])


    useEffect(() => {
        let cancelled = false

        const fetchParticipantDirectory = async () => {
            try {
                const ids = Array.from(new Set(appointments.map(a => a.participantId).filter(Boolean))) as string[]
                const emails: Record<string, string> = {}
                const phones: Record<string, string> = {}

                await Promise.all(
                    ids.map(async pid => {
                        try {
                            const pdoc = await getDoc(doc(db, 'participants', pid))
                            const pdata = pdoc.data() as any

                            const phone = String(pdata?.phone || pdata?.contactInfo?.phone || '').trim()
                            if (phone) phones[pid] = phone

                            const resolved = String(
                                pdata?.email ||
                                pdata?.participantEmail ||
                                pdata?.contactEmail ||
                                pdata?.contactInfo?.email ||
                                ''
                            ).trim()

                            if (resolved) emails[pid] = resolved
                        } catch {
                            return null
                        }
                    })
                )

                if (!cancelled) {
                    setParticipantEmails(emails)
                    setParticipantPhones(phones)
                }
            } catch (e) {
                console.error(e)
            }
        }

        if (appointments.length) {
            fetchParticipantDirectory()
        } else {
            setParticipantEmails({})
            setParticipantPhones({})
        }

        return () => {
            cancelled = true
        }
    }, [appointments])

    const participantOptionsFromAssigned = useMemo(() => {
        const m = new Map<string, string>()

        assignedInterventions.forEach(ai => {
            const pid = String(ai?.participantId || ai?.beneficiaryId || '')
            if (!pid) return
            if (isGroupedIntervention(ai)) return

            const name = String(
                ai?.participantName ||
                ai?.beneficiaryName ||
                ai?.participant?.name ||
                pid
            )

            if (!m.has(pid)) m.set(pid, name)
        })

        return Array.from(m.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name))
    }, [assignedInterventions])


    const groupOptions = useMemo(() => {
        const map = new Map<
            string,
            {
                key: string
                title: string
                count: number
                interventionId: string
                cycleKey: string
                cycleLabel: string
                kind: 'grouped_assignment' | 'grouped_by_cycle'
                participantIds: Set<string>
            }
        >()

        assignedInterventions.forEach(ai => {
            if (!isEligibleForGroupScheduling(ai)) return
            if (!isGroupedIntervention(ai)) return

            const key = getSchedulableGroupKey(ai)
            if (!key) return

            const interventionId = getInterventionTemplateId(ai)
            const cycleKey = getCycleStorageKey(ai)
            const cycleLabel = getCycleDisplayLabel(ai)
            const kind = getGroupKind(ai)

            if (!kind) return

            const title = String(
                ai?.groupName ||
                ai?.interventionTitle ||
                ai?.title ||
                interventionId ||
                'Grouped intervention'
            )

            const cur = map.get(key)
            const participantIds = cur?.participantIds || new Set<string>()
            const participantId = String(ai?.participantId || ai?.beneficiaryId || '').trim()
            if (participantId) participantIds.add(participantId)

            map.set(key, {
                key,
                title,
                count: participantIds.size || (cur?.count || 0) + 1,
                interventionId,
                cycleKey,
                cycleLabel,
                kind,
                participantIds
            })
        })

        return Array.from(map.values())
            .filter(item => item.count > 1)
            .sort((a, b) => b.count - a.count)
    }, [assignedInterventions])

    const interventionsForPickedParticipant = useMemo(() => {
        if (!pickedParticipantId) return []

        return distinctAppointmentAssignments(assignedInterventions).filter(ai => {
            const pid = String(ai?.participantId || ai?.beneficiaryId || '')
            return pid === String(pickedParticipantId) && !isGroupedIntervention(ai)
        })
    }, [assignedInterventions, pickedParticipantId])

    const interventionsForPickedGroup = useMemo(() => {
        if (!pickedGroupKey) return []

        return assignedInterventions.filter(ai => {
            if (!isEligibleForGroupScheduling(ai)) return false
            if (!isGroupedIntervention(ai)) return false
            return getSchedulableGroupKey(ai) === pickedGroupKey
        })
    }, [assignedInterventions, pickedGroupKey])

    const selectedScopeInterventions =
        scheduleMode === 'group' ? interventionsForPickedGroup : interventionsForPickedParticipant
    const watchedAssignedIntervention = Form.useWatch('assignedIntervention', form)
    const appointmentPlanningDepartmentId = useMemo(() => {
        const selected = scheduleMode === 'individual'
            ? selectedScopeInterventions.find(item => String(item.id || '') === String(watchedAssignedIntervention || ''))
            : selectedScopeInterventions[0]
        return String(selected?.departmentId || user?.departmentId || '')
    }, [scheduleMode, selectedScopeInterventions, watchedAssignedIntervention, user?.departmentId])
    const usesTrainingTopicsForPlanning = departmentScopeOptions.find(
        option => option.id === appointmentPlanningDepartmentId
    )?.usesTrainingCoverage === true
    const usesTrainingTopicsForEditing = departmentScopeOptions.find(
        option => option.id === String(selectedAppt?.departmentId || user?.departmentId || '')
    )?.usesTrainingCoverage === true

    const selectedGroupMeta = useMemo(() => {
        return getGroupOptionMeta(groupOptions, pickedGroupKey)
    }, [groupOptions, pickedGroupKey])

    const selectedScopeParticipants = useMemo(() => {
        const m = new Map<string, string>()
        selectedScopeInterventions.forEach(ai => {
            const pid = String(ai?.participantId || ai?.beneficiaryId || '')
            if (!pid) return
            const name = String(ai?.participantName || ai?.beneficiaryName || pid)
            if (!m.has(pid)) m.set(pid, name)
        })
        return Array.from(m.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name))
    }, [selectedScopeInterventions])

    const goToCreateFoodMenuStep = async () => {
        if (scheduleMode === 'individual' && !pickedParticipantId) {
            message.warning('Pick an SME first.')
            return
        }

        if (scheduleMode === 'group' && (!pickedGroupKey || !selectedScopeInterventions.length)) {
            message.warning('Pick a group and at least two SMEs first.')
            return
        }

        try {
            await form.validateFields()
            // Step 0 is unmounted while the optional food-menu step is shown.
            // Keep an explicit snapshot instead of depending on Form preserve
            // behaviour across Ant Design versions/build optimisations.
            setAppointmentDetailsDraft(form.getFieldsValue(true))
            setCreateStep(1)
        } catch {
            message.warning('Complete the appointment details before continuing.')
        }
    }

    const handleAddAppointment = async (values: any) => {
        if (loading) return

        const liveFormValues = Object.fromEntries(
            Object.entries(form.getFieldsValue(true) || {}).filter(([, value]) => value !== undefined)
        )
        values = {
            ...appointmentDetailsDraft,
            ...liveFormValues,
            ...values
        }

        if (!user) {
            message.error('You must be logged in to schedule an appointment.')
            return
        }

        if (!isOperationsView && !coordinatorDocId && !canScheduleForAssignedPeople) {
            message.error('No coordinator profile found for this user.')
            return
        }

        if (!activeProgramId) {
            message.error('No active program selected. Please select a program and try again.')
            return
        }

        if (scheduleMode === 'individual' && !pickedParticipantId) {
            message.warning('Pick a participant first.')
            return
        }

        if (scheduleMode === 'group' && !pickedGroupKey) {
            message.warning('Pick a group assignment first.')
            return
        }

        const selectedStart = values.startsAt || values.startTime
        const selectedEnd = values.endsAt || values.endTime
        const selectedDate = values.startsAt || values.date

        if (!selectedDate || !selectedStart || !selectedEnd) {
            message.warning('Appointment date and times were not retained. Please review them and try again.')
            setCreateStep(0)
            return
        }

        const appointmentDate = dayjs(selectedDate)
        const appointmentStartTime = dayjs(selectedStart)
        const appointmentEndTime = dayjs(selectedEnd)
        if (!appointmentDate.isValid() || !appointmentStartTime.isValid() || !appointmentEndTime.isValid()) {
            message.warning('Please select a valid appointment date, start time, and end time.')
            setCreateStep(0)
            return
        }
        const appointmentLocation =
            values.deliveryMethod === 'in_person'
                ? String(values.location || 'At Center').trim() || 'At Center'
                : ''

        values = {
            ...values,
            date: appointmentDate,
            startTime: appointmentStartTime,
            endTime: appointmentEndTime
        }

        setLoading(true)

        try {
            const date = values.date.format('YYYY-MM-DD')
            const startTimeStr = values.startTime.format('HH:mm')

            const startMoment = dayjs(`${date} ${values.startTime.format('HH:mm')}`, 'YYYY-MM-DD HH:mm')
            const endMoment = dayjs(`${date} ${values.endTime.format('HH:mm')}`, 'YYYY-MM-DD HH:mm')

            if (!endMoment.isAfter(startMoment)) {
                message.error('End time must be after start time.')
                return
            }

            const sessionTitle = String(values.sessionTitle || '').trim()
            const plannedTopics = usesTrainingTopicsForPlanning
                ? normalizePointList(values.plannedTopics)
                : []
            const plannedCoverage = normalizePointList(values.plannedCoverage)
            const initialFoodMenu = values.deliveryMethod === 'in_person' && values.foodMenuEnabled
                ? normalizeFoodMenuItems(values.foodMenu)
                : []

            if (!sessionTitle) {
                message.warning('Please add a session title.')
                return
            }

            if (usesTrainingTopicsForPlanning && !plannedTopics.length) {
                message.warning('Please add at least one planned topic.')
                return
            }

            if (!plannedCoverage.length || coverageNoteWordCount(plannedCoverage.join(' ')) <= 5) {
                message.warning('Planned coverage must contain more than 5 words.')
                return
            }

            const newStart = dayjs(`${date} ${startTimeStr}`, 'YYYY-MM-DD HH:mm')

            const clash = appointments.some(a => {
                const existingStart = dayjs(`${a.date} ${formatTime(a.startTime)}`, 'YYYY-MM-DD HH:mm')
                return existingStart.isValid() && existingStart.isSame(newStart)
            })
            if (clash) {
                message.error('You already have an appointment scheduled at this time.')
                return
            }

            const hour = Number(startTimeStr.split(':')[0])
            const minute = Number(startTimeStr.split(':')[1])
            if (hour < 6 || (hour === 18 && minute > 0) || hour > 18) {
                message.error('Appointment time must be between 06:00 and 18:00.')
                return
            }

            if (scheduleMode === 'individual') {
                const intervention = selectedScopeInterventions.find(i => i.id === values.assignedIntervention)
                if (!intervention) {
                    message.error('Selected intervention not found.')
                    return
                }

                if (!assignmentCanOwnAppointment({
                    date: appointmentDate.toDate(),
                    participantId: intervention?.participantId || intervention?.beneficiaryId,
                    interventionId: intervention?.interventionId,
                    programId: activeProgramId,
                    departmentId: intervention?.departmentId,
                    assigneeId: intervention?.assigneeId,
                    cycleKey: getCycleStorageKey(intervention) || null,
                    subInterventionId: intervention?.subInterventionId || null
                }, intervention)) {
                    message.error('The appointment date cannot be earlier than the selected assignment date.')
                    return
                }

                const participantId = String(intervention?.participantId || intervention?.beneficiaryId || '')
                const participantName = String(intervention?.participantName || intervention?.beneficiaryName || '')
                const participantEmail = await resolveParticipantEmail({
                    participantId,
                    participantEmail:
                        intervention?.participantEmail ||
                        intervention?.beneficiaryEmail ||
                        intervention?.email ||
                        ''
                })

                const responsibleRole = norm(intervention?.assigneeRole) === 'operations'
                    ? 'operations'
                    : 'coordinator'
                const responsibleId = String(intervention?.assigneeId || '').trim()
                const responsibleName = String(
                    intervention?.assigneeName ||
                    intervention?.assignedToName ||
                    ''
                ).trim()
                const responsibleEmail = String(intervention?.assigneeEmail || '').trim().toLowerCase()

                if (!responsibleId) {
                    message.error('This intervention has no responsible assignee. Assign it before scheduling an appointment.')
                    return
                }

                const now = Timestamp.now()
                const startAt = Timestamp.fromDate(values.startTime.toDate())
                const endAt = Timestamp.fromDate(values.endTime.toDate())
                const sessionPayload = {
                    schemaVersion: 5,
                    programId: activeProgramId,
                    departmentId: String(intervention?.departmentId || user.departmentId || ''),
                    interventionId: String(intervention?.interventionId || intervention?.id || ''),
                    interventionTitle: String(intervention?.interventionTitle || intervention?.title || ''),
                    cycleKey: getCycleStorageKey(intervention) || null,
                    groupKey: null,
                    sessionType: 'individual',
                    assigneeId: responsibleId,
                    assigneeName: responsibleName,
                    assigneeEmail: responsibleEmail || null,
                    assigneeRole: responsibleRole,
                    title: sessionTitle,
                    startAt,
                    endAt,
                    deliveryMethod: values.deliveryMethod,
                    location: values.deliveryMethod === 'in_person' ? appointmentLocation || null : null,
                    meetingLink: values.deliveryMethod === 'virtual' ? values.meetingLink || null : null,
                    plannedTopics,
                    plannedCoverage,
                    coverage: {
                        held: null,
                        outcomeSummary: null,
                        coveredPoints: [],
                        reasonNotHeld: null,
                        recordedAt: null,
                        recordedById: null
                    },
                    attendanceSession: null,
                    attendanceSummary: { invitedCount: 1, attendedCount: 0, checkedInCount: 0, checkedOutCount: 0 },
                    foodMenu: initialFoodMenu,
                    status: 'scheduled',
                    createdAt: now,
                    updatedAt: now,
                    completedAt: null
                }
                const appointmentPayload = {
                    schemaVersion: 5,
                    programId: activeProgramId,
                    departmentId: sessionPayload.departmentId,
                    assignedInterventionId: String(intervention?.id || ''),
                    smeId: participantId,
                    smeName: participantName,
                    smeEmail: participantEmail || null,
                    interventionId: sessionPayload.interventionId,
                    interventionTitle: sessionPayload.interventionTitle,
                    subInterventionId: intervention?.subInterventionId || null,
                    subInterventionTitle: intervention?.subInterventionTitle || null,
                    cycleKey: sessionPayload.cycleKey,
                    assigneeId: responsibleId,
                    assigneeName: responsibleName,
                    assigneeEmail: responsibleEmail || null,
                    assigneeRole: responsibleRole,
                    groupKey: null,
                    status: 'scheduled',
                    smeConfirmation: 'pending',
                    smeDeclineReason: null,
                    attendance: { status: 'expected', checkedInAt: null, checkedOutAt: null },
                    foodSelections: [],
                    createdAt: now,
                    updatedAt: now,
                    completedAt: null
                }
                await scheduleAppointmentSession({
                    session: sessionPayload as any,
                    invitations: [appointmentPayload as any]
                })
                message.success('Appointment added successfully!')
                closeCreateModal()
                await loadAppointments()
                return
            }

            const groupInterventions = selectedScopeInterventions
            if (!groupInterventions.length) {
                message.error('No interventions found for this group.')
                return
            }

            const assignmentsAfterAppointment = groupInterventions.filter(intervention =>
                !assignmentCanOwnAppointment({
                    date: appointmentDate.toDate(),
                    participantId: intervention?.participantId || intervention?.beneficiaryId,
                    interventionId: intervention?.interventionId,
                    programId: activeProgramId,
                    departmentId: intervention?.departmentId,
                    assigneeId: intervention?.assigneeId,
                    cycleKey: getCycleStorageKey(intervention) || null,
                    subInterventionId: intervention?.subInterventionId || null
                }, intervention)
            )
            if (assignmentsAfterAppointment.length) {
                message.error('The appointment date cannot be earlier than the selected assignment date.')
                return
            }

            const template = groupInterventions[0]

            if (!template) {
                message.error('No valid group intervention found.')
                return
            }

            const assignmentsWithoutResponsiblePeople = groupInterventions.filter(
                intervention => !String(intervention?.assigneeId || '').trim()
            )
            if (assignmentsWithoutResponsiblePeople.length) {
                message.error(
                    `${assignmentsWithoutResponsiblePeople.length} selected intervention(s) have no responsible assignee. Assign them before scheduling this appointment.`
                )
                return
            }

            const resolvedGroupKey = getSchedulableGroupKey(template) || pickedGroupKey
            const resolvedCycleKey = getCycleStorageKey(template)

            if (!resolvedGroupKey) {
                message.error('Could not resolve a valid group key for this appointment.')
                return
            }

            const invitations: any[] = []
            const now = Timestamp.now()
            const startAt = Timestamp.fromDate(values.startTime.toDate())
            const endAt = Timestamp.fromDate(values.endTime.toDate())
            const appointmentGroupKey = buildAppointmentGroupKey({
                groupKey: resolvedGroupKey,
                date,
                startTime: values.startTime.toDate(),
                endTime: values.endTime.toDate(),
                assigneeId: String(template?.assigneeId || '').trim()
            })
            const existingKeySet = new Set(
                appointments.map(a => `${a.participantId}__${a.date}__${formatTime(a.startTime)}`)
            )

            let created = 0
            let skipped = 0

            for (const ai of groupInterventions) {
                const participantId = String(ai?.participantId || ai?.beneficiaryId || '')
                if (!participantId) continue

                const key = `${participantId}__${date}__${startTimeStr}`
                if (existingKeySet.has(key)) {
                    skipped += 1
                    continue
                }

                const participantName = String(ai?.participantName || ai?.beneficiaryName || '')
                const participantEmail = await resolveParticipantEmail({
                    participantId,
                    participantEmail:
                        ai?.participantEmail ||
                        ai?.beneficiaryEmail ||
                        ai?.email ||
                        ''
                })

                const interventionId = String(
                    ai?.interventionId || ai?.id || template?.interventionId || template?.id || ''
                )

                const interventionTitle = String(
                    template?.interventionTitle ||
                    template?.title ||
                    ai?.interventionTitle ||
                    ai?.title ||
                    ''
                )

                const responsibleRole = norm(ai?.assigneeRole) === 'operations'
                    ? 'operations'
                    : 'coordinator'
                const responsibleId = String(ai?.assigneeId || '').trim()
                const responsibleName = String(
                    ai?.assigneeName ||
                    ai?.assignedToName ||
                    ''
                ).trim()
                const responsibleEmail = String(ai?.assigneeEmail || '').trim().toLowerCase()

                const payload = {
                    schemaVersion: 5,
                    programId: activeProgramId,
                    departmentId: String(ai?.departmentId || template?.departmentId || user.departmentId || ''),
                    assignedInterventionId: String(ai?.id || ''),
                    smeId: participantId,
                    smeName: participantName,
                    smeEmail: participantEmail || null,
                    interventionId,
                    interventionTitle,
                    subInterventionId: ai?.subInterventionId || null,
                    subInterventionTitle: ai?.subInterventionTitle || null,
                    cycleKey: resolvedCycleKey || null,
                    assigneeId: responsibleId,
                    assigneeName: responsibleName,
                    assigneeEmail: responsibleEmail || null,
                    assigneeRole: responsibleRole,
                    groupKey: resolvedGroupKey,
                    status: 'scheduled',
                    smeConfirmation: 'pending',
                    smeDeclineReason: null,
                    attendance: { status: 'expected', checkedInAt: null, checkedOutAt: null },
                    foodSelections: [],
                    createdAt: now,
                    updatedAt: now,
                    completedAt: null
                }

                invitations.push(payload)
                existingKeySet.add(key)
                created += 1
            }

            if (created === 0) {
                message.warning(
                    skipped > 0
                        ? `Nothing created (all ${skipped} already had an appointment at that slot).`
                        : 'Nothing created.'
                )
                return
            }

            const sessionPayload = {
                schemaVersion: 5,
                programId: activeProgramId,
                departmentId: String(template?.departmentId || user.departmentId || ''),
                interventionId: String(template?.interventionId || template?.id || ''),
                interventionTitle: String(template?.interventionTitle || template?.title || ''),
                cycleKey: resolvedCycleKey || null,
                groupKey: resolvedGroupKey,
                sessionType: 'group',
                assigneeId: String(template?.assigneeId || ''),
                assigneeName: String(template?.assigneeName || template?.assignedToName || ''),
                assigneeEmail: String(template?.assigneeEmail || '').trim().toLowerCase() || null,
                assigneeRole: norm(template?.assigneeRole) === 'operations' ? 'operations' : 'coordinator',
                title: sessionTitle,
                startAt,
                endAt,
                deliveryMethod: values.deliveryMethod,
                location: values.deliveryMethod === 'in_person' ? appointmentLocation || null : null,
                meetingLink: values.deliveryMethod === 'virtual' ? values.meetingLink || null : null,
                plannedTopics,
                plannedCoverage,
                coverage: { held: null, outcomeSummary: null, coveredPoints: [], reasonNotHeld: null, recordedAt: null, recordedById: null },
                attendanceSession: null,
                attendanceSummary: { invitedCount: created, attendedCount: 0, checkedInCount: 0, checkedOutCount: 0 },
                foodMenu: initialFoodMenu,
                status: 'scheduled',
                createdAt: now,
                updatedAt: now,
                completedAt: null
            }

            await scheduleAppointmentSession({ session: sessionPayload as any, invitations })
            message.success(`Scheduled ${created} appointment(s) for the group.${skipped ? ` Skipped ${skipped}.` : ''}`)
            closeCreateModal()
            await loadAppointments()
        } catch (e) {
            console.error(e)
            message.error(
                e instanceof AppointmentSessionAlreadyExistsError
                    ? 'This appointment already exists. No duplicate was created.'
                    : 'Failed to add appointment(s).'
            )
        } finally {
            setLoading(false)
        }
    }

    const openEdit = (appt: Appt) => {
        if (isCoverageOnly(appt)) {
            message.warning('This meeting is more than 48 hours past its end time. Record coverage as held or not held instead.')
            return
        }
        const existingLocation =
            appt.deliveryMethod === 'in_person'
                ? String(appt.location || '').trim()
                : ''

        setSelectedAppt(appt)

        editForm.setFieldsValue({
            deliveryMethod: appt.deliveryMethod,
            startsAt: tsToDayjs(appt.startTime, appt.date),
            endsAt: tsToDayjs(appt.endTime, appt.date),
            meetingLink: appt.meetingLink || '',
            location:
                appt.deliveryMethod === 'in_person'
                    ? existingLocation || 'At Center'
                    : '',
            useDifferentLocation:
                appt.deliveryMethod === 'in_person' &&
                isDifferentAppointmentLocation(existingLocation),
            sessionTitle:
                appt.sessionTitle ||
                appt.sessionCoverage?.title ||
                appt.interventionTitle ||
                '',
            plannedTopics:
                appt.plannedTopics ||
                appt.sessionCoverage?.plannedTopics ||
                // Training sessions created before this split stored their
                // topics in plannedCoverage. Keep them editable without
                // losing that schedule information.
                normalizePointList(
                    appt.plannedCoverage || appt.sessionCoverage?.plannedCoverage || []
                ),
            plannedCoverage: normalizePointList(
                appt.plannedCoverage || appt.sessionCoverage?.plannedCoverage || []
            ).join(' ')
        })

        setEditModalOpen(true)
    }

    const acceptProposedAppointmentTime = async (appt: Appt, proposal: any) => {
        const proposalId = String(proposal?.id || '').trim()
        if (!proposalId) return

        setRescheduleDecisionLoading(proposalId)
        try {
            await acceptAppointmentRescheduleProposal({
                appointment: appt as any,
                proposal,
                actor: {
                    id: user?.uid || user?.id,
                    name: user?.name || user?.displayName,
                    email: user?.email
                }
            })
            message.success('Proposed time accepted. The SME must confirm the updated appointment.')
            setDetailModalOpen(false)
            setSelectedAppt(null)
            await loadAppointments()
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Failed to accept the proposed time.')
        } finally {
            setRescheduleDecisionLoading(null)
        }
    }

    const handleEditAppointment = async (values: any) => {
        if (!selectedAppt) return
        setEditLoading(true)

        try {
            const selectedStart = values.startsAt || values.startTime
            const selectedEnd = values.endsAt || values.endTime
            const selectedDate = values.startsAt || values.date

            if (!selectedDate || !selectedStart || !selectedEnd) {
                message.warning('Please select a valid appointment date, start time and end time.')
                return
            }

            const nextDate = dayjs(selectedDate).format('YYYY-MM-DD')
            const startParsed = selectedStart
                ? dayjs(selectedStart)
                : parseAppointmentTime(values.startTime, nextDate)
            const endParsed = selectedEnd
                ? dayjs(selectedEnd)
                : parseAppointmentTime(values.endTime, nextDate)

            if (!startParsed?.isValid() || !endParsed?.isValid()) {
                message.warning('Please select a valid appointment date, start time and end time.')
                return
            }

            if (!endParsed.isAfter(startParsed)) {
                message.warning('End time must be after start time.')
                return
            }

            const nextStartTime = startParsed.toDate()
            const nextEndTime = endParsed.toDate()
            const sessionTitle = String(values.sessionTitle || '').trim()
            const plannedTopics = usesTrainingTopicsForEditing
                ? normalizePointList(values.plannedTopics)
                : []
            const plannedCoverage = normalizePointList(values.plannedCoverage)
            const appointmentLocation =
                values.deliveryMethod === 'in_person'
                    ? String(values.location || 'At Center').trim() || 'At Center'
                    : ''
            if (!sessionTitle) {
                message.warning('Please add a session title.')
                return
            }

            if (usesTrainingTopicsForEditing && !plannedTopics.length) {
                message.warning('Please add at least one planned topic.')
                return
            }

            if (!plannedCoverage.length || coverageNoteWordCount(plannedCoverage.join(' ')) <= 5) {
                message.warning('Planned coverage must contain more than 5 words.')
                return
            }

            const scheduleChanged =
                String(selectedAppt.date || '') !== nextDate ||
                formatTime(selectedAppt.startTime, selectedAppt.date) !== formatTime(nextStartTime, nextDate) ||
                formatTime(selectedAppt.endTime, selectedAppt.date) !== formatTime(nextEndTime, nextDate)
            const rescheduleReason = String(values.rescheduleReason || '').trim()

            // The pickers are disabled in this case, but the guard belongs here
            // too — a disabled input is a UI affordance, not an invariant.
            if (scheduleChanged && !canReschedule(selectedAppt)) {
                message.warning(rescheduleBlockReason(selectedAppt))
                return
            }

            if (scheduleChanged && hasStarted(selectedAppt) && !rescheduleReason) {
                message.warning('Give a reason when moving a meeting that has started or ended.')
                return
            }

            const sessionPatch = {
                deliveryMethod: values.deliveryMethod,
                startAt: Timestamp.fromDate(nextStartTime),
                endAt: Timestamp.fromDate(nextEndTime),
                meetingLink: values.deliveryMethod === 'virtual' ? values.meetingLink || null : null,
                location: appointmentLocation || null,
                title: sessionTitle,
                plannedTopics,
                plannedCoverage,
                ...(scheduleChanged
                    ? {
                        status: 'scheduled' as Status,
                        completedAt: null,
                        attendanceSession: null,
                        scheduleHistory: arrayUnion({
                            previousStartAt: selectedAppt.startTime,
                            previousEndAt: selectedAppt.endTime,
                            nextStartAt: Timestamp.fromDate(nextStartTime),
                            nextEndAt: Timestamp.fromDate(nextEndTime),
                            reason: rescheduleReason || 'Schedule updated before the meeting started.',
                            changedAt: Timestamp.now(),
                            changedById: user?.uid || user?.id || null
                        })
                    }
                    : {}),
                updatedAt: Timestamp.now()
            }

            const targetRows = Array.isArray((selectedAppt as any)?._groupMembers)
                ? (selectedAppt as any)._groupMembers
                : [selectedAppt]
            const targetIds = Array.from(new Set(targetRows.map((row: any) => String(row.id)).filter(Boolean))) as string[]

            if (!targetIds.length) {
                message.warning('No appointments found for this edit.')
                return
            }

            if (targetIds.length > 450) {
                throw new Error('This grouped appointment is too large to update safely in one operation.')
            }

            const batch = writeBatch(db)
            batch.update(doc(db, 'appointmentSessions', selectedAppt.appointmentSessionId), sessionPatch as any)
            let reconfirmationCount = 0
            targetRows.forEach((targetRow: Appt) => {
                const materialDetailsChanged =
                    String(targetRow.deliveryMethod || '') !== String(values.deliveryMethod || '') ||
                    String(targetRow.date || '') !== nextDate ||
                    formatTime(targetRow.startTime, targetRow.date) !== formatTime(nextStartTime, nextDate) ||
                    formatTime(targetRow.endTime, targetRow.date) !== formatTime(nextEndTime, nextDate) ||
                    (
                        values.deliveryMethod === 'virtual' &&
                        String(targetRow.meetingLink || '').trim() !==
                        String(values.meetingLink || '').trim()
                    ) ||
                    (
                        values.deliveryMethod === 'in_person' &&
                        String(targetRow.location || '').trim() !== appointmentLocation
                    )
                const currentConfirmation = String(targetRow.userConfirmation || 'pending').toLowerCase()
                const requiresReconfirmation = materialDetailsChanged && currentConfirmation !== 'pending'
                if (requiresReconfirmation) reconfirmationCount += 1

                batch.update(doc(db as any, 'appointments', targetRow.id), {
                    ...(materialDetailsChanged
                        ? { smeConfirmation: 'pending', smeDeclineReason: null, smeRescheduleRequest: null }
                        : {}),
                    updatedAt: Timestamp.now(),
                    ...(materialDetailsChanged && !hasStarted(targetRow)
                        ? {
                            attendance: { status: 'expected', checkedInAt: null, checkedOutAt: null }
                        }
                        : {}),
                } as any)
            })

            await withAppointmentSaveTimeout(batch.commit(), 'Updating appointment details')
            message.success(
                targetIds.length > 1
                    ? `Updated ${targetIds.length} grouped appointments.`
                    : 'Appointment updated.'
            )
            if (reconfirmationCount > 0) {
                message.info(
                    reconfirmationCount > 1
                        ? `${reconfirmationCount} SMEs must confirm the updated meeting details again.`
                        : 'The SME must confirm the updated meeting details again.'
                )
            }
            closeEditModal()
            await loadAppointments()
        } catch (e: any) {
            console.error(e)
            message.error(e?.message || 'Failed to update appointment.')
        } finally {
            setEditLoading(false)
        }
    }

    const cancelAppointment = async (appt: Appt) => {
        if (!user?.email) {
            message.error('You must be logged in.')
            return
        }
        if (isCoverageOnly(appt)) {
            message.warning('This meeting is more than 48 hours past its end time. Record coverage as held or not held instead.')
            return
        }
        try {
            const now = Timestamp.now()
            const correctionReason = hasStarted(appt)
                ? window.prompt('Why is this meeting being cancelled after it started or ended?')?.trim()
                : ''
            if (hasStarted(appt) && !correctionReason) return
            const patch = { status: 'cancelled' as Status, updatedAt: now, completedAt: hasStarted(appt) ? now : null }
            const sessionPatch = hasStarted(appt)
                ? {
                    ...patch,
                    attendanceSession: null,
                    coverage: { held: false, outcomeSummary: null, coveredPoints: [], reasonNotHeld: correctionReason, recordedAt: now, recordedById: user?.uid || user?.id || null }
                }
                : patch

            const isGroupedRow =
                (appt as any)?._displayType === 'group' &&
                Array.isArray((appt as any)?._groupMembers) &&
                (appt as any)._groupMembers.length > 0

            if (isGroupedRow) {
                const members = (appt as any)._groupMembers as Appt[]
                const batch = writeBatch(db)

                members.forEach(member => {
                    batch.update(doc(db, 'appointments', member.id), patch as any)
                })
                batch.update(doc(db, 'appointmentSessions', appt.appointmentSessionId), sessionPatch as any)

                await batch.commit()

                setAppointments(prev =>
                    prev.map(a =>
                        members.some(member => member.id === a.id)
                            ? { ...a, status: 'cancelled' }
                            : a
                    )
                )

                if (selectedAppt && members.some(member => member.id === selectedAppt.id)) {
                    setSelectedAppt({
                        ...selectedAppt,
                        status: 'cancelled'
                    })
                }

                message.success(`Cancelled ${members.length} grouped appointment(s).`)
                return
            }

            const batch = writeBatch(db)
            batch.update(doc(db, 'appointments', appt.id), patch as any)
            batch.update(doc(db, 'appointmentSessions', appt.appointmentSessionId), sessionPatch as any)
            await batch.commit()

            setAppointments(prev =>
                prev.map(a => (a.id === appt.id ? { ...a, status: 'cancelled' } : a))
            )

            if (selectedAppt?.id === appt.id) {
                setSelectedAppt({
                    ...selectedAppt,
                    status: 'cancelled'
                })
            }

            message.success('Appointment cancelled.')
        } catch (e) {
            console.error(e)
            message.error('Failed to cancel appointment.')
        }
    }

    const openPostponeAppointment = (appt: Appt) => {
        if (!user?.email) {
            message.error('You must be logged in.')
            return
        }
        if (hasStarted(appt)) {
            message.warning('This meeting has started. Use Edit/Reschedule or record its outcome through Meeting Coverage.')
            return
        }

        const existingLocation =
            appt.deliveryMethod === 'in_person'
                ? String(appt.location || '').trim()
                : ''

        setPostponeRecord(appt)
        postponeForm.setFieldsValue({
            deliveryMethod: appt.deliveryMethod,
            startsAt: tsToDayjs(appt.startTime, appt.date),
            endsAt: tsToDayjs(appt.endTime, appt.date),
            meetingLink: appt.meetingLink || '',
            location:
                appt.deliveryMethod === 'in_person'
                    ? existingLocation || 'At Center'
                    : '',
            useDifferentLocation:
                appt.deliveryMethod === 'in_person' &&
                isDifferentAppointmentLocation(existingLocation),
            reason: ''
        })
        setPostponeModalOpen(true)
    }

    const handlePostponeAppointment = async (values: any) => {
        const appt = postponeRecord
        if (!appt) return

        if (!user?.email) {
            message.error('You must be logged in.')
            return
        }

        const selectedStart = values.startsAt || values.startTime
        const selectedEnd = values.endsAt || values.endTime
        const selectedDate = values.startsAt || values.date

        if (!selectedDate || !selectedStart || !selectedEnd) {
            message.warning('Select a valid new date, start time and end time.')
            return
        }

        const nextDate = dayjs(selectedDate).format('YYYY-MM-DD')
        const nextStart = selectedStart
            ? dayjs(selectedStart)
            : parseAppointmentTime(values.startTime, nextDate)
        const nextEnd = selectedEnd
            ? dayjs(selectedEnd)
            : parseAppointmentTime(values.endTime, nextDate)

        if (!nextStart?.isValid() || !nextEnd?.isValid()) {
            message.warning('Select a valid new date, start time and end time.')
            return
        }

        if (!nextEnd.isAfter(nextStart)) {
            message.warning('End time must be after start time.')
            return
        }

        const currentStart = dayjs(
            `${appt.date} ${formatTime(appt.startTime, appt.date)}`,
            'YYYY-MM-DD HH:mm',
            true
        )

        if (currentStart.isValid() && !nextStart.isAfter(currentStart)) {
            message.warning('A postponed appointment must move to a later date or time.')
            return
        }

        if (!nextStart.isAfter(dayjs())) {
            message.warning('The new appointment time must be in the future.')
            return
        }

        const nextDeliveryMethod = values.deliveryMethod as Delivery
        if (!nextDeliveryMethod) {
            message.warning('Select the meeting delivery method.')
            return
        }

        const nextLocation =
            nextDeliveryMethod === 'in_person'
                ? String(values.location || 'At Center').trim() || 'At Center'
                : ''

        const nextMeetingLink =
            nextDeliveryMethod === 'virtual'
                ? String(values.meetingLink || '').trim()
                : ''

        if (nextDeliveryMethod === 'virtual' && !nextMeetingLink) {
            message.warning('Please provide a meeting link for the postponed virtual session.')
            return
        }

        const appointmentSessionId = String(
            (appt as any).appointmentSessionId || ''
        ).trim()

        if (!appointmentSessionId) {
            message.warning('This appointment is not linked to a session.')
            return
        }

        const targetRows = Array.isArray((appt as any)?._groupMembers)
            ? ((appt as any)._groupMembers as Appt[])
            : [appt]

        if (!targetRows.length) {
            message.warning('No appointments were found to postpone.')
            return
        }

        if (targetRows.length > 450) {
            message.error('This grouped appointment is too large to postpone safely in one operation.')
            return
        }

        const reason = String(values.reason || '').trim()
        const changedAt = Timestamp.now()
        const nextStartTimestamp = Timestamp.fromDate(nextStart.toDate())
        const nextEndTimestamp = Timestamp.fromDate(nextEnd.toDate())

        setPostponeLoading(true)
        try {
            const batch = writeBatch(db)

            batch.update(doc(db, 'appointmentSessions', appointmentSessionId), {
                deliveryMethod: nextDeliveryMethod,
                startAt: nextStartTimestamp,
                endAt: nextEndTimestamp,
                meetingLink:
                    nextDeliveryMethod === 'virtual'
                        ? nextMeetingLink || null
                        : null,
                location:
                    nextDeliveryMethod === 'in_person'
                        ? nextLocation || null
                        : null,

                // Postpone is a schedule move, not a terminal appointment state.
                status: 'scheduled',
                completedAt: null,
                attendanceSession: null,

                scheduleHistory: arrayUnion({
                    action: 'postponed',
                    previousStartAt: appt.startTime,
                    previousEndAt: appt.endTime,
                    nextStartAt: nextStartTimestamp,
                    nextEndAt: nextEndTimestamp,
                    previousDeliveryMethod: appt.deliveryMethod,
                    nextDeliveryMethod,
                    previousMeetingLink: appt.meetingLink || null,
                    nextMeetingLink:
                        nextDeliveryMethod === 'virtual'
                            ? nextMeetingLink || null
                            : null,
                    previousLocation: appt.location || null,
                    nextLocation:
                        nextDeliveryMethod === 'in_person'
                            ? nextLocation || null
                            : null,
                    reason: reason || null,
                    changedAt,
                    changedById: user?.uid || user?.id || null,
                    changedByName: user?.name || '',
                    changedByEmail: user?.email || ''
                }),

                lastScheduleAction: 'postponed',
                lastPostponedAt: changedAt,
                lastPostponedById: user?.uid || user?.id || null,
                lastPostponeReason: reason || null,
                updatedAt: changedAt
            } as any)

            targetRows.forEach(targetRow => {
                batch.update(doc(db, 'appointments', targetRow.id), {
                    status: 'scheduled',
                    smeConfirmation: 'pending',
                    smeDeclineReason: null,
                    smeRescheduleRequest: null,
                    attendance: {
                        status: 'expected',
                        checkedInAt: null,
                        checkedOutAt: null
                    },
                    lastScheduleAction: 'postponed',
                    lastPostponedAt: changedAt,
                    lastPostponedById: user?.uid || user?.id || null,
                    lastPostponeReason: reason || null,
                    updatedAt: changedAt
                } as any)
            })

            await withAppointmentSaveTimeout(
                batch.commit(),
                'Postponing appointment'
            )

            const targetIds = new Set(targetRows.map(row => row.id))

            setAppointments(previous =>
                previous.map(row =>
                    targetIds.has(row.id)
                        ? {
                            ...row,
                            date: nextDate,
                            startTime: nextStart.toDate(),
                            endTime: nextEnd.toDate(),
                            deliveryMethod: nextDeliveryMethod,
                            meetingLink:
                                nextDeliveryMethod === 'virtual'
                                    ? nextMeetingLink
                                    : undefined,
                            location:
                                nextDeliveryMethod === 'in_person'
                                    ? nextLocation
                                    : undefined,
                            status: 'scheduled',
                            userConfirmation: 'pending',
                            smeRescheduleRequest: null
                        }
                        : row
                )
            )

            if (selectedAppt && targetIds.has(selectedAppt.id)) {
                setSelectedAppt({
                    ...selectedAppt,
                    date: nextDate,
                    startTime: nextStart.toDate(),
                    endTime: nextEnd.toDate(),
                    deliveryMethod: nextDeliveryMethod,
                    meetingLink:
                        nextDeliveryMethod === 'virtual'
                            ? nextMeetingLink
                            : undefined,
                    location:
                        nextDeliveryMethod === 'in_person'
                            ? nextLocation
                            : undefined,
                    status: 'scheduled',
                    userConfirmation: 'pending',
                    smeRescheduleRequest: null
                })
            }

            message.success(
                `${targetRows.length > 1 ? 'Grouped appointment' : 'Appointment'} moved to ${nextStart.format('DD MMM YYYY, HH:mm')}–${nextEnd.format('HH:mm')}. The SME${targetRows.length > 1 ? 's' : ''} must confirm the new time.`
            )

            closePostponeModal()
            await loadAppointments()
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Failed to postpone appointment.')
        } finally {
            setPostponeLoading(false)
        }
    }

    const filteredAppointments = useMemo(() => {
        return appointments.filter(a => {
            if (filterDelivery && a.deliveryMethod !== filterDelivery) return false
            if (filterParticipant && a.participantId !== filterParticipant) return false

            if (filterDateRange) {
                const d = dayjs(a.date, 'YYYY-MM-DD')
                if (!d.isBetween(filterDateRange[0], filterDateRange[1], 'day', '[]')) return false
            }

            const s = derivedStatus(a)
            if (filterStatus === 'all') return true
            return filterStatus === s
        })
    }, [appointments, filterDelivery, filterParticipant, filterDateRange, filterStatus, clockNow])



    const sortedAppointments = useMemo(() => {
        return [...filteredAppointments].sort((a, b) => {
            const da = dayjs(`${a.date} ${formatTime(a.startTime)}`, 'YYYY-MM-DD HH:mm')
            const dbb = dayjs(`${b.date} ${formatTime(b.startTime)}`, 'YYYY-MM-DD HH:mm')
            if (!da.isValid() && !dbb.isValid()) return String(a.id).localeCompare(String(b.id))
            if (!da.isValid()) return 1
            if (!dbb.isValid()) return -1

            return dbb.valueOf() - da.valueOf() || String(a.id).localeCompare(String(b.id))
        })
    }, [filteredAppointments])

    const groupedDisplayAppointments = useMemo(() => {
        const map = new Map<string, any>()

        sortedAppointments.forEach(appt => {
            const appointmentGroupKey = getAppointmentGroupKey(appt as any)
            const isGroup = Boolean(appt.isGroupAppointment && appointmentGroupKey)

            if (!isGroup) {
                map.set(`single-${appt.id}`, {
                    ...appt,
                    _displayType: 'single'
                })
                return
            }

            const storedCycleKey = String((appt as any).cycleKey || '').trim()
            const dateCycleKey = dayjs(appt.date, 'YYYY-MM-DD', true).isValid()
                ? dayjs(appt.date, 'YYYY-MM-DD').format('YYYY-MM')
                : ''
            const displayCycleKey = formatCycleLabel(storedCycleKey) ? storedCycleKey : dateCycleKey
            const displayGroupKey = [
                'synthetic',
                String(appt.assigneeId || 'no-assignee'),
                String(appt.programId || 'no-program'),
                String(appt.departmentId || 'no-department'),
                String(appt.interventionId || appt.groupTemplateId || 'unknown-intervention'),
                displayCycleKey || String(appt.groupKey || 'single-cycle')
            ].join('__')
            const key = `group-${appointmentGroupKey}`

            if (!map.has(key)) {
                map.set(key, {
                    ...appt,
                    _displayType: 'group',
                    _groupMembers: [appt],
                    _groupKind: (appt as any).syntheticGroup ? 'grouped_by_cycle' : 'grouped_assignment',
                    _cycleKey: displayCycleKey || (appt as any).cycleKey || '',
                    participantName: `${appt.groupParticipantCount || 1} Participants`,
                    participantId: displayGroupKey || appt.groupKey || appt.participantId,
                    participantEmail: '',
                    attendanceSummary: {
                        count: 0,
                        checkedInEmails: []
                    }
                })
            } else {
                const existing = map.get(key)
                existing._groupMembers.push(appt)
            }
        })

        return Array.from(map.values()).map(row => {
            if (row._displayType !== 'group') return row

            const memberBySmeId = new Map<string, Appt>()
                ; ((row._groupMembers || []) as Appt[]).forEach(member => {
                    const key = String(member.participantId || member.id || '').trim()
                    if (!key) return
                    const existing = memberBySmeId.get(key)
                    // One SME may only have one invitation in one session. Where
                    // old data has duplicate documents, retain the record with a
                    // meaningful SME response rather than counting the SME twice.
                    const existingIsConfirmed = String(existing?.userConfirmation || '').toLowerCase() === 'confirmed'
                    const memberIsConfirmed = String(member.userConfirmation || '').toLowerCase() === 'confirmed'
                    if (!existing || (!existingIsConfirmed && memberIsConfirmed)) {
                        memberBySmeId.set(key, member)
                    }
                })
            const members = Array.from(memberBySmeId.values())
                .sort((a, b) => String(a.participantName || '').localeCompare(String(b.participantName || '')))

            const allEmails = members
                .map((m: Appt) => m.participantEmail)
                .filter(Boolean)

            const checkedIn = members
                .filter((m: Appt) =>
                    ['attended', 'checked-in', 'checked-out'].includes(String((m as any)?.attendance?.status || ''))
                )
                .map((m: Appt) => m.participantEmail || m.participantId)
                .filter(Boolean)
            const checkedOut = members
                .filter((m: Appt) => Boolean((m as any)?.attendance?.checkedOutAt))
                .map((m: Appt) => m.participantEmail || m.participantId)
                .filter(Boolean)

            const sessionOwner =
                members.find((m: Appt) => m.attendanceSession?.qrUrl) ||
                members[0]

            const anyCancelled = members.some((m: Appt) => m.status === 'cancelled' || m.status === 'postponed')
            const anyCompleted = members.some((m: Appt) => m.status === 'completed')
            const anyInProgress = members.some((m: Appt) => {
                if (m.status === 'in_progress') return true
                if (isQrSessionActive(m)) return true
                if (hasStarted(m) && !hasEnded(m) && m.status !== 'completed' && m.status !== 'cancelled' && m.status !== 'postponed') return true
                return false
            })

            let aggregateStatus: Status = 'scheduled'

            if (anyInProgress) {
                aggregateStatus = 'in_progress'
            } else if (
                members.every(
                    (m: Appt) => m.status === 'completed' || m.status === 'cancelled' || m.status === 'postponed'
                ) &&
                members.some((m: Appt) => m.status === 'completed')
            ) {
                aggregateStatus = 'completed'
            } else if (
                members.every((m: Appt) => m.status === 'cancelled' || m.status === 'postponed')
            ) {
                aggregateStatus = 'cancelled'
            }
            return {
                ...row,
                id: sessionOwner.id,
                status: aggregateStatus,
                participantName: `${new Set(members.map((m: Appt) => m.participantId).filter(Boolean)).size || members.length} Participants`,
                _groupMembers: members,
                attendanceSummary: {
                    count: new Set(checkedIn).size,
                    checkedOutCount: new Set(checkedOut).size,
                    currentlyPresentCount: Math.max(new Set(checkedIn).size - new Set(checkedOut).size, 0),
                    checkedInEmails: Array.from(new Set(checkedIn)),
                    checkedOutEmails: Array.from(new Set(checkedOut))
                },
                _groupEmails: allEmails,
                _groupParticipantNames: members.map((m: Appt) => m.participantName),
                attendanceSession: sessionOwner.attendanceSession,
                attendanceSessionGroupEmails:
                    sessionOwner.attendanceSessionGroupEmails || Array.from(new Set(allEmails)),
                attendanceSessionGroupNames:
                    sessionOwner.attendanceSessionGroupNames ||
                    members.map((m: Appt) => m.participantName)
            }
        })
    }, [sortedAppointments, clockNow])

    useEffect(() => {
        const checkoutId = String(searchParams.get('checkout') || '').trim()
        const appointmentId = checkoutId || String(searchParams.get('coverage') || '').trim()
        const requestKey = `${checkoutId ? 'checkout' : 'coverage'}:${appointmentId}`
        if (!appointmentId) {
            coverageQueryHandledRef.current = ''
            return
        }
        if (coverageQueryHandledRef.current === requestKey) return
        if (appointmentsLoading || assignedLoading || coordinatorLoading) return

        const target = groupedDisplayAppointments.find(appointment => {
            if (String(appointment.id || '') === appointmentId) return true
            const members = Array.isArray((appointment as any)._groupMembers)
                ? (appointment as any)._groupMembers as Appt[]
                : []
            return members.some(member => String(member.id || '') === appointmentId)
        })
        if (!target) return

        coverageQueryHandledRef.current = requestKey
        if (checkoutId) {
            setSelectedAppt(target as Appt)
            setDetailModalTab('members')
            setDetailModalOpen(true)
        } else {
            openCoverage(target as Appt)
        }
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete('coverage')
        nextParams.delete('checkout')
        setSearchParams(nextParams, { replace: true })
    }, [
        appointmentsLoading,
        assignedLoading,
        coordinatorLoading,
        groupedDisplayAppointments,
        searchParams,
        setSearchParams
    ])


    const now = clockNow

    const totalAppointments = groupedDisplayAppointments.length

    const upcomingAppointments = groupedDisplayAppointments.filter(a => {
        const start = dayjs(`${a.date} ${formatTime(a.startTime)}`, 'YYYY-MM-DD HH:mm')
        return derivedStatus(a) === 'scheduled' && start.isAfter(now)
    }).length

    const completedAppointments = groupedDisplayAppointments.filter(
        a => derivedStatus(a) === 'completed'
    ).length

    const uniqueParticipants = new Set(appointments.map(a => a.participantId)).size
    const appointmentMetrics: DashboardMetric[] = [
        {
            key: 'total-sessions',
            title: 'Total Sessions',
            value: totalAppointments,
            icon: <CalendarOutlined style={{ color: '#1677ff', fontSize: 18 }} />,
            iconBg: 'rgba(22,119,255,0.12)',
            important: true,
            hideSubtitleOnMobile: true
        },
        {
            key: 'upcoming-sessions',
            title: 'Upcoming Sessions',
            value: upcomingAppointments,
            icon: <ClockCircleOutlined style={{ color: '#faad14', fontSize: 18 }} />,
            iconBg: 'rgba(250,173,20,0.14)',
            hideSubtitleOnMobile: true
        },
        {
            key: 'completed-sessions',
            title: 'Completed Sessions',
            value: completedAppointments,
            icon: <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />,
            iconBg: 'rgba(82,196,26,0.12)',
            important: true,
            hideSubtitleOnMobile: true
        },
        {
            key: 'unique-smes',
            title: 'Unique SMEs',
            value: uniqueParticipants,
            icon: <TeamOutlined style={{ color: '#722ed1', fontSize: 18 }} />,
            iconBg: 'rgba(114,46,209,0.12)',
            hideSubtitleOnMobile: true
        }
    ]
    const participantOptions = useMemo(() => {
        const m = new Map<string, string>()
        appointments.forEach(a => {
            if (a.participantId && !m.has(a.participantId)) m.set(a.participantId, a.participantName || a.participantId)
        })
        return Array.from(m.entries()).map(([id, name]) => ({ id, name }))
    }, [appointments])

    const getDisplayRowMembers = (appt: Appt): Appt[] => {
        const members = (appt as any)?._groupMembers
        return Array.isArray(members) && members.length ? members : [appt]
    }



    const canCancel = (r: Appt) =>
        !isCoverageOnly(r) && !['completed', 'cancelled', 'postponed'].includes(derivedStatus(r))

    const canPostpone = (r: Appt) => {
        return derivedStatus(r) === 'scheduled' && !hasStarted(r)
    }

    const columns = useMemo(() => {
        const baseColumns: any[] = [
            {
                title: 'Intervention & SME',
                key: 'interventionAndSme',
                width: 240,
                render: (_: any, r: any) => (
                    <Space direction="vertical" size={4} style={{ lineHeight: 1.2, maxWidth: 220 }}>
                        <Text strong ellipsis={{ tooltip: r.interventionTitle }} style={{ display: 'block', maxWidth: 220 }}>
                            {r.interventionTitle}
                        </Text>
                        <Text type="secondary" ellipsis={{ tooltip: r.participantName }} style={{ display: 'block', maxWidth: 220 }}>
                            {r._displayType === 'group' ? <TeamOutlined style={{ marginRight: 6 }} /> : <UserOutlined style={{ marginRight: 6 }} />}
                            {r.participantName}
                        </Text>
                        {r._displayType !== 'group' ? (
                            <Text type="secondary" title={`Assignment: ${r.assignedInterventionId || 'Not linked'}`}>
                                Assigned: {assignmentDateLabel({ assignedAt: r.assignmentAssignedAt })}
                            </Text>
                        ) : null}
                        {r._displayType === 'group' ? (
                            <Space wrap size={6}>
                                <Tag color={(r as any)._groupKind === 'grouped_assignment' ? 'purple' : 'cyan'}>
                                    {(r as any)._groupKind === 'grouped_assignment'
                                        ? 'Grouped Assignment'
                                        : 'Grouped by Cycle'}
                                </Tag>

                                {(r as any)._cycleKey && formatCycleLabel((r as any)._cycleKey) ? (
                                    <Tag color="geekblue">
                                        {formatCycleLabel((r as any)._cycleKey)}
                                    </Tag>
                                ) : null}
                            </Space>
                        ) : null}
                    </Space>
                )
            }
        ]

        if (isAllPrograms) {
            baseColumns.push({
                title: 'Program',
                key: 'program',
                width: 190,
                ellipsis: true,
                render: (_: any, r: Appt) => (
                    <Text ellipsis={{ tooltip: r.programName || r.programId }} style={{ display: 'block', maxWidth: 170 }}>
                        {r.programName || r.programId || '—'}
                    </Text>
                )
            })
        }

        if (isOperationsView && isParentDepartmentView) {
            baseColumns.push({
                title: 'Department',
                key: 'department',
                render: (_: any, r: Appt) => (
                    <Tag color='purple'>
                        {departmentNameMap[r.departmentId || ''] || '—'}
                    </Tag>
                )
            })
        }

        baseColumns.push(
            {
                title: 'Date & Time',
                key: 'date',
                width: 165,
                render: (_: any, r: Appt) => (
                    <Space direction="vertical" size={4} style={{ lineHeight: 1.2 }}>
                        <Text strong><CalendarOutlined style={{ marginRight: 6, color: '#1677ff' }} />{dayjs(r.date).format('DD MMM YYYY')}</Text>
                        <Text type="secondary"><ClockCircleOutlined style={{ marginRight: 6 }} />{`${formatTime(r.startTime)} – ${formatTime(r.endTime)}`}</Text>
                    </Space>
                )
            },
            {
                title: 'Time',
                key: 'time',
                hidden: true,
                render: (_: any, r: Appt) => (
                    <Space>
                        <ClockCircleOutlined /> {`${formatTime(r.startTime)} — ${formatTime(r.endTime)}`}
                    </Space>
                )
            },
            {
                title: 'Status',
                key: 'status',
                render: (_: any, r: Appt) => {
                    const s = displayStatus(r)
                    return <Tag color={s.color} icon={s.icon}>{s.label}</Tag>
                }
            },
            {
                title: 'Delivery',
                dataIndex: 'deliveryMethod',
                key: 'delivery',
                render: (v: Delivery) => {
                    const meta = DELIVERY_METHODS.find(m => m.value === v)
                    return <Tag icon={meta?.icon}>{meta?.label}</Tag>
                }
            },
            {
                title: 'Appointment RSVP',
                dataIndex: 'userConfirmation',
                key: 'userConfirmation',
                render: (s: UserConfirmation, r: Appt) => {
                    const members = Array.isArray((r as any)?._groupMembers)
                        ? ((r as any)._groupMembers as Appt[])
                        : []

                    if ((r as any)?._displayType === 'group' && members.length) {
                        const confirmed = members.filter(member =>
                            String(member.userConfirmation || '').toLowerCase() === 'confirmed'
                        ).length

                        return (
                            <Text strong title={`${confirmed} of ${members.length} SMEs confirmed`}>
                                {confirmed}/{members.length}
                            </Text>
                        )
                    }

                    return memberRsvpTag(r, r, true)
                }
            },
            {
                title: 'Details',
                key: 'details',
                render: (_: any, r: Appt) => {
                    if (r.deliveryMethod === 'virtual' && r.meetingLink) {
                        if (isApptDone(r)) {
                            const latest = r.sessionCoverage?.latest
                            return (
                                <Tag color={latest?.held ? 'green' : latest?.held === false ? 'red' : 'default'}>
                                    {latest?.held ? 'Session completed' : latest?.held === false ? 'Session not held' : 'Meeting ended'}
                                </Tag>
                            )
                        }
                        return (
                            <a href={r.meetingLink} target='_blank' rel='noreferrer'>
                                <LinkOutlined /> Join link
                            </a>
                        )
                    }
                    if (r.deliveryMethod === 'in_person' && r.location) {
                        return (
                            <span>
                                <EnvironmentOutlined /> {r.location}
                            </span>
                        )
                    }
                    if (r.deliveryMethod === 'telephonically') {
                        const phone = participantPhones[r.participantId]
                        return phone ? (
                            <span>
                                <PhoneFilled /> {phone}
                            </span>
                        ) : (
                            <Text type='secondary'>No phone on file</Text>
                        )
                    }
                    return <Text type='secondary'>—</Text>
                }
            },
            {
                title: 'Actions',
                key: 'actions',
                width: 150,
                render: (_: any, r: Appt) => (
                    <Space wrap>
                        <Button
                            size='small'
                            shape='round'
                            color='geekblue'
                            variant='filled'
                            style={{ border: '1px solid dodgerblue' }}
                            icon={<EyeOutlined />}
                            onClick={() => openAppointmentDetails(r)}
                        >
                            View
                        </Button>

                        {!isCoverageOnly(r) && derivedStatus(r) !== 'completed' && derivedStatus(r) !== 'cancelled' && derivedStatus(r) !== 'postponed' && (
                            <Button
                                data-guide="appointment-edit-action"
                                size='small'
                                shape='round'
                                color='orange'
                                variant='filled'
                                icon={<EditOutlined />}
                                onClick={() => openEdit(r)}
                            >
                                {hasStarted(r) && canReschedule(r) ? 'Reschedule' : 'Edit'}
                            </Button>
                        )}

                        {canViewFoodMenu(r) && (
                            <Button
                                size='small'
                                shape='round'
                                icon={<BookOutlined />}
                                onClick={() => openFoodMenu(r)}
                            >
                                Food Menu
                            </Button>
                        )}


                        {canPostpone(r) && (
                            <Button
                                data-guide="appointment-postpone-action"
                                size='small'
                                shape='round'
                                icon={<ClockCircleOutlined />}
                                onClick={() => openPostponeAppointment(r)}
                            >
                                Postpone
                            </Button>
                        )}

                        {canCancel(r) && (
                            <Popconfirm
                                title='Cancel this appointment?'
                                description='This will hide it from the default view.'
                                okText='Cancel appointment'
                                cancelText='Keep'
                                onConfirm={() => cancelAppointment(r)}
                            >
                                <Button size='small' danger>
                                    Cancel
                                </Button>
                            </Popconfirm>
                        )}

                        {supportsQrAttendance(r) &&
                            canStartQrWindow(r) &&
                            derivedStatus(r) !== 'completed' &&
                            derivedStatus(r) !== 'cancelled' &&
                            derivedStatus(r) !== 'postponed' &&
                            derivedStatus(r) !== 'awaiting_coverage' &&
                            !isQrSessionActive(r) && (
                                <Button
                                    size='small'
                                    shape='round'
                                    color='cyan'
                                    variant='filled'
                                    style={{ border: '1px solid #13c2c2' }}
                                    icon={<QrcodeOutlined />}
                                    loading={qrLoading}
                                    onClick={() => startQrSession(r)}
                                >
                                    Start QR
                                </Button>
                            )}

                        {supportsQrAttendance(r) && isQrSessionActive(r) && (
                            <Button
                                size='small'
                                shape='round'
                                color='cyan'
                                variant='filled'
                                style={{ border: '1px solid #13c2c2' }}
                                icon={<QrcodeOutlined />}
                                onClick={() => openQrModal(r)}
                            >
                                QR
                            </Button>
                        )}

                        {isApptDone(r) && (
                            <Button
                                data-guide="appointment-coverage-action"
                                shape='round'
                                danger={!r.sessionCoverage?.latest}
                                color={r.sessionCoverage?.latest ? 'green' : undefined}
                                variant='filled'
                                style={r.sessionCoverage?.latest ? { border: '1px solid green' } : undefined}
                                size='small'
                                icon={r.sessionCoverage?.latest ? <EyeOutlined /> : <CheckCircleOutlined />}
                                onClick={() => openCoverage(r)}
                            >
                                Coverage
                            </Button>
                        )}
                    </Space>
                )
            }
        )

        return baseColumns
    }, [
        isAllPrograms,
        isOperationsView,
        isParentDepartmentView,
        participantPhones,
        qrLoading,
        clockNow,
        setSelectedAppt
    ])

    const pageLoading = coordinatorLoading || appointmentsLoading || assignedLoading
    const isInitialPageLoading = pageLoading && appointments.length === 0
    const hasAppointmentFilters = Boolean(
        filterDelivery || filterParticipant || filterDateRange || filterStatus !== 'all'
    )
    const emptyAppointmentsDescription = (() => {
        if (filterStatus === 'awaiting_coverage') return 'No appointments awaiting coverage.'
        if (filterStatus === 'in_progress') return 'No appointments are currently in progress.'
        if (filterStatus === 'scheduled') return 'No scheduled appointments match these filters.'
        if (filterStatus === 'completed') return 'No completed appointments match these filters.'
        if (filterStatus === 'cancelled') return 'No cancelled appointments match these filters.'
        if (filterStatus === 'postponed') return 'No postponed appointments match these filters.'
        if (hasAppointmentFilters) return 'No appointments match the selected filters.'
        return 'No appointments have been scheduled for this view.'
    })()
    const appointmentsEmptyState = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyAppointmentsDescription} />

    return (
        <div style={{ padding: appointmentPagePadding, overflowX: 'hidden' }}>
            <Helmet>
                <title>Appointments | Smart Incubation</title>
            </Helmet>

            <div>
                {false ? (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                        <Tag color="processing" icon={<SyncOutlined spin />} style={{ marginInlineEnd: 0 }}>
                            Updating appointments…
                        </Tag>
                    </div>
                ) : null}
                <div data-guide="appointment-metrics" style={{ marginBottom: 15 }}>
                    <MetricsGrid metrics={appointmentMetrics} />
                </div>

                {awaitingCoverageCount > 0 ? (
                    <Alert
                        type='warning'
                        showIcon
                        message={`${awaitingCoverageCount} ended ${awaitingCoverageCount === 1 ? 'meeting needs' : 'meetings need'} coverage`}
                        description='Coverage is due within 48 hours after the meeting ends. Record whether it took place; if it did not, select the reason so it is recorded.'
                        action={
                            <Button size='small' onClick={() => setFilterStatus('awaiting_coverage')}>
                                Review now
                            </Button>
                        }
                        style={{ marginBottom: 15 }}
                    />
                ) : null}

                {screens.lg ? (
                    <MotionCard
                        filterBar={
                            <Row data-guide="appointment-filters" gutter={[12, 12]} align="middle" wrap={false}>
                                {isOperationsView && isParentDepartmentView && departmentScopeOptions.length > 0 && (
                                    <Col {...filterSelectCol}>
                                        <Select
                                            value={selectedDepartmentScope}
                                            onChange={setSelectedDepartmentScope}
                                            style={{ width: '100%' }}
                                            placeholder="Select department"
                                            optionFilterProp="label"
                                            showSearch
                                        >
                                            {departmentScopeOptions.map(opt => (
                                                <Option key={opt.id} value={opt.id} label={opt.name}>
                                                    <Space>
                                                        <span>{opt.name}</span>
                                                        {opt.isParent ? <Tag color="gold">Parent</Tag> : null}
                                                    </Space>
                                                </Option>
                                            ))}
                                        </Select>
                                    </Col>
                                )}
                                <Col {...filterSelectCol}>
                                    <Select
                                        allowClear
                                        placeholder="Delivery Method"
                                        style={{ width: '100%' }}
                                        value={filterDelivery}
                                        onChange={(v: Delivery | undefined) => setFilterDelivery(v)}
                                    >
                                        {DELIVERY_METHODS.map((m) => (
                                            <Option key={m.value} value={m.value}>
                                                {m.icon} {m.label}
                                            </Option>
                                        ))}
                                    </Select>
                                </Col>

                                <Col {...filterSelectCol}>
                                    <Select
                                        allowClear
                                        placeholder="Participant"
                                        style={{ width: '100%' }}
                                        value={filterParticipant}
                                        onChange={(v: string | undefined) => setFilterParticipant(v)}
                                        showSearch
                                        optionFilterProp="children"
                                    >
                                        {participantOptions.map((p) => (
                                            <Option key={p.id} value={p.id}>
                                                {p.name}
                                            </Option>
                                        ))}
                                    </Select>
                                </Col>

                                <Col {...filterStatusCol}>
                                    <Select
                                        value={filterStatus}
                                        onChange={(v) => setFilterStatus(v)}
                                        style={{ width: '100%' }}
                                        options={[
                                            { label: 'All', value: 'all' },
                                            { label: 'Scheduled', value: 'scheduled' },
                                            { label: 'In Progress', value: 'in_progress' },
                                            {
                                                label: awaitingCoverageCount
                                                    ? `Awaiting Coverage (${awaitingCoverageCount})`
                                                    : 'Awaiting Coverage',
                                                value: 'awaiting_coverage'
                                            },
                                            { label: 'Completed', value: 'completed' },
                                            { label: 'Cancelled', value: 'cancelled' },
                                            { label: 'Postponed', value: 'postponed' }
                                        ]}
                                    />
                                </Col>

                                <Col {...filterDateCol}>
                                    <RangePicker
                                        allowClear
                                        value={filterDateRange as any}
                                        onChange={(v) => setFilterDateRange((v as any) ?? null)}
                                        placeholder={['Start date', 'End date']}
                                        style={{ width: '100%' }}
                                    />
                                </Col>

                                <Col {...filterActionCol}>
                                    <span style={{ display: 'block', width: '100%' }}>
                                        <Button
                                            data-guide="schedule-appointment-action"
                                            type="primary"
                                            icon={<PlusOutlined />}
                                            style={{ width: '100%' }}
                                            onClick={() => setModalOpen(true)}
                                            disabled={isAddAppointmentDisabled}
                                        >
                                            Schedule
                                        </Button>
                                    </span>
                                </Col>

                                <Col {...filterReviewCol}>
                                    <Button
                                        data-guide="session-review-action"
                                        icon={<BarChartOutlined />}
                                        style={{ width: '100%' }}
                                        onClick={() => setMonthReviewOpen(true)}
                                    >
                                        Review
                                    </Button>
                                </Col>

                            </Row>
                        }
                    >
                        {pageLoading ? (
                            <Skeleton active paragraph={{ rows: 10 }} />
                        ) : (
                            <div data-guide="appointment-table">
                                <Table
                                    rowKey="id"
                                    dataSource={groupedDisplayAppointments}
                                    columns={columns as any}
                                    pagination={{ pageSize: 3, showSizeChanger: false, position: ['bottomCenter'] }}
                                    locale={{ emptyText: appointmentsEmptyState }}
                                    size="middle"
                                    onRow={(record) => ({ style: rowStatusStyle(record) })}
                                    tableLayout="auto"
                                />
                            </div>
                        )}
                    </MotionCard>
                ) : (
                    <>
                        <Space direction='vertical' style={{ width: '100%', marginBottom: 12 }}>
                            <Button
                                data-guide="schedule-appointment-action"
                                type="primary"
                                icon={<PlusOutlined />}
                                onClick={() => setModalOpen(true)}
                                disabled={isAddAppointmentDisabled}
                                block
                            >
                                Add Appointment
                            </Button>
                            <Button
                                data-guide="session-review-action"
                                icon={<BarChartOutlined />}
                                onClick={() => setMonthReviewOpen(true)}
                                block
                            >
                                Review
                            </Button>
                        </Space>

                        {isInitialPageLoading ? (
                            <Card>
                                <Skeleton active avatar paragraph={{ rows: 5 }} />
                            </Card>
                        ) : (
                            <div data-guide="appointment-table">
                                <List
                                    itemLayout="horizontal"
                                    dataSource={groupedDisplayAppointments}
                                    split={false}
                                    locale={{ emptyText: appointmentsEmptyState }}
                                    pagination={{
                                        pageSize: 6,
                                        hideOnSinglePage: true,
                                        size: 'small',
                                        align: 'center',
                                        showSizeChanger: false
                                    }}
                                    renderItem={appt => {
                                        const s = displayStatus(appt)

                                        return (
                                            <List.Item style={{ padding: 0, border: 'none', marginBottom: 12 }}>
                                                <div
                                                    style={{
                                                        width: '100%',
                                                        padding: 16,
                                                        borderRadius: 12,
                                                        border: '1px solid #f0f0f0',
                                                        background: '#fff',
                                                        ...rowStatusStyle(appt),
                                                        boxShadow: '0 6px 18px rgba(0,0,0,0.06)',
                                                        transition: 'all 0.25s ease'
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'flex-start',
                                                            gap: 12,
                                                            flexWrap: 'wrap'
                                                        }}
                                                    >
                                                        <div style={{ flex: 1, minWidth: 220 }}>
                                                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                                                <Space wrap size={8}>
                                                                    <Tag color="blue">{appt.interventionTitle}</Tag>
                                                                    <Tag color={s.color} icon={s.icon}>{s.label}</Tag>
                                                                    {(appt as any)._displayType === 'group' ? (
                                                                        <Tag color="purple">Group</Tag>
                                                                    ) : null}
                                                                </Space>

                                                                <Space wrap size={6}>
                                                                    <UserOutlined />
                                                                    <Text strong>{appt.participantName}</Text>
                                                                </Space>
                                                                {(appt as any)._displayType !== 'group' ? (
                                                                    <Text type="secondary" title={`Assignment: ${appt.assignedInterventionId || 'Not linked'}`}>
                                                                        Assigned: {assignmentDateLabel({ assignedAt: appt.assignmentAssignedAt })}
                                                                    </Text>
                                                                ) : null}

                                                                <Space wrap size={12}>
                                                                    <Text>
                                                                        <CalendarOutlined /> {dayjs(appt.date).format('YYYY-MM-DD')}
                                                                    </Text>
                                                                    <Text>
                                                                        <ClockCircleOutlined /> {formatTime(appt.startTime)} — {formatTime(appt.endTime)}
                                                                    </Text>
                                                                </Space>
                                                            </Space>
                                                        </div>

                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                gap: 8,
                                                                flexWrap: 'wrap',
                                                                justifyContent: 'flex-start'
                                                            }}
                                                        >
                                                            <Button
                                                                type="primary"
                                                                ghost
                                                                shape="round"
                                                                icon={<EyeOutlined />}
                                                                onClick={() => {
                                                                    setSelectedAppt(appt)
                                                                    setDetailModalOpen(true)
                                                                }}
                                                            >
                                                                View
                                                            </Button>

                                                            {!hasStarted(appt) && (
                                                                <Button
                                                                    data-guide="appointment-edit-action"
                                                                    shape="round"
                                                                    icon={<EditOutlined />}
                                                                    onClick={() => openEdit(appt)}
                                                                >
                                                                    Edit
                                                                </Button>
                                                            )}

                                                            {canPostpone(appt) && (
                                                                <Button
                                                                    data-guide="appointment-postpone-action"
                                                                    shape="round"
                                                                    icon={<ClockCircleOutlined />}
                                                                    onClick={() => openPostponeAppointment(appt)}
                                                                >
                                                                    Postpone
                                                                </Button>
                                                            )}

                                                            {canViewFoodMenu(appt) && (
                                                                <Button
                                                                    shape="round"
                                                                    icon={<BookOutlined />}
                                                                    onClick={() => openFoodMenu(appt)}
                                                                >
                                                                    Food Menu
                                                                </Button>
                                                            )}


                                                            {supportsQrAttendance(appt) &&
                                                                canStartQrWindow(appt) &&
                                                                derivedStatus(appt) !== 'completed' &&
                                                                derivedStatus(appt) !== 'cancelled' &&
                                                                derivedStatus(appt) !== 'postponed' &&
                                                                derivedStatus(appt) !== 'awaiting_coverage' &&
                                                                !isQrSessionActive(appt) && (
                                                                    <Button
                                                                        shape="round"
                                                                        icon={<QrcodeOutlined />}
                                                                        loading={qrLoading}
                                                                        onClick={() => startQrSession(appt)}
                                                                    >
                                                                        Start QR
                                                                    </Button>
                                                                )}

                                                            {supportsQrAttendance(appt) && isQrSessionActive(appt) && (
                                                                <Button
                                                                    shape="round"
                                                                    icon={<QrcodeOutlined />}
                                                                    onClick={() => openQrModal(appt)}
                                                                >
                                                                    QR
                                                                </Button>
                                                            )}

                                                            {isApptDone(appt) && (
                                                                <Button
                                                                    data-guide="appointment-coverage-action"
                                                                    shape="round"
                                                                    danger={!appt.sessionCoverage?.latest}
                                                                    icon={appt.sessionCoverage?.latest ? <EyeOutlined /> : <CheckCircleOutlined />}
                                                                    onClick={() => openCoverage(appt)}
                                                                >
                                                                    {appt.sessionCoverage?.latest ? 'View Coverage' : 'Coverage'}
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </List.Item>
                                        )
                                    }}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            <Modal
                className="guide-schedule-appointment-modal"
                centered
                title="Schedule Appointment"
                open={modalOpen}
                onCancel={closeCreateModal}
                footer={null}
                destroyOnClose
                width={800}
            >
                {!activeProgramId ? (
                    <Alert
                        type="warning"
                        showIcon
                        message="No active program selected"
                        description="Select an active program to schedule appointments."
                        style={{ marginBottom: 12 }}
                    />
                ) : null}

                {assignedLoading ? (
                    <Alert
                        type="info"
                        showIcon
                        message="Loading assigned interventions..."
                        style={{ marginBottom: 12 }}
                    />
                ) : null}

                {(createDeliveryMethod === 'in_person' || createStep === 1) && (
                    <div
                        style={{
                            width: '100%',
                            maxWidth: 420,
                            margin: '0 auto 20px',
                            padding: '12px 16px 10px',
                            border: '1px solid #f0f0f0',
                            borderRadius: 12,
                            background: '#fafafa'
                        }}
                    >
                        <Steps
                            current={createStep}
                            size="small"
                            responsive={false}
                            progressDot
                            labelPlacement="vertical"
                            items={[
                                {
                                    title: 'Details'
                                },
                                {
                                    title: 'Food Menu'
                                }
                            ]}
                        />

                        <Text
                            type="secondary"
                            style={{
                                display: 'block',
                                marginTop: 6,
                                textAlign: 'center',
                                fontSize: 12
                            }}
                        >
                            {createStep === 0
                                ? 'Enter the appointment details'
                                : 'Food menu setup is optional'}
                        </Text>
                    </div>
                )}

                {createStep === 0 ? (
                    <>
                        <div data-guide="schedule-type">
                            <Card style={{ marginBottom: 12 }}>
                                <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                                    <Text strong>Schedule Type</Text>

                                    <Select
                                        value={scheduleMode}
                                        onChange={v => {
                                            const next = v as ScheduleMode
                                            setScheduleMode(next)
                                            setAppointmentDetailsDraft({})
                                            setPickedParticipantId(undefined)
                                            setPickedGroupKey(undefined)
                                            form.resetFields()
                                        }}
                                        style={{ width: 180 }}
                                        options={[
                                            { label: 'Individual', value: 'individual' },
                                            { label: 'Group', value: 'group' }
                                        ]}
                                    />
                                </Space>
                            </Card>
                        </div>

                        <div data-guide="schedule-target">
                            {scheduleMode === 'individual' ? (
                                <>
                                    <Form.Item label="Pick Participant" required>
                                        <Select
                                            style={{ width: '100%' }}
                                            showSearch
                                            optionFilterProp="children"
                                            placeholder="Select participant"
                                            value={pickedParticipantId}
                                            onChange={v => {
                                                setPickedParticipantId(v)
                                                form.resetFields(['assignedIntervention'])
                                            }}
                                            disabled={!activeProgramId}
                                        >
                                            {participantOptionsFromAssigned.map(p => (
                                                <Option key={p.id} value={p.id}>
                                                    {p.name}
                                                </Option>
                                            ))}
                                        </Select>

                                        <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
                                            {pickedParticipantId
                                                ? `Assigned interventions found: ${selectedScopeInterventions.length || 0}`
                                                : 'Pick a participant to load their assigned interventions.'}
                                        </Text>
                                    </Form.Item>
                                </>
                            ) : (
                                <Form.Item label="Pick Group Assignment" required>
                                    <Select
                                        style={{ width: '100%' }}
                                        showSearch
                                        optionFilterProp="label"
                                        optionLabelProp="label"
                                        placeholder="Select group assignment"
                                        value={pickedGroupKey}
                                        onChange={setPickedGroupKey}
                                        disabled={!activeProgramId}
                                    >
                                        {groupOptions.map(g => (
                                            <Option
                                                key={g.key}
                                                value={g.key}
                                                label={g.cycleLabel ? `${g.title} ${g.cycleLabel}` : g.title}
                                            >
                                                <Space wrap size={6}>
                                                    <span>{g.title}</span>
                                                    {g.cycleLabel ? (
                                                        <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                                                            {g.cycleLabel}
                                                        </Tag>
                                                    ) : null}
                                                </Space>
                                            </Option>
                                        ))}
                                    </Select>

                                    <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
                                        {pickedGroupKey && selectedGroupMeta
                                            ? `${getGroupKindLabel(selectedGroupMeta.kind)} • ${selectedScopeParticipants.length || 0} participant(s)${selectedGroupMeta.cycleLabel
                                                ? ` • ${selectedGroupMeta.cycleLabel}`
                                                : ''
                                            }`
                                            : 'Pick a group to load participants.'}
                                    </Text>
                                </Form.Item>
                            )}
                        </div>
                    </>
                ) : null}

                <Form
                    layout="vertical"
                    form={form}
                    onFinish={handleAddAppointment}
                >
                    {createStep === 0 ? (
                        <>
                            {scheduleMode === 'individual' ? (
                                <>
                                    {pickedParticipantId ? (
                                        <div data-guide="schedule-intervention">
                                            <Form.Item
                                                name="assignedIntervention"
                                                label={`Intervention assignment (${selectedScopeInterventions.length} open)`}
                                                extra="Each option is a separate assignment. Check the assigned date and cycle before scheduling."
                                                rules={[{ required: true, message: 'Please select an intervention.' }]}
                                            >
                                                <Select
                                                    placeholder="Select the assignment you are working on"
                                                    optionFilterProp="children"
                                                    showSearch
                                                    disabled={!activeProgramId || !pickedParticipantId}
                                                >
                                                    {selectedScopeInterventions.map(interv => (
                                                        <Option key={interv.id} value={interv.id}>
                                                            {assignmentOptionLabel(interv)}
                                                        </Option>
                                                    ))}
                                                </Select>
                                            </Form.Item>
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <>
                                    {pickedGroupKey ? (
                                        <>
                                            <Alert
                                                type="info"
                                                showIcon
                                                style={{ marginBottom: 12 }}
                                                message={
                                                    selectedGroupMeta ? (
                                                        <Space wrap size={6}>
                                                            <span>{selectedGroupMeta.title || 'Selected group'}</span>
                                                            {selectedGroupMeta.cycleLabel ? (
                                                                <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                                                                    {selectedGroupMeta.cycleLabel}
                                                                </Tag>
                                                            ) : null}
                                                        </Space>
                                                    ) : (
                                                        'Selected group'
                                                    )
                                                }
                                                description={`This will schedule appointments for ${selectedScopeParticipants.length || 0} participant(s).`}
                                            />
                                            <Table
                                                rowKey="id"
                                                size="small"
                                                pagination={{
                                                    pageSize: 5,
                                                    showSizeChanger: false,
                                                    hideOnSinglePage: true
                                                }}
                                                dataSource={selectedScopeParticipants}
                                                columns={[
                                                    {
                                                        title: 'Participant',
                                                        dataIndex: 'name',
                                                        key: 'name',
                                                        render: (name: string) => <Text strong>{name}</Text>
                                                    }
                                                ]}
                                                style={{ marginBottom: 12 }}
                                            />
                                        </>
                                    ) : null}
                                </>
                            )}


                            <div data-guide="schedule-session-title">
                                <Form.Item
                                    name="sessionTitle"
                                    label="Session Title"
                                    rules={[{ required: true, message: 'Please add a session title.' }]}
                                >
                                    <Input placeholder="e.g. Introduction to Maths" />
                                </Form.Item>
                            </div>

                            <div data-guide="schedule-coverage">
                                {usesTrainingTopicsForPlanning ? (
                                    <>
                                        <Form.Item
                                            name="plannedTopics"
                                            label="Planned topics"
                                            rules={[{ required: true, message: 'Please add at least one topic.' }]}
                                            extra="Type each topic and press Enter. Actual topics are recorded after delivery."
                                        >
                                            <Select
                                                mode="tags"
                                                open={false}
                                                tokenSeparators={[',']}
                                                placeholder="e.g. Introduction to Maths"
                                                style={{ width: '100%' }}
                                            />
                                        </Form.Item>
                                        <Form.Item
                                            name="plannedCoverage"
                                            label="Planned coverage description"
                                            rules={[{ required: true, whitespace: true, message: 'Please describe what the training will cover.' }, { validator: validatePlannedCoverage }]}
                                            extra="More than 5 words. Explain the intended learning, activity or outcome."
                                        >
                                            <Input.TextArea rows={3} placeholder="Describe what participants will learn, work through or achieve in this session." />
                                        </Form.Item>
                                    </>
                                ) : (
                                    <Form.Item
                                        name="plannedCoverage"
                                        label="Planned coverage"
                                        rules={[{ required: true, whitespace: true, message: 'Please describe what will be covered.' }, { validator: validatePlannedCoverage }]}
                                        extra="More than 5 words. You can reuse this description as the coverage record after the session."
                                    >
                                        <Input.TextArea rows={3} placeholder="Describe the work, support, discussion or outcome planned for this session." />
                                    </Form.Item>
                                )}
                            </div>

                            <div data-guide="schedule-delivery">
                                <Form.Item
                                    name="deliveryMethod"
                                    label="Delivery Method"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Please select a delivery method.'
                                        }
                                    ]}
                                >
                                    <Select
                                        placeholder="Select delivery method"
                                        onChange={(value: Delivery) => {
                                            if (value === 'in_person') {
                                                form.setFieldsValue({
                                                    useDifferentLocation: false,
                                                    location: 'At Center',
                                                    meetingLink: undefined
                                                })
                                                return
                                            }

                                            if (value === 'virtual') {
                                                form.setFieldsValue({
                                                    useDifferentLocation: false,
                                                    location: undefined
                                                })
                                                return
                                            }

                                            form.setFieldsValue({
                                                useDifferentLocation: false,
                                                location: undefined,
                                                meetingLink: undefined
                                            })
                                        }}
                                    >
                                        {DELIVERY_METHODS.map(method => (
                                            <Option key={method.value} value={method.value}>
                                                {method.icon} {method.label}
                                            </Option>
                                        ))}
                                    </Select>
                                </Form.Item>
                            </div>

                            <div data-guide="schedule-datetime">
                                <AppointmentDateTimeFields form={form} />
                            </div>

                            <Form.Item
                                noStyle
                                shouldUpdate={(prev, cur) =>
                                    prev.deliveryMethod !== cur.deliveryMethod ||
                                    prev.useDifferentLocation !== cur.useDifferentLocation
                                }
                            >
                                {({ getFieldValue }) => {
                                    const deliveryMethod = getFieldValue('deliveryMethod')
                                    const useDifferentLocation =
                                        !!getFieldValue('useDifferentLocation')

                                    if (deliveryMethod === 'virtual') {
                                        return (
                                            <Form.Item
                                                name="meetingLink"
                                                label="Meeting Link"
                                                rules={[
                                                    {
                                                        required: true,
                                                        message: 'Please provide a meeting link for virtual appointments.'
                                                    }
                                                ]}
                                            >
                                                <Input placeholder="Paste meeting link here" />
                                            </Form.Item>
                                        )
                                    }

                                    if (deliveryMethod === 'in_person') {
                                        return (
                                            <Row gutter={[12, 8]} align="middle">
                                                <Col xs={24} md={16}>
                                                    <Form.Item
                                                        name="location"
                                                        label="Location"
                                                        rules={[
                                                            {
                                                                required: true,
                                                                whitespace: true,
                                                                message: 'Please provide the appointment location.'
                                                            }
                                                        ]}
                                                    >
                                                        <Input
                                                            disabled={!useDifferentLocation}
                                                            placeholder={
                                                                useDifferentLocation
                                                                    ? 'Enter venue or address'
                                                                    : 'At Center'
                                                            }
                                                        />
                                                    </Form.Item>
                                                </Col>

                                                <Col xs={24} md={8}>
                                                    <Form.Item
                                                        name="useDifferentLocation"
                                                        valuePropName="checked"
                                                        style={{
                                                            marginTop: screens.md ? 30 : 0,
                                                            marginBottom: 24
                                                        }}
                                                    >
                                                        <Checkbox
                                                            onChange={event => {
                                                                form.setFieldsValue({
                                                                    location: event.target.checked
                                                                        ? ''
                                                                        : 'At Center'
                                                                })
                                                            }}
                                                        >
                                                            Use different location
                                                        </Checkbox>
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        )
                                    }

                                    return null
                                }}
                            </Form.Item>
                        </>
                    ) : (
                        <>
                            <Alert
                                type='info'
                                showIcon
                                message='Set up the food menu now or skip it'
                                description='The appointment and menu will be saved together. You can add or edit menu items later.'
                                style={{ marginBottom: 16 }}
                            />

                            <Form.Item
                                name='foodMenuEnabled'
                                valuePropName='checked'
                                initialValue={false}
                            >
                                <Checkbox>Enable a food menu for this in-person appointment</Checkbox>
                            </Form.Item>

                            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.foodMenuEnabled !== cur.foodMenuEnabled}>
                                {({ getFieldValue }) => getFieldValue('foodMenuEnabled') ? (
                                    <Form.List
                                        name='foodMenu'
                                        rules={[
                                            {
                                                validator: async (_, items) => {
                                                    if (!items?.length) throw new Error('Add at least one menu item or disable the food menu.')
                                                }
                                            }
                                        ]}
                                    >
                                        {(fields, { add, remove }, { errors }) => (
                                            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                                                {fields.map((field, index) => (
                                                    <Card
                                                        key={field.key}
                                                        size='small'
                                                        title={`Menu item ${index + 1}`}
                                                        extra={
                                                            <Button danger type='text' onClick={() => remove(field.name)}>
                                                                Remove
                                                            </Button>
                                                        }
                                                    >
                                                        <Form.Item name={[field.name, 'id']} hidden>
                                                            <Input />
                                                        </Form.Item>
                                                        <Form.Item
                                                            name={[field.name, 'name']}
                                                            label='Item name'
                                                            rules={[{ required: true, whitespace: true, message: 'Enter the item name.' }]}
                                                        >
                                                            <Input placeholder='e.g. Chicken wrap' />
                                                        </Form.Item>
                                                        <Row gutter={12}>
                                                            <Col xs={24} sm={12}>
                                                                <Form.Item
                                                                    name={[field.name, 'category']}
                                                                    label='Category'
                                                                    initialValue='meal'
                                                                    rules={[{ required: true }]}
                                                                >
                                                                    <Select options={FOOD_CATEGORY_OPTIONS} />
                                                                </Form.Item>
                                                            </Col>
                                                            <Col xs={24} sm={12}>
                                                                <Form.Item name={[field.name, 'quantityAvailable']} label='Quantity available'>
                                                                    <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder='Optional' />
                                                                </Form.Item>
                                                            </Col>
                                                        </Row>
                                                        <Form.Item name={[field.name, 'description']} label='Description'>
                                                            <Input.TextArea rows={2} placeholder='Optional description' />
                                                        </Form.Item>
                                                        <Form.Item name={[field.name, 'dietaryNote']} label='Dietary note'>
                                                            <Input placeholder='e.g. Vegetarian, contains nuts' />
                                                        </Form.Item>
                                                    </Card>
                                                ))}

                                                <Button
                                                    type='dashed'
                                                    block
                                                    icon={<PlusOutlined />}
                                                    onClick={() => add({ id: makeFoodMenuItemId(), category: 'meal' })}
                                                >
                                                    Add menu item
                                                </Button>
                                                <Form.ErrorList errors={errors} />
                                            </Space>
                                        )}
                                    </Form.List>
                                ) : null}
                            </Form.Item>
                        </>
                    )}

                    <Form.Item style={{ marginTop: createStep === 1 ? 24 : undefined, marginBottom: 0 }}>
                        {createStep === 0 ? (
                            <Button
                                data-guide="schedule-submit"
                                type='primary'
                                htmlType={createDeliveryMethod === 'in_person' ? 'button' : 'submit'}
                                onClick={createDeliveryMethod === 'in_person' ? goToCreateFoodMenuStep : undefined}
                                loading={loading}
                                block
                                disabled={
                                    !activeProgramId ||
                                    (scheduleMode === 'individual'
                                        ? !pickedParticipantId
                                        : !pickedGroupKey || !selectedScopeInterventions.length)
                                }
                            >
                                {createDeliveryMethod === 'in_person'
                                    ? 'Next: Food Menu'
                                    : scheduleMode === 'group'
                                        ? 'Save Group Appointments'
                                        : 'Save Appointment'}
                            </Button>
                        ) : (
                            <Row gutter={[12, 12]} style={{ width: '100%' }}>
                                <Col xs={24} sm={12}>
                                    <Button block onClick={() => setCreateStep(0)} disabled={loading}>
                                        Back
                                    </Button>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Button data-guide="schedule-submit" block type='primary' htmlType='submit' loading={loading}>
                                        {scheduleMode === 'group' ? 'Save Group Appointments' : 'Save Appointment'}
                                    </Button>
                                </Col>
                            </Row>
                        )}
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                className="guide-edit-appointment-modal"
                centered
                title={`Edit Appointment${selectedAppt ? ` — ${selectedAppt.interventionTitle}` : ''}`}
                open={editModalOpen}
                onCancel={closeEditModal}
                okText='Save Changes'
                okButtonProps={{ className: 'guide-edit-appointment-submit' }}
                onOk={() => editForm.submit()}
                confirmLoading={editLoading}
                destroyOnClose
            >
                <Form layout='vertical' form={editForm} onFinish={handleEditAppointment}>
                    <div data-guide="edit-delivery">
                        <Form.Item
                            name="deliveryMethod"
                            label="Delivery Method"
                            rules={[
                                {
                                    required: true,
                                    message: 'Please select a delivery method.'
                                }
                            ]}
                        >
                            <Select
                                onChange={(value: Delivery) => {
                                    if (value === 'in_person') {
                                        const existingLocation = String(
                                            editForm.getFieldValue('location') || ''
                                        ).trim()

                                        editForm.setFieldsValue({
                                            useDifferentLocation:
                                                isDifferentAppointmentLocation(existingLocation),
                                            location: existingLocation || 'At Center',
                                            meetingLink: undefined
                                        })
                                        return
                                    }

                                    if (value === 'virtual') {
                                        editForm.setFieldsValue({
                                            useDifferentLocation: false,
                                            location: undefined
                                        })
                                        return
                                    }

                                    editForm.setFieldsValue({
                                        useDifferentLocation: false,
                                        location: undefined,
                                        meetingLink: undefined
                                    })
                                }}
                            >
                                {DELIVERY_METHODS.map(method => (
                                    <Option key={method.value} value={method.value}>
                                        {method.icon} {method.label}
                                    </Option>
                                ))}
                            </Select>
                        </Form.Item>
                        <Form.Item
                            noStyle
                            shouldUpdate={(prev, cur) =>
                                prev.deliveryMethod !== cur.deliveryMethod ||
                                prev.useDifferentLocation !== cur.useDifferentLocation
                            }
                        >
                            {({ getFieldValue }) => {
                                const deliveryMethod = getFieldValue('deliveryMethod')
                                const useDifferentLocation =
                                    !!getFieldValue('useDifferentLocation')

                                if (deliveryMethod === 'virtual') {
                                    return (
                                        <Form.Item
                                            name="meetingLink"
                                            label="Meeting Link"
                                            rules={[
                                                {
                                                    required: true,
                                                    message: 'Please provide the meeting link.'
                                                }
                                            ]}
                                        >
                                            <Input placeholder="Paste meeting link here" />
                                        </Form.Item>
                                    )
                                }

                                if (deliveryMethod === 'in_person') {
                                    return (
                                        <Row gutter={[12, 8]} align="middle">
                                            <Col xs={24} md={16}>
                                                <Form.Item
                                                    name="location"
                                                    label="Location"
                                                    rules={[
                                                        {
                                                            required: true,
                                                            whitespace: true,
                                                            message: 'Please provide the appointment location.'
                                                        }
                                                    ]}
                                                >
                                                    <Input
                                                        disabled={!useDifferentLocation}
                                                        placeholder={
                                                            useDifferentLocation
                                                                ? 'Enter venue or address'
                                                                : 'At Center'
                                                        }
                                                    />
                                                </Form.Item>
                                            </Col>

                                            <Col xs={24} md={8}>
                                                <Form.Item
                                                    name="useDifferentLocation"
                                                    valuePropName="checked"
                                                    style={{
                                                        marginTop: screens.md ? 30 : 0,
                                                        marginBottom: 24
                                                    }}
                                                >
                                                    <Checkbox
                                                        onChange={event => {
                                                            editForm.setFieldsValue({
                                                                location: event.target.checked
                                                                    ? ''
                                                                    : 'At Center'
                                                            })
                                                        }}
                                                    >
                                                        Use different location
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    )
                                }

                                return null
                            }}
                        </Form.Item>
                    </div>

                    <div data-guide="edit-session-content">
                        <Form.Item
                            name='sessionTitle'
                            label='Session Title'
                            rules={[{ required: true, message: 'Please add a session title.' }]}
                        >
                            <Input placeholder='e.g. Introduction to Maths' />
                        </Form.Item>

                        {usesTrainingTopicsForEditing ? (
                            <>
                                <Form.Item
                                    name='plannedTopics'
                                    label='Planned topics'
                                    rules={[{ required: true, message: 'Please add at least one topic.' }]}
                                    extra='These are planned training topics. Record the actual topics delivered in Meeting Coverage.'
                                >
                                    <Select
                                        mode='tags'
                                        open={false}
                                        tokenSeparators={[',']}
                                        placeholder='Type a topic and press Enter'
                                        style={{ width: '100%' }}
                                    />
                                </Form.Item>
                                <Form.Item
                                    name='plannedCoverage'
                                    label='Planned coverage description'
                                    rules={[{ required: true, whitespace: true, message: 'Please describe what the training will cover.' }, { validator: validatePlannedCoverage }]}
                                    extra='More than 5 words. Explain the intended learning, activity or outcome.'
                                >
                                    <Input.TextArea rows={3} placeholder='Describe what participants will learn, work through or achieve in this session.' />
                                </Form.Item>
                            </>
                        ) : (
                            <Form.Item
                                name='plannedCoverage'
                                label='Planned coverage'
                                rules={[{ required: true, whitespace: true, message: 'Please describe what will be covered.' }, { validator: validatePlannedCoverage }]}
                                extra='More than 5 words. This can be reused as the coverage record after the session.'
                            >
                                <Input.TextArea rows={3} placeholder='Describe the work, support, discussion or outcome planned for this session.' />
                            </Form.Item>
                        )}

                    </div>

                    {/*
                        A meeting that already has attendance or coverage keeps
                        its slot. Everything else on this form stays editable —
                        the title and planned coverage are still worth
                        correcting — but moving the date would orphan the
                        check-ins recorded against the original one.
                    */}
                    {selectedAppt && !canReschedule(selectedAppt) ? (
                        <Alert
                            type='info'
                            showIcon
                            style={{ marginBottom: 12 }}
                            message='The date and time are locked'
                            description={rescheduleBlockReason(selectedAppt)}
                        />
                    ) : null}

                    <div data-guide="edit-datetime">
                        <AppointmentDateTimeFields
                            form={editForm}
                            allowPast
                            disabled={Boolean(selectedAppt && !canReschedule(selectedAppt))}
                        />
                    </div>

                    {/*
                        Only a genuine reschedule asks for a reason.

                        This used to render unconditionally, so editing the title
                        or the planned coverage of an untouched future meeting
                        still demanded an explanation for a move that was not
                        happening. It now appears when the meeting has already
                        started AND the date or time in the form differs from
                        what was loaded — which is exactly when the submit
                        handler requires it.
                    */}
                    <Form.Item noStyle shouldUpdate>
                        {({ getFieldsValue }) => {
                            if (!selectedAppt || !hasStarted(selectedAppt)) return null

                            const { startsAt, endsAt } = getFieldsValue(['startsAt', 'endsAt']) as {
                                startsAt?: Dayjs
                                endsAt?: Dayjs
                            }
                            if (!startsAt?.isValid?.() || !endsAt?.isValid?.()) return null

                            const originalStart = tsToDayjs(selectedAppt.startTime, selectedAppt.date)
                            const originalEnd = tsToDayjs(selectedAppt.endTime, selectedAppt.date)
                            const moved =
                                !originalStart.isSame(startsAt, 'minute') ||
                                !originalEnd.isSame(endsAt, 'minute')

                            if (!moved) return null

                            return (
                                <div data-guide="edit-reschedule-reason">
                                    <Form.Item
                                        name='rescheduleReason'
                                        label='Reason for rescheduling'
                                        rules={[{ required: true, whitespace: true, message: 'Give a reason for moving a meeting that has already started.' }]}
                                        extra='This meeting has already started, so the change is recorded as a reschedule.'
                                    >
                                        <Input.TextArea rows={2} placeholder='Why is this session moving?' />
                                    </Form.Item>
                                </div>
                            )
                        }}
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                className="guide-postpone-appointment-modal"
                centered
                title={`Postpone Appointment${postponeRecord ? ` — ${postponeRecord.interventionTitle}` : ''}`}
                open={postponeModalOpen}
                onCancel={closePostponeModal}
                okText='Postpone Appointment'
                okButtonProps={{ className: 'guide-postpone-submit' }}
                onOk={() => postponeForm.submit()}
                confirmLoading={postponeLoading}
                destroyOnClose
                width={680}
            >
                <Alert
                    type="info"
                    showIcon
                    description="The SME(s) will be asked to confirm the updated appointment."
                    style={{ marginBottom: 8 }}
                />

                <Form
                    form={postponeForm}
                    layout="vertical"
                    onFinish={handlePostponeAppointment}
                >
                    <Row gutter={[16, 0]} align="top">
                        {/* Delivery Method */}
                        <Col
                            xs={24}
                            md={hasPostponeConnectionDetails ? 12 : 24}
                        >
                            <div data-guide="postpone-delivery">
                                <Form.Item
                                    name="deliveryMethod"
                                    label="Delivery Method"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Please select a delivery method.'
                                        }
                                    ]}
                                >
                                    <Select
                                        placeholder="Select delivery method"
                                        onChange={(value: Delivery) => {
                                            if (value === 'in_person') {
                                                const existingLocation = String(
                                                    postponeForm.getFieldValue('location') || ''
                                                ).trim()

                                                postponeForm.setFieldsValue({
                                                    useDifferentLocation:
                                                        isDifferentAppointmentLocation(existingLocation),
                                                    location: existingLocation || 'At Center',
                                                    meetingLink: undefined
                                                })
                                                return
                                            }

                                            if (value === 'virtual') {
                                                postponeForm.setFieldsValue({
                                                    useDifferentLocation: false,
                                                    location: undefined
                                                })
                                                return
                                            }

                                            postponeForm.setFieldsValue({
                                                useDifferentLocation: false,
                                                location: undefined,
                                                meetingLink: undefined
                                            })
                                        }}
                                    >
                                        {DELIVERY_METHODS.map(method => (
                                            <Option key={method.value} value={method.value}>
                                                {method.icon} {method.label}
                                            </Option>
                                        ))}
                                    </Select>
                                </Form.Item>
                            </div>
                        </Col>

                        {/* Location / Meeting Link */}
                        {hasPostponeConnectionDetails && (
                            <Col xs={24} md={12}>
                                <Form.Item
                                    noStyle
                                    shouldUpdate={(prev, cur) =>
                                        prev.deliveryMethod !== cur.deliveryMethod ||
                                        prev.useDifferentLocation !== cur.useDifferentLocation
                                    }
                                >
                                    {({ getFieldValue }) => {
                                        const deliveryMethod = getFieldValue('deliveryMethod')
                                        const useDifferentLocation =
                                            !!getFieldValue('useDifferentLocation')

                                        if (deliveryMethod === 'virtual') {
                                            return (
                                                <div data-guide="postpone-connection-details">
                                                    <Form.Item
                                                        name="meetingLink"
                                                        label="Meeting Link"
                                                        extra="Keep the existing link or replace it."
                                                        rules={[
                                                            {
                                                                required: true,
                                                                message: 'Please provide the meeting link.'
                                                            }
                                                        ]}
                                                    >
                                                        <Input placeholder="Paste meeting link here" />
                                                    </Form.Item>
                                                </div>
                                            )
                                        }

                                        if (deliveryMethod === 'in_person') {
                                            return (
                                                <div data-guide="postpone-connection-details">
                                                    <Form.Item
                                                        name="location"
                                                        label="Location"
                                                        rules={[
                                                            {
                                                                required: true,
                                                                whitespace: true,
                                                                message:
                                                                    'Please provide the appointment location.'
                                                            }
                                                        ]}
                                                        style={{ marginBottom: 8 }}
                                                    >
                                                        <Input
                                                            disabled={!useDifferentLocation}
                                                            placeholder={
                                                                useDifferentLocation
                                                                    ? 'Enter venue or address'
                                                                    : 'At Center'
                                                            }
                                                        />
                                                    </Form.Item>

                                                    <Form.Item
                                                        name="useDifferentLocation"
                                                        valuePropName="checked"
                                                        style={{ marginBottom: 24 }}
                                                    >
                                                        <Checkbox
                                                            onChange={event => {
                                                                postponeForm.setFieldsValue({
                                                                    location: event.target.checked
                                                                        ? ''
                                                                        : 'At Center'
                                                                })
                                                            }}
                                                        >
                                                            Use different location
                                                        </Checkbox>
                                                    </Form.Item>
                                                </div>
                                            )
                                        }

                                        return null
                                    }}
                                </Form.Item>
                            </Col>
                        )}
                    </Row>

                    <div data-guide="postpone-datetime">
                        <AppointmentDateTimeFields form={postponeForm} />
                    </div>

                    <div data-guide="postpone-reason">
                        <Form.Item
                            name="reason"
                            label="Reason"
                            extra="Optional — add context if it will help explain why the meeting moved."
                            style={{ marginBottom: 0 }}
                        >
                            <Input.TextArea
                                rows={3}
                                maxLength={500}
                                showCount
                                placeholder="e.g. SME requested a later date"
                            />
                        </Form.Item>
                    </div>
                </Form>
            </Modal>

            <Modal
                centered
                title='Appointment Details'
                open={detailModalOpen}
                onCancel={() => setDetailModalOpen(false)}
                width={screens.lg ? 980 : screens.md ? 860 : '100%'}
                style={screens.md ? undefined : { maxWidth: '100vw' }}
                bodyStyle={{
                    paddingTop: 8,
                    overflowX: 'hidden'
                }}
                footer={[
                    selectedAppt && !['completed', 'cancelled', 'postponed'].includes(derivedStatus(selectedAppt)) ? (
                        /*
                          These buttons used to set type='primary' AND
                          color='orange' variant='filled' together. Those are two
                          different Ant Design APIs: `type` wins for the base
                          class, so the button rendered as a primary (blue in
                          dark mode) while `color` only tinted the label — hence
                          orange text on a blue gradient. Using the colour/variant
                          API alone lets Ant Design derive both themes properly,
                          and drops the hardcoded `orange` / `crimson` borders
                          that ignored the theme entirely.
                        */
                        <Button
                            data-guide="appointment-edit-action"
                            key='edit'
                            shape='round'
                            color='orange'
                            variant='solid'
                            icon={<EditOutlined />}
                            onClick={() => {
                                openEdit(selectedAppt)
                                setDetailModalOpen(false)
                            }}
                        >
                            {hasStarted(selectedAppt) && canReschedule(selectedAppt) ? 'Reschedule' : 'Edit'}
                        </Button>
                    ) : null,
                    <Button
                        key='close'
                        shape='round'
                        color='danger'
                        variant='outlined'
                        onClick={() => setDetailModalOpen(false)}
                    >
                        Close
                    </Button>
                ].filter(Boolean)}
            >
                {selectedAppt ? (
                    <>
                        <Text strong style={{ fontSize: 16 }}>
                            {selectedAppt.interventionTitle}
                        </Text>
                        {(selectedAppt as any)._displayType !== 'group' ? (
                            <div style={{ marginTop: 6 }}>
                                <Text type="secondary">
                                    Assigned: {assignmentDateLabel({ assignedAt: selectedAppt.assignmentAssignedAt })}
                                    {' · '}
                                </Text>
                            </div>
                        ) : null}
                        <Divider style={{ margin: '10px 0' }} />
                        <Segmented
                            block
                            value={detailModalTab}
                            onChange={value => setDetailModalTab(value as 'overview' | 'members' | 'food')}
                            options={[
                                { label: 'Overview', value: 'overview' },
                                {
                                    label: `Members (${getDisplayRowMembers(selectedAppt).length})`,
                                    value: 'members'
                                },
                                ...(hasConfiguredFoodMenu(selectedAppt)
                                    ? [{ label: 'Food Menu', value: 'food' }]
                                    : [])
                            ]}
                            style={{ marginBottom: 14 }}
                        />

                        {detailModalTab === 'overview' && (() => {
                            const stats = getAttendanceCounts(selectedAppt)

                            if (!hasQrAttendance(selectedAppt)) {
                                return (
                                    <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
                                        <Col xs={24} md={8}>
                                            <Card size='small'>
                                                <Text type='secondary'>RSVP Confirmed</Text>
                                                <div style={{ fontSize: 20, fontWeight: 700 }}>
                                                    {stats.confirmed}/{stats.total}
                                                </div>
                                            </Card>
                                        </Col>
                                        <Col xs={24} md={8}>
                                            <Card size='small'>
                                                <Text type='secondary'>Meeting Outcome</Text>
                                                <div style={{ fontSize: 20, fontWeight: 700 }}>
                                                    {meetingOutcomeLabel(selectedAppt)}
                                                </div>
                                            </Card>
                                        </Col>
                                        <Col xs={24} md={8}>
                                            <Card size='small'>
                                                <Text type='secondary'>SME Attendance</Text>
                                                <div style={{ fontSize: 20, fontWeight: 700 }}>
                                                    {smeAttendanceLabel(getSmeAttendanceOutcome(selectedAppt))}
                                                </div>
                                            </Card>
                                        </Col>
                                    </Row>
                                )
                            }

                            /*
                              Each tile is measured against the population the
                              number actually belongs to.

                              Checked Out previously read "0/29 invited", which
                              is unanswerable — someone who never arrived cannot
                              check out. Its denominator is the people who
                              checked in.
                            */
                            const pct = (part: number, whole: number) =>
                                whole > 0 ? Math.round((part / whole) * 100) : null

                            const turnout = pct(stats.checkedIn, stats.total)
                            const followThrough = pct(stats.checkedIn, stats.confirmed)
                            const noShows = Math.max(stats.confirmed - stats.checkedIn, 0)
                            const isGroupRow = (selectedAppt as any)?._displayType === 'group'

                            return (
                                <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
                                    <Col xs={12} md={isGroupRow ? 6 : 6}>
                                        <MotionCard.Metric
                                            icon={<TeamOutlined />}
                                            iconBg='rgba(22,119,255,.12)'
                                            title='RSVP Confirmed'
                                            value={`${stats.confirmed}/${stats.total}`}
                                            subtitle='of those invited'
                                        />
                                    </Col>

                                    <Col xs={12} md={6}>
                                        <MotionCard.Metric
                                            icon={<LoginOutlined />}
                                            iconBg='rgba(82,196,26,.12)'
                                            title='Checked In'
                                            value={`${stats.checkedIn}/${stats.total}`}
                                            subtitle={turnout === null ? 'of those invited' : `${turnout}% of those invited`}
                                        />
                                    </Col>

                                    <Col xs={12} md={6}>
                                        <MotionCard.Metric
                                            icon={<LogoutOutlined />}
                                            iconBg='rgba(250,173,20,.12)'
                                            title='Checked Out'
                                            value={`${stats.checkedOut}/${stats.checkedIn}`}
                                            subtitle='of those who checked in'
                                        />
                                    </Col>

                                    <Col xs={12} md={6}>
                                        <MotionCard.Metric
                                            icon={<ClockCircleOutlined />}
                                            iconBg='rgba(19,194,194,.12)'
                                            title='Still Present'
                                            value={stats.currentlyPresent}
                                            subtitle='checked in, not yet out'
                                        />
                                    </Col>

                                    {/*
                                      Follow-through, for group bookings only.

                                      Measured against SMEs who confirmed rather
                                      than everyone invited: confirming is the
                                      commitment, so a confirmed SME who never
                                      arrived is the one worth chasing. Turnout
                                      against the full invite list is on the
                                      Checked In tile, so both readings are
                                      available without conflating them.
                                    */}
                                    {isGroupRow ? (
                                        <Col xs={24}>
                                            <MotionCard.Metric
                                                icon={<CheckCircleOutlined />}
                                                iconBg={
                                                    followThrough === null
                                                        ? 'rgba(140,140,140,.12)'
                                                        : followThrough >= 80
                                                            ? 'rgba(82,196,26,.12)'
                                                            : followThrough >= 50
                                                                ? 'rgba(250,173,20,.12)'
                                                                : 'rgba(255,77,79,.12)'
                                                }
                                                title='Attendance follow-through'
                                                value={followThrough === null ? '—' : `${followThrough}%`}
                                                subtitle={
                                                    stats.confirmed === 0
                                                        ? 'No SME confirmed this session yet'
                                                        : `${stats.checkedIn} of ${stats.confirmed} who confirmed attended · ${noShows} did not follow through`
                                                }
                                            />
                                        </Col>
                                    ) : null}
                                </Row>
                            )
                        })()}

                        {detailModalTab === 'overview' && (selectedAppt as any)?._displayType === 'group' ? (
                            <Space wrap style={{ marginBottom: 12 }}>
                                <Tag color={(selectedAppt as any)._groupKind === 'grouped_assignment' ? 'purple' : 'cyan'}>
                                    {(selectedAppt as any)._groupKind === 'grouped_assignment'
                                        ? 'Grouped Assignment'
                                        : 'Grouped by Cycle'}
                                </Tag>

                                {(selectedAppt as any)._cycleKey && formatCycleLabel((selectedAppt as any)._cycleKey) ? (
                                    <Tag color="geekblue">
                                        {formatCycleLabel((selectedAppt as any)._cycleKey)}
                                    </Tag>
                                ) : null}
                            </Space>
                        ) : null}

                        {detailModalTab === 'overview' && <Descriptions
                            bordered
                            size={screens.md ? 'middle' : 'small'}
                            column={screens.md ? 2 : 1}
                            labelStyle={{ width: screens.md ? 160 : undefined }}
                        >
                            <Descriptions.Item label='SME'>
                                <Space>
                                    <UserOutlined />
                                    <span>{selectedAppt.participantName || '-'}</span>
                                </Space>
                            </Descriptions.Item>

                            <Descriptions.Item label='Appointment RSVP'>
                                {memberRsvpTag(selectedAppt, selectedAppt, true)}
                            </Descriptions.Item>

                            <Descriptions.Item label='Date'>
                                <Space>
                                    <CalendarOutlined />
                                    <span>{dayjs(selectedAppt.date).format('YYYY-MM-DD')}</span>
                                </Space>
                            </Descriptions.Item>

                            <Descriptions.Item label='Time'>
                                <Space>
                                    <ClockCircleOutlined />
                                    <span>
                                        {formatTime(selectedAppt.startTime)} — {formatTime(selectedAppt.endTime)}
                                    </span>
                                </Space>
                            </Descriptions.Item>

                            <Descriptions.Item label='Delivery Method'>
                                <Tag icon={DELIVERY_METHODS.find(m => m.value === selectedAppt.deliveryMethod)?.icon}>
                                    {DELIVERY_METHODS.find(m => m.value === selectedAppt.deliveryMethod)?.label || '—'}
                                </Tag>
                            </Descriptions.Item>

                            <Descriptions.Item label='Details'>
                                {selectedAppt.deliveryMethod === 'virtual' ? (
                                    isApptDone(selectedAppt) ? (
                                        <Tag color={selectedAppt.sessionCoverage?.latest?.held ? 'green' : selectedAppt.sessionCoverage?.latest?.held === false ? 'red' : 'default'}>
                                            {selectedAppt.sessionCoverage?.latest?.held
                                                ? 'Session completed'
                                                : selectedAppt.sessionCoverage?.latest?.held === false
                                                    ? 'Session not held'
                                                    : 'Meeting ended'}
                                        </Tag>
                                    ) : selectedAppt.meetingLink ? (
                                        <a href={selectedAppt.meetingLink} target='_blank' rel='noreferrer'>
                                            <LinkOutlined /> Join link
                                        </a>
                                    ) : (
                                        <Text type='secondary'>No link provided</Text>
                                    )
                                ) : selectedAppt.deliveryMethod === 'in_person' ? (
                                    selectedAppt.location ? (
                                        <Space>
                                            <EnvironmentOutlined />
                                            <span>{selectedAppt.location}</span>
                                        </Space>
                                    ) : (
                                        <Text type='secondary'>No location provided</Text>
                                    )
                                ) : (
                                    <Space>
                                        <PhoneFilled />
                                        <span>
                                            {(selectedAppt as any)?._displayType === 'group'
                                                ? 'See participant list below'
                                                : participantPhones[selectedAppt.participantId] || 'No phone on file'}
                                        </span>
                                    </Space>
                                )}
                            </Descriptions.Item>

                            <Descriptions.Item label='Status'>
                                {(() => {
                                    const s = displayStatus(selectedAppt)
                                    return <Tag color={s.color} icon={s.icon}>{s.label}</Tag>
                                })()}
                            </Descriptions.Item>
                        </Descriptions>}

                        {detailModalTab === 'overview' && (selectedAppt as any)?._displayType !== 'group' &&
                            (selectedAppt as any)?.smeRescheduleRequest?.status === 'proposed' &&
                            Array.isArray((selectedAppt as any)?.smeRescheduleRequest?.proposals) ? (
                            <Card
                                size="small"
                                title="SME Proposed Times"
                                style={{ marginTop: 12, borderColor: '#faad14' }}
                            >
                                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                    <Text type="secondary">
                                        Decline reason: {(selectedAppt as any).smeRescheduleRequest.reasonText || selectedAppt.declineReason || '-'}
                                    </Text>
                                    {(selectedAppt as any).smeRescheduleRequest.proposals.map((proposal: any, index: number) => (
                                        <Card key={proposal.id || index} size="small">
                                            <Space
                                                wrap
                                                style={{ width: '100%', justifyContent: 'space-between' }}
                                            >
                                                <Text>
                                                    <CalendarOutlined /> {proposal.date || '-'}{' '}
                                                    <ClockCircleOutlined /> {formatTime(proposal.startTime, proposal.date)} — {formatTime(proposal.endTime, proposal.date)}
                                                </Text>
                                                <Button
                                                    type="primary"
                                                    size="small"
                                                    loading={rescheduleDecisionLoading === String(proposal.id || '')}
                                                    onClick={() => acceptProposedAppointmentTime(selectedAppt, proposal)}
                                                >
                                                    Accept This Time
                                                </Button>
                                            </Space>
                                        </Card>
                                    ))}
                                    <Button
                                        onClick={() => {
                                            openEdit(selectedAppt)
                                            setDetailModalOpen(false)
                                        }}
                                    >
                                        Choose a Different Time
                                    </Button>
                                </Space>
                            </Card>
                        ) : null}

                        {/*
                            Decline reasons on the overview tab.

                            This previously only handled a single appointment, so
                            on a group booking — where each SME confirms or
                            declines individually — the reasons were recorded but
                            never shown anywhere. Groups now get one alert
                            listing who declined and why.
                        */}
                        {detailModalTab === 'overview' &&
                            (selectedAppt as any)?.smeRescheduleRequest?.status !== 'proposed' ? (() => {
                                const declineReasonOf = (row: Appt) => String(
                                    row.declineReason ||
                                    (row as any)?.smeDeclineReason ||
                                    (row as any)?.smeRescheduleRequest?.reasonText ||
                                    ''
                                ).trim()

                                const members: Appt[] = Array.isArray((selectedAppt as any)?._groupMembers)
                                    ? (selectedAppt as any)._groupMembers
                                    : []

                                if ((selectedAppt as any)?._displayType === 'group' && members.length) {
                                    const declined = members.filter(
                                        m => String(m.userConfirmation || '').toLowerCase() === 'declined'
                                    )
                                    if (!declined.length) return null

                                    return (
                                        <Alert
                                            type='warning'
                                            showIcon
                                            style={{ marginTop: 12 }}
                                            message={`${declined.length} SME${declined.length === 1 ? '' : 's'} declined this appointment`}
                                            description={
                                                <Space direction='vertical' size={4} style={{ width: '100%' }}>
                                                    {declined.map(m => (
                                                        <Text key={m.id} style={{ fontSize: 13 }}>
                                                            <Text strong>{m.participantName || 'SME'}</Text>
                                                            {' — '}
                                                            {declineReasonOf(m) || 'No reason was provided.'}
                                                        </Text>
                                                    ))}
                                                </Space>
                                            }
                                        />
                                    )
                                }

                                if (String(selectedAppt.userConfirmation || '').toLowerCase() !== 'declined') return null

                                return (
                                    <Alert
                                        type='warning'
                                        showIcon
                                        style={{ marginTop: 12 }}
                                        message='SME declined this appointment'
                                        description={declineReasonOf(selectedAppt) || 'No reason was provided.'}
                                    />
                                )
                            })() : null}

                        {detailModalTab === 'overview' && derivedStatus(selectedAppt) === 'completed' && getSmeAttendanceOutcome(selectedAppt) === 'unverified' ? (
                            <Alert
                                type='warning'
                                showIcon
                                style={{ marginTop: 12 }}
                                message='Completed session with unverified SME attendance'
                                description='Completion records the facilitator outcome; it does not prove that the SME attended. Update Meeting Coverage to record an attended or no-show outcome.'
                            />
                        ) : null}

                        {detailModalTab === 'members' && (selectedAppt as any)?._displayType !== 'group' ? (
                            <>
                                <Divider style={{ margin: '14px 0' }} />
                                <Space direction='vertical' style={{ width: '100%' }} size={10}>
                                    <Card
                                        size='small'
                                        title={selectedAppt.participantName || 'SME member'}
                                        extra={selectedAppt.participantEmail || participantEmails[selectedAppt.participantId] || null}
                                    >
                                        <Descriptions bordered size='small' column={screens.md ? 2 : 1}>
                                            <Descriptions.Item label='Appointment RSVP'>
                                                {memberRsvpTag(selectedAppt, selectedAppt)}
                                            </Descriptions.Item>
                                            <Descriptions.Item label='Attendance'>
                                                {memberAttendanceTag(selectedAppt, selectedAppt)}
                                            </Descriptions.Item>
                                            {hasQrAttendance(selectedAppt) ? (() => {
                                                const timing = getAttendanceTimingForMember(selectedAppt, selectedAppt, participantEmails)
                                                return (
                                                    <>
                                                        <Descriptions.Item label='Check-in'>{timing.checkInTime}</Descriptions.Item>
                                                        <Descriptions.Item label='Checkout'>{timing.checkOutTime}</Descriptions.Item>
                                                        <Descriptions.Item label='Time Spent'>{formatMinutesSpent(timing.minutesSpent)}</Descriptions.Item>
                                                    </>
                                                )
                                            })() : null}
                                        </Descriptions>
                                    </Card>
                                    {hasQrAttendance(selectedAppt) ? (() => {
                                        const checkedIn = Boolean((selectedAppt as any)?.attendance?.checkedInAt) || Number(selectedAppt.attendanceSummary?.count || 0) > 0
                                        const checkedOut = Boolean((selectedAppt as any)?.attendance?.checkedOutAt) || Boolean(getCheckedOutEmails(selectedAppt).length)
                                        return (
                                            <Button
                                                size={screens.md ? 'middle' : 'small'}
                                                shape='round'
                                                icon={<LogoutOutlined />}
                                                disabled={!checkedIn || checkedOut}
                                                loading={checkoutLoading === `${selectedAppt.id}-${String(selectedAppt.participantEmail || participantEmails[selectedAppt.participantId] || '').trim().toLowerCase()}`}
                                                onClick={() => checkOutParticipant(selectedAppt)}
                                            >
                                                Check Out
                                            </Button>
                                        )
                                    })() : null}
                                </Space>
                            </>
                        ) : null}

                        {detailModalTab === 'members' && (selectedAppt as any)?._displayType === 'group' && Array.isArray((selectedAppt as any)?._groupMembers) ? (
                            <>
                                <Divider style={{ margin: '14px 0' }} />
                                <Space direction='vertical' style={{ width: '100%' }} size={10}>
                                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                        <Text strong>Participants in this group</Text>
                                        <Space wrap>
                                            <Tag color='purple'>
                                                {(selectedAppt as any)._groupMembers.length} SME(s)
                                            </Tag>
                                            {hasQrAttendance(selectedAppt) ? (() => {
                                                const eligibility = getBulkCheckoutEligibility(selectedAppt)
                                                const eligibleCount = eligibility.eligibleMembers.length
                                                const excludedReasons = [
                                                    eligibility.notCheckedInCount
                                                        ? `${eligibility.notCheckedInCount} not checked in`
                                                        : '',
                                                    eligibility.alreadyCheckedOutCount
                                                        ? `${eligibility.alreadyCheckedOutCount} already checked out`
                                                        : '',
                                                    eligibility.missingEmailCount
                                                        ? `${eligibility.missingEmailCount} missing email`
                                                        : ''
                                                ].filter(Boolean)

                                                return (
                                                    <Space direction="vertical" size={2} align="end">
                                                        <Popconfirm
                                                            title={`Check out ${eligibleCount} eligible SME${eligibleCount === 1 ? '' : 's'}?`}
                                                            description='Only checked-in SMEs with an email who have not checked out will be updated.'
                                                            okText='Check out eligible'
                                                            cancelText='Cancel'
                                                            disabled={!eligibleCount}
                                                            onConfirm={() => checkOutAllPresent(selectedAppt)}
                                                        >
                                                            <Button
                                                                size='small'
                                                                shape='round'
                                                                icon={<LogoutOutlined />}
                                                                disabled={!eligibleCount}
                                                                loading={checkoutLoading === `${selectedAppt.id}-bulk`}
                                                            >
                                                                Check Out Eligible ({eligibleCount})
                                                            </Button>
                                                        </Popconfirm>
                                                        {eligibility.excludedCount > 0 ? (
                                                            <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>
                                                                {eligibility.excludedCount} excluded: {excludedReasons.join(', ')}
                                                            </Text>
                                                        ) : null}
                                                    </Space>
                                                )
                                            })() : null}
                                        </Space>
                                    </Space>

                                    <Table
                                        rowKey="id"
                                        size="small"
                                        pagination={{
                                            pageSize: 5,
                                            showSizeChanger: false,
                                            hideOnSinglePage: true,
                                            position: ['bottomCenter']
                                        }}
                                        scroll={screens.md ? undefined : { x: 920 }}
                                        dataSource={(selectedAppt as any)._groupMembers}
                                        columns={[
                                            {
                                                title: 'SME',
                                                dataIndex: 'participantName',
                                                key: 'participantName',
                                                width: 220,
                                                render: (_: any, m: Appt) => (
                                                    <Space direction="vertical" size={0}>
                                                        <Text strong>{m.participantName || '-'}</Text>
                                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                                            {participantEmails[m.participantId] || m.participantEmail || 'No email on file'}
                                                        </Text>
                                                    </Space>
                                                )
                                            },
                                            {
                                                title: 'Appointment RSVP',
                                                dataIndex: 'userConfirmation',
                                                key: 'userConfirmation',
                                                width: 200,
                                                render: (value: UserConfirmation, m: Appt) => {
                                                    // A decline is only actionable if you can see why. The
                                                    // reason was previously stored but never surfaced for
                                                    // group members.
                                                    const declined = String(value || '').toLowerCase() === 'declined'
                                                    const reason = String(
                                                        m.declineReason ||
                                                        (m as any)?.smeDeclineReason ||
                                                        (m as any)?.smeRescheduleRequest?.reasonText ||
                                                        ''
                                                    ).trim()

                                                    return (
                                                        <Space direction="vertical" size={2}>
                                                            {memberRsvpTag(selectedAppt, m)}
                                                            {declined ? (
                                                                <Text
                                                                    type="danger"
                                                                    style={{ fontSize: 12 }}
                                                                    title={reason || undefined}
                                                                >
                                                                    {reason || 'No reason given'}
                                                                </Text>
                                                            ) : null}
                                                        </Space>
                                                    )
                                                }
                                            },
                                            {
                                                title: 'Attendance',
                                                key: 'attendanceOutcome',
                                                width: 170,
                                                render: (_: any, m: Appt) => memberAttendanceTag(selectedAppt, m)
                                            },
                                            {
                                                title: 'Check-in',
                                                key: 'checkInTime',
                                                width: 150,
                                                hidden: !hasQrAttendance(selectedAppt),
                                                render: (_: any, m: Appt) => {
                                                    const timing = getAttendanceTimingForMember(selectedAppt, m, participantEmails)
                                                    const checkedIn = isGroupMemberCheckedIn(selectedAppt, m, participantEmails)

                                                    return (
                                                        <Space direction="vertical" size={2}>
                                                            {checkedIn ? <Tag color="green">Checked In</Tag> : <Tag>Not checked in</Tag>}
                                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                                {timing.checkInTime}
                                                            </Text>
                                                        </Space>
                                                    )
                                                }
                                            },
                                            {
                                                title: 'Checkout',
                                                key: 'checkOutTime',
                                                width: 150,
                                                hidden: !hasQrAttendance(selectedAppt),
                                                render: (_: any, m: Appt) => {
                                                    const timing = getAttendanceTimingForMember(selectedAppt, m, participantEmails)
                                                    const checkedOut = isGroupMemberCheckedOut(selectedAppt, m, participantEmails)

                                                    return (
                                                        <Space direction="vertical" size={2}>
                                                            {checkedOut ? <Tag color="default">Checked Out</Tag> : <Tag color="gold">Not Out</Tag>}
                                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                                {timing.checkOutTime}
                                                            </Text>
                                                        </Space>
                                                    )
                                                }
                                            },
                                            {
                                                title: 'Time Spent',
                                                key: 'timeSpent',
                                                width: 120,
                                                hidden: !hasQrAttendance(selectedAppt),
                                                render: (_: any, m: Appt) => {
                                                    const timing = getAttendanceTimingForMember(selectedAppt, m, participantEmails)

                                                    return (
                                                        <Text strong>
                                                            {formatMinutesSpent(timing.minutesSpent)}
                                                        </Text>
                                                    )
                                                }
                                            },
                                            {
                                                title: 'Action',
                                                key: 'action',
                                                width: 140,
                                                hidden: !hasQrAttendance(selectedAppt),
                                                fixed: screens.md ? 'right' : undefined,
                                                render: (_: any, m: Appt) => {
                                                    const checkedIn = isGroupMemberCheckedIn(selectedAppt, m, participantEmails)
                                                    const checkedOut = isGroupMemberCheckedOut(selectedAppt, m, participantEmails)

                                                    const targetEmail = String(
                                                        participantEmails[m.participantId] ||
                                                        m.participantEmail ||
                                                        ''
                                                    )
                                                        .trim()
                                                        .toLowerCase()

                                                    const loadingKey = `${selectedAppt?.id}-${targetEmail}`

                                                    return (
                                                        <Button
                                                            size="small"
                                                            shape="round"
                                                            icon={<LogoutOutlined />}
                                                            disabled={!checkedIn || checkedOut || !selectedAppt}
                                                            loading={checkoutLoading === loadingKey}
                                                            onClick={() => selectedAppt && checkOutParticipant(selectedAppt, m)}
                                                        >
                                                            Check Out
                                                        </Button>
                                                    )
                                                }
                                            }
                                        ]}
                                    />
                                </Space>
                            </>
                        ) : null}

                        {detailModalTab === 'food' && hasConfiguredFoodMenu(selectedAppt) ? (
                            <>
                                <Divider style={{ margin: '14px 0' }} />

                                <Space direction='vertical' style={{ width: '100%' }} size={10}>
                                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                        <Text strong>Food Menu</Text>
                                        {canManageFoodMenu(selectedAppt) ? (
                                            <Button
                                                size={screens.md ? 'middle' : 'small'}
                                                shape='round'
                                                icon={<BookOutlined />}
                                                onClick={() => openFoodMenu(selectedAppt)}
                                            >
                                                Manage Menu
                                            </Button>
                                        ) : (
                                            <Tag color='default'>Menu locked</Tag>
                                        )}
                                    </Space>

                                    {selectedAppt.foodMenuEnabled && normalizeFoodMenuItems(selectedAppt.foodMenu).length ? (
                                        <Table
                                            rowKey='id'
                                            size='small'
                                            pagination={false}
                                            dataSource={normalizeFoodMenuItems(selectedAppt.foodMenu)}
                                            columns={[
                                                {
                                                    title: 'Item',
                                                    dataIndex: 'name',
                                                    key: 'name',
                                                    width: 140,
                                                    render: (name: string, item: FoodMenuItem) => (
                                                        <Space direction='vertical' size={0}>
                                                            <Text strong>{name}</Text>
                                                            {item.description ? (
                                                                <Text type='secondary' style={{ fontSize: 12 }}>
                                                                    {item.description}
                                                                </Text>
                                                            ) : null}
                                                        </Space>
                                                    )
                                                },
                                                {
                                                    title: 'Category',
                                                    dataIndex: 'category',
                                                    key: 'category',
                                                    width: 120,
                                                    render: (category: FoodCategory) => <Tag>{getFoodCategoryLabel(category)}</Tag>
                                                },
                                                {
                                                    title: 'Dietary Note',
                                                    dataIndex: 'dietaryNote',
                                                    key: 'dietaryNote',
                                                    width: 180,
                                                    hidden: !normalizeFoodMenuItems(selectedAppt.foodMenu).some(item =>
                                                        Boolean(String(item.dietaryNote || '').trim())
                                                    ),
                                                    render: (note: string) => note || <Text type='secondary'>—</Text>
                                                },
                                                {
                                                    title: 'Qty',
                                                    dataIndex: 'quantityAvailable',
                                                    key: 'quantityAvailable',
                                                    width: 80,
                                                    render: (qty: number | null, item: FoodMenuItem) => (
                                                        <Space size={4}>
                                                            <span>{qty ?? '—'}</span>
                                                            <Text type='secondary'>
                                                                ({getFoodSelectionCountForItem(selectedAppt, item)} selected)
                                                            </Text>
                                                        </Space>
                                                    )
                                                }
                                            ]}
                                            scroll={{ x: 640 }}
                                        />
                                    ) : (
                                        <Text type='secondary'>No food menu listed for this appointment yet.</Text>
                                    )}
                                    {getFoodSelectionsForRecord(selectedAppt).length ? (
                                        <Card size='small' title='SME selections'>
                                            <Table
                                                rowKey={(row: FoodSelection, index?: number) =>
                                                    `${row.participantId}-${row.itemId}-${index}`
                                                }
                                                size='small'
                                                pagination={{
                                                    pageSize: 6,
                                                    showSizeChanger: false,
                                                    position: ['bottomCenter']
                                                }}
                                                scroll={{ x: 640 }}
                                                dataSource={getFoodSelectionsForRecord(selectedAppt)}
                                                columns={[
                                                    {
                                                        title: 'SME',
                                                        dataIndex: 'participantName',
                                                        key: 'participantName',
                                                        render: (name: string) => <Text strong>{name || 'SME'}</Text>
                                                    },
                                                    {
                                                        title: 'Type',
                                                        key: 'category',
                                                        width: 110,
                                                        render: (_: any, row: FoodSelection) => (
                                                            <Tag color={String(row.category || row.itemCategory).toLowerCase() === 'drink' ? 'cyan' : 'green'}>
                                                                {getFoodCategoryLabel((row.category || row.itemCategory || 'meal') as FoodCategory)}
                                                            </Tag>
                                                        )
                                                    },
                                                    {
                                                        title: 'Selected Item',
                                                        dataIndex: 'itemName',
                                                        key: 'itemName',
                                                        // Empty rows are filtered out upstream, so a blank
                                                        // name here means the item was deleted from the menu
                                                        // after the SME chose it — say that, rather than
                                                        // inventing a name.
                                                        render: (name: string) => (
                                                            name
                                                                ? <Tag color='blue'>{name}</Tag>
                                                                : <Text type='secondary'>Item no longer on the menu</Text>
                                                        )
                                                    },
                                                ]}
                                            />
                                        </Card>
                                    ) : (
                                        <Text type='secondary'>No SME food selections captured yet.</Text>
                                    )}
                                </Space>
                            </>
                        ) : null}

                        {detailModalTab === 'overview' && hasQrAttendance(selectedAppt) && !isApptDone(selectedAppt) ? (
                            <>
                                <Divider style={{ margin: '14px 0' }} />

                                <Space direction='vertical' style={{ width: '100%' }} size={10}>
                                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                        <Text strong>QR Attendance</Text>

                                        {selectedAppt &&
                                            canStartQrWindow(selectedAppt) &&
                                            derivedStatus(selectedAppt) !== 'completed' &&
                                            derivedStatus(selectedAppt) !== 'cancelled' &&
                                            derivedStatus(selectedAppt) !== 'postponed' &&
                                            derivedStatus(selectedAppt) !== 'awaiting_coverage' &&
                                            !isQrSessionActive(selectedAppt) ? (
                                            <Button
                                                size={screens.md ? 'middle' : 'small'}
                                                shape='round'
                                                icon={<QrcodeOutlined />}
                                                loading={qrLoading}
                                                onClick={() => startQrSession(selectedAppt)}
                                            >
                                                Start QR
                                            </Button>
                                        ) : null}

                                        {selectedAppt && isQrSessionActive(selectedAppt) ? (
                                            <Button
                                                size={screens.md ? 'middle' : 'small'}
                                                shape='round'
                                                icon={<QrcodeOutlined />}
                                                onClick={() => openQrModal(selectedAppt)}
                                            >
                                                Show QR
                                            </Button>
                                        ) : null}
                                    </Space>

                                    {selectedAppt && isQrSessionActive(selectedAppt) ? (
                                        <Alert
                                            type='success'
                                            showIcon
                                            message='QR attendance is active'
                                            description='Participants can scan with their phone camera to open the meeting check-in page.'
                                        />
                                    ) : (
                                        <Text type='secondary'>
                                            QR attendance becomes available 15 minutes before the meeting and stays active until closed or expired.
                                        </Text>
                                    )}
                                </Space>
                            </>
                        ) : null}

                        {detailModalTab === 'overview' && <Divider style={{ margin: '14px 0' }} />}

                        {detailModalTab === 'overview' && <Space direction='vertical' style={{ width: '100%' }} size={10}>
                            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                <Text strong>Meeting Coverage</Text>

                                {isApptDone(selectedAppt) ? (
                                    <Button
                                        size={screens.md ? 'middle' : 'small'}
                                        shape='round'
                                        danger={!selectedAppt.sessionCoverage?.latest}
                                        color={selectedAppt.sessionCoverage?.latest ? 'green' : undefined}
                                        variant='filled'
                                        style={selectedAppt.sessionCoverage?.latest ? { border: '1px solid green' } : undefined}
                                        icon={selectedAppt.sessionCoverage?.latest ? <EyeOutlined /> : <CheckCircleOutlined />}
                                        onClick={() => openCoverage(selectedAppt)}
                                    >
                                        {selectedAppt.sessionCoverage?.latest ? 'View Coverage' : 'Add Coverage'}
                                    </Button>
                                ) : (
                                    <Tag color='gold'>Available after meeting</Tag>
                                )}
                            </Space>

                            {(selectedAppt as any)?.sessionCoverage?.latest ? (
                                <div style={{ background: '#fafafa', borderRadius: 10, padding: 12 }}>
                                    {(() => {
                                        const latest = (selectedAppt as any).sessionCoverage.latest as SessionCoverageEntry
                                        if (!latest.held) {
                                            return (
                                                <>
                                                    <Tag color='red'>NOT HELD</Tag>
                                                    <div style={{ marginTop: 8 }}>
                                                        <Text type='secondary'>
                                                            <b>Reason:</b> {latest.reasonNotHeld || '-'}
                                                        </Text>
                                                    </div>
                                                </>
                                            )
                                        }
                                        return (
                                            <>
                                                <Space wrap>
                                                    <Tag color='green'>HELD</Tag>
                                                    <Tag color={latest.smeAttendance === 'no_show' ? 'red' : latest.smeAttendance === 'unverified' || !latest.smeAttendance ? 'gold' : 'blue'}>
                                                        SME: {smeAttendanceLabel(getSmeAttendanceOutcome(selectedAppt))}
                                                    </Tag>
                                                    <Text strong>{latest.title || selectedAppt.sessionTitle || selectedAppt.interventionTitle}</Text>
                                                </Space>

                                                {latest.smeAttendance === 'no_show' || latest.smeAttendance === 'unverified' ? (
                                                    <div style={{ marginTop: 8 }}>
                                                        <Text type='secondary'>
                                                            <b>Attendance notes:</b> {latest.notes || '-'}
                                                        </Text>
                                                    </div>
                                                ) : latest.notes || latest.coveredPoints?.length ? (
                                                    <div style={{ marginTop: 8 }}>
                                                        <Text>
                                                            {latest.notes || latest.coveredPoints?.join('; ')}
                                                        </Text>
                                                        {latest.coveredPoints?.some(point =>
                                                            norm(point) !== norm(latest.notes)
                                                        ) ? (
                                                            <Space wrap style={{ display: 'flex', marginTop: 8 }}>
                                                                {latest.coveredPoints.map(point => (
                                                                    <Tag key={point} color='blue'>{point}</Tag>
                                                                ))}
                                                            </Space>
                                                        ) : null}
                                                    </div>
                                                ) : (
                                                    <Text type='secondary'>No coverage summary captured.</Text>
                                                )}
                                            </>
                                        )
                                    })()}
                                    <div style={{ marginTop: 10 }}><CoveragePhotoGallery row={selectedAppt} /></div>
                                </div>
                            ) : (
                                <Text type='secondary'>No coverage added yet.</Text>
                            )}
                        </Space>}
                    </>
                ) : (
                    <Text type='secondary'>No appointment selected.</Text>
                )}
            </Modal>

            <SessionReviewModal
                open={monthReviewOpen}
                onClose={() => setMonthReviewOpen(false)}
                reviewRange={reviewRange}
                reviewDate={reviewDate}
                onRangeChange={setReviewRange}
                onDateChange={value => setReviewDate(value || dayjs())}
                groupedDisplayAppointments={groupedDisplayAppointments}
                derivedStatus={derivedStatus as any}
                getDisplayRowMembers={getDisplayRowMembers as any}
                getAttendanceCounts={getAttendanceCounts as any}
                isMemberCheckedIn={isMemberCheckedIn as any}
                deliveryMethods={DELIVERY_METHODS.map(({ label, value }) => ({ label, value }))}
            />



            <Modal
                centered
                title={foodMenuRecord ? `Food Menu — ${foodMenuRecord.interventionTitle}` : 'Food Menu'}
                open={foodMenuModalOpen}
                onCancel={closeFoodMenuModal}
                onOk={foodMenuTab === 'setup' ? () => foodMenuForm.submit() : undefined}
                okText='Save Food Menu'
                confirmLoading={savingFoodMenu}
                okButtonProps={{ style: { display: foodMenuTab === 'setup' && canManageFoodMenu(foodMenuRecord) ? undefined : 'none' } }}
                width={screens.lg ? 900 : screens.md ? 760 : '100%'}
                style={screens.md ? undefined : { maxWidth: '100vw' }}
                destroyOnClose
            >
                {foodMenuRecord ? (
                    <Space direction='vertical' size={12} style={{ width: '100%' }}>
                        <Alert
                            type='info'
                            showIcon
                            message={canManageFoodMenu(foodMenuRecord) ? 'List what SMEs can choose for this meeting.' : 'Food menu for this appointment'}
                            description={
                                !canManageFoodMenu(foodMenuRecord)
                                    ? 'This appointment has passed, so the menu is shown as read-only.'
                                    : Array.isArray((foodMenuRecord as any)?._groupMembers)
                                        ? 'This menu will be saved to every appointment in this grouped session so each SME sees the same choices.'
                                        : 'This menu will be saved to this appointment so the SME can choose from the listed items.'
                            }
                        />

                        <Descriptions bordered size='small' column={screens.md ? 2 : 1}>
                            <Descriptions.Item label='Date'>
                                {dayjs(foodMenuRecord.date).format('YYYY-MM-DD')}
                            </Descriptions.Item>
                            <Descriptions.Item label='Time'>
                                {formatTime(foodMenuRecord.startTime)} — {formatTime(foodMenuRecord.endTime)}
                            </Descriptions.Item>
                            <Descriptions.Item label='Session'>
                                {foodMenuRecord.sessionTitle || foodMenuRecord.interventionTitle}
                            </Descriptions.Item>
                            <Descriptions.Item label='Participants'>
                                {Array.isArray((foodMenuRecord as any)?._groupMembers)
                                    ? `${(foodMenuRecord as any)._groupMembers.length} SMEs`
                                    : foodMenuRecord.participantName}
                            </Descriptions.Item>
                        </Descriptions>

                        <Segmented
                            block
                            value={foodMenuTab}
                            onChange={value => setFoodMenuTab(value as 'setup' | 'selections')}
                            options={[
                                { label: 'Menu Setup', value: 'setup' },
                                {
                                    label: `SME Choices (${getFoodSelectionsForRecord(foodMenuRecord).length})`,
                                    value: 'selections'
                                }
                            ]}
                        />

                        {foodMenuTab === 'setup' ? (
                            <Form
                                layout='vertical'
                                form={foodMenuForm}
                                onFinish={saveFoodMenu}
                                disabled={!canManageFoodMenu(foodMenuRecord)}
                            >
                                <Form.Item name='foodMenuEnabled' valuePropName='checked'>
                                    <Checkbox>Allow SMEs to select a food option for this appointment</Checkbox>
                                </Form.Item>

                                <Form.List name='foodMenu'>
                                    {(fields, { add, remove }) => (
                                        <Space direction='vertical' style={{ width: '100%' }} size={12}>
                                            {fields.map(field => (
                                                <Card
                                                    key={field.key}
                                                    size='small'
                                                    title={`Menu Item ${field.name + 1}`}
                                                    extra={
                                                        canManageFoodMenu(foodMenuRecord) && fields.length > 1 ? (
                                                            <Button danger size='small' onClick={() => remove(field.name)}>
                                                                Remove
                                                            </Button>
                                                        ) : null
                                                    }
                                                >
                                                    <Form.Item name={[field.name, 'id']} hidden>
                                                        <Input />
                                                    </Form.Item>

                                                    <Row gutter={[12, 0]}>
                                                        <Col xs={24} md={12}>
                                                            <Form.Item
                                                                name={[field.name, 'name']}
                                                                label='Food / Drink Item'
                                                                rules={[{ required: true, message: 'Add the food item name.' }]}
                                                            >
                                                                <Input placeholder='e.g. Chicken wrap, vegetarian sandwich, bottled water' />
                                                            </Form.Item>
                                                        </Col>

                                                        <Col xs={24} md={6}>
                                                            <Form.Item
                                                                name={[field.name, 'category']}
                                                                label='Category'
                                                                rules={[{ required: true, message: 'Select category.' }]}
                                                            >
                                                                <Select options={FOOD_CATEGORY_OPTIONS} />
                                                            </Form.Item>
                                                        </Col>

                                                        <Col xs={24} md={6}>
                                                            <Form.Item name={[field.name, 'quantityAvailable']} label='Quantity'>
                                                                <Input type='number' min={0} placeholder='Optional' />
                                                            </Form.Item>
                                                        </Col>

                                                        <Col xs={24} md={12}>
                                                            <Form.Item name={[field.name, 'dietaryNote']} label='Dietary Note'>
                                                                <Input placeholder='e.g. Halal, vegetarian, contains nuts, sugar-free' />
                                                            </Form.Item>
                                                        </Col>

                                                        <Col xs={24} md={12}>
                                                            <Form.Item name={[field.name, 'description']} label='Description'>
                                                                <Input placeholder='Optional extra details' />
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>
                                                </Card>
                                            ))}

                                            {canManageFoodMenu(foodMenuRecord) ? (
                                                <Button
                                                    block
                                                    icon={<PlusOutlined />}
                                                    onClick={() =>
                                                        add({
                                                            id: makeFoodMenuItemId(),
                                                            name: '',
                                                            category: 'meal',
                                                            description: '',
                                                            dietaryNote: '',
                                                            quantityAvailable: null
                                                        })
                                                    }
                                                >
                                                    Add Menu Item
                                                </Button>
                                            ) : null}
                                        </Space>
                                    )}
                                </Form.List>
                            </Form>
                        ) : getFoodSelectionsForRecord(foodMenuRecord).length > 0 ? (
                            <Card size='small' title='SME Food Choices'>
                                <Table
                                    rowKey={(row: FoodSelection, index?: number) => `${row.participantId}-${row.itemId}-${index}`}
                                    size='small'
                                    pagination={{ pageSize: 6, showSizeChanger: false }}
                                    scroll={{ x: 640 }}
                                    dataSource={getFoodSelectionsForRecord(foodMenuRecord)}
                                    columns={[
                                        {
                                            title: 'SME',
                                            dataIndex: 'participantName',
                                            key: 'participantName',
                                            render: (name: string, row: FoodSelection) => (
                                                <Space direction='vertical' size={0}>
                                                    <Text strong>{name || '-'}</Text>
                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                        {row.participantEmail || 'No email on file'}
                                                    </Text>
                                                </Space>
                                            )
                                        },
                                        {
                                            title: 'Type',
                                            key: 'category',
                                            width: 110,
                                            render: (_: any, row: FoodSelection) => (
                                                <Tag color={String(row.category || row.itemCategory).toLowerCase() === 'drink' ? 'cyan' : 'green'}>
                                                    {getFoodCategoryLabel((row.category || row.itemCategory || 'meal') as FoodCategory)}
                                                </Tag>
                                            )
                                        },
                                        {
                                            title: 'Selected Item',
                                            dataIndex: 'itemName',
                                            key: 'itemName',
                                            render: (name: string) => <Tag color='blue'>{name}</Tag>
                                        },
                                    ]}
                                />
                            </Card>
                        ) : (
                            <Empty description='No SME food choices captured yet.' />
                        )}
                    </Space>
                ) : (
                    <Text type='secondary'>No appointment selected.</Text>
                )}
            </Modal>

            <Modal
                centered
                title='Attendance QR'
                open={qrModalOpen}
                onCancel={closeQrModal}
                footer={
                    qrRecord
                        ? [
                            qrRecord.attendanceSession?.qrUrl ? (
                                <Button
                                    key='copy-link'
                                    icon={<LinkOutlined />}
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(qrRecord.attendanceSession?.qrUrl || '')
                                            message.success('Check-in link copied.')
                                        } catch {
                                            message.error('Failed to copy link.')
                                        }
                                    }}
                                >
                                    Copy Link
                                </Button>
                            ) : null,
                            qrRecord.attendanceSession?.qrUrl ? (
                                <Button
                                    key='open-link'
                                    icon={<LinkOutlined />}
                                    onClick={() =>
                                        window.open(
                                            qrRecord.attendanceSession?.qrUrl,
                                            '_blank',
                                            'noopener,noreferrer'
                                        )
                                    }
                                >
                                    Open Link
                                </Button>
                            ) : null,
                            isQrSessionActive(qrRecord) ? (
                                <Button
                                    key='close-qr'
                                    danger
                                    icon={<StopOutlined />}
                                    loading={qrLoading}
                                    onClick={() => closeQrSession(qrRecord)}
                                >
                                    Close QR
                                </Button>
                            ) : null,
                            <Button key='done' type='primary' onClick={closeQrModal}>
                                Done
                            </Button>
                        ].filter(Boolean)
                        : null
                }
                destroyOnClose
            >
                {qrRecord ? (
                    <Space direction='vertical' size={16} style={{ width: '100%' }}>
                        <Alert
                            type={isQrSessionActive(qrRecord) ? 'success' : 'warning'}
                            showIcon
                            message={
                                isQrSessionActive(qrRecord)
                                    ? 'Participants can scan this with a normal phone camera.'
                                    : 'This QR session is not active.'
                            }
                        />
                        <Segmented
                            block
                            value={qrModalTab}
                            onChange={value => setQrModalTab(value as 'overview' | 'attendance' | 'code')}
                            options={[
                                { label: 'Overview', value: 'overview' },
                                { label: `Attendance (${getAttendanceCounts(qrRecord).checkedIn}/${getAttendanceCounts(qrRecord).total})`, value: 'attendance' },
                                { label: 'QR Code', value: 'code' }
                            ]}
                        />

                        {qrModalTab === 'code' && <div
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                padding: '12px 0'
                            }}
                        >
                            {qrRecord.attendanceSession?.qrUrl ? (
                                <QRCode
                                    value={qrRecord.attendanceSession.qrUrl}
                                    size={220}
                                    errorLevel='M'
                                    status={isQrSessionActive(qrRecord) ? 'active' : 'expired'}
                                />
                            ) : (
                                <Text type='secondary'>No QR available.</Text>
                            )}
                        </div>}
                        {qrModalTab === 'overview' && <Descriptions bordered size='small' column={1}>
                            {(qrRecord as any)?._displayType === 'group' ? (
                                <>
                                    <Descriptions.Item label='Group Participants'>
                                        <Tag color='purple'>
                                            {Array.isArray((qrRecord as any)?._groupMembers)
                                                ? `${(qrRecord as any)._groupMembers.length} SME(s)`
                                                : qrRecord.participantName || '-'}
                                        </Tag>
                                    </Descriptions.Item>

                                </>
                            ) : (
                                <>
                                    <Descriptions.Item label='Participant'>
                                        {qrRecord.participantName || '-'}
                                    </Descriptions.Item>

                                </>
                            )}

                            <Descriptions.Item label='Intervention'>
                                {qrRecord.interventionTitle || '-'}
                            </Descriptions.Item>

                            <Descriptions.Item label='Date'>
                                {dayjs(qrRecord.date).format('YYYY-MM-DD')}
                            </Descriptions.Item>

                            <Descriptions.Item label='Time'>
                                {formatTime(qrRecord.startTime)} — {formatTime(qrRecord.endTime)}
                            </Descriptions.Item>

                            <Descriptions.Item label='RSVP Confirmed'>
                                {getAttendanceCounts(qrRecord).confirmed}/{getAttendanceCounts(qrRecord).total}
                            </Descriptions.Item>

                            <Descriptions.Item label='Checked In'>
                                {getAttendanceCounts(qrRecord).checkedIn}/{getAttendanceCounts(qrRecord).total}
                            </Descriptions.Item>

                            {/* Measured against arrivals, not invitations — see the
                                overview tiles. Someone who never arrived cannot
                                check out, so the invite list is the wrong whole. */}
                            <Descriptions.Item label='Checked Out'>
                                {getAttendanceCounts(qrRecord).checkedOut}/{getAttendanceCounts(qrRecord).checkedIn}
                            </Descriptions.Item>

                            <Descriptions.Item label='Still Present'>
                                {getAttendanceCounts(qrRecord).currentlyPresent}
                            </Descriptions.Item>
                        </Descriptions>}
                        {qrModalTab === 'attendance' && (
                            <List
                                size='small'
                                bordered
                                dataSource={getDisplayRowMembers(qrRecord)}
                                locale={{ emptyText: 'No participants found.' }}
                                renderItem={member => {
                                    const checkedInAt = toDateSafe((member as any)?.attendance?.checkedInAt)
                                    const checkedOutAt = toDateSafe((member as any)?.attendance?.checkedOutAt)
                                    const checkedIn = isMemberCheckedIn(qrRecord, member)
                                    return (
                                        <List.Item>
                                            <List.Item.Meta
                                                title={member.participantName || 'Unnamed SME'}
                                                description={checkedInAt
                                                    ? `Checked in ${dayjs(checkedInAt).format('HH:mm')}${checkedOutAt ? ` · out ${dayjs(checkedOutAt).format('HH:mm')}` : ''}`
                                                    : 'Not checked in'}
                                            />
                                            <Tag color={checkedOutAt ? 'default' : checkedIn ? 'green' : 'gold'}>
                                                {checkedOutAt ? 'Checked out' : checkedIn ? 'Checked in' : 'Not checked in'}
                                            </Tag>
                                        </List.Item>
                                    )
                                }}
                                style={{ maxHeight: 420, overflowY: 'auto' }}
                            />
                        )}

                    </Space>
                ) : (
                    <Text type='secondary'>No appointment selected.</Text>
                )}
            </Modal>

            <Modal
                centered
                open={Boolean(completionPrompt)}
                title={null}
                closable={false}
                maskClosable={false}
                keyboard={false}
                width={680}
                footer={
                    <Row gutter={[12, 12]}>
                        <Col xs={24} sm={10}>
                            <Button
                                block
                                onClick={() => {
                                    if (appointmentCompletionStep === 1) {
                                        setAppointmentCompletionStep(0)
                                        setAppointmentCompletionFailureMessage('')
                                        appointmentCompletionForm.resetFields()
                                    } else {
                                        void continueAppointmentDelivery()
                                    }
                                }}
                                loading={savingAppointmentCompletion}
                            >
                                {appointmentCompletionStep === 1 ? 'Back' : 'Continue working'}
                            </Button>
                        </Col>
                        <Col xs={24} sm={14}>
                            <Button
                                block
                                type='primary'
                                icon={<CheckCircleOutlined />}
                                loading={savingAppointmentCompletion}
                                onClick={() =>
                                    appointmentCompletionStep === 0
                                        ? void openAppointmentCompletionEvidence()
                                        : appointmentCompletionForm.submit()
                                }
                            >
                                {appointmentCompletionStep === 0
                                    ? 'Continue to completion'
                                    : 'Complete intervention'}
                            </Button>
                        </Col>
                    </Row>
                }
            >
                <Steps
                    current={appointmentCompletionStep}
                    size='small'
                    items={[
                        { title: 'Review' },
                        { title: 'Evidence & completion' }
                    ]}
                    style={{ marginBottom: 20 }}
                />
                {appointmentCompletionStep === 0 ? (
                    <>
                        <style>{`
                    @keyframes completionRibbonFall {
                        0% { transform: translateY(-32px) rotate(0deg); opacity: 0; }
                        18% { opacity: 1; }
                        100% { transform: translateY(245px) rotate(250deg); opacity: 0; }
                    }
                `}</style>
                        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 16 }}>
                            {['#1677ff', '#52c41a', '#faad14', '#722ed1', '#eb2f96', '#13c2c2'].flatMap(
                                (color, colorIndex) => [0, 1].map(copy => (
                                    <span
                                        key={`${color}-${copy}`}
                                        aria-hidden='true'
                                        style={{
                                            position: 'absolute',
                                            zIndex: 0,
                                            top: -26,
                                            left: `${7 + colorIndex * 15 + copy * 5}%`,
                                            width: 8,
                                            height: 20,
                                            borderRadius: 3,
                                            background: color,
                                            animation: `completionRibbonFall ${2.2 + copy * 0.45}s ease-in ${colorIndex * 0.12}s infinite`
                                        }}
                                    />
                                ))
                            )}

                            <div style={{ position: 'relative', zIndex: 1, padding: '8px 6px 4px' }}>
                                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                                    <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
                                    <Title level={3} style={{ margin: '10px 0 4px' }}>
                                        Intervention progress reached 100%
                                    </Title>
                                    <Text type='secondary'>
                                        {completionPrompt?.interventionTitle}
                                    </Text>
                                </div>

                                <Progress
                                    percent={100}
                                    status='success'
                                    strokeWidth={12}
                                    format={() => '100%'}
                                />
                                <Text type='secondary' style={{ display: 'block', textAlign: 'center' }}>
                                    {completionPrompt?.sessionsCompleted || 0}/{completionPrompt?.plannedSessions || 1} planned sessions attended
                                </Text>

                                <Row gutter={[12, 12]} style={{ marginTop: 18 }}>
                                    {[
                                        ['1', 'Review the carried-forward session notes and photos.'],
                                        ['2', 'Add the required evidence or completion summary.'],
                                        ['3', 'Confirm delivery details to create the MOV and request SME confirmation.']
                                    ].map(([step, text]) => (
                                        <Col xs={24} sm={8} key={step}>
                                            <Card size='small' style={{ height: '100%', background: '#f7faff' }}>
                                                <Tag color='blue' style={{ marginBottom: 8 }}>Step {step}</Tag>
                                                <Paragraph style={{ marginBottom: 0 }}>{text}</Paragraph>
                                            </Card>
                                        </Col>
                                    ))}
                                </Row>

                                <Alert
                                    type='warning'
                                    showIcon
                                    style={{ marginTop: 16 }}
                                    message='Reaching 100% does not close the intervention automatically.'
                                    description='Continue when the work is genuinely complete and ready for final evidence and SME confirmation. Choose “Continue working” if more delivery is still needed.'
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    <Form
                        form={appointmentCompletionForm}
                        layout='vertical'
                        onFinish={submitAppointmentCompletion}
                        onFinishFailed={({ errorFields }) => message.warning(errorFields[0]?.errors?.[0] || 'Check the required completion fields.')}
                        scrollToFirstError
                    >
                        <Card size='small' style={{ marginBottom: 16, borderRadius: 12 }}>
                            <Text type='secondary'>Delivery method from appointment</Text>
                            <br />
                            <Text strong>
                                {DELIVERY_METHODS.find(
                                    method => method.value === completionPrompt?.deliveryMethod
                                )?.label || titleCase(completionPrompt?.deliveryMethod || '')}
                            </Text>
                        </Card>

                        <InterventionCompletionFields
                            context={appointmentCompletionContext}
                            failureMessage={appointmentCompletionFailureMessage}
                        />
                    </Form>
                )}
            </Modal>

            <Modal
                className="guide-coverage-modal"
                centered
                title={coverageRecord?.sessionCoverage?.latest && coverageViewMode === 'summary'
                    ? 'Coverage saved'
                    : coverageRecord?.sessionCoverage?.latest
                        ? 'Update meeting coverage'
                        : 'Add meeting coverage'}
                open={coverageModalOpen}
                onOk={coverageViewMode === 'summary'
                    ? () => setCoverageViewMode('edit')
                    : () => coverageForm.submit()}
                okText={coverageViewMode === 'summary' ? 'Edit Coverage' : coverageRecord?.sessionCoverage?.latest ? 'Save Update' : 'Save Coverage'}
                okButtonProps={{
                    className: 'guide-coverage-submit',
                    icon: coverageViewMode === 'summary' ? <EditOutlined /> : <CheckCircleOutlined />
                }}
                cancelText={coverageViewMode === 'summary' ? 'Close' : 'Cancel'}
                onCancel={() => { if (!savingCoverageRef.current) closeCoverageModal() }}
                closable={!savingCoverage}
                maskClosable={!savingCoverage}
                keyboard={!savingCoverage}
                cancelButtonProps={{ disabled: savingCoverage }}
                confirmLoading={savingCoverage}
                destroyOnClose
            >
                {coverageRecord && !isApptDone(coverageRecord) ? (
                    <Alert
                        type='info'
                        showIcon
                        message='Coverage is available after the meeting ends.'
                        style={{ marginBottom: 12 }}
                    />
                ) : null}

                {coverageViewMode === 'summary' && coverageRecord?.sessionCoverage?.latest ? (
                    <div>
                        <Alert
                            type='success'
                            showIcon
                            message='Coverage saved successfully.'
                            style={{ marginBottom: 16 }}
                        />

                        {(() => {
                            const latest = coverageRecord.sessionCoverage?.latest as SessionCoverageEntry
                            const appointmentAttendance = String(coverageRecord.attendance?.status || '').toLowerCase()
                            const displayedSmeAttendance =
                                latest.smeAttendance && latest.smeAttendance !== 'unverified'
                                    ? latest.smeAttendance
                                    : appointmentAttendance === 'attended'
                                        ? 'attended'
                                        : appointmentAttendance === 'absent'
                                            ? 'no_show'
                                            : 'unverified'
                            const participated = displayedSmeAttendance === 'attended' || displayedSmeAttendance === 'partially_attended'
                            const linkedAssignment = assignedInterventions.find(
                                assignment => String(assignment?.id || '') === String(coverageRecord.assignedInterventionId || '')
                            )
                            const isReadyForCompletion = Boolean(
                                latest.completionRequired ||
                                (participated &&
                                    Number(linkedAssignment?.tracking?.sessionsLogged || 0) >=
                                    Math.max(1, Number(linkedAssignment?.plannedSessions) || 1))
                            )
                            const savedAt = toDateSafe(latest.createdAt)

                            return (
                                <Space direction='vertical' size={16} style={{ width: '100%' }}>
                                    <Card size='small' style={{ borderColor: latest.held ? '#b7eb8f' : '#ffccc7' }}>
                                        <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                            <Space wrap>
                                                <Tag color={latest.held ? 'green' : 'red'}>{latest.held ? 'SESSION HELD' : 'SESSION NOT HELD'}</Tag>
                                                {latest.held ? (
                                                    <Tag color={participated ? 'blue' : displayedSmeAttendance === 'no_show' ? 'red' : 'gold'}>
                                                        SME: {smeAttendanceLabel(displayedSmeAttendance)}
                                                    </Tag>
                                                ) : null}
                                            </Space>
                                            <Typography.Title level={5} style={{ margin: 0 }}>
                                                {latest.title || coverageRecord.sessionTitle || coverageRecord.interventionTitle}
                                            </Typography.Title>
                                            {savedAt ? (
                                                <Text type='secondary'>Saved {dayjs(savedAt).format('DD MMM YYYY, HH:mm')}{latest.createdByName ? ` by ${latest.createdByName}` : ''}</Text>
                                            ) : null}
                                        </Space>
                                    </Card>

                                    {isReadyForCompletion ? (
                                        <Card size='small'>
                                            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                                                <div>
                                                    <Tag color='gold'>Ready for completion</Tag>
                                                    <Text type='secondary'>Finish the completion checks and MOV setup, or add another session.</Text>
                                                </div>
                                                <Button
                                                    type='primary'
                                                    onClick={() => {
                                                        const assignmentIds = latest.completionAssignmentIds?.length
                                                            ? latest.completionAssignmentIds
                                                            : [String(coverageRecord.assignedInterventionId || '')].filter(Boolean)
                                                        setCompletionPrompt({
                                                            assignmentId: assignmentIds[0],
                                                            assignmentIds,
                                                            groupKey: latest.completionGroupKey,
                                                            appointmentId: coverageRecord.id,
                                                            interventionTitle:
                                                                coverageRecord.interventionTitle ||
                                                                latest.title ||
                                                                'Intervention',
                                                            sessionsCompleted: Number(linkedAssignment?.tracking?.sessionsLogged || 0),
                                                            plannedSessions: Math.max(1, Number(linkedAssignment?.plannedSessions) || 1),
                                                            deliveryMethod: deriveCompletionDelivery(assignmentIds, coverageRecord)
                                                        })
                                                        setAppointmentCompletionStep(0)
                                                        closeCoverageModal()
                                                    }}
                                                >
                                                    Complete Intervention
                                                </Button>
                                            </Space>
                                        </Card>
                                    ) : null}

                                    {latest.held && latest.attendanceByParticipant?.length ? (
                                        <div>
                                            <Text strong>Attendance by SME</Text>
                                            <Table
                                                rowKey='participantId'
                                                size='small'
                                                style={{ marginTop: 6 }}
                                                dataSource={latest.attendanceByParticipant}
                                                pagination={{ pageSize: COVERAGE_ATTENDANCE_PAGE_SIZE, showSizeChanger: false, hideOnSinglePage: true, position: ['bottomCenter'] }}
                                                columns={[
                                                    {
                                                        title: 'SME', dataIndex: 'participantName',
                                                        render: (name: string, item: any) => (
                                                            <Space direction='vertical' size={0}>
                                                                <Text strong>{name || 'Unnamed SME'}</Text>
                                                                {item.participantEmail ? <Text type='secondary'>{item.participantEmail}</Text> : null}
                                                            </Space>
                                                        )
                                                    },
                                                    {
                                                        title: 'Attendance', dataIndex: 'outcome', width: 135,
                                                        render: (outcome: string) => (
                                                            <Tag color={outcome === 'attended' ? 'green' : outcome === 'no_show' ? 'red' : 'gold'}>
                                                                {outcome === 'attended' ? 'Attended' : outcome === 'no_show' ? 'No-show' : 'Unverified'}
                                                            </Tag>
                                                        )
                                                    }
                                                ]}
                                            />
                                        </div>
                                    ) : null}

                                    {!latest.held ? (
                                        <Descriptions size='small' column={1} bordered>
                                            <Descriptions.Item label='Reason'>
                                                {latest.notHeldReasonCategory
                                                    ? titleCase(latest.notHeldReasonCategory)
                                                    : '-'}
                                            </Descriptions.Item>
                                            <Descriptions.Item label='Additional details'>{latest.reasonNotHeld || '-'}</Descriptions.Item>
                                        </Descriptions>
                                    ) : participated ? (
                                        <>
                                            <Descriptions size='small' column={1} bordered>
                                                <Descriptions.Item label='Intervention progress'>
                                                    {(() => {
                                                        const pct = Number(linkedAssignment?.computedProgress ?? linkedAssignment?.progress)
                                                        return Number.isFinite(pct) ? `${Math.round(pct)}% (${linkedAssignment?.tracking?.sessionsLogged ?? 0}/${linkedAssignment?.plannedSessions ?? 1} sessions)` : 'Not recorded'
                                                    })()}
                                                </Descriptions.Item>
                                                <Descriptions.Item label='What was covered and achieved'>
                                                    {latest.notes || latest.coveredPoints?.join('; ') || '-'}
                                                </Descriptions.Item>
                                            </Descriptions>
                                            {latest.coveredPoints?.some(point =>
                                                norm(point) !== norm(latest.notes)
                                            ) ? (
                                                <div>
                                                    <Text strong>Formal topics covered</Text>
                                                    <Space wrap style={{ display: 'flex', marginTop: 8 }}>
                                                        {latest.coveredPoints.map(point => (
                                                            <Tag key={point} color='blue'>{point}</Tag>
                                                        ))}
                                                    </Space>
                                                </div>
                                            ) : null}
                                        </>
                                    ) : (
                                        <Descriptions size='small' column={1} bordered>
                                            <Descriptions.Item label='Attendance notes'>{latest.notes || '-'}</Descriptions.Item>
                                        </Descriptions>
                                    )}

                                    <CoveragePhotoGallery row={coverageRecord} />

                                    <Text type='secondary'>Session progress is calculated automatically from recorded SME attendance.</Text>
                                </Space>
                            )
                        })()}
                    </div>
                ) : (
                    <Form data-guide="coverage-form" layout='vertical' form={coverageForm} onFinish={saveCoverage}>
                        {getCoverageAttendanceMode(coverageRecord) === 'manual' ? (
                            <Form.Item
                                name='held'
                                label='Was the session held?'
                                rules={[{ required: true, message: 'Please select yes or no.' }]}
                            >
                                <Select
                                    placeholder='Select'
                                    options={[
                                        { label: 'Yes, it was held', value: 'yes' },
                                        { label: 'No, it was not held', value: 'no' }
                                    ]}
                                />
                            </Form.Item>
                        ) : (
                            <Alert
                                type='success'
                                showIcon
                                message='Held - confirmed via QR attendance'
                                style={{ marginBottom: 16 }}
                            />
                        )}

                        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.held !== cur.held}>
                            {({ getFieldValue }) => {
                                const held = getFieldValue('held') as MeetingHeld | undefined

                                if (held === 'no') {
                                    return (
                                        <>
                                            <Form.Item
                                                name='notHeldReasonCategory'
                                                label='Reason (meeting not held)'
                                                rules={[{ required: true, message: 'Please select a reason.' }]}
                                            >
                                                <Select
                                                    placeholder='Select a reason'
                                                    options={[
                                                        { label: 'No-show', value: 'no-show' },
                                                        { label: 'Cancelled', value: 'cancelled' },
                                                        { label: 'Other', value: 'other' }
                                                    ]}
                                                />
                                            </Form.Item>
                                            <Form.Item
                                                name='reasonNotHeld'
                                                label='Additional details (optional)'
                                            >
                                                <Input.TextArea rows={3} placeholder='e.g. Participant unavailable, network issues, etc.' />
                                            </Form.Item>
                                        </>
                                    )
                                }

                                return (
                                    <>
                                        <Form.Item name='title' label='Session Title'>
                                            <Input disabled />
                                        </Form.Item>

                                        {(coverageRecord as any)?._displayType === 'group' && Array.isArray((coverageRecord as any)?._groupMembers) ? (
                                            <div style={{ marginBottom: 20 }}>
                                                <Space direction='vertical' size={8} style={{ width: '100%', marginBottom: 10 }}>
                                                    <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                                                        <Text strong>Attendance by SME</Text>
                                                        {getCoverageAttendanceMode(coverageRecord) === 'manual' ? (
                                                            <Button
                                                                size='small'
                                                                icon={<CheckCircleOutlined />}
                                                                onClick={() => {
                                                                    const members = ((coverageRecord as any)?._groupMembers || []) as Appt[]

                                                                    const allAttended = members.reduce<
                                                                        Record<string, IndividualSmeAttendanceOutcome>
                                                                    >((result, member) => {
                                                                        result[member.id] = 'attended'
                                                                        return result
                                                                    }, {})

                                                                    coverageForm.setFieldsValue({
                                                                        participantAttendance: allAttended
                                                                    })
                                                                }}
                                                            >
                                                                Mark All Attended
                                                            </Button>
                                                        ) : null}
                                                    </Space>
                                                    {getCoverageAttendanceMode(coverageRecord) === 'manual' ? (
                                                        <Text type='secondary'>QR check-ins are pre-filled and can be corrected.</Text>
                                                    ) : null}
                                                </Space>
                                                <Table<Appt>
                                                    rowKey='id'
                                                    size='small'
                                                    dataSource={(coverageRecord as any)._groupMembers as Appt[]}
                                                    pagination={{
                                                        current: coverageAttendancePage,
                                                        pageSize: COVERAGE_ATTENDANCE_PAGE_SIZE,
                                                        showSizeChanger: false,
                                                        hideOnSinglePage: true,
                                                        position: ['bottomCenter'],
                                                        onChange: setCoverageAttendancePage
                                                    }}
                                                    scroll={{ x: 480 }}
                                                    columns={[
                                                        {
                                                            title: 'SME', key: 'participant',
                                                            render: (_: unknown, member: Appt) => (
                                                                <Space direction='vertical' size={0}>
                                                                    <Text strong>{member.participantName || 'Unnamed SME'}</Text>
                                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                                        {participantEmails[member.participantId] || member.participantEmail || 'No email on file'}
                                                                    </Text>
                                                                </Space>
                                                            )
                                                        },
                                                        {
                                                            title: 'Attendance', key: 'attendance', width: 220,
                                                            render: (_: unknown, member: Appt) => getCoverageAttendanceMode(coverageRecord) === 'manual' ? (
                                                                <Form.Item
                                                                    name={['participantAttendance', member.id]}
                                                                    preserve
                                                                    rules={[{ required: true, message: 'Select an attendance outcome.' }]}
                                                                    style={{ marginBottom: 0 }}
                                                                >
                                                                    <Select
                                                                        aria-label={'Attendance for ' + (member.participantName || 'SME')}
                                                                        options={[
                                                                            { label: 'Attended', value: 'attended' },
                                                                            { label: 'Did not attend (no-show)', value: 'no_show' }
                                                                        ]}
                                                                    />
                                                                </Form.Item>
                                                            ) : isGroupMemberCheckedIn(coverageRecord, member, participantEmails) ? (
                                                                <Tag color='green'>Attended (QR)</Tag>
                                                            ) : <Tag>No-show</Tag>
                                                        }
                                                    ]}
                                                />
                                            </div>
                                        ) : getCoverageAttendanceMode(coverageRecord) === 'manual' ? (
                                            <Form.Item
                                                name='smeAttendance'
                                                label='SME attendance outcome'
                                                rules={[{ required: true, message: 'Please record the SME attendance outcome.' }]}
                                            >
                                                <Select
                                                    options={[
                                                        { label: 'SME attended', value: 'attended' },
                                                        { label: 'SME did not attend (no-show)', value: 'no_show' }
                                                    ]}
                                                />
                                            </Form.Item>
                                        ) : (
                                            <Form.Item label='SME attendance outcome'>
                                                <Tag color='green'>Attended (QR)</Tag>
                                            </Form.Item>
                                        )}

                                        <Form.Item noStyle shouldUpdate={(prev, cur) =>
                                            prev.smeAttendance !== cur.smeAttendance ||
                                            prev.participantAttendance !== cur.participantAttendance
                                        }>
                                            {({ getFieldValue: getAttendanceField }) => {
                                                const attendance = getAttendanceField('smeAttendance') as SmeAttendanceOutcome | undefined
                                                const groupAttendance = Object.values(
                                                    (getAttendanceField('participantAttendance') || {}) as Record<string, IndividualSmeAttendanceOutcome>
                                                )
                                                const participated = (coverageRecord as any)?._displayType === 'group'
                                                    ? groupAttendance.some(outcome => outcome === 'attended')
                                                    : attendance === 'attended' || attendance === 'partially_attended'

                                                if (!participated) {
                                                    const hasNonAttendanceOutcome =
                                                        (coverageRecord as any)?._displayType === 'group'
                                                            ? groupAttendance.some(outcome => outcome === 'no_show')
                                                            : attendance === 'no_show'
                                                    if (!hasNonAttendanceOutcome) return null

                                                    return (
                                                        <>
                                                            <Alert
                                                                type='info'
                                                                showIcon
                                                                message='No-show - no intervention progress will be added.'
                                                                style={{ marginBottom: 16 }}
                                                            />
                                                            <Form.Item
                                                                name='notes'
                                                                label='Attendance notes'
                                                                rules={[
                                                                    { required: true, whitespace: true, message: 'Please explain the attendance outcome.' },
                                                                    { validator: validateCoverageNotes }
                                                                ]}
                                                                extra='At least 5 words. Explain what happened and the follow-up needed.'
                                                            >
                                                                <Input.TextArea rows={3} placeholder='What happened and what follow-up is needed?' />
                                                            </Form.Item>
                                                        </>
                                                    )
                                                }

                                                return (
                                                    <>
                                                        {isTrainingAcademyCoverage ? (
                                                            <Form.Item
                                                                name='coveredPoints'
                                                                label='Formal topics / unit standards covered'
                                                                rules={[{ required: true, message: 'Please add at least one topic or unit standard.' }]}
                                                                extra='Keep official module and unit-standard wording exactly as prescribed. Type each topic and press Enter.'
                                                            >
                                                                <Select
                                                                    mode='tags'
                                                                    open={false}
                                                                    tokenSeparators={[',']}
                                                                    placeholder='e.g. Module 5 - US 120389'
                                                                    style={{ width: '100%' }}
                                                                />
                                                            </Form.Item>
                                                        ) : null}

                                                        {!isTrainingAcademyCoverage && coverageNoteWordCount(
                                                            normalizePointList(
                                                                coverageRecord?.plannedCoverage || coverageRecord?.sessionCoverage?.plannedCoverage || []
                                                            ).join(' ')
                                                        ) > 5 ? (
                                                            <Form.Item name='usePlannedCoverage' valuePropName='checked'>
                                                                <Checkbox>
                                                                    Use the planned coverage as the coverage record
                                                                </Checkbox>
                                                            </Form.Item>
                                                        ) : null}

                                                        <Form.Item noStyle shouldUpdate={(prev, cur) =>
                                                            prev.usePlannedCoverage !== cur.usePlannedCoverage
                                                        }>
                                                            {({ getFieldValue }) => {
                                                                const usingPlannedCoverage = getFieldValue('usePlannedCoverage') === true
                                                                return (
                                                                    <Form.Item
                                                                        name='notes'
                                                                        label='What was covered and achieved?'
                                                                        rules={usingPlannedCoverage
                                                                            ? []
                                                                            : [
                                                                                { required: true, whitespace: true, message: 'Please describe what was covered and achieved.' },
                                                                                { validator: validateCoverageNotes }
                                                                            ]}
                                                                        extra={usingPlannedCoverage
                                                                            ? 'The saved planned coverage will become this session\'s coverage record.'
                                                                            : isTrainingAcademyCoverage
                                                                                ? 'At least 5 words. Briefly explain how the listed topics were covered and applied.'
                                                                                : 'At least 5 words. Include the work completed, outcome, progress made, or next steps.'}
                                                                    >
                                                                        <Input.TextArea
                                                                            rows={5}
                                                                            disabled={usingPlannedCoverage}
                                                                            placeholder='Describe the work completed, outcome, progress made, and recommended next steps'
                                                                        />
                                                                    </Form.Item>
                                                                )
                                                            }}
                                                        </Form.Item>

                                                    </>
                                                )
                                            }}
                                        </Form.Item>

                                        {(coverageRecord?.deliveryMethod === 'in_person' || coverageRecord?.sessionCoverage?.latest?.photos?.length) ? (
                                            <Form.Item
                                                label='Photos (optional)'
                                                extra={`${coveragePhotoFiles.length} selected, ${existingCoveragePhotoUrls.length} saved photos retained. Additions and removals apply when you click Save Coverage or Save Update. Cancel discards these changes.`}
                                            >
                                                <Upload
                                                    listType='picture-card'
                                                    fileList={coveragePhotoFiles}
                                                    onChange={({ fileList }) => {
                                                        coveragePhotoFilesRef.current = fileList
                                                        setCoveragePhotoFiles(fileList)
                                                    }}
                                                    disabled={savingCoverage}
                                                    beforeUpload={() => false}
                                                    multiple
                                                    accept='image/*'
                                                >
                                                    {coveragePhotoFiles.length >= 8 ? null : (
                                                        <div>
                                                            <UploadOutlined />
                                                            <div style={{ marginTop: 8 }}>Add photo</div>
                                                        </div>
                                                    )}
                                                </Upload>
                                                {existingCoveragePhotoUrls.length > 0 && (
                                                    <Space wrap style={{ marginTop: 8 }}>
                                                        {existingCoveragePhotoUrls.map((url, index) => (
                                                            <Space key={url} direction='vertical' size={4} align='center'>
                                                                <Image
                                                                    src={url}
                                                                    alt={`Saved coverage photo ${index + 1}`}
                                                                    width={80}
                                                                    height={80}
                                                                    style={{ objectFit: 'cover', borderRadius: 6 }}
                                                                />
                                                                <Button
                                                                    size='small'
                                                                    danger
                                                                    icon={<DeleteOutlined />}
                                                                    aria-label={`Remove saved coverage photo ${index + 1}`}
                                                                    disabled={savingCoverage}
                                                                    onClick={() => setExistingCoveragePhotoUrls(current => current.filter(savedUrl => savedUrl !== url))}
                                                                >
                                                                    Remove
                                                                </Button>
                                                            </Space>
                                                        ))}
                                                    </Space>
                                                )}
                                            </Form.Item>
                                        ) : null}
                                    </>
                                )
                            }}
                        </Form.Item>
                    </Form>
                )}
            </Modal>
        </div >
    )
}

export default Appointments
