import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Segmented,
    Skeleton,
    Tag,
    Space,
    Typography,
    Empty,
    Row,
    Col,
    Input,
    Button,
    Modal,
    App,
    Form,
    Upload,
    message,
    Alert,
    Avatar,
    Card,
    Rate,
    Grid,
    List,
    Progress,
    DatePicker,
    Dropdown,
    Collapse,
    Tooltip,
    Slider,
    Pagination,
    Popconfirm,
    Badge,
    Drawer,
    Popover
} from 'antd'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { FilterPanel } from '@/components/workspace'
import { QueryInbox } from '@/components/queries/QueryInbox'
import { isCatchingUp } from '@/services/deliveryDisputeService'
import { StatusPill } from '@/routes/operations/movs/movParts'
import { QueryThread } from '@/routes/operations/movs/MovQueries'
import '@/routes/operations/movs/movs.css'
import '@/components/queries/choice-cards.css'
import './allocated.css'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    CalendarOutlined,
    TeamOutlined,
    FileProtectOutlined,
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
    BellOutlined,
    SearchOutlined,
    FilterOutlined,
    SendOutlined,
    QuestionCircleOutlined,
    CloseOutlined,
    EnvironmentOutlined,
    VideoCameraOutlined,
    PlusOutlined,
    HistoryOutlined,
    ArrowRightOutlined,
    ArrowLeftOutlined
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
    QueryConstraint
} from 'firebase/firestore'
import { db, auth, storage } from '@/firebase'
import SetupSegmented from '@/components/shared/SetupSegmented'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import dayjs, { Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'
import { useLocation, useNavigate } from 'react-router-dom'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import EvidenceManagerPanel from '@/components/evidence/EvidenceManagerPanel'
import { USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE } from '@/config/evidencePolicy'
import { DEFAULT_EVIDENCE_MODEL, resolveDeliverableName } from '@/services/evidenceModel'
import EvidenceFileRow from '@/components/interventions/EvidenceFileRow'
import { EvidenceCardTitle, evidenceCardProps, pillTag } from '@/components/interventions/EvidenceCardTitle'
import IncubateeBanner from '@/components/interventions/IncubateeBanner'
import ManageMovCard from '@/components/interventions/ManageMovCard'
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
import { functionsBaseUrl } from '@/firebaseConfig'

const { Text, Title } = Typography
const { RangePicker } = DatePicker
const POE_PAGE_SIZE = 4
const LIST_PAGE_SIZE = 10

/** The facilitator's view of an intervention: what (if anything) they have to do next. */
type WorkStatus = 'needs-you' | 'in-delivery' | 'awaiting' | 'done' | 'all'
const WORK_SEGMENTS: { value: WorkStatus; label: string; tone: string }[] = [
    { value: 'needs-you', label: 'Needs you', tone: 'danger' },
    { value: 'in-delivery', label: 'In delivery', tone: 'info' },
    { value: 'awaiting', label: 'Awaiting sign-off', tone: 'warning' },
    { value: 'done', label: 'Done', tone: 'success' },
    { value: 'all', label: 'All', tone: 'neutral' }
]

/** A document on a documents-mode intervention (stored like a resource). */
type EvidenceDoc = Resource & Record<string, any>

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
    type?: string
    queryMessage?: string
    status?: 'open' | 'answered' | 'resolved' | string
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

/**
 * Delivery re-opened by an SME dispute: the SME rejected completion, or the
 * facilitator chose to deliver what's missing (or the HOD sided with the SME).
 * It isn't finished, whatever computedProgress says from before.
 */
const isReopenedDelivery = (r: AssignedIntervention) => {
    const anyR = r as any
    if (String(anyR.participantCompletionStatus || '').toLowerCase() === 'rejected') return true
    const dispute = String(anyR.deliveryDispute?.status || '').toLowerCase()
    return ['redelivering', 'sme-upheld'].includes(dispute) && String(anyR.assigneeCompletionStatus || '').toLowerCase() !== 'completed'
}

/**
 * Where a re-opened delivery stands: the updates logged since it was last
 * completed, or, until there are any, the last update before that completion
 * (e.g. 80%). The next update then shows what was redelivered.
 */
const reopenedProgress = (r: AssignedIntervention) => {
    const anyR = r as any
    const updates = (r.progressUpdates || [])
        .filter(u => Number.isFinite(Number(u.computedProgress)))
        .map(u => ({ at: toJsDate(u.createdAt)?.getTime() || 0, value: clampPercent(Number(u.computedProgress)) }))
        .sort((a, b) => a.at - b.at)
    // When it was re-opened: the facilitator's "deliver what's missing" (or the HOD's decision), else the SME's rejection.
    const reopenedAt =
        toJsDate(anyR.deliveryDispute?.at)?.getTime() ||
        toJsDate(anyR.participantCompletionRejectedAt)?.getTime() ||
        0
    const since = reopenedAt ? updates.filter(u => u.at > reopenedAt) : []
    // Logged since: that's where the redelivery stands, up to 100% so it can be submitted again.
    if (since.length) return Math.max(...since.map(u => u.value))
    // A catch-up within a group: its own updates start where the group was before completion.
    if (Number.isFinite(Number(anyR.catchUp?.fromProgress)) && anyR.catchUp?.status === 'active') return clampPercent(Number(anyR.catchUp.fromProgress))
    const before = updates.filter(u => (!reopenedAt || u.at <= reopenedAt) && u.value < 100)
    return before.length ? before[before.length - 1].value : 0
}

const getProgressPercent = (r: AssignedIntervention) => {
    if (isReopenedDelivery(r)) return reopenedProgress(r)
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
const legacyGroupProgressFallback = (members: AssignedIntervention[]) => {
    const open = members.filter(m => !resolveAssignmentLifecycle(m).isCompleted)
    // Every member done: the delivery is done. Otherwise only the open members say how far it got.
    return open.length ? clampPercent(Math.max(0, ...open.map(getProgressPercent))) : 100
}

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
    // Cancelled or waiting for reassignment: nobody owes anything.
    if (!resolveAssignmentLifecycle(record).isOpen) return false
    const due = toJsDate(record.dueDate)
    if (!due) return false
    return dayjs(due).isBefore(dayjs(), 'day')
}

/** The MOVs issued for these assignments. */
const movsForAssignments = async (assignmentIds: string[]) => {
    const found: { id: string; data: any }[] = []
    for (let at = 0; at < assignmentIds.length; at += 10) {
        const snap = await getDocs(query(collection(db, 'movDocuments'), where('assignedInterventionId', 'in', assignmentIds.slice(at, at + 10))))
        snap.docs.forEach(d => found.push({ id: d.id, data: d.data() }))
    }
    return found
}

/** Evidence an approved MOV was approved on can't be taken away. */
const anyMovApproved = (movs: { data: any }[]) => movs.some(m => m.data?.approvedByHod === true || String(m.data?.status || '') === 'approved')

/** Takes removed evidence off the (unapproved) MOVs too, so no MOV or pack points at a file that's gone. */
const pruneMovEvidence = async (movs: { id: string; data: any }[], links: string[] | 'all') => {
    const drop = (value: any) => {
        const link = String(typeof value === 'string' ? value : value?.link || value?.url || '').trim()
        return links === 'all' ? true : links.includes(link)
    }
    await Promise.all(movs.filter(m => !anyMovApproved([m])).map(m => {
        const patch: Record<string, any> = { updatedAt: Timestamp.now() }
        for (const field of ['resources', 'poeEvidence', 'poeUrls']) {
            if (Array.isArray(m.data?.[field])) patch[field] = m.data[field].filter((v: any) => !drop(v))
        }
        return updateDoc(doc(db, 'movDocuments', m.id), patch).catch(error => console.warn('MOV evidence not pruned', m.id, error))
    }))
}

/** POEs uploaded for one SME of a group ("Single upload"): theirs alone, never the group's. */
const memberOwnUploads = (group: DisplayIntervention | null | undefined, member: AssignedIntervention): Resource[] => {
    const updates = (group?.groupDelivery?.progressUpdates || []) as any[]
    const mine = new Set(updates
        .filter(u => u?.type === 'evidence-uploaded-single' && String(u?.participantId || '') === String(member.participantId || ''))
        .flatMap(u => (u.resources || []).map((r: any) => String(r?.link || ''))))
    return getPoeResourcesFromRecord(member).filter(r => mine.has(String(r.link || ''))) as Resource[]
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


type DisplayStatus =
    | 'disputed'
    | 'closed'
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
        // The SME disputed completion: the facilitator has to respond.
        if (lifecycle.key === 'participant-rejected') return 'disputed'
        if (!lifecycle.isOpen) return 'closed'
        if (lifecycle.key === 'awaiting-participant-acceptance') return 'awaiting-response'
        if (lifecycle.key === 'awaiting-participant-confirmation') return 'awaiting-confirmation'
        if (lifecycle.key === 'in-delivery') return 'in-delivery'
        return 'active'
    }

    const members = record.members || []
    if (!members.length) return 'active'
    if (members.every(m => !resolveAssignmentLifecycle(m).isOpen && !resolveAssignmentLifecycle(m).isCompleted)) return 'closed'
    // Any SME disputing completion is the facilitator's next job, whatever the rest are doing.
    if (members.some(m => resolveAssignmentLifecycle(m).key === 'participant-rejected')) return 'disputed'

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

/** The document's name for display: no upload timestamp, folder or extension; "POE n" only when nothing better is known. */
const evidenceDisplayName = (entry: EvidenceEntry, index: number) => {
    let fromLink = ''
    try {
        fromLink = decodeURIComponent(String(entry.value || '').split('?')[0].split('/').pop() || '').split('/').pop() || ''
    } catch {
        fromLink = ''
    }
    const raw = String(entry.originalName || '').trim() || (isGenericPoeLabel(entry.label) ? fromLink : entry.label) || ''
    const name = raw.replace(/^\d{10,}_/, '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_/g, ' ').trim()
    return name || entry.label || `POE ${index + 1}`
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

/**
 * The queries on one assignment: those raised on its intervention (for this
 * SME, or the whole intervention), plus those on the assignment itself, such
 * as an SME delivery dispute (its context.interventionId is the assignment id).
 * Reads are shared through `cache`, so a group of 20 SMEs reads once, not 20 times.
 */
const fetchQueriesForIntervention = async (
    record: AssignedIntervention,
    cache: Map<string, Promise<QueryDoc[]>> = new Map()
): Promise<QueryDoc[]> => {
    const read = (key: string, load: () => Promise<QueryDoc[]>) => {
        if (!cache.has(key)) cache.set(key, load().catch(err => { console.warn('Failed to fetch queries:', err); return [] }))
        return cache.get(key)!
    }
    const interventionId = String(record.interventionId || '').trim()
    const [byIntervention, byAssignment] = await Promise.all([
        interventionId ? read(`i:${interventionId}`, () => workflowQueryService.list({ interventionId }) as Promise<QueryDoc[]>) : Promise.resolve([]),
        read(`a:${record.id}`, async () => {
            const [byContext, byTarget] = await Promise.all([
                workflowQueryService.list({ interventionId: record.id }),
                workflowQueryService.list({ targetId: record.id } as any)
            ])
            return [...byContext, ...byTarget] as QueryDoc[]
        })
    ])
    const forThisSme = byIntervention.filter(q => !record.participantId || !q.participantId || q.participantId === record.participantId)
    const seen = new Set<string>()
    return [...forThisSme, ...byAssignment].filter(q => (q.id && !seen.has(q.id) ? (seen.add(q.id), true) : false))
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
            resolveAssignmentLifecycle(row).isCompleted || !resolveAssignmentLifecycle(row).isOpen || isClosedWithoutAttendance(row)
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

    const rolled: DisplayIntervention[] = Array.from(grouped.entries()).map(([groupKey, members]): DisplayIntervention => {
        const base = pickMostAdvanced(members)
        const sharedDelivery = groupDeliveries[groupKey]
        const groupLifecycle: 'active' | 'completed' = members.some(member =>
            !(resolveAssignmentLifecycle(member).isCompleted || !resolveAssignmentLifecycle(member).isOpen || isClosedWithoutAttendance(member))
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
        const allQueries = Array.from(new Map(members.flatMap(m => m.queries || []).map(q => [q.id, q])).values())

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
                ? (Array.isArray(sharedDelivery.evidence) ? sharedDelivery.evidence as Resource[] : [])
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
    const { modal } = App.useApp()
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
    const [, setActiveInterventions] = useState<AssignedIntervention[]>([])
    const [, setCompletedInterventions] = useState<AssignedIntervention[]>([])

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
    // What the staged files will replace when saved: one document, all of them, or nothing (just add).
    const [pendingReplaceTarget, setPendingReplaceTarget] = useState<string | undefined>()

    const [searchText, setSearchText] = useState('')
    const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
    const [evidenceRecord, setEvidenceRecord] = useState<AssignedIntervention | null>(null)

    const [detailsModalOpen, setDetailsModalOpen] = useState(false)
    const [detailsRecord, setDetailsRecord] = useState<DisplayIntervention | null>(null)
    const [detailsTab, setDetailsTab] = useState<'overview' | 'members' | 'sessions' | 'updates' | 'queries'>('overview')
    const [workStatus, setWorkStatus] = useState<WorkStatus>('needs-you')
    const [listPage, setListPage] = useState(1)
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

    // "Cash Flow Forecast" rather than "POE" when the intervention names its deliverable.
    const completionDeliverable = useMemo(
        () =>
            resolveDeliverableName(
                (progressRecord?.members?.[0] || progressRecord) as any,
                null,
                { ...DEFAULT_EVIDENCE_MODEL, deliverable: 'named' }
            ),
        [progressRecord]
    )

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

    const manageEvidenceDeliverableName = useMemo(() => {
        if (!manageEvidenceRecord) return 'Proof of Execution (POE)'
        const named = resolveDeliverableName(
            ((manageEvidenceRecord as DisplayIntervention).members?.[0] || manageEvidenceRecord) as any,
            null,
            { ...DEFAULT_EVIDENCE_MODEL, deliverable: 'named' }
        )
        return named.isConfigured ? named.name : 'Proof of Execution (POE)'
    }, [manageEvidenceRecord])
    const manageEvidenceAddLabel = manageEvidenceRecord && isDocumentTarget(manageEvidenceRecord)
        ? 'document'
        : manageEvidenceDeliverableName === 'Proof of Execution (POE)' ? 'POE' : manageEvidenceDeliverableName

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
                getGroupMemberIdsForEvidence(record)
                    .then(ids => record.isGroupedDisplay
                        // SMEs catching up are completed on their own, not with the group.
                        ? ids.filter(id => !(record.members || []).some(member => member.id === id && isCatchingUp(member)))
                        : ids)
                    .then(ids => loadInterventionCompletionContext(db, ids))
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
                            // Same rule as the details panel: check-in driven sessions only set checkedInAt.
                            const attended = ['attended', 'checked-in', 'checked-out'].includes(String(appointment.attendance?.status || '')) ||
                                Boolean(appointment.attendance?.checkedInAt)
                            if (!assignmentId || !attended) return

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
                    // Only ever raise it: attendance recorded elsewhere (a register, an
                    // older workflow) must not be wiped by what this page can see.
                    if (isSessionTracked && attendedCount > storedSessions) {
                        repair['tracking.sessionsLogged'] = attendedCount
                        next = {
                            ...next,
                            tracking: { ...(next.tracking || {}), sessionsLogged: attendedCount }
                        }
                    }

                    if (completionIsFinal) {
                        // Grouped members' delivery lives on the group delivery document, never on each member.
                        if (!isGroupedMember && Number(item.computedProgress) !== 100) repair.computedProgress = 100
                        next = { ...next, computedProgress: 100 }
                    } else if (isReopenedDelivery(item) && !isGroupedMember) {
                        // Back in delivery after a dispute: progress returns to before the completion,
                        // not to the 100% the completion recorded.
                        const reopened = reopenedProgress(item)
                        if (Number(item.computedProgress) !== reopened) repair.computedProgress = reopened
                        next = { ...next, computedProgress: reopened }
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

                const queryCache = new Map<string, Promise<QueryDoc[]>>()
                const departmentCache = new Map<string, Promise<boolean>>()
                const enrichAssignment = async (
                    item: AssignedIntervention
                ): Promise<AssignedIntervention> => {
                    let base: AssignedIntervention = {
                        ...item,
                        resources: item.resources || []
                    }

                    try {
                        const departmentId = String(base.departmentId || '')
                        if (departmentId) {
                            if (!departmentCache.has(departmentId)) {
                                departmentCache.set(departmentId, getDoc(doc(db, 'departments', departmentId))
                                    .then(snap => snap.data()?.isSensitive === true)
                                    .catch(() => false))
                            }
                            base = { ...base, isSensitive: await departmentCache.get(departmentId)! } as any
                        }
                    } catch {
                        //
                    }

                    try {
                        const rows = await fetchQueriesForIntervention(base, queryCache)
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

    // SME photos live on users/{uid}. A failed lookup just means "no photo"
    // and the avatar falls back to initials.
    const [photoByParticipantId, setPhotoByParticipantId] = useState<Record<string, string>>({})
    const requestedPhotoIdsRef = useRef<Set<string>>(new Set())

    const filteredData = useMemo(() => {
        const rows = baseData.filter(item => {
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
    }, [baseData, dateRange, searchText])

    useEffect(() => {
        const ids = Array.from(new Set(
            filteredData
                .filter(row => !row.isGroupedDisplay)
                .map(row => String(row.participantId || '').trim())
                .filter(id => id && !requestedPhotoIdsRef.current.has(id))
        ))
        if (!ids.length) return
        ids.forEach(id => requestedPhotoIdsRef.current.add(id))

        let cancelled = false
        void (async () => {
            const found: Record<string, string> = {}
            await Promise.all(ids.map(async id => {
                try {
                    const participantSnap = await getDoc(doc(db, 'participants', id))
                    const participant = participantSnap.exists() ? (participantSnap.data() as any) : null
                    const direct = String(participant?.photoURL || '').trim()
                    if (direct) {
                        found[id] = direct
                        return
                    }

                    const uid = String(participant?.uid || '').trim()
                    if (uid) {
                        const userSnap = await getDoc(doc(db, 'users', uid))
                        const user = userSnap.exists() ? (userSnap.data() as any) : null
                        const url = String(user?.photoURL || '').trim()
                        if (url) found[id] = url
                        return
                    }

                    // Stored email casing is not guaranteed to match users/{uid}.
                    const rawEmail = String(participant?.email || '').trim()
                    if (rawEmail) {
                        const emails = Array.from(new Set([rawEmail, rawEmail.toLowerCase()]))
                        const usersSnap = await getDocs(
                            query(collection(db, 'users'), where('email', 'in', emails))
                        )
                        for (const userDoc of usersSnap.docs) {
                            const user = userDoc.data() as any
                            const url = String(user?.photoURL || '').trim()
                            if (url) {
                                found[id] = url
                                break
                            }
                        }
                    }
                } catch (error) {
                    // No access or no profile: fall back to initials.
                    console.warn(`Could not load SME photo for participant ${id}`, error)
                }
            }))
            if (!cancelled && Object.keys(found).length) {
                setPhotoByParticipantId(previous => ({ ...previous, ...found }))
            }
        })()

        return () => {
            cancelled = true
        }
    }, [filteredData])

    const renderSmeAvatar = (record: DisplayIntervention, size = 40) => {
        if (record.isGroupedDisplay) {
            return <Avatar size={size} icon={<AppstoreOutlined />} style={{ flexShrink: 0 }} />
        }
        const name = String(record.participantName || record.beneficiaryName || '').trim()
        return (
            <Avatar
                size={size}
                src={photoByParticipantId[String(record.participantId || '')] || undefined}
                style={{ flexShrink: 0 }}
            >
                {name ? name.charAt(0).toUpperCase() : '?'}
            </Avatar>
        )
    }

    /**
     * Emails each SME a reminder to confirm completion. One SME is reminded at
     * most once a day (lastReminderAt on the assignment), seeded records are
     * skipped, and partial failures are reported as such, so a retry doesn't
     * email the ones that already went out.
     */
    const sendReminders = async (targets: AssignedIntervention[]) => {
        const user = auth.currentUser
        if (!user?.email) throw new Error('signed-out')
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000
        const due = targets.filter(target => {
            if ((target as any).suppressNotifications === true) return false
            const last = toJsDate((target as any).lastReminderAt)
            return !last || last.getTime() < dayAgo
        })
        const idToken = await user.getIdToken()
        const results = await Promise.allSettled(due.map(async target => {
            const response = await fetch(`${functionsBaseUrl}/sendInterventionReminderEmail`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({
                    programId: target.programId || activeProgramId || null,
                    assignedInterventionId: target.id,
                    participantId: target.participantId || null,
                    participantName: target.participantName || target.beneficiaryName || null,
                    participantEmail: (target as any).participantEmail || null,
                    interventionTitle: target.interventionTitle || null,
                    reminderReason: getReminderReason(target) || 'confirmation'
                })
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok || result?.ok === false) throw new Error(result?.error || 'Failed to send reminder email.')
            await updateDoc(doc(db, 'assignedInterventions', target.id), { lastReminderAt: Timestamp.now() } as any).catch(() => undefined)
        }))
        const sent = results.filter(r => r.status === 'fulfilled').length
        return { sent, failed: results.length - sent, skipped: targets.length - due.length }
    }

    const reportReminders = ({ sent, failed, skipped }: { sent: number; failed: number; skipped: number }) => {
        const parts = [
            sent ? `Reminder sent to ${sent} SME${sent === 1 ? '' : 's'}.` : null,
            skipped ? `${skipped} already reminded in the last 24 hours.` : null,
            failed ? `${failed} couldn’t be sent; try again later.` : null
        ].filter(Boolean).join(' ')
        if (failed) message.warning(parts)
        else if (sent) message.success(parts)
        else message.info(parts || 'Nobody to remind.')
    }

    const sendReminder = async (record: DisplayIntervention) => {
        const targets = getReminderTargets(record)
        if (!targets.length) {
            message.warning('No SME on this item is awaiting completion confirmation.')
            return
        }
        setRemindingIds(prev => [...prev, record.id])
        try {
            reportReminders(await sendReminders(targets))
        } catch (err) {
            console.error(err)
            message.error('The reminder couldn’t be sent. Try again.')
        } finally {
            setRemindingIds(prev => prev.filter(id => id !== record.id))
        }
    }

    const sendReminderToAllVisible = async () => {
        const targets = filteredData.flatMap(item => getReminderTargets(item))
        if (!targets.length) {
            message.warning('Nobody in this list is waiting to confirm completion.')
            return
        }
        const ok = await modal.confirm({
            centered: true,
            title: `Remind ${targets.length} SME${targets.length === 1 ? '' : 's'}?`,
            content: 'Each gets an email asking them to confirm completion. Anyone reminded in the last 24 hours is skipped.',
            okText: 'Send reminders'
        })
        if (!ok) return
        setBulkReminding(true)
        try {
            reportReminders(await sendReminders(targets))
        } catch (err) {
            console.error(err)
            message.error('The reminders couldn’t be sent. Try again.')
        } finally {
            setBulkReminding(false)
        }
    }

    const setRecordQueriesLocally = (recordId: string, rows: QueryDoc[]) => {
        setAllInterventions(prev =>
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

    /** Opens an intervention in the detail panel (a bottom sheet on phones). */
    const selectRecord = (record: DisplayIntervention, userInitiated: boolean) => {
        if (record.id !== detailsRecord?.id) {
            setDetailsTab('overview')
            void loadDetailsSessions(record)
        }
        setDetailsRecord(record)
        if (userInitiated && isMobile) setDetailsModalOpen(true)
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

        if (nextPoes.length === currentPoes.length) {
            message.warning('That POE is no longer on this intervention. Refreshing the list.')
            setReloadKey(value => value + 1)
            return
        }

        // Busy straight away, so a second click can't start a second delete.
        setDeletingPoeUrl(poeUrl)
        try {
            const targetIds = await getGroupMemberIdsForEvidence(
                record as DisplayIntervention
            )
            if (!targetIds.length) {
                message.error('No linked interventions were found for this POE.')
                return
            }
            const movs = await movsForAssignments(targetIds)
            if (anyMovApproved(movs)) {
                message.warning('The HOD has approved the MOV on this evidence, so it can’t be removed. Ask the HOD to undo the approval first.')
                return
            }
            if ((record as DisplayIntervention).isGroupedDisplay) {
                await saveSharedGroupDelivery(record as DisplayIntervention, { evidence: nextPoes })
                // Keep each member aligned with the shared group evidence too
                // (stale member resources used to resurrect removed POEs), but
                // keep any POE uploaded for that SME alone.
                const membersById = new Map(((record as DisplayIntervention).members || []).map(member => [member.id, member]))
                await Promise.all(targetIds.map(id => {
                    const member = membersById.get(id)
                    const own = member ? memberOwnUploads(record as DisplayIntervention, member).filter(r => canonicalUrl(r.link) !== targetUrl) : []
                    return updateDoc(doc(db, 'assignedInterventions', id), {
                        resources: normalizePoeResources([...nextPoes, ...own]),
                        updatedAt: Timestamp.now()
                    } as any)
                }))
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
                        ? ({ ...previous, resources: sharedNext, groupDelivery: { ...((previous as DisplayIntervention).groupDelivery || {}), evidence: sharedNext } as GroupInterventionDelivery } as unknown as AssignedIntervention)
                        : previous)
                }
            }

            await pruneMovEvidence(movs, [poeUrl, targetUrl])
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
        if (isDocumentTarget(record) || deletingPoeUrl) return
        setDeletingPoeUrl('__all__')
        try {
            const targetIds = await getGroupMemberIdsForEvidence(record as DisplayIntervention)
            if (!targetIds.length) {
                message.error('No linked interventions were found for this POE.')
                return
            }
            const movs = await movsForAssignments(targetIds)
            if (anyMovApproved(movs)) {
                message.warning('The HOD has approved the MOV on this evidence, so it can’t be removed. Ask the HOD to undo the approval first.')
                return
            }
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
                        ? ({ ...previous, resources: sharedNext, groupDelivery: { ...((previous as DisplayIntervention).groupDelivery || {}), evidence: sharedNext } as GroupInterventionDelivery } as unknown as AssignedIntervention)
                        : previous)
                }
            }
            await Promise.all(targetIds.map(id => updateDoc(doc(db, 'assignedInterventions', id), {
                resources: [],
                updatedAt: Timestamp.now()
            } as any)))
            await pruneMovEvidence(movs, 'all')
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
            }
            // Members too: evidence is read from the assignments, and a stale copy brings the document back.
            await Promise.all(targetIds.map(id => {
                return updateDoc(doc(db, 'assignedInterventions', id), {
                    resources: next,
                    updatedAt: Timestamp.now()
                } as any)
            }))
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

        // The MOV is the compulsory proof of delivery; a POE is optional. Answer on
        // the step that needs fixing, the way the progress step does.
        if (missingMovs.length) {
            setCompletionStepError(
                progressRecord.isGroupedDisplay
                    ? `${missingMovs.length} SME${missingMovs.length === 1 ? '' : 's'} who received the intervention still ${missingMovs.length === 1 ? 'needs' : 'need'} an MOV.`
                    : 'Add the completed MOV before finishing the intervention.'
            )
            setProgressModalStep(2)
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
                const membersById = new Map((progressRecord.members || []).map(member => [member.id, member]))
                await Promise.all(assignmentIds.map(id => {
                    const member = membersById.get(id)
                    const own = member ? memberOwnUploads(progressRecord, member) : []
                    return updateDoc(doc(db, 'assignedInterventions', id), {
                        resources: normalizePoeResources([...finalPoes, ...own]),
                        updatedAt: Timestamp.now()
                    } as any)
                }))
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
                poeEvidence,
                poeOptional: true
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
                const combined = [...retainedEvidence, ...uploaded].filter(resource => resource?.link)
                // Documents keep their names; only POEs are numbered "POE n".
                const nextEvidence = documentTarget
                    ? Array.from(new Map(combined.map(resource => [resource.link, resource])).values())
                    : normalizePoeResources(combined)
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
                    // A single SME's POE is recorded (below) but isn't the group's evidence.
                    evidence: isSingleGroupUpload ? currentEvidence : nextEvidence,
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
            setPendingReplaceTarget(undefined)
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
                    style={{ borderRadius: 12, border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#d9d9d9'}` }}
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
                    title={<Space size={8}><ClockCircleOutlined />Sessions</Space>}
                    style={{ borderRadius: 12 }}
                    styles={{ body: { padding: 12 } }}
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
                            {...(detailsSessionRows.length === 1 && !record.isGroupedDisplay
                                ? {
                                    activeKey: [detailsSessionRows[0].key],
                                    expandIcon: () => null
                                }
                                : {})}
                            items={detailsSessionRows.map((row, index) => {
                                const start = toJsDate(row.startAt)
                                const end = toJsDate(row.endAt)
                                const method = normalizeCompletionDeliveryMethod(row.deliveryMethod)
                                const attended = row.attendedNames.length

                                return {
                                    key: row.key,
                                    style: {
                                        border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#d9d9d9'}`,
                                        borderRadius: 12,
                                        marginBottom: 8
                                    },
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
                                            {row.title ? (
                                                <Text strong>{row.title}</Text>
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

                                            {record.isGroupedDisplay && row.attendedNames.length ? (
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

                                            {record.isGroupedDisplay && row.absentNames.length ? (
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

    // Assigned -> Completed -> Due, as one centred card strip.
    const renderDateFlow = (record: DisplayIntervention, withTime = false, compact = false) => {
        const fmt = withTime ? formatDateTime : formatDate
        const overdue = record.lifecycleBucket !== 'completed' && isOverdueRecord(record)
        const steps: { key: string; label: string; value: any; icon: React.ReactNode; color: string }[] = [
            {
                key: 'assigned',
                label: 'Assigned',
                value: record.assignedAtResolved ?? getAssignedAt(record),
                icon: <CalendarOutlined />,
                color: '#1677ff'
            }
        ]
        if (record.lifecycleBucket === 'completed') {
            steps.push({
                key: 'completed',
                label: 'Completed',
                value: record.completedAtResolved || assignmentCompletedDate(record),
                icon: <CheckCircleOutlined />,
                color: '#52c41a'
            })
        }
        steps.push({
            key: 'due',
            label: 'Due',
            value: record.dueDate,
            icon: <ClockCircleOutlined />,
            color: overdue ? '#cf1322' : '#fa8c16'
        })

        return (
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    gap: compact ? 10 : 16,
                    padding: compact ? '8px 12px' : '14px 16px',
                    borderRadius: 12,
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#d9d9d9'}`,
                    background: isDark ? 'rgba(255,255,255,0.03)' : '#fff',
                    width: '100%'
                }}
            >
                {steps.map((step, index) => (
                    <React.Fragment key={step.key}>
                        {index > 0 ? (
                            <ArrowRightOutlined style={{ color: '#8c8c8c', fontSize: compact ? 12 : 16 }} />
                        ) : null}
                        <Space size={compact ? 8 : 12} align="center">
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: compact ? 28 : 38,
                                    height: compact ? 28 : 38,
                                    borderRadius: '50%',
                                    fontSize: compact ? 14 : 18,
                                    color: step.color,
                                    background: `${step.color}1f`
                                }}
                            >
                                {step.icon}
                            </span>
                            <Space direction="vertical" size={0}>
                                <Text
                                    type="secondary"
                                    style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}
                                >
                                    {step.label}
                                </Text>
                                <Text
                                    strong
                                    type={step.key === 'due' && overdue ? 'danger' : undefined}
                                    style={{ fontSize: compact ? 13 : 15 }}
                                >
                                    {fmt(step.value)}
                                </Text>
                            </Space>
                        </Space>
                    </React.Fragment>
                ))}
            </div>
        )
    }

    const renderDetailsDescriptions = (record: DisplayIntervention) => {

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

        const statusCard = (
            tone: 'blue' | 'green' | 'gold' | 'red' | 'default',
            icon: React.ReactNode,
            title: React.ReactNode,
            body?: React.ReactNode
        ) => {
            const palette = {
                blue: ['#91caff', '#e6f4ff'],
                green: ['#b7eb8f', '#f6ffed'],
                gold: ['#ffe58f', '#fffbe6'],
                red: ['#ffccc7', '#fff2f0'],
                default: ['#d9d9d9', '#fafafa']
            }[tone]
            return (
                <Card
                    size="small"
                    style={{
                        borderRadius: 12,
                        border: `1px solid ${palette[0]}`,
                        background: isDark ? 'rgba(255,255,255,0.03)' : palette[1]
                    }}
                >
                    <Space align="start" size={12}>
                        <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
                        <Space direction="vertical" size={4}>
                            <Text strong>{title}</Text>
                            {body ? <div>{body}</div> : null}
                        </Space>
                    </Space>
                </Card>
            )
        }

        if (record.isGroupedDisplay) {
            return (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {renderDateFlow(record, true)}

                    {statusCard(
                        groupDelivered ? 'blue' : groupProgress > 0 ? 'gold' : 'default',
                        groupDelivered
                            ? <CheckCircleOutlined style={{ color: '#1677ff' }} />
                            : <ClockCircleOutlined style={{ color: '#8c8c8c' }} />,
                        groupDelivered
                            ? 'Delivered to the whole group'
                            : groupProgress > 0
                                ? 'In delivery'
                                : 'Not started',
                        <Space direction="vertical" size={8}>
                            <Text type="secondary">
                                This intervention is delivered once to the whole group, so
                                delivery progress is the same for every member.
                            </Text>

                            {groupDelivered ? (
                                <Space wrap size={[6, 6]}>
                                    <Tag color="green">Received: {groupedReceived.length}</Tag>
                                    {groupedNotReceived > 0 ? (
                                        <Tag color="red">Did not attend: {groupedNotReceived}</Tag>
                                    ) : null}
                                    {showGroupedConfirmationSummary ? (
                                        <>
                                            <Tag color="green">Confirmed: {groupedSmeConfirmed}</Tag>
                                            {groupedSmeRejected > 0 ? (
                                                <Tag color="red">Rejected: {groupedSmeRejected}</Tag>
                                            ) : null}
                                            <Tag>Pending: {groupedSmePendingConfirmation}</Tag>
                                        </>
                                    ) : null}
                                </Space>
                            ) : null}

                            {groupDelivered && groupedNotReceived > 0 ? (
                                <Text type="secondary">
                                    Members who attended no appointments did not receive this
                                    intervention and cannot be issued a MOV.
                                </Text>
                            ) : null}

                            {groupDelivered && !showGroupedConfirmationSummary ? (
                                <Text type="secondary">
                                    No member attended, so there is nothing to confirm.
                                </Text>
                            ) : null}
                        </Space>
                    )}
                </Space>
            )
        }

        const done = getFacilitatorCompletion(record) === 'done'
        const smeStatus = getSmeCompletion(record)
        const smeConfirmed = smeStatus === 'confirmed' || smeStatus === 'done'
        const smeRejected = smeStatus === 'rejected'
        const feedback = getCompletionFeedback(record)

        return (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {renderDateFlow(record, true)}

                {!done
                    ? statusCard(
                        'default',
                        <ClockCircleOutlined style={{ color: '#8c8c8c' }} />,
                        'Delivery in progress',
                        <Text type="secondary">You have not marked this intervention as completed yet.</Text>
                    )
                    : smeConfirmed
                        ? statusCard(
                            'green',
                            <CheckCircleOutlined style={{ color: '#52c41a' }} />,
                            'You completed this intervention and the SME has confirmed.'
                        )
                        : smeRejected
                            ? statusCard(
                                'red',
                                <CloseOutlined style={{ color: '#cf1322' }} />,
                                // The reason and the response are in the dispute at the top of the panel.
                                'You completed this intervention but the SME disputes it.'
                            )
                            : statusCard(
                                'gold',
                                <ClockCircleOutlined style={{ color: '#d48806' }} />,
                                'You completed this intervention. The SME has not confirmed yet.'
                            )}

                {done && smeConfirmed ? (
                    <Card size="small" title="SME feedback" style={{ borderRadius: 12 }}>
                        {feedback.rating > 0 || feedback.comments ? (
                            <Space direction="vertical" size={6}>
                                {feedback.rating > 0 ? <Rate disabled value={feedback.rating} /> : null}
                                {feedback.comments ? <Text>{feedback.comments}</Text> : null}
                            </Space>
                        ) : (
                            <Text type="secondary">No feedback provided.</Text>
                        )}
                    </Card>
                ) : null}
            </Space>
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
                                    {isCatchingUp(member) && (
                                        <Space wrap size={[6, 4]}>
                                            <Tag color="orange">Catch-up · {getProgressPercent(member)}%</Tag>
                                            <Text type="secondary">Redelivering what this SME missed; completed on its own, without the group.</Text>
                                        </Space>
                                    )}

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
    const compactModalStyles = {
        body: {
            maxHeight: isMobile ? '76vh' : '74vh',
            overflowY: 'auto' as const,
            overflowX: 'hidden' as const,
            paddingTop: 10,
            paddingBottom: 10
        }
    }

    /** A grouped intervention's evidence (not documents): shared POE plus each SME's own. */
    const isGroupEvidence = !!(manageEvidenceRecord as DisplayIntervention | null)?.isGroupedDisplay && !!manageEvidenceRecord && !isDocumentTarget(manageEvidenceRecord)
    /** The SME the pending files are for, or null for the whole group / a single intervention. */
    const evidenceForMember = isGroupEvidence && groupEvidenceMode === 'single' ? groupEvidenceMemberId || null : null

    /** Choose files for the group (memberId null) or one SME; switching who they're for drops files picked for someone else. */
    const pickEvidenceFiles = (memberId: string | null, replaceTarget?: string) => {
        if ((memberId || null) !== evidenceForMember && pendingEvidenceFiles.length) {
            setPendingEvidenceFiles([])
            setPendingReplaceTarget(undefined)
        }
        setGroupEvidenceMode(memberId ? 'single' : 'bulk')
        setGroupEvidenceMemberId(memberId || undefined)
        openManageEvidenceFilePicker(replaceTarget)
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

        // Files are only staged here, so several can be picked (in one go or over a few
        // picks) and checked before anything is saved. Saving is the explicit button.
        setPendingEvidenceFiles(current => {
            const seen = new Set(current.map(file => `${file.name}:${file.size}:${file.lastModified}`))
            return [
                ...current,
                ...files.filter(file => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))
            ]
        })
        // Choosing Replace sets what gets replaced; a plain Add keeps whatever was chosen before.
        if (replaceTarget !== undefined) setPendingReplaceTarget(replaceTarget)
    }

    const saveStagedEvidence = () => {
        const fileList = pendingEvidenceFiles.map(file => ({
            uid: `${Date.now()}-${file.name}-${file.size}`,
            name: file.name,
            originFileObj: file
        }))
        void submitManageEvidence({
            ...manageEvidenceForm.getFieldsValue(true),
            files: fileList,
            replaceTarget: pendingReplaceTarget
        })
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

    // ---- Workspace: one status strip, a list beside the open intervention ----

    const canCompleteRecord = (record: DisplayIntervention) =>
        record.lifecycleBucket !== 'completed' &&
        (record.progressResolved ?? getProgressPercent(record)) >= 100 &&
        (record.members || [record]).some(member => getFacilitatorCompletion(member) !== 'done' && !(record.isGroupedDisplay && isCatchingUp(member)))

    /** SMEs in a group catching up after a dispute: each has their own progress and completion. */
    const catchUpsOf = (record: DisplayIntervention) =>
        record.isGroupedDisplay ? (record.members || []).filter(isCatchingUp) : []
    const memberName = (member: AssignedIntervention) => member.participantName || member.beneficiaryName || 'the SME'
    /** A group member as a record of its own, so progress and completion apply to that SME alone. */
    const asSingle = (member: AssignedIntervention): DisplayIntervention => ({ ...member, isGroupedDisplay: false, lifecycleBucket: 'active', progressResolved: getProgressPercent(member) })

    /** Queries on the row waiting for the facilitator's answer (not ones they've answered). */
    const openQueriesOf = (record: DisplayIntervention) =>
        Array.from(new Map((record.queries || []).map(q => [q.id, q])).values())
            .filter(q => String(q.status || 'open').toLowerCase() === 'open')

    /** Where an intervention stands from the facilitator's side: what, if anything, they have to do. */
    const workStatusOf = (record: DisplayIntervention): WorkStatus => {
        const status = resolveDisplayStatus(record)
        if (status === 'disputed' || openQueriesOf(record).length) return 'needs-you'
        if (record.lifecycleBucket !== 'completed' && (canCompleteRecord(record) || isOverdueRecord(record))) return 'needs-you'
        if (catchUpsOf(record).length) return 'needs-you'
        if (status === 'awaiting-confirmation') return 'awaiting'
        if (['completed', 'no-attendance', 'closed'].includes(status) || record.lifecycleBucket === 'completed') return 'done'
        return 'in-delivery'
    }

    /** Why a row is in "Needs you", as short flags. */
    const needsOf = (record: DisplayIntervention) => {
        const flags: { label: string; tone: 'danger' | 'warning' | 'info' }[] = []
        if (resolveDisplayStatus(record) === 'disputed') flags.push({ label: 'Completion disputed', tone: 'danger' })
        const open = openQueriesOf(record).filter(q => !String(q.queryType || q.type || '').startsWith('completion-reject')).length
        if (open) flags.push({ label: `${open} ${open === 1 ? 'query' : 'queries'} to answer`, tone: 'warning' })
        if (canCompleteRecord(record)) flags.push({ label: 'Ready to submit', tone: 'info' })
        const catchUps = catchUpsOf(record).length
        if (catchUps) flags.push({ label: `${catchUps} SME${catchUps === 1 ? '' : 's'} catching up`, tone: 'warning' })
        if (record.lifecycleBucket !== 'completed' && isOverdueRecord(record)) flags.push({ label: 'Overdue', tone: 'danger' })
        return flags
    }

    const workCounts = useMemo(() => {
        const counts: Record<WorkStatus, number> = { 'needs-you': 0, 'in-delivery': 0, awaiting: 0, done: 0, all: filteredData.length }
        filteredData.forEach(record => { counts[workStatusOf(record)] += 1 })
        return counts
    }, [filteredData]) // eslint-disable-line react-hooks/exhaustive-deps

    const listRows = useMemo(
        () => (workStatus === 'all' ? filteredData : filteredData.filter(record => workStatusOf(record) === workStatus)),
        [filteredData, workStatus] // eslint-disable-line react-hooks/exhaustive-deps
    )

    // Start where the work is: "Needs you" when there's anything in it, otherwise everything.
    const [startedOn, setStartedOn] = useState(false)
    useEffect(() => {
        if (startedOn || !hasLoadedOnce) return
        setStartedOn(true)
        if (!workCounts['needs-you']) setWorkStatus('all')
    }, [hasLoadedOnce]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => setListPage(1), [workStatus, searchText, dateRange])

    // The open intervention: kept in step with reloads, first row when none is chosen (not on phones).
    useEffect(() => {
        if (detailsRecord) {
            const fresh = baseData.find(row => row.id === detailsRecord.id ||
                (!!detailsRecord.groupKeyResolved && row.groupKeyResolved === detailsRecord.groupKeyResolved))
            if (fresh && fresh !== detailsRecord) setDetailsRecord(fresh)
            if (fresh && listRows.some(row => row.id === fresh.id)) return
        }
        if (isMobile) return
        if (listRows[0]) selectRecord(listRows[0], false)
        else setDetailsRecord(null)
    }, [baseData, listRows]) // eslint-disable-line react-hooks/exhaustive-deps

    /** The query a primary action answers: a dispute first, then the oldest open query. */
    const firstOpenQuery = (record: DisplayIntervention) => {
        const open = openQueriesOf(record).sort((a, b) => (toJsDate(a.createdAt)?.getTime() || 0) - (toJsDate(b.createdAt)?.getTime() || 0))
        const query = open.find(q => String(q.queryType || q.type || '').startsWith('completion-reject')) || open[0]
        if (!query) return null
        const owner = (record.members || [record]).find(member => (member.queries || []).some(q => q.id === query.id)) || record
        return { query, owner }
    }

    const answerQuery = (record: DisplayIntervention, query: QueryDoc) => {
        const owner = (record.members || [record]).find(member => (member.queries || []).some(q => q.id === query.id)) || record
        openPoeResolveModal(owner, query)
    }

    /** The one thing this intervention is waiting on the facilitator for. */
    const primaryActionFor = (record: DisplayIntervention) => {
        const status = resolveDisplayStatus(record)
        const progress = record.progressResolved ?? getProgressPercent(record)
        const next = firstOpenQuery(record)
        if (next) {
            const dispute = String(next.query.queryType || next.query.type || '').startsWith('completion-reject')
            const waiting = openQueriesOf(record).length
            if (!dispute && waiting > 1) {
                return { key: 'answer', label: `Answer queries (${waiting})`, icon: <SendOutlined />, danger: false, onClick: () => setDetailsTab('queries') }
            }
            return { key: 'answer', label: dispute ? 'Respond to dispute' : 'Answer query', icon: <SendOutlined />, danger: dispute, onClick: () => openPoeResolveModal(next.owner, next.query) }
        }
        const catchUp = catchUpsOf(record)[0]
        if (catchUp) {
            const single = asSingle(catchUp)
            return (single.progressResolved ?? 0) >= 100
                ? { key: 'catchup', label: `Submit catch-up: ${memberName(catchUp)}`, icon: <CheckCircleOutlined />, onClick: () => void prepareCompletionStep(single) }
                : { key: 'catchup', label: `Catch-up progress: ${memberName(catchUp)}`, icon: <EditOutlined />, onClick: () => openProgressModal(single) }
        }
        if (canCompleteRecord(record)) return { key: 'complete', label: 'Submit completion', icon: <CheckCircleOutlined />, onClick: () => void prepareCompletionStep(record) }
        if (record.lifecycleBucket !== 'completed' && progress < 100 && status !== 'disputed') return { key: 'progress', label: 'Add progress', icon: <EditOutlined />, onClick: () => openProgressModal(record) }
        if (status === 'awaiting-confirmation' && canSendReminderRecord(record)) {
            return { key: 'remind', label: record.isGroupedDisplay ? 'Remind SMEs to confirm' : 'Remind SME to confirm', icon: <BellOutlined />, onClick: () => void sendReminder(record) }
        }
        if (!getEvidenceEntriesFromRecord(record).length && !isDocumentTarget(record)) return { key: 'evidence', label: 'Add evidence', icon: <UploadOutlined />, onClick: () => openManageEvidenceModal(record) }
        return null
    }

    /** Everything else that can be done, after the primary action. */
    const secondaryActionsFor = (record: DisplayIntervention, primaryKey?: string) => {
        const progress = record.progressResolved ?? getProgressPercent(record)
        const evidenceCount = getEvidenceEntriesFromRecord(record).length
        return [
            // A disputed completion is answered first; choosing "deliver what's missing" re-opens progress.
            record.lifecycleBucket !== 'completed' && progress < 100 && primaryKey !== 'progress' && resolveDisplayStatus(record) !== 'disputed'
                ? { key: 'progress', label: 'Add progress', icon: <EditOutlined />, onClick: () => openProgressModal(record) } : null,
            // Evidence comes with completion (the completion form asks for the POE); before
            // that there's only something to manage if some was already added.
            primaryKey !== 'evidence' && (progress >= 100 || record.lifecycleBucket === 'completed' || evidenceCount > 0)
                ? { key: 'evidence', label: isDocumentTarget(record) ? 'Documents' : evidenceCount ? `Evidence (${evidenceCount})` : 'Add evidence', icon: <UploadOutlined />, onClick: () => openManageEvidenceModal(record) } : null,
            canSendReminderRecord(record) && primaryKey !== 'remind'
                ? { key: 'remind', label: 'Remind', icon: <BellOutlined />, onClick: () => void sendReminder(record) } : null,
            record.lifecycleBucket === 'completed'
                ? { key: 'register', label: 'Register', icon: <CalendarOutlined />, onClick: () => void generateRegisterForRecord(record) } : null,
            record.lifecycleBucket !== 'completed' && isOverdueRecord(record)
                ? { key: 'overdue', label: 'Overdue reason', icon: <ClockCircleOutlined />, onClick: () => openOverdueModal(record) } : null
        ].filter(Boolean) as { key: string; label: string; icon: React.ReactNode; onClick: () => void }[]
    }

    const STATUS_PILL: Record<DisplayStatus, { label: string; tone: string }> = {
        disputed: { label: 'Disputed', tone: 'danger' },
        closed: { label: 'Closed', tone: 'neutral' },
        'no-attendance': { label: 'No attendance', tone: 'danger' },
        completed: { label: 'Completed', tone: 'success' },
        'awaiting-confirmation': { label: 'Awaiting sign-off', tone: 'info' },
        declined: { label: 'Declined', tone: 'danger' },
        'awaiting-response': { label: 'Awaiting RSVP', tone: 'warning' },
        'in-delivery': { label: 'In delivery', tone: 'info' },
        active: { label: 'Assigned', tone: 'neutral' }
    }

    /** The timeline of progress updates and evidence uploads, newest first. */
    const renderProgressUpdates = () => detailsProgressUpdates.length ? (
        <ol className="al-timeline">
            {detailsProgressUpdates.map((update: any, index: number) => {
                const isEvidence = String(update.type || '').startsWith('evidence-uploaded') || update.type === 'poe-uploaded'
                const date = toJsDate(update.createdAt)
                const done = Number(update.computedProgress || 0) >= 100
                return (
                    <li key={`${String(update.createdAt || index)}-${index}`} className={`al-timeline-item${done ? ' is-done' : ''}`}>
                        <span className="al-timeline-dot" aria-hidden="true" />
                        <div className="al-timeline-head">
                            <span className="al-timeline-what">{isEvidence ? `POE uploaded${update.participantCount > 1 ? ` for ${update.participantCount} SMEs` : ''}` : Number.isFinite(Number(update.computedProgress)) ? `${clampPercent(update.computedProgress)}%` : 'Update'}</span>
                            {update.participantNames?.length === 1 && <span className="al-timeline-who">{update.participantNames[0]}</span>}
                            <span className="al-timeline-when">{date ? dayjs(date).format('D MMM YYYY, HH:mm') : ''}</span>
                        </div>
                        <p className="al-timeline-text">{isEvidence ? 'Evidence added to the intervention.' : update.note || 'Progress updated.'}</p>
                    </li>
                )
            })}
        </ol>
    ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No progress updates yet" />
    )

    const renderWorkList = () => {
        const pageRows = listRows.slice((listPage - 1) * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE)
        return (
            <div data-guide="allocated-table">
                <MotionCard>
                    {listRows.length === 0 ? (
                        <Empty className="ws-list-empty" description={workStatus === 'needs-you' ? 'Nothing needs you right now.' : 'No interventions match.'} />
                    ) : (
                        <>
                            <div className="ws-rows" role="listbox" aria-label="Interventions">
                                {pageRows.map(record => {
                                    const status = resolveDisplayStatus(record)
                                    const progress = record.progressResolved ?? getProgressPercent(record)
                                    const pill = STATUS_PILL[status]
                                    const who = record.isGroupedDisplay
                                        ? `${record.memberCount || record.members?.length || 0} SMEs`
                                        : record.participantName || record.beneficiaryName || 'SME'
                                    const flags = needsOf(record)
                                    return (
                                        <button
                                            key={record.id}
                                            type="button"
                                            role="option"
                                            aria-selected={record.id === detailsRecord?.id}
                                            className={`ws-row${record.id === detailsRecord?.id ? ' is-selected' : ''}`}
                                            onClick={() => selectRecord(record, true)}
                                        >
                                            {renderSmeAvatar(record, 36)}
                                            <div className="ws-row-main">
                                                <div className="ws-row-name">{record.interventionTitle || 'Untitled intervention'}</div>
                                                <div className="ws-row-meta">
                                                    {[who, getSubInterventionLabel(record), record.lifecycleBucket !== 'completed' && status !== 'awaiting-confirmation' ? `${clampPercent(progress)}%` : null].filter(Boolean).join(' · ')}
                                                </div>
                                                {flags.length > 0 && (
                                                    <div className="mv-row-flags">
                                                        {flags.map(flag => <span key={flag.label} className={`mv-flag is-${flag.tone}`}>{flag.label}</span>)}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="ws-row-side">
                                                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                            {listRows.length > LIST_PAGE_SIZE && (
                                <div className="ws-pagination">
                                    <Pagination size="small" current={listPage} pageSize={LIST_PAGE_SIZE} total={listRows.length} onChange={setListPage} showSizeChanger={false} showLessItems />
                                </div>
                            )}
                        </>
                    )}
                </MotionCard>
            </div>
        )
    }

    const renderDetailPanel = (record: DisplayIntervention) => {
        const primary = primaryActionFor(record)
        const secondary = secondaryActionsFor(record, primary?.key)
        const progress = record.progressResolved ?? getProgressPercent(record)
        const status = resolveDisplayStatus(record)
        const pill = STATUS_PILL[status]
        const queries = Array.from(new Map((record.queries || []).map(q => [q.id, q])).values())
        const waiting = queries.filter(q => String(q.status || 'open').toLowerCase() === 'open')
        const earlier = queries.filter(q => String(q.status || 'open').toLowerCase() !== 'open')
        const evidence = getEvidenceEntriesFromRecord(record)
        const overdue = record.lifecycleBucket !== 'completed' && isOverdueRecord(record)
        const tabs = [
            { label: 'Overview', value: 'overview' as const, icon: <AppstoreOutlined /> },
            ...(record.isGroupedDisplay ? [{ label: 'Members', value: 'members' as const, icon: <TeamOutlined /> }] : []),
            { label: 'Sessions', value: 'sessions' as const, icon: <CalendarOutlined /> },
            { label: 'Updates', value: 'updates' as const, icon: <HistoryOutlined /> },
            { label: `Queries${waiting.length ? ` (${waiting.length})` : ''}`, value: 'queries' as const, icon: <QuestionCircleOutlined /> }
        ]
        return (
            <div className="ws-detail">
                <MotionCard>
                    <header className="ws-detail-head">
                        {renderSmeAvatar(record, 52)}
                        <div className="ws-detail-identity">
                            <h2 className="ws-detail-name">{record.interventionTitle || 'Untitled intervention'}</h2>
                            <div className="ws-detail-sub">
                                {[record.isGroupedDisplay ? `Grouped · ${record.memberCount || record.members?.length || 0} SMEs` : record.participantName || record.beneficiaryName, getSubInterventionLabel(record)].filter(Boolean).join(' · ')}
                            </div>
                            <div className="ws-detail-tags">
                                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                                {overdue && <StatusPill tone="danger">Overdue</StatusPill>}
                            </div>
                        </div>
                    </header>

                    <div className="mv-detail-body">
                        {(primary || secondary.length > 0) && (
                            <div className="mv-actions">
                                {primary && (
                                    <Button
                                        type="primary"
                                        danger={(primary as any).danger}
                                        icon={primary.icon}
                                        loading={(primary.key === 'remind' && remindingIds.includes(record.id))}
                                        onClick={primary.onClick}
                                    >
                                        {primary.label}
                                    </Button>
                                )}
                                {secondary.map(action => (
                                    <Button
                                        key={action.key}
                                        icon={action.icon}
                                        loading={(action.key === 'remind' && remindingIds.includes(record.id)) || (action.key === 'register' && generatingRegisterId === record.id)}
                                        onClick={action.onClick}
                                    >
                                        {action.label}
                                    </Button>
                                ))}
                            </div>
                        )}

                        {status === 'disputed' && (
                            <Alert
                                type="error"
                                showIcon
                                message={`${record.isGroupedDisplay ? 'An SME' : 'The SME'} disputes the completion`}
                                description={getCompletionRejectionReason((record.members || [record]).find(m => resolveAssignmentLifecycle(m).key === 'participant-rejected') || record) || 'Respond to say whether you’ll correct it, deliver what’s missing, or stand by the record.'}
                            />
                        )}

                        {/* Progress only while it's being delivered; a disputed delivery is explained above instead. */}
                        {['in-delivery', 'active', 'awaiting-response'].includes(status) && (
                            <Progress percent={clampPercent(progress)} status="active" />
                        )}

                        <SetupSegmented fullWidth value={detailsTab} onChange={value => setDetailsTab(value)} options={tabs} />

                        <div key={detailsTab} className="allocated-tab-pane">
                            {detailsTab === 'overview' && (
                                <>
                                    {/* The overview carries its own dates and completion status. */}
                                    {renderDetailsDescriptions(record)}
                                    {!isDocumentTarget(record) && (evidence.length > 0 || progress >= 100 || record.lifecycleBucket === 'completed') && (
                                        <section>
                                            <h3 className="ws-section-title">Evidence</h3>
                                            {evidence.length ? (
                                                <div className="qc-evidence">
                                                    {evidence.map((entry, index) => (
                                                        <Button key={`${entry.value}-${index}`} size="small" icon={<EyeOutlined />} onClick={() => window.open(entry.value, '_blank', 'noopener')}>
                                                            {evidenceDisplayName(entry, index)}
                                                        </Button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <Text type="secondary">No evidence yet.</Text>
                                            )}
                                        </section>
                                    )}
                                </>
                            )}
                            {record.isGroupedDisplay && detailsTab === 'members' && renderGroupedMembers(record)}
                            {detailsTab === 'sessions' && renderSessionsPanel(record)}
                            {detailsTab === 'updates' && renderProgressUpdates()}
                            {detailsTab === 'queries' && (
                                queries.length ? (
                                    <>
                                        {waiting.length > 0 && (
                                            <section>
                                                <h3 className="ws-section-title">Waiting for your answer</h3>
                                                <QueryInbox queries={waiting} onAnswer={q => answerQuery(record, q)} />
                                            </section>
                                        )}
                                        {earlier.length > 0 && (
                                            <section>
                                                <h3 className="ws-section-title">{waiting.length ? 'Earlier' : 'Queries'}</h3>
                                                <QueryThread queries={earlier} readOnly />
                                            </section>
                                        )}
                                    </>
                                ) : (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No queries on this intervention." />
                                )
                            )}
                        </div>
                    </div>
                </MotionCard>
            </div>
        )
    }

    const showInitialLoading = identityLoading || (loading && !hasLoadedOnce)

    return (
        <div className="ws-page">
            <Helmet>
                <title>My interventions | Smart Incubation</title>
            </Helmet>

            <style>{`
                .allocated-card-actions { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }
                .allocated-card-actions > .ant-btn { flex: 1 1 0; min-width: fit-content; justify-content: center; }
                .ant-tag { border-radius: 999px; }
                .allocated-clickable-row { cursor: pointer; }
                @keyframes allocatedTabIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
                .allocated-tab-pane { display: flex; flex-direction: column; gap: 10px; animation: allocatedTabIn 0.25s ease-out; }
                @media (prefers-reduced-motion: reduce) { .allocated-tab-pane { animation: none; } }
                .allocated-clickable-row:focus-visible { outline: 2px solid #1677ff; outline-offset: -2px; }
                .allocated-remind-all { display: flex !important; }
                .allocated-remind-all > .ant-space-item { flex: 1 1 100%; }
            `}</style>

            {showInitialLoading ? (
                <PageSkeleton variant='list' />
            ) :
                (
                    <>
                        <DashboardFilterBar>
                            <div className="ws-toolbar" data-guide="allocated-filters">
                                {/* Status first: what needs the facilitator is the first thing to see. */}
                                <Segmented
                                    data-guide="allocated-status"
                                    className="ws-toolbar-status mv-status-strip"
                                    block
                                    value={workStatus}
                                    onChange={value => setWorkStatus(value as WorkStatus)}
                                    aria-label="Filter by status"
                                    options={WORK_SEGMENTS.map(segment => ({
                                        value: segment.value,
                                        label: (
                                            <span className="mv-seg">
                                                {segment.label}
                                                {!loading && <span className={`mv-seg-count qtx-tone-${segment.tone}`}>{workCounts[segment.value]}</span>}
                                            </span>
                                        )
                                    }))}
                                />
                                <Input
                                    className="ws-toolbar-search"
                                    allowClear
                                    prefix={<SearchOutlined />}
                                    placeholder="Search SME, intervention or sector"
                                    value={searchText}
                                    onChange={event => setSearchText(event.target.value)}
                                    aria-label="Search interventions"
                                />
                                <Popover
                                    trigger="click"
                                    placement="bottomLeft"
                                    title="Filters"
                                    content={
                                        <FilterPanel canReset={!!(dateRange?.[0] || dateRange?.[1])} onReset={() => setDateRange(null)}>
                                            <div>
                                                <label className="ws-filter-label" htmlFor="allocated-dates">
                                                    Assigned (or completed) between
                                                </label>
                                                <RangePicker
                                                    id="allocated-dates"
                                                    style={{ width: '100%' }}
                                                    value={dateRange}
                                                    onChange={values => setDateRange(values as [Dayjs | null, Dayjs | null] | null)}
                                                    allowEmpty={[true, true]}
                                                    format="D MMM YYYY"
                                                />
                                            </div>
                                        </FilterPanel>
                                    }
                                >
                                    <Badge className="ws-toolbar-button" count={dateRange?.[0] || dateRange?.[1] ? 1 : 0} size="small" offset={[-6, 4]}>
                                        <Button block icon={<FilterOutlined />}>Filters</Button>
                                    </Badge>
                                </Popover>
                                {/* Remind everyone only where it applies: the "Awaiting sign-off" list. */}
                                {workStatus === 'awaiting' && workCounts.awaiting > 0 && (
                                    <Button className="ws-toolbar-button" icon={<BellOutlined />} loading={bulkReminding} onClick={sendReminderToAllVisible}>
                                        Remind all
                                    </Button>
                                )}
                            </div>
                        </DashboardFilterBar>

                        <div className="ws-layout">
                            {renderWorkList()}
                            {!isMobile && (
                                <div className="ws-detail-sticky">
                                    {detailsRecord ? renderDetailPanel(detailsRecord) : (
                                        <MotionCard>
                                            <Empty className="ws-detail-empty" description="Select an intervention to see it here." />
                                        </MotionCard>
                                    )}
                                </div>
                            )}
                        </div>

                        {isMobile && (
                            <Drawer
                                className="ws-drawer ws-sheet"
                                open={detailsModalOpen && !!detailsRecord}
                                onClose={() => setDetailsModalOpen(false)}
                                placement="bottom"
                                height="92vh"
                                title={detailsRecord?.interventionTitle || 'Intervention'}
                            >
                                {detailsRecord && renderDetailPanel(detailsRecord)}
                            </Drawer>
                        )}

                        <>
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
                                    ) : (
                                        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                                            {completionProgressEvidence.length ? (
                                                <Button
                                                    size="large"
                                                    shape="round"
                                                    icon={<ArrowLeftOutlined />}
                                                    onClick={() => setProgressModalStep(1)}
                                                    disabled={savingEvidence}
                                                    style={{ flex: '0 0 40%' }}
                                                >
                                                    Back
                                                </Button>
                                            ) : null}
                                            <Button
                                                block
                                                type="primary"
                                                size="large"
                                                shape="round"
                                                icon={<CheckCircleOutlined />}
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
                                width={isMobile ? 'calc(100vw - 20px)' : progressModalStep === 2 ? 940 : 680}
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
                                                            borderColor: isDark ? 'rgba(74, 155, 255,0.24)' : '#e6eaf0',
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
                                            <IncubateeBanner
                                                participantId={progressRecord?.isGroupedDisplay ? null : progressRecord?.participantId}
                                                companyName={progressRecord?.beneficiaryName || progressRecord?.participantName}
                                                photoUrl={photoByParticipantId[String(progressRecord?.participantId || '')]}
                                                groupCount={progressRecord?.isGroupedDisplay ? completionMovAssignments.length + completionMovExcludedAssignments.length : undefined}
                                                groupTitle={progressRecord?.interventionTitle}
                                                subtitle={progressRecord?.isGroupedDisplay ? undefined : progressRecord?.interventionTitle}
                                                extra={
                                                    <Space direction="vertical" size={4} align="end">
                                                        <Tag color="green" icon={<CheckCircleOutlined />} style={pillTag}>
                                                            Delivery complete · 100%
                                                        </Tag>
                                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                                            {completionDeliveryMethod
                                                                ? `Delivery: ${completionDeliveryMethod}`
                                                                : 'Delivery method not recorded'}
                                                        </Text>
                                                    </Space>
                                                }
                                            />

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
                                                    <Row gutter={[20, 20]}>
                                                        <Col xs={24} md={12}>
                                                            <Card
                                                                {...evidenceCardProps}
                                                                title={<EvidenceCardTitle title="MOV" tone="required" />}
                                                                extra={
                                                                    <Space size={6}>
                                                                        <Tag color="red" style={pillTag}>Required</Tag>
                                                                        <Tag
                                                                            color={completionMovUploadedCount === completionMovAssignments.length ? 'green' : 'gold'}
                                                                            style={pillTag}
                                                                        >
                                                                            {completionMovUploadedCount}/{completionMovAssignments.length} ready
                                                                        </Tag>
                                                                    </Space>
                                                                }
                                                            >
                                                                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                                                    <Text type="secondary" style={{ fontSize: 13 }}>
                                                                        Proof the service was delivered.{' '}
                                                                        {progressRecord?.isGroupedDisplay
                                                                            ? 'Upload the signed MOV for each SME who received it.'
                                                                            : 'Upload the signed MOV for this SME.'}
                                                                    </Text>
                                                    {completionMovExcludedAssignments.length ? (
                                                                        <Alert
                                                            type="info"
                                                            showIcon
                                                            message={`${completionMovExcludedAssignments.length} SME${completionMovExcludedAssignments.length === 1 ? '' : 's'} did not receive this intervention, so no MOV is required for ${completionMovExcludedAssignments.length === 1 ? 'that SME' : 'them'}.`}
                                                        />
                                                    ) : null}

                                                    {completionMovAssignments.length ? (
                                                        <Space direction="vertical" size={18} style={{ width: '100%' }}>
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
                                                                    <div key={assignment.id}>
                                                                        {progressRecord?.isGroupedDisplay ? (
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
                                                                                style={{ ...pillTag, flex: '0 0 auto' }}
                                                                            >
                                                                                {selectedFile ? 'MOV ready' : 'MOV required'}
                                                                            </Tag>

                                                                        </div>
                                                                        ) : null}

                                                                        <div style={{ marginTop: progressRecord?.isGroupedDisplay ? 10 : 0 }}>
                                                                            <Upload
                                                                                className="completion-upload"
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
                                                                                    block
                                                                                    shape="round"
                                                                                    size="large"
                                                                                    type="dashed"
                                                                                    icon={<UploadOutlined />}
                                                                                >
                                                                                    {selectedFile ? 'Replace MOV' : 'Upload signed MOV'}
                                                                                </Button>
                                                                            </Upload>
                                                                        </div>

                                                                        {selectedFile ? (
                                                                            <div style={{ marginTop: 12 }}>
                                                                                <EvidenceFileRow
                                                                                    name={fileName}
                                                                                    type={rawFile?.type}
                                                                                    size={rawFile?.size}
                                                                                    onRemove={() => setCompletionMovFilesByAssignment(current => {
                                                                                        const next = { ...current }
                                                                                        delete next[assignment.id]
                                                                                        return next
                                                                                    })}
                                                                                />
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
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

                                                                </Space>
                                                            </Card>
                                                        </Col>
                                                        <Col xs={24} md={12}>
                                                            <Card
                                                                {...evidenceCardProps}
                                                                title={
                                                                    <EvidenceCardTitle
                                                                        title={completionDeliverable.isConfigured
                                                                            ? completionDeliverable.name
                                                                            : 'Proof of Execution (POE)'}
                                                                        tone="optional"
                                                                    />
                                                                }
                                                                extra={<Tag style={pillTag}>Optional</Tag>}
                                                            >
                                                                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                                                    <Text type="secondary" style={{ fontSize: 13 }}>
                                                                        {completionDeliverable.isConfigured
                                                                            ? 'What was produced from this intervention. You can add it now or leave it out.'
                                                                            : 'Anything produced from this intervention. You can add it now or leave it out.'}
                                                                    </Text>
                                                    {completionCurrentPoes.length ? (
                                                        <Card
                                                            size="small"
                                                            title={
                                                                <Space size={8}>
                                                                    <FileProtectOutlined />
                                                                    <Text strong>Current POEs</Text>
                                                                    <Tag style={pillTag}>{completionCurrentPoes.length}</Tag>
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
                                                        className="completion-upload"
                                                        multiple
                                                        showUploadList={false}
                                                        beforeUpload={() => false}
                                                        fileList={completionPoeFiles}
                                                        onChange={({ fileList }) => setCompletionPoeFiles(fileList.slice(0, 10))}
                                                        accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                                                    >
                                                        <Button
                                                            block
                                                            shape="round"
                                                            size="large"
                                                            type="dashed"
                                                            icon={<UploadOutlined />}
                                                        >
                                                            {completionCurrentPoes.length || selectedProgressPoeUrls.length || completionPoeFiles.length ? 'Add another' : 'Add'} {completionDeliverable.isConfigured ? completionDeliverable.name : 'POE'}
                                                        </Button>
                                                    </Upload>

                                                    {completionPoePreviews.length ? (
                                                        <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                                            {completionPoePreviews.map(preview => (
                                                                <EvidenceFileRow
                                                                    key={preview.uid}
                                                                    name={preview.name}
                                                                    type={preview.type}
                                                                    onRemove={() => setCompletionPoeFiles(files =>
                                                                        files.filter(file => String(file?.uid || '') !== preview.uid)
                                                                    )}
                                                                />
                                                            ))}
                                                        </Space>
                                                    ) : null}
                                                                </Space>
                                                            </Card>
                                                        </Col>
                                                    </Row>
                                                </>
                                            ) : null}
                                        </Space>
                                    </Form>
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
                                    departmentName: effectiveUser?.departmentName || null,
                                    departmentId: effectiveUser?.departmentId || null
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
                                        : 'Manage evidence'
                                }
                                width={
                                    isMobile
                                        ? 'calc(100vw - 20px)'
                                        : manageEvidenceRecord && !isDocumentTarget(manageEvidenceRecord)
                                            ? 900
                                            : 520
                                }
                                onCancel={() => {
                                    setManageEvidenceOpen(false)
                                    setManageEvidenceRecord(null)
                                    setPendingEvidenceFiles([])
                                    setPendingReplaceTarget(undefined)
                                    setGroupEvidenceMode('bulk')
                                    setGroupEvidenceMemberId(undefined)
                                    setManageEvidencePoePage(1)

                                    manageEvidenceForm.resetFields()
                                }}
                                footer={pendingEvidenceFiles.length ? (
                                    <Button
                                        block
                                        type="primary"
                                        shape="round"
                                        icon={<UploadOutlined />}
                                        loading={savingEvidence}
                                        onClick={saveStagedEvidence}
                                    >
                                        Save {pendingEvidenceFiles.length} file{pendingEvidenceFiles.length === 1 ? '' : 's'}
                                        {evidenceForMember
                                            ? ` for ${((manageEvidenceRecord as DisplayIntervention)?.members || []).find(member => member.id === evidenceForMember)?.participantName || 'this SME'}`
                                            : isGroupEvidence ? ' for the whole group' : ''}
                                    </Button>
                                ) : null}
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
                                        <div style={{ marginBottom: 16 }}>
                                            <IncubateeBanner
                                                participantId={(manageEvidenceRecord as DisplayIntervention).isGroupedDisplay ? null : manageEvidenceRecord.participantId}
                                                companyName={manageEvidenceRecord.beneficiaryName || manageEvidenceRecord.participantName}
                                                photoUrl={photoByParticipantId[String(manageEvidenceRecord.participantId || '')]}
                                                groupCount={(manageEvidenceRecord as DisplayIntervention).isGroupedDisplay
                                                    ? (manageEvidenceRecord as DisplayIntervention).memberCount || 0
                                                    : undefined}
                                                groupTitle={manageEvidenceRecord.interventionTitle}
                                                subtitle={(manageEvidenceRecord as DisplayIntervention).isGroupedDisplay
                                                    ? manageEvidenceRecord.subInterventionTitle
                                                    : manageEvidenceRecord.interventionTitle || 'Untitled intervention'}
                                            />
                                        </div>

                                        <Row gutter={[20, 20]} align="top">
                                        {(
                                            <Col xs={24} md={isDocumentTarget(manageEvidenceRecord) ? 24 : 12}>
                                            <Card
                                                {...evidenceCardProps}
                                                style={{ ...evidenceCardProps.style, height: 'auto' }}
                                                extra={manageEvidenceRecord ? (
                                                    <Space size={6}>
                                                                {!isDocumentTarget(manageEvidenceRecord) ? (
                                                                    <Tag style={pillTag}>Optional</Tag>
                                                                ) : null}
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
                                                            </Space>
                                                ) : null}
                                                title={
                                                    <EvidenceCardTitle
                                                        tone="optional"
                                                        title={isDocumentTarget(manageEvidenceRecord) ? 'Documents' : isGroupEvidence ? `Group ${manageEvidenceAddLabel}` : manageEvidenceDeliverableName}
                                                    />
                                                }
                                            >
                                            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                                <Text type="secondary" style={{ fontSize: 13 }}>
                                                    {isGroupEvidence
                                                        ? `Shared with all ${(manageEvidenceRecord as DisplayIntervention).memberCount || (manageEvidenceRecord as DisplayIntervention).members?.length || 0} SMEs in the group.`
                                                        : isDocumentTarget(manageEvidenceRecord)
                                                        ? 'Documents on file for this SME.'
                                                        : 'What was produced from this intervention.'}
                                                </Text>
                                                {manageEvidenceEntries.length ? (
                                                    <Dropdown
                                                        trigger={['click']}
                                                        menu={{
                                                            items: [
                                                                { key: 'add-new', label: 'Add new' },
                                                                { key: 'replace-all', label: 'Replace all' }
                                                            ],
                                                            onClick: ({ key }) =>
                                                                pickEvidenceFiles(null, 
                                                                    key === 'replace-all' ? 'all' : undefined
                                                                )
                                                        }}
                                                    >
                                                        <Button
                                                            data-guide="add-poe-action"
                                                            block
                                                            shape="round"
                                                            size="large"
                                                            type="dashed"
                                                            icon={<UploadOutlined />}
                                                            loading={savingEvidence}
                                                        >
                                                            {pendingEvidenceFiles.length ? 'Add more' : `Add ${manageEvidenceAddLabel}`}
                                                        </Button>
                                                    </Dropdown>
                                                ) : (
                                                    <Button
                                                        data-guide="add-poe-action"
                                                        block
                                                        shape="round"
                                                        size="large"
                                                        type="dashed"
                                                        icon={<UploadOutlined />}
                                                        loading={savingEvidence}
                                                        onClick={() => pickEvidenceFiles(null, )}
                                                    >
                                                        {pendingEvidenceFiles.length ? 'Add more' : `Add ${manageEvidenceAddLabel}`}
                                                    </Button>
                                                )}
                                                <input
                                                    ref={manageEvidenceFileInputRef}
                                                    type="file"
                                                    hidden
                                                    multiple
                                                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                                                    onChange={handleManageEvidenceFileSelection}
                                                />
                                                {pendingEvidenceFiles.length && !evidenceForMember ? (
                                                    <div>
                                                        <Text strong style={{ display: 'block', marginBottom: 6 }}>
                                                            Ready to save ({pendingEvidenceFiles.length})
                                                        </Text>
                                                        {pendingReplaceTarget ? (
                                                            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
                                                                {pendingReplaceTarget === 'all'
                                                                    ? 'These will replace all the files currently on file.'
                                                                    : 'These will replace the file you chose to replace.'}
                                                            </Text>
                                                        ) : null}
                                                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                                            {pendingEvidenceFiles.map((file, index) => (
                                                                <EvidenceFileRow
                                                                    key={`${file.name}-${file.size}-${index}`}
                                                                    name={file.name}
                                                                    type={file.type}
                                                                    size={file.size}
                                                                    disabled={savingEvidence}
                                                                    onRemove={() => {
                                                                        setPendingEvidenceFiles(current => {
                                                                            const next = current.filter((_, position) => position !== index)
                                                                            if (!next.length) setPendingReplaceTarget(undefined)
                                                                            return next
                                                                        })
                                                                    }}
                                                                />
                                                            ))}
                                                        </Space>
                                                    </div>
                                                ) : null}
                                                {manageEvidenceEntries.length ? (
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
                                                        bare
                                                        onReplace={resource => pickEvidenceFiles(null, resource.link)}
                                                        onUpload={() => undefined}
                                                        onRemove={resource => isDocumentTarget(manageEvidenceRecord)
                                                            ? removeManagedDocument(manageEvidenceRecord, resource.link)
                                                            : removePoe(manageEvidenceRecord, resource.link)}
                                                        uploading={savingEvidence}
                                                    />
                                                </div>
                                                ) : null}
                                            </Space>
                                            </Card>
                                            </Col>
                                        )}
                                        {!isDocumentTarget(manageEvidenceRecord) ? (
                                            <Col
                                                xs={24}
                                                md={12}
                                            >
                                                <ManageMovCard
                                                    targets={(
                                                        (manageEvidenceRecord as DisplayIntervention).isGroupedDisplay
                                                            ? ((manageEvidenceRecord as DisplayIntervention).members || [])
                                                            : [manageEvidenceRecord]
                                                    ).map((row: any) => ({
                                                        id: String(row.id),
                                                        name: String(row.participantName || row.beneficiaryName || row.participantId || 'SME'),
                                                        programId: row.programId || null,
                                                        participantId: row.participantId || null
                                                    }))}
                                                />
                                            </Col>
                                        ) : null}
                                        </Row>

                                        {isGroupEvidence && (
                                            <section className="al-sme-evidence">
                                                <h3 className="ws-section-title">Per SME</h3>
                                                <p className="al-muted">Evidence for one SME only, such as their own signed register. It isn't shared with the group.</p>
                                                <ul className="al-sme-list">
                                                    {((manageEvidenceRecord as DisplayIntervention).members || []).map(member => {
                                                        const own = memberOwnUploads(manageEvidenceRecord as DisplayIntervention, member)
                                                        const picking = evidenceForMember === member.id
                                                        return (
                                                            <li key={member.id} className={`al-sme-item${picking ? ' is-active' : ''}`}>
                                                                <div className="al-sme-head">
                                                                    <span className="al-sme-name">{member.participantName || member.beneficiaryName || 'SME'}</span>
                                                                    <span className="al-muted">{own.length ? `${own.length} file${own.length === 1 ? '' : 's'}` : 'Group POE only'}</span>
                                                                    <Button size="small" icon={<UploadOutlined />} disabled={savingEvidence} onClick={() => pickEvidenceFiles(member.id)}>
                                                                        Add
                                                                    </Button>
                                                                </div>
                                                                {own.map(resource => (
                                                                    <EvidenceFileRow
                                                                        key={resource.link}
                                                                        name={resource.originalName || resource.label || 'POE'}
                                                                        href={resource.link}
                                                                        disabled={!!deletingPoeUrl}
                                                                        onRemove={() => void removePoe(member, resource.link)}
                                                                        confirmTitle="Remove this SME's file?"
                                                                        confirmDescription="It's taken off this SME's evidence and their MOV."
                                                                    />
                                                                ))}
                                                                {picking && pendingEvidenceFiles.map((file, index) => (
                                                                    <EvidenceFileRow
                                                                        key={`${file.name}-${file.size}-${index}`}
                                                                        name={file.name}
                                                                        type={file.type}
                                                                        size={file.size}
                                                                        disabled={savingEvidence}
                                                                        onRemove={() => setPendingEvidenceFiles(current => current.filter((_, position) => position !== index))}
                                                                    />
                                                                ))}
                                                            </li>
                                                        )
                                                    })}
                                                </ul>
                                            </section>
                                        )}

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

                        </>
                    </>
                )}
        </div>
    )
}

export default CoordinatorAllocatedInterventions
