import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
    Card,
    Button,
    Space,
    Tag,
    Modal,
    Descriptions,
    Form,
    Select,
    Input,
    Rate,
    Typography,
    notification,
    message,
    Alert,
    List,
    Grid,
    Empty,
    Progress,
    Segmented,
    Pagination,
    Skeleton
} from 'antd'
import { DisputeDeliveryModal } from '@/components/queries/DisputeDeliveryModal'
import type { DisputeCategory } from '@/services/deliveryDisputeService'
import {
    PlusOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ExclamationCircleOutlined,
    FileSearchOutlined,
    ClockCircleOutlined,
    ArrowLeftOutlined,
    RightOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    updateDoc,
    doc,
    addDoc,
    query,
    where,
    getDoc,
    limit,
    onSnapshot
} from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { v4 as uuidv4 } from 'uuid'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { useNavigate } from 'react-router-dom'
import { toAssignedInterventionView } from '@/services/assignedInterventionService'
import { resolveAssignmentLifecycle, assignmentCompletedDate } from '@/services/assignmentLifecycleService'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import {
    getSmeResponseState,
    isPastAppointment,
    SME_RESPONSE_META,
    type SmeResponseState
} from '@/services/appointmentService'
import { applyKpiDeltas } from '@/lib/kpis' // ⬅️ switched to new API
import {
    confirmCompletion as confirmCompletionAction,
    rejectCompletion as rejectCompletionAction
} from '@/lib/interventions'
import AppointmentResponseSheet from '@/components/appointments/AppointmentResponseSheet'
import { useSigningCeremony } from '@/components/shared/SignatureAnimation'
import './interventions.css'

const { Text } = Typography
const { Option } = Select
const { useBreakpoint } = Grid

// Types
interface RequiredIntervention {
    id: string
    title: string
    departmentId?: string
}
interface Resource {
    type: 'document' | 'link' | 'image'
    label: string
    link: string
}
interface Feedback {
    rating: number
    comments: string
}
interface AssignedIntervention {
    id: string
    interventionId: string
    participantId: string
    assigneeId: string
    assigneeName?: string
    participantName: string
    interventionTitle: string
    description?: string
    departmentId?: string | null
    dueDate: any
    createdAt: string
    updatedAt: string
    type: 'singular' | 'recurring'
    targetType: 'percentage' | 'metric' | 'custom'
    targetMetric: string
    targetValue: number
    assignmentStatus: string
    assigneeAcceptanceStatus: 'pending' | 'accepted' | 'declined'
    participantAcceptanceStatus: 'pending' | 'accepted' | 'declined'
    assigneeCompletionStatus: 'pending' | 'completed'
    participantCompletionStatus: 'pending' | 'confirmed' | 'rejected'
    movDocumentId?: string
    feedback?: Feedback
    resources?: Resource[]
    progress?: number
    computedProgress?: number
    deliveryWorkProgress?: number
    progressUpdates?: Array<{
        note?: string
        createdAt?: any
        computedProgress?: number
        deliveryWorkProgress?: number
        resources?: Resource[]
    }>
}

interface InterventionRequest {
    id: string
    departmentId?: string
    interventionTitle: string
    reason?: string
    status:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | 'in-progress'
    | string
    createdAt?: any
    updatedAt?: any
    decisionReason?: string
}

/**
 * The page's status chips. Each lifecycle status the SME can see falls into
 * one group, so they filter by what matters to them rather than by the
 * underlying workflow state.
 */
type StatusGroup = 'action' | 'active' | 'not-started' | 'completed' | 'issues'

const GROUP_META: Record<StatusGroup, { label: string; tone: string; icon: React.ReactNode }> = {
    action: { label: 'Needs you', tone: 'action', icon: <ExclamationCircleOutlined /> },
    active: { label: 'In progress', tone: 'active', icon: <ClockCircleOutlined /> },
    'not-started': { label: 'Not started', tone: 'idle', icon: <FileSearchOutlined /> },
    completed: { label: 'Completed', tone: 'done', icon: <CheckCircleOutlined /> },
    issues: { label: 'Issues', tone: 'issue', icon: <CloseCircleOutlined /> }
}

const STATUS_FILTERS: Array<{ key: 'all' | StatusGroup; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'action', label: GROUP_META.action.label },
    { key: 'active', label: GROUP_META.active.label },
    { key: 'not-started', label: GROUP_META['not-started'].label },
    { key: 'completed', label: GROUP_META.completed.label },
    { key: 'issues', label: GROUP_META.issues.label }
]

const PAGE_SIZE = 8

const InterventionsTrackingView: React.FC = () => {
    const [loading, setLoading] = useState(false)
    const [requiredInterventions, setRequiredInterventions] = useState<
        RequiredIntervention[]
    >([])
    const [assignedInterventions, setAssignedInterventions] = useState<
        AssignedIntervention[]
    >([])
    const [pendingAppointmentAssignmentIds, setPendingAppointmentAssignmentIds] =
        useState<Set<string>>(new Set())
    const [completionAppointmentsByAssignmentId, setCompletionAppointmentsByAssignmentId] =
        useState<Record<string, any[]>>({})
    const [requests, setRequests] = useState<InterventionRequest[]>([])
    const [loadingRequests, setLoadingRequests] = useState(false)
    const [filters, setFilters] = useState<{
        status: 'all' | StatusGroup
        department: string
    }>({ status: 'all', department: 'all' })
    const [view, setView] = useState<'required' | 'requests'>('required')
    const [respondingAppointment, setRespondingAppointment] = useState<any | null>(null)
    // Bumped after an appointment response so statuses come back from the
    // source; the reload it triggers keeps the list on screen.
    const [reloadKey, setReloadKey] = useState(0)
    const quietReload = useRef(false)
    const [page, setPage] = useState(1)
    useEffect(() => setPage(1), [filters])
    const [isRequestModalVisible, setIsRequestModalVisible] = useState(false)
    const [isConfirmModalVisible, setIsConfirmModalVisible] = useState(false)
    const [completionReviewStep, setCompletionReviewStep] = useState<0 | 1>(0)
    const [progressIntervention, setProgressIntervention] =
        useState<AssignedIntervention | null>(null)
    const [progressSelectedKey, setProgressSelectedKey] = useState<string | null>(null)
    const [confirmingCompletion, setConfirmingCompletion] = useState(false)
    const [selectedIntervention, setSelectedIntervention] =
        useState<AssignedIntervention | null>(null)
    const [requestForm] = Form.useForm()
    const [confirmForm] = Form.useForm()
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [programId, setProgramId] = useState<string | null>(null)
    const [latestPlanId, setLatestPlanId] = useState<string | null>(null)
    const [planInterventions, setPlanInterventions] = useState<any[]>([])
    const [allInterventions, setAllInterventions] = useState<any[]>([])
    const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null)
    const [isDeclineCompletionModalVisible, setIsDeclineCompletionModalVisible] =
        useState(false)

    const { user } = useFullIdentity()
    const signingCeremony = useSigningCeremony()
    const { nameOf } = useDepartmentRoles()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    // normalize titles for reliable matching
    const normalize = (s: string) =>
        String(s || '')
            .normalize('NFKC')
            .replace(/[’‘]/g, "'")
            .replace(/&/g, 'and')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()

    // A recurring intervention isn't one assignedInterventions doc with many
    // appointments — each cycle (e.g. each month) is its own separate doc
    // with its own independent lifecycle (see assignedInterventionService's
    // cycle-scoped identity). "Received" must therefore count completed
    // sibling docs, not appointments within a single doc.
    const interventionGroupKey = (record: { interventionId?: string; interventionTitle?: string }) =>
        String(record?.interventionId || '').trim() || normalize(String(record?.interventionTitle || ''))

    const requestStatusColor = (s: string) => {
        const v = (s || '').toLowerCase()
        if (v === 'approved') return 'green'
        if (v === 'rejected') return 'red'
        if (v === 'in-progress') return 'blue'
        if (v === 'cancelled') return 'default'
        return 'gold' // pending and unknown
    }

    // replace requestStatusColor with this
    const normalizeRequestStatus = (raw?: string) => {
        const v = String(raw || '')
            .trim()
            .toLowerCase()
        if (['approved', 'accepted', 'in-progress', 'in progress'].includes(v)) {
            return { label: 'Accepted', color: 'blue' as const }
        }
        if (['rejected', 'declined', 'cancelled', 'canceled'].includes(v)) {
            return { label: 'Rejected', color: 'red' as const }
        }
        return { label: 'Pending', color: 'gold' as const } // amber
    }

    // Resolve the viewed/logged-in participant and their accepted application.
    useEffect(() => {
        let cancelled = false

        const loadIdentity = async () => {
            if (!user?.email) {
                setParticipantId(null)
                setRequiredInterventions([])
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

            if (!participantDoc) {
                const email = String(user.email).trim().toLowerCase()
                const exact = await getDocs(query(collection(db, 'participants'), where('email', '==', user.email)))
                participantDoc = exact.docs[0] || null
                // Only staff may scan participants; for an SME this finds nothing.
                if (!participantDoc) {
                    const participants = await getDocs(collection(db, 'participants')).catch(() => null)
                    participantDoc = participants?.docs.find(item =>
                        String(item.data()?.email || '').trim().toLowerCase() === email
                    ) || null
                }
            }

            const resolvedParticipantId = String(participantDoc?.id || '')
            const appSnapshot = resolvedParticipantId
                ? await getDocs(query(collection(db, 'applications'), where('participantId', '==', resolvedParticipantId)))
                : await getDocs(query(collection(db, 'applications'), where('email', '==', user.email)))
            const application = appSnapshot.docs.find(item =>
                String(item.data()?.applicationStatus || '').toLowerCase() === 'accepted'
            ) || appSnapshot.docs[0]
            const appData = application?.data() as any
            const finalParticipantId = resolvedParticipantId || String(appData?.participantId || '').trim()

            if (!cancelled) {
                setParticipantId(finalParticipantId || null)
                setProgramId(appData?.programId || participantDoc?.data()?.programId || null)
                setRequiredInterventions(Array.isArray(appData?.interventions?.required) ? appData.interventions.required : [])
            }
        }

        loadIdentity().catch(error => {
            console.error('Failed to resolve incubatee intervention identity:', error)
            notification.error({ message: 'Failed to load your intervention profile.' })
        })
        return () => { cancelled = true }
    }, [user?.email, user?.id, user?.participantDocId, user?.participantId, user?.profileId, user?.uid])

    // The intervention list is sourced from the developmental plan (the same
    // diagnosticPlans doc the Roadmap/Developmental Plan page manages), not
    // the application's static "required" list.
    useEffect(() => {
        if (!participantId) {
            setLatestPlanId(null)
            setPlanInterventions([])
            return
        }
        let cancelled = false
        const loadPlan = async () => {
            try {
                const plansSnap = await getDocs(
                    query(collection(db, 'diagnosticPlans'), where('participantId', '==', participantId))
                )
                const getCreatedAtValue = (d: any) => {
                    const c = d?.createdAt
                    if (!c) return 0
                    if (typeof c?.toMillis === 'function') return c.toMillis()
                    if (typeof c?.seconds === 'number') return c.seconds * 1000
                    if (typeof c === 'number') return c
                    if (typeof c === 'string') {
                        const t = Date.parse(c)
                        return Number.isNaN(t) ? 0 : t
                    }
                    return 0
                }
                const latestDoc = [...plansSnap.docs].sort((a, b) =>
                    getCreatedAtValue(b.data()) - getCreatedAtValue(a.data())
                )[0]
                if (cancelled) return
                setLatestPlanId(latestDoc?.id || null)
                setPlanInterventions(Array.isArray((latestDoc?.data() as any)?.interventions) ? (latestDoc!.data() as any).interventions : [])
            } catch (error) {
                console.error('Failed to load developmental plan:', error)
                if (!cancelled) {
                    setLatestPlanId(null)
                    setPlanInterventions([])
                }
            }
        }
        loadPlan()
        return () => { cancelled = true }
    }, [participantId])

    // Keep the plan's intervention list live — departments can add/remove
    // items while this page is open.
    useEffect(() => {
        if (!latestPlanId) return
        const planRef = doc(db, 'diagnosticPlans', latestPlanId)
        const unsub = onSnapshot(planRef, snap => {
            if (!snap.exists()) return
            const data = snap.data() as any
            setPlanInterventions(Array.isArray(data?.interventions) ? data.interventions : [])
        })
        return () => unsub()
    }, [latestPlanId])

    useEffect(() => {
        if (!participantId) return
        const load = async () => {
            setLoadingRequests(true)
            try {
                const snap = await getDocs(
                    query(
                        collection(db, 'interventionRequests'),
                        where('participantId', '==', participantId)
                    )
                )
                const list = snap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                })) as InterventionRequest[]
                // optional: newest first
                list.sort(
                    (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
                )
                setRequests(list)
            } catch (e) {
                console.error(e)
            } finally {
                setLoadingRequests(false)
            }
        }
        load()
    }, [participantId])

    // Fetch catalog for request modal
    useEffect(() => {
        if (!isRequestModalVisible) return
        getDocs(
            query(
                collection(db, 'interventions'),

            )
        ).then(snapshot => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            setAllInterventions(data)
        })
    }, [isRequestModalVisible])

    // Fetch assigned
    useEffect(() => {
        if (!participantId) {
            setAssignedInterventions([])
            setCompletionAppointmentsByAssignmentId({})
            setPendingAppointmentAssignmentIds(new Set())
            return
        }
        let cancelled = false

        const fetchAssigned = async () => {
            if (!quietReload.current) setLoading(true)
            try {
                const q = query(
                    collection(db, 'assignedInterventions'),
                    where('participantId', '==', participantId)
                )
                const snapshot = await getDocs(q)
                const appointmentsSnapshot = await getDocs(
                    query(
                        collection(db, 'appointments'),
                        where('smeId', '==', participantId)
                    )
                )
                const data = await Promise.all(
                    snapshot.docs.map(async docSnap => {
                        const data = toAssignedInterventionView(docSnap.id, docSnap.data()) as any
                        let interventionData: any = {}
                        if (data.interventionId) {
                            const interventionSnap = await getDoc(
                                doc(db, 'interventions', data.interventionId)
                            )
                            interventionData = interventionSnap.exists()
                                ? interventionSnap.data()
                                : {}
                        }
                        return {
                            id: docSnap.id,
                            ...data,
                            departmentId:
                                data.departmentId || interventionData['departmentId'] || null,
                            type:
                                interventionData['interventionType'] || data.type || 'singular'
                        }
                    })
                )
                if (cancelled) return

                setAssignedInterventions(data as AssignedIntervention[])
                const appointmentViews = await hydrateAppointmentViews(
                    appointmentsSnapshot.docs.map(appointmentDoc => ({ id: appointmentDoc.id, data: appointmentDoc.data() as any }))
                )
                if (cancelled) return

                setCompletionAppointmentsByAssignmentId(
                    appointmentViews.reduce<Record<string, any[]>>((index, appointment) => {
                        const assignmentId = String(appointment?.assignedInterventionId || '').trim()
                        if (assignmentId) index[assignmentId] = [...(index[assignmentId] || []), appointment]
                        return index
                    }, {})
                )
                setPendingAppointmentAssignmentIds(
                    new Set(
                        appointmentViews
                            .filter(appointment => {
                                const confirmation = String(
                                    appointment?.userConfirmation || 'pending'
                                ).trim().toLowerCase()
                                const status = String(appointment?.status || 'scheduled')
                                    .trim()
                                    .toLowerCase()
                                // A session that has already happened can no
                                // longer be answered, so it is not waiting on
                                // the SME (the dashboard hides it too).
                                return (
                                    confirmation === 'pending' &&
                                    !['cancelled', 'declined'].includes(status) &&
                                    !isPastAppointment(appointment as any)
                                )
                            })
                            .map(appointment =>
                                String(appointment?.assignedInterventionId || '').trim()
                            )
                            .filter(Boolean)
                    )
                )
            } catch (err) {
                if (cancelled) return
                console.error('Error fetching interventions:', err)
                notification.error({ message: 'Failed to load interventions.' })
            } finally {
                quietReload.current = false
                if (!cancelled) setLoading(false)
            }
        }
        fetchAssigned()

        return () => {
            cancelled = true
        }
    }, [participantId, reloadKey])

    // what’s already in applications.required
    const existingRequiredIds = new Set(
        (requiredInterventions || []).map(r => r.id).filter(Boolean)
    )
    const existingRequiredTitles = new Set(
        (requiredInterventions || []).map(r => normalize(r.title))
    )

    const existingAssignedTitles = new Set(
        (assignedInterventions || []).map(i => normalize(i.interventionTitle))
    )

    const departmentOptions = Array.from(
        new Set(allInterventions.map(i => String(i.departmentId || '')).filter(Boolean))
    )
        .map(id => ({ id, name: nameOf(id) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    const interventionOptions = allInterventions
        .filter(i => String(i.departmentId || '') === selectedDepartmentId)
        .filter(i => {
            const t = i.interventionTitle || i.title || ''
            return (
                !existingRequiredIds.has(i.id) &&
                !existingRequiredTitles.has(normalize(t)) &&
                !existingAssignedTitles.has(normalize(t))
            )
        })
        .map(i => ({ id: i.id, title: i.interventionTitle || i.title }))

    const deriveDisplayStatus = (intervention: AssignedIntervention): string => {
        // No facilitator/coordinator assigned yet = no real assignedInterventions
        // doc exists for this plan item. interventionId alone isn't a safe
        // signal here — plan-sourced placeholder rows carry the catalog
        // intervention's id too, so checking it as well used to make an
        // unassigned plan item fall through into lifecycle statuses like
        // "Awaiting Appointment Response".
        if (!intervention.assigneeId)
            return 'Pending Assignment'
        const lifecycle = resolveAssignmentLifecycle(intervention)
        if (lifecycle.key === 'awaiting-participant-acceptance') {
            return pendingAppointmentAssignmentIds.has(intervention.id)
                ? 'Awaiting Appointment Response'
                : 'Appointment Setup Pending'
        }
        if (lifecycle.key === 'in-delivery') return 'In Progress'
        if (lifecycle.key === 'awaiting-participant-confirmation') return 'Awaiting Your Confirmation'
        if (lifecycle.key === 'participant-rejected') return 'Completion Rejected'
        if (lifecycle.key === 'participant-declined') return 'Declined'
        if (lifecycle.key === 'needs-reassignment') return 'Facilitator Declined'
        return lifecycle.label
    }

    // How many times this intervention has actually been received — one
    // completed assignedInterventions doc (cycle) per delivery, not one
    // appointment. A single session doesn't mean the whole intervention was
    // received; a completed cycle does.
    const siblingRecordsFor = (record: AssignedIntervention) => {
        const key = interventionGroupKey(record)
        return assignedInterventions.filter(other => interventionGroupKey(other) === key)
    }

    const receivedCountFor = (record: AssignedIntervention) =>
        siblingRecordsFor(record).filter(sibling => resolveAssignmentLifecycle(sibling).isCompleted).length

    const statusTagInfo = (record: AssignedIntervention): { color: any; icon: any; label: React.ReactNode } => {
        const status = deriveDisplayStatus(record)
        let color: any = 'default'
        let icon: any = null
        let label: React.ReactNode = status
        switch (status) {
            case 'Pending':
            case 'Pending Assignment':
                color = 'default'
                icon = <ClockCircleOutlined />
                break
            case 'Awaiting Facilitator':
                color = 'orange'
                icon = <ExclamationCircleOutlined />
                break
            case 'Awaiting Your Acceptance':
            case 'Awaiting Appointment Response':
                color = 'gold'
                icon = <ExclamationCircleOutlined />
                break
            case 'Appointment Setup Pending':
                color = 'default'
                icon = <ClockCircleOutlined />
                break
            case 'In Progress':
                color = 'blue'
                icon = <ClockCircleOutlined />
                break
            case 'Awaiting Your Confirmation':
                color = 'purple'
                icon = <ClockCircleOutlined />
                break
            case 'Completed': {
                color = 'green'
                icon = <CheckCircleOutlined />
                // n = number of completed assignedInterventions records
                // (cycles) for this intervention, not appointments — each
                // cycle is its own doc, and opening View Progress shows one
                // card per cycle counted here.
                const receivedCount = receivedCountFor(record)
                label = receivedCount > 0 ? `Assigned (${receivedCount})` : 'Assigned'
                break
            }
            case 'Declined':
            case 'Facilitator Declined':
            case 'Completion Rejected':
                color = 'red'
                icon = <CloseCircleOutlined />
                break
        }
        return { color, icon, label }
    }

    const statusGroupOf = (record: AssignedIntervention): StatusGroup => {
        switch (deriveDisplayStatus(record)) {
            case 'Awaiting Your Acceptance':
            case 'Awaiting Appointment Response':
            case 'Awaiting Your Confirmation':
                return 'action'
            case 'Pending':
            case 'Pending Assignment':
                return 'not-started'
            case 'Completed':
                return 'completed'
            case 'Declined':
            case 'Facilitator Declined':
            case 'Completion Rejected':
                return 'issues'
            default:
                return 'active'
        }
    }

    // Accept / decline now happens by responding to the intervention's
    // appointment invite (see incubatee/appointments) rather than here.

    const openCompletionReview = (record: AssignedIntervention) => {
        setSelectedIntervention(record)
        setCompletionReviewStep(0)
        confirmForm.resetFields()
        setIsConfirmModalVisible(true)
    }

    const completionAppointments = selectedIntervention
        ? (completionAppointmentsByAssignmentId[selectedIntervention.id] || [])
            .slice()
            .sort((left, right) => dayjs(left.startTime?.toDate?.() || left.startTime || 0).valueOf() - dayjs(right.startTime?.toDate?.() || right.startTime || 0).valueOf())
        : []
    const attendedCompletionAppointments = completionAppointments.filter(appointment =>
        String(selectedIntervention?.sessionAttendanceByAppointment?.[appointment.id]?.outcome || appointment.attendance?.status || '').toLowerCase() === 'attended'
    )

    const handleConfirmCompletion = async (values: any) => {
        if (!selectedIntervention || confirmingCompletion) return
        const record = selectedIntervention
        setConfirmingCompletion(true)
        try {
            // 1) Centralized write + denorm + MOV + notifications
            // Confirming signs the MOV with the saved signature: show it being written.
            await signingCeremony.sign(
                user?.signatureURL,
                () => confirmCompletionAction(
                    db,
                    record.id,
                    {
                        rating: values.rating,
                        comments: values.feedback
                    },
                    {
                        signerSignatureUrl: user?.signatureURL || ''
                    }
                ),
                'Signing the MOV',
                record.interventionTitle || undefined
            )

            // 2) Local UI state update
            setAssignedInterventions(prev =>
                prev.map(i =>
                    i.id === record.id
                        ? {
                            ...i,
                            participantCompletionStatus: 'confirmed',
                            assignmentStatus: 'completed',
                            feedback: { rating: values.rating, comments: values.feedback }
                        }
                        : i
                )
            )

            // 3) KPI deltas (keep your existing logic)
            const pSnap = await getDoc(doc(db, 'participants', record.participantId))
            const pData = pSnap.exists() ? (pSnap.data() as any) : {}
            const programId =
                (pData?.programId as string) || (record as any)?.programId || ''

            let kpiIds: string[] = []
            if (record.interventionId) {
                const iSnap = await getDoc(
                    doc(db, 'interventions', record.interventionId)
                )
                if (iSnap.exists()) {
                    const idata = iSnap.data() as any
                    if (Array.isArray(idata.kpiIds)) kpiIds = idata.kpiIds.map(String)
                }
            }
            if (!kpiIds.length) {
                const iQs = await getDocs(
                    query(
                        collection(db, 'interventions'),
                        where('interventionTitle', '==', record.interventionTitle)
                    )
                )
                if (!iQs.empty) {
                    const idata = iQs.docs[0].data() as any
                    if (Array.isArray(idata.kpiIds)) kpiIds = idata.kpiIds.map(String)
                }
            }

            if (kpiIds.length) {
                const rawInc =
                    typeof record.targetValue === 'number' && !isNaN(record.targetValue)
                        ? Number(record.targetValue || 0) || 1
                        : 1

                const deltas = kpiIds.reduce<
                    Record<string, { mode: 'increment'; value: number }>
                >((acc, id) => {
                    acc[id] = { mode: 'increment', value: rawInc }
                    return acc
                }, {})

                const q = Math.floor(dayjs().month() / 3) + 1
                const quarterKey = `${dayjs().year()}-Q${q}`

                await applyKpiDeltas(
                    {
                        participantId: record.participantId,
                        programId,
                        departmentId: record.departmentId || undefined,
                        quarter: quarterKey,
                        payload: {
                            interventionId: record.interventionId,
                            interventionTitle: record.interventionTitle
                        }
                    },
                    deltas
                )
            }

            setIsConfirmModalVisible(false)
            confirmForm.resetFields()
            message.success('Intervention marked as completed.')
        } catch (e) {
            console.error(e)
            message.error(
                e instanceof Error
                    ? e.message
                    : 'Failed to confirm completion. Please try again.'
            )
        } finally {
            setConfirmingCompletion(false)
        }
    }

    const handleRejectCompletion = async (
        intervention: AssignedIntervention,
        reason: string,
        category: DisputeCategory = 'other'
    ) => {
        try {
            await rejectCompletionAction(db, intervention.id, reason, {
                deptName: user?.departmentName,
                uid: user?.uid,
                name: (user as any)?.name || null,
                email: user?.email || undefined
            }, category)
            setAssignedInterventions(prev =>
                prev.map(i =>
                    i.id === intervention.id
                        ? { ...i, participantCompletionStatus: 'rejected', assignmentStatus: 'in-progress' }
                        : i
                )
            )
            message.success('Sent to the facilitator. You’ll be asked to confirm again once it’s sorted.')
        } catch (err) {
            console.error(err)
            message.error('Failed to reject completion. Please try again.')
        }
    }

    // Filters
    const departmentLabel = (departmentId?: string | null): string =>
        departmentId ? nameOf(departmentId, '') : ''

    // The list is sourced from the developmental plan: every intervention the
    // departments have added to the plan, cross-referenced with its live
    // delivery record(s) (if any have been assigned yet).
    const allWithUnassigned = useMemo(() => {
        const timeValue = (v: any): number => {
            if (!v) return 0
            if (v?.toDate) return v.toDate().getTime()
            if (v?.seconds) return v.seconds * 1000
            const t = Date.parse(v)
            return Number.isNaN(t) ? 0 : t
        }

        // Each recurring cycle is its own assignedInterventions document —
        // group them by intervention identity so the table shows ONE row per
        // intervention (not one per cycle), represented by whichever cycle is
        // currently open/actionable, or the most recent one if all are closed.
        const byGroup = new Map<string, AssignedIntervention[]>()
        assignedInterventions.forEach(intervention => {
            const id = String(intervention.id || '').trim()
            const key = interventionGroupKey(intervention)
            if (!id || !key) return
            const list = byGroup.get(key) || []
            list.push(intervention)
            byGroup.set(key, list)
        })

        const uniqueAssigned = Array.from(byGroup.values()).map(records => {
            const open = records.find(r => resolveAssignmentLifecycle(r).isOpen)
            if (open) return open
            return [...records].sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))[0]
        })
        const assignedTitles = new Set(
            uniqueAssigned.map(item => normalize(item.interventionTitle)).filter(Boolean)
        )
        const assignedInterventionIds = new Set(
            uniqueAssigned.map(item => String(item.interventionId || '').trim()).filter(Boolean)
        )

        // A plan may list the same intervention more than once (legacy data).
        // Treat ID/title as the logical identity before adding the
        // pending-assignment placeholder to the table.
        const planByKey = new Map<string, any>()
        planInterventions.forEach(planItem => {
            const title = planItem?.title ?? planItem?.interventionTitle ?? planItem?.name ?? ''
            const key = String(planItem?.id || '').trim() || normalize(title)
            if (key && title && !planByKey.has(key)) {
                planByKey.set(key, planItem)
            }
        })

        const unassigned = Array.from(planByKey.values())
            .filter(planItem => {
                const planId = String(planItem?.id || '').trim()
                const title = planItem?.title ?? planItem?.interventionTitle ?? planItem?.name ?? ''
                if (planId && assignedInterventionIds.has(planId)) return false
                return !assignedTitles.has(normalize(title))
            })
            .map(planItem => {
                const title = planItem?.title ?? planItem?.interventionTitle ?? planItem?.name ?? 'Untitled'
                const stableKey = String(planItem?.id || '').trim() || normalize(title)
                return {
                    id: `unassigned-${stableKey}`,
                    interventionId: planItem?.id || '',
                    participantId: participantId || '',
                    assigneeId: '',
                    participantName: '',
                    interventionTitle: title,
                    description: '',
                    departmentId: planItem?.departmentId ?? null,
                    dueDate: null,
                    createdAt: '',
                    updatedAt: '',
                    type: 'singular',
                    targetType: 'percentage',
                    targetMetric: '',
                    targetValue: 0,
                    assignmentStatus: 'assigned',
                    assigneeAcceptanceStatus: 'accepted',
                    participantAcceptanceStatus: 'pending',
                    assigneeCompletionStatus: 'pending',
                    participantCompletionStatus: 'pending'
                } as AssignedIntervention
            })

        return [...uniqueAssigned, ...unassigned]
    }, [assignedInterventions, participantId, planInterventions])

    const assignedDepartmentOptions = Array.from(new Set(
        allWithUnassigned.map(item => String(item.departmentId || '')).filter(Boolean)
    ))
        .map(id => ({ value: id, label: departmentLabel(id) || 'Unassigned' }))
        .sort((a, b) => a.label.localeCompare(b.label))

    const interventionDate = (value: any) => {
        if (!value) return null
        const parsed = value?.toDate ? dayjs(value.toDate())
            : value?.seconds ? dayjs(value.seconds * 1000)
                : dayjs(value)
        return parsed.isValid() ? parsed : null
    }

    const actionPriority = (intervention: AssignedIntervention) => {
        const lifecycle = resolveAssignmentLifecycle(intervention)
        if (lifecycle.key === 'awaiting-participant-acceptance') return 0
        if (lifecycle.key === 'awaiting-participant-confirmation') return 1
        if (lifecycle.isOpen) return 2
        if (lifecycle.isCompleted) return 4
        return 3
    }

    const filteredInterventions = useMemo(() => {
        return allWithUnassigned.filter(intervention => {
            if (filters.status !== 'all' && statusGroupOf(intervention) !== filters.status) return false
            if (filters.department !== 'all' && String(intervention.departmentId || '') !== filters.department) return false
            return true
        }).sort((left, right) => {
            const priority = actionPriority(left) - actionPriority(right)
            if (priority) return priority
            const leftDue = interventionDate(left.dueDate)?.valueOf() ?? Number.MAX_SAFE_INTEGER
            const rightDue = interventionDate(right.dueDate)?.valueOf() ?? Number.MAX_SAFE_INTEGER
            return leftDue - rightDue || left.interventionTitle.localeCompare(right.interventionTitle)
        })
    }, [allWithUnassigned, filters])

    const openProgressView = (intervention: AssignedIntervention) => {
        setProgressIntervention(intervention)
        setProgressSelectedKey(null)
    }

    // Every dated fact about this intervention — appointments, the day it was
    // assigned, the day it was completed — grouped by CYCLE, i.e. one card
    // per sibling assignedInterventions doc, not per calendar month of
    // appointment dates. A recurring intervention creates a new, independent
    // record each cycle (see interventionGroupKey); a single session inside
    // one cycle isn't "receiving" the intervention — that cycle's own
    // completion is. Cycles typically land one-per-month, so the card is
    // still labelled by month, but the grouping key is the record itself.
    type CycleEventKind = 'appointment' | 'assigned' | 'completed'

    type CycleEvent = {
        key: string
        kind: CycleEventKind
        date: Dayjs
        status?: string
        received?: boolean
        participantResponse?: SmeResponseState
    }

    type CycleGroup = {
        key: string
        label: string
        record: AssignedIntervention
        events: CycleEvent[]
        appointmentCount: number
        receivedCount: number
        isCompleted: boolean
        sortValue: number
    }

    const buildCycleGroups = (intervention: AssignedIntervention | null): CycleGroup[] => {
        if (!intervention) return []
        const records = siblingRecordsFor(intervention)

        return records
            .map(record => {
                const appointments = completionAppointmentsByAssignmentId[record.id] || []
                const events: CycleEvent[] = []

                appointments.forEach((appointment: any) => {
                    const date = interventionDate(appointment.startTime)
                    if (!date) return
                    const status = String(appointment?.status || 'scheduled').toLowerCase()
                    events.push({
                        key: `appt-${appointment.id}`,
                        kind: 'appointment',
                        date,
                        status,
                        received: status === 'completed',
                        participantResponse: getSmeResponseState(appointment)
                    })
                })

                const assignedDate = interventionDate(record.createdAt)
                if (assignedDate) {
                    events.push({ key: 'assigned', kind: 'assigned', date: assignedDate })
                }

                const isCompleted = resolveAssignmentLifecycle(record).isCompleted
                const completedDate = isCompleted
                    ? interventionDate(assignmentCompletedDate(record as any))
                    : null
                if (completedDate) {
                    events.push({ key: 'completed', kind: 'completed', date: completedDate })
                }

                events.sort((a, b) => {
                    if (a.kind === 'assigned') return b.kind === 'assigned' ? 0 : -1
                    if (b.kind === 'assigned') return 1
                    return a.date.valueOf() - b.date.valueOf()
                })

                const labelDate = completedDate || assignedDate
                const label = labelDate ? labelDate.format('MMMM YYYY') : 'Undated'

                return {
                    key: record.id,
                    label,
                    record,
                    events,
                    appointmentCount: events.filter(e => e.kind === 'appointment').length,
                    receivedCount: events.filter(e => e.kind === 'appointment' && e.received).length,
                    isCompleted,
                    sortValue: labelDate?.valueOf() || 0
                }
            })
            .sort((a, b) => b.sortValue - a.sortValue)
    }

    const renderProgressPage = () => {
        const intervention = progressIntervention
        if (!intervention) return null

        const area = departmentLabel(intervention.departmentId) || 'Not specified'
        const overallProgress = Math.min(
            100,
            Math.max(
                Number(intervention.computedProgress || 0),
                Number(intervention.progress || 0),
                Number(intervention.deliveryWorkProgress || 0)
            )
        )

        const months = buildCycleGroups(intervention)
        const selectedMonth = months.find(group => group.key === progressSelectedKey) || null
        const desktopSelectedMonth = selectedMonth || months[0] || null

        const summaryTag = statusTagInfo(intervention)
        const summaryTone = GROUP_META[statusGroupOf(intervention)].tone

        const summary = (
            <div className={`iv-card iv-tone-${summaryTone}`}>
                <Space direction='vertical' size={6} style={{ width: '100%' }}>
                    <div className='iv-event-head'>
                        <Text strong style={{ fontSize: 16 }}>{intervention.interventionTitle}</Text>
                        <span className='iv-pill'>{summaryTag.label}</span>
                    </div>
                    <Text type='secondary'>
                        {area}{intervention.assigneeName ? ` · ${intervention.assigneeName}` : ''}
                    </Text>
                    <Progress
                        percent={overallProgress}
                        size='small'
                        status={overallProgress >= 100 ? 'success' : 'active'}
                    />
                </Space>
            </div>
        )

        const eventKindTag = (kind: CycleEventKind) => {
            if (kind === 'assigned') return <Tag color='purple'>Assigned</Tag>
            if (kind === 'completed') return <Tag color='green'>Completed</Tag>
            return <Tag color='blue'>Appointment</Tag>
        }

        const renderMonthDetail = (group: CycleGroup | null) => {
            if (!group) {
                return (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description='No activity recorded for this month yet'
                    />
                )
            }
            return (
                <div className='iv-events'>
                    {group.events.map(event => (
                        <div key={event.key} className='iv-event'>
                            <div className='iv-event-head'>
                                <Text strong>{event.date.format('DD MMM YYYY')}</Text>
                                {eventKindTag(event.kind)}
                            </div>
                            {event.kind === 'appointment' && (
                                <>
                                    <div className='iv-event-line'>
                                        <Text type='secondary'>Session</Text>
                                        <Tag color={event.received ? 'green' : event.status === 'cancelled' ? 'red' : 'default'}>
                                            {event.received ? 'Received' : (event.status || '').replace(/_/g, ' ')}
                                        </Tag>
                                    </div>
                                    <div className='iv-event-line'>
                                        <Text type='secondary'>Your confirmation</Text>
                                        <Tag color={SME_RESPONSE_META[event.participantResponse || 'pending'].color}>
                                            {SME_RESPONSE_META[event.participantResponse || 'pending'].label}
                                        </Tag>
                                    </div>
                                </>
                            )}
                            {event.kind === 'completed' && group.record.feedback && (
                                <Space direction='vertical' size={2} style={{ width: '100%' }}>
                                    <Rate disabled value={group.record.feedback.rating} style={{ fontSize: 14 }} />
                                    {group.record.feedback.comments && (
                                        <Text type='secondary'>{group.record.feedback.comments}</Text>
                                    )}
                                </Space>
                            )}
                        </div>
                    ))}
                </div>
            )
        }

        const renderMonthsList = (onSelect: (key: string) => void, activeKey: string | null) =>
            months.length ? (
                <ul className='iv-months'>
                    {months.map(group => (
                        <li key={group.key}>
                            <button
                                type='button'
                                className={`iv-month${activeKey === group.key ? ' is-active' : ''}`}
                                aria-pressed={activeKey === group.key}
                                onClick={() => onSelect(group.key)}
                            >
                                <span className='iv-month-label'>{group.label}</span>
                                <span className='iv-month-tags'>
                                    {group.appointmentCount > 0 && (
                                        <Tag color='blue' style={{ marginInlineEnd: 0 }}>
                                            {group.receivedCount}/{group.appointmentCount} session{group.appointmentCount === 1 ? '' : 's'}
                                        </Tag>
                                    )}
                                    {group.isCompleted ? (
                                        <Tag color='green' style={{ marginInlineEnd: 0 }}>Completed</Tag>
                                    ) : (
                                        <Tag style={{ marginInlineEnd: 0 }}>{deriveDisplayStatus(group.record)}</Tag>
                                    )}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No activity recorded yet' />
            )

        const backButton = (label: string, onBack: () => void) => (
            <Button type='text' icon={<ArrowLeftOutlined />} onClick={onBack} style={{ alignSelf: 'flex-start' }}>
                {label}
            </Button>
        )

        if (isMobile) {
            if (selectedMonth) {
                return (
                    <Space direction='vertical' size={12} style={{ width: '100%' }}>
                        {backButton('Back to months', () => setProgressSelectedKey(null))}
                        <Text strong style={{ fontSize: 15 }}>{selectedMonth.label}</Text>
                        {renderMonthDetail(selectedMonth)}
                    </Space>
                )
            }
            return (
                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                    {backButton('Back to interventions', () => setProgressIntervention(null))}
                    {summary}
                    <div className='iv-card'>
                        <p className='iv-card-title'>Months</p>
                        {renderMonthsList(key => setProgressSelectedKey(key), null)}
                    </div>
                </Space>
            )
        }

        return (
            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                {backButton('Back to interventions', () => setProgressIntervention(null))}
                {summary}
                <div className='iv-progress-grid'>
                    <div className='iv-card'>
                        <p className='iv-card-title'>Months</p>
                        {renderMonthsList(key => setProgressSelectedKey(key), desktopSelectedMonth?.key || null)}
                    </div>
                    <div className='iv-card'>
                        <p className='iv-card-title'>{desktopSelectedMonth?.label || 'Details'}</p>
                        {renderMonthDetail(desktopSelectedMonth)}
                    </div>
                </div>
            </Space>
        )
    }

    // Metrics
    const totalRequired = Math.max(allWithUnassigned.length, assignedInterventions.length)
    const completedCount = assignedInterventions.filter(
        i => resolveAssignmentLifecycle(i).isCompleted
    ).length
    // Counted the same way the "In Progress" status matches, so the metric
    // and the list never disagree.
    const ongoingCount = allWithUnassigned.filter(
        i => deriveDisplayStatus(i) === 'In Progress'
    ).length
    const completionRate = totalRequired
        ? Math.round((completedCount / totalRequired) * 100)
        : 0

    const openRequestModal = () => {
        setIsRequestModalVisible(true)
        setSelectedDepartmentId(null)
        requestForm.resetFields()
    }

    // Chip counts follow the department filter, so a chip never promises rows
    // that the current department hides.
    const departmentFiltered = allWithUnassigned.filter(
        item => filters.department === 'all' || String(item.departmentId || '') === filters.department
    )
    const groupCounts = departmentFiltered.reduce<Record<string, number>>((acc, item) => {
        const group = statusGroupOf(item)
        acc[group] = (acc[group] || 0) + 1
        return acc
    }, {})
    const pageCount = Math.max(1, Math.ceil(filteredInterventions.length / PAGE_SIZE))
    const currentPage = Math.min(page, pageCount)
    const pagedInterventions = filteredInterventions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

    // The appointment waiting on the SME for an assignment: the earliest one
    // still pending, matching how pendingAppointmentAssignmentIds is built.
    const pendingAppointmentFor = (assignmentId: string) =>
        (completionAppointmentsByAssignmentId[assignmentId] || [])
            .filter(appointment =>
                String(appointment?.userConfirmation || 'pending').trim().toLowerCase() === 'pending' &&
                !['cancelled', 'declined'].includes(String(appointment?.status || 'scheduled').trim().toLowerCase()) &&
                !isPastAppointment(appointment)
            )
            .sort((a, b) =>
                (interventionDate(a.startTime)?.valueOf() ?? Number.MAX_SAFE_INTEGER) -
                (interventionDate(b.startTime)?.valueOf() ?? Number.MAX_SAFE_INTEGER)
            )[0] || null

    const renderInterventionRow = (item: AssignedIntervention) => {
        const lifecycleKey = resolveAssignmentLifecycle(item).key
        const meta = GROUP_META[statusGroupOf(item)]
        const { label } = statusTagInfo(item)
        // Plan items without a delivery record yet have no progress to show.
        const isPlaceholder = String(item.id).startsWith('unassigned-')
        const received = receivedCountFor(item)
        const needsAppointmentResponse =
            lifecycleKey === 'awaiting-participant-acceptance' && pendingAppointmentAssignmentIds.has(item.id)
        const needsConfirmation = lifecycleKey === 'awaiting-participant-confirmation'
        const stop = (action: () => void) => (event: React.MouseEvent) => {
            event.stopPropagation()
            action()
        }

        return (
            <li
                key={item.id}
                className={`iv-row iv-tone-${meta.tone}${isPlaceholder ? '' : ' is-clickable'}`}
                role={isPlaceholder ? undefined : 'button'}
                tabIndex={isPlaceholder ? undefined : 0}
                aria-label={isPlaceholder ? undefined : `View progress for ${item.interventionTitle}`}
                onClick={isPlaceholder ? undefined : () => openProgressView(item)}
                onKeyDown={isPlaceholder ? undefined : event => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        openProgressView(item)
                    }
                }}
            >
                <span className='iv-icon' aria-hidden='true'>{meta.icon}</span>
                <div className='iv-text'>
                    <Text strong className='iv-name'>{item.interventionTitle}</Text>
                    <span className='iv-meta'>
                        {[
                            departmentLabel(item.departmentId) || 'Department not specified',
                            received > 0 ? `${received} received` : '',
                            item.assigneeName || ''
                        ].filter(Boolean).join(' · ')}
                    </span>
                </div>
                <span className='iv-pill'>{label}</span>
                <div className='iv-actions'>
                    {needsAppointmentResponse && (
                        <Button
                            size='small'
                            type='primary'
                            onClick={stop(() => {
                                const pending = pendingAppointmentFor(item.id)
                                if (pending) setRespondingAppointment(pending)
                                else navigate('/incubatee/appointments')
                            })}
                        >
                            Respond to appointment
                        </Button>
                    )}
                    {needsConfirmation && (
                        <>
                            <Button
                                size='small'
                                danger
                                onClick={stop(() => {
                                    setSelectedIntervention(item)
                                    setIsDeclineCompletionModalVisible(true)
                                })}
                            >
                                Reject
                            </Button>
                            <Button
                                size='small'
                                type='primary'
                                icon={<CheckCircleOutlined />}
                                onClick={stop(() => openCompletionReview(item))}
                            >
                                Confirm
                            </Button>
                        </>
                    )}
                    {!isMobile && !isPlaceholder && <RightOutlined className='iv-chevron' aria-hidden='true' />}
                </div>
            </li>
        )
    }

    const requestTone = (label: string) =>
        label === 'Accepted' ? 'active' : label === 'Rejected' ? 'issue' : 'action'

    const renderRequestRow = (r: InterventionRequest) => {
        const { label } = normalizeRequestStatus(r.status)
        return (
            <li key={r.id} className={`iv-row iv-tone-${requestTone(label)}`}>
                <span className='iv-icon' aria-hidden='true'><FileSearchOutlined /></span>
                <div className='iv-text'>
                    <Text strong className='iv-name'>{r.interventionTitle}</Text>
                    <span className='iv-meta'>
                        {[
                            departmentLabel(r.departmentId),
                            r.createdAt?.seconds ? `Requested ${dayjs(r.createdAt.seconds * 1000).format('D MMM YYYY')}` : ''
                        ].filter(Boolean).join(' · ')}
                    </span>
                    {r.reason?.trim() ? (
                        <span className='iv-note'><strong>Your reason:</strong> {r.reason}</span>
                    ) : null}
                    {label === 'Rejected' && r.decisionReason?.trim() ? (
                        <span className='iv-note'><strong>Decision:</strong> {r.decisionReason}</span>
                    ) : null}
                </div>
                <span className='iv-pill'>{label}</span>
                <div className='iv-actions' />
            </li>
        )
    }

    const listPlaceholder = (content: React.ReactNode) => (
        <div className='iv-list iv-empty'>{content}</div>
    )

    return (
        <div className='iv-page'>
            <Helmet>
                <title>Interventions Tracking</title>
            </Helmet>

            {progressIntervention ? (
                renderProgressPage()
            ) : (
                <>
                    <MetricsGrid
                        metrics={[
                            {
                                key: 'total',
                                title: 'Required',
                                value: totalRequired,
                                subtitle: 'In your development plan',
                                icon: <FileSearchOutlined />,
                                tone: 'accent' as const,
                                loading
                            },
                            {
                                key: 'ongoing',
                                title: 'In progress',
                                value: ongoingCount,
                                subtitle: 'Being delivered now',
                                icon: <ClockCircleOutlined />,
                                tone: 'warning' as const,
                                important: true,
                                loading
                            },
                            {
                                key: 'completed',
                                title: 'Completed',
                                value: completedCount,
                                subtitle: `${completionRate}% of required, confirmed by you`,
                                mobileSubtitle: `${completionRate}% done`,
                                icon: <CheckCircleOutlined />,
                                tone: 'success' as const,
                                important: true,
                                loading
                            }
                        ] as DashboardMetric[]}
                    />

                    <div className='iv-toolbar'>
                        <div className='iv-toolbar-main'>
                            <Segmented
                                value={view}
                                onChange={value => setView(value as 'required' | 'requests')}
                                block={isMobile}
                                options={[
                                    { label: `Required (${allWithUnassigned.length})`, value: 'required' },
                                    { label: `My requests (${requests.length})`, value: 'requests' }
                                ]}
                            />
                            {view === 'required' ? (
                                <div className='iv-chips' role='group' aria-label='Filter by status'>
                                    {STATUS_FILTERS.map(option => {
                                        const count = option.key === 'all' ? departmentFiltered.length : groupCounts[option.key] || 0
                                        const active = filters.status === option.key
                                        if (option.key !== 'all' && !count && !active) return null
                                        return (
                                            <button
                                                key={option.key}
                                                type='button'
                                                className={`iv-chip${active ? ' is-active' : ''}`}
                                                aria-pressed={active}
                                                onClick={() => setFilters(current => ({ ...current, status: option.key }))}
                                            >
                                                {option.label}
                                                <span className='iv-chip-count'>{count}</span>
                                            </button>
                                        )
                                    })}
                                </div>
                            ) : null}
                        </div>
                        <div className='iv-toolbar-side'>
                            {view === 'required' && assignedDepartmentOptions.length > 1 ? (
                                <Select
                                    className='iv-area'
                                    showSearch
                                    optionFilterProp='label'
                                    value={filters.department}
                                    onChange={department => setFilters(current => ({ ...current, department }))}
                                    options={[
                                        { value: 'all', label: 'All departments' },
                                        ...assignedDepartmentOptions
                                    ]}
                                />
                            ) : null}
                            <Button type='primary' icon={<PlusOutlined />} onClick={openRequestModal}>
                                Request intervention
                            </Button>
                        </div>
                    </div>

                    {view === 'required' ? (
                        <>
                            {loading ? (
                                listPlaceholder(<Skeleton active />)
                            ) : !filteredInterventions.length ? (
                                listPlaceholder(
                                    <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description={
                                            allWithUnassigned.length
                                                ? 'Nothing matches these filters.'
                                                : 'No interventions in your development plan yet.'
                                        }
                                    />
                                )
                            ) : (
                                <>
                                    <ul className='iv-list'>{pagedInterventions.map(renderInterventionRow)}</ul>
                                    {pageCount > 1 ? (
                                        <div className='iv-pager'>
                                            <Pagination
                                                size='small'
                                                current={currentPage}
                                                pageSize={PAGE_SIZE}
                                                total={filteredInterventions.length}
                                                showSizeChanger={false}
                                                onChange={setPage}
                                            />
                                        </div>
                                    ) : null}
                                </>
                            )}
                        </>
                    ) : loadingRequests ? (
                        listPlaceholder(<Skeleton active />)
                    ) : requests.length ? (
                        <ul className='iv-list'>{requests.map(renderRequestRow)}</ul>
                    ) : (
                        listPlaceholder(
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No intervention requests yet'>
                                <Button type='primary' onClick={openRequestModal}>
                                    Request your first intervention
                                </Button>
                            </Empty>
                        )
                    )}
                </>
            )}

            {signingCeremony.element}
            <AppointmentResponseSheet
                appointment={respondingAppointment}
                onClose={() => setRespondingAppointment(null)}
                onResponded={() => {
                    setRespondingAppointment(null)
                    quietReload.current = true
                    setReloadKey(key => key + 1)
                }}
            />

            {/* Request Modal */}
            <Modal
                title='Request New Intervention'
                open={isRequestModalVisible}
                onCancel={() => {
                    setIsRequestModalVisible(false)
                    setSelectedDepartmentId(null)
                    requestForm.resetFields()
                }}
                footer={[
                    <Button key='cancel' onClick={() => setIsRequestModalVisible(false)}>
                        Cancel
                    </Button>,
                    <Button
                        key='submit'
                        type='primary'
                        disabled={!selectedDepartmentId || interventionOptions.length === 0}
                        onClick={() => requestForm.submit()}
                    >
                        Submit
                    </Button>
                ]}
                width={screens.md ? 600 : '95%'}
                centered
            >
                <Form
                    form={requestForm}
                    layout='vertical'
                    onFinish={async values => {
                        try {
                            const pickedTitle = String(values.interventionTitle || '')
                            const titleKey = normalize(pickedTitle)
                            const pickedIntervention = allInterventions.find(
                                item =>
                                    String(item.departmentId || '') === values.departmentId &&
                                    normalize(String(item.interventionTitle || item.title || '')) === titleKey
                            )
                            const requestDepartmentId = String(pickedIntervention?.departmentId || '')
                            if (!requestDepartmentId) {
                                return notification.error({
                                    message: 'This intervention has no department',
                                    description: 'Please pick another intervention or contact the programme team.'
                                })
                            }

                            // (a) already in applications.required?
                            if (existingRequiredTitles.has(titleKey)) {
                                return notification.warning({
                                    message: 'Already in your plan',
                                    description:
                                        'This intervention is already listed under required.'
                                })
                            }

                            // (b) already assigned (in progress or done)?
                            if (existingAssignedTitles.has(titleKey)) {
                                return notification.warning({
                                    message: 'Already assigned',
                                    description:
                                        'This intervention is already assigned or underway.'
                                })
                            }

                            // (c) already requested and not closed?
                            const dupReqSnap = await getDocs(
                                query(
                                    collection(db, 'interventionRequests'),
                                    where('participantId', '==', participantId || ''),
                                    where('interventionTitle', '==', pickedTitle)
                                )
                            )
                            const hasOpen = dupReqSnap.docs.some(d => {
                                const s = (d.data() as any).status
                                return s !== 'rejected' && s !== 'cancelled'
                            })
                            if (hasOpen) {
                                return notification.info({
                                    message: 'Request already exists',
                                    description: 'You have an open request for this intervention.'
                                })
                            }

                            // The department's HODs are told by onInterventionRequestCreated
                            // (server side: an SME can't look up staff uids).
                            await addDoc(
                                collection(db, 'interventionRequests'),
                                {
                                    participantId: participantId || '',
                                    programId: programId || '',
                                    interventionId: pickedIntervention?.id || '',
                                    departmentId: requestDepartmentId,
                                    interventionTitle: values.interventionTitle,
                                    reason: values.reason,
                                    status: 'pending',
                                    createdAt: new Date()
                                }
                            )

                            notification.success({
                                message:
                                    'Intervention request submitted and department notified.'
                            })
                            setIsRequestModalVisible(false)
                            requestForm.resetFields()
                        } catch {
                            notification.error({
                                message: 'Failed to submit intervention request.'
                            })
                        }
                    }}
                >
                    <Form.Item
                        name='departmentId'
                        label='Department'
                        rules={[{ required: true, message: 'Select a department' }]}
                    >
                        <Select
                            placeholder='Pick department'
                            value={selectedDepartmentId as any}
                            onChange={val => {
                                setSelectedDepartmentId(val)
                                requestForm.setFieldsValue({ interventionTitle: undefined })
                            }}
                            disabled={departmentOptions.length === 0}
                        >
                            {departmentOptions.map(department => (
                                <Option key={department.id} value={department.id}>
                                    {department.name}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        name='interventionTitle'
                        label='Intervention Title'
                        rules={[{ required: true, message: 'Pick intervention title' }]}
                    >
                        <Select
                            placeholder={
                                selectedDepartmentId ? 'Pick intervention' : 'Pick department first'
                            }
                            disabled={!selectedDepartmentId}
                        >
                            {interventionOptions.map(interv => (
                                <Option key={interv.id} value={interv.title}>
                                    {interv.title}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        name='reason'
                        label='Reason'
                        rules={[{ required: true, message: 'Please provide a reason' }]}
                    >
                        <Input.TextArea
                            rows={3}
                            placeholder='Explain why you need this intervention'
                        />
                    </Form.Item>
                    {selectedDepartmentId && interventionOptions.length === 0 && (
                        <Alert
                            style={{ marginTop: 8 }}
                            type='info'
                            showIcon
                            message='All interventions in this department are already in your plan.'
                        />
                    )}
                </Form>
            </Modal>


            {/* Confirm Completion Modal */}
            <Modal
                title='Confirm Completion'
                open={isConfirmModalVisible}
                onCancel={() => {
                    if (!confirmingCompletion) setIsConfirmModalVisible(false)
                }}
                closable={!confirmingCompletion}
                maskClosable={!confirmingCompletion}
                keyboard={!confirmingCompletion}
                footer={[
                    <Button
                        key='cancel'
                        disabled={confirmingCompletion}
                        onClick={() => {
                            if (completionReviewStep === 1) setCompletionReviewStep(0)
                            else setIsConfirmModalVisible(false)
                        }}
                    >
                        {completionReviewStep === 1 ? 'Back' : 'Cancel'}
                    </Button>,
                    ...(completionReviewStep === 0 ? [
                        <Button
                            key='reject'
                            danger
                            onClick={() => {
                                setIsConfirmModalVisible(false)
                                setIsDeclineCompletionModalVisible(true)
                            }}
                        >
                            Something is missing
                        </Button>
                    ] : []),
                    <Button
                        key='submit'
                        type='primary'
                        loading={confirmingCompletion}
                        onClick={() =>
                            completionReviewStep === 0
                                ? setCompletionReviewStep(1)
                                : confirmForm.submit()
                        }
                    >
                        {completionReviewStep === 0 ? 'This is correct' : 'Confirm Completion'}
                    </Button>
                ]}
                width={screens.md ? 560 : '95%'}
                centered
            >
                {completionReviewStep === 0 ? (
                    <Space direction='vertical' size={14} style={{ width: '100%' }}>
                        <Alert
                            type='info'
                            showIcon
                            message='Please review the delivered work before confirming.'
                            description='Only confirm when this intervention and the sessions you attended are correct.'
                        />
                        <Card size='small' title={selectedIntervention?.interventionTitle || 'Intervention'}>
                            <Descriptions size='small' column={1}>
                                <Descriptions.Item label='Department'>{departmentLabel(selectedIntervention?.departmentId) || '—'}</Descriptions.Item>
                                <Descriptions.Item label='Sessions attended'>{attendedCompletionAppointments.length} of {completionAppointments.length || Number((selectedIntervention as any)?.tracking?.sessionsLogged || 0)}</Descriptions.Item>
                            </Descriptions>
                        </Card>
                        {completionAppointments.length ? (
                            <List
                                size='small'
                                bordered
                                dataSource={completionAppointments}
                                renderItem={appointment => {
                                    const attendance = String(selectedIntervention?.sessionAttendanceByAppointment?.[appointment.id]?.outcome || appointment.attendance?.status || 'not recorded')
                                    const topics = selectedIntervention?.sessionAttendanceByAppointment?.[appointment.id]?.coveredPoints || appointment.sessionCoverage?.latest?.coveredPoints || []
                                    return <List.Item>
                                        <Space direction='vertical' size={2}>
                                            <Text strong>{dayjs(appointment.startTime?.toDate?.() || appointment.startTime).format('DD MMM YYYY')} · {appointment.sessionTitle || appointment.interventionTitle}</Text>
                                            <Text type='secondary'>Attendance: {attendance.replace(/-/g, ' ')}</Text>
                                            {topics.length ? <Text type='secondary'>Covered: {topics.join(', ')}</Text> : null}
                                        </Space>
                                    </List.Item>
                                }}
                            />
                        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No session records are available for this intervention.' />}
                    </Space>
                ) : (
                    <Form
                        form={confirmForm}
                        layout='vertical'
                        onFinish={handleConfirmCompletion}
                    >
                        <Form.Item
                            name='rating'
                            label='Rating'
                            rules={[
                                { required: true, message: 'Please rate the intervention' }
                            ]}
                        >
                            <Rate />
                        </Form.Item>
                        <Form.Item
                            name='feedback'
                            label='Feedback'
                            rules={[
                                {
                                    required: true,
                                    message:
                                        "Please comment on the facilitator's professionalism, intervention quality, etc."
                                }
                            ]}
                        >
                            <Input.TextArea
                                rows={3}
                                placeholder="Please comment on the facilitator's professionalism, intervention quality, etc."
                            />
                        </Form.Item>
                        <Alert
                            type='warning'
                            showIcon
                            message='By confirming, your signature will be added to the MOV.'
                        />
                    </Form>
                )}
            </Modal>

            {/* Report a problem with a completion: the start of a delivery dispute. */}
            <DisputeDeliveryModal
                open={isDeclineCompletionModalVisible}
                interventionTitle={(selectedIntervention as any)?.interventionTitle}
                facilitatorName={(selectedIntervention as any)?.assigneeName || (selectedIntervention as any)?.consultantName}
                onClose={() => setIsDeclineCompletionModalVisible(false)}
                onSubmit={async (category, reason) => {
                    if (selectedIntervention) await handleRejectCompletion(selectedIntervention, reason, category)
                }}
            />

        </div>
    )
}

export default InterventionsTrackingView
