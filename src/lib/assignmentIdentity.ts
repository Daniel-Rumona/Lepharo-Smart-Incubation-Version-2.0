import {
    collection,
    Firestore,
    getDocs,
    query,
    where
} from 'firebase/firestore'

/** Canonical grouping field for all new and current assignment workflows. */
export const canonicalAssignmentGroupKey = (record: any): string =>
    String(record?.groupKey || '').trim()

export const normalizeAssignmentGroupKey = (record: any): string =>
    canonicalAssignmentGroupKey(record)

export const isAssignmentAccepted = (record: any): boolean =>
    String(record?.participantAcceptanceStatus || '').trim().toLowerCase() === 'accepted'

export const isAssignmentActive = (record: any): boolean =>
    !['cancelled', 'declined'].includes(
        String(record?.assignmentStatus || '').trim().toLowerCase()
    ) &&
    String(record?.participantAcceptanceStatus || '').trim().toLowerCase() !== 'declined'

/** Read a canonical group and return unique active rows. */
export async function loadAssignmentGroup(db: Firestore, groupKey: string) {
    const normalizedKey = String(groupKey || '').trim()
    if (!normalizedKey) return []

    const rows = new Map<string, any>()
    const snap = await getDocs(
        query(collection(db, 'assignedInterventions'), where('groupKey', '==', normalizedKey))
    )
    snap.forEach(item => rows.set(item.id, { id: item.id, ...item.data() }))

    return [...rows.values()].filter(isAssignmentActive)
}
