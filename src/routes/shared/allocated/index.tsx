import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Segmented,
    Select,
    Skeleton,
    Table,
    Tag,
    Space,
    Typography,
    Empty,
    Row,
    Col,
    Input,
    Button,
    Modal,
    Form,
    Upload,
    message,
    Alert,
    Card,
    Grid,
    List,
    Descriptions,
    Progress,
    DatePicker,
    Dropdown,
    Collapse,
    Tooltip,
    Carousel,
    Image,
    Slider,
    Pagination,
    Popconfirm
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    CalendarOutlined,
    TeamOutlined,
    FileProtectOutlined,
    WarningOutlined,
    EditOutlined,
    EyeOutlined,
    UploadOutlined,
    FileOutlined,
    FilePdfOutlined,
    FileWordOutlined,
    FileExcelOutlined,
    FilePptOutlined,
    FileImageOutlined,
    FileTextOutlined,
    AppstoreOutlined,
    InfoCircleOutlined,
    BellOutlined,
    CloseOutlined,
    DeleteOutlined,
    MoreOutlined,
    EnvironmentOutlined,
    VideoCameraOutlined,
    PlusOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    query,
    where,
    Timestamp,
    limit,
    doc,
    getDoc,
    updateDoc,
    arrayUnion,
    orderBy,
    QueryConstraint,
    addDoc
} from 'firebase/firestore'
import { db, auth, storage } from '@/firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import dayjs, { Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'
import { useLocation, useNavigate } from 'react-router-dom'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import EvidenceManagerPanel from '@/components/evidence/EvidenceManagerPanel'
import { USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE } from '@/config/evidencePolicy'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import { generateAttendanceRegister } from '@/services/attendanceRegisterService'
import { workflowQueryService } from '@/services/workflowQueryService'
import { dedupeAssignedInterventionViews, toAssignedInterventionView } from '@/services/assignedInterventionService'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { completeIntervention, completionFailureEvidence, loadInterventionCompletionContext, interventionCompletionError, mergeCompletionFailureContext, COMPLETION_MAX_FILE_SIZE_BYTES, COMPLETION_SUCCESS_MESSAGE, type InterventionCompletionContext } from '@/services/interventionCompletionService'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import {
    getGroupDelivery,
    loadGroupDeliveriesForAssignee,
    progressFromGroupDelivery,
    saveGroupDelivery,
    type GroupInterventionDelivery
} from '@/services/groupInterventionDeliveryService'
import ResolveQueryModal from '@/components/modals/ResolveQueryModal'
import {
    assignmentAssignedDate,
    assignmentCompletedDate,
    normalizeAcceptanceStatus,
    normalizeAssigneeCompletionStatus,
    normalizeParticipantCompletionStatus,
    resolveAssignmentLifecycle
} from '@/services/assignmentLifecycleService'
import { useColorMode } from '@/contexts/ThemeContext'

const { Text, Title } = Typography
const { Search } = Input
const { RangePicker } = DatePicker
const POE_PAGE_SIZE = 4

type Resource = {
    type?: string
    label?: string
    link: string
    originalName?: string
    notes?: string | null
}

type QueryDoc = {
    id: string
    consolidatedMovId?: string
    queryType?: string
    queryMessage?: string
    status?: 'open' | 'resolved' | string
    createdAt?: Timestamp | Date | string | null
    updatedAt?: Timestamp | Date | string | null
    resolutionNotes?: string
    uploadedFileUrl?: string | null
    raisedByUser?: string | null
    raisedByDept?: string | null
    raisedByRole?: string | null
    raisedByName?: string | null
    raisedByEmail?: string | null
    targetType?: 'pack' | 'poe' | string
    movRowId?: string | null
    participantId?: string | null
    interventionId?: string | null
    poeUrl?: string | null
    departmentName?: string | null
    resolvedByEmail?: string | null
    resolvedByName?: string | null
    resolvedByRole?: string | null
}

type EvidenceEntry = {
    label: string
    value: string
    source: 'resource' | 'field'
    index?: number
    key?: string
    originalName?: string
    removable?: boolean
}

type UploadedDoc = {
    id?: string
    label?: string
    link?: string
    type?: string
}

interface AssignedIntervention {
    id: string
    programId?: string

    participantId?: string
    participantName?: string
    beneficiaryName?: string

    interventionId?: string
    interventionTitle?: string

    subInterventionTitle?: string
    subInterventionName?: string
    subIntervention?: string
    subInterventionId?: string

    assignmentStatus?: string

    hub?: string
    province?: string
    sector?: string

    participantAcceptanceStatus?: string
    participantCompletionStatus?: string
    assigneeAcceptanceStatus?: string
    assigneeCompletionStatus?: string

    assigneeId?: string
    assigneeName?: string
    assigneeEmail?: string
    assigneeRole?: string

    beneficiarySignatureUrl?: string | null
    smeSignatureUrl?: string | null
    smmeSignatureUrl?: string | null
    participantSignatureUrl?: string | null
    signerSignatureUrl?: string | null
    signatureUrl?: string | null
    feedback?: any
    completionFeedback?: any

    computedProgress?: number
    plannedSessions?: number
    cycleKey?: string | null

    dueDate?: Timestamp | Date | string | null
    startDate?: Timestamp | Date | string | null
    endDate?: Timestamp | Date | string | null
    createdAt?: Timestamp | Date | string | null
    updatedAt?: Timestamp | Date | string | null

    resources?: Resource[]

    queries?: QueryDoc[]
    queryCount?: number
    openQueryCount?: number

    groupAssignmentId?: string
    groupId?: string
    groupKey?: string

    departmentId?: string
    areaOfSupport?: string

    targetMetric?: string
    targetType?: string
    type?: string
    interventionType?: string
    target?: {
        mode?: string
        requiredDocs?: UploadedDoc[]
    }
    tracking?: {
        documentsUploaded?: UploadedDoc[]
        sessionsLogged?: number
        milestonesDone?: any[]
        timeSpentHours?: number
    }
    progressUpdates?: Array<{
        note?: string
        by?: string
        createdAt?: Timestamp | Date | string | null
        resources?: Array<UploadedDoc & { originalName?: string; link?: string }>
        computedProgress?: number
        progressAdded?: number
    }>
}

type Acceptance = 'pending' | 'accepted' | 'declined'
type Completion = 'pending' | 'done' | 'confirmed' | 'rejected'

type DisplayIntervention = AssignedIntervention & {
    isGroupedDisplay?: boolean
    groupKeyResolved?: string | null
    memberIds?: string[]
    memberCount?: number
    members?: AssignedIntervention[]
    assignedAtResolved?: Timestamp | Date | string | null
    completedAtResolved?: Timestamp | Date | string | null
    progressResolved?: number
    groupDelivery?: GroupInterventionDelivery
    lifecycleBucket?: 'active' | 'completed'
}

type RegisterSmeSignature = {
    participantId: string
    participantName: string
    signatureUrl: string | null
}

const norm = (v: any) => String(v ?? '').trim().toLowerCase()

const clampPercent = (value: any) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return 0
    return Math.max(0, Math.min(100, Math.round(num)))
}

const toJsDate = (raw?: Timestamp | Date | string | null): Date | null => {
    if (!raw) return null
    if (raw instanceof Timestamp) return raw.toDate()
    if (raw instanceof Date) return raw
    if (typeof (raw as any)?.toDate === 'function') return (raw as any).toDate()
    if (typeof (raw as any)?.seconds === 'number') {
        return new Date(Number((raw as any).seconds) * 1000 + Math.floor(Number((raw as any).nanoseconds || 0) / 1e6))
    }
    const parsed = dayjs(raw)
    if (!parsed.isValid()) return null
    return parsed.toDate()
}

const formatDate = (value?: Timestamp | Date | string | null): string => {
    const date = toJsDate(value)
    return date ? dayjs(date).format('DD MMM YYYY') : '-'
}

const formatDateTime = (value?: Timestamp | Date | string | null): string => {
    const date = toJsDate(value)
    return date ? dayjs(date).format('DD MMM YYYY HH:mm') : '-'
}

const getProgressFileIcon = (
    name: string,
    type?: string
): React.ReactNode => {
    const mime = String(type || '').toLowerCase()
    const extension = String(name || '')
        .split('.')
        .pop()
        ?.toLowerCase()

    if (
        mime.startsWith('image/') ||
        ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')
    ) {
        return <FileImageOutlined />
    }

    if (
        mime === 'application/pdf' ||
        extension === 'pdf'
    ) {
        return <FilePdfOutlined />
    }

    if (
        mime.includes('word') ||
        mime.includes('document') ||
        ['doc', 'docx'].includes(extension || '')
    ) {
        return <FileWordOutlined />
    }

    if (
        mime.includes('spreadsheet') ||
        mime.includes('excel') ||
        ['xls', 'xlsx', 'csv'].includes(extension || '')
    ) {
        return <FileExcelOutlined />
    }

    if (
        mime.includes('presentation') ||
        mime.includes('powerpoint') ||
        ['ppt', 'pptx'].includes(extension || '')
    ) {
        return <FilePptOutlined />
    }

    if (
        mime.startsWith('text/') ||
        ['txt', 'md'].includes(extension || '')
    ) {
        return <FileTextOutlined />
    }

    return <FileOutlined />
}

type CompletionEvidenceCandidate = {
    link: string
    name: string
    type?: string
    isImage: boolean
}

const isImageEvidence = (name?: string, type?: string) => {
    const mime = String(type || '').toLowerCase()
    const extension = String(name || '').split('.').pop()?.toLowerCase()
    return mime.startsWith('image/') ||
        ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')
}

const getCompletionProgressEvidence = (
    record: DisplayIntervention | null
): CompletionEvidenceCandidate[] => {
    if (!record) return []

    const updates: any[] = record.isGroupedDisplay
        ? record.groupDelivery?.progressUpdates || []
        : record.progressUpdates || []

    const byLink = new Map<string, CompletionEvidenceCandidate>()

    updates.forEach(update => {
        ; (Array.isArray(update?.resources) ? update.resources : []).forEach((resource: any) => {
            const link = String(resource?.link || '').trim()
            if (!link || byLink.has(link)) return

            const name = String(
                resource?.originalName ||
                resource?.label ||
                link.split('?')[0].split('/').pop() ||
                'Evidence file'
            )
            const type = String(resource?.type || '')

            byLink.set(link, {
                link,
                name,
                type,
                isImage: isImageEvidence(name, type)
            })
        })
    })

    return Array.from(byLink.values())
}

const getProgressPercent = (r: AssignedIntervention) => {
    // Completion is an explicit delivery decision. It must not be replaced by
    // an incomplete attendance import from an older appointment workflow.
    if (
        String((r as any).assignmentStatus || '').toLowerCase() === 'completed' ||
        String((r as any).assigneeCompletionStatus || '').toLowerCase() === 'completed' ||
        String((r as any).participantCompletionStatus || '').toLowerCase() === 'confirmed'
    ) return 100
    const computed = Number((r as any).computedProgress)
    const plannedSessions = Math.max(1, Number(r.plannedSessions) || 1)
    const sessionProgress =
        (Number(r.tracking?.sessionsLogged || 0) / plannedSessions) * 100
    const historyProgress = Math.max(
        0,
        ...(r.progressUpdates || []).map(update =>
            Number(update.computedProgress || 0)
        )
    )

    const resolvedProgress = clampPercent(
        Math.max(
            Number.isFinite(computed) ? computed : 0,
            sessionProgress,
            historyProgress
        )
    )

    // Meeting attendance can reach the planned session count before the
    // facilitator is ready to submit final POE/MOV evidence. Do not display a
    // deferred completion as a finished 100% intervention.
    return ['pending', 'deferred'].includes(String((r as any).completionStatus || ''))
        ? Math.min(resolvedProgress, 99)
        : resolvedProgress
}

// A grouped intervention is one delivery, represented by one assignment per
// SME. Progress therefore has a single source of truth - the shared
// groupInterventionDeliveries document - and is never read from or written to
// the individual member assignments. This fallback exists only for legacy
// groups that predate the shared document; the first progress update writes
// the shared document and it becomes the sole source from then on.
const legacyGroupProgressFallback = (members: AssignedIntervention[]) =>
    clampPercent(Math.max(0, ...members.map(getProgressPercent)))

// The one delivery value for a grouped row. Every grouped surface - the status
// tag, the progress bar, the member list and the completion gate - must read
// this and nothing else, so a group can never show 20% / 50% / completed for
// members of the same single delivery.
const getGroupProgress = (record: DisplayIntervention) =>
    clampPercent(
        record.progressResolved ??
        (record.groupDelivery
            ? progressFromGroupDelivery(record.groupDelivery)
            : legacyGroupProgressFallback(record.members || []))
    )

// Progress for either shape of row, from whichever single source owns it.
const getDeliveryProgress = (record: DisplayIntervention) =>
    record.isGroupedDisplay
        ? getGroupProgress(record)
        : clampPercent(record.progressResolved ?? getProgressPercent(record))

// Delivery ends at 100%: the facilitator has submitted completion and the MOVs
// exist. No further appointment can be booked from that point, so "Awaiting SME
// confirmation" is already closed to new sessions even though the row is still
// in the active bucket waiting on confirmations.
const isClosedToNewSessions = (record: DisplayIntervention) =>
    record.lifecycleBucket === 'completed' || getDeliveryProgress(record) >= 100

// Attendance is the only genuinely per-member fact in a grouped delivery. The
// group is delivered as one intervention, but a member who attended none of
// the appointments did not receive it and cannot be issued a MOV. One attended
// appointment out of n is enough to have received it.
const getAttendedSessions = (r: AssignedIntervention) =>
    Math.max(0, Number(r.tracking?.sessionsLogged || 0))

const hasReceivedIntervention = (r: AssignedIntervention) =>
    !isClosedWithoutAttendance(r) && getAttendedSessions(r) > 0

const getAssignedAt = (r: AssignedIntervention) => {
    return r.createdAt || r.startDate || null
}

// Rows are listed newest allocation first. Grouped rows resolve to the
// earliest assignment in the group, which is the date the group was allocated.
const getAssignedTime = (record: DisplayIntervention) =>
    toJsDate(record.assignedAtResolved ?? getAssignedAt(record))?.getTime() || 0

const getPlannedSessions = (r: AssignedIntervention) =>
    Math.max(1, Number(r.plannedSessions) || 1)

// Members of one group can disagree on plannedSessions (live data has groups
// split 28x3 / 2x2 / 1x4). The group is one delivery, so take the value most
// members carry rather than whichever member happens to lead the rollup.
const getGroupPlannedSessions = (record: DisplayIntervention) => {
    const members = record.members || []
    if (!record.isGroupedDisplay || !members.length) return getPlannedSessions(record)

    const tally = new Map<number, number>()
    members.forEach(member => {
        const planned = getPlannedSessions(member)
        tally.set(planned, (tally.get(planned) || 0) + 1)
    })
    return Array.from(tally.entries()).sort(
        (left, right) => right[1] - left[1] || right[0] - left[0]
    )[0][0]
}

// More sessions can legitimately be held than were planned, so never render
// the nonsense "attended 4 of 3" - state the plan separately once it is passed.
const formatAttendance = (attended: number, planned: number) =>
    attended > planned
        ? `attended ${attended} (${planned} planned)`
        : `attended ${attended} of ${planned}`

const normalizeCompletionDeliveryMethod = (raw: unknown) => {
    const value = String(raw || '').trim().toLowerCase().replace(/_/g, '-')
    if (['in-person', 'in person', 'onsite', 'on-site'].includes(value)) {
        return { value: 'in-person', label: 'In-person / On-site', other: '' }
    }
    if (['virtual', 'online', 'online / virtual'].includes(value)) {
        return { value: 'online', label: 'Online / Virtual', other: '' }
    }
    if (value === 'hybrid') {
        return { value: 'hybrid', label: 'Hybrid', other: '' }
    }
    if (['telephonic', 'telephonically', 'phone'].includes(value)) {
        return { value: 'other', label: 'Telephonic', other: 'Telephonic' }
    }
    if (value) {
        return { value: 'other', label: String(raw), other: String(raw) }
    }
    return { value: '', label: '', other: '' }
}

const getSmeAcceptance = (r: AssignedIntervention): Acceptance => {
    return normalizeAcceptanceStatus(r.participantAcceptanceStatus)
}

const getFacilitatorAcceptance = (r: AssignedIntervention): Acceptance => {
    return normalizeAcceptanceStatus(r.assigneeAcceptanceStatus) === 'declined' ? 'declined' : 'accepted'
}

const getFacilitatorCompletion = (r: AssignedIntervention): Completion => {
    return normalizeAssigneeCompletionStatus(r.assigneeCompletionStatus) === 'completed' ? 'done' : 'pending'
}

const getSmeCompletion = (r: AssignedIntervention): Completion => {
    const status = normalizeParticipantCompletionStatus(r.participantCompletionStatus)
    return status === 'confirmed' ? 'confirmed' : status
}

const getGroupMemberIdsForEvidence = async (record: DisplayIntervention) => {
    if (!record.isGroupedDisplay) return [record.id]

    if (record.memberIds?.length) return record.memberIds

    const groupKey =
        record.groupKeyResolved ||
        record.groupId ||
        record.groupKey ||
        record.groupAssignmentId

    if (!groupKey) return []

    const fields = ['groupId', 'groupKey', 'groupAssignmentId']

    const snaps = await Promise.all(
        fields.map(field =>
            getDocs(
                query(
                    collection(db, 'assignedInterventions'),
                    where(field, '==', groupKey)
                )
            )
        )
    )

    return Array.from(
        new Set(
            snaps.flatMap(snap => snap.docs.map(d => d.id))
        )
    )
}

const isFullyCompleted = (r: AssignedIntervention) => {
    return resolveAssignmentLifecycle(r).isCompleted
}

const isCompletedLegacy = (a: any): boolean => {
    const status = norm(a.assignmentStatus)

    return (
        status === 'completed' ||
        norm(a.participantCompletionStatus) === 'confirmed'
    )
}

const isClosedWithoutAttendance = (record: any): boolean =>
    norm(record?.status) === 'not-attended' ||
    ['not-attended', 'not_attended'].includes(norm(record?.completionStatus)) ||
    ['no-sessions-attended', 'no_sessions_attended'].includes(norm(record?.completionOutcome))

const isOpenQuery = (status?: string) =>
    String(status || '').trim().toLowerCase() === 'open'

const isOverdueRecord = (record: AssignedIntervention): boolean => {
    if (isFullyCompleted(record) || isCompletedLegacy(record) || isClosedWithoutAttendance(record)) return false
    const due = toJsDate(record.dueDate)
    if (!due) return false
    return dayjs(due).isBefore(dayjs(), 'day')
}

const isDocumentTarget = (item: AssignedIntervention) =>
    String(item.target?.mode || '').trim().toLowerCase() === 'documents'

const getDocumentEvidence = (item: AssignedIntervention): EvidenceDoc[] => {
    const resourceDocs = (item.resources || []).filter(d => d?.link)

    const seen = new Set<string>()
    return resourceDocs.filter(doc => {
        const key = String(doc.link || '').trim()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
    })
}

const isGenericPoeLabel = (value?: string) =>
    /^POE\s+\d+$/i.test(String(value || '').trim())

const normalizePoeResources = (resources: Resource[]): Resource[] => {
    const byLink = new Map<string, Resource>()

    resources.forEach(resource => {
        const link = String(resource?.link || '').trim()
        if (!link || !link.startsWith('http')) return

        const previous = byLink.get(link)
        const candidateOriginalName =
            resource.originalName ||
            (!isGenericPoeLabel(resource.label) ? resource.label : undefined)

        const originalName = previous?.originalName || candidateOriginalName
        const notes = resource.notes ?? previous?.notes
        byLink.set(link, {
            type: 'poe',
            link,
            ...(originalName ? { originalName } : {}),
            ...(notes != null ? { notes } : {})
        })
    })

    return Array.from(byLink.values()).map((resource, index) => ({
        ...resource,
        type: 'poe',
        label: `POE ${index + 1}`
    }))
}

const getPoeResourcesFromRecord = (
    record: AssignedIntervention | null
): Resource[] => {
    if (!record || isDocumentTarget(record)) return []

    const resources: Resource[] = Array.isArray(record.resources)
        ? record.resources
            .filter(resource => resource && typeof resource.link === 'string')
            .map(resource => ({
                type: resource.type || 'poe',
                label: resource.label,
                originalName: resource.originalName,
                notes: resource.notes,
                link: resource.link
            }))
        : []

    return normalizePoeResources(resources)
}

const hasEvidence = (item: AssignedIntervention): boolean => {
    if (isDocumentTarget(item)) {
        return getDocumentEvidence(item).length > 0
    }

    return getPoeResourcesFromRecord(item).length > 0
}

const getGroupKey = (r: any): string | null => {
    const key = r?.groupAssignmentId || r?.groupId || r?.groupKey || null
    const clean = String(key || '').trim()
    return clean || null
}

const completionRank = (r: AssignedIntervention) => {
    if (isFullyCompleted(r) || isCompletedLegacy(r) || isClosedWithoutAttendance(r)) return 4

    const facDone = getFacilitatorCompletion(r)
    const smeDone = getSmeCompletion(r)
    const lifecycle = resolveAssignmentLifecycle(r)

    if (facDone === 'done' && (smeDone === 'pending' || smeDone === 'rejected')) return 3
    if (lifecycle.key === 'in-delivery') return 2
    if (lifecycle.key === 'awaiting-participant-acceptance') return 1
    return 0
}

const pickMostAdvanced = (rows: AssignedIntervention[]) => {
    return [...rows].sort((a, b) => {
        const diff = completionRank(b) - completionRank(a)
        if (diff !== 0) return diff

        const bd = toJsDate((b as any).updatedAt || b.createdAt)?.getTime?.() || 0
        const ad = toJsDate((a as any).updatedAt || a.createdAt)?.getTime?.() || 0
        return bd - ad
    })[0]
}

const needsReminderSingle = (r: AssignedIntervention) => {
    return !isClosedWithoutAttendance(r) &&
        resolveAssignmentLifecycle(r).key === 'awaiting-participant-confirmation'
}

const getReminderReason = (r: AssignedIntervention): 'confirmation' | null => {
    return needsReminderSingle(r) ? 'confirmation' : null
}

const canSendReminderRecord = (record: DisplayIntervention) => {
    if (!record.isGroupedDisplay) return needsReminderSingle(record)
    return (record.members || []).some(member => needsReminderSingle(member))
}

const getReminderTargets = (record: DisplayIntervention) => {
    if (!record.isGroupedDisplay) {
        return needsReminderSingle(record) ? [record] : []
    }
    return (record.members || []).filter(member => needsReminderSingle(member))
}

const statusTag = (r: AssignedIntervention) => {
    if (isClosedWithoutAttendance(r)) return <Tag color="red">NO SESSIONS ATTENDED</Tag>
    const lifecycle = resolveAssignmentLifecycle(r)
    if (lifecycle.key === 'awaiting-participant-acceptance') {
        return <Tag color={lifecycle.color}>Awaiting Appointment Response</Tag>
    }
    if (lifecycle.key === 'awaiting-participant-confirmation') {
        // Same state the grouped tag and the metric call "Awaiting SME
        // Confirmation". One name for one state.
        return <Tag color={lifecycle.color}>Awaiting SME Confirmation</Tag>
    }
    if (lifecycle.key === 'participant-rejected') {
        return <Tag color={lifecycle.color}>Completion Rejected</Tag>
    }
    return <Tag color={lifecycle.color}>{lifecycle.label}</Tag>
}

const getCompletionRejectionReason = (record: AssignedIntervention) =>
    String(
        (record as any).participantCompletionRejectionReason ||
        (record as any).completionRejectionReason ||
        (record as any).rejectionReason ||
        ''
    ).trim()

const getCompletionFeedback = (record: AssignedIntervention) => {
    const feedback = (record as any).feedback || (record as any).completionFeedback || {}
    return {
        rating: Number(feedback?.rating || 0),
        comments: String(feedback?.comments || '').trim()
    }
}

const renderCompletionConfirmation = (record: AssignedIntervention) => {
    const status = getSmeCompletion(record)
    const isConfirmed = status === 'confirmed' || status === 'done'
    const isRejected = status === 'rejected'
    const rejectionReason = getCompletionRejectionReason(record)
    const feedback = getCompletionFeedback(record)

    return (
        <Space direction="vertical" size={4}>
            <Tag color={isConfirmed ? 'green' : isRejected ? 'red' : 'gold'}>
                {isConfirmed ? 'Confirmed' : isRejected ? 'Rejected' : 'Pending'}
            </Tag>
            {isRejected ? (
                <Text type="danger">
                    Reason: {rejectionReason || 'No reason provided'}
                </Text>
            ) : null}
            {isConfirmed ? (
                <Text type="secondary">
                    Feedback: {feedback.rating > 0 || feedback.comments
                        ? `${feedback.rating > 0 ? `${feedback.rating}/5` : ''}${feedback.rating > 0 && feedback.comments ? ' - ' : ''}${feedback.comments}`
                        : 'No feedback provided'}
                </Text>
            ) : null}
        </Space>
    )
}

// The single answer to "what state is this row in".
//
// The status tag, the metric counts and the quick filter must all come from
// here. They used to compute it three different ways - the tag from the group's
// shared delivery, the metric from the rolled-up row's own lifecycle, the
// filter from `.some()` over the members - so a card could read 7 while its
// filter produced a different set of rows.
type DisplayStatus =
    | 'no-attendance'
    | 'completed'
    | 'awaiting-confirmation'
    | 'declined'
    | 'awaiting-response'
    | 'in-delivery'
    | 'active'

const resolveDisplayStatus = (record: DisplayIntervention): DisplayStatus => {
    if (!record.isGroupedDisplay) {
        if (isClosedWithoutAttendance(record)) return 'no-attendance'
        const lifecycle = resolveAssignmentLifecycle(record)
        if (lifecycle.isCompleted) return 'completed'
        if (lifecycle.key === 'awaiting-participant-acceptance') return 'awaiting-response'
        if (lifecycle.key === 'awaiting-participant-confirmation') return 'awaiting-confirmation'
        if (lifecycle.key === 'in-delivery') return 'in-delivery'
        return 'active'
    }

    const members = record.members || []
    if (!members.length) return 'active'

    // Delivery is one shared value. Never derive it from the members, or a
    // single confirmed SME drags the whole group to "done".
    const groupProgress = getGroupProgress(record)

    if (groupProgress >= 100) {
        // The delivery is finished. What differs per member from here is
        // attendance: nobody who attended nothing received the intervention.
        const received = members.filter(hasReceivedIntervention)
        if (!received.length) return 'no-attendance'

        const confirmed = received.filter(member => {
            const completion = getSmeCompletion(member)
            return completion === 'confirmed' || completion === 'done'
        }).length
        return confirmed >= received.length ? 'completed' : 'awaiting-confirmation'
    }

    if (members.every(m => getFacilitatorAcceptance(m) === 'declined')) return 'declined'
    if (members.some(m => resolveAssignmentLifecycle(m).key === 'awaiting-participant-acceptance')) {
        return 'awaiting-response'
    }
    return groupProgress > 0 ? 'in-delivery' : 'active'
}

const groupedStatusTag = (record: DisplayIntervention) => {
    if (!record.isGroupedDisplay) return statusTag(record)

    switch (resolveDisplayStatus(record)) {
        case 'no-attendance': return <Tag color="red">No Attendance</Tag>
        case 'completed': return <Tag color="green">Completed</Tag>
        case 'awaiting-confirmation': return <Tag color="purple">Awaiting SME Confirmation</Tag>
        case 'declined': return <Tag color="red">Group Declined</Tag>
        case 'awaiting-response': return <Tag color="gold">Waiting on Appointment Responses</Tag>
        case 'in-delivery': return <Tag color="geekblue">In Delivery</Tag>
        default: return <Tag color="blue">Grouped Active</Tag>
    }
}

const waitingOnTag = (r: AssignedIntervention) => {
    if (isClosedWithoutAttendance(r)) return <Text type="secondary">Closed - no attendance</Text>
    const lifecycle = resolveAssignmentLifecycle(r)
    if (lifecycle.key === 'awaiting-participant-acceptance') {
        return <Tag color={lifecycle.color}>Appointment Response</Tag>
    }
    if (lifecycle.key === 'awaiting-participant-confirmation') {
        // This tag answers "waiting on whom", so it names the SME.
        return <Tag color={lifecycle.color}>SME Confirmation</Tag>
    }
    if (lifecycle.key === 'participant-rejected') {
        return <Tag color={lifecycle.color}>Facilitator Follow-up</Tag>
    }
    return lifecycle.waitingOn === 'none'
        ? <Text type="secondary">-</Text>
        : <Tag color={lifecycle.color}>{lifecycle.label}</Tag>
}

const getSubInterventionLabel = (r: AssignedIntervention): string | null => {
    const anyR = r as any
    const label =
        r.subInterventionTitle ||
        r.subInterventionName ||
        r.subIntervention ||
        anyR.subInterventionTitle ||
        anyR.subInterventionName ||
        anyR.subIntervention ||
        null

    const clean = String(label || '').trim()
    return clean ? clean : null
}

const getEvidenceEntriesFromRecord = (record: AssignedIntervention | null): EvidenceEntry[] => {
    if (!record) return []

    if (isDocumentTarget(record)) {
        return getDocumentEvidence(record).map((doc, idx) => ({
            label: doc.label || `Delivered Document ${idx + 1}`,
            value: doc.link,
            source: 'resource',
            index: idx,
            originalName: doc.label,
            removable: true
        }))
    }

    return getPoeResourcesFromRecord(record).map((resource, index) => ({
        label: `POE ${index + 1}`,
        value: resource.link,
        source: 'resource',
        index,
        originalName: resource.originalName,
        removable: true
    }))
}

const fetchQueriesForIntervention = async (record: AssignedIntervention): Promise<QueryDoc[]> => {
    try {
        const interventionId = record.interventionId || record.id
        if (!interventionId) return []

        let rows = await workflowQueryService.list({ interventionId }) as QueryDoc[]

        if (record.participantId) {
            rows = rows.filter(q => !q.participantId || q.participantId === record.participantId)
        }

        return rows
    } catch (err) {
        console.error('Failed to fetch intervention queries:', err)
        return []
    }
}

const buildUserScopedAssignedQueries = ({
    assignedCol,
    activeProgramId,
    uid,
    email,
    coordinatorDocId
}: {
    assignedCol: ReturnType<typeof collection>
    activeProgramId: string | undefined
    uid: string
    email: string
    coordinatorDocId: string | null
}) => {
    const querySets: QueryConstraint[][] = []

    const pushSet = (constraints: QueryConstraint[]) => {
        querySets.push(constraints)
    }

    const withProgram = (constraints: QueryConstraint[]) => {
        if (!activeProgramId) return constraints
        return [...constraints, where('programId', '==', activeProgramId)]
    }

    pushSet(withProgram([where('assigneeId', '==', uid)]))

    if (email) {
        pushSet(withProgram([where('assigneeEmail', '==', email)]))
    }

    if (coordinatorDocId) {
        pushSet(withProgram([where('assigneeId', '==', coordinatorDocId)]))
    }

    return querySets.map(constraints => query(assignedCol, ...constraints))
}

const rollupGroupedRows = (
    rows: AssignedIntervention[],
    lifecycleBucket: 'active' | 'completed',
    groupDeliveries: Record<string, GroupInterventionDelivery> = {}
): DisplayIntervention[] => {
    const grouped = new Map<string, AssignedIntervention[]>()
    const singles: DisplayIntervention[] = []

    rows.forEach(row => {
        const rowLifecycle: 'active' | 'completed' =
            resolveAssignmentLifecycle(row).isCompleted || isClosedWithoutAttendance(row)
                ? 'completed'
                : 'active'
        const gk = getGroupKey(row)
        if (!gk) {
            singles.push({
                ...row,
                lifecycleBucket: rowLifecycle,
                progressResolved: getProgressPercent(row),
                assignedAtResolved: getAssignedAt(row),
                completedAtResolved: assignmentCompletedDate(row)
            })
            return
        }

        if (!grouped.has(gk)) grouped.set(gk, [])
        grouped.get(gk)!.push(row)
    })

    const rolled: DisplayIntervention[] = Array.from(grouped.entries()).map(([groupKey, members]) => {
        const base = pickMostAdvanced(members)
        const sharedDelivery = groupDeliveries[groupKey]
        const groupLifecycle: 'active' | 'completed' = members.some(member =>
            !(resolveAssignmentLifecycle(member).isCompleted || isClosedWithoutAttendance(member))
        ) ? 'active' : 'completed'

        const dueDates = members
            .map(m => toJsDate(m.dueDate)?.getTime?.() || 0)
            .filter(Boolean)

        const latestDue =
            dueDates.length > 0 ? new Date(Math.max(...dueDates)) : null

        const assignedDates = members
            .map(m => toJsDate(getAssignedAt(m))?.getTime?.() || 0)
            .filter(Boolean)

        const earliestAssigned =
            assignedDates.length > 0 ? new Date(Math.min(...assignedDates)) : null

        const completedDates = members
            .map(m => assignmentCompletedDate(m)?.getTime() || 0)
            .filter(Boolean)
        const latestCompleted =
            completedDates.length > 0 ? new Date(Math.max(...completedDates)) : null

        const allResources = members.flatMap(m => m.resources || [])
        const allQueries = members.flatMap(m => m.queries || [])

        const uniqueParticipantNames = Array.from(
            new Set(
                members
                    .map(m =>
                        String(
                            m.participantName ||
                            m.beneficiaryName ||
                            m.participantId ||
                            ''
                        ).trim()
                    )
                    .filter(Boolean)
            )
        )

        const openQueryCount = allQueries.filter(q => isOpenQuery(q.status)).length
        const groupProgress = sharedDelivery
            ? progressFromGroupDelivery(sharedDelivery)
            : legacyGroupProgressFallback(members)

        return {
            ...base,
            id: `group:${groupKey}:${groupLifecycle}`,
            isGroupedDisplay: true,
            lifecycleBucket: groupLifecycle,
            groupKeyResolved: groupKey,
            memberIds: members.map(m => m.id),
            memberCount: members.length,
            members,
            participantName:
                uniqueParticipantNames.length <= 3
                    ? uniqueParticipantNames.join(', ')
                    : `${uniqueParticipantNames.slice(0, 3).join(', ')} +${uniqueParticipantNames.length - 3} more`,
            beneficiaryName:
                uniqueParticipantNames.length === 1 ? uniqueParticipantNames[0] : `${members.length} SMEs`,
            dueDate: latestDue || base.dueDate || null,
            // Once a shared delivery exists, its evidence list is canonical,
            // including an intentionally empty list after the last POE is
            // removed. Falling back on `allResources` here resurrected deleted
            // POEs whenever the shared list became empty.
            resources: sharedDelivery
                ? (Array.isArray(sharedDelivery.evidence) ? sharedDelivery.evidence : [])
                : allResources,
            queries: allQueries,
            queryCount: allQueries.length,
            openQueryCount,
            progressResolved: groupProgress,
            groupDelivery: sharedDelivery,
            assignedAtResolved: earliestAssigned || getAssignedAt(base),
            completedAtResolved: latestCompleted || assignmentCompletedDate(base)
        }
    })

    return [...rolled, ...singles]
}

/**
 * Types a prompt out once, the first time it is shown.
 *
 * Re-typing on every render would punish anyone logging their fifth update, so
 * the animation is keyed on `play` and the text is only ever animated when that
 * key changes. Anyone who has asked for reduced motion gets the text at once.
 */
const TypedText: React.FC<{ text: string; play?: unknown; speed?: number }> = ({
    text,
    play,
    speed = 16
}) => {
    const [shown, setShown] = useState(text)

    useEffect(() => {
        const reduceMotion =
            typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        if (reduceMotion) {
            setShown(text)
            return
        }

        setShown('')
        let index = 0
        const timer = window.setInterval(() => {
            index += 1
            setShown(text.slice(0, index))
            if (index >= text.length) window.clearInterval(timer)
        }, speed)
        return () => window.clearInterval(timer)
        // `text` is deliberately absent: a prompt whose wording depends on the
        // slider would otherwise retype on every drag.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [play, speed])

    return <>{shown}</>
}

const CoordinatorAllocatedInterventions: React.FC = () => {
    const { isDark } = useColorMode();
    const { activeProgramId } = useActiveProgramId()
    const { user: effectiveUser, loading: identityLoading } = useFullIdentity()
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const location = useLocation()
    const navigate = useNavigate()

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'allocated-interventions',
            pageTitle: 'Allocated Interventions',
            guides: [
                {
                    id: 'allocated-interventions-overview',
                    title: 'Quick tour',
                    description:
                        'Understand your intervention workload, workflow filters and the actions available on each allocation.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('allocated-metrics'),
                            popover: {
                                title: 'Workload overview',
                                description:
                                    'These metrics summarise the interventions allocated to you in the selected programme, including delivery, completion confirmation, completed work and open queries.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('allocated-status'),
                            popover: {
                                title: 'Quick workflow view',
                                description:
                                    'Switch between all allocations, interventions currently in delivery, items awaiting SME completion confirmation and completed work.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="open-queries-metric"]',
                            popover: {
                                title: 'Open queries',
                                description:
                                    'Select this metric to open one list of every unresolved query in your allocated interventions.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('allocated-filters'),
                            popover: {
                                title: 'Find an intervention',
                                description:
                                    'Search by beneficiary or intervention, narrow the activity period and filter by the current workflow state.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('allocated-table'),
                            popover: {
                                title: 'Allocated interventions',
                                description:
                                    'Review beneficiaries, intervention progress, due dates, queries, evidence and the actions available for each allocation.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'update-intervention-progress',
                    title: 'Update intervention progress',
                    description:
                        'Record delivery progress and understand what happens when an intervention reaches 100%.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: '[data-guide="add-progress-action"]',
                            advanceOnClick: true,
                            popover: {
                                title: 'Add progress',
                                description:
                                    'Choose Add Progress on an active intervention to record the latest delivery progress.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-progress-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Progress update',
                                description:
                                    'Record the new overall progress value and explain what changed since the previous update.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('progress-value'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Overall progress',
                                description:
                                    'Choose the new total intervention progress, not the percentage added during this update.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('progress-note'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Describe the progress',
                                description:
                                    'Explain what moved forward, what is still outstanding and what happens next.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('progress-files'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Supporting files',
                                description:
                                    'You can optionally attach screenshots, photos or documents to the progress history.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-progress-submit',
                            waitForElement: 5000,
                            popover: {
                                title: 'Save the update',
                                description:
                                    'Save the progress update. When progress reaches 100%, the workflow moves to final evidence and completion.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'manage-intervention-evidence',
                    title: 'Manage evidence',
                    description:
                        'Add, replace, review or remove POEs and other intervention evidence.',
                    kind: 'task',
                    order: 3,
                    steps: [
                        {
                            element: '[data-guide="manage-evidence-action"]',
                            advanceOnClick: true,
                            popover: {
                                title: 'Open evidence management',
                                description:
                                    'Select the evidence action for the intervention you want to update.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-manage-evidence-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Evidence workspace',
                                description:
                                    'Existing POEs and their direct actions are managed from this modal. Modal-level actions remain in the footer.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('evidence-manager-content'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Evidence and POEs',
                                description:
                                    'Review what is currently on file. Each card lets you view, replace or remove that specific POE.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="add-poe-action"]',
                            waitForElement: 5000,
                            popover: {
                                title: 'Add or replace all',
                                description:
                                    'Choose Add POE, then select Add new or Replace all. The native file explorer opens immediately and saves the selected files.',
                                side: 'left',
                                align: 'center'
                            }
                        },
                        {
                            element: '[data-guide="replace-evidence-action"]',
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Replace one POE',
                                description:
                                    'Use Replace on a POE card to select its replacement directly from the native file explorer.',
                                side: 'left',
                                align: 'center'
                            }
                        },
                        {
                            element: '[data-guide="group-poe-mode"]',
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Grouped intervention evidence',
                                description:
                                    'For grouped interventions you can upload evidence for the whole group or switch to a single SME when the POE belongs to one beneficiary only.',
                                side: 'right',
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

    const [loading, setLoading] = useState(true)
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
    const [reloadKey, setReloadKey] = useState(0)

    const [generatingRegisterId, setGeneratingRegisterId] = useState<string | null>(null)

    const [allInterventions, setAllInterventions] = useState<AssignedIntervention[]>([])
    const [groupDeliveries, setGroupDeliveries] = useState<Record<string, GroupInterventionDelivery>>({})
    const [activeInterventions, setActiveInterventions] = useState<AssignedIntervention[]>([])
    const [completedInterventions, setCompletedInterventions] = useState<AssignedIntervention[]>([])

    const [remindingIds, setRemindingIds] = useState<string[]>([])
    const [bulkReminding, setBulkReminding] = useState(false)

    const [manageEvidenceOpen, setManageEvidenceOpen] = useState(false)
    const [manageEvidenceRecord, setManageEvidenceRecord] = useState<AssignedIntervention | null>(null)
    const [savingEvidence, setSavingEvidence] = useState(false)
    const [manageEvidenceForm] = Form.useForm()
    const [completionEvidenceForm] = Form.useForm()
    const [completionContext, setCompletionContext] = useState<InterventionCompletionContext | null>(null)
    const [completionFailureMessage, setCompletionFailureMessage] = useState('')
    const evidenceSubmissionRef = useRef(false)
    const completionPreparingRef = useRef(false)
    // Opening a second details modal before the first finished loading must not
    // let the older read land on top of the newer one.
    const detailsSessionsRequestRef = useRef(0)
    const [evidenceMode, setEvidenceMode] = useState<'file' | 'summary' | 'both'>('file')
    const [groupEvidenceMode, setGroupEvidenceMode] = useState<'bulk' | 'single'>('bulk')
    const [groupEvidenceMemberId, setGroupEvidenceMemberId] = useState<string | undefined>()
    const [pendingEvidenceFiles, setPendingEvidenceFiles] = useState<File[]>([])
    const manageEvidenceFileInputRef = useRef<HTMLInputElement>(null)
    const pendingEvidenceReplaceTargetRef = useRef<string | undefined>()

    const [searchText, setSearchText] = useState('')
    const [workflowFilter, setWorkflowFilter] = useState('all')
    const [quickStatus, setQuickStatus] = useState<'all' | 'in-delivery' | 'awaiting-confirmation' | 'completed'>('all')
    const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
    const [evidenceModalOpen, setEvidenceModalOpen] = useState(false)
    const [evidenceRecord, setEvidenceRecord] = useState<AssignedIntervention | null>(null)

    const [detailsModalOpen, setDetailsModalOpen] = useState(false)
    const [detailsRecord, setDetailsRecord] = useState<DisplayIntervention | null>(null)
    const [detailsTab, setDetailsTab] = useState<'overview' | 'members' | 'sessions' | 'updates'>('overview')
    const [detailsSessions, setDetailsSessions] = useState<any[]>([])
    // Each session's own invited/attended totals, keyed by session id. These
    // cover everyone on the session, not just this intervention's members.
    const [detailsSessionTotals, setDetailsSessionTotals] = useState<
        Record<string, { invited: number; attended: number }>
    >({})
    const [detailsSessionsLoading, setDetailsSessionsLoading] = useState(false)
    const [progressModalOpen, setProgressModalOpen] = useState(false)
    const [progressRecord, setProgressRecord] = useState<DisplayIntervention | null>(null)
    const [savingProgressUpdate, setSavingProgressUpdate] = useState(false)
    const [progressUpdateFiles, setProgressUpdateFiles] = useState<any[]>([])
    // Validation answers back in the thread rather than as a field error, so
    // the response appears where the person is already looking.
    const [progressChatError, setProgressChatError] = useState<string | null>(null)
    // Same idea for the evidence and MOV steps: say what is missing on the step
    // the person has just been sent to, not in a corner toast.
    const [completionStepError, setCompletionStepError] = useState<string | null>(null)
    // Bumped when the modal opens, which is the only time the prompt types.
    const [progressChatTurn, setProgressChatTurn] = useState(0)
    const [progressUpdateForm] = Form.useForm()
    const nextProgressPreview = Number(Form.useWatch('nextProgress', progressUpdateForm) || 0)

    // Object URLs for the attachment tiles, rebuilt only when the list changes
    // and revoked on the way out so the modal does not leak them.
    const progressFilePreviews = useMemo(() => {
        return progressUpdateFiles.map(file => {
            const raw = file?.originFileObj || file
            const type = String(raw?.type || '')
            const isImage = type.startsWith('image/')

            return {
                uid: String(file?.uid || raw?.name || Math.random()),
                name: String(raw?.name || 'file'),
                type,
                isImage,
                url:
                    isImage && raw instanceof Blob
                        ? URL.createObjectURL(raw)
                        : null
            }
        })
    }, [progressUpdateFiles])

    useEffect(() => {
        return () => {
            progressFilePreviews.forEach(preview => {
                if (preview.url) URL.revokeObjectURL(preview.url)
            })
        }
    }, [progressFilePreviews])
    // 0 = progress update, 1 = reuse progress evidence, 2 = POE review/upload, 3 = MOV upload.
    // The stages are intentionally not shown as Steps; the questions themselves carry the flow.
    const [progressModalStep, setProgressModalStep] = useState<0 | 1 | 2 | 3>(0)
    const [completionDeliveryMethod, setCompletionDeliveryMethod] = useState<string>('')
    const [completionDeliveryValue, setCompletionDeliveryValue] = useState<string>('')
    const [selectedProgressPoeUrls, setSelectedProgressPoeUrls] = useState<string[]>([])
    const [completionPoeFiles, setCompletionPoeFiles] = useState<any[]>([])
    // Manual MOVs are individual, even when delivery and POE are shared across a group.
    // Each eligible assignment gets exactly one selected file before completion.
    const [completionMovFilesByAssignment, setCompletionMovFilesByAssignment] = useState<Record<string, any>>({})
    const [completionChatTurn, setCompletionChatTurn] = useState(0)

    const completionCurrentPoes = useMemo<Resource[]>(() => {
        if (!progressRecord) return []
        if (progressRecord.isGroupedDisplay) {
            return normalizePoeResources(
                (progressRecord.groupDelivery?.evidence || progressRecord.resources || []) as Resource[]
            )
        }
        return getPoeResourcesFromRecord(progressRecord)
    }, [progressRecord])

    const completionProgressEvidence = useMemo(() => {
        const currentLinks = new Set(completionCurrentPoes.map(resource => resource.link))
        return getCompletionProgressEvidence(progressRecord).filter(resource => !currentLinks.has(resource.link))
    }, [completionCurrentPoes, progressRecord])

    const completionMovAssignments = useMemo<AssignedIntervention[]>(() => {
        if (!progressRecord || !completionContext) return []
        const sourceRows = progressRecord.isGroupedDisplay
            ? progressRecord.members || []
            : [progressRecord]
        const byId = new Map(sourceRows.map(row => [row.id, row]))
        const rows = completionContext.assignments
            .map(row => byId.get(row.id) || (row as AssignedIntervention))
            .filter(Boolean)

        // Group delivery is shared, but an MOV belongs to an SME. Only SMEs who
        // actually received the intervention need a manual MOV. A single
        // intervention still needs its one MOV regardless of group attendance logic.
        return progressRecord.isGroupedDisplay
            ? rows.filter(hasReceivedIntervention)
            : rows
    }, [completionContext, progressRecord])

    const completionMovExcludedAssignments = useMemo<AssignedIntervention[]>(() => {
        if (!progressRecord?.isGroupedDisplay || !completionContext) return []
        const eligible = new Set(completionMovAssignments.map(row => row.id))
        const byId = new Map((progressRecord.members || []).map(row => [row.id, row]))
        return completionContext.assignments
            .map(row => byId.get(row.id) || (row as AssignedIntervention))
            .filter(row => row && !eligible.has(row.id))
    }, [completionContext, completionMovAssignments, progressRecord])

    const completionMovUploadedCount = completionMovAssignments.filter(assignment =>
        Boolean(completionMovFilesByAssignment[assignment.id])
    ).length

    const completionPoePreviews = useMemo(() => {
        return completionPoeFiles.map(file => {
            const raw = file?.originFileObj || file
            const type = String(raw?.type || '')
            const name = String(raw?.name || 'POE')
            const image = isImageEvidence(name, type)
            return {
                uid: String(file?.uid || name),
                name,
                type,
                isImage: image,
                url: image && raw instanceof Blob ? URL.createObjectURL(raw) : null
            }
        })
    }, [completionPoeFiles])

    useEffect(() => {
        return () => {
            completionPoePreviews.forEach(preview => {
                if (preview.url) URL.revokeObjectURL(preview.url)
            })
        }
    }, [completionPoePreviews])

    const [poeUploadModalOpen, setPoeUploadModalOpen] = useState(false)
    const [selectedRecord, setSelectedRecord] = useState<AssignedIntervention | null>(null)
    const [selectedQueryForResolution, setSelectedQueryForResolution] = useState<QueryDoc | null>(null)

    const [overdueModalOpen, setOverdueModalOpen] = useState(false)
    const [overdueRecord, setOverdueRecord] = useState<DisplayIntervention | null>(null)
    const [savingOverdue, setSavingOverdue] = useState(false)
    const [overdueForm] = Form.useForm()

    const [queriesModalOpen, setQueriesModalOpen] = useState(false)
    const [queriesLoading, setQueriesLoading] = useState(false)
    const [selectedQueries, setSelectedQueries] = useState<QueryDoc[]>([])
    const [selectedQueryRecord, setSelectedQueryRecord] = useState<AssignedIntervention | null>(null)
    const [queriesModalScope, setQueriesModalScope] = useState<'record' | 'open'>('record')

    const [evidencePoePage, setEvidencePoePage] = useState(1)
    const [manageEvidencePoePage, setManageEvidencePoePage] = useState(1)
    const [deletingPoeUrl, setDeletingPoeUrl] = useState<string | null>(null)

    const evidenceEntries = useMemo(
        () => getEvidenceEntriesFromRecord(evidenceRecord),
        [evidenceRecord]
    )

    const manageEvidenceEntries = useMemo(
        () => getEvidenceEntriesFromRecord(manageEvidenceRecord),
        [manageEvidenceRecord]
    )

    const pagedEvidenceEntries = useMemo(() => {
        const start = (evidencePoePage - 1) * POE_PAGE_SIZE
        return evidenceEntries.slice(start, start + POE_PAGE_SIZE)
    }, [evidenceEntries, evidencePoePage])

    const pagedManageEvidenceEntries = useMemo(() => {
        const start = (manageEvidencePoePage - 1) * POE_PAGE_SIZE
        return manageEvidenceEntries.slice(start, start + POE_PAGE_SIZE)
    }, [manageEvidenceEntries, manageEvidencePoePage])

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(evidenceEntries.length / POE_PAGE_SIZE))
        if (evidencePoePage > maxPage) setEvidencePoePage(maxPage)
    }, [evidenceEntries.length, evidencePoePage])

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(manageEvidenceEntries.length / POE_PAGE_SIZE))
        if (manageEvidencePoePage > maxPage) setManageEvidencePoePage(maxPage)
    }, [manageEvidenceEntries.length, manageEvidencePoePage])

    const detailsProgressUpdates = useMemo(() => {
        if (!detailsRecord) return []
        const records = detailsRecord.isGroupedDisplay ? detailsRecord.members || [] : [detailsRecord]
        const rawUpdates = detailsRecord.isGroupedDisplay && detailsRecord.groupDelivery?.progressUpdates?.length
            ? detailsRecord.groupDelivery.progressUpdates
            : records.flatMap(record => (record.progressUpdates || []).map(update => ({
                ...update,
                participantName: record.participantName || record.beneficiaryName || ''
            })))

        // A bulk upload writes one evidence event per member. Collapse those
        // events into one group action when they happened within the same
        // hour, while preserving separate actions on different days/hours.
        const grouped = new Map<string, any>()
        rawUpdates
            .filter((update: any) => !(Number(update.computedProgress || 0) === 0 && String(update.note || '').trim().toLowerCase() === 'completed'))
            .forEach((update: any) => {
                const date = toJsDate(update.createdAt)
                const type = String(update.type || '').toLowerCase()
                const isEvidence = type.startsWith('evidence-uploaded') || type === 'poe-uploaded'
                const bucket = date ? dayjs(date).format('YYYY-MM-DD HH') : `unknown-${grouped.size}`
                const key = isEvidence
                    ? `evidence:${bucket}`
                    : Number(update.computedProgress || 0) >= 100 && date
                        ? `completion:${dayjs(date).format('YYYY-MM-DD HH:mm')}:${String(update.note || 'Progress updated.')}`
                        : `update:${String(update.createdAt?.toMillis?.() || update.createdAt || '')}:${String(update.note || '')}:${String(update.computedProgress || '')}`
                const existing = grouped.get(key)
                if (existing) {
                    existing.participantCount = (existing.participantCount || 1) + 1
                    if (update.participantName && !existing.participantNames.includes(update.participantName)) {
                        existing.participantNames.push(update.participantName)
                    }
                    return
                }
                grouped.set(key, {
                    ...update,
                    participantCount: 1,
                    participantNames: update.participantName ? [update.participantName] : []
                })
            })

        return Array.from(grouped.values()).sort((left, right) =>
            (toJsDate(right.createdAt)?.getTime() || 0) -
            (toJsDate(left.createdAt)?.getTime() || 0)
        )
    }, [detailsRecord])
    const detailsProgressImages: any[] = []

    // The appointments this intervention is delivered over. Loaded when the
    // details modal opens rather than for every table row, because it needs a
    // second read to resolve each appointment's session date.
    const loadDetailsSessions = async (record: DisplayIntervention) => {
        const requestId = ++detailsSessionsRequestRef.current
        const isCurrent = () => detailsSessionsRequestRef.current === requestId

        setDetailsSessions([])
        setDetailsSessionsLoading(true)
        try {
            const assignmentIds = await getGroupMemberIdsForEvidence(record)
            if (!assignmentIds.length) return

            const appointmentDocs = new Map<string, { id: string; data: any }>()
            for (let index = 0; index < assignmentIds.length; index += 10) {
                const idChunk = assignmentIds.slice(index, index + 10)
                if (!idChunk.length) continue
                const snapshot = await getDocs(
                    query(
                        collection(db, 'appointments'),
                        where('assignedInterventionId', 'in', idChunk)
                    )
                )
                snapshot.docs.forEach(item =>
                    appointmentDocs.set(item.id, { id: item.id, data: item.data() as any })
                )
            }

            const views = await hydrateAppointmentViews(Array.from(appointmentDocs.values()))

            // A session is shared: the appointments above are only this
            // intervention's slice of it. Read each session's own totals too,
            // so this page can show the same 24-invited figure the
            // appointments page shows instead of silently contradicting it.
            const sessionIds: string[] = Array.from(new Set(
                views.map((view: any) => String(view.appointmentSessionId || '')).filter(Boolean)
            ))
            const totals: Record<string, { invited: number; attended: number }> = {}
            await Promise.all(sessionIds.map(async (id: string) => {
                try {
                    const snapshot = await getDoc(doc(db, 'appointmentSessions', id))
                    const summary = (snapshot.data() as any)?.attendanceSummary || {}
                    totals[id] = {
                        invited: Number(summary.invitedCount || 0),
                        attended: Number(summary.attendedCount || 0)
                    }
                } catch {
                    // A session we cannot read just falls back to the slice.
                }
            }))

            if (isCurrent()) {
                setDetailsSessionTotals(totals)
                setDetailsSessions(views)
            }
        } catch (error) {
            console.warn('Could not load the sessions for this intervention:', error)
        } finally {
            if (isCurrent()) setDetailsSessionsLoading(false)
        }
    }

    // One real session covers every SME in a group, but each SME has their own
    // appointment document for it. Collapse them back into the session so the
    // list reads as the delivery timeline rather than one row per invitation.
    const detailsSessionsAll = useMemo(() => {
        const bySession = new Map<string, any[]>()
        detailsSessions.forEach(view => {
            const key = String(view.appointmentSessionId || view.id)
            bySession.set(key, [...(bySession.get(key) || []), view])
        })

        // The v5 appointment carries a per-appointment attendance status, but
        // check-in driven sessions only ever set checkedInAt. Treat either as
        // attendance or every QR-scanned session reads as nobody attending.
        const attendedStatuses = ['attended', 'checked-in', 'checked-out']
        const didAttend = (view: any) =>
            attendedStatuses.includes(String(view.attendance?.status || '')) ||
            Boolean(view.attendance?.checkedInAt)
        const nameOf = (view: any) =>
            String(view.participantName || view.participantEmail || '').trim()

        return Array.from(bySession.entries())
            .map(([key, views]) => {
                const first = views[0]
                const attendedNames = views.filter(didAttend).map(nameOf).filter(Boolean)
                const absentNames = views
                    .filter(view => !didAttend(view))
                    .map(nameOf)
                    .filter(Boolean)

                return {
                    key,
                    title: first.sessionTitle || first.subInterventionTitle || first.interventionTitle || 'Session',
                    startAt: first.startTime,
                    endAt: first.endTime,
                    cycleKey: first.cycleKey ?? null,
                    deliveryMethod: first.deliveryMethod || '',
                    location: first.location || first.meetingLink || '',
                    held: first.sessionCoverage?.latest?.held,
                    status: String(first.status || ''),
                    invited: views.length,
                    // Everyone on the session, across every intervention.
                    sessionInvited: detailsSessionTotals[key]?.invited ?? 0,
                    sessionAttended: detailsSessionTotals[key]?.attended ?? 0,
                    // Which assignments this session actually covers, so the
                    // panel can report members who were never booked at all.
                    memberIds: views
                        .map((view: any) => String(view.assignedInterventionId || ''))
                        .filter(Boolean),
                    attendedNames,
                    absentNames
                }
            })
            .sort((left, right) =>
                (toJsDate(left.startAt)?.getTime() || 0) - (toJsDate(right.startAt)?.getTime() || 0)
            )
    }, [detailsSessions, detailsSessionTotals])

    // Live data has appointments from earlier cycles pointing at newer
    // assignment documents, which is how April sessions surfaced under an
    // August allocation. Show only this assignment's own cycle, and say how
    // many were set aside rather than hiding them silently.
    const detailsSessionsScoped = useMemo(() => {
        const record = detailsRecord
        if (!record) return { rows: [], excluded: 0 }

        const base = record.members?.[0] || record
        const cycleKey = String(base.cycleKey || '').trim()
        const assignedTime = getAssignedTime(record)

        const rows = detailsSessionsAll.filter(row => {
            const rowCycle = String(row.cycleKey || '').trim()
            if (cycleKey && rowCycle) return rowCycle === cycleKey
            const startedAt = toJsDate(row.startAt)?.getTime() || 0
            if (!assignedTime || !startedAt) return true
            // A session held before the work was allocated belongs to an
            // earlier delivery, not this one.
            return startedAt >= dayjs(assignedTime).startOf('day').valueOf()
        })

        return { rows, excluded: detailsSessionsAll.length - rows.length }
    }, [detailsSessionsAll, detailsRecord])

    const detailsSessionRows = detailsSessionsScoped.rows

    const findAppointmentDeliveryMethod = async (
        record: DisplayIntervention,
        _preferredMethod?: string
    ) => {
        const member = record.isGroupedDisplay
            ? (record.members || [])[0]
            : record
        if (!member) return { value: '', label: '', other: '' }

        try {
            const directAppointments = await getDocs(
                query(
                    collection(db, 'appointments'),
                    where('assignedInterventionId', '==', member.id),
                    limit(20)
                )
            )
            const rows = (await hydrateAppointmentViews(
                directAppointments.docs.map(item => ({ id: item.id, data: item.data() as any }))
            ))
                .filter(item => item.deliveryMethod)
            const heldRows = rows.filter(item =>
                item.sessionCoverage?.latest?.held === true ||
                String(item.status || '').toLowerCase() === 'completed'
            )
            const sourceRows = heldRows.length ? heldRows : rows
            const methods = new Set(sourceRows
                .map(item => normalizeCompletionDeliveryMethod(item.deliveryMethod).value)
                .filter(Boolean))
            if (methods.has('in-person') && methods.has('online')) {
                return { value: 'hybrid', label: 'Hybrid', other: '' }
            }
            const firstMethod = sourceRows
                .map(item => normalizeCompletionDeliveryMethod(item.deliveryMethod))
                .find(item => item.value)
            if (firstMethod) return firstMethod
        } catch (error) {
            console.warn('Could not derive delivery method from appointments:', error)
        }

        return { value: '', label: '', other: '' }
    }

    const prepareCompletionStep = async (
        record: DisplayIntervention,
        preferredMethod?: string
    ) => {
        if (completionPreparingRef.current || evidenceSubmissionRef.current) return
        completionPreparingRef.current = true
        setSavingEvidence(true)
        try {
            const [delivery, context] = await Promise.all([
                findAppointmentDeliveryMethod(record, preferredMethod),
                getGroupMemberIdsForEvidence(record).then(ids => loadInterventionCompletionContext(db, ids))
            ])
            const currentPoeLinks = new Set(
                (record.isGroupedDisplay
                    ? normalizePoeResources((record.groupDelivery?.evidence || record.resources || []) as Resource[])
                    : getPoeResourcesFromRecord(record)
                ).map(resource => resource.link)
            )
            const previousEvidence = getCompletionProgressEvidence(record)
                .filter(resource => !currentPoeLinks.has(resource.link))

            setCompletionContext(context)
            setCompletionFailureMessage('')
            setProgressRecord(record)
            setCompletionDeliveryMethod(delivery.label)
            setCompletionDeliveryValue(delivery.value)
            setManageEvidenceOpen(false)
            setSelectedProgressPoeUrls([])
            setCompletionPoeFiles([])
            setCompletionMovFilesByAssignment({})
            setCompletionStepError(null)
            setCompletionChatTurn(turn => turn + 1)
            completionEvidenceForm.resetFields()
            setProgressModalStep(previousEvidence.length ? 1 : 2)
            setProgressModalOpen(true)
        } catch (error) {
            message.error(interventionCompletionError(error))
        } finally {
            completionPreparingRef.current = false
            setSavingEvidence(false)
        }
    }

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true)

            try {
                if (identityLoading) return
                if (!effectiveUser?.uid && !effectiveUser?.id) {
                    setAllInterventions([])
                    setGroupDeliveries({})
                    setActiveInterventions([])
                    setCompletedInterventions([])
                    return
                }

                const uid = String(effectiveUser.uid || effectiveUser.id)
                const email = String(effectiveUser.email || '')
                const assignedCol = collection(db, 'assignedInterventions')

                let coordinatorDocId: string | null = null
                if (email) {
                    try {
                        const cs = await getDocs(
                            query(
                                collection(db, 'coordinators'),
                                where('email', '==', email),
                                limit(1)
                            )
                        )
                        if (!cs.empty) coordinatorDocId = cs.docs[0].id
                    } catch {
                        // ignore coordinator lookup failure
                    }
                }

                const queriesToTry = buildUserScopedAssignedQueries({
                    assignedCol,
                    activeProgramId,
                    uid,
                    email,
                    coordinatorDocId
                })

                const raw: any[] = []
                for (const qRef of queriesToTry) {
                    try {
                        const s = await getDocs(qRef)
                        s.forEach(d => raw.push(toAssignedInterventionView(d.id, d.data())))
                    } catch (err) {
                        console.warn('assignedInterventions query failed:', err)
                    }
                }

                const byId: Record<string, any> = {}
                raw.forEach(a => {
                    byId[a.id] = a
                })

                let allBase: AssignedIntervention[] = Object.values(byId).map(ai => ({
                    id: ai.id,
                    ...(ai as any)
                }))

                // Group delivery is deliberately separate from SME membership.
                // A single record owns shared progress and proof; assignments
                // remain responsible for attendance and MOV eligibility.
                let loadedGroupDeliveries: Record<string, GroupInterventionDelivery> = {}
                try {
                    loadedGroupDeliveries = await loadGroupDeliveriesForAssignee(db, uid, email)
                    if (activeProgramId) {
                        loadedGroupDeliveries = Object.fromEntries(
                            Object.entries(loadedGroupDeliveries).filter(([, delivery]) =>
                                !delivery.programId || delivery.programId === activeProgramId
                            )
                        )
                    }
                } catch (error) {
                    console.warn('Could not load shared group delivery state:', error)
                }

                // Reconcile older assignments whose appointment coverage was
                // saved before session tracking was written to the assignment.
                // This also self-heals the exact "completed appointment / 0%"
                // mismatch instead of requiring a one-off migration.
                const attendedAppointmentsByAssignment = new Map<string, Set<string>>()
                const assignmentIds = allBase.map(item => item.id).filter(Boolean)
                for (let index = 0; index < assignmentIds.length; index += 10) {
                    const idChunk = assignmentIds.slice(index, index + 10)
                    if (!idChunk.length) continue
                    try {
                        const appointmentSnap = await getDocs(
                            query(
                                collection(db, 'appointments'),
                                where('assignedInterventionId', 'in', idChunk)
                            )
                        )
                        appointmentSnap.docs.forEach(appointmentDoc => {
                            const appointment = appointmentDoc.data() as any
                            const assignmentId = String(appointment.assignedInterventionId || '')
                            if (!assignmentId || appointment.attendance?.status !== 'attended') return

                            if (!attendedAppointmentsByAssignment.has(assignmentId)) {
                                attendedAppointmentsByAssignment.set(assignmentId, new Set())
                            }
                            // Count the delivery session, not the invitation
                            // document. A rescheduled or reissued appointment
                            // leaves a second attended document behind for the
                            // same session, which is what produced counts like
                            // "attended 4 of 3".
                            attendedAppointmentsByAssignment
                                .get(assignmentId)!
                                .add(String(appointment.appointmentSessionId || appointmentDoc.id))
                        })
                    } catch (error) {
                        console.warn('Appointment progress reconciliation failed:', error)
                    }
                }

                const progressRepairs: Promise<void>[] = []
                allBase = allBase.map(item => {
                    const attendedCount =
                        attendedAppointmentsByAssignment.get(item.id)?.size || 0
                    const storedSessions = Number(item.tracking?.sessionsLogged || 0)
                    const isSessionTracked = !item.target?.mode || item.target.mode === 'sessions'
                    // Grouped members share one delivery value held on the
                    // group delivery document. Deriving their progress from
                    // their own attendance is what used to spread a single
                    // delivery across 20% / 50% / completed members.
                    const isGroupedMember = Boolean(getGroupKey(item))
                    const completionIsFinal =
                        resolveAssignmentLifecycle(item).isCompleted ||
                        isClosedWithoutAttendance(item) ||
                        String(item.assignmentStatus || '').toLowerCase() === 'completed' ||
                        String(item.assigneeCompletionStatus || '').toLowerCase() === 'completed' ||
                        String(item.participantCompletionStatus || '').toLowerCase() === 'confirmed'

                    const repair: Record<string, any> = {}
                    let next = item

                    // Attendance is recorded for every assignment, including
                    // completed ones, because it decides who actually received
                    // the intervention and can be issued a MOV.
                    if (isSessionTracked && attendedCount !== storedSessions) {
                        repair['tracking.sessionsLogged'] = attendedCount
                        next = {
                            ...next,
                            tracking: { ...(next.tracking || {}), sessionsLogged: attendedCount }
                        }
                    }

                    if (completionIsFinal) {
                        if (Number(item.computedProgress) !== 100) repair.computedProgress = 100
                        next = { ...next, computedProgress: 100 }
                    } else if (isSessionTracked && !isGroupedMember) {
                        const plannedSessions = Math.max(1, Number(item.plannedSessions) || 1)
                        // Attendance can supplement delivery progress, but it
                        // must never erase a facilitator's recorded delivery
                        // update or completion evidence.
                        const recordedProgress = Math.max(
                            Number(item.computedProgress) || 0,
                            ...(item.progressUpdates || []).map(update => Number(update.computedProgress) || 0)
                        )
                        const repairedProgress = clampPercent(
                            Math.max(recordedProgress, (attendedCount / plannedSessions) * 100)
                        )
                        if (repairedProgress !== Number(item.computedProgress || 0)) {
                            repair.computedProgress = repairedProgress
                            next = { ...next, computedProgress: repairedProgress }
                        }
                    }

                    if (Object.keys(repair).length) {
                        progressRepairs.push(
                            updateDoc(doc(db, 'assignedInterventions', item.id), {
                                ...repair,
                                updatedAt: Timestamp.now()
                            })
                        )
                    }
                    return next
                })

                if (progressRepairs.length) {
                    await Promise.allSettled(progressRepairs)
                }

                const enrichAssignment = async (
                    item: AssignedIntervention
                ): Promise<AssignedIntervention> => {
                    let base: AssignedIntervention = {
                        ...item,
                        resources: item.resources || []
                    }

                    try {
                        if (base.departmentId) {
                            const depSnap = await getDocs(
                                query(
                                    collection(db, 'departments'),
                                    where('__name__', '==', base.departmentId),
                                    limit(1)
                                )
                            )

                            if (!depSnap.empty) {
                                base = {
                                    ...base,
                                    isSensitive: depSnap.docs[0].data()?.isSensitive === true
                                } as any
                            }
                        }
                    } catch {
                        //
                    }

                    try {
                        const rows = await fetchQueriesForIntervention(base)
                        base = {
                            ...base,
                            queries: rows,
                            queryCount: rows.length,
                            openQueryCount: rows.filter(q => isOpenQuery(q.status)).length
                        }
                    } catch (err) {
                        console.warn('Failed to enrich queries:', {
                            assignedId: item.id,
                            err
                        })
                    }

                    return base
                }

                const enrichedRows = await Promise.all(
                    allBase.map(item => enrichAssignment(item))
                )
                const allEnriched = dedupeAssignedInterventionViews(enrichedRows)

                const active: AssignedIntervention[] = []
                const completed: AssignedIntervention[] = []

                allEnriched.forEach(item => {
                    const lifecycle = resolveAssignmentLifecycle(item)
                    if (lifecycle.isCompleted || isClosedWithoutAttendance(item)) completed.push(item)
                    else if (lifecycle.isOpen) active.push(item)
                })

                setAllInterventions(allEnriched)
                setGroupDeliveries(loadedGroupDeliveries)
                setActiveInterventions(active)
                setCompletedInterventions(completed)
            } catch (err) {
                console.error('Error loading assigned interventions:', err)
                setAllInterventions([])
                setGroupDeliveries({})
                setActiveInterventions([])
                setCompletedInterventions([])
            } finally {
                setLoading(false)
                if (!identityLoading) setHasLoadedOnce(true)
            }
        }

        fetchData()
    }, [activeProgramId, effectiveUser?.email, effectiveUser?.id, effectiveUser?.uid, identityLoading, reloadKey])

    const baseData = useMemo(
        () => rollupGroupedRows(allInterventions, 'active', groupDeliveries),
        [allInterventions, groupDeliveries]
    )

    // The table is grouped by intervention/group. Keep the headline metrics in
    // the same unit as the table, while each group row still shows its SME
    // counts in the detail view.
    // Counted with the same resolver the status tag and the filter use, so a
    // card's number always matches the number of rows clicking it produces.
    const metrics = useMemo(() => {
        const inScope = baseData.filter(
            row => row.lifecycleBucket === 'active' || row.lifecycleBucket === 'completed'
        )
        const countOf = (status: DisplayStatus) =>
            inScope.filter(row => resolveDisplayStatus(row) === status).length

        return {
            total: inScope.length,
            inDelivery: countOf('in-delivery'),
            awaitingSmeCompletionConfirm: countOf('awaiting-confirmation'),
            // "No attendance" is a closed outcome, so it belongs with completed.
            completed: countOf('completed') + countOf('no-attendance')
        }
    }, [baseData])

    const openQueriesForMetric = useMemo(() => {
        const unique = new Map<string, QueryDoc>()
        baseData.forEach(item => {
            ; (item.queries || []).forEach(queryRecord => {
                if (isOpenQuery(queryRecord.status)) unique.set(queryRecord.id, queryRecord)
            })
        })
        return Array.from(unique.values()).sort((left, right) =>
            (toJsDate(right.createdAt)?.getTime() || 0) -
            (toJsDate(left.createdAt)?.getTime() || 0)
        )
    }, [baseData])

    const historyQueryMetrics = useMemo(() => ({
        totalOpen: openQueriesForMetric.length
    }), [openQueriesForMetric])

    useEffect(() => {
        const completionAssignmentId = String(
            (location.state as any)?.completionAssignmentId || ''
        ).trim()
        const completionGroupKey = String(
            (location.state as any)?.completionGroupKey || ''
        ).trim()
        if ((!completionAssignmentId && !completionGroupKey) || loading) return

        const record = baseData.find(item =>
            completionGroupKey
                ? item.groupKeyResolved === completionGroupKey ||
                item.groupKey === completionGroupKey
                : item.id === completionAssignmentId ||
                (item.members || []).some(member => member.id === completionAssignmentId)
        )
        if (!record) return

        void prepareCompletionStep(
            record,
            String((location.state as any)?.completionDeliveryMethod || '')
        )
        navigate(location.pathname, { replace: true, state: {} })
    }, [baseData, loading, location.pathname, location.state, navigate])

    const filteredData = useMemo(() => {
        const rows = baseData.filter(item => {
            if (quickStatus !== 'all') {
                const status = resolveDisplayStatus(item)
                const matchesQuickStatus = quickStatus === 'completed'
                    ? status === 'completed' || status === 'no-attendance'
                    : status === quickStatus
                if (!matchesQuickStatus) return false
            }
            if (workflowFilter !== 'all') {
                const rows = item.isGroupedDisplay ? item.members || [] : [item]
                const matchesWorkflow = workflowFilter === 'no-attendance'
                    ? rows.some(isClosedWithoutAttendance)
                    : rows.some(row => resolveAssignmentLifecycle(row).key === workflowFilter)
                if (!matchesWorkflow) return false
            }

            const text = searchText.trim().toLowerCase()
            if (text) {
                const name =
                    item.participantName ||
                    item.beneficiaryName ||
                    item.participantId ||
                    ''
                const combined = `${name} ${item.interventionTitle || ''} ${item.sector || ''} ${item.province || ''} ${item.hub || ''}`.toLowerCase()
                if (!combined.includes(text)) return false
            }

            if (dateRange?.[0] || dateRange?.[1]) {
                const recordDate = item.lifecycleBucket === 'completed'
                    ? toJsDate(item.completedAtResolved) || assignmentCompletedDate(item)
                    : assignmentAssignedDate(item)
                if (!recordDate) return false
                const value = dayjs(recordDate)
                if (dateRange[0] && value.isBefore(dateRange[0].startOf('day'))) return false
                if (dateRange[1] && value.isAfter(dateRange[1].endOf('day'))) return false
            }

            return true
        })

        // Newest allocation first. The Dates column sorter can flip this, but
        // this is the order the table opens on.
        return rows.sort((left, right) => getAssignedTime(right) - getAssignedTime(left))
    }, [baseData, dateRange, searchText, workflowFilter, quickStatus])

    const sendReminder = async (record: DisplayIntervention) => {
        const user = auth.currentUser
        if (!user?.email) {
            message.error('You must be logged in.')
            return
        }

        const targets = getReminderTargets(record)
        if (!targets.length) {
            message.warning('No SME on this item is awaiting completion confirmation.')
            return
        }

        try {
            setRemindingIds(prev => [...prev, record.id])

            const sendReminderEmail = async (target: AssignedIntervention) => {
                const reason = getReminderReason(target)
                if (!reason) return
                const idToken = await user.getIdToken()
                const response = await fetch('https://us-central1-lph-smart-inc.cloudfunctions.net/sendInterventionReminderEmail', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                    body: JSON.stringify({
                        programId: target.programId || activeProgramId || null,
                        participantId: target.participantId || null,
                        participantName: target.participantName || target.beneficiaryName || null,
                        participantEmail: (target as any).participantEmail || (target as any).email || null,
                        interventionTitle: target.interventionTitle || null,
                        reminderReason
                    })
                })
                const result = await response.json().catch(() => ({}))
                if (!response.ok || result?.ok === false) throw new Error(result?.error || 'Failed to send reminder email.')
            }
            await Promise.all(targets.map(sendReminderEmail))

            message.success(
                record.isGroupedDisplay
                    ? `Completion reminders sent to ${targets.length} SME(s).`
                    : 'Completion reminder sent.'
            )
        } catch (err) {
            console.error(err)
            message.error('Failed to send completion reminder.')
        } finally {
            setRemindingIds(prev => prev.filter(id => id !== record.id))
        }
    }

    const sendReminderToAllVisible = async () => {
        const visibleTargets = filteredData.flatMap(item => getReminderTargets(item))

        if (!visibleTargets.length) {
            message.warning('No visible items are awaiting completion confirmation.')
            return
        }

        const user = auth.currentUser
        if (!user?.email) {
            message.error('You must be logged in.')
            return
        }

        try {
            setBulkReminding(true)

            const sendReminderEmail = async (target: AssignedIntervention) => {
                const reason = getReminderReason(target)
                if (!reason) return
                const idToken = await user.getIdToken()
                const response = await fetch('https://us-central1-lph-smart-inc.cloudfunctions.net/sendInterventionReminderEmail', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                    body: JSON.stringify({
                        programId: target.programId || activeProgramId || null,
                        participantId: target.participantId || null,
                        participantName: target.participantName || target.beneficiaryName || null,
                        participantEmail: (target as any).participantEmail || (target as any).email || null,
                        interventionTitle: target.interventionTitle || null,
                        reminderReason
                    })
                })
                const result = await response.json().catch(() => ({}))
                if (!response.ok || result?.ok === false) throw new Error(result?.error || 'Failed to send reminder email.')
            }
            await Promise.all(visibleTargets.map(sendReminderEmail))

            message.success(`Completion reminders sent to ${visibleTargets.length} SME(s).`)
        } catch (err) {
            console.error(err)
            message.error('Failed to send completion reminders.')
        } finally {
            setBulkReminding(false)
        }
    }

    const renderSubInterventionTag = (r: AssignedIntervention) => {
        const label = getSubInterventionLabel(r)
        if (!label) return <Tag color="default">No Sub-Intervention</Tag>
        return <Tag color="purple">{label}</Tag>
    }

    const setRecordQueriesLocally = (recordId: string, rows: QueryDoc[]) => {
        setCompletedInterventions(prev =>
            prev.map(item =>
                item.id === recordId
                    ? {
                        ...item,
                        queries: rows,
                        queryCount: rows.length,
                        openQueryCount: rows.filter(q => isOpenQuery(q.status)).length
                    }
                    : item
            )
        )
    }

    const openEvidenceModal = (record: AssignedIntervention) => {
        setEvidenceRecord(record)
        setEvidencePoePage(1)
        setEvidenceModalOpen(true)
    }

    const openDetailsModal = (record: DisplayIntervention) => {
        setDetailsRecord(record)
        setDetailsTab('overview')
        setDetailsModalOpen(true)
        void loadDetailsSessions(record)
    }

    const openProgressModal = async (record: DisplayIntervention) => {
        const currentProgress = record.progressResolved ?? getProgressPercent(record)
        if (currentProgress >= 100) {
            await prepareCompletionStep(record)
            return
        }
        setProgressModalStep(0)
        setProgressRecord(record)
        setProgressUpdateFiles([])
        setProgressChatError(null)
        setProgressChatTurn(turn => turn + 1)
        progressUpdateForm.resetFields()
        progressUpdateForm.setFieldsValue({ nextProgress: currentProgress })
        setProgressModalOpen(true)
    }

    const submitProgressUpdate = async (values: any) => {
        if (!progressRecord || !effectiveUser?.uid) return
        const note = String(values.note || '').trim()
        const currentProgress = progressRecord.progressResolved ?? getProgressPercent(progressRecord)
        const nextProgress = clampPercent(values.nextProgress)
        // Answer in the thread instead of a toast that appears away from the
        // field the person is working in.
        if (nextProgress <= currentProgress) {
            setProgressChatError(
                `The intervention is already at ${currentProgress}%. Choose a progress value greater than ${currentProgress}% to log a new update.`
            )
            return
        }
        if (note.split(/\s+/).filter(Boolean).length < 5) {
            setProgressChatError('Give me a bit more - at least five words describing what was done.')
            return
        }
        setProgressChatError(null)

        setSavingProgressUpdate(true)
        try {
            const uploadedResources = await Promise.all(
                progressUpdateFiles
                    .map(file => file.originFileObj || file)
                    .filter(Boolean)
                    .map(async (file: File) => {
                        const path = `assignedInterventions/${progressRecord.id}/progress-updates/${Date.now()}_${file.name}`
                        const fileRef = ref(storage, path)
                        await uploadBytes(fileRef, file)
                        return {
                            type: file.type?.startsWith('image/') ? 'image' : 'document',
                            label: file.name,
                            link: await getDownloadURL(fileRef)
                        }
                    })
            )

            const createdAt = Timestamp.now()
            const sharedUpdate = {
                by: effectiveUser.uid,
                byName: effectiveUser.name || effectiveUser.email || '',
                source: 'facilitator-progress',
                note,
                resources: uploadedResources,
                previousProgress: currentProgress,
                computedProgress: nextProgress,
                createdAt
            }

            if (progressRecord.isGroupedDisplay) {
                // Shared group delivery is written once. Member records are
                // intentionally not used as the group progress source.
                await saveSharedGroupDelivery(progressRecord, {
                    progress: nextProgress,
                    deliveryStatus: nextProgress >= 100 ? 'completed' : 'in_progress',
                    // Progress attachments stay in progressUpdates until the
                    // facilitator explicitly promotes them to POE at completion.
                    evidence: progressRecord.groupDelivery?.evidence || [],
                    progressUpdates: [
                        ...(progressRecord.groupDelivery?.progressUpdates || []),
                        sharedUpdate
                    ]
                })
            } else {
                await updateDoc(doc(db, 'assignedInterventions', progressRecord.id), {
                    computedProgress: nextProgress,
                    progressUpdates: arrayUnion(sharedUpdate),
                    updatedAt: createdAt
                })
            }
            setProgressUpdateFiles([])
            progressUpdateForm.resetFields()

            if (nextProgress >= 100) {
                const completedProgressRecord: DisplayIntervention = {
                    ...progressRecord,
                    computedProgress: 100,
                    progressResolved: 100,
                    progressUpdates: progressRecord.isGroupedDisplay
                        ? progressRecord.progressUpdates
                        : [...(progressRecord.progressUpdates || []), sharedUpdate],
                    groupDelivery: progressRecord.isGroupedDisplay
                        ? ({
                            ...(progressRecord.groupDelivery || {}),
                            progress: 100,
                            deliveryStatus: 'completed',
                            // The file just uploaded at 100% is still only progress
                            // evidence until the facilitator selects it as POE below.
                            evidence: progressRecord.groupDelivery?.evidence || [],
                            progressUpdates: [
                                ...(progressRecord.groupDelivery?.progressUpdates || []),
                                sharedUpdate
                            ]
                        } as GroupInterventionDelivery)
                        : progressRecord.groupDelivery,
                    members: progressRecord.members?.map(member => ({
                        ...member,
                        computedProgress: 100
                    }))
                }
                await prepareCompletionStep(completedProgressRecord)
                message.success('Progress reached 100%. Add the completion evidence to finalise it.')
            } else {
                setProgressModalOpen(false)
                message.success(`Intervention progress updated to ${nextProgress}%.`)
                setReloadKey(value => value + 1)
                setProgressRecord(null)
            }
        } catch (error) {
            console.error(error)
            message.error('Failed to save the progress update.')
        } finally {
            setSavingProgressUpdate(false)
        }
    }

    const openManageEvidenceModal = (record: AssignedIntervention) => {

        setManageEvidenceRecord(record)
        setManageEvidencePoePage(1)
        setGroupEvidenceMode('bulk')
        setGroupEvidenceMemberId(undefined)
        setPendingEvidenceFiles([])
        setEvidenceMode((record as any).isSensitive && USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE ? 'summary' : 'file')
        manageEvidenceForm.resetFields()
        setPendingEvidenceFiles([])
        setManageEvidenceOpen(true)
    }

    const openQueriesModal = async (record: AssignedIntervention) => {
        try {
            setQueriesModalScope('record')
            setSelectedQueryRecord(record)
            setQueriesLoading(true)
            setQueriesModalOpen(true)

            if (record.queries?.length) {
                setSelectedQueries(record.queries)
                return
            }

            const rows = await fetchQueriesForIntervention(record)
            setSelectedQueries(rows)
            setRecordQueriesLocally(record.id, rows)
        } finally {
            setQueriesLoading(false)
        }
    }

    const openAllOpenQueriesModal = () => {
        setQueriesModalScope('open')
        setSelectedQueryRecord(null)
        setSelectedQueries(openQueriesForMetric)
        setQueriesLoading(false)
        setQueriesModalOpen(true)
    }

    const closeQueriesModal = () => {
        setQueriesModalOpen(false)
        setSelectedQueries([])
        setSelectedQueryRecord(null)
        setQueriesModalScope('record')
    }

    const findRecordForQuery = (queryRecord: QueryDoc) =>
        baseData.find(record =>
            (record.isGroupedDisplay ? record.members || [] : [record]).some(member => {
                const participantMatches =
                    !queryRecord.participantId || member.participantId === queryRecord.participantId
                const interventionMatches =
                    !queryRecord.interventionId ||
                    member.id === queryRecord.interventionId ||
                    member.interventionId === queryRecord.interventionId
                return participantMatches && interventionMatches
            })
        )

    const openPoeResolveModal = (record: AssignedIntervention, queryRecord: QueryDoc) => {
        setSelectedRecord(record)
        setSelectedQueryForResolution(queryRecord)
        setPoeUploadModalOpen(true)
    }

    const openOverdueModal = (record: DisplayIntervention) => {
        overdueForm.resetFields()
        overdueForm.setFieldsValue({
            reason: resolveAssignmentLifecycle(record).key === 'awaiting-participant-acceptance' ? 'Awaiting appointment response' : '',
            comments: ''
        })
        setOverdueRecord(record)
        setOverdueModalOpen(true)
    }

    const uploadEvidenceFiles = async (
        files: File[],
        record: AssignedIntervention,
        kind: 'documents' | 'poe' | 'mov'
    ): Promise<EvidenceDoc[]> => {
        if (files.some(file => file.size > COMPLETION_MAX_FILE_SIZE_BYTES)) {
            throw new Error('Each evidence file must be 25 MB or smaller.')
        }
        const safePathPart = (value: unknown, fallback: string) =>
            String(value || fallback).trim().replace(/[\\/#?%]+/g, '_') || fallback
        const safeProgram = safePathPart(record.programId || activeProgramId, 'no-program')
        const safeParticipant = safePathPart(record.participantId, 'unknown-participant')
        const safeAssignment = safePathPart(record.id, 'no-assignment')

        const uploaded = await Promise.all(
            files.map(async file => {
                const safeFileName = safePathPart(file.name, 'evidence-file')
                const storagePath = `intervention-evidence/${safeProgram}/${safeParticipant}/${safeAssignment}/${Date.now()}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}_${safeFileName}`
                const fileRef = ref(storage, storagePath)
                await uploadBytes(fileRef, file)
                const link = await getDownloadURL(fileRef)

                return {
                    id: `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}-${file.name}`,
                    label: file.name,
                    originalName: file.name,
                    link,
                    type: kind === 'documents' ? 'document' : kind
                } as EvidenceDoc
            })
        )

        return uploaded
    }

    const applyPoeStateLocally = (
        record: AssignedIntervention,
        targetIds: string[],
        resources: Resource[]
    ) => {
        const normalizedResources = normalizePoeResources(resources)
        const patchItem = (item: AssignedIntervention) =>
            targetIds.includes(item.id)
                ? { ...item, resources: normalizedResources }
                : (item as DisplayIntervention).isGroupedDisplay
                    ? {
                        ...item,
                        resources: normalizedResources,
                        members: (item as DisplayIntervention).members?.map(member =>
                            targetIds.includes(member.id) ? { ...member, resources: normalizedResources } : member
                        )
                    }
                    : item

        setAllInterventions(previous => previous.map(patchItem))
        setActiveInterventions(previous => previous.map(patchItem))
        setCompletedInterventions(previous => previous.map(patchItem))

        const patchSelected = (item: AssignedIntervention | null) => {
            if (!item) return item
            const sameGroupedRow =
                (record as DisplayIntervention).isGroupedDisplay &&
                (item as DisplayIntervention).groupKeyResolved === (record as DisplayIntervention).groupKeyResolved
            const containsTargetMember =
                (item as DisplayIntervention).isGroupedDisplay === true &&
                Boolean((item as DisplayIntervention).members?.some(member => targetIds.includes(member.id)))
            if (item.id !== record.id && !targetIds.includes(item.id) && !sameGroupedRow && !containsTargetMember) return item
            return {
                ...item,
                resources: (item as DisplayIntervention).isGroupedDisplay && !(record as DisplayIntervention).isGroupedDisplay
                    ? item.resources
                    : normalizedResources,
                members: (item as DisplayIntervention).isGroupedDisplay
                    ? (item as DisplayIntervention).members?.map(member =>
                        targetIds.includes(member.id) ? { ...member, resources: normalizedResources } : member
                    )
                    : (item as DisplayIntervention).members
            }
        }

        setManageEvidenceRecord(previous => patchSelected(previous))
        setEvidenceRecord(previous => patchSelected(previous))
    }

    const saveSharedGroupDelivery = async (
        record: DisplayIntervention,
        patch: Partial<Pick<GroupInterventionDelivery, 'progress' | 'deliveryStatus' | 'evidence' | 'progressUpdates' | 'completedAt'>> = {}
    ) => {
        if (!record.isGroupedDisplay || !record.groupKeyResolved) return
        const base = record.members?.[0] || record
        const progress = patch.progress ?? record.groupDelivery?.progress ?? record.progressResolved ?? 0
        const deliveryStatus = patch.deliveryStatus ?? (progress >= 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started')
        await saveGroupDelivery(db, {
            groupKey: record.groupKeyResolved,
            programId: base.programId || null,
            departmentId: base.departmentId || null,
            interventionId: base.interventionId || null,
            interventionTitle: base.interventionTitle || null,
            subInterventionId: base.subInterventionId || null,
            subInterventionTitle: base.subInterventionTitle || null,
            assigneeId: base.assigneeId || effectiveUser?.uid || null,
            assigneeEmail: base.assigneeEmail || effectiveUser?.email || null,
            assigneeName: base.assigneeName || effectiveUser?.name || null,
            progress,
            deliveryStatus,
            evidence: patch.evidence ?? record.groupDelivery?.evidence ?? [],
            progressUpdates: patch.progressUpdates ?? record.groupDelivery?.progressUpdates ?? [],
            sourceAssignmentIds: record.memberIds || record.members?.map(member => member.id) || []
        })
        setGroupDeliveries(previous => ({
            ...previous,
            [record.groupKeyResolved!]: {
                ...(previous[record.groupKeyResolved!] || record.groupDelivery || {}),
                id: record.groupKeyResolved!,
                groupKey: record.groupKeyResolved!,
                progress,
                deliveryStatus,
                evidence: patch.evidence ?? record.groupDelivery?.evidence ?? [],
                progressUpdates: patch.progressUpdates ?? record.groupDelivery?.progressUpdates ?? [],
                sourceAssignmentIds: record.memberIds || record.members?.map(member => member.id) || []
            } as GroupInterventionDelivery
        }))
    }

    const removePoe = async (
        record: AssignedIntervention,
        poeUrl: string
    ) => {
        if (isDocumentTarget(record) || deletingPoeUrl) return

        const currentPoes = getPoeResourcesFromRecord(record)
        const canonicalUrl = (value: unknown) => {
            const raw = String(value || '').trim()
            try {
                return decodeURIComponent(raw).replace(/\/$/, '')
            } catch {
                return raw.replace(/\/$/, '')
            }
        }
        const targetUrl = canonicalUrl(poeUrl)
        const nextPoes = normalizePoeResources(
            currentPoes.filter(resource => canonicalUrl(resource.link) !== targetUrl)
        )

        console.error('[Allocated MOV] POE delete requested', {
            interventionTitle: (record as any).interventionTitle,
            groupKey: (record as DisplayIntervention).groupKeyResolved || null,
            isGrouped: (record as DisplayIntervention).isGroupedDisplay === true,
            recordId: record.id,
            poeUrl,
            targetUrl,
            current: currentPoes.map(resource => ({ label: resource.label, originalName: resource.originalName, link: resource.link })),
            next: nextPoes.map(resource => ({ label: resource.label, originalName: resource.originalName, link: resource.link }))
        })

        if (nextPoes.length === currentPoes.length) {
            console.error('[Allocated MOV] POE delete matched no resource', {
                recordId: record.id,
                targetUrl,
                currentLinks: currentPoes.map(resource => resource.link)
            })
            message.warning('That POE could not be matched to the saved evidence list. The details were logged.')
            return
        }

        const targetIds = await getGroupMemberIdsForEvidence(
            record as DisplayIntervention
        )

        if (!targetIds.length) {
            message.error('No linked interventions were found for this POE.')
            return
        }

        try {
            setDeletingPoeUrl(poeUrl)
            if ((record as DisplayIntervention).isGroupedDisplay) {
                await saveSharedGroupDelivery(record as DisplayIntervention, { evidence: nextPoes })
                // Keep each member aligned with the shared group evidence too.
                // This prevents older assignment resources from resurrecting a
                // POE when the group delivery list is empty or stale.
                await Promise.all(targetIds.map(id =>
                    updateDoc(doc(db, 'assignedInterventions', id), {
                        resources: nextPoes,
                        updatedAt: Timestamp.now()
                    } as any)
                ))
                const saved = await getGroupDelivery(db, (record as DisplayIntervention).groupKeyResolved || '')
                console.error('[Allocated MOV] Group POE delete write completed', {
                    groupKey: (record as DisplayIntervention).groupKeyResolved,
                    savedEvidence: saved?.evidence?.map((resource: any) => ({ label: resource?.label, link: resource?.link })) || [],
                    targetIds
                })
            } else {
                await Promise.all(targetIds.map(id =>
                    updateDoc(doc(db, 'assignedInterventions', id), {
                        resources: nextPoes,
                        updatedAt: Timestamp.now()
                    } as any)
                ))
                // A single-SME upload still participates in the group's
                // shared evidence index. Remove the link there only when no
                // other member still has the same POE.
                const parent = baseData.find(item =>
                    item.isGroupedDisplay && item.members?.some(member => member.id === record.id)
                )
                if (parent?.groupDelivery) {
                    const otherMembers = (parent.members || []).filter(member => member.id !== record.id)
                    const otherLinks = new Set(otherMembers.flatMap(member => getPoeResourcesFromRecord(member).map(resource => canonicalUrl(resource.link))))
                    const sharedNext = (parent.groupDelivery.evidence || []).filter(resource =>
                        canonicalUrl(resource.link) !== targetUrl || otherLinks.has(canonicalUrl(resource.link))
                    )
                    await saveSharedGroupDelivery(parent, { evidence: sharedNext })
                    setManageEvidenceRecord(previous => previous && (previous as DisplayIntervention).groupKeyResolved === parent.groupKeyResolved
                        ? { ...previous, resources: sharedNext, groupDelivery: { ...((previous as DisplayIntervention).groupDelivery || {}), evidence: sharedNext } as GroupInterventionDelivery }
                        : previous)
                }
            }

            applyPoeStateLocally(record, targetIds, nextPoes)
            setManageEvidencePoePage(1)
            message.success('POE removed.')
            setReloadKey(value => value + 1)
        } catch (error) {
            console.error(error)
            message.error('Failed to remove POE.')
        } finally {
            setDeletingPoeUrl(null)
        }
    }

    const removeAllPoe = async (record: AssignedIntervention) => {
        const targetIds = await getGroupMemberIdsForEvidence(record as DisplayIntervention)
        if (!targetIds.length) {
            message.error('No linked interventions were found for this POE.')
            return
        }
        try {
            setDeletingPoeUrl('__all__')
            if ((record as DisplayIntervention).isGroupedDisplay) {
                await saveSharedGroupDelivery(record as DisplayIntervention, { evidence: [] })
            } else {
                const parent = baseData.find(item =>
                    item.isGroupedDisplay && item.members?.some(member => member.id === record.id)
                )
                if (parent?.groupDelivery) {
                    const otherMembers = (parent.members || []).filter(member => member.id !== record.id)
                    const otherLinks = new Set(otherMembers.flatMap(member => getPoeResourcesFromRecord(member).map(resource => String(resource.link))))
                    const sharedNext = (parent.groupDelivery.evidence || []).filter(resource => otherLinks.has(String(resource.link)))
                    await saveSharedGroupDelivery(parent, { evidence: sharedNext })
                    setManageEvidenceRecord(previous => previous && (previous as DisplayIntervention).groupKeyResolved === parent.groupKeyResolved
                        ? { ...previous, resources: sharedNext, groupDelivery: { ...((previous as DisplayIntervention).groupDelivery || {}), evidence: sharedNext } as GroupInterventionDelivery }
                        : previous)
                }
            }
            await Promise.all(targetIds.map(id => updateDoc(doc(db, 'assignedInterventions', id), {
                resources: [],
                updatedAt: Timestamp.now()
            } as any)))
            applyPoeStateLocally(record, targetIds, [])
            setManageEvidencePoePage(1)
            message.success('All POEs removed.')
            setReloadKey(value => value + 1)
        } catch (error) {
            console.error('[Allocated MOV] Delete all POEs failed', error)
            message.error('Failed to remove all POEs.')
        } finally {
            setDeletingPoeUrl(null)
        }
    }

    const removeManagedDocument = async (record: AssignedIntervention, documentUrl: string) => {
        if (deletingPoeUrl) return
        const current = getDocumentEvidence(record)
        const next = current.filter(resource => resource?.link !== documentUrl)
        if (next.length === current.length) {
            message.warning('That evidence is no longer present on this intervention. Refreshing the list.')
            setReloadKey(value => value + 1)
            return
        }
        const targetIds = await getGroupMemberIdsForEvidence(record as DisplayIntervention)
        if (!targetIds.length) {
            message.error('No linked intervention was found for this evidence.')
            return
        }
        try {
            setDeletingPoeUrl(documentUrl)
            if ((record as DisplayIntervention).isGroupedDisplay) {
                await saveSharedGroupDelivery(record as DisplayIntervention, { evidence: next })
            } else {
                await Promise.all(targetIds.map(id => {
                    return updateDoc(doc(db, 'assignedInterventions', id), {
                        resources: next,
                        updatedAt: Timestamp.now()
                    } as any)
                }))
            }
            const patchItem = (item: AssignedIntervention) => item.id === record.id ? {
                ...item,
                resources: next
            } : item
            setAllInterventions(previous => previous.map(patchItem))
            setActiveInterventions(previous => previous.map(patchItem))
            setCompletedInterventions(previous => previous.map(patchItem))
            setManageEvidenceRecord(previous => previous ? { ...previous, resources: next } : previous)
            setManageEvidencePoePage(1)
            message.success('Evidence removed.')
            setReloadKey(value => value + 1)
        } catch (error) {
            console.error(error)
            message.error('Failed to remove evidence.')
        } finally {
            setDeletingPoeUrl(null)
        }
    }

    const showEvidenceValidationError = ({ errorFields }: any) => {
        message.warning(errorFields?.[0]?.errors?.[0] || 'Check the required completion fields.')
    }

    const submitAllocatedCompletion = async (values: any = {}) => {
        if (evidenceSubmissionRef.current) return
        if (!completionContext || !progressRecord) {
            message.error('Reopen completion to load the selected assignments.')
            return
        }

        const selectedExistingPoes = completionProgressEvidence.filter(resource =>
            selectedProgressPoeUrls.includes(resource.link)
        )
        const poeFiles: File[] = completionPoeFiles
            .map(file => file?.originFileObj || file)
            .filter(Boolean)

        const selectedMovFiles = completionMovAssignments
            .map(assignment => ({
                assignment,
                file: completionMovFilesByAssignment[assignment.id]?.originFileObj ||
                    completionMovFilesByAssignment[assignment.id] ||
                    null
            }))

        const missingMovs = selectedMovFiles.filter(item => !item.file)
        const hasAnyPoe = Boolean(
            completionCurrentPoes.length ||
            selectedExistingPoes.length ||
            poeFiles.length
        )

        // Answer on the step that needs fixing, the way the progress step does.
        // A toast in the corner is easy to miss when the modal has just jumped
        // the person to a different step.
        if (!hasAnyPoe) {
            setCompletionStepError('Add or select at least one POE before completing the intervention.')
            setProgressModalStep(2)
            return
        }
        if (missingMovs.length) {
            setCompletionStepError(
                progressRecord.isGroupedDisplay
                    ? `${missingMovs.length} SME${missingMovs.length === 1 ? '' : 's'} who received the intervention still ${missingMovs.length === 1 ? 'needs' : 'need'} an MOV.`
                    : 'Add the completed MOV before finishing the intervention.'
            )
            setProgressModalStep(3)
            return
        }
        if ([...poeFiles, ...selectedMovFiles.map(item => item.file as File)].some(file =>
            file && file.size > COMPLETION_MAX_FILE_SIZE_BYTES
        )) {
            setCompletionStepError('Each POE and MOV file must be 25 MB or smaller.')
            return
        }
        setCompletionStepError(null)

        evidenceSubmissionRef.current = true
        setSavingEvidence(true)
        try {
            const assignmentIds = completionContext.assignments.map(row => row.id)
            const selectedAsResources: Resource[] = selectedExistingPoes.map(resource => ({
                type: 'poe',
                label: resource.name,
                originalName: resource.name,
                link: resource.link
            }))

            const uploadBase = (progressRecord.members?.[0] || progressRecord) as AssignedIntervention
            const uploadedNewPoes = poeFiles.length
                ? await uploadEvidenceFiles(poeFiles.slice(0, 10), uploadBase, 'poe')
                : []

            // POE belongs to the delivery. Existing POE, progress evidence explicitly
            // promoted by the facilitator, and any new completion upload are merged
            // into one shared canonical list before any MOV is created.
            const finalPoes = normalizePoeResources([
                ...completionCurrentPoes,
                ...selectedAsResources,
                ...uploadedNewPoes.map(file => ({
                    type: 'poe',
                    label: file.label,
                    originalName: (file as any).originalName || file.label,
                    link: file.link
                }))
            ])

            if (progressRecord.isGroupedDisplay) {
                await saveSharedGroupDelivery(progressRecord, { evidence: finalPoes })
                await Promise.all(assignmentIds.map(id =>
                    updateDoc(doc(db, 'assignedInterventions', id), {
                        resources: finalPoes,
                        updatedAt: Timestamp.now()
                    } as any)
                ))
            } else {
                await Promise.all(assignmentIds.map(id =>
                    updateDoc(doc(db, 'assignedInterventions', id), {
                        resources: finalPoes,
                        updatedAt: Timestamp.now()
                    } as any)
                ))
            }

            const safePathPart = (value: unknown, fallback: string) =>
                String(value || fallback).trim().replace(/[\\/#?%]+/g, '_') || fallback

            // The client still requires a manually completed MOV. Upload one file
            // per eligible SME, but never put it into assignedInterventions.resources;
            // that collection remains POE-only from this workflow onward.
            const uploadedManualMovs = await Promise.all(
                selectedMovFiles.map(async ({ assignment, file }) => {
                    const manualMov = file as File
                    const safeProgram = safePathPart(assignment.programId || activeProgramId, 'no-program')
                    const safeParticipant = safePathPart(assignment.participantId, 'unknown-participant')
                    const safeAssignment = safePathPart(assignment.id, 'no-assignment')
                    const safeFileName = safePathPart(manualMov.name, 'manual-mov')
                    const storagePath = `mov-documents/${safeProgram}/${safeParticipant}/${safeAssignment}/manual/${Date.now()}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}_${safeFileName}`
                    const fileRef = ref(storage, storagePath)
                    await uploadBytes(fileRef, manualMov)

                    return {
                        assignmentId: assignment.id,
                        participantId: assignment.participantId || null,
                        uploadedMovUrl: await getDownloadURL(fileRef),
                        uploadedMovFileName: manualMov.name,
                        uploadedMovContentType: manualMov.type || null,
                        uploadedMovSize: manualMov.size
                    }
                })
            )

            // No generated MOV file is stored. completeIntervention creates the
            // normal movDocuments data records used by the on-demand MOV view and
            // download renderer. All POE is already on the assignments, so no file
            // needs to be uploaded again by the completion service.
            const progressLinks = new Set(selectedAsResources.map(resource => resource.link))
            const completionUploadLinks = new Set(uploadedNewPoes.map(resource => resource.link))
            const poeEvidence = finalPoes.map(resource => ({
                type: 'poe',
                label: resource.label || resource.originalName || 'POE',
                originalName: resource.originalName || resource.label || null,
                link: resource.link,
                source: completionUploadLinks.has(resource.link)
                    ? 'completion-upload'
                    : progressLinks.has(resource.link)
                        ? 'progress-update'
                        : 'existing'
            }))

            // One transaction. The MOV metadata is written alongside the
            // completion itself, so a failure can no longer leave the
            // intervention completed with MOVs that have no file.
            await completeIntervention({
                db,
                storage,
                user: {
                    uid: effectiveUser?.uid,
                    name: effectiveUser?.name,
                    email: effectiveUser?.email,
                    departmentName: effectiveUser?.departmentName
                },
                assignmentIds,
                files: [],
                notes: values.notes,
                recurrencePreset: values.recurrencePreset,
                deliveryMethod: completionDeliveryValue,
                // Only SMEs who received the intervention get an MOV raised.
                movAssignmentIds: completionMovAssignments.map(row => row.id),
                manualMovs: uploadedManualMovs,
                poeEvidence
            })

            message.success(COMPLETION_SUCCESS_MESSAGE)

            setCompletionContext(null)
            setCompletionFailureMessage('')
            setProgressModalOpen(false)
            setProgressModalStep(0)
            setProgressRecord(null)
            setManageEvidenceRecord(null)
            setCompletionDeliveryMethod('')
            setSelectedProgressPoeUrls([])
            setCompletionPoeFiles([])
            setCompletionMovFilesByAssignment({})

            completionEvidenceForm.resetFields()
            setReloadKey(value => value + 1)
        } catch (error) {
            console.error('[Allocated intervention completion] Completion failed', error)
            const errorMessage = interventionCompletionError(error)
            setCompletionFailureMessage(errorMessage)
            setCompletionContext(previous => mergeCompletionFailureContext(previous, error))
            message.error({ content: errorMessage, duration: 8 })
            if (completionFailureEvidence(error).length) {
                void loadInterventionCompletionContext(
                    db,
                    completionContext.assignments.map(row => row.id)
                ).then(setCompletionContext).catch(refreshError => {
                    console.error('[Allocated intervention completion] Could not refresh retained evidence', refreshError)
                })
            }
        } finally {
            evidenceSubmissionRef.current = false
            setSavingEvidence(false)
        }
    }

    const submitManageEvidence = async (values: any) => {
        if (evidenceSubmissionRef.current) return
        if (!manageEvidenceRecord) {
            message.error('No intervention selected. Close this dialog and select the intervention again.')
            return
        }

        const sensitive = (manageEvidenceRecord as any).isSensitive === true &&
            USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE
        const mode: 'file' | 'summary' | 'both' = sensitive
            ? values.evidenceMode || evidenceMode
            : 'file'

        const fileList = Array.isArray(values.files) ? values.files : []
        const files: File[] = fileList
            .map((f: any) => f?.originFileObj || f)
            .filter(Boolean)
        // An explicitly empty Upload list means the user removed the files.
        // Only the separate native-picker flow may use its pending file list.
        const effectiveFiles = Array.isArray(values.files) ? files : pendingEvidenceFiles

        const notes = String(values.notes || '').trim()
        const documentTarget = isDocumentTarget(manageEvidenceRecord)
        const replaceTarget = String(values.replaceTarget || '')
        const existingEvidence = (documentTarget
            ? getDocumentEvidence(manageEvidenceRecord)
            : getPoeResourcesFromRecord(manageEvidenceRecord))
            .filter(resource => replaceTarget !== 'all' && resource.link !== replaceTarget)
        const groupedRecord = manageEvidenceRecord as DisplayIntervention
        const isGroupedPoe = groupedRecord.isGroupedDisplay && !documentTarget
        const isSingleGroupUpload = isGroupedPoe && groupEvidenceMode === 'single'
        const selectedGroupMember = isSingleGroupUpload
            ? (groupedRecord.members || []).find(member => member.id === groupEvidenceMemberId)
            : null

        if (isSingleGroupUpload && !selectedGroupMember) {
            message.warning('Select the SME who this POE belongs to.')
            return
        }

        if (documentTarget && !effectiveFiles.length && !existingEvidence.length) {
            message.warning('Please select at least one document.')
            return
        }

        if (!documentTarget && (mode === 'file' || mode === 'both') && !effectiveFiles.length) {
            message.warning('Please select at least one file.')
            return
        }

        if (!documentTarget && (mode === 'summary' || mode === 'both') && !notes) {
            message.warning('Please enter a summary.')
            return
        }

        try {
            evidenceSubmissionRef.current = true
            setSavingEvidence(true)
            const targetIds = await getGroupMemberIdsForEvidence(
                manageEvidenceRecord as DisplayIntervention
            )
            if (!targetIds.length) {
                message.error('No linked interventions were found for this session.')
                return
            }

            if ((manageEvidenceRecord as DisplayIntervention).isGroupedDisplay) {
                const uploaded = effectiveFiles.length
                    ? await uploadEvidenceFiles(
                        effectiveFiles.slice(0, 10),
                        selectedGroupMember || manageEvidenceRecord,
                        documentTarget ? 'documents' : 'poe'
                    )
                    : []
                const currentEvidence: Resource[] = groupedRecord.groupDelivery
                    ? (Array.isArray(groupedRecord.groupDelivery.evidence)
                        ? groupedRecord.groupDelivery.evidence as Resource[]
                        : [])
                    : (manageEvidenceRecord.resources || [])
                const retainedEvidence = currentEvidence.filter(resource =>
                    !replaceTarget
                        ? true
                        : replaceTarget === 'all'
                            ? false
                            : resource.link !== replaceTarget
                )
                const nextEvidence = normalizePoeResources(
                    [...retainedEvidence, ...uploaded].filter(resource => resource?.link)
                )
                if (isSingleGroupUpload && selectedGroupMember) {
                    const memberCurrent = getPoeResourcesFromRecord(selectedGroupMember)
                    const memberNext = normalizePoeResources(
                        [...memberCurrent.filter(resource =>
                            !replaceTarget
                                ? true
                                : replaceTarget === 'all'
                                    ? false
                                    : resource.link !== replaceTarget
                        ), ...uploaded]
                    )
                    await updateDoc(doc(db, 'assignedInterventions', selectedGroupMember.id), {
                        resources: memberNext,
                        updatedAt: Timestamp.now()
                    } as any)
                } else {
                    // Bulk upload intentionally applies the same POE list to
                    // every SME in the group.
                    await Promise.all(targetIds.map(id =>
                        updateDoc(doc(db, 'assignedInterventions', id), {
                            resources: nextEvidence,
                            updatedAt: Timestamp.now()
                        } as any)
                    ))
                }
                const sharedUpdate = {
                    type: mode === 'summary' ? 'assignee-summary' : isSingleGroupUpload ? 'evidence-uploaded-single' : 'evidence-uploaded',
                    ...(notes ? { note: notes } : {}),
                    by: auth.currentUser?.uid || null,
                    createdAt: Timestamp.now(),
                    resources: uploaded,
                    ...(selectedGroupMember ? { participantId: selectedGroupMember.participantId, participantName: selectedGroupMember.participantName || selectedGroupMember.beneficiaryName } : {})
                }
                await saveSharedGroupDelivery(manageEvidenceRecord as DisplayIntervention, {
                    progress: groupedRecord.progressResolved ?? 0,
                    deliveryStatus: undefined,
                    evidence: nextEvidence,
                    progressUpdates: [
                        ...(groupedRecord.groupDelivery?.progressUpdates || []),
                        sharedUpdate
                    ]
                })
            } else if (documentTarget) {
                const uploadedDocs = await uploadEvidenceFiles(effectiveFiles, manageEvidenceRecord, 'documents')
                const currentDocs = getDocumentEvidence(manageEvidenceRecord)
                    .filter(resource =>
                        !replaceTarget
                            ? true
                            : replaceTarget === 'all'
                                ? false
                                : resource.link !== replaceTarget
                    )
                const nextDocs = Array.from(new Map(
                    [...currentDocs, ...uploadedDocs].map(resource => [resource.link, resource])
                ).values())

                await Promise.all(
                    targetIds.map(id =>
                        updateDoc(doc(db, 'assignedInterventions', id), {
                            resources: nextDocs,
                            updatedAt: Timestamp.now()
                        } as any)
                    )
                )

                setCompletedInterventions(prev =>
                    prev.map(item =>
                        item.id === manageEvidenceRecord.id
                            ? {
                                ...item,
                                resources: nextDocs
                            }
                            : item
                    )
                )
            }
            else {
                if (mode === 'summary') {
                    await Promise.all(
                        targetIds.map(id =>
                            updateDoc(doc(db, 'assignedInterventions', id), {
                                progressUpdates: arrayUnion({
                                    type: 'assignee-summary',
                                    note: notes,
                                    by: auth.currentUser?.uid || null,
                                    createdAt: Timestamp.now()
                                }),
                                updatedAt: Timestamp.now()
                            } as any)
                        )
                    )

                    setCompletedInterventions(prev =>
                        prev.map(item =>
                            item.id === manageEvidenceRecord.id
                                ? {
                                    ...item,
                                }
                                : item
                        )
                    )
                } else {
                    const uploadedPoes = await uploadEvidenceFiles(
                        effectiveFiles.slice(0, 10),
                        manageEvidenceRecord,
                        'poe'
                    )

                    const existingPoes = getPoeResourcesFromRecord(manageEvidenceRecord)
                        .filter(resource =>
                            !replaceTarget
                                ? true
                                : replaceTarget === 'all'
                                    ? false
                                    : resource.link !== replaceTarget
                        )

                    const nextPoes = normalizePoeResources([
                        ...existingPoes,
                        ...uploadedPoes.map(file => ({
                            type: 'poe',
                            label: file.label,
                            originalName: (file as any).originalName || file.label,
                            link: file.link,
                        }))
                    ])

                    await Promise.all(
                        targetIds.map(id =>
                            updateDoc(doc(db, 'assignedInterventions', id), {
                                resources: nextPoes,
                                progressUpdates: arrayUnion({
                                    type: 'evidence-uploaded',
                                    by: auth.currentUser?.uid || null,
                                    createdAt: Timestamp.now()
                                }),
                                updatedAt: Timestamp.now()
                            } as any)
                        )
                    )

                    applyPoeStateLocally(
                        manageEvidenceRecord,
                        targetIds,
                        nextPoes
                    )
                }
            }

            message.success('Evidence updated successfully.')

            setManageEvidenceOpen(false)
            setManageEvidenceRecord(null)
            setPendingEvidenceFiles([])
            manageEvidenceForm.resetFields()
            completionEvidenceForm.resetFields()

            setReloadKey(prev => prev + 1)
        } catch (err) {
            console.error(err)
            message.error('Failed to update evidence. Your selected files have been kept; please try again.')
        } finally {
            evidenceSubmissionRef.current = false
            setSavingEvidence(false)
        }
    }

    const renderProgress = (record: DisplayIntervention) => {
        const percent = record.progressResolved ?? getProgressPercent(record)
        return (
            <Space direction="vertical" size={4} style={{ width: 120 }}>
                <Progress percent={percent} size="small" />
            </Space>
        )
    }

    // A compact stat, used across the session plan strip.
    const sessionStat = (
        icon: React.ReactNode,
        label: string,
        value: React.ReactNode,
        tone?: 'default' | 'danger'
    ) => (
        <Space size={10} align="start">
            <span
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    flex: '0 0 30px',
                    background: isDark ? 'rgba(255,255,255,0.06)' : '#f3f6fb'
                }}
            >
                {icon}
            </span>
            <Space direction="vertical" size={0}>
                <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {label}
                </Text>
                <Text strong={tone !== 'danger'} type={tone === 'danger' ? 'danger' : undefined}>
                    {value}
                </Text>
            </Space>
        </Space>
    )

    const deliveryMethodIcon = (method: string) =>
        normalizeCompletionDeliveryMethod(method).value === 'online'
            ? <VideoCameraOutlined />
            : <EnvironmentOutlined />

    const renderSessionsPanel = (record: DisplayIntervention) => {
        const members = record.members || []
        const scheduled = detailsSessionRows.length
        const held = detailsSessionRows.filter(row => row.held === true).length
        const isClosed = isClosedToNewSessions(record)

        // plannedSessions is genuinely unset on older allocations. Say so
        // instead of showing the fallback of 1 as though it were the plan.
        const plannedIsSet = (record.members || [record]).some(
            member => Number(member.plannedSessions) > 0
        )
        const planned = getGroupPlannedSessions(record)
        const unscheduled = plannedIsSet ? Math.max(0, planned - scheduled) : 0

        const received = members.filter(hasReceivedIntervention).length
        // How many of the group even have an appointment. A group of 25 with a
        // single booked SME is the important fact, and it is invisible if you
        // only ever show attendance per session.
        const bookedMemberIds = new Set(
            detailsSessionRows.flatMap(row => row.memberIds as string[])
        )
        const unbooked = record.isGroupedDisplay
            ? members.filter(member => !bookedMemberIds.has(member.id)).length
            : 0

        return (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Card
                    size="small"
                    title={<Space size={8}><CalendarOutlined />Session plan</Space>}
                    style={{ borderRadius: 12 }}
                >
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Row gutter={[16, 14]}>
                            <Col xs={12} md={6}>
                                {sessionStat(
                                    <FileProtectOutlined style={{ color: '#722ed1' }} />,
                                    'Planned',
                                    plannedIsSet ? `${planned} session${planned === 1 ? '' : 's'}` : 'Not set'
                                )}
                            </Col>
                            <Col xs={12} md={6}>
                                {sessionStat(
                                    <CalendarOutlined style={{ color: '#1677ff' }} />,
                                    isClosed ? 'Booked' : 'Scheduled',
                                    `${scheduled} session${scheduled === 1 ? '' : 's'}`
                                )}
                            </Col>
                            <Col xs={12} md={6}>
                                {sessionStat(
                                    <CheckCircleOutlined style={{ color: held ? '#52c41a' : '#8c8c8c' }} />,
                                    'Held',
                                    `${held} of ${scheduled}`
                                )}
                            </Col>
                            <Col xs={12} md={6}>
                                {record.isGroupedDisplay
                                    ? sessionStat(
                                        <TeamOutlined style={{ color: received ? '#52c41a' : '#cf1322' }} />,
                                        'Received',
                                        `${received} of ${members.length} SMEs`,
                                        received ? 'default' : 'danger'
                                    )
                                    : sessionStat(
                                        <TeamOutlined style={{ color: '#1677ff' }} />,
                                        'Attended',
                                        `${getAttendedSessions(record)} session${getAttendedSessions(record) === 1 ? '' : 's'}`
                                    )}
                            </Col>
                        </Row>

                        {(unbooked > 0 || unscheduled > 0 || scheduled > planned || detailsSessionsScoped.excluded > 0) ? (
                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                {unbooked > 0 ? (
                                    <Text type="danger" style={{ fontSize: 12 }}>
                                        {unbooked} of {members.length} SMEs have no appointment linked to this
                                        intervention at all, so they could not attend anything.
                                    </Text>
                                ) : null}
                                {unscheduled > 0 ? (
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        {isClosed
                                            ? `Delivered in ${scheduled} of the ${planned} planned sessions. No further sessions can be booked.`
                                            : `${unscheduled} planned session${unscheduled === 1 ? ' has' : 's have'} not been booked as an appointment yet.`}
                                    </Text>
                                ) : null}
                                {plannedIsSet && scheduled > planned ? (
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        Delivered in {scheduled} sessions; {planned} {planned === 1 ? 'was' : 'were'} planned.
                                    </Text>
                                ) : null}
                                {detailsSessionsScoped.excluded > 0 ? (
                                    <Text type="warning" style={{ fontSize: 12 }}>
                                        {detailsSessionsScoped.excluded} linked appointment
                                        {detailsSessionsScoped.excluded === 1 ? '' : 's'} from an earlier cycle
                                        {detailsSessionsScoped.excluded === 1 ? ' is' : ' are'} not shown.
                                    </Text>
                                ) : null}
                            </Space>
                        ) : null}
                    </Space>
                </Card>

                <Card
                    size="small"
                    title={<Space size={8}><ClockCircleOutlined />Sessions ({scheduled})</Space>}
                    style={{ borderRadius: 12 }}
                    styles={{ body: { padding: detailsSessionRows.length ? 0 : 16 } }}
                >
                    {detailsSessionsLoading ? (
                        <Skeleton active paragraph={{ rows: 3 }} />
                    ) : !detailsSessionRows.length ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No appointments are linked to this intervention yet."
                        />
                    ) : (
                        <Collapse
                            ghost
                            accordion
                            items={detailsSessionRows.map((row, index) => {
                                const start = toJsDate(row.startAt)
                                const end = toJsDate(row.endAt)
                                const method = normalizeCompletionDeliveryMethod(row.deliveryMethod)
                                const attended = row.attendedNames.length

                                return {
                                    key: row.key,
                                    label: (
                                        <Space wrap size={[10, 4]} style={{ width: '100%' }}>
                                            <Tag
                                                color="blue"
                                                style={{ marginInlineEnd: 0, borderRadius: 10, fontWeight: 600 }}
                                            >
                                                {index + 1}
                                            </Tag>
                                            <Space size={6}>
                                                <CalendarOutlined style={{ color: '#8c8c8c' }} />
                                                <Text strong>
                                                    {start ? dayjs(start).format('DD MMM YYYY') : 'Date not set'}
                                                </Text>
                                            </Space>
                                            {start ? (
                                                <Space size={6}>
                                                    <ClockCircleOutlined style={{ color: '#8c8c8c' }} />
                                                    <Text type="secondary">
                                                        {dayjs(start).format('HH:mm')}
                                                        {end ? ` - ${dayjs(end).format('HH:mm')}` : ''}
                                                    </Text>
                                                </Space>
                                            ) : null}
                                            {row.held === true ? (
                                                <Tag color="green" icon={<CheckCircleOutlined />} style={{ marginInlineEnd: 0 }}>Held</Tag>
                                            ) : row.held === false ? (
                                                <Tag color="red" icon={<CloseOutlined />} style={{ marginInlineEnd: 0 }}>Not held</Tag>
                                            ) : (
                                                <Tag color="default" style={{ marginInlineEnd: 0 }}>Not recorded</Tag>
                                            )}
                                            <Tag
                                                color={attended ? 'green' : 'default'}
                                                icon={<TeamOutlined />}
                                                style={{ marginInlineEnd: 0 }}
                                            >
                                                {record.isGroupedDisplay
                                                    ? `${attended} of ${row.invited} from this group`
                                                    : attended ? 'Attended' : 'Did not attend'}
                                            </Tag>
                                            {/*
                                              The session is shared. Without its
                                              own total this page reads "2" while
                                              the appointments page reads "24"
                                              for the same session.
                                            */}
                                            {row.sessionInvited > row.invited ? (
                                                <Tooltip title="This session also covers SMEs allocated under other interventions. The appointments page shows this larger figure.">
                                                    <Tag style={{ marginInlineEnd: 0 }}>
                                                        {row.sessionAttended} of {row.sessionInvited} on the whole session
                                                    </Tag>
                                                </Tooltip>
                                            ) : null}
                                        </Space>
                                    ),
                                    children: (
                                        <Space direction="vertical" size={10} style={{ width: '100%', paddingLeft: 4 }}>
                                            <Space wrap size={[16, 8]}>
                                                {method.label ? (
                                                    <Space size={6}>
                                                        {deliveryMethodIcon(row.deliveryMethod)}
                                                        <Text type="secondary">{method.label}</Text>
                                                    </Space>
                                                ) : null}
                                                {row.location ? (
                                                    <Space size={6}>
                                                        <EnvironmentOutlined style={{ color: '#8c8c8c' }} />
                                                        <Text type="secondary">{row.location}</Text>
                                                    </Space>
                                                ) : null}
                                            </Space>

                                            {row.title ? (
                                                <Text type="secondary">{row.title}</Text>
                                            ) : null}

                                            {row.sessionInvited > row.invited ? (
                                                <Alert
                                                    type="info"
                                                    showIcon
                                                    message={
                                                        <Text style={{ fontSize: 12 }}>
                                                            {row.sessionInvited} SMEs were invited to this session in
                                                            total; {row.invited} of them {row.invited === 1 ? 'is' : 'are'} on
                                                            this intervention. The rest attend under a different
                                                            allocation, which is why the appointments page shows a
                                                            larger number for the same session.
                                                        </Text>
                                                    }
                                                />
                                            ) : null}

                                            {row.attendedNames.length ? (
                                                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        Attended ({row.attendedNames.length})
                                                    </Text>
                                                    <Space wrap size={[6, 6]}>
                                                        {row.attendedNames.map((attendee: string) => (
                                                            <Tag key={attendee} color="green" style={{ marginInlineEnd: 0 }}>
                                                                {attendee}
                                                            </Tag>
                                                        ))}
                                                    </Space>
                                                </Space>
                                            ) : null}

                                            {row.absentNames.length ? (
                                                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        Absent ({row.absentNames.length})
                                                    </Text>
                                                    <Space wrap size={[6, 6]}>
                                                        {row.absentNames.map((absentee: string) => (
                                                            <Tag key={absentee} color="red" style={{ marginInlineEnd: 0 }}>
                                                                {absentee}
                                                            </Tag>
                                                        ))}
                                                    </Space>
                                                </Space>
                                            ) : null}
                                        </Space>
                                    )
                                }
                            })}
                        />
                    )}
                </Card>
            </Space>
        )
    }

    const renderDetailsDescriptions = (record: DisplayIntervention) => {
        const assignedAt = record.assignedAtResolved ?? getAssignedAt(record)

        const groupedMembers = record.members || []
        // One delivery, one status. Only members who attended can be confirmed,
        // so the confirmation summary is counted over those members alone.
        const groupProgress = getGroupProgress(record)
        const groupDelivered = groupProgress >= 100
        const groupedReceived = groupedMembers.filter(hasReceivedIntervention)
        const groupedNotReceived = groupedMembers.length - groupedReceived.length

        const groupedSmeConfirmed = groupedReceived.filter(m => {
            const c = getSmeCompletion(m)
            return c === 'confirmed' || c === 'done'
        }).length

        const groupedSmeRejected = groupedReceived.filter(
            m => getSmeCompletion(m) === 'rejected'
        ).length

        const groupedSmePendingConfirmation = groupedReceived.filter(m => {
            const c = getSmeCompletion(m)
            return c !== 'confirmed' && c !== 'done' && c !== 'rejected'
        }).length

        const showGroupedConfirmationSummary = groupDelivered && groupedReceived.length > 0

        return (
            <Descriptions
                bordered
                size="small"
                column={record.isGroupedDisplay ? 1 : (screens.xl ? 2 : 1)}
            >
                {/*
                  Title, status, progress and the headline dates are in the
                  summary strip above. Repeat only what the strip cannot show:
                  exact times, the assignee, and the delivery breakdown.
                */}
                <Descriptions.Item label="Assignee">
                    {record.assigneeName || '-'}
                </Descriptions.Item>

                <Descriptions.Item label="Assigned At">
                    {formatDateTime(assignedAt)}
                </Descriptions.Item>

                {record.lifecycleBucket === 'completed' ? (
                    <Descriptions.Item label="Completed At">
                        {formatDateTime(record.completedAtResolved || assignmentCompletedDate(record))}
                    </Descriptions.Item>
                ) : (
                    <Descriptions.Item label="Due Date">
                        {formatDate(record.dueDate)}
                    </Descriptions.Item>
                )}

                {record.isGroupedDisplay ? (
                    <>
                        <Descriptions.Item label="Delivery Status">
                            <Space direction="vertical" size={4}>
                                <Tag color={groupDelivered ? 'blue' : groupProgress > 0 ? 'geekblue' : 'default'}>
                                    {groupDelivered
                                        ? 'Delivered'
                                        : groupProgress > 0
                                            ? `In delivery - ${groupProgress}%`
                                            : 'Not started'}
                                </Tag>
                                <Text type="secondary">
                                    This intervention is delivered once to the whole group, so
                                    delivery progress is the same for every member.
                                </Text>
                            </Space>
                        </Descriptions.Item>

                        {groupDelivered ? (
                            <Descriptions.Item label="Attendance">
                                <Space direction="vertical" size={4}>
                                    <Space wrap>
                                        <Tag color="green">Received: {groupedReceived.length}</Tag>
                                        {groupedNotReceived > 0 ? (
                                            <Tag color="red">Did not attend: {groupedNotReceived}</Tag>
                                        ) : null}
                                    </Space>
                                    {groupedNotReceived > 0 ? (
                                        <Text type="secondary">
                                            Members who attended no appointments did not receive this
                                            intervention and cannot be issued a MOV.
                                        </Text>
                                    ) : null}
                                </Space>
                            </Descriptions.Item>
                        ) : null}

                        <Descriptions.Item label="Completion Confirmation">
                            {showGroupedConfirmationSummary ? (
                                <Space wrap>
                                    <Tag color="green">Confirmed: {groupedSmeConfirmed}</Tag>
                                    {groupedSmeRejected > 0 ? (
                                        <Tag color="red">Rejected: {groupedSmeRejected}</Tag>
                                    ) : null}
                                    <Tag color="default">Pending: {groupedSmePendingConfirmation}</Tag>
                                </Space>
                            ) : (
                                <Text type="secondary">
                                    {groupDelivered
                                        ? 'No member attended, so there is nothing to confirm.'
                                        : 'Available once delivery reaches 100%'}
                                </Text>
                            )}
                        </Descriptions.Item>
                    </>
                ) : (
                    <>
                        <Descriptions.Item label="Delivery Status">
                            <Tag color={getFacilitatorCompletion(record) === 'done' ? 'blue' : 'default'}>
                                {getFacilitatorCompletion(record) === 'done' ? 'Completed' : 'Pending'}
                            </Tag>
                        </Descriptions.Item>

                        <Descriptions.Item label="Completion Confirmation">
                            {renderCompletionConfirmation(record)}
                        </Descriptions.Item>
                    </>
                )}
            </Descriptions>
        )
    }

    // Members never carry their own delivery progress - the group has one.
    // The only per-member facts worth showing are attendance (did this SME
    // actually receive the intervention?) and their own completion
    // confirmation, and neither is meaningful until delivery reaches 100%.
    const renderGroupedMembers = (record: DisplayIntervention) => {
        const groupDelivered = getGroupProgress(record) >= 100
        // Attendance is out of the sessions that actually ran, not out of the
        // original plan. Delivering two sessions against a plan of one made
        // members read "attended 0 of 1" when there had been two to attend.
        const sessionsRun =
            detailsSessionRows.filter(row => row.held === true).length ||
            detailsSessionRows.length ||
            getGroupPlannedSessions(record)

        return (
            <Card
                size="small"
                title={<Space><AppstoreOutlined />Members ({record.memberCount || record.members?.length || 0})</Space>}
                style={{ borderRadius: 12 }}
            >
                <List
                    size="small"
                    dataSource={record.members || []}
                    pagination={{ pageSize: 6, hideOnSinglePage: true, showSizeChanger: false, position: 'bottom', align: 'center' }}
                    renderItem={(member) => {
                        const received = hasReceivedIntervention(member)
                        const attended = getAttendedSessions(member)
                        const completion = getSmeCompletion(member)
                        const confirmed = completion === 'confirmed' || completion === 'done'
                        const rejected = completion === 'rejected'
                        const feedback = getCompletionFeedback(member)
                        return (
                            <List.Item>
                                <Space direction="vertical" size={5} style={{ width: '100%' }}>
                                    <Text strong>{member.participantName || member.beneficiaryName || member.participantId || '-'}</Text>

                                    {!groupDelivered ? (
                                        <Text type="secondary">
                                            Attendance and confirmation are shown once the group delivery
                                            reaches 100%.
                                        </Text>
                                    ) : !received ? (
                                        <Space direction="vertical" size={4}>
                                            <Tag color="red">Did not attend</Tag>
                                            <Text type="secondary">
                                                Attended none of the {sessionsRun} session{sessionsRun === 1 ? '' : 's'} that
                                                ran, so this SME has not received the intervention and no MOV can be issued.
                                            </Text>
                                        </Space>
                                    ) : (
                                        <Space direction="vertical" size={4}>
                                            <Space wrap size={[6, 4]}>
                                                <Tag color="green">
                                                    Received - {formatAttendance(attended, sessionsRun)}
                                                </Tag>
                                                <Text type="secondary">Completion Confirmation:</Text>
                                                <Tag color={confirmed ? 'green' : rejected ? 'red' : 'gold'}>
                                                    {confirmed ? 'Confirmed' : rejected ? 'Rejected' : 'Pending'}
                                                </Tag>
                                            </Space>
                                            {confirmed ? (
                                                <Text type="secondary">
                                                    Feedback: {feedback.rating > 0 || feedback.comments
                                                        ? `${feedback.rating > 0 ? `${feedback.rating}/5` : ''}${feedback.rating > 0 && feedback.comments ? ' - ' : ''}${feedback.comments}`
                                                        : 'No feedback provided'}
                                                </Text>
                                            ) : rejected ? (
                                                <Text type="danger">Reason: {getCompletionRejectionReason(member) || 'No reason provided'}</Text>
                                            ) : null}
                                        </Space>
                                    )}
                                </Space>
                            </List.Item>
                        )
                    }}
                />
            </Card>
        )
    }

    const getRecordDisplayName = (record: DisplayIntervention) => {
        if (record.isGroupedDisplay) {
            return record.interventionTitle || 'grouped_intervention'
        }

        return (
            record.participantName ||
            record.beneficiaryName ||
            'sme'
        )
    }

    const getSmeSignatureUrl = (record: AssignedIntervention): string | null => {
        const anyRecord = record as any

        const candidates = [
            record.beneficiarySignatureUrl,
            record.smeSignatureUrl,
            record.smmeSignatureUrl,
            record.participantSignatureUrl,
            record.signerSignatureUrl,
            record.signatureUrl,
            anyRecord?.feedback?.beneficiarySignatureUrl,
            anyRecord?.feedback?.smeSignatureUrl,
            anyRecord?.feedback?.smmeSignatureUrl,
            anyRecord?.feedback?.participantSignatureUrl,
            anyRecord?.feedback?.signerSignatureUrl,
            anyRecord?.feedback?.signatureUrl,
            anyRecord?.completionFeedback?.beneficiarySignatureUrl,
            anyRecord?.completionFeedback?.smeSignatureUrl,
            anyRecord?.completionFeedback?.smmeSignatureUrl,
            anyRecord?.completionFeedback?.participantSignatureUrl,
            anyRecord?.completionFeedback?.signerSignatureUrl,
            anyRecord?.completionFeedback?.signatureUrl
        ]

        const found = candidates
            .map(value => String(value || '').trim())
            .find(value => value.startsWith('http'))

        return found || null
    }

    const buildRegisterSmeSignatures = (record: DisplayIntervention): RegisterSmeSignature[] => {
        const sourceRows = record.isGroupedDisplay ? record.members || [] : [record]
        const byParticipant = new Map<string, RegisterSmeSignature>()

        sourceRows.forEach(member => {
            const participantId = String(member.participantId || '').trim()
            if (!participantId) return

            const participantName = String(
                member.participantName ||
                member.beneficiaryName ||
                participantId
            ).trim()

            const signatureUrl = getSmeSignatureUrl(member)

            byParticipant.set(participantId, {
                participantId,
                participantName,
                signatureUrl
            })
        })

        return Array.from(byParticipant.values())
    }

    const buildRegisterFileName = (
        record: DisplayIntervention,
        startDate: string,
        endDate: string
    ) => {
        const rawBase = record.isGroupedDisplay
            ? record.interventionTitle || 'grouped_intervention'
            : `${record.participantName || record.beneficiaryName || 'sme'}_${record.interventionTitle || 'intervention'}`

        const safeBase = rawBase
            .toLowerCase()
            .replace(/[^a-z0-9]+/gi, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80)

        return `attendance_register_${safeBase || 'export'}_${startDate}_to_${endDate}.xlsx`
    }

    const generateRegisterForRecord = async (record: DisplayIntervention) => {
        try {
            setGeneratingRegisterId(record.id)

            const assignedDate = toJsDate(record.assignedAtResolved ?? getAssignedAt(record))
            const memberAssignedDates = (record.members || [])
                .map(member => toJsDate(getAssignedAt(member)))
                .filter(Boolean) as Date[]

            const earliestMemberAssigned =
                memberAssignedDates.length > 0
                    ? new Date(Math.min(...memberAssignedDates.map(d => d.getTime())))
                    : null

            const startDate = dayjs(
                assignedDate || earliestMemberAssigned || '2000-01-01'
            ).format('YYYY-MM-DD')

            const endDate = dayjs().endOf('day').format('YYYY-MM-DD')

            if (record.isGroupedDisplay) {
                const participantIds = Array.from(
                    new Set(
                        (record.members || [])
                            .map(member => String(member.participantId || '').trim())
                            .filter(Boolean)
                    )
                )

                if (!record.interventionId) {
                    message.error('This grouped session is missing intervention information.')
                    return
                }

                if (!participantIds.length) {
                    message.error('This grouped session has no linked beneficiaries.')
                    return
                }

                await generateAttendanceRegister({
                    db,
                    mode: 'intervention',
                    interventionId: record.interventionId,
                    participantIds,
                    startDate,
                    endDate,
                    programId: activeProgramId || record.programId || undefined,
                    fileName: buildRegisterFileName(record, startDate, endDate),
                    smeSignatures: buildRegisterSmeSignatures(record)
                } as any)

                message.success('Attendance register downloaded.')
                return
            }

            if (!record.participantId) {
                message.error('This intervention has no linked beneficiary.')
                return
            }

            if (!record.interventionId) {
                message.error('This intervention is missing required information.')
                return
            }

            await generateAttendanceRegister({
                db,
                mode: 'intervention',
                interventionId: record.interventionId,
                participantIds: [record.participantId],
                startDate,
                endDate,
                programId: activeProgramId || record.programId || undefined,
                fileName: buildRegisterFileName(record, startDate, endDate),
                smeSignatures: buildRegisterSmeSignatures(record)
            } as any)

            message.success('Attendance register downloaded.')
        } catch (err: any) {
            console.error('Failed to generate attendance register:', err)
            message.error(err?.message || 'Failed to generate attendance register.')
        } finally {
            setGeneratingRegisterId(null)
        }
    }

    // Five columns at most, and only three on a narrow screen. Everything that
    // used to have its own column (beneficiary, due date, queries, evidence)
    // is either folded into a related column or moved into the row's action
    // menu, so Actions can stay pinned and reachable without scrolling.
    const columns: ColumnsType<DisplayIntervention> = useMemo(() => {
        const cols: ColumnsType<DisplayIntervention> = [
            {
                title: 'Intervention',
                key: 'intervention',
                render: (_: any, record: DisplayIntervention) => {
                    const name =
                        record.participantName ||
                        record.beneficiaryName ||
                        record.participantId ||
                        'Unknown'

                    // Stacked, one fact per line: what the work is, which part
                    // of it, then who it is for.
                    return (
                        <Space direction="vertical" size={4} style={{ minWidth: 0 }}>
                            <Text strong ellipsis={{ tooltip: record.interventionTitle }}>
                                {record.interventionTitle || (
                                    <Text type="secondary">Untitled intervention</Text>
                                )}
                            </Text>

                            {record.subInterventionTitle || record.subInterventionId ? (
                                <div>{renderSubInterventionTag(record)}</div>
                            ) : null}

                            {record.isGroupedDisplay ? (
                                <Tag color="purple" icon={<AppstoreOutlined />} style={{ marginInlineEnd: 0 }}>
                                    Grouped • {record.memberCount || 0} SMEs
                                </Tag>
                            ) : (
                                <Text type="secondary" ellipsis={{ tooltip: name }} style={{ maxWidth: 260 }}>
                                    {name}
                                </Text>
                            )}
                        </Space>
                    )
                }
            },
            {
                title: 'Workflow',
                key: 'workflow',
                width: 210,
                render: (_: any, record: DisplayIntervention) => (
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {record.isGroupedDisplay ? groupedStatusTag(record) : statusTag(record)}
                        <div style={{ width: '100%', maxWidth: 160 }}>{renderProgress(record)}</div>
                    </Space>
                )
            }
        ]

        // Dates earn their space only once there is room for them.
        if (screens.lg) {
            cols.push({
                title: 'Timeline',
                key: 'timeline',
                width: 190,
                sorter: (left: DisplayIntervention, right: DisplayIntervention) =>
                    getAssignedTime(left) - getAssignedTime(right),
                defaultSortOrder: 'descend',
                render: (_: any, record: DisplayIntervention) => {
                    const isCompleted = record.lifecycleBucket === 'completed'
                    const due = toJsDate(record.dueDate)
                    const overdue =
                        !isCompleted && !!due && dayjs(due).isBefore(dayjs(), 'day')

                    return (
                        <Space direction="vertical" size={2}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                Assigned {formatDate(record.assignedAtResolved ?? getAssignedAt(record))}
                            </Text>
                            {isCompleted ? (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    Completed {formatDate(record.completedAtResolved)}
                                </Text>
                            ) : (
                                <Space size={4}>
                                    <CalendarOutlined
                                        style={{ fontSize: 12, color: overdue ? '#cf1322' : undefined }}
                                    />
                                    <Text
                                        type={overdue ? 'danger' : 'secondary'}
                                        style={{ fontSize: 12 }}
                                    >
                                        Due {formatDate(record.dueDate)}
                                    </Text>
                                </Space>
                            )}
                        </Space>
                    )
                }
            })
        }

        if (screens.xxl) {
            cols.push({
                title: 'Queries',
                key: 'queries',
                width: 120,
                render: (_: any, record: DisplayIntervention) => {
                    if (record.lifecycleBucket !== 'completed') return <Text type="secondary">-</Text>

                    const total = Number(record.queryCount || 0)
                    const open = Number(record.openQueryCount || 0)
                    if (!total) return <Text type="secondary">None</Text>

                    return (
                        <Space direction="vertical" size={2}>
                            <Tag color={open > 0 ? 'volcano' : 'green'} style={{ marginInlineEnd: 0 }}>
                                {total - open}/{total} closed
                            </Tag>
                            {open > 0 ? <Tag color="orange" style={{ marginInlineEnd: 0 }}>{open} open</Tag> : null}
                        </Space>
                    )
                }
            })
        }

        cols.push({
            title: 'Actions',
            key: 'actions',
            width: 190,
            fixed: screens.lg ? 'right' : undefined,
            render: (_: any, record: DisplayIntervention) => {
                const canRemind = canSendReminderRecord(record)
                const reminding = remindingIds.includes(record.id)
                const isCompleted = record.lifecycleBucket === 'completed'
                const recordProgress = record.progressResolved ?? getProgressPercent(record)
                const canComplete = !isCompleted && recordProgress >= 100 &&
                    (record.members || [record]).some(member =>
                        getFacilitatorCompletion(member) !== 'done'
                    )
                const overdue = !isCompleted && isOverdueRecord(record)
                const evidenceCount = getEvidenceEntriesFromRecord(record).length
                const totalQueries = Number(record.queryCount || 0)
                const openQueries = Number(record.openQueryCount || 0)

                // One contextual primary button carries the step the row is
                // actually waiting on; the rest go in the menu so the column
                // stays narrow enough to pin to the edge.
                // Not a one-click toggle: it opens the completion form, which
                // wants the POE and a summary before it can issue the MOVs.
                const primary = canComplete
                    ? {
                        label: 'Submit completion',
                        guide: 'complete-intervention-action',
                        icon: <CheckCircleOutlined />,
                        color: 'green' as const,
                        border: 'green',
                        onClick: () => void prepareCompletionStep(record)
                    }
                    : !isCompleted && recordProgress < 100
                        ? {
                            label: 'Add progress',
                            guide: 'add-progress-action',
                            icon: <EditOutlined />,
                            color: 'blue' as const,
                            border: '#1677ff',
                            onClick: () => openProgressModal(record)
                        }
                        : {
                            label: 'Details',
                            guide: undefined,
                            icon: <InfoCircleOutlined />,
                            color: 'green' as const,
                            border: 'green',
                            onClick: () => openDetailsModal(record)
                        }

                const items = [
                    ...(primary.label === 'Details'
                        ? []
                        : [{
                            key: 'details',
                            icon: <InfoCircleOutlined />,
                            label: 'View details',
                            onClick: () => openDetailsModal(record)
                        }]),
                    {
                        key: 'evidence',
                        icon: <UploadOutlined />,
                        label: evidenceCount ? `Manage evidence (${evidenceCount})` : 'Add evidence',
                        onClick: () => openManageEvidenceModal(record)
                    },
                    ...(isCompleted && totalQueries
                        ? [{
                            key: 'queries',
                            icon: <EyeOutlined />,
                            label: `View queries${openQueries ? ` (${openQueries} open)` : ''}`,
                            onClick: () => openQueriesModal(record)
                        }]
                        : []),
                    ...(isCompleted
                        ? [{
                            key: 'register',
                            icon: <CalendarOutlined />,
                            label: 'Generate register',
                            disabled: generatingRegisterId === record.id,
                            onClick: () => generateRegisterForRecord(record)
                        }]
                        : []),
                    ...(!isCompleted && canRemind
                        ? [{
                            key: 'remind',
                            icon: <BellOutlined />,
                            label: 'Send confirmation reminder',
                            disabled: reminding,
                            onClick: () => sendReminder(record)
                        }]
                        : []),
                    ...(overdue
                        ? [{
                            key: 'overdue',
                            icon: <ClockCircleOutlined />,
                            danger: true,
                            label: 'Give overdue reason',
                            onClick: () => openOverdueModal(record)
                        }]
                        : [])
                ]

                return (
                    <Space size={4} wrap={false}>
                        <Button
                            data-guide={primary.guide}
                            shape="round"
                            variant="filled"
                            color={primary.color}
                            size="small"
                            style={{ border: `1px solid ${primary.border}` }}
                            icon={primary.icon}
                            loading={generatingRegisterId === record.id}
                            onClick={primary.onClick}
                        >
                            {primary.label}
                        </Button>

                        <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
                            <Button
                                shape="circle"
                                size="small"
                                icon={<MoreOutlined />}
                                aria-label="More actions"
                            />
                        </Dropdown>

                        {overdue ? (
                            <Tag color="red" style={{ marginInlineEnd: 0 }}>!</Tag>
                        ) : null}
                    </Space>
                )
            }
        })

        return cols
    }, [generatingRegisterId, remindingIds, screens.lg, screens.xxl])

    const renderAllocatedCard = (record: DisplayIntervention) => {
        const canRemind = canSendReminderRecord(record)
        const reminding = remindingIds.includes(record.id)
        const overdue = isOverdueRecord(record)
        const progress = record.progressResolved ?? getProgressPercent(record)
        const canComplete = record.lifecycleBucket !== 'completed' && progress >= 100 &&
            (record.members || [record]).some(member =>
                getFacilitatorCompletion(member) !== 'done'
            )
        const assignedAt = record.assignedAtResolved ?? getAssignedAt(record)

        return (
            <Card
                style={{
                    marginBottom: 12,
                    borderRadius: 12,
                    border: '1px solid #d6e4ff'
                }}
            >
                <Space direction="vertical" style={{ width: '100%' }} size={10}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                            <Text strong style={{ display: 'block' }}>
                                {record.participantName || record.beneficiaryName || record.participantId || '-'}
                            </Text>
                            <Text type="secondary" style={{ display: 'block' }}>
                                {record.interventionTitle || 'Untitled intervention'}
                            </Text>

                            <div style={{ marginTop: 6 }}>
                                {record.isGroupedDisplay ? groupedStatusTag(record) : statusTag(record)}
                            </div>

                            {record.isGroupedDisplay ? (
                                <div style={{ marginTop: 6 }}>
                                    <Tag color="purple" icon={<AppstoreOutlined />}>
                                        Grouped • {record.memberCount || 0} SMEs
                                    </Tag>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <Space wrap>
                        {renderSubInterventionTag(record)}
                        {waitingOnTag(record)}
                        {overdue ? <Tag color="red">Overdue</Tag> : null}
                    </Space>

                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Text type="secondary">Progress</Text>
                        <Progress percent={progress} />
                    </Space>

                    <Space wrap>
                        <Text type="secondary">Assigned: {formatDate(assignedAt)}</Text>
                        <Text type="secondary">Due: {formatDate(record.dueDate)}</Text>
                    </Space>

                    <Space wrap>
                        <Button
                            shape="round"
                            variant="filled"
                            size="small"
                            color="default"
                            icon={<InfoCircleOutlined />}
                            onClick={() => openDetailsModal(record)}
                        >
                            Details
                        </Button>

                        {progress < 100 ? (
                            <Button
                                data-guide="add-progress-action"
                                shape="round"
                                variant="filled"
                                color="blue"
                                style={{ border: '1px solid #1677ff' }}
                                icon={<EditOutlined />}
                                onClick={() => openProgressModal(record)}
                            >
                                Add Progress
                            </Button>
                        ) : null}

                        {canComplete ? (
                            <Button
                                data-guide="complete-intervention-action"
                                shape="round"
                                variant="filled"
                                color="green"
                                style={{ border: '1px solid green' }}
                                icon={<CheckCircleOutlined />}
                                onClick={() => void prepareCompletionStep(record)}
                            >
                                Complete Intervention
                            </Button>
                        ) : null}

                        {canRemind && (
                            <Button
                                shape="round"
                                variant="filled"
                                color="orange"
                                style={{ border: '1px solid orange' }}
                                icon={<BellOutlined />}
                                loading={reminding}
                                onClick={() => sendReminder(record)}
                            >
                                Send Confirmation Reminder
                            </Button>
                        )}

                        {overdue && (
                            <Button
                                shape="round"
                                variant="filled"
                                color="orange"
                                style={{ border: '1px solid orange' }}
                                icon={<ClockCircleOutlined />}
                                size='small'
                                onClick={() => openOverdueModal(record)}
                            >
                                Reason
                            </Button>
                        )}
                    </Space>
                </Space>
            </Card>
        )
    }

    const renderHistoryCard = (record: DisplayIntervention) => {
        const progress = record.progressResolved ?? getProgressPercent(record)
        const assignedAt = record.assignedAtResolved ?? getAssignedAt(record)
        const completedAt = record.completedAtResolved ?? assignmentCompletedDate(record)
        const hasEv = hasEvidence(record)
        const total = Number(record.queryCount || 0)
        const open = Number(record.openQueryCount || 0)
        const closed = total - open

        return (
            <Card
                style={{
                    marginBottom: 12,
                    borderRadius: 12,
                    border: '1px solid #d6e4ff'
                }}
            >
                <Space direction="vertical" style={{ width: '100%' }} size={10}>
                    <div>
                        <Text strong style={{ display: 'block' }}>
                            {record.participantName || record.beneficiaryName || record.participantId || '-'}
                        </Text>
                        <Text type="secondary" style={{ display: 'block' }}>
                            {record.interventionTitle || 'Untitled intervention'}
                        </Text>
                    </div>

                    <Space wrap>
                        {record.isGroupedDisplay ? (
                            <Tag color="purple" icon={<AppstoreOutlined />}>
                                Grouped • {record.memberCount || 0} SMEs
                            </Tag>
                        ) : null}
                        {renderSubInterventionTag(record)}
                        {record.isGroupedDisplay ? groupedStatusTag(record) : statusTag(record)}
                    </Space>

                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Text type="secondary">Progress</Text>
                        <Progress percent={progress} />
                    </Space>

                    <Space wrap>
                        <Text type="secondary">Assigned: {formatDate(assignedAt)}</Text>
                        <Text type="secondary">Completed: {formatDate(completedAt)}</Text>
                        <Text type="secondary">Due: {formatDate(record.dueDate)}</Text>
                    </Space>

                    <Space wrap>
                        <Button
                            shape="round"
                            variant="filled"
                            color="default"
                            icon={<InfoCircleOutlined />}
                            onClick={() => openDetailsModal(record)}
                        >
                            Details
                        </Button>

                        <Button
                            shape="round"
                            variant="filled"
                            color="cyan"
                            style={{ border: '1px solid #13c2c2' }}
                            icon={<CalendarOutlined />}
                            loading={generatingRegisterId === record.id}
                            onClick={() => generateRegisterForRecord(record)}
                        >
                            Generate Register
                        </Button>

                        {total > 0 ? (
                            <Button
                                shape="round"
                                variant="filled"
                                color="geekblue"
                                style={{ border: '1px solid dodgerblue' }}
                                icon={<EyeOutlined />}
                                onClick={() => openQueriesModal(record)}
                            >
                                Queries ({closed}/{total})
                            </Button>
                        ) : (
                            <Tag>No Queries</Tag>
                        )}

                        {hasEv ? (
                            <>
                                <Button
                                    shape="round"
                                    variant="filled"
                                    color="green"
                                    style={{ border: '1px solid limegreen' }}
                                    icon={<FileProtectOutlined />}
                                    onClick={() => openEvidenceModal(record)}
                                >
                                    Evidence
                                </Button>

                                <Button
                                    shape="round"
                                    variant="filled"
                                    color="blue"
                                    style={{ border: '1px solid #1677ff' }}
                                    icon={<UploadOutlined />}
                                    onClick={() => openManageEvidenceModal(record)}
                                >
                                    Manage Evidence
                                </Button>
                            </>
                        ) : (
                            <>
                                <Tag color="red">Missing Evidence</Tag>

                                <Button
                                    shape="round"
                                    variant="filled"
                                    color="blue"
                                    style={{ border: '1px solid #1677ff' }}
                                    icon={<UploadOutlined />}
                                    onClick={() => openManageEvidenceModal(record)}
                                >
                                    Add Evidence
                                </Button>
                            </>
                        )}
                    </Space>

                    {open > 0 ? <Tag color="orange">{open} Open Query(ies)</Tag> : null}
                </Space>
            </Card>
        )
    }

    const metricColFlex = isMobile
        ? '1 1 calc(50% - 12px)'
        : '1 1 180px'

    // Selecting the metric that is already applied clears the filter, so the
    // cards behave like a toggle group without needing a separate "All" step.
    const toggleQuickStatus = (value: typeof quickStatus) =>
        setQuickStatus(current => (current === value ? 'all' : value))

    const quickStatusStyle = (value: typeof quickStatus): React.CSSProperties =>
        quickStatus === value
            ? {
                borderColor: '#1677ff',
                boxShadow: isDark
                    ? '0 0 0 2px rgba(22,119,255,0.35)'
                    : '0 0 0 2px rgba(22,119,255,0.18)'
            }
            : {}
    const compactModalStyles = {
        body: {
            maxHeight: isMobile ? '76vh' : '74vh',
            overflowY: 'auto' as const,
            overflowX: 'hidden' as const,
            paddingTop: 10,
            paddingBottom: 10
        }
    }

    const openManageEvidenceFilePicker = (replaceTarget?: string) => {
        pendingEvidenceReplaceTargetRef.current = replaceTarget
        if (manageEvidenceFileInputRef.current) {
            manageEvidenceFileInputRef.current.value = ''
            manageEvidenceFileInputRef.current.click()
        }
    }

    const handleManageEvidenceFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || [])
        const replaceTarget = pendingEvidenceReplaceTargetRef.current
        pendingEvidenceReplaceTargetRef.current = undefined
        if (!files.length) return

        const fileList = files.map(file => ({
            uid: `${Date.now()}-${file.name}`,
            name: file.name,
            originFileObj: file
        }))
        const values = {
            ...manageEvidenceForm.getFieldsValue(),
            files: fileList,
            replaceTarget
        }
        setPendingEvidenceFiles(files)
        manageEvidenceForm.setFieldsValue(values)
        void submitManageEvidence(values)
    }
    const progressModalStyles = {
        body: {
            ...compactModalStyles.body,
            paddingTop: 14,
            paddingRight: isMobile ? 14 : 20,
            paddingBottom: 26,
            paddingLeft: isMobile ? 4 : 6,
            scrollbarGutter: 'stable' as const
        }
    }

    const showInitialLoading = identityLoading || (loading && !hasLoadedOnce)

    return (
        <div style={{ padding: '5px 24px' }}>
            <Helmet>
                <title>Allocated Interventions | Smart Incubation</title>
            </Helmet>

            {showInitialLoading ? (
                <LoadingOverlay tip="Loading interventions" />
            ) :
                (
                    <>
                        {/*
                          The metrics are the workflow filter. They already
                          carry the counts, so a separate Segmented repeated the
                          same four choices directly underneath them. Selecting
                          a metric filters the table; selecting it again clears
                          back to Total.
                        */}
                        <div data-guide="allocated-status">
                            <Row data-guide="allocated-metrics" gutter={[12, 12]} style={{ marginBottom: 16 }}>
                                <Col flex={metricColFlex} style={{ minWidth: 0 }}>
                                    <MotionCard.Metric
                                        loading={loading}
                                        title="Total"
                                        value={metrics.total}
                                        icon={<TeamOutlined style={{ color: '#1677ff' }} />}
                                        iconBg="rgba(22,119,255,.12)"
                                        onClick={() => setQuickStatus('all')}
                                        wrapperStyle={quickStatusStyle('all')}
                                    />
                                </Col>

                                <Col flex={metricColFlex} style={{ minWidth: 0 }}>
                                    <MotionCard.Metric
                                        loading={loading}
                                        title="In Delivery"
                                        value={metrics.inDelivery}
                                        icon={<EditOutlined style={{ color: '#722ed1' }} />}
                                        iconBg="rgba(114,46,209,.12)"
                                        onClick={() => toggleQuickStatus('in-delivery')}
                                        wrapperStyle={quickStatusStyle('in-delivery')}
                                    />
                                </Col>

                                <Col flex={metricColFlex} style={{ minWidth: 0 }}>
                                    <MotionCard.Metric
                                        loading={loading}
                                        title="Awaiting SME Confirmation"
                                        value={metrics.awaitingSmeCompletionConfirm}
                                        icon={<FileProtectOutlined style={{ color: '#eb2f96' }} />}
                                        iconBg="rgba(235,47,150,.12)"
                                        onClick={() => toggleQuickStatus('awaiting-confirmation')}
                                        wrapperStyle={quickStatusStyle('awaiting-confirmation')}
                                    />
                                </Col>

                                <Col flex={metricColFlex} style={{ minWidth: 0 }}>
                                    <MotionCard.Metric
                                        loading={loading}
                                        title="Completed"
                                        value={metrics.completed}
                                        icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                                        iconBg="rgba(82,196,26,.12)"
                                        onClick={() => toggleQuickStatus('completed')}
                                        wrapperStyle={quickStatusStyle('completed')}
                                    />
                                </Col>

                                <Col flex={metricColFlex} style={{ minWidth: 0 }}>
                                    <div data-guide="open-queries-metric">
                                        <MotionCard.Metric
                                            loading={loading}
                                            title="Open Queries"
                                            value={historyQueryMetrics.totalOpen}
                                            icon={<WarningOutlined style={{ color: '#fa8c16' }} />}
                                            iconBg="rgba(250,140,22,.12)"
                                            onClick={openAllOpenQueriesModal}
                                        />
                                    </div>
                                </Col>
                            </Row>
                        </div>

                        <MotionCard
                            filterBar={
                                <Row data-guide="allocated-filters" gutter={[12, 12]} align="middle">
                                    <Col xs={24} md={12} lg={7}>
                                        <Search
                                            placeholder="Search beneficiary, intervention, sector, province..."
                                            allowClear
                                            value={searchText}
                                            onChange={e => setSearchText(e.target.value)}
                                        />
                                    </Col>

                                    <Col xs={24} md={12} lg={6}>
                                        <RangePicker
                                            value={dateRange}
                                            onChange={values => setDateRange(values as [Dayjs | null, Dayjs | null] | null)}
                                            allowEmpty={[true, true]}
                                            placeholder={['Activity from', 'Activity to']}
                                            style={{ width: '100%' }}
                                        />
                                    </Col>

                                    <Col xs={24} md={12} lg={5}>
                                        <Select
                                            value={workflowFilter}
                                            onChange={setWorkflowFilter}
                                            style={{ width: '100%' }}
                                            options={[
                                                { value: 'all', label: 'All workflows' },
                                                { value: 'awaiting-participant-acceptance', label: 'Awaiting appointment response' },
                                                { value: 'in-delivery', label: 'In delivery' },
                                                { value: 'awaiting-participant-confirmation', label: 'Awaiting SME confirmation' },
                                                { value: 'participant-rejected', label: 'Completion rejected' },
                                                { value: 'completed', label: 'Completed' },
                                                { value: 'no-attendance', label: 'No sessions attended' }
                                            ]}
                                        />
                                    </Col>

                                    <Col xs={24} md={12} lg={6}>
                                        <Space wrap style={{ width: '100%', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
                                            <Button
                                                shape="round"
                                                variant="filled"
                                                color="orange"
                                                style={{ border: '1px solid orange' }}
                                                icon={<BellOutlined />}
                                                loading={bulkReminding}
                                                onClick={sendReminderToAllVisible}
                                            >
                                                Remind All Confirmations
                                            </Button>
                                        </Space>
                                    </Col>
                                </Row>
                            }
                        >
                            {filteredData.length === 0 ? (
                                <Empty description="No interventions found." />
                            ) : isMobile ? (
                                <div data-guide="allocated-table">
                                    <List
                                        dataSource={filteredData}
                                        renderItem={(item) =>
                                            item.lifecycleBucket === 'completed'
                                                ? renderHistoryCard(item)
                                                : renderAllocatedCard(item)
                                        }
                                    />
                                </div>
                            ) : (
                                <div data-guide="allocated-table">
                                    <Table
                                        columns={columns}
                                        dataSource={filteredData}
                                        rowKey="id"
                                        pagination={{
                                            pageSize: 5,
                                            showSizeChanger: false,
                                            position: ['bottomCenter']
                                        }}
                                        scroll={{ x: 'max-content' }}
                                    />
                                </div>
                            )}

                            <Modal
                                centered
                                styles={compactModalStyles}
                                open={detailsModalOpen}
                                title="Intervention Details"
                                footer={
                                    detailsRecord && detailsRecord.lifecycleBucket === 'active'
                                        ? [
                                            ...(Number(detailsRecord.progressResolved ?? getProgressPercent(detailsRecord)) < 100 ? [
                                                <Button
                                                    key="progress"
                                                    type="primary"
                                                    icon={<EditOutlined />}
                                                    onClick={() => {
                                                        const record = detailsRecord
                                                        setDetailsModalOpen(false)
                                                        setDetailsRecord(null)
                                                        openProgressModal(record)
                                                    }}
                                                >
                                                    Add Progress
                                                </Button>
                                            ] : []),
                                            canSendReminderRecord(detailsRecord) ? (
                                                <Button
                                                    key="remind"
                                                    shape="round"
                                                    variant="filled"
                                                    color="orange"
                                                    style={{ border: '1px solid orange' }}
                                                    icon={<BellOutlined />}
                                                    loading={remindingIds.includes(detailsRecord.id)}
                                                    onClick={() => sendReminder(detailsRecord)}
                                                >
                                                    {detailsRecord.isGroupedDisplay ? 'Remind All Confirmations' : 'Send Confirmation Reminder'}
                                                </Button>
                                            ) : null,
                                            <Button
                                                key="close"
                                                danger
                                                onClick={() => {
                                                    setDetailsModalOpen(false)
                                                    setDetailsRecord(null)
                                                }}
                                            >
                                                Close
                                            </Button>
                                        ].filter(Boolean)
                                        : [
                                            <Button
                                                danger
                                                key="close"
                                                onClick={() => {
                                                    setDetailsModalOpen(false)
                                                    setDetailsRecord(null)
                                                }}
                                            >
                                                Close
                                            </Button>
                                        ]
                                }
                                width={isMobile ? '100%' : 'min(1100px, calc(100vw - 32px))'}
                                onCancel={() => {
                                    setDetailsModalOpen(false)
                                    setDetailsRecord(null)
                                }}
                                destroyOnClose
                            >
                                {!detailsRecord ? (
                                    <Empty description="No intervention selected" />
                                ) : (
                                    <Space direction="vertical" style={{ width: '100%' }} size={10}>
                                        {/*
                                          The summary strip carries everything
                                          you need before choosing a tab: what
                                          it is, who it is for, where it stands
                                          and the dates. Progress lives here
                                          rather than inside Overview so it does
                                          not disappear when you switch tabs.
                                        */}
                                        <Card
                                            size="small"
                                            styles={{ body: { padding: 14 } }}
                                            style={{
                                                borderRadius: 12,
                                                background: isDark ? 'rgba(255,255,255,0.03)' : '#fafafa',
                                                border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : '#f0f0f0'}`
                                            }}
                                        >
                                            <Row gutter={[16, 12]} align="middle">
                                                <Col xs={24} md={14}>
                                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                                        <Text strong style={{ fontSize: 15 }}>
                                                            {detailsRecord.interventionTitle || 'Untitled intervention'}
                                                        </Text>
                                                        <Space wrap size={[8, 4]}>
                                                            {detailsRecord.isGroupedDisplay ? (
                                                                <Tag color="purple" icon={<AppstoreOutlined />} style={{ marginInlineEnd: 0 }}>
                                                                    Grouped • {detailsRecord.memberCount || detailsRecord.members?.length || 0} SMEs
                                                                </Tag>
                                                            ) : (
                                                                <Text type="secondary">
                                                                    {detailsRecord.participantName || detailsRecord.beneficiaryName || detailsRecord.participantId || '-'}
                                                                </Text>
                                                            )}
                                                            {detailsRecord.isGroupedDisplay
                                                                ? groupedStatusTag(detailsRecord)
                                                                : statusTag(detailsRecord)}
                                                        </Space>
                                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                                            {getSubInterventionLabel(detailsRecord) || 'No sub-intervention'}
                                                        </Text>
                                                    </Space>
                                                </Col>

                                                <Col xs={24} md={10}>
                                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                                        <Progress
                                                            percent={detailsRecord.progressResolved ?? getProgressPercent(detailsRecord)}
                                                            status={detailsRecord.lifecycleBucket === 'completed' ? 'success' : 'active'}
                                                            strokeWidth={10}
                                                        />
                                                        <Space wrap size={[12, 2]}>
                                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                                Assigned {formatDate(detailsRecord.assignedAtResolved ?? getAssignedAt(detailsRecord))}
                                                            </Text>
                                                            {detailsRecord.lifecycleBucket === 'completed' ? (
                                                                <Text type="secondary" style={{ fontSize: 12 }}>
                                                                    Completed {formatDate(detailsRecord.completedAtResolved)}
                                                                </Text>
                                                            ) : (
                                                                <Text
                                                                    type={isOverdueRecord(detailsRecord) ? 'danger' : 'secondary'}
                                                                    style={{ fontSize: 12 }}
                                                                >
                                                                    Due {formatDate(detailsRecord.dueDate)}
                                                                </Text>
                                                            )}
                                                        </Space>
                                                    </Space>
                                                </Col>
                                            </Row>
                                        </Card>

                                        <Segmented
                                            block
                                            value={detailsTab}
                                            onChange={(value) => setDetailsTab(value as typeof detailsTab)}
                                            options={[
                                                { label: 'Overview', value: 'overview' },
                                                ...(detailsRecord.isGroupedDisplay
                                                    ? [{ label: 'Members', value: 'members' }]
                                                    : []),
                                                { label: 'Sessions', value: 'sessions' },
                                                { label: 'Progress updates', value: 'updates' }
                                            ]}
                                        />

                                        {/* Progress now lives in the summary strip above. */}
                                        {detailsTab === 'overview'
                                            ? renderDetailsDescriptions(detailsRecord)
                                            : null}

                                        {detailsRecord.isGroupedDisplay && detailsTab === 'members' ? (
                                            renderGroupedMembers(detailsRecord)
                                        ) : null}

                                        {detailsTab === 'sessions' ? (
                                            renderSessionsPanel(detailsRecord)
                                        ) : null}

                                        {detailsTab === 'updates' && detailsProgressImages.length ? (
                                            <Card size="small" title="Progress images" style={{ borderRadius: 12 }}>
                                                <Carousel arrows dots>
                                                    {detailsProgressImages.map((resource, index) => (
                                                        <div key={`${resource.link}-${index}`}>
                                                            <div style={{
                                                                height: isMobile ? 260 : 420,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                background: '#f5f5f5',
                                                                borderRadius: 10,
                                                                overflow: 'hidden'
                                                            }}>
                                                                <Image
                                                                    src={resource.link}
                                                                    alt={resource.label || `Progress image ${index + 1}`}
                                                                    style={{ maxHeight: isMobile ? 250 : 410, objectFit: 'contain' }}
                                                                />
                                                            </div>
                                                            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                                                                {resource.updateNote || resource.label}
                                                            </Text>
                                                        </div>
                                                    ))}
                                                </Carousel>
                                            </Card>
                                        ) : null}

                                        {detailsTab === 'updates' ? <Card size="small" title="Progress updates" style={{ borderRadius: 12 }}>
                                            {detailsProgressUpdates.length ? (
                                                <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'hidden', padding: '14px 8px 14px 4px' }}>
                                                    {detailsProgressUpdates.map((update, index) => {
                                                        const isEvidence = String(update.type || '').startsWith('evidence-uploaded') || update.type === 'poe-uploaded'
                                                        const date = toJsDate(update.createdAt)
                                                        return (
                                                            <div key={`${String(update.createdAt || index)}-${index}`} style={{ display: 'flex', width: '100%', minWidth: 0 }}>
                                                                <div style={{ width: 156, flex: '0 0 156px', paddingRight: 12, textAlign: 'right', color: '#595959', fontSize: 12 }}>
                                                                    {date ? dayjs(date).format('DD MMM YYYY, HH:mm') : 'Date unavailable'}
                                                                </div>
                                                                <div style={{ width: 18, flex: '0 0 18px', position: 'relative', display: 'flex', justifyContent: 'center' }}>
                                                                    {index < detailsProgressUpdates.length - 1 ? <div style={{ position: 'absolute', top: 8, bottom: -16, width: 2, background: '#d9d9d9' }} /> : null}
                                                                    <span style={{ position: 'relative', zIndex: 1, marginTop: 4, width: 9, height: 9, borderRadius: '50%', background: Number(update.computedProgress || 0) >= 100 ? '#52c41a' : '#1677ff', border: '2px solid #fff', boxShadow: '0 0 0 1px currentColor' }} />
                                                                </div>
                                                                <div style={{ flex: 1, minWidth: 0, padding: '0 0 18px 12px' }}>
                                                                    <Space direction="vertical" size={2} style={{ maxWidth: '100%', minWidth: 0 }}>
                                                                        <Space wrap>
                                                                            {isEvidence ? <Text strong>POE uploaded{update.participantCount > 1 ? ` (${update.participantCount})` : ''}</Text> : null}
                                                                            {update.participantNames?.length === 1 ? <Tag>{update.participantNames[0]}</Tag> : null}
                                                                            {Number.isFinite(Number(update.computedProgress)) ? <Tag color="blue">{clampPercent(update.computedProgress)}%</Tag> : null}
                                                                        </Space>
                                                                        <Text style={{ overflowWrap: 'anywhere' }}>
                                                                            {isEvidence ? 'Evidence added to the intervention.' : (update.note || 'Progress updated.')}
                                                                        </Text>
                                                                    </Space>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            ) : (
                                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No progress updates yet" />
                                            )}
                                        </Card> : null}
                                    </Space>
                                )}
                            </Modal>

                            <Modal
                                className="guide-progress-modal"
                                styles={progressModalStyles}
                                open={progressModalOpen}
                                title={progressModalStep === 0 ? 'Update intervention progress' : 'Complete intervention'}
                                footer={
                                    progressModalStep === 0 ? (
                                        <Button
                                            block
                                            type="primary"
                                            size="large"
                                            className="guide-progress-submit"
                                            loading={savingProgressUpdate || savingEvidence}
                                            onClick={() => progressUpdateForm.submit()}
                                        >
                                            Save update
                                        </Button>
                                    ) : progressModalStep === 1 ? (
                                        <Button
                                            block
                                            type="primary"
                                            size="large"
                                            loading={savingEvidence}
                                            onClick={() => setProgressModalStep(2)}
                                        >
                                            {selectedProgressPoeUrls.length
                                                ? `Continue with ${selectedProgressPoeUrls.length} selected POE${selectedProgressPoeUrls.length === 1 ? '' : 's'}`
                                                : 'Continue without these files'}
                                        </Button>
                                    ) : progressModalStep === 2 ? (
                                        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                                            {completionProgressEvidence.length ? (
                                                <Button
                                                    size="large"
                                                    onClick={() => setProgressModalStep(1)}
                                                    disabled={savingEvidence}
                                                >
                                                    Back
                                                </Button>
                                            ) : null}
                                            <Button
                                                block
                                                type="primary"
                                                size="large"
                                                loading={savingEvidence}
                                                onClick={() => {
                                                    if (!completionCurrentPoes.length && !selectedProgressPoeUrls.length && !completionPoeFiles.length) {
                                                        message.warning('Keep an existing POE, select an earlier file, or add at least one POE.')
                                                        return
                                                    }
                                                    setProgressModalStep(3)
                                                }}
                                            >
                                                Continue to MOV
                                            </Button>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                                            <Button
                                                size="large"
                                                onClick={() => setProgressModalStep(2)}
                                                disabled={savingEvidence}
                                            >
                                                Back
                                            </Button>
                                            <Button
                                                block
                                                type="primary"
                                                size="large"
                                                className="guide-progress-submit"
                                                loading={savingEvidence}
                                                disabled={
                                                    completionMovAssignments.some(assignment =>
                                                        !completionMovFilesByAssignment[assignment.id]
                                                    )
                                                }
                                                onClick={() => completionEvidenceForm.submit()}
                                            >
                                                {completionMovAssignments.length > 1
                                                    ? `Complete intervention (${completionMovUploadedCount}/${completionMovAssignments.length} MOVs)`
                                                    : 'Complete intervention'}
                                            </Button>
                                        </div>
                                    )
                                }
                                onCancel={() => {
                                    if (savingProgressUpdate || savingEvidence) return
                                    setProgressModalOpen(false)
                                    setCompletionContext(null)
                                    setCompletionFailureMessage('')
                                    setProgressModalStep(0)
                                    setProgressRecord(null)
                                    setManageEvidenceRecord(null)
                                    setCompletionDeliveryMethod('')
                                    setProgressUpdateFiles([])
                                    setSelectedProgressPoeUrls([])
                                    setCompletionPoeFiles([])
                                    setCompletionMovFilesByAssignment({})
                                    progressUpdateForm.resetFields()
                                    manageEvidenceForm.resetFields()
                                    completionEvidenceForm.resetFields()
                                }}
                                destroyOnClose
                                centered
                                width={isMobile ? 'calc(100vw - 20px)' : 680}
                            >

                                {progressModalStep === 0 ? (
                                    <Form key="progress-update" form={progressUpdateForm} layout="vertical" onFinish={submitProgressUpdate} onFinishFailed={showEvidenceValidationError} scrollToFirstError>
                                        {(() => {
                                            const currentProgress = progressRecord
                                                ? progressRecord.progressResolved ?? getProgressPercent(progressRecord)
                                                : 0
                                            const delta = Math.max(0, nextProgressPreview - currentProgress)
                                            const reachesEnd = nextProgressPreview >= 100
                                            const extraFiles = Math.max(0, progressFilePreviews.length - 4)

                                            return (
                                                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                                                    {/*
                                                      Where it is now and where this update takes it, with one
                                                      control to set it. The headline figure is the readout, so
                                                      a progress bar and a percentage field alongside the slider
                                                      only repeated the same number twice more.
                                                    */}
                                                    <Card
                                                        styles={{ body: { padding: 14 } }}
                                                        style={{
                                                            borderRadius: 14,
                                                            borderColor: isDark ? 'rgba(74,155,255,0.24)' : '#e6eaf0',
                                                            background: isDark ? 'rgba(255,255,255,0.035)' : '#fafbfc'
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 24,
                                                                width: '100%'
                                                            }}
                                                        >
                                                            {/* Progress summary */}
                                                            <Space align="center" size={14} style={{ flex: '0 0 auto' }}>
                                                                <Space direction="vertical" size={0}>
                                                                    <Text
                                                                        type="secondary"
                                                                        style={{
                                                                            fontSize: 11,
                                                                            textTransform: 'uppercase',
                                                                            letterSpacing: 0.4
                                                                        }}
                                                                    >
                                                                        Now
                                                                    </Text>

                                                                    <Title
                                                                        level={4}
                                                                        style={{
                                                                            margin: 0,
                                                                            fontWeight: 600
                                                                        }}
                                                                    >
                                                                        {currentProgress}%
                                                                    </Title>
                                                                </Space>

                                                                <Text
                                                                    type="secondary"
                                                                    style={{
                                                                        fontSize: 18
                                                                    }}
                                                                >
                                                                    &rarr;
                                                                </Text>

                                                                <Space direction="vertical" size={0}>
                                                                    <Text
                                                                        type="secondary"
                                                                        style={{
                                                                            fontSize: 11,
                                                                            textTransform: 'uppercase',
                                                                            letterSpacing: 0.4,
                                                                            whiteSpace: 'nowrap'
                                                                        }}
                                                                    >
                                                                        After this update
                                                                    </Text>

                                                                    <Title
                                                                        level={4}
                                                                        style={{
                                                                            margin: 0,
                                                                            fontWeight: 700,
                                                                            color: reachesEnd ? '#52c41a' : '#1677ff'
                                                                        }}
                                                                    >
                                                                        {nextProgressPreview}%
                                                                    </Title>
                                                                </Space>

                                                                <div
                                                                    style={{
                                                                        width: 64,
                                                                        flex: '0 0 64px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'flex-start'
                                                                    }}
                                                                >
                                                                    {delta > 0 ? (
                                                                        <Tag
                                                                            color={reachesEnd ? 'green' : 'blue'}
                                                                            style={{
                                                                                marginInlineEnd: 0,
                                                                                fontWeight: 600,
                                                                                whiteSpace: 'nowrap'
                                                                            }}
                                                                        >
                                                                            +{delta}%
                                                                        </Tag>
                                                                    ) : null}
                                                                </div>
                                                            </Space>

                                                            {/* Slider */}
                                                            <div
                                                                data-guide="progress-value"
                                                                style={{
                                                                    flex: 1,
                                                                    minWidth: 0,
                                                                    paddingInline: 4
                                                                }}
                                                            >
                                                                <Form.Item
                                                                    name="nextProgress"
                                                                    noStyle
                                                                    rules={[
                                                                        {
                                                                            required: true,
                                                                            message: 'Choose the new total progress.'
                                                                        }
                                                                    ]}
                                                                >
                                                                    <Slider
                                                                        min={currentProgress}
                                                                        max={100}
                                                                        marks={{
                                                                            [currentProgress]: `${currentProgress}%`,
                                                                            100: '100%'
                                                                        }}
                                                                        tooltip={{
                                                                            formatter: value => `${value}%`
                                                                        }}
                                                                    />
                                                                </Form.Item>
                                                            </div>
                                                        </div>
                                                    </Card>

                                                    {/*
                                                      The prompt sits centred between the progress card and the
                                                      box it is asking you to fill, so it reads as the question
                                                      for the field directly below rather than as a message from
                                                      someone else.
                                                    */}
                                                    <Space
                                                        direction="vertical"
                                                        size={6}
                                                        style={{ width: '100%', textAlign: 'center', marginTop: -2 }}
                                                    >
                                                        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.55 }}>
                                                            <TypedText
                                                                play={progressChatTurn}
                                                                text="What did you get done since the last update? A couple of sentences is plenty - what is ready, what is still running, and the next step."
                                                            />
                                                        </Text>

                                                        {reachesEnd ? (
                                                            <Text style={{ fontSize: 13, color: '#52c41a' }}>
                                                                <TypedText
                                                                    play="reached-100"
                                                                    text="That takes it to 100%. Once you save, I'll ask for the completion evidence and raise the MOVs."
                                                                />
                                                            </Text>
                                                        ) : null}

                                                        {progressChatError ? (
                                                            <Text type="danger" style={{ fontSize: 13 }}>
                                                                {progressChatError}
                                                            </Text>
                                                        ) : null}
                                                    </Space>

                                                    {/* Composer. */}
                                                    <div
                                                        data-guide="progress-note"
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'flex-end',
                                                            gap: 8,
                                                            width: '100%',
                                                            border: `1px solid ${isDark
                                                                ? 'rgba(255,255,255,0.12)'
                                                                : '#e8ecf3'
                                                                }`,
                                                            borderRadius: 14,
                                                            padding: '8px 10px 8px 12px',
                                                            background: isDark
                                                                ? 'rgba(255,255,255,0.02)'
                                                                : '#fff'
                                                        }}
                                                    >
                                                        <Form.Item
                                                            name="note"
                                                            noStyle
                                                        >
                                                            <Input.TextArea
                                                                autoSize={{
                                                                    minRows: 2,
                                                                    maxRows: 6
                                                                }}
                                                                variant="borderless"
                                                                placeholder="e.g. Ran the second session with the group, worked through the file structure, and the templates are now with them to complete."
                                                                onChange={() =>
                                                                    progressChatError &&
                                                                    setProgressChatError(null)
                                                                }
                                                                style={{
                                                                    flex: 1,
                                                                    minWidth: 0,
                                                                    padding: '2px 0',
                                                                    resize: 'none'
                                                                }}
                                                            />
                                                        </Form.Item>

                                                        <div
                                                            data-guide="progress-files"
                                                            style={{
                                                                flex: '0 0 auto',
                                                                paddingBottom: 1
                                                            }}
                                                        >
                                                            <Upload
                                                                multiple
                                                                showUploadList={false}
                                                                beforeUpload={() => false}
                                                                fileList={progressUpdateFiles}
                                                                onChange={({ fileList }) =>
                                                                    setProgressUpdateFiles(fileList)
                                                                }
                                                                accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                                                            >
                                                                <Tooltip title="Add screenshots, photos or documents">
                                                                    <Button
                                                                        type="text"
                                                                        shape="circle"
                                                                        icon={<PlusOutlined />}
                                                                        aria-label="Add attachments"
                                                                        style={{
                                                                            flexShrink: 0
                                                                        }}
                                                                    />
                                                                </Tooltip>
                                                            </Upload>
                                                        </div>
                                                    </div>

                                                    {progressFilePreviews.length ? (
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                flexWrap: 'wrap',
                                                                gap: 8
                                                            }}
                                                        >
                                                            {progressFilePreviews.slice(0, 4).map(preview => (
                                                                <div
                                                                    key={preview.uid}
                                                                    title={preview.name}
                                                                    style={{
                                                                        position: 'relative',
                                                                        width: 64,
                                                                        height: 64,
                                                                        borderRadius: 10,
                                                                        overflow: 'hidden',
                                                                        border: `1px solid ${isDark
                                                                            ? 'rgba(255,255,255,0.14)'
                                                                            : '#e8ecf3'
                                                                            }`,
                                                                        background: isDark
                                                                            ? 'rgba(255,255,255,0.05)'
                                                                            : '#f4f6fa',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center'
                                                                    }}
                                                                >
                                                                    {preview.url ? (
                                                                        <img
                                                                            src={preview.url}
                                                                            alt={preview.name}
                                                                            style={{
                                                                                width: '100%',
                                                                                height: '100%',
                                                                                objectFit: 'cover'
                                                                            }}
                                                                        />
                                                                    ) : (
                                                                        <span
                                                                            style={{
                                                                                fontSize: 24,
                                                                                color: '#8c8c8c'
                                                                            }}
                                                                        >
                                                                            {getProgressFileIcon(
                                                                                preview.name,
                                                                                preview.type
                                                                            )}
                                                                        </span>
                                                                    )}

                                                                    <Button
                                                                        type="text"
                                                                        size="small"
                                                                        icon={
                                                                            <CloseOutlined
                                                                                style={{
                                                                                    fontSize: 10,
                                                                                    color: '#fff'
                                                                                }}
                                                                            />
                                                                        }
                                                                        aria-label={`Remove ${preview.name}`}
                                                                        onClick={() =>
                                                                            setProgressUpdateFiles(files =>
                                                                                files.filter(
                                                                                    file =>
                                                                                        String(file?.uid || '') !==
                                                                                        preview.uid
                                                                                )
                                                                            )
                                                                        }
                                                                        style={{
                                                                            position: 'absolute',
                                                                            top: 3,
                                                                            right: 3,
                                                                            width: 18,
                                                                            height: 18,
                                                                            minWidth: 18,
                                                                            padding: 0,
                                                                            borderRadius: 9,
                                                                            background: 'rgba(0,0,0,0.6)'
                                                                        }}
                                                                    />
                                                                </div>
                                                            ))}

                                                            {extraFiles > 0 ? (
                                                                <Tooltip
                                                                    title={progressFilePreviews
                                                                        .slice(4)
                                                                        .map(preview => preview.name)
                                                                        .join(', ')}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            width: 64,
                                                                            height: 64,
                                                                            borderRadius: 10,
                                                                            border: `1px dashed ${isDark
                                                                                ? 'rgba(255,255,255,0.2)'
                                                                                : '#d9d9d9'
                                                                                }`,
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center',
                                                                            fontWeight: 600,
                                                                            color: '#8c8c8c'
                                                                        }}
                                                                    >
                                                                        +{extraFiles}
                                                                    </div>
                                                                </Tooltip>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                </Space>
                                            )
                                        })()}
                                    </Form>
                                ) : (
                                    <Form
                                        key="completion-evidence"
                                        form={completionEvidenceForm}
                                        layout="vertical"
                                        onFinish={submitAllocatedCompletion}
                                        onFinishFailed={showEvidenceValidationError}
                                        scrollToFirstError
                                    >
                                        <Space direction="vertical" size={14} style={{ width: '100%' }}>
                                            <Card
                                                size="small"
                                                styles={{ body: { padding: '9px 12px' } }}
                                                style={{
                                                    borderRadius: 12,
                                                    borderColor: isDark ? 'rgba(82,196,26,0.26)' : '#d9f7be',
                                                    background: isDark ? 'rgba(82,196,26,0.08)' : '#f6ffed'
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        gap: 12,
                                                        flexWrap: 'wrap'
                                                    }}
                                                >
                                                    <Space size={8}>
                                                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                                                        <Text strong>Delivery complete</Text>
                                                        <Tag color="green" style={{ marginInlineEnd: 0 }}>100%</Tag>
                                                    </Space>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        {completionDeliveryMethod
                                                            ? `Delivery: ${completionDeliveryMethod}`
                                                            : 'Delivery method not recorded'}
                                                    </Text>
                                                </div>
                                            </Card>

                                            {completionFailureMessage ? (
                                                <Alert
                                                    type="error"
                                                    showIcon
                                                    message={completionFailureMessage}
                                                />
                                            ) : null}

                                            {completionStepError ? (
                                                <div style={{ textAlign: 'center', paddingInline: 12 }}>
                                                    <Text type="danger" style={{ fontSize: 13 }}>
                                                        {completionStepError}
                                                    </Text>
                                                </div>
                                            ) : null}

                                            {progressModalStep === 1 ? (
                                                <>
                                                    <div style={{ textAlign: 'center', paddingInline: 12 }}>
                                                        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
                                                            <TypedText
                                                                play={`reuse-${completionChatTurn}`}
                                                                text={`I found ${completionProgressEvidence.length} file${completionProgressEvidence.length === 1 ? '' : 's'} from your progress updates. Select anything that should become Proof of Execution for this intervention.`}
                                                            />
                                                        </Text>
                                                    </div>

                                                    <div
                                                        style={{
                                                            display: 'grid',
                                                            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                                                            gap: 10
                                                        }}
                                                    >
                                                        {completionProgressEvidence.map(resource => {
                                                            const selected = selectedProgressPoeUrls.includes(resource.link)
                                                            return (
                                                                <button
                                                                    key={resource.link}
                                                                    type="button"
                                                                    onClick={() => setSelectedProgressPoeUrls(current =>
                                                                        selected
                                                                            ? current.filter(link => link !== resource.link)
                                                                            : [...current, resource.link]
                                                                    )}
                                                                    style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: 10,
                                                                        width: '100%',
                                                                        minWidth: 0,
                                                                        padding: 10,
                                                                        textAlign: 'left',
                                                                        borderRadius: 12,
                                                                        cursor: 'pointer',
                                                                        border: `1px solid ${selected
                                                                            ? '#1677ff'
                                                                            : isDark ? 'rgba(255,255,255,0.12)' : '#e8ecf3'}`,
                                                                        background: selected
                                                                            ? isDark ? 'rgba(22,119,255,0.12)' : '#f0f7ff'
                                                                            : isDark ? 'rgba(255,255,255,0.025)' : '#fff',
                                                                        color: 'inherit'
                                                                    }}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            width: 54,
                                                                            height: 54,
                                                                            flex: '0 0 54px',
                                                                            borderRadius: 10,
                                                                            overflow: 'hidden',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center',
                                                                            background: isDark ? 'rgba(255,255,255,0.06)' : '#f5f7fa'
                                                                        }}
                                                                    >
                                                                        {resource.isImage ? (
                                                                            <img
                                                                                src={resource.link}
                                                                                alt={resource.name}
                                                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                                            />
                                                                        ) : (
                                                                            <span style={{ fontSize: 25, color: '#8c8c8c' }}>
                                                                                {getProgressFileIcon(resource.name, resource.type)}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                                        <Text
                                                                            strong={selected}
                                                                            ellipsis={{ tooltip: resource.name }}
                                                                            style={{ display: 'block', maxWidth: '100%' }}
                                                                        >
                                                                            {resource.name}
                                                                        </Text>
                                                                        <Text type="secondary" style={{ fontSize: 11 }}>
                                                                            {selected ? 'Will be added as POE' : 'Select to use as POE'}
                                                                        </Text>
                                                                    </div>
                                                                    {selected ? (
                                                                        <CheckCircleOutlined style={{ color: '#1677ff', fontSize: 18 }} />
                                                                    ) : null}
                                                                </button>
                                                            )
                                                        })}
                                                    </div>
                                                </>
                                            ) : null}

                                            {progressModalStep === 2 ? (
                                                <>
                                                    <div style={{ textAlign: 'center', paddingInline: 12 }}>
                                                        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
                                                            <TypedText
                                                                play={`poe-${completionChatTurn}`}
                                                                text={completionCurrentPoes.length
                                                                    ? `These are the current POEs for this intervention. Review them, then add anything that is missing before we move to the individual MOV${progressRecord?.isGroupedDisplay ? 's' : ''}.`
                                                                    : selectedProgressPoeUrls.length
                                                                        ? `Good. ${selectedProgressPoeUrls.length} file${selectedProgressPoeUrls.length === 1 ? ' is' : 's are'} selected from your progress updates as POE. Add anything else that proves the work was delivered.`
                                                                        : 'Add the shared Proof of Execution for this intervention before moving to the MOV.'}
                                                            />
                                                        </Text>
                                                    </div>

                                                    {completionCurrentPoes.length ? (
                                                        <Card
                                                            size="small"
                                                            title={
                                                                <Space size={8}>
                                                                    <FileProtectOutlined />
                                                                    <Text strong>Current POEs</Text>
                                                                    <Tag style={{ marginInlineEnd: 0 }}>{completionCurrentPoes.length}</Tag>
                                                                </Space>
                                                            }
                                                            styles={{ body: { padding: 8 } }}
                                                            style={{ borderRadius: 12 }}
                                                        >
                                                            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                                                {completionCurrentPoes.map(resource => {
                                                                    const name = resource.originalName || resource.label || 'POE'
                                                                    return (
                                                                        <div
                                                                            key={resource.link}
                                                                            style={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: 9,
                                                                                minWidth: 0,
                                                                                padding: '6px 8px',
                                                                                borderRadius: 9,
                                                                                background: isDark ? 'rgba(255,255,255,0.035)' : '#fafafa'
                                                                            }}
                                                                        >
                                                                            <span style={{ fontSize: 20, color: '#8c8c8c', flex: '0 0 auto' }}>
                                                                                {getProgressFileIcon(name, resource.type)}
                                                                            </span>
                                                                            <Text
                                                                                ellipsis={{ tooltip: name }}
                                                                                style={{ flex: 1, minWidth: 0 }}
                                                                            >
                                                                                {name}
                                                                            </Text>
                                                                            <Button
                                                                                type="text"
                                                                                size="small"
                                                                                icon={<EyeOutlined />}
                                                                                onClick={() => window.open(resource.link, '_blank')}
                                                                            >
                                                                                View
                                                                            </Button>
                                                                        </div>
                                                                    )
                                                                })}
                                                            </Space>
                                                        </Card>
                                                    ) : null}

                                                    {selectedProgressPoeUrls.length ? (
                                                        <div>
                                                            <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>
                                                                Selected from progress updates
                                                            </Text>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                                {completionProgressEvidence
                                                                    .filter(resource => selectedProgressPoeUrls.includes(resource.link))
                                                                    .map(resource => (
                                                                        <Tag
                                                                            key={resource.link}
                                                                            color="blue"
                                                                            closable
                                                                            onClose={event => {
                                                                                event.preventDefault()
                                                                                setSelectedProgressPoeUrls(current => current.filter(link => link !== resource.link))
                                                                            }}
                                                                            style={{
                                                                                display: 'inline-flex',
                                                                                alignItems: 'center',
                                                                                gap: 5,
                                                                                padding: '4px 8px',
                                                                                borderRadius: 8,
                                                                                marginInlineEnd: 0
                                                                            }}
                                                                        >
                                                                            {getProgressFileIcon(resource.name, resource.type)}
                                                                            <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                                {resource.name}
                                                                            </span>
                                                                        </Tag>
                                                                    ))}
                                                            </div>
                                                        </div>
                                                    ) : null}

                                                    <Upload
                                                        multiple
                                                        showUploadList={false}
                                                        beforeUpload={() => false}
                                                        fileList={completionPoeFiles}
                                                        onChange={({ fileList }) => setCompletionPoeFiles(fileList.slice(0, 10))}
                                                        accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                                                    >
                                                        <Button
                                                            block
                                                            size="large"
                                                            icon={<UploadOutlined />}
                                                            style={{ height: 44, borderRadius: 12 }}
                                                        >
                                                            Add another POE
                                                        </Button>
                                                    </Upload>

                                                    {completionPoePreviews.length ? (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                            {completionPoePreviews.map(preview => (
                                                                <div
                                                                    key={preview.uid}
                                                                    style={{
                                                                        position: 'relative',
                                                                        width: 112,
                                                                        minHeight: 72,
                                                                        borderRadius: 10,
                                                                        border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#e8ecf3'}`,
                                                                        background: isDark ? 'rgba(255,255,255,0.035)' : '#fafbfc',
                                                                        padding: 8,
                                                                        display: 'flex',
                                                                        flexDirection: 'column',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        gap: 4
                                                                    }}
                                                                >
                                                                    {preview.url ? (
                                                                        <img
                                                                            src={preview.url}
                                                                            alt={preview.name}
                                                                            style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }}
                                                                        />
                                                                    ) : (
                                                                        <span style={{ fontSize: 24, color: '#8c8c8c' }}>
                                                                            {getProgressFileIcon(preview.name, preview.type)}
                                                                        </span>
                                                                    )}
                                                                    <Text
                                                                        type="secondary"
                                                                        ellipsis={{ tooltip: preview.name }}
                                                                        style={{ fontSize: 10, width: '100%', textAlign: 'center' }}
                                                                    >
                                                                        {preview.name}
                                                                    </Text>
                                                                    <Button
                                                                        type="text"
                                                                        size="small"
                                                                        icon={<CloseOutlined style={{ fontSize: 9, color: '#fff' }} />}
                                                                        onClick={() => setCompletionPoeFiles(files =>
                                                                            files.filter(file => String(file?.uid || '') !== preview.uid)
                                                                        )}
                                                                        style={{
                                                                            position: 'absolute',
                                                                            top: 3,
                                                                            right: 3,
                                                                            width: 17,
                                                                            height: 17,
                                                                            minWidth: 17,
                                                                            padding: 0,
                                                                            borderRadius: 9,
                                                                            background: 'rgba(0,0,0,0.58)'
                                                                        }}
                                                                    />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                </>
                                            ) : null}

                                            {progressModalStep === 3 ? (
                                                <>
                                                    <div style={{ textAlign: 'center', paddingInline: 12 }}>
                                                        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
                                                            <TypedText
                                                                play={`mov-${completionChatTurn}`}
                                                                text={progressRecord?.isGroupedDisplay
                                                                    ? `POE is ready. Now upload the signed MOV for each SME who received this intervention. The POE stays shared; each SME gets their own MOV.`
                                                                    : 'POE is ready. Last thing: upload the signed MOV for this SME, then the intervention can be finalised.'}
                                                            />
                                                        </Text>
                                                    </div>

                                                    <Card
                                                        size="small"
                                                        styles={{ body: { padding: 10 } }}
                                                        style={{ borderRadius: 12 }}
                                                    >
                                                        <Space size={8} wrap>
                                                            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                                                                {completionCurrentPoes.length + selectedProgressPoeUrls.length + completionPoeFiles.length} shared POE
                                                                {completionCurrentPoes.length + selectedProgressPoeUrls.length + completionPoeFiles.length === 1 ? '' : 's'}
                                                            </Tag>
                                                            <Tag
                                                                color={completionMovUploadedCount === completionMovAssignments.length ? 'green' : 'gold'}
                                                                style={{ marginInlineEnd: 0 }}
                                                            >
                                                                MOVs {completionMovUploadedCount}/{completionMovAssignments.length}
                                                            </Tag>
                                                            {completionMovExcludedAssignments.length ? (
                                                                <Tag style={{ marginInlineEnd: 0 }}>
                                                                    {completionMovExcludedAssignments.length} no MOV required
                                                                </Tag>
                                                            ) : null}
                                                        </Space>
                                                    </Card>

                                                    {completionMovExcludedAssignments.length ? (
                                                        <Alert
                                                            type="info"
                                                            showIcon
                                                            message={`${completionMovExcludedAssignments.length} SME${completionMovExcludedAssignments.length === 1 ? '' : 's'} did not receive this intervention, so no MOV is required for ${completionMovExcludedAssignments.length === 1 ? 'that SME' : 'them'}.`}
                                                        />
                                                    ) : null}

                                                    {completionMovAssignments.length ? (
                                                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                                            {completionMovAssignments.map(assignment => {
                                                                const selectedFile = completionMovFilesByAssignment[assignment.id]
                                                                const rawFile = selectedFile?.originFileObj || selectedFile
                                                                const fileName = String(rawFile?.name || '')
                                                                const participantName =
                                                                    assignment.participantName ||
                                                                    assignment.beneficiaryName ||
                                                                    assignment.participantId ||
                                                                    'SME'

                                                                return (
                                                                    <Card
                                                                        key={assignment.id}
                                                                        size="small"
                                                                        styles={{ body: { padding: 10 } }}
                                                                        style={{
                                                                            borderRadius: 11,
                                                                            borderColor: selectedFile
                                                                                ? isDark ? 'rgba(82,196,26,0.30)' : '#b7eb8f'
                                                                                : undefined
                                                                        }}
                                                                    >
                                                                        <div
                                                                            style={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: 10,
                                                                                width: '100%',
                                                                                minWidth: 0
                                                                            }}
                                                                        >
                                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                                <Text
                                                                                    strong
                                                                                    ellipsis={{ tooltip: participantName }}
                                                                                    style={{ display: 'block' }}
                                                                                >
                                                                                    {participantName}
                                                                                </Text>
                                                                                {progressRecord?.isGroupedDisplay ? (
                                                                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                                                                        {/*
                                                                                          Out of the sessions that actually
                                                                                          ran, not the original plan - this
                                                                                          number is now driving an MOV
                                                                                          decision, so it has to be the real
                                                                                          denominator.
                                                                                        */}
                                                                                        {formatAttendance(
                                                                                            getAttendedSessions(assignment),
                                                                                            detailsSessionRows.filter(row => row.held === true).length ||
                                                                                            detailsSessionRows.length ||
                                                                                            Math.max(1, getGroupPlannedSessions(progressRecord))
                                                                                        )}
                                                                                    </Text>
                                                                                ) : null}
                                                                            </div>

                                                                            <Tag
                                                                                color={selectedFile ? 'green' : 'gold'}
                                                                                style={{ marginInlineEnd: 0, flex: '0 0 auto' }}
                                                                            >
                                                                                {selectedFile ? 'MOV ready' : 'MOV required'}
                                                                            </Tag>

                                                                            <Upload
                                                                                maxCount={1}
                                                                                showUploadList={false}
                                                                                beforeUpload={() => false}
                                                                                fileList={selectedFile ? [selectedFile] : []}
                                                                                onChange={({ fileList }) => {
                                                                                    const nextFile = fileList.slice(-1)[0]
                                                                                    setCompletionMovFilesByAssignment(current => {
                                                                                        const next = { ...current }
                                                                                        if (nextFile) next[assignment.id] = nextFile
                                                                                        else delete next[assignment.id]
                                                                                        return next
                                                                                    })
                                                                                }}
                                                                                accept=".pdf,.doc,.docx"
                                                                            >
                                                                                <Button
                                                                                    size="small"
                                                                                    icon={<UploadOutlined />}
                                                                                >
                                                                                    {selectedFile ? 'Replace' : 'Upload MOV'}
                                                                                </Button>
                                                                            </Upload>
                                                                        </div>

                                                                        {selectedFile ? (
                                                                            <div
                                                                                style={{
                                                                                    marginTop: 8,
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: 8,
                                                                                    padding: '6px 8px',
                                                                                    borderRadius: 8,
                                                                                    background: isDark ? 'rgba(82,196,26,0.07)' : '#f6ffed'
                                                                                }}
                                                                            >
                                                                                <span style={{ color: '#52c41a', fontSize: 18 }}>
                                                                                    {getProgressFileIcon(fileName, rawFile?.type)}
                                                                                </span>
                                                                                <Text
                                                                                    ellipsis={{ tooltip: fileName }}
                                                                                    style={{ flex: 1, minWidth: 0, fontSize: 12 }}
                                                                                >
                                                                                    {fileName}
                                                                                </Text>
                                                                                <Button
                                                                                    type="text"
                                                                                    size="small"
                                                                                    danger
                                                                                    icon={<CloseOutlined />}
                                                                                    aria-label={`Remove MOV for ${participantName}`}
                                                                                    onClick={() => setCompletionMovFilesByAssignment(current => {
                                                                                        const next = { ...current }
                                                                                        delete next[assignment.id]
                                                                                        return next
                                                                                    })}
                                                                                />
                                                                            </div>
                                                                        ) : null}
                                                                    </Card>
                                                                )
                                                            })}
                                                        </Space>
                                                    ) : (
                                                        <Alert
                                                            type="warning"
                                                            showIcon
                                                            message="No SME currently requires an MOV for this delivery."
                                                        />
                                                    )}

                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'flex-end',
                                                            width: '100%',
                                                            border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#e8ecf3'}`,
                                                            borderRadius: 12,
                                                            padding: '8px 11px',
                                                            background: isDark ? 'rgba(255,255,255,0.02)' : '#fff'
                                                        }}
                                                    >
                                                        <Form.Item name="notes" noStyle>
                                                            <Input.TextArea
                                                                autoSize={{ minRows: 1, maxRows: 4 }}
                                                                variant="borderless"
                                                                placeholder="Optional final note about the completion..."
                                                                style={{ padding: 0, resize: 'none' }}
                                                            />
                                                        </Form.Item>
                                                    </div>
                                                </>
                                            ) : null}
                                        </Space>
                                    </Form>
                                )}
                            </Modal>

                            <Modal
                                centered
                                styles={compactModalStyles}
                                open={evidenceModalOpen}
                                title="Proof of Execution / Evidence"
                                footer={[
                                    <Button
                                        key="close"
                                        danger
                                        onClick={() => {
                                            setEvidenceModalOpen(false)
                                            setEvidencePoePage(1)
                                        }}
                                    >
                                        Close
                                    </Button>
                                ]}
                                onCancel={() => {
                                    setEvidenceModalOpen(false)
                                    setEvidencePoePage(1)
                                }}
                            >
                                {!evidenceRecord || evidenceEntries.length === 0 ? (
                                    <Empty description="No evidence found for this intervention" />
                                ) : (
                                    <Space direction="vertical" style={{ width: '100%' }} size={10}>
                                        <Card
                                            size="small"
                                            styles={{ body: { padding: 10 } }}
                                            style={{ background: '#fafafa' }}
                                        >
                                            <Space direction="vertical" style={{ width: '100%' }}>
                                                <Text strong>
                                                    {evidenceRecord.participantName ||
                                                        evidenceRecord.beneficiaryName ||
                                                        evidenceRecord.participantId ||
                                                        '-'}
                                                </Text>

                                                <Text type="secondary">
                                                    {evidenceRecord.interventionTitle || 'Untitled intervention'}
                                                </Text>
                                            </Space>
                                        </Card>

                                        <Row gutter={[0, 12]}>
                                            <Col span={24}>
                                                {pagedEvidenceEntries.map(entry => (
                                                    <Card
                                                        key={entry.value}
                                                        size="small"
                                                        style={{
                                                            borderRadius: 8,
                                                            border: '1px solid #f0f0f0',
                                                            marginBottom: 8
                                                        }}
                                                    >
                                                        <Space direction="vertical" style={{ width: '100%' }} size={6}>
                                                            <Text strong>{entry.label}</Text>
                                                            {entry.originalName ? (
                                                                <Text type="secondary">{entry.originalName}</Text>
                                                            ) : null}

                                                            {entry.value.startsWith('http') ? (
                                                                <Button
                                                                    variant="filled"
                                                                    color="green"
                                                                    style={{ border: '1px solid limegreen' }}
                                                                    icon={<EyeOutlined />}
                                                                    onClick={() => window.open(entry.value, '_blank')}
                                                                >
                                                                    View POE
                                                                </Button>
                                                            ) : (
                                                                <Space>
                                                                    <FileOutlined />
                                                                    <Text>{entry.value}</Text>
                                                                </Space>
                                                            )}
                                                        </Space>
                                                    </Card>
                                                ))}

                                                {evidenceEntries.length > POE_PAGE_SIZE ? (
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            justifyContent: 'center',
                                                            marginTop: 16
                                                        }}
                                                    >
                                                        <Pagination
                                                            current={evidencePoePage}
                                                            pageSize={POE_PAGE_SIZE}
                                                            total={evidenceEntries.length}
                                                            showSizeChanger={false}
                                                            onChange={setEvidencePoePage}
                                                        />
                                                    </div>
                                                ) : null}
                                            </Col>
                                        </Row>
                                    </Space>
                                )}
                            </Modal>

                            <Modal
                                centered
                                styles={compactModalStyles}
                                open={overdueModalOpen}
                                title="Overdue Reason"
                                onCancel={() => {
                                    setOverdueModalOpen(false)
                                    setOverdueRecord(null)
                                    overdueForm.resetFields()
                                }}
                                onOk={() => overdueForm.submit()}
                                confirmLoading={savingOverdue}
                                destroyOnClose
                            >
                                {overdueRecord ? (
                                    <>
                                        <Space direction="vertical" style={{ width: '100%' }} size={5}>
                                            <Text strong>
                                                {overdueRecord.participantName ||
                                                    overdueRecord.beneficiaryName ||
                                                    overdueRecord.participantId ||
                                                    '-'}
                                            </Text>
                                            <Text>{overdueRecord.interventionTitle || 'Untitled intervention'}</Text>
                                            <Text type="secondary">Due: {formatDate(overdueRecord.dueDate)}</Text>

                                            {getSmeAcceptance(overdueRecord) !== 'accepted' && (
                                                <Alert
                                                    type="warning"
                                                    showIcon
                                                    message="SME has not accepted this intervention"
                                                    description={
                                                        <span>
                                                            Current SME status: <b>{overdueRecord.participantAcceptanceStatus || 'unknown'}</b>
                                                        </span>
                                                    }
                                                />
                                            )}
                                        </Space>

                                        <Form
                                            form={overdueForm}
                                            layout="vertical"
                                            style={{ marginTop: 10 }}
                                            onFinish={async values => {
                                                if (!overdueRecord) return
                                                try {
                                                    const user = auth.currentUser
                                                    if (!user?.email) {
                                                        message.error('You must be logged in.')
                                                        return
                                                    }

                                                    setSavingOverdue(true)

                                                    const entry = {
                                                        createdAt: Timestamp.now(),
                                                        createdByEmail: user.email,
                                                        reason: String(values.reason || '').trim(),
                                                        comments: String(values.comments || '').trim(),
                                                        smeNotAccepted: getSmeAcceptance(overdueRecord) !== 'accepted',
                                                        participantAcceptanceStatus: overdueRecord.participantAcceptanceStatus || null,
                                                        dueDate: overdueRecord.dueDate || null
                                                    }

                                                    if (!entry.reason) {
                                                        message.warning('Please enter a reason.')
                                                        return
                                                    }

                                                    const targetIds =
                                                        overdueRecord.isGroupedDisplay
                                                            ? (overdueRecord.memberIds || [])
                                                            : [overdueRecord.id]

                                                    await Promise.all(
                                                        targetIds.map(id =>
                                                            updateDoc(doc(db, 'assignedInterventions', id), {
                                                                overdue: { ...entry, updatedAt: Timestamp.now() },
                                                                overdueReasons: arrayUnion(entry),
                                                                updatedAt: Timestamp.now()
                                                            })
                                                        )
                                                    )

                                                    message.success('Overdue reason saved.')
                                                    setOverdueModalOpen(false)
                                                    setOverdueRecord(null)
                                                    overdueForm.resetFields()
                                                } catch (err) {
                                                    console.error(err)
                                                    message.error('Failed to save overdue reason.')
                                                } finally {
                                                    setSavingOverdue(false)
                                                }
                                            }}
                                        >
                                            <Form.Item
                                                name="reason"
                                                label="Reason"
                                                rules={[{ required: true, message: 'Please provide a reason.' }]}
                                            >
                                                <Input placeholder="e.g. Awaiting appointment response / Delayed by client / Resource constraints..." />
                                            </Form.Item>

                                            <Form.Item name="comments" label="Optional comments / explanation">
                                                <Input.TextArea rows={3} placeholder="Add any context (optional)..." />
                                            </Form.Item>
                                        </Form>
                                    </>
                                ) : (
                                    <Empty description="No overdue record selected" />
                                )}
                            </Modal>

                            <ResolveQueryModal
                                open={poeUploadModalOpen}
                                query={selectedQueryForResolution}
                                actor={{
                                    id: effectiveUser?.uid || effectiveUser?.id || '',
                                    name: effectiveUser?.name || effectiveUser?.displayName || null,
                                    email: effectiveUser?.email || null,
                                    role: effectiveUser?.role || 'coordinator',
                                    departmentName: effectiveUser?.departmentName || null
                                }}
                                onClose={() => {
                                    setPoeUploadModalOpen(false)
                                    setSelectedRecord(null)
                                    setSelectedQueryForResolution(null)
                                }}
                                onResolved={async () => {
                                    if (selectedRecord) {
                                        const rows = await fetchQueriesForIntervention(selectedRecord)
                                        setRecordQueriesLocally(selectedRecord.id, rows)
                                        if (queriesModalScope === 'open') {
                                            setSelectedQueries(previous => {
                                                const refreshed = new Map(rows.map(row => [row.id, row]))
                                                return previous
                                                    .map(row => refreshed.get(row.id) || row)
                                                    .filter(row => isOpenQuery(row.status))
                                            })
                                        } else {
                                            setSelectedQueries(rows)
                                        }
                                    }
                                    setPoeUploadModalOpen(false)
                                    setSelectedRecord(null)
                                    setSelectedQueryForResolution(null)
                                }}
                            />

                            <Modal
                                className="guide-manage-evidence-modal"
                                centered
                                styles={compactModalStyles}
                                open={manageEvidenceOpen}
                                title={
                                    manageEvidenceRecord && isDocumentTarget(manageEvidenceRecord)
                                        ? 'Manage Documents'
                                        : 'Manage POE'
                                }
                                onCancel={() => {
                                    setManageEvidenceOpen(false)
                                    setManageEvidenceRecord(null)
                                    setGroupEvidenceMode('bulk')
                                    setGroupEvidenceMemberId(undefined)
                                    setManageEvidencePoePage(1)

                                    manageEvidenceForm.resetFields()
                                }}
                                footer={(
                                    <Row gutter={[12, 12]} style={{ width: '100%' }}>
                                        {(manageEvidenceRecord as DisplayIntervention)?.isGroupedDisplay && groupEvidenceMode === 'single' ? (
                                            <Col span={24}>
                                                <Button
                                                    block
                                                    type="primary"
                                                    shape="round"
                                                    icon={<UploadOutlined />}
                                                    loading={savingEvidence}
                                                    disabled={!groupEvidenceMemberId || !pendingEvidenceFiles.length}
                                                    onClick={() => void submitManageEvidence(manageEvidenceForm.getFieldsValue(true))}
                                                >
                                                    Upload selected files ({pendingEvidenceFiles.length})
                                                </Button>
                                            </Col>
                                        ) : null}
                                        <Col span={24}>
                                            <Button
                                                danger
                                                block
                                                shape="round"
                                                onClick={() => {
                                                    setManageEvidenceOpen(false)
                                                    setManageEvidenceRecord(null)
                                                    manageEvidenceForm.resetFields()
                                                }}>
                                                Close
                                            </Button>
                                        </Col>
                                    </Row>
                                )}
                                destroyOnClose
                            >
                                {manageEvidenceRecord ? (
                                    <Form
                                        form={manageEvidenceForm}
                                        layout="vertical"
                                        onFinish={submitManageEvidence}
                                        onFinishFailed={showEvidenceValidationError}
                                        scrollToFirstError
                                    >
                                        <Space direction="vertical" style={{ width: '100%', marginBottom: 8 }} size={3}>
                                            <Text strong>
                                                {(manageEvidenceRecord as DisplayIntervention).isGroupedDisplay
                                                    ? `${manageEvidenceRecord.interventionTitle || 'Untitled intervention'} · SMEs: ${(manageEvidenceRecord as DisplayIntervention).memberCount || 0}`
                                                    : manageEvidenceRecord.participantName || manageEvidenceRecord.beneficiaryName || manageEvidenceRecord.participantId || '-'}
                                            </Text>
                                            {(manageEvidenceRecord as DisplayIntervention).isGroupedDisplay && manageEvidenceRecord.subInterventionTitle ? (
                                                <Text type="secondary">{manageEvidenceRecord.subInterventionTitle}</Text>
                                            ) : !((manageEvidenceRecord as DisplayIntervention).isGroupedDisplay) ? (
                                                <Text type="secondary">{manageEvidenceRecord.interventionTitle || 'Untitled intervention'}</Text>
                                            ) : null}
                                        </Space>

                                        {(manageEvidenceRecord as DisplayIntervention).isGroupedDisplay && !isDocumentTarget(manageEvidenceRecord) ? (
                                            <>
                                                <div data-guide="group-poe-mode">
                                                    <Form.Item label="Group POE upload mode" style={{ marginBottom: 8 }}>
                                                        <Segmented
                                                            block
                                                            value={groupEvidenceMode}
                                                            onChange={value => {
                                                                const next = value as 'bulk' | 'single'
                                                                setGroupEvidenceMode(next)
                                                                setGroupEvidenceMemberId(undefined)
                                                                manageEvidenceForm.setFieldsValue({ files: [], replaceTarget: undefined })
                                                            }}
                                                            options={[
                                                                { label: 'Bulk Upload', value: 'bulk' },
                                                                { label: 'Single Upload', value: 'single' }
                                                            ]}
                                                        />
                                                    </Form.Item>
                                                </div>
                                                {groupEvidenceMode === 'single' ? (
                                                    <Card size="small" style={{ marginBottom: 12 }}>
                                                        <Table
                                                            size="small"
                                                            rowKey="id"
                                                            pagination={{ pageSize: 6, showSizeChanger: false, position: ['bottomCenter'] }}
                                                            dataSource={(manageEvidenceRecord as DisplayIntervention).members || []}
                                                            columns={[
                                                                {
                                                                    title: 'SME',
                                                                    key: 'sme',
                                                                    render: (_: unknown, member: AssignedIntervention) => (
                                                                        <Text strong>{member.participantName || member.beneficiaryName || member.participantId || member.id}</Text>
                                                                    )
                                                                },
                                                                {
                                                                    title: 'POEs',
                                                                    key: 'poes',
                                                                    width: 90,
                                                                    render: (_: unknown, member: AssignedIntervention) => (
                                                                        <Tag color={getPoeResourcesFromRecord(member).length ? 'green' : 'orange'}>
                                                                            {getPoeResourcesFromRecord(member).length}
                                                                        </Tag>
                                                                    )
                                                                },
                                                                {
                                                                    title: 'Upload',
                                                                    key: 'upload',
                                                                    width: 150,
                                                                    render: (_: unknown, member: AssignedIntervention) => (
                                                                        <Upload
                                                                            multiple
                                                                            showUploadList={false}
                                                                            beforeUpload={(file, selectedFiles) => {
                                                                                // Ant calls this once per file. Store the whole
                                                                                // selection once so batched state updates cannot
                                                                                // discard all but the last selected file.
                                                                                if (file !== selectedFiles[0]) return false
                                                                                const switchingMember = groupEvidenceMemberId && groupEvidenceMemberId !== member.id
                                                                                setGroupEvidenceMemberId(member.id)
                                                                                const existingFiles = switchingMember ? [] : (manageEvidenceForm.getFieldValue('files') || [])
                                                                                const nextFiles = [...existingFiles, ...selectedFiles.map(selected => ({
                                                                                    uid: selected.uid,
                                                                                    name: selected.name,
                                                                                    originFileObj: selected
                                                                                }))].slice(0, 10)
                                                                                setPendingEvidenceFiles(nextFiles.map(item => item.originFileObj || item))
                                                                                manageEvidenceForm.setFieldsValue({
                                                                                    files: nextFiles
                                                                                })
                                                                                return false
                                                                            }}
                                                                            disabled={savingEvidence}
                                                                        >
                                                                            <Button size="small" icon={<UploadOutlined />}>
                                                                                Choose POE
                                                                            </Button>
                                                                        </Upload>
                                                                    )
                                                                }
                                                            ] as ColumnsType<AssignedIntervention>}
                                                            expandable={{
                                                                expandedRowRender: member => {
                                                                    const memberPoes = getPoeResourcesFromRecord(member)
                                                                    return memberPoes.length ? (
                                                                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                                                            <Popconfirm
                                                                                title="Remove all POEs for this SME?"
                                                                                okText="Remove all"
                                                                                cancelText="Cancel"
                                                                                okButtonProps={{ danger: true }}
                                                                                onConfirm={() => removeAllPoe(member)}
                                                                            >
                                                                                <Button size="small" danger loading={deletingPoeUrl === '__all__'}>
                                                                                    Delete all for this SME
                                                                                </Button>
                                                                            </Popconfirm>
                                                                            {memberPoes.map(resource => (
                                                                                <Row key={resource.link} justify="space-between" align="middle" gutter={[8, 8]}>
                                                                                    <Col flex="auto" style={{ minWidth: 0 }}>
                                                                                        <Text ellipsis={{ tooltip: resource.originalName || resource.link }}>
                                                                                            {resource.originalName || resource.label || 'POE'}
                                                                                        </Text>
                                                                                    </Col>
                                                                                    <Col>
                                                                                        <Space>
                                                                                            <Button size="small" icon={<EyeOutlined />} onClick={() => window.open(resource.link, '_blank')}>View</Button>
                                                                                            <Popconfirm
                                                                                                title="Remove this POE?"
                                                                                                okText="Remove"
                                                                                                cancelText="Cancel"
                                                                                                okButtonProps={{ danger: true }}
                                                                                                onConfirm={() => removePoe(member, resource.link)}
                                                                                            >
                                                                                                <Button
                                                                                                    size="small"
                                                                                                    danger
                                                                                                    icon={<DeleteOutlined />}
                                                                                                    loading={deletingPoeUrl === resource.link}
                                                                                                    disabled={!!deletingPoeUrl && deletingPoeUrl !== resource.link}
                                                                                                >
                                                                                                    Remove
                                                                                                </Button>
                                                                                            </Popconfirm>
                                                                                        </Space>
                                                                                    </Col>
                                                                                </Row>
                                                                            ))}
                                                                        </Space>
                                                                    ) : <Text type="secondary">No POEs uploaded for this SME.</Text>
                                                                }
                                                            }}
                                                            onRow={member => ({
                                                                onClick: () => {
                                                                    if (groupEvidenceMemberId !== member.id) {
                                                                        setGroupEvidenceMemberId(member.id)
                                                                        manageEvidenceForm.setFieldsValue({ files: [] })
                                                                        setPendingEvidenceFiles([])
                                                                    }
                                                                },
                                                                style: { cursor: 'pointer', background: member.id === groupEvidenceMemberId ? '#e6f4ff' : undefined }
                                                            })}
                                                        />
                                                        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                                                            {groupEvidenceMemberId
                                                                ? 'Files selected for the highlighted SME. Click Upload to save them.'
                                                                : 'Choose a POE in a row, then click Upload below.'}
                                                        </Text>
                                                    </Card>
                                                ) : null}
                                            </>
                                        ) : null}

                                        {!((manageEvidenceRecord as DisplayIntervention).isGroupedDisplay && groupEvidenceMode === 'single') ? (
                                            <>
                                                <input
                                                    ref={manageEvidenceFileInputRef}
                                                    type="file"
                                                    hidden
                                                    multiple
                                                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                                                    onChange={handleManageEvidenceFileSelection}
                                                />
                                                <div data-guide="evidence-manager-content">
                                                    <EvidenceManagerPanel
                                                        participantLabel={manageEvidenceRecord.participantName || manageEvidenceRecord.beneficiaryName}
                                                        interventionLabel={manageEvidenceRecord.interventionTitle}
                                                        resources={manageEvidenceEntries.map(entry => ({
                                                            link: entry.value,
                                                            label: entry.label,
                                                            originalName: entry.originalName
                                                        }))}
                                                        showHeader={false}
                                                        showUpload={false}
                                                        headerActions={
                                                            <Space size={6}>
                                                                {manageEvidenceEntries.length ? (
                                                                    <Popconfirm
                                                                        title="Remove all POEs?"
                                                                        okText="Remove all"
                                                                        cancelText="Cancel"
                                                                        okButtonProps={{ danger: true }}
                                                                        onConfirm={() => removeAllPoe(manageEvidenceRecord)}
                                                                    >
                                                                        <Button
                                                                            data-guide="delete-all-poe-action"
                                                                            size="small"
                                                                            danger
                                                                            shape='round'
                                                                            loading={deletingPoeUrl === '__all__'}
                                                                        >
                                                                            Delete All
                                                                        </Button>
                                                                    </Popconfirm>
                                                                ) : null}
                                                                <Dropdown
                                                                    trigger={['click']}
                                                                    menu={{
                                                                        items: [
                                                                            { key: 'add-new', label: 'Add new' },
                                                                            { key: 'replace-all', label: 'Replace all' }
                                                                        ],
                                                                        onClick: ({ key }) =>
                                                                            openManageEvidenceFilePicker(
                                                                                key === 'replace-all' ? 'all' : undefined
                                                                            )
                                                                    }}
                                                                >
                                                                    <Button
                                                                        data-guide="add-poe-action"
                                                                        size="small"
                                                                        type="primary"
                                                                        shape='round'
                                                                        icon={<UploadOutlined />}
                                                                        loading={savingEvidence}
                                                                    >
                                                                        Add POE
                                                                    </Button>
                                                                </Dropdown>
                                                            </Space>
                                                        }
                                                        onReplace={resource => openManageEvidenceFilePicker(resource.link)}
                                                        onUpload={() => undefined}
                                                        onRemove={resource => isDocumentTarget(manageEvidenceRecord)
                                                            ? removeManagedDocument(manageEvidenceRecord, resource.link)
                                                            : removePoe(manageEvidenceRecord, resource.link)}
                                                        uploading={savingEvidence}
                                                    />
                                                </div>
                                            </>
                                        ) : null}

                                        {false && manageEvidenceEntries.length > 0 ? (
                                            <Card
                                                size="small"
                                                style={{ background: '#fafafa', marginBottom: 12 }}
                                                title={
                                                    <Text type="secondary">
                                                        Currently on file ({manageEvidenceEntries.length})
                                                    </Text>
                                                }
                                            >
                                                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                                                    {pagedManageEvidenceEntries.map(entry => (
                                                        <Card
                                                            key={entry.value}
                                                            size="small"
                                                            style={{
                                                                width: '100%',
                                                                borderRadius: 8,
                                                                border: '1px solid #f0f0f0'
                                                            }}
                                                        >
                                                            <Row
                                                                gutter={[12, 8]}
                                                                align="middle"
                                                                justify="space-between"
                                                            >
                                                                <Col flex="auto" style={{ minWidth: 0 }}>
                                                                    <Text strong>{entry.label}</Text>
                                                                    {entry.originalName ? (
                                                                        <Text
                                                                            type="secondary"
                                                                            ellipsis={{ tooltip: entry.originalName }}
                                                                            style={{ display: 'block', maxWidth: 360 }}
                                                                        >
                                                                            {entry.originalName}
                                                                        </Text>
                                                                    ) : null}
                                                                </Col>

                                                                <Col>
                                                                    <Space wrap>
                                                                        {entry.value.startsWith('http') ? (
                                                                            <Button
                                                                                size="small"
                                                                                variant="filled"
                                                                                color="green"
                                                                                shape='round'
                                                                                style={{ border: '1px solid limegreen' }}
                                                                                icon={<EyeOutlined />}
                                                                                onClick={() => window.open(entry.value, '_blank')}
                                                                            >
                                                                                View
                                                                            </Button>
                                                                        ) : null}

                                                                        {entry.removable && manageEvidenceRecord ? (
                                                                            <Popconfirm
                                                                                title={`Remove ${entry.label}?`}
                                                                                description="This removes the POE reference from the intervention and MOV evidence list."
                                                                                okText="Remove"
                                                                                cancelText="Cancel"
                                                                                okButtonProps={{ danger: true }}
                                                                                onConfirm={() => isDocumentTarget(manageEvidenceRecord)
                                                                                    ? removeManagedDocument(manageEvidenceRecord, entry.value)
                                                                                    : removePoe(manageEvidenceRecord, entry.value)}
                                                                            >
                                                                                <Button
                                                                                    size="small"
                                                                                    danger
                                                                                    shape='round'
                                                                                    icon={<DeleteOutlined />}
                                                                                    loading={deletingPoeUrl === entry.value}
                                                                                    disabled={
                                                                                        !!deletingPoeUrl &&
                                                                                        deletingPoeUrl !== entry.value
                                                                                    }
                                                                                >
                                                                                    Remove
                                                                                </Button>
                                                                            </Popconfirm>
                                                                        ) : null}
                                                                    </Space>
                                                                </Col>
                                                            </Row>
                                                        </Card>
                                                    ))}

                                                    {manageEvidenceEntries.length > POE_PAGE_SIZE ? (
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                justifyContent: 'center',
                                                                width: '100%',
                                                                marginTop: 8
                                                            }}
                                                        >
                                                            <Pagination
                                                                current={manageEvidencePoePage}
                                                                pageSize={POE_PAGE_SIZE}
                                                                total={manageEvidenceEntries.length}
                                                                showSizeChanger={false}
                                                                onChange={setManageEvidencePoePage}
                                                            />
                                                        </div>
                                                    ) : null}
                                                </Space>
                                            </Card>
                                        ) : null}

                                        {(manageEvidenceRecord as any)?.isSensitive && USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE && !isDocumentTarget(manageEvidenceRecord) ? (
                                            <Form.Item name="evidenceMode" initialValue={evidenceMode}>
                                                <Segmented
                                                    block
                                                    value={evidenceMode}
                                                    onChange={v => {
                                                        const next = v as 'file' | 'summary'
                                                        setEvidenceMode(next)
                                                        manageEvidenceForm.setFieldsValue({ evidenceMode: next, files: [] })
                                                    }}
                                                    options={[
                                                        { label: 'Upload File', value: 'file' },
                                                        { label: 'Write Summary', value: 'summary' },
                                                        { label: 'File + Summary', value: 'both' }
                                                    ]}
                                                />
                                            </Form.Item>
                                        ) : null}

                                    </Form>
                                ) : (
                                    <Empty description="No intervention selected" />
                                )}
                            </Modal>

                            <Modal
                                centered
                                styles={compactModalStyles}
                                open={queriesModalOpen}
                                title={queriesModalScope === 'open'
                                    ? `Open Queries (${selectedQueries.length})`
                                    : 'Intervention Queries'}
                                onCancel={closeQueriesModal}
                                footer={[
                                    <Button
                                        key="close"
                                        danger
                                        onClick={closeQueriesModal}
                                    >
                                        Close
                                    </Button>
                                ]}
                                width={isMobile ? '100%' : 820}
                                destroyOnClose
                            >
                                {queriesLoading ? (
                                    <LoadingOverlay tip="Loading queries..." />
                                ) : selectedQueries.length > 0 ? (
                                    <List
                                        dataSource={selectedQueries}
                                        pagination={{
                                            pageSize: 5,
                                            showSizeChanger: false,
                                            position: 'bottom',
                                            align: 'center'
                                        }}
                                        renderItem={item => {
                                            const queryRecord = selectedQueryRecord || findRecordForQuery(item)
                                            return (
                                                <List.Item>
                                                    <Descriptions
                                                        bordered
                                                        size="small"
                                                        column={isMobile ? 1 : 2}
                                                        style={{ width: '100%' }}
                                                        items={[
                                                            {
                                                                key: 'sme',
                                                                label: 'SME',
                                                                children: queryRecord?.participantName ||
                                                                    queryRecord?.beneficiaryName ||
                                                                    queryRecord?.participantId || '-'
                                                            },
                                                            {
                                                                key: 'intervention',
                                                                label: 'Intervention',
                                                                children: queryRecord?.interventionTitle || '-'
                                                            },
                                                            {
                                                                key: 'type',
                                                                label: 'Type',
                                                                children: item.queryType || '-'
                                                            },
                                                            {
                                                                key: 'status',
                                                                label: 'Status',
                                                                children: (
                                                                    <Tag color={isOpenQuery(item.status) ? 'orange' : 'green'}>
                                                                        {item.status || 'unknown'}
                                                                    </Tag>
                                                                )
                                                            },
                                                            {
                                                                key: 'created',
                                                                label: 'Created At',
                                                                children: formatDateTime(item.createdAt)
                                                            },
                                                            {
                                                                key: 'updated',
                                                                label: 'Updated At',
                                                                children: formatDateTime(item.updatedAt)
                                                            },
                                                            {
                                                                key: 'message',
                                                                label: 'Message',
                                                                span: 2,
                                                                children: item.queryMessage || '-'
                                                            },
                                                            {
                                                                key: 'notes',
                                                                label: 'Resolution Notes',
                                                                span: 2,
                                                                children: item.resolutionNotes || '-'
                                                            },
                                                            {
                                                                key: 'file',
                                                                label: 'Uploaded File',
                                                                span: 2,
                                                                children: item.uploadedFileUrl ? (
                                                                    <Button
                                                                        shape="round"
                                                                        variant="filled"
                                                                        color="green"
                                                                        style={{ border: '1px solid limegreen' }}
                                                                        icon={<EyeOutlined />}
                                                                        onClick={() => window.open(item.uploadedFileUrl!, '_blank')}
                                                                    >
                                                                        View File
                                                                    </Button>
                                                                ) : (
                                                                    <Text type="secondary">No file uploaded</Text>
                                                                )
                                                            },
                                                            {
                                                                key: 'action',
                                                                label: 'Action',
                                                                span: 2,
                                                                children: isOpenQuery(item.status)
                                                                    ? queryRecord ? (
                                                                        <Button
                                                                            type="primary"
                                                                            shape="round"
                                                                            icon={<UploadOutlined />}
                                                                            onClick={() => openPoeResolveModal(queryRecord, item)}
                                                                        >
                                                                            Upload POE & Resolve
                                                                        </Button>
                                                                    ) : (
                                                                        <Tag>Intervention unavailable</Tag>
                                                                    )
                                                                    : <Tag color="green">Resolved</Tag>
                                                            }
                                                        ]}
                                                    />
                                                </List.Item>
                                            )
                                        }}
                                    />
                                ) : (
                                    <Empty description={queriesModalScope === 'open'
                                        ? 'No open queries found'
                                        : 'No queries found for this intervention'} />
                                )}
                            </Modal>
                        </MotionCard>
                    </>
                )}
        </div>
    )
}

export default CoordinatorAllocatedInterventions
