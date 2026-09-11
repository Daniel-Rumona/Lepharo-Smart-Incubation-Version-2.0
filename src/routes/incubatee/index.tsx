import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Row,
    Col,
    Card,
    Typography,
    List,
    Modal,
    Input,
    message,
    Select,
    Alert,
    Rate,
    Table,
    Tag,
    Grid,
    Space,
    Empty,
    Radio,
    Descriptions,
    Divider
} from 'antd'
import {
    CheckCircleOutlined,
    FileTextOutlined,
    FileDoneOutlined,
    CalendarOutlined,
    ClockCircleOutlined,
    CloseOutlined,
    EyeOutlined
} from '@ant-design/icons'
import {
    doc,
    getDoc,
    collection,
    getDocs,
    query,
    where,
    updateDoc,
    onSnapshot,
    collectionGroup,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useNavigate } from 'react-router-dom'
import { RatioIcon } from 'lucide-react'
import { requestOpenAccountSettings } from '@/lib/accountSettings'
import {
    acceptAssignedIntervention,
    declineAssignedIntervention,
    confirmCompletion as confirmCompletionAction,
    rejectCompletion as rejectCompletionAction
} from '@/lib/interventions'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import DashboardOverview from '@/components/incubatee/DashboardOverview'
import Button from '@/components/incubatee/DashboardButton'
import { buildDashboardComplianceRows } from '@/lib/dashboardCompliance'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import {
    resolveComplianceRequirements,
    type ComplianceRequirement,
    type AgreementTemplate
} from '@/services/complianceResolver'
import { hasSmeGapSubmission, isIncubateeAgreementSigned } from '@/utils/agreementStatus'
import {
    formatAppointmentStatus,
    formatDeliveryMethod,
    getAppointmentAssigneeName,
    getConfirmationStatus,
    getDeliveryMethod,
    normalizeAppointmentRecord,
    titleCase
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
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import '@/styles/incubatee-dashboard.css'

/** AntD shorthands */
const { Text } = Typography
const { Option } = Select
const { useBreakpoint } = Grid

/** ===========================
 *  Domain types
 *  =========================== */
type AStatus = 'pending' | 'accepted' | 'declined'
type CComplete = 'pending' | 'completed'
type UComplete = 'pending' | 'confirmed' | 'rejected'

interface AssignedIntervention {
    id: string
    interventionId: string
    participantId: string
    consultantId: string
    beneficiaryName: string
    interventionTitle: string
    subInterventionTitle?: string
    subInterventionName?: string
    subIntervention?: string
    areaOfSupport: string
    dueDate: any
    createdAt: any
    updatedAt: any
    type: 'singular' | 'recurring'
    targetType: 'percentage' | 'metric' | 'custom'
    targetMetric: string
    targetValue: number
    timeSpent: number
    assigneeAcceptanceStatus: AStatus
    participantAcceptanceStatus: AStatus
    assigneeCompletionStatus: CComplete
    participantCompletionStatus: UComplete
    assigneeName?: string
    facilitatorName?: string
    consultantName?: string
    movDocumentId?: string
    status?: string
}

type UrgentItem = {
    key: string
    kind: 'contract' | 'survey'
    title: string
    subtitle?: string
    cta: string
    onClick: () => void
    tag?: string
}

type PendingDpConfirmation = {
    departmentId: string
    departmentName: string
    departmentCompletedAt: Date | null
}

/** ===========================
 *  Appointments + Events types
 *  =========================== */
type ApptStatus = 'scheduled' | 'completed' | 'cancelled'
type ApptConfirmation = 'pending' | 'confirmed' | 'declined'

type Appointment = {
    id: string

    programId?: string
    consultantId?: string
    consultantName?: string
    assigneeId?: string
    assigneeName?: string
    participantId?: string
    participantName?: string
    departmentId?: string
    interventionId?: string
    assignedInterventionId?: string
    interventionTitle?: string
    sessionTitle?: string
    plannedCoverage?: string[]
    sessionCoverage?: {
        title?: string
        plannedCoverage?: string[]
        latest?: any
        history?: any[]
    }
    deliveryMethod?: 'telephonically' | 'virtual' | 'in_person' | string
    date?: string // 'YYYY-MM-DD'
    startTime?: any // Date | Timestamp | string
    endTime?: any // Date | Timestamp | string
    meetingLink?: string
    location?: string
    status?: ApptStatus | string
    userConfirmation?: ApptConfirmation | string
    createdAt?: any
    updatedAt?: any
    declineReason?: string
    foodMenuEnabled?: boolean
    foodMenu?: any[]
    foodSelections?: any[]
    isGroupAppointment?: boolean
    rescheduleRequest?: any
    attendance?: {
        status?: 'expected' | 'attended' | 'absent' | 'declined' | string
        checkedInAt?: any
        checkedOutAt?: any
    }
}

const getAppointmentPlannedCoverage = (appointment?: Appointment | null): string[] => {
    const value =
        appointment?.plannedCoverage ||
        appointment?.sessionCoverage?.plannedCoverage ||
        []

    if (!Array.isArray(value)) return []

    return value
        .map(topic => String(topic || '').trim())
        .filter(Boolean)
}

const getFoodMenuItems = (appt: Appointment | null) => {
    if (!appt?.foodMenu || !Array.isArray(appt.foodMenu)) return []
    return appt.foodMenu.filter((item: any) => item && item.id && (item.name || item.label))
}

const getFoodItemCategory = (appt: Appointment | null, itemId?: string | null) => {
    const item = getFoodMenuItems(appt).find((menuItem: any) => menuItem.id === itemId)
    return String(item?.category || '').trim().toLowerCase()
}

const getMealMenuItems = (appt: Appointment | null) =>
    getFoodMenuItems(appt).filter((item: any) => getFoodItemCategory(appt, item.id) !== 'drink')

const getDrinkMenuItems = (appt: Appointment | null) =>
    getFoodMenuItems(appt).filter((item: any) => getFoodItemCategory(appt, item.id) === 'drink')

const getFoodSelectionsForParticipant = (appt: Appointment | null, _participantId: string | null) => {
    const selections = Array.isArray(appt?.foodSelections) ? appt?.foodSelections || [] : []
    return selections.length ? selections : null
}

const getFoodSelectionForParticipant = (appt: Appointment | null, participantId: string | null) => {
    return getFoodSelectionsForParticipant(appt, participantId)?.[0] || null
}

const getFoodSelectionByCategory = (
    appt: Appointment | null,
    participantId: string | null,
    category: 'meal' | 'drink'
) => {
    const selections = getFoodSelectionsForParticipant(appt, participantId) || []
    return (
        selections.find((sel: any) => {
            const savedCategory = String(sel.category || sel.itemCategory || '').trim().toLowerCase()
            const itemCategory = savedCategory || getFoodItemCategory(appt, sel.menuItemId)
            return category === 'drink' ? itemCategory === 'drink' : itemCategory !== 'drink'
        }) || null
    )
}

const formatFoodSelections = (appt: Appointment | null, participantId: string | null) => {
    const selections = getFoodSelectionsForParticipant(appt, participantId) || []
    if (!selections.length) return ''
    return selections.map((selection: any) => getFoodMenuItems(appt).find((item: any) => item.id === selection.menuItemId)?.name || 'Selected').join(', ')
}

/** ===========================
 *  Question + Template types
 *  =========================== */
type ResponseType = 'multiple' | 'scale' | 'short'

interface Question {
    id: string
    type: ResponseType
    questionText: string
    required?: boolean
    options?: string[]
    multipleMode?: 'single' | 'multi'
    min?: number
    max?: number
    step?: number
    placeholder?: string
}

interface DepartmentFormTemplate {
    id: string
    title?: string
    description?: string
    type?: string
    department?: string
    questions?: Question[]
}

interface DocumentRow {
    id: string // sentForms/{id}
    responseDocId: string // responses/{participantId}
    title: string
    type: string
    description: string
    department?: string
    status: 'pending' | 'in-progress' | 'completed'
    dueDate?: string
    requestedBy?: string
    questions: Question[]
    draftData?: any
    answers?: Record<string, any>
    submittedAt?: any
    completed?: boolean
    templateId?: string
}

/** ===========================
 *  Template cache for departmentForms
 *  =========================== */
const templateCache = new Map<string, DepartmentFormTemplate | null>()
async function getTemplateById(templateId?: string | null) {
    if (!templateId) return null
    if (templateCache.has(templateId)) return templateCache.get(templateId)!
    try {
        const snap = await getDoc(doc(db, 'departmentForms', templateId))
        const tpl = snap.exists()
            ? ({ id: snap.id, ...snap.data() } as DepartmentFormTemplate)
            : null
        templateCache.set(templateId, tpl)
        return tpl
    } catch (e) {
        console.error('Failed to fetch departmentForms template:', e)
        templateCache.set(templateId, null)
        return null
    }
}

/** ===========================
 *  Component
 *  =========================== */
export const IncubateeDashboard: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const userRole = user?.role
    const screens = useBreakpoint()
    const navigate = useNavigate()
    const { activeProgramId } = useActiveProgramId()

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'incubatee-dashboard',
            pageTitle: 'Incubatee Dashboard',
            guides: [
                {
                    id: 'incubatee-dashboard-overview',
                    title: 'Dashboard quick tour',
                    description:
                        'Understand your progress, completion requests, urgent documents and upcoming appointments.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('incubatee-dashboard-metrics'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Your progress at a glance',
                                description:
                                    'These metrics summarise intervention participation, outstanding documents and completed work.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('incubatee-pending-completions'),
                            skipMissingElement: true,
                            popover: {
                                title: 'Completion confirmations',
                                description:
                                    'When a facilitator completes an intervention, review the intervention and sub-intervention here before confirming or rejecting it.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('incubatee-completion-actions'),
                            skipMissingElement: true,
                            popover: {
                                title: 'Confirm or reject',
                                description:
                                    'Confirm completed work when the delivery is correct, or reject it with a reason when follow-up is needed.',
                                side: 'left',
                                align: 'center'
                            }
                        },
                        {
                            element: guideTarget('incubatee-urgent-action'),
                            skipMissingElement: true,
                            popover: {
                                title: 'Urgent action',
                                description:
                                    'Complete outstanding agreements or surveys shown here. This section is hidden when nothing requires attention.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('incubatee-pending-dp-confirmations'),
                            skipMissingElement: true,
                            popover: {
                                title: 'Pending DP confirmations',
                                description:
                                    'These departments have completed their development-plan submission and are waiting for your review. Select View all to continue on the Roadmap page.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('incubatee-schedule'),
                            skipMissingElement: true,
                            popover: {
                                title: 'Upcoming schedule',
                                description:
                                    'Review upcoming appointment dates, times, delivery details and your response status.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('incubatee-schedule-actions'),
                            skipMissingElement: true,
                            popover: {
                                title: 'Appointment actions',
                                description:
                                    'Open appointment details or links, choose food when available, and confirm or decline pending appointments.',
                                side: 'left',
                                align: 'center'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    /** Participant + role */
    const [participantId, setParticipantId] = useState<string>('')


    /** Top metrics */
    const [complianceModalOpen, setComplianceModalOpen] = useState(false)
    const [complianceRequirements, setComplianceRequirements] = useState<ComplianceRequirement[]>([])
    const [complianceUploads, setComplianceUploads] = useState<any[]>([])
    const [complianceLoading, setComplianceLoading] = useState(true)
    const [requirementsLoading, setRequirementsLoading] = useState(true)
    const [complianceError, setComplianceError] = useState('')
    const [requirementsError, setRequirementsError] = useState('')
    const [requiredInterventions, setRequiredInterventions] = useState<number>(0)
    const [completedInterventions, setCompletedInterventions] = useState<number>(0)

    /** Interventions + actions */
    const [allInterventions, setAllInterventions] = useState<AssignedIntervention[]>([])
    const [pendingInterventions, setPendingInterventions] = useState<any[]>([])
    const [pendingDpConfirmations, setPendingDpConfirmations] =
        useState<PendingDpConfirmation[]>([])
    const [confirmModalVisible, setConfirmModalVisible] = useState(false)
    const [selectedIntervention, setSelectedIntervention] =
        useState<AssignedIntervention | null>(null)
    const [feedbackRating, setFeedbackRating] = useState<number>(0)
    const [feedbackComments, setFeedbackComments] = useState<string>('')
    const [completionReviewStep, setCompletionReviewStep] = useState<0 | 1>(0)
    const [isRejectModalVisible, setIsRejectModalVisible] = useState(false)
    const [rejectReason, setRejectReason] = useState('')
    const [confirmSubmitting, setConfirmSubmitting] = useState(false)


    /** Schedule */
    const [appointments, setAppointments] = useState<Appointment[]>([])
    const [appointmentsLoading, setAppointmentsLoading] = useState(true)
    const [appointmentError, setAppointmentError] = useState('')
    // The dashboard list is intentionally upcoming-only. Completion review
    // must also include historical sessions, so it keeps its own full set.
    const [allParticipantAppointments, setAllParticipantAppointments] = useState<Appointment[]>([])
    const completionAppointments = useMemo(() => {
        if (!selectedIntervention) return []
        return allParticipantAppointments
            .filter(appointment => appointment.assignedInterventionId === selectedIntervention.id)
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    }, [allParticipantAppointments, selectedIntervention])
    const attendedCompletionAppointments = useMemo(
        () => completionAppointments.filter(appointment => appointment.attendance?.status === 'attended'),
        [completionAppointments]
    )
    const [apptDetailsOpen, setApptDetailsOpen] = useState(false)
    const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)
    const [declineApptOpen, setDeclineApptOpen] = useState(false)
    const [declineApptReasonCode, setDeclineApptReasonCode] =
        useState<AppointmentDeclineReasonCode | undefined>()
    const [declineApptReason, setDeclineApptReason] = useState('')
    const [declineApptProposals, setDeclineApptProposals] =
        useState<AppointmentProposalDraft[]>([createAppointmentProposalDraft()])
    const [declineApptId, setDeclineApptId] = useState<string | null>(null)
    const [foodMenuModalOpen, setFoodMenuModalOpen] = useState(false)
    const [selectedFoodAppt, setSelectedFoodAppt] = useState<Appointment | null>(null)
    const [selectedMealItemId, setSelectedMealItemId] = useState<string | null>(null)
    const [selectedDrinkItemId, setSelectedDrinkItemId] = useState<string | null>(null)
    const [savingFoodSelection, setSavingFoodSelection] = useState(false)

    /** Agreements + GAP + modals */
    const [signedAgreements, setSignedAgreements] = useState<Record<string, any>>({})
    const [smeGapSubmitted, setSmeGapSubmitted] = useState(false)
    const [requiredAgreements, setRequiredAgreements] = useState<Array<{
        agreementId: string
        title: string
        template?: AgreementTemplate
    }>>([])
    const [acceptedApp, setAcceptedApp] = useState<any>(null)
    const complianceRows = useMemo(() => buildDashboardComplianceRows(
        complianceRequirements,
        Array.isArray(acceptedApp?.complianceDocuments) ? acceptedApp.complianceDocuments : [],
        complianceUploads
    ), [complianceRequirements, acceptedApp?.complianceDocuments, complianceUploads])
    const outstandingComplianceRows = complianceRows.filter(row => row.outstanding)
    const outstandingDocs = outstandingComplianceRows.length
    const complianceUnavailable = complianceLoading || requirementsLoading || Boolean(complianceError || requirementsError)
    const [monthsInProgram, setMonthsInProgram] = useState<number>(0)

    /** Loading */
    const [loading, setLoading] = useState(true)

    /** Realtime unsub refs */
    const applicationsUnsub = useRef<null | (() => void)>(null)
    const interventionsUnsub = useRef<null | (() => void)>(null)
    const responsesUnsub = useRef<null | (() => void)>(null)
    const completionSubmitLock = useRef<string | null>(null)

    /** Documents (SURVEYS) */
    const [documents, setDocuments] = useState<DocumentRow[]>([])

    /** -----------------
     *  Time helpers (fix TBD issue properly)
     *  ----------------- */
    const toDateSafe = (val: any): Date | null => {
        if (!val) return null
        if (val instanceof Date) return val
        if (typeof val === 'string') {
            // If val is HH:mm, it is NOT a date. Handle elsewhere.
            if (/^\d{2}:\d{2}$/.test(val)) return null
            const d = new Date(val)
            return isNaN(d.getTime()) ? null : d
        }
        if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate()
        if (val?.seconds) return new Date(val.seconds * 1000)
        return null
    }

    const toDate = (val: any): Date | null => toDateSafe(val)


    const fmtDateStr = (dateStr?: string | null) => {
        if (!dateStr) return '-'
        const d = dayjs(dateStr, 'YYYY-MM-DD', true)
        return d.isValid() ? d.format('YYYY-MM-DD') : '-'
    }

    const fmtTimeFromAny = (val: any): string => {
        if (!val) return ''
        // If already "HH:mm"
        if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) return val
        const d = toDateSafe(val)
        return d ? dayjs(d).format('HH:mm') : ''
    }

    const normalizeSchedule = (item: Omit<ScheduleRow, '_n'>) => {
        // Date:
        // - prefer item.date
        // - fallback to startTime if it's a Timestamp/Date
        const dateCandidate =
            (typeof item.date === 'string' && item.date) ||
            (toDateSafe(item.startTime) ? dayjs(toDateSafe(item.startTime)!).format('YYYY-MM-DD') : '')

        const date = fmtDateStr(dateCandidate)
        const start = fmtTimeFromAny(item.startTime)
        const end = fmtTimeFromAny(item.endTime)

        const sortKey = (() => {
            const d = date === '-' ? '9999-12-31' : date
            const t = start || '99:99'
            return `${d} ${t}`
        })()

        return { date, start, end, sortKey }
    }

    const requireSignatureForCompletion = (onOk: () => void) => {
        if (user?.signatureURL) return onOk()
        Modal.confirm({
            okButtonProps: { shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } },
            cancelButtonProps: { shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } },
            title: 'Signature required',
            content:
                'You must add your signature in Account Settings before you can confirm intervention completion.',
            okText: 'Go to Account Settings',
            cancelText: 'Cancel',
            onOk: () => requestOpenAccountSettings()
        })
    }

    const requireSignatureForAcceptance = (itemLabel: string) => {
        if (user?.signatureURL) return true
        Modal.confirm({
            okButtonProps: { shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } },
            cancelButtonProps: { shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } },
            title: 'Signature required',
            content: `Please add your signature in Account Settings before confirming or accepting ${itemLabel}.`,
            okText: 'Go to Account Settings',
            cancelText: 'Cancel',
            onOk: () => requestOpenAccountSettings()
        })
        return false
    }

    /** -----------------
     *  Auth bootstrap
     *  ----------------- */
    useEffect(() => {
        let cancelled = false

        const bootstrapIdentity = async () => {
            if (identityLoading) return
            setParticipantId('')
            setAcceptedApp(null)
            setComplianceModalOpen(false)
            setComplianceRequirements([])
            setComplianceUploads([])
            setAppointments([])
            setAllParticipantAppointments([])
            setAllInterventions([])
            setRequiredInterventions(0)
            setCompletedInterventions(0)
            setLoading(true)
            if (!user) {
                if (!cancelled) setLoading(false)
                return
            }

            const candidateIds = Array.from(new Set([
                user.participantId,
                user.participantDocId,
                user.profileId,
                user.id,
                user.uid
            ].map(value => String(value || '').trim()).filter(Boolean)))

            let participantDoc: any = null
            for (const id of candidateIds) {
                const snapshot = await getDoc(doc(db, 'participants', id))
                if (snapshot.exists()) {
                    participantDoc = snapshot
                    break
                }
            }

            if (!participantDoc && user.email) {
                const email = String(user.email).trim().toLowerCase()
                const exact = await getDocs(
                    query(collection(db, 'participants'), where('email', '==', user.email))
                )
                participantDoc = exact.docs[0] || null

                // Firestore string equality is case-sensitive. Retain a
                // compatibility fallback for legacy participant emails whose
                // casing differs from the effective user profile.
                if (!participantDoc) {
                    const participants = await getDocs(collection(db, 'participants'))
                    participantDoc = participants.docs.find(item =>
                        String(item.data()?.email || '').trim().toLowerCase() === email
                    ) || null
                }
            }

            if (cancelled) return
            setParticipantId(String(participantDoc?.id || ''))
            setLoading(false)
        }

        bootstrapIdentity().catch(error => {
            if (cancelled) return
            console.error('Failed to resolve dashboard incubatee identity:', error)
            setLoading(false)
        })

        return () => {
            cancelled = true
            applicationsUnsub.current?.()
            interventionsUnsub.current?.()
            responsesUnsub.current?.()
        }
    }, [
        identityLoading,
        user?.email,
        user?.id,
        user?.participantDocId,
        user?.participantId,
        user?.profileId,
        user?.uid
    ])

    /** -----------------
     *  Development-plan confirmations awaiting the incubatee
     *  ----------------- */
    useEffect(() => {
        if (!participantId) {
            setPendingDpConfirmations([])
            return
        }

        let cancelled = false
        const normaliseName = (value: unknown) =>
            String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
        const isConfirmed = (value: any) =>
            value === true || (value && typeof value === 'object' && value.confirmed === true)

        const departmentRowsPromise = getDocs(collection(db, 'departments'))
            .then(snapshot => snapshot.docs
                .map(departmentDoc => {
                    const data = departmentDoc.data() as any
                    return {
                        id: departmentDoc.id,
                        name: String(data.name || data.departmentName || departmentDoc.id).trim(),
                        interventionsDepartment: data.interventionsDepartment
                    }
                })
                .filter(department => department.interventionsDepartment === true)
                .sort((a, b) => a.name.localeCompare(b.name)))
            .catch(error => {
                console.error('Failed to load dashboard DP departments:', error)
                return [] as Array<{ id: string; name: string; interventionsDepartment: any }>
            })

        const off = onSnapshot(
            query(collection(db, 'diagnosticPlans'), where('participantId', '==', participantId)),
            async snapshot => {
                const latestPlanDoc = [...snapshot.docs].sort((a, b) => {
                    const aDate = toDateSafe(a.data()?.createdAt)?.getTime() || 0
                    const bDate = toDateSafe(b.data()?.createdAt)?.getTime() || 0
                    return bDate - aDate
                })[0]

                if (!latestPlanDoc) {
                    if (!cancelled) setPendingDpConfirmations([])
                    return
                }

                const plan = latestPlanDoc.data() as any
                const departments = await departmentRowsPromise
                if (cancelled) return

                const confirmedById = plan.confirmedByDeptId || {}
                const confirmedByName = plan.confirmed || {}
                const incubateeConfirmedById = plan.incubateeDepartmentConfirmationsByDeptId || {}
                const smmeConfirmedById = plan.smmeConfirmedByDeptId || {}
                const incubateeConfirmedByName = plan.incubateeDepartmentConfirmations || {}
                const rowsById = new Map<string, PendingDpConfirmation>()
                const knownDepartmentIds = new Set(departments.map(department => department.id))

                const addPendingDepartment = (
                    departmentId: string,
                    departmentName: string,
                    departmentConfirmation: any,
                    incubateeConfirmation: any
                ) => {
                    if (!isConfirmed(departmentConfirmation) || isConfirmed(incubateeConfirmation)) return

                    const completedAt =
                        departmentConfirmation && typeof departmentConfirmation === 'object'
                            ? toDateSafe(departmentConfirmation.confirmedAt)
                            : null
                    rowsById.set(departmentId, {
                        departmentId,
                        departmentName: departmentName || departmentId,
                        departmentCompletedAt: completedAt
                    })
                }

                departments.forEach(department => {
                    const byName = confirmedByName[department.name] ??
                        confirmedByName[normaliseName(department.name)]
                    const departmentConfirmation = confirmedById[department.id] ?? byName
                    const incubateeConfirmation =
                        smmeConfirmedById[department.id] ??
                        incubateeConfirmedById[department.id] ??
                        incubateeConfirmedByName[department.name] ??
                        incubateeConfirmedByName[normaliseName(department.name)]

                    addPendingDepartment(
                        department.id,
                        department.name,
                        departmentConfirmation,
                        incubateeConfirmation
                    )
                })

                Object.entries(confirmedById).forEach(([departmentId, confirmation]) => {
                    if (knownDepartmentIds.has(departmentId)) return
                    const intervention = (plan.interventions || []).find(
                        (item: any) => String(item.departmentId || '') === departmentId
                    )
                    const confirmationName =
                        confirmation && typeof confirmation === 'object'
                            ? String((confirmation as any).departmentName || '').trim()
                            : ''
                    addPendingDepartment(
                        departmentId,
                        confirmationName || intervention?.departmentName || intervention?.department || departmentId,
                        confirmation,
                        smmeConfirmedById[departmentId] ?? incubateeConfirmedById[departmentId]
                    )
                })

                setPendingDpConfirmations(
                    [...rowsById.values()].sort((a, b) =>
                        (b.departmentCompletedAt?.getTime() || 0) -
                        (a.departmentCompletedAt?.getTime() || 0) ||
                        a.departmentName.localeCompare(b.departmentName)
                    )
                )
            },
            error => {
                console.error('Dashboard DP confirmations listener error:', error)
                if (!cancelled) setPendingDpConfirmations([])
            }
        )

        return () => {
            cancelled = true
            off()
        }
    }, [participantId])

    /** -----------------
     *  Appointments (upcoming)
     *  ----------------- */
    useEffect(() => {
        let disposed = false
        let revision = 0
        setAppointments([])
        setAllParticipantAppointments([])
        setAppointmentError('')
        setAppointmentsLoading(Boolean(participantId))
        if (!participantId) return
        const todayStr = dayjs().startOf('day').format('YYYY-MM-DD')

        const qRef = activeProgramId
            ? query(
                collection(db, 'appointments'),
                where('smeId', '==', participantId),
                where('programId', '==', activeProgramId)
            )
            : query(collection(db, 'appointments'), where('smeId', '==', participantId))

        const off = onSnapshot(
            qRef,
            async snap => {
                const currentRevision = ++revision
                try {
                const hydrated = await hydrateAppointmentViews(
                    snap.docs.map(d => ({ id: d.id, data: d.data() as any }))
                )
                const hydratedRows = hydrated
                    .map(d => normalizeAppointmentRecord(d.id, d) as Appointment)
                if (disposed || currentRevision !== revision) return
                setAllParticipantAppointments(hydratedRows)
                const rows = hydratedRows
                    .filter(a => {
                        if (['cancelled', 'canceled', 'completed'].includes(String(a.status || '').toLowerCase())) return false
                        const date = (a.date && fmtDateStr(a.date)) || '-'
                        if (date === '-') return true // keep if missing date, still show it
                        if (date > todayStr) return true
                        if (date < todayStr) return false

                        // Same day: only hide it once its end (or start) time has actually passed.
                        const timeStr = fmtTimeFromAny(a.endTime) || fmtTimeFromAny(a.startTime)
                        if (!timeStr) return true
                        const cutoff = dayjs(`${date} ${timeStr}`, 'YYYY-MM-DD HH:mm')
                        return !cutoff.isValid() || cutoff.isAfter(dayjs())
                    })
                setAppointments(rows)
                setAppointmentsLoading(false)
                setAppointmentError('')
                } catch (error) {
                    if (disposed || currentRevision !== revision) return
                    console.error('Dashboard appointment hydration failed:', error)
                    setAppointmentError('Appointments could not be loaded. Please try again later.')
                    setAppointmentsLoading(false)
                }
            },
            err => {
                if (disposed) return
                console.error('appointments listener error:', err)
                setAppointmentError('Appointments could not be loaded. Please try again later.')
                setAppointmentsLoading(false)
            }
        )

        return () => { disposed = true; off() }
    }, [participantId, activeProgramId])

    useEffect(() => {
        setSmeGapSubmitted(false)
        if (!participantId) return

        return onSnapshot(
            query(collection(db, 'gapAnalysis'), where('participantId', '==', participantId)),
            snapshot => {
                setSmeGapSubmitted(hasSmeGapSubmission({
                    gapRecords: snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
                }))
            },
            error => {
                console.error('Dashboard GAP submission status could not be loaded:', error)
            }
        )
    }, [participantId])

    /** -----------------
     *  Live: applications (agreements, GAP, MOA)
     *  ----------------- */
    useEffect(() => {
        let disposed = false
        let revision = 0
        setAcceptedApp(null)
        if (!participantId) return

        applicationsUnsub.current?.()

        applicationsUnsub.current = onSnapshot(
            query(collection(db, 'applications'), where('participantId', '==', participantId)),
            async snap => {
                const currentRevision = ++revision
                const apps = snap.docs.map(d => ({ id: d.id, ...d.data() } as any))
                const acceptedApps = apps.filter(
                    a => String(a.applicationStatus || '').toLowerCase() === 'accepted'
                )
                const accepted =
                    (
                        activeProgramId
                            ? acceptedApps.find(
                                a => String(a.programId || '') === String(activeProgramId)
                            )
                            : null
                    ) ||
                    acceptedApps[0] ||
                    null
                setAcceptedApp(accepted)

                const merged: Record<string, any> = { ...(accepted?.signedAgreements || {}) }

                if (accepted?.id) {
                    const appRef = doc(db, 'applications', accepted.id)
                    try {
                        const agrSnap = await getDocs(collection(appRef, 'agreements'))
                        agrSnap.forEach(d => {
                            if (!merged[d.id]) merged[d.id] = d.data()
                        })
                    } catch (error) {
                        console.error('Dashboard agreements could not be loaded:', error)
                    }
                }

                if (disposed || currentRevision !== revision) return
                setSignedAgreements(merged)

                const acceptedAt = toDate(accepted?.acceptedAt || accepted?.dateAccepted) || new Date()
                setMonthsInProgram(dayjs().diff(dayjs(acceptedAt), 'month'))
            }
        )

        return () => { disposed = true; applicationsUnsub.current?.() }
    }, [participantId, activeProgramId])

    useEffect(() => {
        let disposed = false
        setComplianceRequirements([])
        setRequirementsError('')
        setRequirementsLoading(Boolean(acceptedApp?.programId))
        if (!acceptedApp?.programId) {
            setRequiredAgreements([])
            return
        }
        resolveComplianceRequirements(acceptedApp.programId, { includeAllDepartments: true })
            .then(resolved => {
                if (disposed) return
                setComplianceRequirements(resolved.requirements)
                setRequirementsLoading(false)
                const templates = new Map(resolved.agreements.map(template => [template.agreementId, template]))
                setRequiredAgreements(
                    resolved.requirements
                        .filter(requirement => requirement.kind === 'agreement' && requirement.agreementId)
                        .map(requirement => ({
                            agreementId: requirement.agreementId!,
                            title: requirement.title,
                            template: templates.get(requirement.agreementId!)
                        }))
                )
            })
            .catch(error => {
                console.error('Failed to resolve dashboard agreements', error)
                if (!disposed) {
                    setRequiredAgreements([])
                    setRequirementsLoading(false)
                    setRequirementsError('Compliance requirements could not be loaded.')
                }
            })
        return () => {
            disposed = true
        }
    }, [acceptedApp?.programId])

    useEffect(() => {
        setComplianceUploads([])
        setComplianceError('')
        setComplianceLoading(Boolean(acceptedApp?.id))
        if (!acceptedApp?.id) return
        return onSnapshot(collection(db, 'applications', acceptedApp.id, 'complianceDocuments'), snapshot => {
            setComplianceUploads(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
            setComplianceLoading(false)
        }, error => {
            console.error('Dashboard compliance documents failed:', error)
            setComplianceError('Compliance documents could not be loaded.')
            setComplianceLoading(false)
        })
    }, [acceptedApp?.id])

    /** -----------------
     *  Live: assignedInterventions
     *  ----------------- */
    useEffect(() => {
        if (!participantId) return
        interventionsUnsub.current?.()
        interventionsUnsub.current = onSnapshot(
            query(collection(db, 'assignedInterventions'), where('participantId', '==', participantId)),
            snap => {
                const data: AssignedIntervention[] = snap.docs
                    .map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    }))
                setAllInterventions(data)

                const actionable = data
                    .map(item => {
                        const lifecycle = resolveAssignmentLifecycle(item)

                        let type: 'confirmation' | null = null

                        // Appointment acceptance is handled in the Schedule
                        // section. An assignment with no appointment gives the
                        // SME nothing to respond to, so it must not appear as a
                        // pending intervention action.
                        if (lifecycle.key === 'awaiting-participant-confirmation') {
                            type = 'confirmation'
                        }

                        if (!type) return null

                        const subIntervention = String(
                            item.subInterventionTitle ||
                            item.subInterventionName ||
                            item.subIntervention ||
                            ''
                        ).trim()
                        const facilitator = String(
                            item.assigneeName ||
                            item.facilitatorName ||
                            item.consultantName ||
                            ''
                        ).trim()

                        return {
                            id: item.id,
                            title: item.interventionTitle,
                            subIntervention:
                                subIntervention &&
                                subIntervention.toLowerCase() !== String(item.interventionTitle || '').trim().toLowerCase()
                                    ? subIntervention
                                    : '',
                            facilitator: facilitator || 'Not assigned yet',
                            type,
                            date: item.dueDate?.seconds
                                ? dayjs(item.dueDate.seconds * 1000).format('YYYY-MM-DD')
                                : item.dueDate
                                    ? dayjs(item.dueDate).format('YYYY-MM-DD')
                                    : '-',
                            full: item
                        }
                    })
                    .filter(Boolean)

                setPendingInterventions(actionable as any[])
            }
        )

        return () => interventionsUnsub.current?.()
    }, [participantId])

    /** -----------------
     *  Live: SURVEYS
     *  ----------------- */
    useEffect(() => {
        if (!participantId) {
            setDocuments([])
            return
        }
        responsesUnsub.current?.()
        let disposed = false
        let fallbackFormsUnsub: null | (() => void) = null
        let fallbackResponseUnsubs: Array<() => void> = []
        let directRowsVersion = 0
        const directResponses = new Map<string, { responseSnap: any; formSnap: any }>()

        const buildDocumentRow = async (respSnap: any, suppliedFormSnap?: any) => {
            const resp = respSnap.data() as any
            const formRef = respSnap.ref.parent.parent!
            const formSnap = suppliedFormSnap || await getDoc(formRef)
            const form = (formSnap.exists() ? formSnap.data() : {}) as any

            const templateId: string | undefined = resp?.templateId || form?.templateId || undefined
            const tpl = await getTemplateById(templateId)

            const status: DocumentRow['status'] = resp.completed
                ? 'completed'
                : resp.answersDraft && Object.keys(resp.answersDraft || {}).length
                    ? 'in-progress'
                    : 'pending'

            const merged: Partial<DocumentRow> = {
                title: tpl?.title ?? form.title ?? 'Untitled Form',
                description: tpl?.description ?? form.description ?? '',
                type: tpl?.type ?? form.type ?? 'marketing',
                department: tpl?.department ?? form.department ?? form.requestedBy ?? '',
                questions:
                    (tpl?.questions as Question[] | undefined) ??
                    ((Array.isArray(form.questions) ? form.questions : undefined) as Question[] | undefined) ??
                    ((Array.isArray(resp.questions) ? resp.questions : undefined) as Question[] | undefined) ??
                    []
            }

            return {
                id: formRef.id,
                responseDocId: respSnap.id,
                status,
                dueDate: form.dueDate || '',
                requestedBy: form.requestedBy || form.department || '',
                draftData: resp.answersDraft || undefined,
                answers: resp.answers || undefined,
                submittedAt: resp.submittedAt ?? null,
                completed: !!resp.completed,
                templateId,
                ...merged
            } as DocumentRow
        }

        const publishDirectRows = async () => {
            const version = ++directRowsVersion
            const rows = await Promise.all(
                Array.from(directResponses.values()).map(({ responseSnap, formSnap }) =>
                    buildDocumentRow(responseSnap, formSnap)
                )
            )
            if (!disposed && version === directRowsVersion) setDocuments(rows)
        }

        const startDirectResponseListeners = () => {
            if (fallbackFormsUnsub || disposed) return
            setDocuments([])
            fallbackFormsUnsub = onSnapshot(
                collection(db, 'sentForms'),
                formsSnap => {
                    fallbackResponseUnsubs.forEach(unsubscribe => unsubscribe())
                    fallbackResponseUnsubs = []
                    directResponses.clear()
                    void publishDirectRows()

                    fallbackResponseUnsubs = formsSnap.docs.map(formSnap =>
                        onSnapshot(
                            doc(db, 'sentForms', formSnap.id, 'responses', participantId),
                            responseSnap => {
                                if (responseSnap.exists()) {
                                    directResponses.set(formSnap.id, { responseSnap, formSnap })
                                } else {
                                    directResponses.delete(formSnap.id)
                                }
                                void publishDirectRows()
                            },
                            error => console.error('Direct dashboard response listener error:', error)
                        )
                    )
                },
                error => console.error('Dashboard sent forms listener error:', error)
            )
        }

        const groupUnsub = onSnapshot(
            query(collectionGroup(db, 'responses'), where('participantId', '==', participantId)),
            async snap => {
                const rows = await Promise.all(snap.docs.map(respSnap => buildDocumentRow(respSnap)))
                if (!disposed) setDocuments(rows)
            },
            error => {
                if (error.code === 'permission-denied') {
                    startDirectResponseListeners()
                    return
                }
                console.error('Responses listener (dashboard) error:', error)
            }
        )

        const stopResponses = () => {
            disposed = true
            groupUnsub()
            fallbackFormsUnsub?.()
            fallbackResponseUnsubs.forEach(unsubscribe => unsubscribe())
            fallbackResponseUnsubs = []
        }
        responsesUnsub.current = stopResponses
        return stopResponses
    }, [participantId])

    /** -----------------
     *  Derive required/completed interventions + participation rate
     *  ----------------- */
    useEffect(() => {
        const applicationRequiredCount = Array.isArray(acceptedApp?.interventions?.required)
            ? acceptedApp.interventions.required.length
            : Number(acceptedApp?.interventions?.required || 0)

        // The current assignment workflow no longer always denormalizes
        // requirements back into applications. Count unique parent
        // interventions from the live assignments as the current source of
        // truth, while retaining a larger legacy application requirement
        // count when one exists. Cycles and sub-interventions must not inflate
        // the denominator.
        const assignedInterventionKeys = new Set(
            allInterventions
                .map(item =>
                    String(
                        (item as any)?.interventionId ||
                        (item as any)?.interventionTitle ||
                        ''
                    ).trim().toLowerCase()
                )
                .filter(Boolean)
        )
        const req = Math.max(applicationRequiredCount, assignedInterventionKeys.size)

        // Match the intervention tracking page: this metric represents SME-
        // confirmed completed assignments, regardless of whether the parent
        // intervention definition contains additional sub-interventions.
        const completedFromAssignments = allInterventions.filter(item =>
            resolveAssignmentLifecycle(item).isCompleted
        ).length
        const comp = Math.min(completedFromAssignments, req)

        setRequiredInterventions(req)
        setCompletedInterventions(comp)
    }, [acceptedApp, allInterventions])

    const recentCompletions = useMemo(() => allInterventions
        .filter(item => resolveAssignmentLifecycle(item).isCompleted)
        .map(item => {
            const record = item as AssignedIntervention & { participantConfirmedAt?: any; completedAt?: any }
            const completedAt = toDateSafe(record.participantConfirmedAt) || toDateSafe(record.completedAt)
            return {
                id: item.id,
                title: item.interventionTitle || 'Intervention',
                subtitle: item.subInterventionTitle || item.subInterventionName || item.subIntervention || undefined,
                completedAt: completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt : null
            }
        })
        .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0) || a.id.localeCompare(b.id))
        .slice(0, 5), [allInterventions])

    const unsignedAgreementRequirements = useMemo(() => {
        const acceptedAt = toDate(acceptedApp?.acceptedAt || acceptedApp?.dateAccepted)
        return requiredAgreements.filter(requirement => {
            const delayMonths = requirement.template?.availabilityDelayMonths
            if (typeof delayMonths === 'number' && delayMonths > 0) {
                if (!acceptedAt || dayjs().isBefore(dayjs(acceptedAt).add(delayMonths, 'month'))) {
                    return false
                }
            }
            const value = signedAgreements?.[requirement.agreementId]
            if (
                requirement.agreementId === 'gap-analysis' &&
                hasSmeGapSubmission({
                    application: acceptedApp,
                    agreement: value,
                    gapRecords: smeGapSubmitted ? [{ id: 'submitted' }] : []
                })
            ) {
                return false
            }
            return !isIncubateeAgreementSigned(value, requirement.agreementId)
        })
    }, [acceptedApp, requiredAgreements, signedAgreements, smeGapSubmitted])

    const otherUnsignedCount = unsignedAgreementRequirements.length

    const urgentFormItems: UrgentItem[] = useMemo(() => {
        return documents
            .filter(d => d.status !== 'completed')
            .map(d => ({
                key: `resp-${d.id}`,
                kind: 'survey',
                title: d.title,
                subtitle: d.description || 'Form assigned to you',
                cta: d.status === 'pending' ? 'Respond' : 'Continue',
                tag: 'Survey',
                onClick: () =>
                    navigate('/incubatee/documents/hub', {
                        state: {
                            participantId,
                            sentFormId: d.id,
                            templateId: d.templateId || null
                        }
                    })
            }))
    }, [documents, navigate, participantId])

    const urgentItems: UrgentItem[] = useMemo(() => {
        const agreements: UrgentItem[] = unsignedAgreementRequirements.map(requirement => ({
            key: `agreement-${requirement.agreementId}`,
            kind: 'contract',
            title: requirement.title,
            subtitle: 'Required',
            cta: 'Open',
            onClick: () => navigate('/incubatee/documents/compliance'),
            tag: 'Agreement'
        }))
        return [...agreements, ...urgentFormItems]
    }, [navigate, unsignedAgreementRequirements, urgentFormItems])

    const hasUrgentAction = urgentItems.length > 0

    /** -----------------
     *  Appointment & Events actions
     *  ----------------- */
    const confirmAppointment = async (apptId: string) => {
        try {
            await updateDoc(doc(db, 'appointments', apptId), {
                smeConfirmation: 'confirmed',
                updatedAt: serverTimestamp()
            })

            // Responding to an appointment doubles as accepting the underlying
            // intervention assignment when it's still awaiting that decision.
            // A no-op (already accepted, or a later appointment in the same
            // intervention) throws and is safe to ignore here.
            const assignedInterventionId = String(
                appointments.find(a => a.id === apptId)?.assignedInterventionId || ''
            ).trim()
            if (assignedInterventionId) {
                try {
                    await acceptAssignedIntervention(db, assignedInterventionId)
                } catch {
                    // Not awaiting acceptance - nothing to do.
                }
            }

            setAppointments(prev =>
                prev.map(a => (a.id === apptId ? { ...a, userConfirmation: 'confirmed' } : a))
            )
            if (selectedAppt?.id === apptId) {
                setSelectedAppt({ ...selectedAppt, userConfirmation: 'confirmed' })
            }
            message.success('Appointment confirmed.')
        } catch (e) {
            console.error(e)
            message.error('Failed to confirm appointment.')
        }
    }

    const handleConfirmAppointment = async (appt: Appointment) => {
        if (!requireSignatureForAcceptance('this appointment')) return

        const menuItems = getFoodMenuItems(appt)
        const hasFoodMenu =
            appt.deliveryMethod === 'in_person' &&
            appt.foodMenuEnabled &&
            menuItems.length > 0

        if (hasFoodMenu) {
            if (!participantId) {
                message.error('Unable to resolve your participant identity.')
                return
            }

            setSelectedFoodAppt(appt)
            const existingMeal = getFoodSelectionByCategory(appt, participantId, 'meal')
            const existingDrink = getFoodSelectionByCategory(appt, participantId, 'drink')
            setSelectedMealItemId(existingMeal?.menuItemId || null)
            setSelectedDrinkItemId(existingDrink?.menuItemId || null)
            setFoodMenuModalOpen(true)
            return
        }

        await confirmAppointment(appt.id)
    }

    const openAppointmentFoodMenu = (appt: Appointment) => {
        if (!participantId) {
            message.error('Unable to resolve your participant identity.')
            return
        }
        if (
            appt.deliveryMethod !== 'in_person' ||
            !appt.foodMenuEnabled ||
            !getFoodMenuItems(appt).length
        ) {
            message.warning('No food menu is available for this appointment.')
            return
        }

        const existingMeal = getFoodSelectionByCategory(appt, participantId, 'meal')
        const existingDrink = getFoodSelectionByCategory(appt, participantId, 'drink')
        setSelectedFoodAppt(appt)
        setSelectedMealItemId(existingMeal?.menuItemId || null)
        setSelectedDrinkItemId(existingDrink?.menuItemId || null)
        setFoodMenuModalOpen(true)
    }

    const saveFoodSelectionAndConfirm = async () => {
        if (!selectedFoodAppt || !participantId) return
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

        const selectedItems = [
            selectedMealItemId
                ? getFoodMenuItems(selectedFoodAppt).find((menuItem: any) => menuItem.id === selectedMealItemId)
                : null,
            selectedDrinkItemId
                ? getFoodMenuItems(selectedFoodAppt).find((menuItem: any) => menuItem.id === selectedDrinkItemId)
                : null
        ].filter(Boolean)

        if (!selectedItems.length) {
            message.error('Please choose from the menu.')
            return
        }
        if (selectedItems.length !== [selectedMealItemId, selectedDrinkItemId].filter(Boolean).length) {
            message.error('Selected menu item is invalid.')
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
                smeConfirmation: 'confirmed',
                updatedAt: serverTimestamp()
            })

            const assignedInterventionId = String(
                (selectedFoodAppt as any)?.assignedInterventionId || ''
            ).trim()
            if (assignedInterventionId) {
                try {
                    await acceptAssignedIntervention(db, assignedInterventionId)
                } catch {
                    // Not awaiting acceptance - nothing to do.
                }
            }

            const wasAlreadyConfirmed =
                String(selectedFoodAppt.userConfirmation || '').toLowerCase() === 'confirmed'
            message.success(
                wasAlreadyConfirmed
                    ? 'Food selection saved.'
                    : 'Appointment confirmed and food menu choice saved.'
            )
            setAppointments(prev =>
                prev.map(a =>
                    a.id === selectedFoodAppt.id
                        ? { ...a, foodSelections: updatedSelections, userConfirmation: 'confirmed' }
                        : a
                )
            )
            if (selectedAppt?.id === selectedFoodAppt.id) {
                setSelectedAppt({
                    ...selectedAppt,
                    foodSelections: updatedSelections,
                    userConfirmation: 'confirmed'
                })
            }
            setFoodMenuModalOpen(false)
            setSelectedFoodAppt(null)
            setSelectedMealItemId(null)
            setSelectedDrinkItemId(null)
        } catch (e) {
            console.error(e)
            message.error('Failed to save food selection.')
        } finally {
            setSavingFoodSelection(false)
        }
    }

    const openDeclineAppointment = (apptId: string) => {
        setDeclineApptId(apptId)
        setDeclineApptReasonCode(undefined)
        setDeclineApptReason('')
        setDeclineApptProposals([createAppointmentProposalDraft()])
        setDeclineApptOpen(true)
    }

    const submitDeclineAppointment = async () => {
        if (!declineApptId) return
        let reason
        try {
            reason = buildAppointmentDeclineReason(
                declineApptReasonCode,
                declineApptReason
            )
        } catch (error: any) {
            message.warning(error?.message || 'Please provide a reason.')
            return
        }

        const decliningAppointment = appointments.find(
            appointment => appointment.id === declineApptId
        )
        const canProposeTime =
            !decliningAppointment?.isGroupAppointment &&
            appointmentDeclineReasonAllowsTimeProposal(reason.code)
        let rescheduleProposals: ReturnType<typeof buildAppointmentRescheduleProposals> = []
        try {
            rescheduleProposals = canProposeTime
                ? buildAppointmentRescheduleProposals(declineApptProposals)
                : []
        } catch (error: any) {
            message.warning(error?.message || 'Check the proposed appointment times.')
            return
        }

        try {
            await updateDoc(doc(db, 'appointments', declineApptId), {
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
                updatedAt: serverTimestamp()
            })

            // Declining an appointment that's still awaiting the SME's initial
            // acceptance declines the underlying assignment too. A no-op
            // (already resolved, or a later appointment in the same
            // intervention) throws and is safe to ignore here.
            const assignedInterventionId = String(
                appointments.find(a => a.id === declineApptId)?.assignedInterventionId || ''
            ).trim()
            if (assignedInterventionId) {
                try {
                    await declineAssignedIntervention(db, assignedInterventionId, reason.text)
                } catch {
                    // Not awaiting acceptance - nothing to do.
                }
            }

            message.success('Appointment declined.')
            setDeclineApptOpen(false)
            setDeclineApptId(null)
            setDeclineApptReasonCode(undefined)
            setDeclineApptReason('')
            setDeclineApptProposals([createAppointmentProposalDraft()])
        } catch (e) {
            console.error(e)
            message.error('Failed to decline appointment.')
        }
    }


    /** -----------------
     *  Pending interventions actions
     *  ----------------- */
    // Accept / decline now happens by responding to the intervention's
    // appointment invite (see the Schedule section) rather than here.

    const handleRejectCompletion = async () => {
        if (!selectedIntervention || !rejectReason.trim()) return message.warning('Please provide a reason.')
        await rejectCompletionAction(db, selectedIntervention.id, rejectReason, {
            deptName: user?.departmentName,
            uid: user?.uid
        })
        message.success('Completion rejected and logged.')
        setIsRejectModalVisible(false)
        setRejectReason('')
    }

    const handleConfirmCompletion = async () => {
        if (!selectedIntervention) return

        const interventionId = selectedIntervention.id

        if (confirmSubmitting) return
        if (completionSubmitLock.current === interventionId) return

        if (!user?.signatureURL) {
            Modal.confirm({
            okButtonProps: { shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } },
            cancelButtonProps: { shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } },
                title: 'Signature required',
                content:
                    'You must add your signature in Account Settings before you can confirm intervention completion.',
                okText: 'Go to Account Settings',
                cancelText: 'Cancel',
                onOk: () => requestOpenAccountSettings()
            })
            return
        }

        try {
            completionSubmitLock.current = interventionId
            setConfirmSubmitting(true)

            await confirmCompletionAction(
                db,
                interventionId,
                {
                    rating: feedbackRating || 0,
                    comments: feedbackComments?.trim() || ''
                },
                {
                    signerSignatureUrl: user.signatureURL
                }
            )

            // Close first so the user gets immediate feedback that action is done
            setConfirmModalVisible(false)

            // Optimistic local cleanup
            setPendingInterventions(prev => prev.filter(p => p.id !== interventionId))

            setAllInterventions(prev =>
                prev.map(it =>
                    it.id === interventionId
                        ? {
                            ...it,
                            participantCompletionStatus: 'confirmed',
                            assignmentStatus: 'completed'
                        }
                        : it
                )
            )

            setSelectedIntervention(null)
            setFeedbackRating(0)
            setFeedbackComments('')

            message.success('Intervention completion confirmed successfully.')
        } catch (error: any) {
            console.error('Error confirming completion:', error)

            const raw = String(error?.message || '').toLowerCase()
            const currentId = selectedIntervention?.id

            const alreadyGone =
                !!currentId &&
                !pendingInterventions.some(it => it.id === currentId)

            if (
                alreadyGone ||
                raw.includes('unsupported field value: undefined') ||
                raw.includes('transaction.update() called with invalid data')
            ) {
                setConfirmModalVisible(false)
                setSelectedIntervention(null)
                setFeedbackRating(0)
                setFeedbackComments('')

                message.success('Intervention completion confirmed successfully.')
                return
            }

            message.error('Failed to confirm completion. Please try again.')
        } finally {
            completionSubmitLock.current = null
            setConfirmSubmitting(false)
        }
    }

    /** -----------------
     *  Pending interventions columns
     *  ----------------- */
    const pendingColumns = [
        {
            title: 'Intervention',
            dataIndex: 'title',
            key: 'title',
            width: 260,
            render: (value: string, record: any) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{value || 'Untitled intervention'}</Text>
                    {record.subIntervention && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {record.subIntervention}
                        </Text>
                    )}
                </Space>
            )
        },
        {
            title: 'Facilitator',
            dataIndex: 'facilitator',
            key: 'facilitator',
            width: 180,
            render: (value: string) => <Text>{value || 'Not assigned yet'}</Text>
        },
        { title: 'Due', dataIndex: 'date', key: 'date', width: 110 },
        {
            title: 'Action',
            key: 'action',
            width: 190,
            render: (_: any, record: any) => (
                <Space data-guide="incubatee-completion-actions">
                    <Button
                        shape='round'
                        variant='filled'
                        color='geekblue'
                        style={{ border: '1px solid dodgerblue' }}
                        icon={<CheckCircleOutlined />}
                        onClick={() => {
                            requireSignatureForCompletion(() => {
                                setSelectedIntervention(record.full)
                                setCompletionReviewStep(0)
                                setConfirmModalVisible(true)
                            })
                        }}
                    >
                        Confirm
                    </Button>
                    <Button
                        danger
                        shape='round'
                        variant='filled'
                        style={{ border: '1px solid crimson' }}
                        icon={<CloseOutlined />}
                        onClick={() => {
                            setSelectedIntervention(record.full)
                            setIsRejectModalVisible(true)
                        }}
                    >
                        Reject
                    </Button>
                </Space>
            )
        }
    ]

    /** -----------------
     *  Schedule table (Appointments)
     *  ----------------- */
    type ScheduleRow = {
        rowType: 'appointment'
        title: string
        deliveryLabel: string
        statusLabel: string
        confirmState: string
        link?: string
        location?: string
        raw: Appointment
        _n: { date: string; start: string; end: string; sortKey: string }
    } & Pick<Appointment, 'id' | 'date' | 'startTime' | 'endTime'>

    const scheduleRows: ScheduleRow[] = useMemo(() => {
        const apptRows: Omit<ScheduleRow, '_n'>[] = appointments.map(a => {
            const deliveryLabel = formatDeliveryMethod(a as any)

            const confirmState = String(a.userConfirmation || 'pending')
            const statusLabel = formatAppointmentStatus(a as any)
            const isDeclined = confirmState.toLowerCase() === 'declined'

            return {
                rowType: 'appointment',
                id: a.id,
                title: a.interventionTitle || 'Appointment',
                deliveryLabel,
                statusLabel,
                confirmState: confirmState.toLowerCase(),
                // Don't surface a join link once the participant has declined.
                link: isDeclined ? undefined : a.meetingLink,
                location: a.location,
                date: a.date,
                startTime: a.startTime,
                endTime: a.endTime,
                raw: a
            }
        })

        return apptRows
            .map(r => {
                const n = normalizeSchedule(r)
                return { ...r, _n: n }
            })
            .sort((a: any, b: any) => a._n.sortKey.localeCompare(b._n.sortKey)) as any
    }, [appointments])

    const schedulePendingCount = useMemo(() => {
        return scheduleRows.filter(r => String(r.confirmState || '').toLowerCase() === 'pending').length
    }, [scheduleRows])

    const renderScheduleActions = (r: ScheduleRow) => {
                const isPending = String(r.confirmState || 'pending').toLowerCase() === 'pending'
                const isConfirmed = String(r.confirmState || '').toLowerCase() === 'confirmed'
                const hasFoodMenu =
                    r.raw?.deliveryMethod === 'in_person' &&
                    r.raw?.foodMenuEnabled &&
                    getFoodMenuItems(r.raw as Appointment).length > 0
                const hasFoodSelection =
                    (getFoodSelectionsForParticipant(r.raw as Appointment, participantId) || []).length > 0

                return (
                    <Space data-guide="incubatee-schedule-actions" wrap style={{ marginTop: 8 }}>
                        <Button
                            size="small"
                            onClick={() => {
                                setSelectedAppt(r.raw as Appointment)
                                setApptDetailsOpen(true)
                            }}
                        >
                            Details
                        </Button>

                        {r.link ? (
                            <Button
                                size="small"
                                shape="round"
                                variant="filled"
                                color="green"
                                style={{ border: '1px solid green' }}
                                icon={<EyeOutlined />}
                                onClick={() => window.open(r.link, '_blank')}
                            >
                                Open Link
                            </Button>
                        ) : null}

                        {isConfirmed && hasFoodMenu ? (
                            <Button
                                size="small"
                                shape="round"
                                onClick={() => openAppointmentFoodMenu(r.raw as Appointment)}
                            >
                                {hasFoodSelection ? 'Update Food' : 'Choose Food'}
                            </Button>
                        ) : null}

                        {isPending && (
                            <>
                                <Button
                                    size="small"
                                    shape="round"
                                    variant="filled"
                                    color="geekblue"
                                    style={{ border: '1px solid dodgerblue' }}
                                    type="primary"
                                    icon={<CheckCircleOutlined />}
                                    onClick={() => handleConfirmAppointment(r.raw as Appointment)}
                                >
                                    Confirm
                                </Button>
                                <Button
                                    size="small"
                                    danger
                                    shape="round"
                                    variant="filled"
                                    style={{ border: '1px solid red' }}
                                    icon={<CloseOutlined />}
                                    onClick={() => openDeclineAppointment(r.id)}
                                >
                                    Decline
                                </Button>
                            </>
                        )}
                    </Space>
                )
    }

    /** -----------------
     *  Top metrics (map-driven, responsive)
     *  ----------------- */
    const topMetrics: DashboardMetric[] = useMemo(() => [
        {
            key: 'outstanding-documents',
            important: true,
            icon: <FileTextOutlined style={{ fontSize: 20, color: '#fa8c16' }} />,
            iconBg: 'rgba(250,140,22,.14)',
            title: 'Outstanding Documents',
            mobileTitle: 'Documents',
            value: complianceUnavailable ? '—' : outstandingDocs,
            onClick: () => setComplianceModalOpen(true),
            subtitle:
                complianceUnavailable ? 'View compliance document status' : outstandingDocs > 0
                    ? 'View outstanding compliance documents'
                    : 'Required compliance documents are up to date',
            mobileSubtitle: complianceUnavailable ? 'View status' : outstandingDocs > 0 ? 'View documents' : 'Up to date'
        },
        {
            key: 'interventions-distribution',
            important: true,
            icon: <RatioIcon size={20} color="#52c41a" />,
            iconBg: 'rgba(82,196,26,.14)',
            title: 'Interventions Distribution',
            mobileTitle: 'Interventions',
            value: `${completedInterventions}/${requiredInterventions}`,
            subtitle:
                requiredInterventions > 0
                    ? `${Math.max(requiredInterventions - completedInterventions, 0)} remaining`
                    : 'No required interventions defined yet',
            mobileSubtitle:
                requiredInterventions > 0
                    ? `${Math.max(requiredInterventions - completedInterventions, 0)} left`
                    : 'None defined'
        }
    ], [completedInterventions, requiredInterventions, outstandingDocs, complianceUnavailable])

    /** -----------------
     *  Render
     *  ----------------- */
    return (
        <>
            {loading ? (
                <div style={{ padding: screens.md ? 24 : 12 }}>
                    <LoadingOverlay tip='Getting everything ready' />
                </div>

            ) : (
                <>
                    <div
                        className='incubatee-dashboard'
                        style={{ padding: screens.md ? 24 : 12 }}
                    >
                        <Helmet>
                            <title>Smart Incubation | Incubatee Dashboard</title>
                        </Helmet>

                        <Row gutter={[16, 16]}>
                            {/* Top stats */}
                            <Col span={24} data-guide="incubatee-dashboard-metrics">
                                <MetricsGrid metrics={topMetrics} />
                            </Col>

                            {!hasUrgentAction && pendingInterventions.length === 0 && pendingDpConfirmations.length === 0 &&
                                schedulePendingCount === 0 && outstandingDocs === 0 && !complianceUnavailable &&
                                !appointmentsLoading && !appointmentError && acceptedApp && (
                                    <Col span={24}>
                                        <Alert type="success" showIcon message="You're all caught up"
                                            description="No outstanding documents or confirmations. See your progress and upcoming appointments below." />
                                    </Col>
                                )}

                            {(pendingInterventions.length > 0 || hasUrgentAction || pendingDpConfirmations.length > 0) && (
                                <Col span={24}>
                                    <div className={pendingInterventions.length > 0 && (hasUrgentAction || pendingDpConfirmations.length > 0) ? 'incubatee-action-layout' : 'incubatee-action-layout incubatee-action-layout-single'}>
                            {/* Completion decisions are placed first so they are visible above the fold. */}
                            {pendingInterventions.length > 0 && (
                                <div className="incubatee-completion-column">
                                    <Card
                                        data-guide="incubatee-pending-completions"
                                        className="incubatee-dashboard-pending-card"
                                        size="small"
                                        style={{
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.09)',
                                            borderRadius: 12,
                                            border: '1px solid #d6e4ff'
                                        }}
                                        title={
                                            <Space>
                                            <CheckCircleOutlined />
                                            <span>Pending Completion Confirmations</span>
                                            {pendingInterventions.length > 0 && (
                                                <Tag color="orange">{pendingInterventions.length}</Tag>
                                            )}
                                        </Space>
                                    }
                                >
                                    {screens.md ? (
                                            <Table
                                                className="incubatee-dashboard-pending-table"
                                                size="small"
                                                dataSource={pendingInterventions}
                                                columns={pendingColumns as any}
                                                rowKey="id"
                                                scroll={{ x: 'max-content' }}
                                                pagination={{
                                                    pageSize: 3,
                                                    hideOnSinglePage: true,
                                                    responsive: true,
                                                    showSizeChanger: false,
                                                    position: ['bottomCenter']
                                                }}
                                            />
                                        ) : (
                                            <List
                                                className='incubatee-dashboard-mobile-list'
                                                itemLayout="vertical"
                                                dataSource={pendingInterventions}
                                                pagination={{
                                                    pageSize: 3,
                                                    hideOnSinglePage: true,
                                                    size: 'small'
                                                }}
                                                renderItem={(item: any) => (
                                                    <List.Item className='incubatee-dashboard-mobile-card'>
                                                        <List.Item.Meta
                                                            title={
                                                                <Space direction="vertical" size={0}>
                                                                    <Text strong>{item.title}</Text>
                                                                    {item.subIntervention && (
                                                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                                                            {item.subIntervention}
                                                                        </Text>
                                                                    )}
                                                                </Space>
                                                            }
                                                            description={
                                                                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                                                    <Space wrap>
                                                                        <Text type="secondary">
                                                                            Facilitator: {item.facilitator || 'Not assigned yet'}
                                                                        </Text>
                                                                        <Text type="secondary">Due: {item.date || '-'}</Text>
                                                                    </Space>
                                                                    <div
                                                                        data-guide="incubatee-completion-actions"
                                                                        className='incubatee-dashboard-card-actions'
                                                                    >
                                                                        <Button
                                                                            size="small"
                                                                            type="primary"
                                                                            icon={<CheckCircleOutlined />}
                                                                            onClick={() => {
                                                                                requireSignatureForCompletion(() => {
                                                                                    setSelectedIntervention(item.full)
                                                                                    setCompletionReviewStep(0)
                                                                                    setConfirmModalVisible(true)
                                                                                })
                                                                            }}
                                                                        >
                                                                            Confirm
                                                                        </Button>
                                                                        <Button
                                                                            size="small"
                                                                            danger
                                                                            icon={<CloseOutlined />}
                                                                            onClick={() => {
                                                                                setSelectedIntervention(item.full)
                                                                                setIsRejectModalVisible(true)
                                                                            }}
                                                                        >
                                                                            Reject
                                                                        </Button>
                                                                    </div>
                                                                </Space>
                                                            }
                                                        />
                                                    </List.Item>
                                                )}
                                            />
                                        )}
                                </Card>
                                </div>
                            )}

                            <div className="incubatee-action-sidebar">
                            {/* Urgent documents sit beside confirmations on desktop. */}
                            {hasUrgentAction && (
                                <div>
                                    <Card
                                        data-guide="incubatee-urgent-action"
                                        size="small"
                                        hoverable
                                        title="Urgent Action"
                                        extra={
                                            <Space>
                                                {otherUnsignedCount > 0 && (
                                                    <Button
                                                        size="small"
                                                        onClick={() => navigate('/incubatee/documents/compliance')}
                                                        icon={<FileDoneOutlined />}
                                                    >
                                                        View All
                                                    </Button>
                                                )}
                                                <Tag color="red">{urgentItems.length}</Tag>
                                            </Space>
                                        }
                                        style={{
                                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                            transition: 'all 0.3s ease',
                                            borderRadius: 12,
                                            border: '1px solid #d6e4ff'
                                        }}
                                    >
                                        <List
                                            className='incubatee-urgent-list'
                                            itemLayout="horizontal"
                                            dataSource={urgentItems.slice(0, 3)}
                                            renderItem={(it: UrgentItem) => (
                                                <List.Item
                                                    actions={[
                                                        <Button key="go" type="primary" size="small" onClick={it.onClick}>
                                                            {it.cta}
                                                        </Button>
                                                    ]}
                                                >
                                                    <List.Item.Meta
                                                        title={
                                                            <>
                                                                {it.title}{' '}
                                                                <Tag color={it.kind === 'survey' ? 'blue' : 'purple'}>
                                                                    {it.tag || (it.kind === 'survey' ? 'Survey' : 'Contract')}
                                                                </Tag>
                                                            </>
                                                        }
                                                        description={it.subtitle}
                                                    />
                                                </List.Item>
                                            )}
                                        />
                                    </Card>
                                </div>
                            )}

                            {pendingDpConfirmations.length > 0 && (
                                <div>
                                    <Card
                                        data-guide="incubatee-pending-dp-confirmations"
                                        size="small"
                                        title={
                                            <Space size={6} wrap>
                                                <FileDoneOutlined />
                                                <span>Pending DP Confirmations</span>
                                                <Tag color="orange">{pendingDpConfirmations.length}</Tag>
                                            </Space>
                                        }
                                        extra={
                                            <Button
                                                type="link"
                                                size="small"
                                                onClick={() => navigate('/incubatee/roadmap')}
                                            >
                                                View all
                                            </Button>
                                        }
                                        style={{
                                            width: '100%',
                                            maxWidth: '100%',
                                            borderRadius: 12,
                                            border: '1px solid #d6e4ff',
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.09)'
                                        }}
                                    >
                                        <List
                                            size="small"
                                            dataSource={pendingDpConfirmations.slice(0, 3)}
                                            renderItem={item => (
                                                <List.Item
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        gap: 16,
                                                        paddingInline: 0
                                                    }}
                                                >
                                                    <Text strong>{item.departmentName}</Text>
                                                    <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                                                        {item.departmentCompletedAt
                                                            ? dayjs(item.departmentCompletedAt).format('DD MMM YYYY')
                                                            : 'Date unavailable'}
                                                    </Text>
                                                </List.Item>
                                            )}
                                        />
                                    </Card>
                                </div>
                            )}

                            </div>
                                    </div>
                                </Col>
                            )}

                            <Col xs={24}>
                                <DashboardOverview
                                    key={participantId + ':' + (activeProgramId || '')}
                                    rows={scheduleRows}
                                    recentCompletions={recentCompletions}
                                    appointmentsLoading={appointmentsLoading}
                                    appointmentError={appointmentError}
                                    renderActions={renderScheduleActions}
                                    onViewAppointments={() => navigate('/incubatee/appointments')}
                                    onViewInterventions={() => navigate('/incubatee/interventions')}
                                />
                            </Col>

                        </Row>

                        <Modal okButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }} cancelButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }} title="Outstanding Compliance Documents" open={complianceModalOpen}
                            onCancel={() => setComplianceModalOpen(false)}
                            footer={[
                                <Button key="close" onClick={() => setComplianceModalOpen(false)}>Close</Button>,
                                <Button key="manage" type="primary" onClick={() => {
                                    setComplianceModalOpen(false)
                                    navigate('/incubatee/documents/compliance')
                                }}>Manage compliance documents</Button>
                            ]}>
                            {complianceError || requirementsError ? <Alert type="error" showIcon message={complianceError || requirementsError} /> :
                                <List loading={complianceLoading || requirementsLoading}
                                    dataSource={outstandingComplianceRows}
                                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description={!acceptedApp ? 'No accepted programme application found.' : complianceRows.length ? 'All required compliance documents are up to date.' : 'No compliance document requirements configured yet.'} /> }}
                                    renderItem={row => <List.Item key={row.key}>
                                        <List.Item.Meta title={row.title}
                                            description={row.expiry ? `Expiry: ${dayjs(row.expiry).format('D MMM YYYY')}` : undefined} />
                                        <Tag color={row.status === 'pending' ? 'orange' : 'red'}>{row.status === 'pending' ? 'Pending review' : titleCase(row.status)}</Tag>
                                    </List.Item>} />}
                        </Modal>

                        {/* Appointment details */}
                        <Modal okButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }} cancelButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }}
                            title="Appointment Details"
                            open={apptDetailsOpen}
                            onCancel={() => {
                                setApptDetailsOpen(false)
                                setSelectedAppt(null)
                            }}
                            footer={[
                                <Button
                                    key="close"
                                    onClick={() => {
                                        setApptDetailsOpen(false)
                                        setSelectedAppt(null)
                                    }}
                                >
                                    Close
                                </Button>,
                                selectedAppt &&
                                    String(selectedAppt.userConfirmation || 'pending').toLowerCase() === 'pending' ? (
                                    <Button
                                        key="confirm"
                                        type="primary"
                                        icon={<CheckCircleOutlined />}
                                        onClick={() => handleConfirmAppointment(selectedAppt)}
                                    >
                                        Confirm
                                    </Button>
                                ) : null
                            ]}
                        >
                            {selectedAppt ? (
                                <Descriptions bordered size="small" column={1}>
                                    <Descriptions.Item label="Participant">{selectedAppt.participantName || '-'}</Descriptions.Item>
                                    <Descriptions.Item label="Facilitator">{getAppointmentAssigneeName(selectedAppt as any) || '-'}</Descriptions.Item>
                                    <Descriptions.Item label="Intervention">{selectedAppt.interventionTitle || '-'}</Descriptions.Item>
                                    <Descriptions.Item label="Session">
                                        {selectedAppt.sessionTitle || selectedAppt.sessionCoverage?.title || '-'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label="Topics to Be Covered">
                                        {getAppointmentPlannedCoverage(selectedAppt).length ? (
                                            <List
                                                size="small"
                                                split={false}
                                                dataSource={getAppointmentPlannedCoverage(selectedAppt)}
                                                renderItem={(topic, index) => (
                                                    <List.Item style={{ padding: '2px 0' }}>
                                                        <Text>{index + 1}. {topic}</Text>
                                                    </List.Item>
                                                )}
                                            />
                                        ) : (
                                            <Text type="secondary">No topics provided</Text>
                                        )}
                                    </Descriptions.Item>
                                    <Descriptions.Item label="Date">{selectedAppt.date ? fmtDateStr(selectedAppt.date) : '-'}</Descriptions.Item>
                                    <Descriptions.Item label="Time">
                                        {fmtTimeFromAny(selectedAppt.startTime) || '-'}
                                        {fmtTimeFromAny(selectedAppt.endTime) ? ` - ${fmtTimeFromAny(selectedAppt.endTime)}` : ''}
                                    </Descriptions.Item>
                                    <Descriptions.Item label="Delivery Method">{formatDeliveryMethod(selectedAppt as any)}</Descriptions.Item>
                                    {getDeliveryMethod(selectedAppt as any) === 'virtual' &&
                                        selectedAppt.meetingLink &&
                                        String(selectedAppt.userConfirmation || '').toLowerCase() !== 'declined' ? (
                                        <Descriptions.Item label="Meeting Link">{selectedAppt.meetingLink}</Descriptions.Item>
                                    ) : null}
                                    {getDeliveryMethod(selectedAppt as any) === 'in_person' && selectedAppt.location ? (
                                        <Descriptions.Item label="Location">{selectedAppt.location}</Descriptions.Item>
                                    ) : null}
                                    {getDeliveryMethod(selectedAppt as any) === 'in_person' && selectedAppt.foodMenuEnabled && getFoodMenuItems(selectedAppt).length ? (
                                        <Descriptions.Item label="Food Selection">
                                            {formatFoodSelections(selectedAppt, participantId) || 'Not selected'}
                                        </Descriptions.Item>
                                    ) : null}
                                    <Descriptions.Item label="Status">{formatAppointmentStatus(selectedAppt as any)}</Descriptions.Item>
                                    <Descriptions.Item label="Your Confirmation">{titleCase(getConfirmationStatus(selectedAppt.userConfirmation))}</Descriptions.Item>
                                    {String(selectedAppt.userConfirmation || '').toLowerCase() === 'declined' && selectedAppt.declineReason ? (
                                        <Descriptions.Item label="Decline Reason">{selectedAppt.declineReason}</Descriptions.Item>
                                    ) : null}
                                </Descriptions>
                            ) : (
                                <Empty description="No appointment selected" />
                            )}
                        </Modal>

                        <Modal okButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }} cancelButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }}
                            title="Food Menu Selection"
                            open={foodMenuModalOpen}
                            onOk={saveFoodSelectionAndConfirm}
                            onCancel={() => {
                                setFoodMenuModalOpen(false)
                                setSelectedFoodAppt(null)
                                setSelectedMealItemId(null)
                                setSelectedDrinkItemId(null)
                            }}
                            confirmLoading={savingFoodSelection}
                            okText={
                                String(selectedFoodAppt?.userConfirmation || '').toLowerCase() === 'confirmed'
                                    ? 'Save Food Selection'
                                    : 'Confirm & Save'
                            }
                        >
                            {selectedFoodAppt ? (
                                <div>
                                    <p style={{ marginBottom: 12, color: 'rgba(0,0,0,0.65)' }}>
                                        Choose your meal and drink for the in-person appointment.
                                    </p>
                                    {getMealMenuItems(selectedFoodAppt).length ? (
                                        <>
                                            <Divider orientation="left">Meal</Divider>
                                            <Radio.Group
                                                value={selectedMealItemId}
                                                onChange={e => setSelectedMealItemId(e.target.value)}
                                                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                                            >
                                                {getMealMenuItems(selectedFoodAppt).map((item: any) => (
                                                    <Radio key={item.id} value={item.id}>
                                                        {item.name || item.label}
                                                    </Radio>
                                                ))}
                                            </Radio.Group>
                                        </>
                                    ) : null}
                                    {getDrinkMenuItems(selectedFoodAppt).length ? (
                                        <>
                                            <Divider orientation="left">Drink</Divider>
                                            <Radio.Group
                                                value={selectedDrinkItemId}
                                                onChange={e => setSelectedDrinkItemId(e.target.value)}
                                                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                                            >
                                                {getDrinkMenuItems(selectedFoodAppt).map((item: any) => (
                                                    <Radio key={item.id} value={item.id}>
                                                        {item.name || item.label}
                                                    </Radio>
                                                ))}
                                            </Radio.Group>
                                        </>
                                    ) : null}
                                </div>
                            ) : (
                                <Empty description="No appointment selected" />
                            )}
                        </Modal>

                        <Modal cancelButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }}
                            title="Decline Appointment"
                            open={declineApptOpen}
                            onOk={submitDeclineAppointment}
                            onCancel={() => {
                                setDeclineApptOpen(false)
                                setDeclineApptId(null)
                                setDeclineApptReasonCode(undefined)
                                setDeclineApptReason('')
                                setDeclineApptProposals([createAppointmentProposalDraft()])
                            }}
                            okButtonProps={{ danger: true, shape: 'round', variant: 'filled', style: { border: '1px solid crimson' } }}
                            okText="Decline"
                        >
                            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                                Please tell the facilitator why you cannot attend.
                            </Text>
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                <Select
                                    value={declineApptReasonCode}
                                    onChange={value => {
                                        setDeclineApptReasonCode(value)
                                        if (value !== 'other') setDeclineApptReason('')
                                    }}
                                    placeholder="Select a reason"
                                    style={{ width: '100%' }}
                                    options={APPOINTMENT_DECLINE_REASON_OPTIONS.map(option => ({
                                        value: option.value,
                                        label: option.label
                                    }))}
                                />
                                {declineApptReasonCode === 'other' ? (
                                    <Input.TextArea
                                        rows={4}
                                        value={declineApptReason}
                                        onChange={e => setDeclineApptReason(e.target.value)}
                                        placeholder="Provide your reason in your own words"
                                        maxLength={500}
                                        showCount
                                    />
                                ) : null}
                                {declineApptId &&
                                    !appointments.find(appointment => appointment.id === declineApptId)?.isGroupAppointment &&
                                    appointmentDeclineReasonAllowsTimeProposal(declineApptReasonCode) ? (
                                    <>
                                        <Divider style={{ margin: '4px 0' }} />
                                        <AppointmentRescheduleProposalFields
                                            value={declineApptProposals}
                                            onChange={setDeclineApptProposals}
                                        />
                                    </>
                                ) : null}
                            </Space>
                        </Modal>
                    </div>

                    {/* Reject completion modal */}
                    <Modal cancelButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }}
                        title="Reject Completion"
                        open={isRejectModalVisible}
                        onCancel={() => {
                            setIsRejectModalVisible(false)
                            setRejectReason('')
                        }}
                        onOk={handleRejectCompletion}
                        okButtonProps={{ danger: true, shape: 'round', variant: 'filled', style: { border: '1px solid crimson' } }}
                        okText="Submit Rejection"
                    >
                        <Input.TextArea
                            rows={4}
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="Please explain why you’re rejecting this intervention’s completion..."
                        />
                    </Modal>

                    {/* Confirm completion modal */}
                    <Modal okButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }} cancelButtonProps={{ shape: 'round', variant: 'filled', color: 'geekblue', style: { border: '1px solid dodgerblue' } }}
                        title="Confirm Intervention Completion"
                        open={confirmModalVisible}
                        centered
                        width={screens.xs ? '100%' : 720}
                        style={screens.xs ? { top: 0, paddingBottom: 0 } : undefined}
                        bodyStyle={screens.xs ? { maxHeight: '70vh', overflowY: 'auto' } : undefined}
                        destroyOnClose
                        afterClose={() => {
                            setSelectedIntervention(null)
                            setFeedbackRating(0)
                            setFeedbackComments('')
                            setCompletionReviewStep(0)
                        }}
                        footer={[
                            <Button
                                key="reject"
                                danger
                                shape='round' variant='filled' style={{ border: '1px solid crimson' }}
                                icon={<CloseOutlined />}
                                disabled={confirmSubmitting}
                                onClick={() => {
                                    setConfirmModalVisible(false)
                                    setIsRejectModalVisible(true)
                                }}
                            >
                                Reject Completion
                            </Button>,
                            <Button
                                key="submit"
                                shape="round"
                                variant="filled"
                                color="geekblue"
                                style={{ border: '1px solid dodgerblue', minWidth: 180 }}
                                icon={<CheckCircleOutlined />}
                                loading={confirmSubmitting}
                                onClick={() => {
                                    if (completionReviewStep === 0) setCompletionReviewStep(1)
                                    else handleConfirmCompletion()
                                }}
                                disabled={!user?.signatureURL || confirmSubmitting || !selectedIntervention}
                            >
                                {confirmSubmitting
                                    ? 'Confirming...'
                                    : completionReviewStep === 0
                                        ? 'Review delivery'
                                        : 'Confirm Completion'}
                            </Button>
                        ]}
                        onCancel={() => {
                            if (confirmSubmitting) return
                            if (completionReviewStep === 1) {
                                setCompletionReviewStep(0)
                                return
                            }
                            setConfirmModalVisible(false)
                            setSelectedIntervention(null)
                        }}
                    >
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            {completionReviewStep === 0 ? (
                                <>
                                    <Alert
                                        type="info"
                                        showIcon
                                        message="Review the delivered work before confirming."
                                        description="Only continue when the intervention and the sessions you attended are correct."
                                    />

                                    <Card size="small" title={selectedIntervention?.interventionTitle || 'Intervention'}>
                                        <Descriptions size="small" column={1}>
                                            <Descriptions.Item label="Sessions attended">
                                                {attendedCompletionAppointments.length} of {completionAppointments.length}
                                            </Descriptions.Item>
                                        </Descriptions>
                                    </Card>

                                    {completionAppointments.length ? (
                                        <List
                                            size="small"
                                            bordered
                                            dataSource={completionAppointments}
                                            renderItem={appointment => {
                                                const topics = appointment.sessionCoverage?.latest?.coveredPoints || appointment.plannedCoverage || []
                                                return (
                                                    <List.Item>
                                                        <Space direction="vertical" size={2}>
                                                            <Text strong>{dayjs(appointment.startTime?.toDate?.() || appointment.startTime || appointment.date).format('DD MMM YYYY')} · {appointment.sessionTitle || appointment.interventionTitle}</Text>
                                                            <Text type="secondary">Attendance: {String(appointment.attendance?.status || 'not recorded').replace(/-/g, ' ')}</Text>
                                                            {topics.length ? <Text type="secondary">Covered: {topics.join(', ')}</Text> : null}
                                                        </Space>
                                                    </List.Item>
                                                )
                                            }}
                                        />
                                    ) : (
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No session records are available for this intervention." />
                                    )}
                                </>
                            ) : (
                                <>
                                    <Alert
                                        type="warning"
                                        showIcon
                                        message="By confirming, your digital signature will be attached to the official MOV for this intervention."
                                    />

                                    <Card
                                        size="small"
                                        style={{
                                            borderRadius: 12,
                                            border: '1px solid #d9e8ff',
                                            background: '#f8fbff'
                                        }}
                                    >
                                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                            <Text type="secondary">Intervention</Text>
                                            <Text strong style={{ fontSize: 16 }}>
                                                {selectedIntervention?.interventionTitle || '-'}
                                            </Text>
                                            <Text type="secondary">
                                                Please confirm that this intervention was completed successfully.
                                            </Text>
                                        </Space>
                                    </Card>

                                    <Card
                                        size="small"
                                        style={{
                                            borderRadius: 12,
                                            border: '2px solid #ffe7ba',
                                            background: '#fffaf0'
                                        }}
                                    >
                                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                            <Text strong style={{ fontSize: 16 }}>
                                                Rate the quality of delivery
                                            </Text>

                                            <Rate
                                                value={feedbackRating}
                                                onChange={setFeedbackRating}
                                                style={{
                                                    fontSize: 32,
                                                    display: 'block'
                                                }}
                                            />

                                            <Text type="secondary">
                                                Tap a star to rate the facilitator’s delivery.
                                            </Text>
                                        </Space>
                                    </Card>

                                    <div>
                                        <Text strong style={{ display: 'block', marginBottom: 8 }}>
                                            Comment on the facilitator's conduct
                                        </Text>
                                        <Input.TextArea
                                            rows={4}
                                            placeholder="Add any feedback about professionalism, punctuality, clarity, or support provided..."
                                            value={feedbackComments}
                                            onChange={e => setFeedbackComments(e.target.value)}
                                        />
                                    </div>
                                </>
                            )}
                        </Space>
                    </Modal>

                </>
            )}
        </>
    )
}
