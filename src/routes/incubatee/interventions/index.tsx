import React, { useState, useEffect, useMemo } from 'react'
import {
    Card,
    Table,
    Button,
    Space,
    Tag,
    Modal,
    Drawer,
    Descriptions,
    Form,
    Select,
    Input,
    Rate,
    Divider,
    Typography,
    notification,
    message,
    Tooltip,
    Row,
    Col,
    Alert,
    List,
    Grid,
    Empty,
    Tabs,
    DatePicker,
    Timeline,
    Progress
} from 'antd'
import {
    PlusOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ExclamationCircleOutlined,
    FileSearchOutlined,
    ClockCircleOutlined,
    LineChartOutlined,
    EyeOutlined
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
    limit
} from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { v4 as uuidv4 } from 'uuid'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { toAssignedInterventionView } from '@/services/assignedInterventionService'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import { assignmentDateLabel } from '@/lib/appointmentAssignments'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import { applyKpiDeltas } from '@/lib/kpis' // ⬅️ switched to new API
import {
    confirmCompletion as confirmCompletionAction,
    rejectCompletion as rejectCompletionAction
} from '@/lib/interventions'

const { Text } = Typography
const { Option } = Select
const { useBreakpoint } = Grid

// Types
interface RequiredIntervention {
    id: string
    title: string
    area: string
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
    areaOfSupport: string | string[] | Record<string, any>
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
    areaOfSupport: string
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
        status: string
        intervention: string
        dateRange: [Dayjs | null, Dayjs | null] | null
    }>({ status: 'all', intervention: 'all', dateRange: null })
    const [isRequestModalVisible, setIsRequestModalVisible] = useState(false)
    const [isConfirmModalVisible, setIsConfirmModalVisible] = useState(false)
    const [completionReviewStep, setCompletionReviewStep] = useState<0 | 1>(0)
    const [isDetailsVisible, setIsDetailsVisible] = useState(false)
    const [viewedIntervention, setViewedIntervention] =
        useState<AssignedIntervention | null>(null)
    const [confirmingCompletion, setConfirmingCompletion] = useState(false)
    const [selectedIntervention, setSelectedIntervention] =
        useState<AssignedIntervention | null>(null)
    const [requestForm] = Form.useForm()
    const [confirmForm] = Form.useForm()
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [programId, setProgramId] = useState<string | null>(null)
    const [allInterventions, setAllInterventions] = useState<any[]>([])
    const [selectedArea, setSelectedArea] = useState<string | null>(null)
    const [isDeclineCompletionModalVisible, setIsDeclineCompletionModalVisible] =
        useState(false)
    const [rejectCompletionForm] = Form.useForm()

    const { user } = useFullIdentity()
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
                if (!participantDoc) {
                    const participants = await getDocs(collection(db, 'participants'))
                    participantDoc = participants.docs.find(item =>
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
            setLoading(true)
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
                            areaOfSupport:
                                interventionData['areaOfSupport'] || data.areaOfSupport || '',
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
                                return (
                                    confirmation === 'pending' &&
                                    !['cancelled', 'declined'].includes(status)
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
                if (!cancelled) setLoading(false)
            }
        }
        fetchAssigned()

        return () => {
            cancelled = true
        }
    }, [participantId])

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

    const areaOptions = Array.from(
        new Set(allInterventions.map(i => i.areaOfSupport).filter(Boolean))
    )
    const interventionOptions = allInterventions
        .filter(i => i.areaOfSupport === selectedArea)
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
        if (!intervention.assigneeId && !intervention.interventionId)
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
            await confirmCompletionAction(
                db,
                record.id,
                {
                    rating: values.rating,
                    comments: values.feedback
                },
                {
                    signerSignatureUrl: user?.signatureURL || ''
                }
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

                const areaStr =
                    typeof record.areaOfSupport === 'string'
                        ? record.areaOfSupport
                        : Array.isArray(record.areaOfSupport)
                            ? record.areaOfSupport.join(', ')
                            : record.areaOfSupport && typeof record.areaOfSupport === 'object'
                                ? Object.keys(record.areaOfSupport).join(', ')
                                : ''

                const q = Math.floor(dayjs().month() / 3) + 1
                const quarterKey = `${dayjs().year()}-Q${q}`

                await applyKpiDeltas(
                    {
                        participantId: record.participantId,
                        programId,
                        areaOfSupport: areaStr,
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
        reason: string
    ) => {
        try {
            await rejectCompletionAction(db, intervention.id, reason, {
                deptName: user?.departmentName,
                uid: user?.uid
            })
            setAssignedInterventions(prev =>
                prev.map(i =>
                    i.id === intervention.id
                        ? { ...i, participantCompletionStatus: 'rejected', assignmentStatus: 'in-progress' }
                        : i
                )
            )
            message.success('Completion rejected.')
        } catch (err) {
            console.error(err)
            message.error('Failed to reject completion. Please try again.')
        }
    }

    // Filters
    const allWithUnassigned = useMemo(() => {
        // Firestore assignment document IDs are canonical. Keeping one row per
        // ID also prevents a late/repeated load from multiplying rendered rows.
        const assignedById = new Map<string, AssignedIntervention>()
        assignedInterventions.forEach(intervention => {
            const id = String(intervention.id || '').trim()
            if (id) assignedById.set(id, intervention)
        })
        const uniqueAssigned = Array.from(assignedById.values())
        const assignedTitles = new Set(
            uniqueAssigned.map(item => normalize(item.interventionTitle)).filter(Boolean)
        )

        // Some older applications contain the same required intervention more
        // than once. Treat ID/title as the logical identity before adding the
        // pending-assignment placeholder to the table.
        const requiredByKey = new Map<string, RequiredIntervention>()
        requiredInterventions.forEach(required => {
            const titleKey = normalize(required.title)
            const key = String(required.id || '').trim() || titleKey
            if (key && titleKey && !requiredByKey.has(key)) {
                requiredByKey.set(key, required)
            }
        })

        const unassigned = Array.from(requiredByKey.values())
            .filter(required => !assignedTitles.has(normalize(required.title)))
            .map(required => {
                const stableKey = String(required.id || '').trim() || normalize(required.title)
                return {
                    id: `unassigned-${stableKey}`,
                    interventionId: '',
                    participantId: participantId || '',
                    assigneeId: '',
                    participantName: '',
                    interventionTitle: required.title,
                    description: '',
                    areaOfSupport: required.area,
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
    }, [assignedInterventions, participantId, requiredInterventions])

    const assignedInterventionOptions = Array.from(new Set(
        allWithUnassigned.map(item => String(item.interventionTitle || '').trim()).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b))

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
            const status = deriveDisplayStatus(intervention).toLowerCase()
            if (filters.status !== 'all' && status !== filters.status.toLowerCase()) return false
            if (filters.intervention !== 'all' && intervention.interventionTitle !== filters.intervention) return false
            if (filters.dateRange?.[0] || filters.dateRange?.[1]) {
                const due = interventionDate(intervention.dueDate)
                if (!due) return false
                if (filters.dateRange[0] && due.isBefore(filters.dateRange[0].startOf('day'))) return false
                if (filters.dateRange[1] && due.isAfter(filters.dateRange[1].endOf('day'))) return false
            }
            return true
        }).sort((left, right) => {
            const priority = actionPriority(left) - actionPriority(right)
            if (priority) return priority
            const leftDue = interventionDate(left.dueDate)?.valueOf() ?? Number.MAX_SAFE_INTEGER
            const rightDue = interventionDate(right.dueDate)?.valueOf() ?? Number.MAX_SAFE_INTEGER
            return leftDue - rightDue || left.interventionTitle.localeCompare(right.interventionTitle)
        })
    }, [allWithUnassigned, filters])

    const openInterventionDetails = (intervention: AssignedIntervention) => {
        setViewedIntervention(intervention)
        setIsDetailsVisible(true)
    }

    const renderInterventionDetails = (intervention: AssignedIntervention) => {
        const displayStatus = deriveDisplayStatus(intervention)
        const isCompleted = displayStatus.trim().toLowerCase() === 'completed'
        const progress = isCompleted
            ? 100
            : Math.min(
                100,
                Math.max(
                    Number(intervention.computedProgress || 0),
                    Number(intervention.progress || 0),
                    Number(intervention.deliveryWorkProgress || 0)
                )
            )
        const updates = [...(intervention.progressUpdates || [])].sort(
            (left, right) =>
                dayjs(right.createdAt?.toDate?.() || right.createdAt).valueOf() -
                dayjs(left.createdAt?.toDate?.() || left.createdAt).valueOf()
        )
        const area = typeof intervention.areaOfSupport === 'string'
            ? intervention.areaOfSupport
            : Array.isArray(intervention.areaOfSupport)
                ? intervention.areaOfSupport.join(', ')
                : intervention.areaOfSupport &&
                    typeof intervention.areaOfSupport === 'object'
                    ? Object.keys(intervention.areaOfSupport).join(', ')
                    : 'Not specified'
        const dueDate = interventionDate(intervention.dueDate)

        return (
            <Space direction='vertical' size='large' style={{ width: '100%' }}>
                <Descriptions
                    bordered
                    size='small'
                    column={{ xs: 1, sm: 2 }}
                    items={[
                        {
                            key: 'status',
                            label: 'Status',
                            children: <Tag color='blue'>{displayStatus}</Tag>
                        },
                        {
                            key: 'facilitator',
                            label: 'Facilitator',
                            children: intervention.assigneeName || 'Not assigned yet'
                        },
                        {
                            key: 'area',
                            label: 'Department',
                            children: area,
                            span: 2
                        },
                        {
                            key: 'due',
                            label: 'Due date',
                            children: dueDate ? dueDate.format('DD MMM YYYY') : 'Not set'
                        },
                        {
                            key: 'progress',
                            label: 'Progress',
                            span: 2,
                            children: (
                                <Progress
                                    percent={progress}
                                    size='small'
                                    status={progress >= 100 ? 'success' : 'active'}
                                />
                            )
                        }
                    ]}
                />

                <Card size='small' title='Progress timeline'>
                    {updates.length ? (
                        <Timeline
                            style={{ marginTop: 8 }}
                            items={updates.map(update => ({
                                color: 'blue',
                                children: (
                                    <Space direction='vertical' size={4}>
                                        <Text type='secondary'>
                                            {dayjs(
                                                update.createdAt?.toDate?.() || update.createdAt
                                            ).format('DD MMM YYYY')}
                                        </Text>
                                        <Text>{update.note || 'Progress updated.'}</Text>
                                    </Space>
                                )
                            }))}
                        />
                    ) : (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description='No progress updates yet'
                        />
                    )}
                </Card>

                {intervention.feedback && (
                    <Card size='small' title='Completion feedback'>
                        <div><Rate disabled value={intervention.feedback.rating} /></div>
                        <Text>
                            {intervention.feedback.comments || 'No comments provided.'}
                        </Text>
                    </Card>
                )}
            </Space>
        )
    }

    // Desktop columns
    const interventionColumns = [
        {
            title: 'Intervention',
            dataIndex: 'interventionTitle',
            key: 'interventionTitle',
            ellipsis: true,
            render: (text: string, record: any) => (
                <Space direction='vertical' size={0}>
                    <Text strong ellipsis={{ tooltip: text }}>
                        {text}
                    </Text>
                    <Text type='secondary' ellipsis>
                        {[
                            `Assigned ${assignmentDateLabel(record)}`,
                            record.cycleKey ? `Cycle ${record.cycleKey}` : '',
                            record.id ? `Ref ${String(record.id).slice(0, 8)}` : ''
                        ].filter(Boolean).join(' · ')}
                    </Text>
                    <Text type='secondary' ellipsis>
                        {typeof record.area === 'string'
                            ? record.area
                            : typeof record.areaOfSupport === 'string'
                                ? record.areaOfSupport
                                : Array.isArray(record.areaOfSupport)
                                    ? record.areaOfSupport.join(', ')
                                    : typeof record.areaOfSupport === 'object'
                                        ? Object.keys(record.areaOfSupport).join(', ')
                                        : 'N/A'}
                    </Text>
                </Space>
            )
        },
        {
            title: 'Facilitator',
            dataIndex: 'assigneeName',
            key: 'assigneeName',
            ellipsis: true,
            width: 160
        },
        {
            title: 'Due',
            dataIndex: 'dueDate',
            key: 'dueDate',
            width: 130,
            render: (dueDate: any) => {
                if (!dueDate) return '-'
                if (dueDate?.seconds)
                    return dayjs(dueDate.seconds * 1000).format('YYYY-MM-DD')
                return dayjs(dueDate).isValid()
                    ? dayjs(dueDate).format('YYYY-MM-DD')
                    : '-'
            }
        },
        {
            title: 'Status',
            key: 'status',
            width: 210,
            render: (_: any, record: AssignedIntervention) => {
                const status = deriveDisplayStatus(record)
                let color: any = 'default'
                let icon: any = null
                switch (status) {
                    case 'Pending':
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
                    case 'Completed':
                        color = 'green'
                        icon = <CheckCircleOutlined />
                        break
                    case 'Declined':
                    case 'Facilitator Declined':
                    case 'Completion Rejected':
                        color = 'red'
                        icon = <CloseCircleOutlined />
                        break
                }
                return (
                    <Tag color={color} icon={icon}>
                        {status}
                    </Tag>
                )
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 280,
            render: (_: any, record: AssignedIntervention) => (
                <Space wrap>
                    <Button
                        size='small'
                        shape='round'
                        icon={<EyeOutlined />}
                        onClick={() => openInterventionDetails(record)}
                    >
                        View
                    </Button>
                    {resolveAssignmentLifecycle(record).key === 'awaiting-participant-acceptance' && (
                        pendingAppointmentAssignmentIds.has(record.id) ? (
                            <Tooltip title="Open Appointments to accept or decline the appointment and intervention together">
                                <Button
                                    size='small'
                                    shape='round'
                                    onClick={() => navigate('/incubatee/appointments')}
                                >
                                    View Appointment
                                </Button>
                            </Tooltip>
                        ) : (
                            <Tooltip title="The facilitator still needs to schedule the first appointment">
                                <Tag>Appointment not scheduled yet</Tag>
                            </Tooltip>
                        )
                    )}

                    {resolveAssignmentLifecycle(record).key === 'awaiting-participant-confirmation' && (
                        <>
                            <Tooltip title='Confirm intervention was completed successfully'>
                                <Button
                                    size='small'
                                    shape='round'
                                    variant='filled'
                                    color='blue'
                                    style={{ border: '1px solid #1677ff' }}
                                    onClick={() => openCompletionReview(record)}
                                >
                                    Confirm
                                </Button>
                            </Tooltip>
                            <Tooltip title='Reject completion and provide a reason'>
                                <Button
                                    size='small'
                                    shape='round'
                                    variant='filled'
                                    color='orange'
                                    style={{ border: '1px solid #fa8c16' }}
                                    onClick={() => {
                                        setSelectedIntervention(record)
                                        setIsDeclineCompletionModalVisible(true)
                                    }}
                                >
                                    Reject
                                </Button>
                            </Tooltip>
                        </>
                    )}
                </Space>
            )
        }
    ]

    const requestedColumns = [
        {
            title: 'Intervention',
            dataIndex: 'interventionTitle',
            key: 'title',
            render: (text: string, r: InterventionRequest) => (
                <Space direction='vertical' size={0}>
                    <Text strong ellipsis={{ tooltip: text }}>
                        {text}
                    </Text>
                    <Text type='secondary'>{r.areaOfSupport || '—'}</Text>
                </Space>
            )
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            width: 140,
            render: (status: string) => {
                const { label, color } = normalizeRequestStatus(status)
                return <Tag color={color}>{label}</Tag>
            }
        },
        {
            title: 'Submitted',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 160,
            render: (dt: any) =>
                dt?.seconds ? dayjs(dt.seconds * 1000).format('YYYY-MM-DD') : '-'
        },
        {
            title: 'Reason',
            dataIndex: 'reason',
            key: 'reason',
            ellipsis: true
        },
        {
            title: 'Decision Note',
            key: 'decisionReason',
            ellipsis: true,
            render: (_: any, r: InterventionRequest) => {
                const { label } = normalizeRequestStatus(r.status)
                return label === 'Rejected' ? r.decisionReason || '—' : '—'
            }
        }
    ]

    // Metrics
    const totalRequired = Math.max(requiredInterventions.length, assignedInterventions.length)
    const completedCount = assignedInterventions.filter(
        i => resolveAssignmentLifecycle(i).isCompleted
    ).length
    const ongoingCount = assignedInterventions.filter(
        i => resolveAssignmentLifecycle(i).isOpen
    ).length
    const completionRate = totalRequired
        ? Math.round((completedCount / totalRequired) * 100)
        : 0

    const assignedFilterBar = (
        <Row gutter={[12, 12]} align='middle'>
            <Col xs={24} sm={12} lg={5}>
                <Select
                    value={filters.status}
                    onChange={status => setFilters(current => ({ ...current, status }))}
                    style={{ width: '100%' }}
                    options={[
                        ['all', 'All statuses'],
                        ['pending assignment', 'Pending Assignment'],
                        ['awaiting facilitator', 'Awaiting Facilitator'],
                        ['appointment setup pending', 'Appointment Setup Pending'],
                        ['awaiting appointment response', 'Awaiting Appointment Response'],
                        ['in progress', 'In Progress'],
                        ['awaiting your confirmation', 'Awaiting Your Confirmation'],
                        ['completed', 'Completed'],
                        ['declined', 'Declined'],
                        ['facilitator declined', 'Facilitator Declined'],
                        ['completion rejected', 'Completion Rejected']
                    ].map(([value, label]) => ({ value, label }))}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <Select
                    showSearch
                    optionFilterProp='label'
                    value={filters.intervention}
                    onChange={intervention => setFilters(current => ({ ...current, intervention }))}
                    style={{ width: '100%' }}
                    options={[
                        { value: 'all', label: 'All interventions' },
                        ...assignedInterventionOptions.map(value => ({ value, label: value }))
                    ]}
                />
            </Col>
            {screens.lg ? (
                <Col lg={7}>
                    <DatePicker.RangePicker
                        value={filters.dateRange}
                        onChange={dateRange => setFilters(current => ({
                            ...current,
                            dateRange: dateRange as [Dayjs | null, Dayjs | null] | null
                        }))}
                        allowEmpty={[true, true]}
                        placeholder={['Due from', 'Due to']}
                        style={{ width: '100%' }}
                    />
                </Col>
            ) : null}
            <Col xs={24} sm={24} lg={6}>
                <Button
                    block
                    shape='round'
                    variant='filled'
                    color='blue'
                    icon={<PlusOutlined />}
                    style={{ border: '1px solid #1677ff' }}
                    onClick={() => {
                        setIsRequestModalVisible(true)
                        setSelectedArea(null)
                        requestForm.resetFields()
                    }}
                >
                    Request New Intervention
                </Button>
            </Col>
        </Row>
    )

    return (
        <div
            style={{
                padding: isMobile ? 12 : 20,
                minHeight: '100vh',
                width: '100%',
                maxWidth: '100%',
                minWidth: 0,
                overflowX: 'hidden'
            }}
        >
            <Helmet>
                <title>Interventions Tracking</title>
            </Helmet>

            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                <Col xs={12} sm={12} lg={6}>
                    <MotionCard.Metric
                        loading={loading}
                        title='Total Required'
                        value={totalRequired}
                        subtitle='Required and assigned'
                        icon={<FileSearchOutlined style={{ color: '#1677ff' }} />}
                        iconBg='rgba(22,119,255,.12)'
                    />
                </Col>
                <Col xs={12} sm={12} lg={6}>
                    <MotionCard.Metric
                        loading={loading}
                        title='Ongoing'
                        value={ongoingCount}
                        subtitle='Open interventions'
                        icon={<ClockCircleOutlined style={{ color: '#fa8c16' }} />}
                        iconBg='rgba(250,140,22,.14)'
                    />
                </Col>
                <Col xs={12} sm={12} lg={6}>
                    <MotionCard.Metric
                        loading={loading}
                        title='Completed'
                        value={completedCount}
                        subtitle='SME confirmed'
                        icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                        iconBg='rgba(82,196,26,.14)'
                    />
                </Col>
                <Col xs={12} sm={12} lg={6}>
                    <MotionCard.Metric
                        loading={loading}
                        title='Completion Rate'
                        value={`${completionRate}%`}
                        subtitle='Of required interventions'
                        icon={<LineChartOutlined style={{ color: '#722ed1' }} />}
                        iconBg='rgba(114,46,209,.12)'
                    />
                </Col>
            </Row>

            {/* Interventions: Table (desktop) / Card List (mobile) */}
            <Tabs
                defaultActiveKey='assigned'
                centered
                items={[
                    {
                        key: 'assigned',
                        label: 'Assigned & Required',
                        children: (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4 }}
                            >
                                <MotionCard filterBar={assignedFilterBar}>
                                    {isMobile ? (
                                        <List
                                            loading={loading}
                                            dataSource={filteredInterventions}
                                            pagination={{ pageSize: 5 }}
                                            renderItem={(item: AssignedIntervention) => {
                                                const status = deriveDisplayStatus(item)
                                                const due = !item.dueDate
                                                    ? '-'
                                                    : item.dueDate?.seconds
                                                        ? dayjs(item.dueDate.seconds * 1000).format(
                                                            'YYYY-MM-DD'
                                                        )
                                                        : dayjs(item.dueDate).isValid()
                                                            ? dayjs(item.dueDate).format('YYYY-MM-DD')
                                                            : '-'

                                                const statusUi = (() => {
                                                    let color: any = 'default'
                                                    let icon: any = null
                                                    switch (status) {
                                                        case 'Awaiting Facilitator':
                                                            color = 'orange'
                                                            icon = <ExclamationCircleOutlined />
                                                            break
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
                                                        case 'Completed':
                                                            color = 'green'
                                                            icon = <CheckCircleOutlined />
                                                            break
                                                        case 'Declined':
                                                        case 'Facilitator Declined':
                                                        case 'Completion Rejected':
                                                            color = 'red'
                                                            icon = <CloseCircleOutlined />
                                                            break
                                                        default:
                                                            color = 'default'
                                                            icon = <ClockCircleOutlined />
                                                    }
                                                    return (
                                                        <Tag color={color} icon={icon}>
                                                            {status}
                                                        </Tag>
                                                    )
                                                })()

                                                return (
                                                    <List.Item
                                                        style={{ paddingLeft: 0, paddingRight: 0 }}
                                                    >
                                                        <Card
                                                            size='small'
                                                            style={{
                                                                width: '100%',
                                                                borderRadius: 10,
                                                                border: '1px solid #e6f0ff'
                                                            }}
                                                        >
                                                            <Space
                                                                direction='vertical'
                                                                size={6}
                                                                style={{ width: '100%' }}
                                                            >
                                                                <Space
                                                                    align='baseline'
                                                                    style={{
                                                                        justifyContent: 'space-between',
                                                                        width: '100%'
                                                                    }}
                                                                >
                                                                    <Text strong style={{ fontSize: 16 }}>
                                                                        {item.interventionTitle}
                                                                    </Text>
                                                                    {statusUi}
                                                                </Space>
                                                                <Text type='secondary'>
                                                                    {[
                                                                        `Assigned ${assignmentDateLabel(item)}`,
                                                                        item.cycleKey ? `Cycle ${item.cycleKey}` : '',
                                                                        item.id ? `Ref ${String(item.id).slice(0, 8)}` : ''
                                                                    ].filter(Boolean).join(' · ')}
                                                                </Text>
                                                                <Text type='secondary'>
                                                                    {typeof item.areaOfSupport === 'string'
                                                                        ? item.areaOfSupport
                                                                        : Array.isArray(item.areaOfSupport)
                                                                            ? item.areaOfSupport.join(', ')
                                                                            : typeof item.areaOfSupport === 'object'
                                                                                ? Object.keys(item.areaOfSupport).join(', ')
                                                                                : 'N/A'}
                                                                </Text>
                                                                <Space
                                                                    style={{
                                                                        justifyContent: 'space-between',
                                                                        width: '100%'
                                                                    }}
                                                                >
                                                                    <Text type='secondary'>Due: {due}</Text>
                                                                    <Text type='secondary'>
                                                                        {item.assigneeName || '—'}
                                                                    </Text>
                                                                </Space>

                                                                {/* Actions (stack nicely on mobile) */}
                                                                <Space
                                                                    wrap
                                                                    style={{ width: '100%', marginTop: 6 }}
                                                                >
                                                                    <Button
                                                                        size='small'
                                                                        shape='round'
                                                                        icon={<EyeOutlined />}
                                                                        onClick={() => openInterventionDetails(item)}
                                                                        block
                                                                    >
                                                                        View
                                                                    </Button>
                                                                    {resolveAssignmentLifecycle(item).key === 'awaiting-participant-acceptance' && (
                                                                        pendingAppointmentAssignmentIds.has(item.id) ? (
                                                                            <Button
                                                                                size='small'
                                                                                shape='round'
                                                                                block
                                                                                onClick={() => navigate('/incubatee/appointments')}
                                                                            >
                                                                                View Appointment
                                                                            </Button>
                                                                        ) : (
                                                                            <Tag style={{ width: '100%', textAlign: 'center' }}>
                                                                                Appointment not scheduled yet
                                                                            </Tag>
                                                                        )
                                                                    )}

                                                                    {resolveAssignmentLifecycle(item).key === 'awaiting-participant-confirmation' && (
                                                                        <>
                                                                            <Button
                                                                                size='small'
                                                                                shape='round'
                                                                                variant='filled'
                                                                                color='blue'
                                                                                style={{ border: '1px solid #1677ff' }}
                                                                                onClick={() => openCompletionReview(item)}
                                                                                block
                                                                            >
                                                                                Confirm
                                                                            </Button>
                                                                            <Button
                                                                                size='small'
                                                                                shape='round'
                                                                                variant='filled'
                                                                                color='orange'
                                                                                style={{ border: '1px solid #fa8c16' }}
                                                                                onClick={() => {
                                                                                    setSelectedIntervention(item)
                                                                                    setIsDeclineCompletionModalVisible(
                                                                                        true
                                                                                    )
                                                                                }}
                                                                                block
                                                                            >
                                                                                Reject
                                                                            </Button>
                                                                        </>
                                                                    )}
                                                                </Space>

                                                            </Space>
                                                        </Card>
                                                    </List.Item>
                                                )
                                            }}
                                        />
                                    ) : (
                                        <div style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
                                            <Table
                                                dataSource={filteredInterventions}
                                                columns={interventionColumns as any}
                                                rowKey='id'
                                                tableLayout='fixed'
                                                pagination={{ pageSize: 5, responsive: true, position: ['bottomCenter'], showSizeChanger: false }}
                                                loading={loading}
                                                size='small'
                                                scroll={{ x: 900 }}
                                            />
                                        </div>
                                    )}
                                </MotionCard>
                            </motion.div>
                        )
                    },
                    {
                        key: 'requested',
                        label: `Requested (${requests.length})`,
                        children: (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4 }}
                            >
                                <Card
                                    style={{
                                        boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                        transition: 'all 0.3s ease',
                                        borderRadius: 12,
                                        border: '1px solid #d6e4ff'
                                    }}
                                >
                                    {requests.length === 0 && !loadingRequests ? (
                                        <Empty
                                            description='No intervention requests yet'
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        >
                                            <Button
                                                type='primary'
                                                onClick={() => {
                                                    setIsRequestModalVisible(true)
                                                    setSelectedArea(null)
                                                    requestForm.resetFields()
                                                }}
                                            >
                                                Request Your First Intervention
                                            </Button>
                                        </Empty>
                                    ) : isMobile ? (
                                        <List
                                            loading={loadingRequests}
                                            dataSource={requests}
                                            pagination={{ pageSize: 6 }}
                                            renderItem={(r: InterventionRequest) => (
                                                <List.Item style={{ paddingLeft: 0, paddingRight: 0 }}>
                                                    <Card
                                                        size='small'
                                                        style={{
                                                            width: '100%',
                                                            borderRadius: 10,
                                                            border: '1px solid #e6f0ff'
                                                        }}
                                                    >
                                                        <Space
                                                            direction='vertical'
                                                            size={6}
                                                            style={{ width: '100%' }}
                                                        >
                                                            <Space
                                                                align='baseline'
                                                                style={{
                                                                    justifyContent: 'space-between',
                                                                    width: '100%'
                                                                }}
                                                            >
                                                                <Text strong style={{ fontSize: 16 }}>
                                                                    {r.interventionTitle}
                                                                </Text>
                                                                {(() => {
                                                                    const { label, color } =
                                                                        normalizeRequestStatus(r.status)
                                                                    return <Tag color={color}>{label}</Tag>
                                                                })()}
                                                            </Space>
                                                            <Text type='secondary'>
                                                                {r.areaOfSupport || '—'}
                                                            </Text>
                                                            <Space
                                                                style={{
                                                                    justifyContent: 'space-between',
                                                                    width: '100%'
                                                                }}
                                                            >
                                                                <Text type='secondary'>
                                                                    Submitted:{' '}
                                                                    {r.createdAt?.seconds
                                                                        ? dayjs(r.createdAt.seconds * 1000).format(
                                                                            'YYYY-MM-DD'
                                                                        )
                                                                        : '-'}
                                                                </Text>
                                                            </Space>

                                                            <Divider style={{ margin: '8px 0' }} />

                                                            <Text>
                                                                <strong>Your Reason:</strong>{' '}
                                                                {r.reason?.trim() ? (
                                                                    r.reason
                                                                ) : (
                                                                    <Text type='secondary'>—</Text>
                                                                )}
                                                            </Text>

                                                            {normalizeRequestStatus(r.status).label ===
                                                                'Rejected' && (
                                                                    <Text>
                                                                        <strong>Decision Note:</strong>{' '}
                                                                        {r.decisionReason?.trim() ? (
                                                                            r.decisionReason
                                                                        ) : (
                                                                            <Text type='secondary'>—</Text>
                                                                        )}
                                                                    </Text>
                                                                )}
                                                        </Space>
                                                    </Card>
                                                </List.Item>
                                            )}
                                        />
                                    ) : (
                                        <Table
                                            rowKey='id'
                                            loading={loadingRequests}
                                            dataSource={requests}
                                            columns={requestedColumns as any}
                                            pagination={{ pageSize: 8, responsive: true }}
                                            size='small'
                                        />
                                    )}
                                </Card>
                            </motion.div>
                        )
                    }
                ]}
            />

            {/* Request Modal */}
            <Modal
                title='Request New Intervention'
                open={isRequestModalVisible}
                onCancel={() => {
                    setIsRequestModalVisible(false)
                    setSelectedArea(null)
                    requestForm.resetFields()
                }}
                footer={[
                    <Button key='cancel' onClick={() => setIsRequestModalVisible(false)}>
                        Cancel
                    </Button>,
                    <Button
                        key='submit'
                        type='primary'
                        disabled={!selectedArea || interventionOptions.length === 0}
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
                                item => normalize(String(item.interventionTitle || item.title || '')) === titleKey
                            )

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
                                    // optionally also: where('areaOfSupport','==', values.areaOfSupport)
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

                            // proceed (unchanged)
                            const docRef = await addDoc(
                                collection(db, 'interventionRequests'),
                                {
                                    participantId: participantId || '',
                                    programId: programId || '',
                                    interventionId: pickedIntervention?.id || '',
                                    departmentId: pickedIntervention?.departmentId || '',
                                    areaOfSupport: values.areaOfSupport,
                                    interventionTitle: values.interventionTitle,
                                    reason: values.reason,
                                    status: 'pending',
                                    createdAt: new Date()
                                }
                            )

                            await addDoc(collection(db, 'notifications'), {
                                type: 'intervention-request',
                                recipientRoles: ['operations'],
                                department: values.areaOfSupport,
                                areaOfSupport: values.areaOfSupport,
                                interventionTitle: values.interventionTitle,
                                reason: values.reason,
                                participantId: participantId || '',
                                interventionRequestId: docRef.id,
                                status: 'pending',
                                message: {
                                    operations: `A new intervention "${values.interventionTitle}" has been requested in ${values.areaOfSupport}. Reason: ${values.reason}`
                                },
                                createdAt: new Date(),
                                readBy: {}
                            })

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
                        name='areaOfSupport'
                        label='Area of Support'
                        rules={[{ required: true, message: 'Select area of support' }]}
                    >
                        <Select
                            placeholder='Pick Area'
                            value={selectedArea as any}
                            onChange={val => {
                                setSelectedArea(val)
                                requestForm.setFieldsValue({ interventionTitle: undefined })
                            }}
                            disabled={areaOptions.length === 0}
                        >
                            {areaOptions.map(area => (
                                <Option key={area} value={area}>
                                    {area}
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
                                selectedArea ? 'Pick intervention' : 'Pick area first'
                            }
                            disabled={!selectedArea}
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
                    {selectedArea && interventionOptions.length === 0 && (
                        <Alert
                            style={{ marginTop: 8 }}
                            type='info'
                            showIcon
                            message='All interventions in this area are already in your plan.'
                        />
                    )}
                </Form>
            </Modal>

            {isMobile ? (
                <Drawer
                    title={viewedIntervention?.interventionTitle || 'Intervention details'}
                    placement='bottom'
                    height='88vh'
                    open={isDetailsVisible}
                    onClose={() => setIsDetailsVisible(false)}
                    destroyOnClose
                    styles={{ body: { paddingBottom: 32 } }}
                >
                    {viewedIntervention && renderInterventionDetails(viewedIntervention)}
                </Drawer>
            ) : (
                <Modal
                    title={viewedIntervention?.interventionTitle || 'Intervention details'}
                    open={isDetailsVisible}
                    onCancel={() => setIsDetailsVisible(false)}
                    footer={[
                        <Button key='close' onClick={() => setIsDetailsVisible(false)}>
                            Close
                        </Button>
                    ]}
                    width={760}
                    destroyOnClose
                    centered
                >
                    {viewedIntervention && renderInterventionDetails(viewedIntervention)}
                </Modal>
            )}

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
                                <Descriptions.Item label='Department'>{typeof selectedIntervention?.areaOfSupport === 'string' ? selectedIntervention.areaOfSupport : '—'}</Descriptions.Item>
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

            {/* Reject Completion Modal */}
            <Modal
                title='Reject Completion'
                open={isDeclineCompletionModalVisible}
                onCancel={() => setIsDeclineCompletionModalVisible(false)}
                footer={[
                    <Button
                        key='cancel'
                        onClick={() => setIsDeclineCompletionModalVisible(false)}
                    >
                        Cancel
                    </Button>,
                    <Button
                        key='submit'
                        type='primary'
                        danger
                        onClick={() => rejectCompletionForm.submit()}
                    >
                        Submit
                    </Button>
                ]}
                width={screens.md ? 560 : '95%'}
                centered
            >
                <Form
                    form={rejectCompletionForm}
                    layout='vertical'
                    onFinish={values => {
                        if (selectedIntervention) {
                            handleRejectCompletion(selectedIntervention, values.reason)
                            setIsDeclineCompletionModalVisible(false)
                            rejectCompletionForm.resetFields()
                        }
                    }}
                >
                    <Form.Item
                        name='reason'
                        label='Reason for Rejection'
                        rules={[{ required: true, message: 'Please provide a reason' }]}
                    >
                        <Input.TextArea
                            rows={4}
                            placeholder="Explain why you're rejecting this intervention's completion"
                        />
                    </Form.Item>
                </Form>
            </Modal>

        </div>
    )
}

export default InterventionsTrackingView
