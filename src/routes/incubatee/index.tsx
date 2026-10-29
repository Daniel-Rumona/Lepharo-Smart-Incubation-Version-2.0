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
    Tag,
    Grid,
    Space,
    Empty,
    Radio,
    Descriptions,
    Divider
} from 'antd'
import { DisputeDeliveryModal } from '@/components/queries/DisputeDeliveryModal'
import type { DisputeCategory } from '@/services/deliveryDisputeService'
import {
    CheckCircleOutlined,
    FileTextOutlined,
    CalendarOutlined,
    ClockCircleOutlined,
    CloseOutlined,
    EyeOutlined,
} from '@ant-design/icons'
import {
    doc,
    getDoc,
    collection,
    getDocs,
    query,
    where,
    onSnapshot,
    Timestamp
} from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLocation, useNavigate } from 'react-router-dom'
import { RatioIcon } from 'lucide-react'
import { requestOpenAccountSettings } from '@/lib/accountSettings'
import {
    confirmCompletion as confirmCompletionAction,
    rejectCompletion as rejectCompletionAction
} from '@/lib/interventions'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import DashboardOverview from '@/components/incubatee/DashboardOverview'
import NeedsAttentionCard, { type AttentionItem } from '@/components/incubatee/NeedsAttentionCard'
import Button from '@/components/incubatee/DashboardButton'
import { buildDashboardComplianceRows } from '@/lib/dashboardCompliance'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import {
    resolveComplianceRequirements,
    type ComplianceRequirement
} from '@/services/complianceResolver'
import {
    formatAppointmentStatus,
    formatDeliveryMethod,
    getAppointmentAssigneeName,
    getDeliveryMethod,
    getSmeResponseState,
    normalizeAppointmentRecord,
    SME_RESPONSE_META,
    titleCase
} from '@/services/appointmentService'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import DeclineAppointmentModal from '@/components/appointments/DeclineAppointmentModal'
import { confirmAppointmentResponse } from '@/services/appointmentResponses'
import { useSmeWaiting, type DocumentRow } from '@/components/incubatee/SmeWaiting'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import { useSigningCeremony } from '@/components/shared/SignatureAnimation'
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
    departmentId?: string | null
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
    /** Canonical v5 response field; kept in step with userConfirmation locally. */
    smeConfirmation?: ApptConfirmation | string
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
 *  Component
 *  =========================== */
export const IncubateeDashboard: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const signingCeremony = useSigningCeremony()
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const navigate = useNavigate()
    const location = useLocation()
    const { activeProgramId } = useActiveProgramId()
    // Everything waiting on the SME (plans, completions, agreements, forms,
    // appointments to answer) comes from the shared source the prompt also reads.
    const waiting = useSmeWaiting()

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
                            element: guideTarget('incubatee-needs-attention'),
                            skipMissingElement: true,
                            popover: {
                                title: 'Needs your attention',
                                description:
                                    'Everything waiting on you, in one list: completed work to confirm or reject, agreements and surveys, department plans to confirm, and appointments to respond to. It is hidden when nothing needs you.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('incubatee-attention-actions'),
                            skipMissingElement: true,
                            popover: {
                                title: 'Act on an item',
                                description:
                                    'Each item has its main action highlighted. Confirm completed work when the delivery is correct, or reject it with a reason when follow-up is needed.',
                                side: 'left',
                                align: 'center'
                            }
                        },
                        {
                            element: guideTarget('incubatee-schedule'),
                            skipMissingElement: true,
                            popover: {
                                title: 'Upcoming schedule',
                                description:
                                    'Review this week\'s appointments by day. Open one to see its details and link, choose food when available, and confirm or decline it.',
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
    const [confirmModalVisible, setConfirmModalVisible] = useState(false)
    const [selectedIntervention, setSelectedIntervention] =
        useState<AssignedIntervention | null>(null)
    const [feedbackRating, setFeedbackRating] = useState<number>(0)
    const [feedbackComments, setFeedbackComments] = useState<string>('')
    const [completionReviewStep, setCompletionReviewStep] = useState<0 | 1>(0)
    const [isRejectModalVisible, setIsRejectModalVisible] = useState(false)
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
    const [decliningAppt, setDecliningAppt] = useState<Appointment | null>(null)
    const [foodMenuModalOpen, setFoodMenuModalOpen] = useState(false)
    const [selectedFoodAppt, setSelectedFoodAppt] = useState<Appointment | null>(null)
    const [selectedMealItemId, setSelectedMealItemId] = useState<string | null>(null)
    const [selectedDrinkItemId, setSelectedDrinkItemId] = useState<string | null>(null)
    const [savingFoodSelection, setSavingFoodSelection] = useState(false)
    const [acceptedAppLoading, setAcceptedAppLoading] = useState(true)
    const [interventionsLoading, setInterventionsLoading] = useState(true)

    /** Agreements + GAP + modals */
    const [acceptedApp, setAcceptedApp] = useState<any>(null)
    const [participantComplianceDocs, setParticipantComplianceDocs] = useState<any[]>([])
    // Embedded documents come from where the Compliance pages read them: the
    // participant's array when it has entries, otherwise the application's.
    const complianceRows = useMemo(() => buildDashboardComplianceRows(
        complianceRequirements,
        participantComplianceDocs.length
            ? participantComplianceDocs
            : Array.isArray(acceptedApp?.complianceDocuments) ? acceptedApp.complianceDocuments : [],
        complianceUploads
    ), [complianceRequirements, participantComplianceDocs, acceptedApp?.complianceDocuments, complianceUploads])
    const outstandingComplianceRows = complianceRows.filter(row => row.outstanding)
    const outstandingDocs = outstandingComplianceRows.length
    const complianceUnavailable = complianceLoading || requirementsLoading || Boolean(complianceError || requirementsError)
    const [monthsInProgram, setMonthsInProgram] = useState<number>(0)

    /** Loading */
    const [loading, setLoading] = useState(true)

    /** Realtime unsub refs */
    const applicationsUnsub = useRef<null | (() => void)>(null)
    const interventionsUnsub = useRef<null | (() => void)>(null)
    const completionSubmitLock = useRef<string | null>(null)

    /** Documents (SURVEYS): all forms sent to the SME, from the shared source. */
    const documents: DocumentRow[] = waiting.forms

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

    const requireSignatureForCompletion = (onOk: () => void) => {
        if (user?.signatureURL) return onOk()
        Modal.confirm({
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
                // The rules only let staff scan the collection, so an SME's
                // scan is denied and simply finds nothing.
                if (!participantDoc) {
                    const participants = await getDocs(collection(db, 'participants')).catch(() => null)
                    participantDoc = participants?.docs.find(item =>
                        String(item.data()?.email || '').trim().toLowerCase() === email
                    ) || null
                }
            }

            if (cancelled) return
            setParticipantId(String(participantDoc?.id || ''))
            const participantDocuments = participantDoc?.data()?.complianceDocuments
            setParticipantComplianceDocs(Array.isArray(participantDocuments) ? participantDocuments : [])
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

    /** -----------------
     *  Live: applications (agreements, GAP, MOA)
     *  ----------------- */
    useEffect(() => {
        let disposed = false
        let revision = 0
        setAcceptedApp(null)
        setAcceptedAppLoading(Boolean(participantId))
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
                if (disposed || currentRevision !== revision) return
                setAcceptedApp(accepted)

                const acceptedAt = toDate(accepted?.acceptedAt || accepted?.dateAccepted) || new Date()
                setMonthsInProgram(dayjs().diff(dayjs(acceptedAt), 'month'))
                setAcceptedAppLoading(false)
            }
        )

        return () => { disposed = true; applicationsUnsub.current?.() }
    }, [participantId, activeProgramId])

    useEffect(() => {
        let disposed = false
        setComplianceRequirements([])
        setRequirementsError('')
        setRequirementsLoading(Boolean(acceptedApp?.programId))
        if (!acceptedApp?.programId) return
        resolveComplianceRequirements(acceptedApp.programId, { includeAllDepartments: true })
            .then(resolved => {
                if (disposed) return
                setComplianceRequirements(resolved.requirements)
                setRequirementsLoading(false)
            })
            .catch(error => {
                console.error('Failed to resolve dashboard agreements', error)
                if (!disposed) {
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
        setInterventionsLoading(Boolean(participantId))
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
                setInterventionsLoading(false)
            },
            error => {
                console.error('Dashboard interventions could not be loaded:', error)
                setInterventionsLoading(false)
            }
        )

        return () => interventionsUnsub.current?.()
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

    const urgentFormItems: UrgentItem[] = useMemo(() => {
        return waiting.pendingForms
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
    }, [waiting.pendingForms, navigate, participantId])

    const urgentItems: UrgentItem[] = useMemo(() => {
        const agreements: UrgentItem[] = waiting.agreements.map(requirement => ({
            key: `agreement-${requirement.agreementId}`,
            kind: 'contract',
            title: requirement.title,
            subtitle: 'Required',
            cta: 'Open',
            // Opens this agreement on the compliance page, not just the page.
            onClick: () => navigate('/incubatee/compliance', { state: { openAgreement: requirement.agreementId } }),
            tag: 'Agreement'
        }))
        return [...agreements, ...urgentFormItems]
    }, [navigate, waiting.agreements, urgentFormItems])


    /** -----------------
     *  Appointment & Events actions
     *  ----------------- */
    const confirmAppointment = async (apptId: string) => {
        try {
            const appt = appointments.find(a => a.id === apptId) || waiting.appointments.find((a: any) => a.id === apptId)
            await confirmAppointmentResponse({ id: apptId, assignedInterventionId: appt?.assignedInterventionId })

            setAppointments(prev =>
                prev.map(a => (a.id === apptId ? { ...a, userConfirmation: 'confirmed', smeConfirmation: 'confirmed' } : a))
            )
            if (selectedAppt?.id === apptId) {
                setSelectedAppt({ ...selectedAppt, userConfirmation: 'confirmed', smeConfirmation: 'confirmed' })
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
            await confirmAppointmentResponse(selectedFoodAppt, updatedSelections)

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
                        ? { ...a, foodSelections: updatedSelections, userConfirmation: 'confirmed', smeConfirmation: 'confirmed' }
                        : a
                )
            )
            if (selectedAppt?.id === selectedFoodAppt.id) {
                setSelectedAppt({
                    ...selectedAppt,
                    foodSelections: updatedSelections,
                    userConfirmation: 'confirmed',
                    smeConfirmation: 'confirmed'
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
        const appt = appointments.find(a => a.id === apptId) || waiting.appointments.find((a: any) => a.id === apptId)
        if (appt) setDecliningAppt(appt as Appointment)
    }


    /** -----------------
     *  Pending interventions actions
     *  ----------------- */
    // Accept / decline now happens by responding to the intervention's
    // appointment invite (see the Schedule section) rather than here.

    const handleRejectCompletion = async (category: DisputeCategory, reason: string) => {
        if (!selectedIntervention) return
        await rejectCompletionAction(db, selectedIntervention.id, reason, {
            deptName: user?.departmentName,
            uid: user?.uid,
            name: (user as any)?.name || null,
            email: user?.email || undefined
        }, category)
        message.success('Sent to the facilitator. You’ll be asked to confirm again once it’s sorted.')
    }

    const handleConfirmCompletion = async () => {
        if (!selectedIntervention) return

        const interventionId = selectedIntervention.id

        if (confirmSubmitting) return
        if (completionSubmitLock.current === interventionId) return

        if (!user?.signatureURL) {
            Modal.confirm({
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

            // Confirming signs the MOV with the saved signature: show it being written.
            await signingCeremony.sign(
                user.signatureURL,
                () => confirmCompletionAction(
                    db,
                    interventionId,
                    {
                        rating: feedbackRating || 0,
                        comments: feedbackComments?.trim() || ''
                    },
                    {
                        signerSignatureUrl: user.signatureURL
                    }
                ),
                'Signing the MOV',
                selectedIntervention.interventionTitle || undefined
            )

            // Close first so the user gets immediate feedback that action is done
            setConfirmModalVisible(false)

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
                !waiting.completions.some(it => it.id === currentId)

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
     *  Schedule (Appointments)
     *  ----------------- */
    // The shared week card reads each record as the SME's own: group fields
    // are dropped so it shows their confirmation, not the whole group's tally.
    const ownAppointments = useMemo(
        () => appointments.map(a => ({
            ...a,
            groupMembers: undefined,
            _groupMembers: undefined,
            groupId: undefined,
            appointmentGroupId: undefined,
            isGroup: false,
            isGrouped: false
        })),
        [appointments]
    )

    const openAppointmentDetails = (row: { id: string }) => {
        const appt = appointments.find(a => a.id === row.id)
        if (!appt) return
        setSelectedAppt(appt)
        setApptDetailsOpen(true)
    }

    // Arriving from the "Waiting for you" prompt: open the meal choice for an
    // appointment with a food menu, or bring Needs your attention into view.
    const waitingRequest = (location.state || {}) as { waitingFoodMenuFor?: string; waitingFocus?: 'attention' }
    useEffect(() => {
        if (!waitingRequest.waitingFoodMenuFor && !waitingRequest.waitingFocus) return
        if (waitingRequest.waitingFoodMenuFor) {
            const appt = appointments.find(a => a.id === waitingRequest.waitingFoodMenuFor)
            if (!appt) return // wait for appointments to load
            handleConfirmAppointment(appt)
        } else {
            const card = document.getElementById('needs-attention')
            if (!card) return
            card.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        navigate(location.pathname, { replace: true, state: null })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [waitingRequest.waitingFoodMenuFor, waitingRequest.waitingFocus, appointments, loading])

    const closeAppointmentDetails = () => {
        setApptDetailsOpen(false)
        setSelectedAppt(null)
    }

    /** Everything an SME can do with an appointment, shown in its details modal. */
    const renderAppointmentActions = (appt: Appointment) => {
        const confirmState = String(appt.userConfirmation || 'pending').toLowerCase()
        const isPending = confirmState === 'pending'
        const isConfirmed = confirmState === 'confirmed'
        // Don't surface a join link once the participant has declined.
        const link = confirmState === 'declined' ? undefined : appt.meetingLink
        const hasFoodMenu =
            appt.deliveryMethod === 'in_person' &&
            appt.foodMenuEnabled &&
            getFoodMenuItems(appt).length > 0
        const hasFoodSelection =
            (getFoodSelectionsForParticipant(appt, participantId) || []).length > 0

        return [
            <Button key="close" onClick={closeAppointmentDetails}>
                Close
            </Button>,
            link ? (
                <Button
                    key="link"
                    variant="filled"
                    color="green"
                    icon={<EyeOutlined />}
                    onClick={() => window.open(link, '_blank')}
                >
                    Open Link
                </Button>
            ) : null,
            isConfirmed && hasFoodMenu ? (
                <Button key="food" onClick={() => openAppointmentFoodMenu(appt)}>
                    {hasFoodSelection ? 'Update Food' : 'Choose Food'}
                </Button>
            ) : null,
            isPending ? (
                <Button
                    key="decline"
                    danger
                    variant="filled"
                    icon={<CloseOutlined />}
                    onClick={() => {
                        closeAppointmentDetails()
                        openDeclineAppointment(appt.id)
                    }}
                >
                    Decline
                </Button>
            ) : null,
            isPending ? (
                <Button
                    key="confirm"
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    onClick={() => handleConfirmAppointment(appt)}
                >
                    Confirm
                </Button>
            ) : null
        ]
    }

    /** -----------------
     *  Needs your attention: one list of everything waiting on the SME
     *  ----------------- */
    const openCompletionReview = (intervention: any) => {
        requireSignatureForCompletion(() => {
            setSelectedIntervention(intervention)
            setCompletionReviewStep(0)
            setConfirmModalVisible(true)
        })
    }

    const attentionItems: AttentionItem[] = (() => {
        const completions: AttentionItem[] = waiting.completions.map((item: any) => ({
            key: `completion-${item.id}`,
            kind: 'completion',
            title: item.subIntervention ? `${item.title} · ${item.subIntervention}` : item.title || 'Untitled intervention',
            subtitle: [`Facilitator: ${item.facilitator || 'Not assigned yet'}`, item.date && item.date !== '-' ? `Due ${item.date}` : '']
                .filter(Boolean)
                .join(' · '),
            actions: [
                {
                    label: 'Reject',
                    danger: true,
                    icon: <CloseOutlined />,
                    onClick: () => {
                        setSelectedIntervention(item.full)
                        setIsRejectModalVisible(true)
                    }
                },
                { label: 'Confirm', primary: true, icon: <CheckCircleOutlined />, onClick: () => openCompletionReview(item.full) }
            ]
        }))

        const documentsToSign: AttentionItem[] = urgentItems.map(it => ({
            key: it.key,
            kind: it.kind === 'survey' ? 'survey' : 'agreement',
            title: it.title,
            subtitle: it.subtitle,
            actions: [{ label: it.cta, primary: true, onClick: it.onClick }]
        }))

        const plans: AttentionItem[] = waiting.plans.map(item => ({
            key: `plan-${item.id}`,
            kind: 'plan',
            title: `${item.name} plan`,
            subtitle: item.completedAt
                ? `Completed by the department on ${dayjs(item.completedAt).format('D MMM YYYY')}`
                : 'Completed by the department',
            actions: [{ label: 'Review', primary: true, onClick: () => navigate('/incubatee/roadmap') }]
        }))

        const appointmentsToAnswer: AttentionItem[] = (waiting.appointments as Appointment[])
            .map(a => {
                const start = toDateSafe(a.startTime) || (a.date ? toDateSafe(a.date) : null)
                return { a, start: start ? dayjs(start) : null }
            })
            .map(({ a, start }) => ({
                key: `appointment-${a.id}`,
                kind: 'appointment',
                title: a.interventionTitle || 'Appointment',
                subtitle: [
                    start ? start.format('ddd D MMM') : '',
                    fmtTimeFromAny(a.startTime),
                    formatDeliveryMethod(a as any)
                ].filter(Boolean).join(' · '),
                actions: [
                    { label: 'Details', onClick: () => openAppointmentDetails(a) },
                    { label: 'Decline', danger: true, icon: <CloseOutlined />, onClick: () => openDeclineAppointment(a.id) },
                    { label: 'Confirm', primary: true, icon: <CheckCircleOutlined />, onClick: () => handleConfirmAppointment(a) }
                ]
            }))

        return [...completions, ...documentsToSign, ...plans, ...appointmentsToAnswer]
    })()

    /** -----------------
     *  Top metrics (map-driven, responsive)
     *  ----------------- */
    const topMetrics: DashboardMetric[] = useMemo(() => [
        {
            key: 'outstanding-documents',
            important: true,
            icon: <FileTextOutlined style={{ fontSize: 20 }} />,
            tone: 'warning' as const,
            title: 'Outstanding Documents',
            mobileTitle: 'Documents',
            value: complianceUnavailable ? '—' : outstandingDocs,
            onClick: () => setComplianceModalOpen(true),
            subtitle:
                complianceUnavailable ? 'View compliance document status' : outstandingDocs > 0
                    ? 'View outstanding compliance documents'
                    : 'Required compliance documents are up to date',
            mobileSubtitle: complianceUnavailable ? 'View status' : outstandingDocs > 0 ? 'View all' : 'Up to date'
        },
        {
            key: 'interventions-distribution',
            important: true,
            icon: <RatioIcon size={20} color="#52c41a" />,
            tone: 'success' as const,
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
    const dashboardContentLoading =
        loading ||
        appointmentsLoading ||
        complianceLoading ||
        requirementsLoading ||
        acceptedAppLoading ||
        interventionsLoading

    return (
        <>
            {dashboardContentLoading ? (
                <div style={{ padding: screens.md ? 24 : 12 }}>
                    <PageSkeleton variant='analytics' />
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

                            {attentionItems.length > 0 ? (
                                <Col span={24} id="needs-attention">
                                    <NeedsAttentionCard items={attentionItems} />
                                </Col>
                            ) : outstandingDocs === 0 && !complianceUnavailable &&
                                !appointmentsLoading && !appointmentError && acceptedApp ? (
                                <Col span={24}>
                                    <Alert type="success" showIcon message="You're all caught up"
                                        description="No outstanding documents or confirmations. See your progress and upcoming appointments below." />
                                </Col>
                            ) : null}

                            <Col xs={24}>
                                <DashboardOverview
                                    key={participantId + ':' + (activeProgramId || '')}
                                    appointments={ownAppointments}
                                    recentCompletions={recentCompletions}
                                    appointmentError={appointmentError}
                                    onAppointmentClick={openAppointmentDetails}
                                    facilitatorLabel={row => getAppointmentAssigneeName(row as any) || undefined}
                                    onViewAppointments={() => navigate('/incubatee/appointments')}
                                    onViewInterventions={() => navigate('/incubatee/interventions')}
                                />
                            </Col>

                        </Row>

                        <Modal
                            centered
                            title="Outstanding Compliance Documents"
                            open={complianceModalOpen}
                            onCancel={() => setComplianceModalOpen(false)}
                            footer={[
                                <Button danger key="close" onClick={() => setComplianceModalOpen(false)}>Close</Button>,
                                <Button key="manage" type="primary" onClick={() => {
                                    setComplianceModalOpen(false)
                                    navigate('/incubatee/compliance')
                                }}>{isMobile ? 'Manage' : 'Manage compliance documents'}</Button>
                            ]}>
                            {complianceError || requirementsError ? <Alert type="error" showIcon message={complianceError || requirementsError} /> :
                                <List loading={complianceLoading || requirementsLoading}
                                    dataSource={outstandingComplianceRows}
                                    locale={{
                                        emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={!acceptedApp ? 'No accepted programme application found.' : complianceRows.length ? 'All required compliance documents are up to date.' : 'No compliance document requirements configured yet.'} />
                                    }}
                                    renderItem={row => <List.Item key={row.key}>
                                        <List.Item.Meta title={row.title}
                                            description={row.expiry ? `Expiry: ${dayjs(row.expiry).format('D MMM YYYY')}` : undefined} />
                                        <Tag color={row.status === 'pending' ? 'orange' : 'red'}>{row.status === 'pending' ? 'Pending review' : titleCase(row.status)}</Tag>
                                    </List.Item>} />}
                        </Modal>

                        {/* Appointment details */}
                        <Modal
                            title="Appointment Details"
                            open={apptDetailsOpen}
                            onCancel={closeAppointmentDetails}
                            footer={selectedAppt ? renderAppointmentActions(selectedAppt) : null}
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
                                    <Descriptions.Item label="Your Confirmation">
                                        {SME_RESPONSE_META[getSmeResponseState(selectedAppt as any)].label}
                                    </Descriptions.Item>
                                    {String(selectedAppt.userConfirmation || '').toLowerCase() === 'declined' && selectedAppt.declineReason ? (
                                        <Descriptions.Item label="Decline Reason">{selectedAppt.declineReason}</Descriptions.Item>
                                    ) : null}
                                </Descriptions>
                            ) : (
                                <Empty description="No appointment selected" />
                            )}
                        </Modal>

                        <Modal
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

                        <DeclineAppointmentModal
                            appointment={decliningAppt}
                            onClose={() => setDecliningAppt(null)}
                        />
                    </div>

                    {/* Report a problem with a completion: the start of a delivery dispute. */}
                    <DisputeDeliveryModal
                        open={isRejectModalVisible}
                        interventionTitle={(selectedIntervention as any)?.interventionTitle}
                        facilitatorName={(selectedIntervention as any)?.assigneeName || (selectedIntervention as any)?.consultantName}
                        onClose={() => setIsRejectModalVisible(false)}
                        onSubmit={handleRejectCompletion}
                    />

                    {signingCeremony.element}

                    {/* Confirm completion modal */}
                    <Modal
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
                                shape='round' variant='filled'
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
                                color="primary"
                                style={{ minWidth: 180 }}
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
