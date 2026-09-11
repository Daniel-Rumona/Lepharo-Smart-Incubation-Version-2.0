import {
    QueryConstraint,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { Assignment, AssigneeRole } from '@/types/intervetion'
import {
    normalizeAcceptanceStatus,
    normalizeAssigneeCompletionStatus,
    normalizeAssignmentStatus,
    normalizeParticipantCompletionStatus,
    resolveAssignmentLifecycle
} from '@/services/assignmentLifecycleService'

export const ASSIGNED_INTERVENTIONS_COLLECTION = 'assignedInterventions'
export const ASSIGNED_INTERVENTION_SCHEMA_VERSION = 3

export type AssignedInterventionView = Assignment & Record<string, any>

export function getAssignedInterventionLifecycle(data: Record<string, any>) {
    const lifecycle = resolveAssignmentLifecycle(data)
    if (lifecycle.key === 'completed') return 'completed' as const
    if (lifecycle.key === 'cancelled') return 'cancelled' as const
    if (lifecycle.key === 'needs-reassignment') return 'needs-reassignment' as const
    if (lifecycle.isDeclined) return 'declined' as const
    return 'in-progress' as const
}

/** True only when the SME/participant has confirmed completion. */
export function hasSmeConfirmedCompletion(data: Record<string, any>) {
    return normalizeParticipantCompletionStatus(data.participantCompletionStatus) === 'confirmed' ||
        Boolean(data.participantConfirmedAt)
}

export function assignedInterventionIdentityKey(data: Record<string, any>) {
    const participantId = clean(data.participantId)
    const interventionId = clean(data.interventionId)
    if (!participantId || !interventionId) return ''
    const subInterventionId = clean(data.subInterventionId) || 'nosub'
    const cycleKey = clean(data.cycleKey) || assignmentMonth(data.createdAt) || 'missing-cycle'
    return [participantId, interventionId, subInterventionId, cycleKey].join('|')
}

export function dedupeAssignedInterventionViews<T extends Record<string, any>>(rows: T[]): T[] {
    const byIdentity = new Map<string, T>()
    const withoutIdentity: T[] = []
    for (const row of rows) {
        const key = assignedInterventionIdentityKey(row)
        if (!key) {
            withoutIdentity.push(row)
            continue
        }
        const current = byIdentity.get(key)
        if (!current || assignmentRank(row) > assignmentRank(current)) byIdentity.set(key, row)
    }
    return [...byIdentity.values(), ...withoutIdentity]
}

export interface AssignedInterventionFilters {
    assigneeId?: string

    participantId?: string
    participantIds?: string[]
    interventionId?: string
    programId?: string
    departmentId?: string
    assignmentStatus?: string
    groupKey?: string
}

/** Strict schema-v3 read model. Firestore must be migrated before this code is deployed. */
export function toAssignedInterventionView(id: string, data: Record<string, any>): AssignedInterventionView {
    const assignmentStatus = normalizeAssignmentStatus(data.assignmentStatus)
    const assigneeAcceptanceStatus = normalizeAcceptanceStatus(data.assigneeAcceptanceStatus)
    const participantAcceptanceStatus = normalizeAcceptanceStatus(data.participantAcceptanceStatus)
    const assigneeCompletionStatus = normalizeAssigneeCompletionStatus(data.assigneeCompletionStatus)
    const participantCompletionStatus = normalizeParticipantCompletionStatus(data.participantCompletionStatus)

    return {
        ...data,
        id,
        schemaVersion: Number(data.schemaVersion || ASSIGNED_INTERVENTION_SCHEMA_VERSION),
        participantId: clean(data.participantId),
        participantName: clean(data.participantName),
        assigneeId: clean(data.assigneeId),
        assigneeProfileId: clean(data.assigneeProfileId) || null,
        assigneeName: clean(data.assigneeName),
        assigneeEmail: clean(data.assigneeEmail) || null,
        assigneeRole: normalizeAssigneeRole(data.assigneeRole),
        assignmentStatus,
        assigneeAcceptanceStatus,
        participantAcceptanceStatus,
        assigneeCompletionStatus,
        participantCompletionStatus,
        assigneeAcceptedAt: data.assigneeAcceptedAt || null,
        assigneeDeclinedAt: data.assigneeDeclinedAt || null,
        assigneeDeclineReason: data.assigneeDeclineReason || null,
        assigneeCompletedAt: data.assigneeCompletedAt || null,
        type: normalizeAssignmentType(data.type, data.groupKey),
        groupKey: clean(data.groupKey) || null,
        groupedAt: data.groupedAt || null,
        scheduleMode: normalizeScheduleMode(data.scheduleMode),
        recurrence: normalizeRecurrence(data.recurrence),
        computedProgress: numberOr(data.computedProgress, 0),
        tracking: normalizeTracking(data.tracking),
        progressUpdates: Array.isArray(data.progressUpdates) ? data.progressUpdates : [],
        reassignmentHistory: canonicalHistory(data.reassignmentHistory)
    } as unknown as AssignedInterventionView
}

/** Produces a complete schema-v3 document and strips all deprecated duplicates. */
export function canonicalizeAssignedInterventionWrite(input: Record<string, any>) {
    const canonical: Record<string, any> = { ...toAssignedInterventionView(clean(input.id), input) }
    delete canonical.id
    for (const field of DEPRECATED_ASSIGNMENT_FIELDS) delete canonical[field]

    return stripUndefined({
        ...canonical,
        schemaVersion: ASSIGNED_INTERVENTION_SCHEMA_VERSION,
        updatedAt: input.updatedAt ?? serverTimestamp()
    })
}

/** Canonicalizes only supplied fields, so partial lifecycle updates remain partial. */
export function canonicalizeAssignedInterventionPatch(input: Record<string, any>) {
    const patch: Record<string, any> = { ...input }
    delete patch.id

    for (const field of DEPRECATED_ASSIGNMENT_FIELDS) delete patch[field]
    if (Object.hasOwn(patch, 'assigneeRole')) patch.assigneeRole = normalizeAssigneeRole(patch.assigneeRole)
    if (Object.hasOwn(patch, 'assignmentStatus')) {
        patch.assignmentStatus = normalizeAssignmentStatus(patch.assignmentStatus)
    }
    if (Object.hasOwn(patch, 'assigneeAcceptanceStatus')) {
        patch.assigneeAcceptanceStatus = normalizeAcceptanceStatus(patch.assigneeAcceptanceStatus)
    }
    if (Object.hasOwn(patch, 'participantAcceptanceStatus')) {
        patch.participantAcceptanceStatus = normalizeAcceptanceStatus(patch.participantAcceptanceStatus)
    }
    if (Object.hasOwn(patch, 'assigneeCompletionStatus')) {
        patch.assigneeCompletionStatus = normalizeAssigneeCompletionStatus(patch.assigneeCompletionStatus)
    }
    if (Object.hasOwn(patch, 'participantCompletionStatus')) {
        patch.participantCompletionStatus = normalizeParticipantCompletionStatus(patch.participantCompletionStatus)
    }
    if (Object.hasOwn(patch, 'type')) patch.type = normalizeAssignmentType(patch.type, patch.groupKey)
    if (Object.hasOwn(patch, 'scheduleMode')) {
        patch.scheduleMode = normalizeScheduleMode(patch.scheduleMode)
    }
    if (Object.hasOwn(patch, 'recurrence')) {
        patch.recurrence = normalizeRecurrence(patch.recurrence)
    }
    if (Object.hasOwn(patch, 'tracking')) patch.tracking = normalizeTracking(patch.tracking)
    if (Object.hasOwn(patch, 'reassignmentHistory')) {
        patch.reassignmentHistory = canonicalHistory(patch.reassignmentHistory)
    }

    return stripUndefined({
        ...patch,
        schemaVersion: ASSIGNED_INTERVENTION_SCHEMA_VERSION,
        updatedAt: input.updatedAt ?? serverTimestamp()
    })
}

export const assignedInterventionService = {
    collectionRef() {
        return collection(db, ASSIGNED_INTERVENTIONS_COLLECTION)
    },

    docRef(id: string) {
        return doc(db, ASSIGNED_INTERVENTIONS_COLLECTION, id)
    },

    async getById(id: string): Promise<AssignedInterventionView | null> {
        const snapshot = await getDoc(this.docRef(id))
        return snapshot.exists() ? toAssignedInterventionView(snapshot.id, snapshot.data()) : null
    },

    async list(filters: AssignedInterventionFilters = {}): Promise<AssignedInterventionView[]> {
        const constraints = buildAssignedInterventionConstraints(filters)
        const snapshot = await getDocs(query(this.collectionRef(), ...constraints))
        return snapshot.docs.map(item => toAssignedInterventionView(item.id, item.data()))
    },

    /** Returns only assignments whose SME has confirmed completion. */
    async listCompleted(filters: AssignedInterventionFilters = {}): Promise<AssignedInterventionView[]> {
        const rows = await this.list(filters)
        return rows.filter(row => hasSmeConfirmedCompletion(row))
    },

    async create(id: string, input: Record<string, any>) {
        await setDoc(this.docRef(id), canonicalizeAssignedInterventionWrite({ ...input, id }), { merge: false })
        return id
    },

    async update(id: string, changes: Record<string, any>) {
        await setDoc(this.docRef(id), canonicalizeAssignedInterventionPatch(changes), { merge: true })
    },

    async remove(id: string) {
        await deleteDoc(this.docRef(id))
    }
}

export function buildAssignedInterventionConstraints(
    filters: AssignedInterventionFilters = {},
    completedOnly = false
): QueryConstraint[] {
    const constraints: QueryConstraint[] = []
    if (completedOnly) constraints.push(where('participantCompletionStatus', '==', 'confirmed'))

    for (const [field, value] of Object.entries(filters)) {
        if (field === 'participantIds') continue
        if (value !== undefined && value !== null && value !== '') {
            constraints.push(where(field, '==', value))
        }
    }

    const participantIds = filters.participantIds?.map(clean).filter(Boolean) || []
    if (participantIds.length) constraints.push(where('participantId', 'in', participantIds.slice(0, 10)))
    return constraints
}

/** Firestore query helper for live completed-intervention consumers. */
export function completedAssignedInterventionsQuery(filters: AssignedInterventionFilters = {}) {
    return query(
        collection(db, ASSIGNED_INTERVENTIONS_COLLECTION),
        ...buildAssignedInterventionConstraints(filters, true)
    )
}

export function mapAssignedInterventionSnapshot(snapshot: { docs: Array<{ id: string; data(): Record<string, any> }> }) {
    return snapshot.docs.map(item => toAssignedInterventionView(item.id, item.data()))
}

export function normalizeAssigneeRole(value: unknown): AssigneeRole {
    const role = clean(value).toLowerCase()
    return ['operations', 'hod', 'projectmanager'].includes(role) ? 'operations' : 'coordinator'
}

function normalizeAssignmentType(value: unknown, groupKey: unknown) {
    const type = clean(value).toLowerCase()
    return type === 'grouped' || type === 'group' || clean(groupKey) ? 'grouped' : 'singular'
}

function normalizeScheduleMode(value: unknown) {
    const mode = clean(value).toLowerCase().replace(/_/g, '-')
    if (mode === 'ad-hoc' || mode === 'adhoc') return 'ad-hoc'
    if (mode === 'recurring') return 'recurring'
    return 'once-off'
}

function normalizeRecurrence(value: any) {
    if (!value || typeof value !== 'object') return null
    const every = Number(value.every ?? value.interval ?? 1)
    const unit = clean(value.unit).toLowerCase().replace(/s$/, '')
    if (!['day', 'week', 'month', 'quarter', 'year'].includes(unit)) return null
    return { every: Number.isFinite(every) && every > 0 ? every : 1, unit, strict: Boolean(value.strict) }
}

function normalizeTracking(value: any) {
    const tracking = value && typeof value === 'object' ? value : {}
    return {
        sessionsLogged: numberOr(tracking.sessionsLogged, 0)
    }
}

function canonicalHistory(value: any) {
    if (!Array.isArray(value)) return []
    return value.map(item => {
        const history = item || {}
        return stripUndefined({
            fromAssigneeId: history.fromAssigneeId || null,
            fromAssigneeName: history.fromAssigneeName || null,
            toAssigneeId: history.toAssigneeId || null,
            toAssigneeName: history.toAssigneeName || null,
            changedById: history.changedById || null,
            changedAt: history.changedAt || null,
            reason: history.reason || null
        })
    })
}

export const DEPRECATED_ASSIGNMENT_FIELDS = [
    'companyCode', 'beneficiaryName', 'incubateeCompanyName', 'status', 'assigneeStatus', 'userStatus',
    'beneficiaryStatus', 'userCompletionStatus', 'consultantId', 'consultantName',
    'consultantEmail', 'consultantStatus', 'consultantCompletionStatus', 'consultantAcceptedAt',
    'consultantDecisionAt', 'consultantDeclinedAt', 'consultantDeclineReason', 'consultantNotes',
    'assigneeNotes', 'consultantCompletedAt', 'consultantCompletionAt', 'facilitatorCompletionStatus',
    'countedForConsultant', 'countedForAssignee', 'groupedAssignment', 'groupAssignmentId', 'groupId', 'groupMeta',
    'groupMemberCount', 'assignmentMode', 'recurring', 'frequency', 'recurrencePreset',
    'recurrenceStrict', 'progress', 'deliveryWorkProgress', 'timeSpent', 'completionStatus', 'deliveryMethod', 'notes',
    'poeFileUrl', 'proofOfExecutionUrl', 'poeUrl', 'evidenceUrl',
    'movFileUrl', 'evidenceFile', 'poeFile'
] as const

function numberOr(...values: unknown[]) {
    for (const value of values) {
        const number = Number(value)
        if (Number.isFinite(number)) return number
    }
    return 0
}

function clean(value: unknown) {
    return String(value ?? '').trim()
}

function stripUndefined<T extends Record<string, any>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function assignmentRank(data: Record<string, any>) {
    const lifecycle = getAssignedInterventionLifecycle(data)
    const lifecycleRank = {
        completed: 5,
        'in-progress': 4,
        'awaiting-assignee': 3,
        declined: 2,
        'needs-reassignment': 1,
        cancelled: 0
    }[lifecycle]
    const timestamp = data.updatedAt?.toMillis?.() || data.updatedAt?.toDate?.()?.getTime?.() ||
        data.createdAt?.toMillis?.() || data.createdAt?.toDate?.()?.getTime?.() || 0
    return lifecycleRank * 10 ** 15 + Number(timestamp || 0)
}

function assignmentMonth(value: any) {
    const date = value?.toDate?.() || (value instanceof Date ? value : null)
    if (!date || Number.isNaN(date.getTime())) return ''
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
