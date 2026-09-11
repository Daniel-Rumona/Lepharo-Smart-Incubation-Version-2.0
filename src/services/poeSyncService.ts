import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit as qlimit,
    query,
    type QueryConstraint,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { extractPoeUrls } from '@/services/poeService'

export type PoeResource = { type?: string; label?: string; link: string }
export type UploadedPoe = { name: string; link: string }
export type PoeSyncResult = { poeUrls: string[]; resources: PoeResource[] }

const dedupeUrls = (values: string[]) =>
    Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)))

const isPoeResource = (resource: any, knownPoeUrls: string[]) => {
    const link = String(resource?.link || '').trim()
    const type = String(resource?.type || '').trim().toLowerCase()
    const label = String(resource?.label || '').trim().toLowerCase()

    return (
        knownPoeUrls.includes(link) ||
        type.includes('poe') ||
        type.includes('evidence') ||
        type.includes('proof') ||
        label.includes('poe') ||
        label.includes('evidence') ||
        label.includes('proof')
    )
}

const dedupeResources = (resources: PoeResource[]) => {
    const byLink = new Map<string, PoeResource>()

    resources.forEach(resource => {
        const link = String(resource?.link || '').trim()
        if (!link) return
        byLink.set(link, { ...resource, link })
    })

    return Array.from(byLink.values())
}

export function collectPoeUrlsFromRecord(record?: any, qiEntry?: any): string[] {
    return [...new Set([
        ...extractPoeUrls(record),
        ...(typeof qiEntry?.lastEvidenceUrl === 'string' ? [qiEntry.lastEvidenceUrl] : [])
    ])]
}

export const mergePoePayload = ({
    record,
    uploaded,
    replaceExisting
}: {
    record: any
    uploaded: UploadedPoe[]
    replaceExisting: boolean
}): PoeSyncResult => {
    const existingPoeUrls = collectPoeUrlsFromRecord(record)
    const uploadedUrls = uploaded.map(file => file.link)
    const existingResources: PoeResource[] = Array.isArray(record?.resources)
        ? record.resources.filter((resource: any) => resource?.link)
        : []

    const keptResources = replaceExisting
        ? existingResources.filter(resource => !isPoeResource(resource, existingPoeUrls))
        : existingResources

    const uploadedResources: PoeResource[] = uploaded.map((file, index) => ({
        type: 'poe',
        label: file.name || `POE ${index + 1}`,
        link: file.link
    }))

    return {
        poeUrls: replaceExisting
            ? dedupeUrls(uploadedUrls)
            : dedupeUrls([...existingPoeUrls, ...uploadedUrls]),
        resources: dedupeResources([...keptResources, ...uploadedResources])
    }
}

export const buildPoePatch = (payload: PoeSyncResult) => {
    return {
        resources: payload.resources,
        updatedAt: serverTimestamp()
    }
}

export async function findAssignedInterventionForMov(mov: any, programId?: string | null) {
    const assignedId = String(mov?.assignedInterventionId || mov?.interventionAssignmentId || '').trim()

    if (assignedId) {
        const directRef = doc(db, 'assignedInterventions', assignedId)
        const directSnap = await getDoc(directRef)
        if (directSnap.exists()) {
            return {
                ref: directRef,
                record: { id: directSnap.id, ...(directSnap.data() as any) }
            }
        }
    }

    const participantId = String(mov?.beneficiaryId || mov?.participantId || mov?.smmeId || '').trim()
    const interventionId = String(mov?.interventionId || '').trim()

    if (!participantId || !interventionId) return null

    const constraints: QueryConstraint[] = [
        where('interventionId', '==', interventionId),
        where('participantId', '==', participantId)
    ]

    if (programId) constraints.push(where('programId', '==', programId))
    constraints.push(qlimit(5))

    const snap = await getDocs(query(collection(db, 'assignedInterventions'), ...constraints))
    if (snap.empty) return null

    const match = snap.docs.find(item => !programId || item.data()?.programId === programId) || snap.docs[0]

    return {
        ref: doc(db, 'assignedInterventions', match.id),
        record: { id: match.id, ...(match.data() as any) }
    }
}

/** Resolves the canonical assigned-intervention record for a MOV. */
export async function findAssignedInterventionRecordForMov({
    mov,
    assignedInterventionId,
    programId
}: {
    mov: any
    assignedInterventionId?: string | null
    programId?: string | null
}) {
    if (assignedInterventionId) {
        const ref = doc(db, 'assignedInterventions', String(assignedInterventionId))
        const snap = await getDoc(ref)
        if (snap.exists()) {
            return { ref, record: { id: snap.id, ...(snap.data() as any) } }
        }
    }
    return findAssignedInterventionForMov(mov, programId)
}

/** Patches the MOV doc plus its linked assignment/delivery records, if found. */
export async function syncUploadedPoesToMov({
    mov,
    programId,
    uploaded,
    replaceExisting
}: {
    mov: any
    programId?: string | null
    uploaded: UploadedPoe[]
    replaceExisting: boolean
}) {
    if (!mov?.id) throw new Error('The query is not linked to a MOV.')
    if (!uploaded.length) return

    const assignment = await findAssignedInterventionForMov(mov, programId)
    const movPayload = mergePoePayload({ record: mov, uploaded, replaceExisting })
    const writes: Promise<any>[] = [
        updateDoc(doc(db, 'movDocuments', String(mov.id)), buildPoePatch(movPayload) as any)
    ]

    if (assignment) {
        const assignmentPayload = mergePoePayload({
            record: assignment.record,
            uploaded,
            replaceExisting
        })
        writes.push(updateDoc(assignment.ref, buildPoePatch(assignmentPayload) as any))
    }

    await Promise.all(writes)
}

/** Resolves the canonical assignedIntervention evidence record. */
export async function resolveInterventionRecords(assignedInterventionId: string) {
    const assignmentRef = doc(db, 'assignedInterventions', assignedInterventionId)
    const assignmentSnap = await getDoc(assignmentRef)
    const assignmentRecord = assignmentSnap.exists()
        ? { id: assignmentSnap.id, ...(assignmentSnap.data() as any) }
        : null

    if (!assignmentRecord) {
        return { assignmentRef: null, assignmentRecord: null, deliveryRef: null, deliveryRecord: null }
    }

    return { assignmentRef, assignmentRecord, deliveryRef: null, deliveryRecord: null }
}

/** Patches the canonical assignedIntervention evidence record. */
export async function syncUploadedPoesToIntervention({
    assignedInterventionId,
    uploaded,
    replaceExisting
}: {
    assignedInterventionId: string
    uploaded: UploadedPoe[]
    replaceExisting: boolean
}) {
    if (!assignedInterventionId) throw new Error('The query is not linked to an intervention.')
    if (!uploaded.length) return

    const { assignmentRef, assignmentRecord } =
        await resolveInterventionRecords(assignedInterventionId)

    if (!assignmentRef || !assignmentRecord) {
        throw new Error('The linked intervention could not be found.')
    }

    const writes: Promise<any>[] = []

    const assignmentPayload = mergePoePayload({ record: assignmentRecord, uploaded, replaceExisting })
    writes.push(updateDoc(assignmentRef, buildPoePatch(assignmentPayload) as any))

    await Promise.all(writes)
}
