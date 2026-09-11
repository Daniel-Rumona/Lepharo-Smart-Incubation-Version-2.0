import {
    QueryConstraint,
    Timestamp,
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import {
    WORKFLOW_QUERIES_COLLECTION,
    WORKFLOW_QUERY_SCHEMA_VERSION,
    WorkflowQuery,
    WorkflowQueryActorSnapshot,
    WorkflowQueryContext,
    WorkflowQueryStatus,
    WorkflowQueryTarget
} from '@/types/workflowQuery'

export interface WorkflowQueryActorInput extends WorkflowQueryActorSnapshot {
    id?: string | null
}

export interface CreateWorkflowQueryInput {
    programId: string
    type: string
    message: string
    status?: WorkflowQueryStatus
    raisedById: string
    raisedBy: WorkflowQueryActorInput
    resolverId?: string | null
    resolver?: WorkflowQueryActorInput
    target: WorkflowQueryTarget
    context?: WorkflowQueryContext
}

export interface WorkflowQueryFilters {
    resolverId?: string
    resolverIds?: string[]
    raisedById?: string
    programId?: string
    status?: WorkflowQueryStatus
    targetType?: WorkflowQueryTarget['type']
    targetId?: string
    participantId?: string
    interventionId?: string
    movId?: string
    movIds?: string[]
    consolidatedMovId?: string
    consolidatedMovIds?: string[]
}

export interface ResolveWorkflowQueryInput {
    notes?: string
    attachmentUrl?: string | null
    actorId: string
    actor: WorkflowQueryActorInput
}

/**
 * Transitional read model used while existing screens move to the canonical
 * nested WorkflowQuery shape. All aliases are derived here; Firestore only
 * stores the canonical fields.
 */
export type WorkflowQueryView = WorkflowQuery & {
    queryType: string
    queryMessage: string
    raisedByUser: string
    raisedById: string
    raisedByName?: string | null
    raisedByEmail?: string | null
    raisedByRole?: string | null
    raisedByDept?: string | null
    consultantId?: string | null
    assigneeId?: string | null
    receivedByUser?: string | null
    receivedByName?: string | null
    receivedByEmail?: string | null
    receivedByRole?: string | null
    targetType: WorkflowQueryTarget['type']
    participantId?: string | null
    interventionId?: string | null
    interventionTitle?: string | null
    movId?: string | null
    consolidatedMovId?: string | null
    movRowId?: string | null
    departmentName?: string | null
    poeUrl?: string | null
    resolutionNotes?: string | null
    consultantResponse?: string | null
    uploadedFileUrl?: string | null
    resolvedAt?: Timestamp | null
    repliedAt?: Timestamp | null
    repliedByUser?: string | null
    repliedByName?: string | null
    repliedByEmail?: string | null
    repliedByRole?: string | null
}

export const workflowQueryService = {
    async create(input: CreateWorkflowQueryInput): Promise<string> {
        const message = String(input.message || '').trim()
        const programId = String(input.programId || '').trim()
        const raisedById = String(input.raisedById || '').trim()

        if (!programId) throw new Error('A program is required to create a query.')
        if (!message) throw new Error('A query message is required.')
        if (!input.target?.id || !input.target?.type) throw new Error('An exact query target is required.')
        if (!raisedById) throw new Error('The query raiser is required.')

        const resolver = await resolveWorkflowQueryActor({
            ...input.resolver,
            id: input.resolverId || input.resolver?.id
        })
        if (!resolver.uid) throw new Error('The query resolver could not be identified.')

        const payload = stripUndefined({
            schemaVersion: WORKFLOW_QUERY_SCHEMA_VERSION,
            programId,
            type: String(input.type || 'general-query').trim() || 'general-query',
            message,
            status: input.status || 'open',
            raisedById,
            raisedBy: actorSnapshot(input.raisedBy),
            resolverId: resolver.uid,
            resolverProfileId: resolver.profileId,
            resolver: actorSnapshot(resolver),
            assignedAt: serverTimestamp(),
            target: input.target,
            context: input.context || {},
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        })

        const created = await addDoc(collection(db, WORKFLOW_QUERIES_COLLECTION), payload)
        return created.id
    },

    async getById(id: string): Promise<WorkflowQueryView | null> {
        const snapshot = await getDoc(doc(db, WORKFLOW_QUERIES_COLLECTION, id))
        return snapshot.exists() ? toWorkflowQueryView(snapshot.id, snapshot.data()) : null
    },

    async list(filters: WorkflowQueryFilters = {}): Promise<WorkflowQueryView[]> {
        const movIds = uniqueStrings(filters.movIds || [])
        if (movIds.length) {
            const results = await Promise.all(
                chunk(movIds, 10).map(group => this.listSingle({ ...filters, movIds: undefined }, [
                    where('context.movId', 'in', group)
                ]))
            )
            return sortAndDedupe(results.flat())
        }

        const consolidatedMovIds = uniqueStrings(filters.consolidatedMovIds || [])
        if (consolidatedMovIds.length) {
            const results = await Promise.all(
                chunk(consolidatedMovIds, 10).map(group => this.listSingle({ ...filters, consolidatedMovIds: undefined }, [
                    where('context.consolidatedMovId', 'in', group)
                ]))
            )
            return sortAndDedupe(results.flat())
        }

        const resolverIds = uniqueStrings([
            ...(filters.resolverIds || []),
            ...(filters.resolverId ? [filters.resolverId] : [])
        ])

        if (resolverIds.length > 1) {
            const groups = chunk(resolverIds, 10)
            const results = await Promise.all(
                groups.map(group => this.listSingle({ ...filters, resolverId: undefined, resolverIds: undefined }, [
                    where('resolverId', 'in', group)
                ]))
            )
            return sortAndDedupe(results.flat())
        }

        const base = resolverIds.length === 1 ? [where('resolverId', '==', resolverIds[0])] : []
        return this.listSingle({ ...filters, resolverId: undefined, resolverIds: undefined }, base)
    },

    async listSingle(
        filters: WorkflowQueryFilters,
        initialConstraints: QueryConstraint[] = []
    ): Promise<WorkflowQueryView[]> {
        const constraints: QueryConstraint[] = [...initialConstraints]
        if (filters.raisedById) constraints.push(where('raisedById', '==', filters.raisedById))
        if (filters.programId) constraints.push(where('programId', '==', filters.programId))
        if (filters.status) constraints.push(where('status', '==', filters.status))
        if (filters.targetType) constraints.push(where('target.type', '==', filters.targetType))
        if (filters.targetId) constraints.push(where('target.id', '==', filters.targetId))
        if (filters.participantId) constraints.push(where('context.participantId', '==', filters.participantId))
        if (filters.interventionId) constraints.push(where('context.interventionId', '==', filters.interventionId))
        if (filters.movId) constraints.push(where('context.movId', '==', filters.movId))
        if (filters.consolidatedMovId) {
            constraints.push(where('context.consolidatedMovId', '==', filters.consolidatedMovId))
        }

        const snapshot = await getDocs(query(collection(db, WORKFLOW_QUERIES_COLLECTION), ...constraints))
        return sortAndDedupe(snapshot.docs.map(item => toWorkflowQueryView(item.id, item.data())))
    },

    async update(id: string, changes: Partial<Pick<WorkflowQuery, 'type' | 'message' | 'status' | 'target' | 'context'>>) {
        await updateDoc(doc(db, WORKFLOW_QUERIES_COLLECTION, id), {
            ...changes,
            updatedAt: serverTimestamp()
        })
    },

    async reassign(id: string, resolverInput: WorkflowQueryActorInput) {
        const resolver = await resolveWorkflowQueryActor(resolverInput)
        if (!resolver.uid) throw new Error('The new resolver could not be identified.')
        await updateDoc(doc(db, WORKFLOW_QUERIES_COLLECTION, id), {
            resolverId: resolver.uid,
            resolverProfileId: resolver.profileId,
            resolver: actorSnapshot(resolver),
            assignedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        })
    },

    async resolve(id: string, input: ResolveWorkflowQueryInput) {
        const actor = await resolveWorkflowQueryActor({ ...input.actor, id: input.actorId })
        const actorId = actor.uid || String(input.actorId || '').trim()
        if (!actorId) throw new Error('The resolving user could not be identified.')

        const notes = String(input.notes || '').trim()
        const snapshot = actorSnapshot(actor)
        const now = serverTimestamp()
        await updateDoc(doc(db, WORKFLOW_QUERIES_COLLECTION, id), {
            status: 'resolved',
            response: {
                message: notes,
                attachmentUrl: input.attachmentUrl || null,
                respondedById: actorId,
                respondedBy: snapshot,
                respondedAt: now
            },
            resolution: {
                notes,
                resolvedById: actorId,
                resolvedBy: snapshot,
                resolvedAt: now
            },
            updatedAt: now
        })
    },

    async remove(id: string) {
        await deleteDoc(doc(db, WORKFLOW_QUERIES_COLLECTION, id))
    }
}

export async function resolveWorkflowQueryActor(input: WorkflowQueryActorInput = {}) {
    const candidateId = String(input.id || '').trim()
    let profileId: string | null = null
    let profile: Record<string, any> | null = null
    let candidateIsUser = false

    if (candidateId) {
        for (const collectionName of ['users', 'coordinators', 'consultants']) {
            const snapshot = await getDoc(doc(db, collectionName, candidateId))
            if (!snapshot.exists()) continue
            profileId = snapshot.id
            profile = snapshot.data()
            if (collectionName === 'users') {
                candidateIsUser = true
                break
            }

            const authUid = String(profile.authUid || profile.uid || '').trim()
            if (authUid) {
                const userSnapshot = await getDoc(doc(db, 'users', authUid))
                if (userSnapshot.exists()) profile = { ...profile, ...userSnapshot.data(), uid: authUid }
                break
            }
        }
    }

    const email = String(input.email || profile?.email || '').trim().toLowerCase()
    if (!candidateIsUser && !profile?.uid && !profile?.authUid && email) {
        const matches = await getDocs(query(collection(db, 'users'), where('email', '==', email)))
        if (matches.size === 1) {
            profileId = profileId || matches.docs[0].id
            profile = { ...(profile || {}), ...matches.docs[0].data(), uid: matches.docs[0].id }
            candidateIsUser = true
        }
    }

    const name = String(input.name || profile?.name || profile?.displayName || '').trim()
    if (!candidateIsUser && !profile?.uid && !profile?.authUid && name) {
        const matches = await getDocs(query(collection(db, 'users'), where('name', '==', name)))
        if (matches.size === 1) {
            profileId = profileId || matches.docs[0].id
            profile = { ...(profile || {}), ...matches.docs[0].data(), uid: matches.docs[0].id }
            candidateIsUser = true
        }
    }

    return {
        uid: actorUid(profile, candidateIsUser ? candidateId : ''),
        profileId,
        name: String(profile?.name || profile?.displayName || profile?.fullName || input.name || '').trim() || null,
        email: String(profile?.email || input.email || '').trim().toLowerCase() || null,
        role: String(profile?.role || input.role || '').trim() || null,
        departmentId: String(profile?.departmentId || input.departmentId || '').trim() || null,
        departmentName: String(profile?.departmentName || input.departmentName || '').trim() || null
    }
}

export function workflowQueryTargetFromLegacy(value: {
    targetType?: string | null
    movRowId?: string | null
    movId?: string | null
    consolidatedMovId?: string | null
    interventionId?: string | null
    queryType?: string | null
}): WorkflowQueryTarget {
    if (value.targetType === 'poe') {
        return {
            type: 'poe',
            id: String(value.movRowId || value.movId || value.interventionId || ''),
            parentType: value.consolidatedMovId ? 'mov-pack' : value.movId ? 'mov' : 'intervention',
            parentId: value.consolidatedMovId || value.movId || value.interventionId || null
        }
    }
    if (value.consolidatedMovId) return { type: 'mov-pack', id: value.consolidatedMovId }
    if (value.movId) return { type: 'mov', id: value.movId }
    if (String(value.queryType || '').startsWith('completion-')) {
        return { type: 'assigned-intervention', id: String(value.interventionId || '') }
    }
    return { type: 'intervention', id: String(value.interventionId || '') }
}

function toWorkflowQueryView(id: string, data: Record<string, any>): WorkflowQueryView {
    const item = { id, ...data } as WorkflowQuery
    return {
        ...item,
        queryType: item.type,
        queryMessage: item.message,
        raisedByUser: item.raisedById,
        raisedById: item.raisedById,
        raisedByName: item.raisedBy?.name,
        raisedByEmail: item.raisedBy?.email,
        raisedByRole: item.raisedBy?.role,
        raisedByDept: item.raisedBy?.departmentName,
        consultantId: item.resolverId,
        assigneeId: item.resolverId,
        receivedByUser: item.resolverId,
        receivedByName: item.resolver?.name,
        receivedByEmail: item.resolver?.email,
        receivedByRole: item.resolver?.role,
        targetType: item.target.type,
        participantId: item.context?.participantId,
        interventionId: item.context?.interventionId,
        interventionTitle: item.context?.interventionTitle,
        movId: item.context?.movId,
        consolidatedMovId: item.context?.consolidatedMovId,
        movRowId: item.context?.movRowId,
        departmentName: item.context?.departmentName,
        poeUrl: item.context?.evidenceUrl,
        resolutionNotes: item.resolution?.notes || item.response?.message,
        consultantResponse: item.response?.message,
        uploadedFileUrl: item.response?.attachmentUrl,
        resolvedAt: item.resolution?.resolvedAt,
        repliedAt: item.response?.respondedAt,
        repliedByUser: item.response?.respondedById,
        repliedByName: item.response?.respondedBy?.name,
        repliedByEmail: item.response?.respondedBy?.email,
        repliedByRole: item.response?.respondedBy?.role
    }
}

function actorUid(profile: Record<string, any> | null, candidateId: string) {
    return String(profile?.uid || profile?.authUid || (profile && candidateId) || '').trim()
}

function actorSnapshot(actor: WorkflowQueryActorInput): WorkflowQueryActorSnapshot {
    return stripUndefined({
        name: actor.name || null,
        email: actor.email ? String(actor.email).trim().toLowerCase() : null,
        role: actor.role || null,
        departmentId: actor.departmentId || null,
        departmentName: actor.departmentName || null
    })
}

function sortAndDedupe(items: WorkflowQueryView[]) {
    const unique = [...new Map(items.map(item => [item.id, item])).values()]
    return unique.sort((left, right) => timestampMillis(right.updatedAt || right.createdAt) - timestampMillis(left.updatedAt || left.createdAt))
}

function timestampMillis(value: any) {
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (typeof value?.toDate === 'function') return value.toDate().getTime()
    const date = value instanceof Date ? value : new Date(value || 0)
    return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function uniqueStrings(values: string[]) {
    return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
}

function chunk<T>(values: T[], size: number) {
    const groups: T[][] = []
    for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size))
    return groups
}

function stripUndefined<T extends Record<string, any>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}
