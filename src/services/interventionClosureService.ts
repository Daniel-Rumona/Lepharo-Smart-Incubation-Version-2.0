import {
    collection,
    deleteField,
    doc,
    getDocs,
    onSnapshot,
    query,
    Timestamp,
    where,
    writeBatch,
    type Firestore,
    type Unsubscribe
} from 'firebase/firestore'
import {
    canCloseSupport,
    closedAssignmentPatch,
    closureId,
    splitForClosure,
    statusAfterReopen,
    validateClosure,
    type CloseReason
} from './interventionClosureRules'

export const CLOSURES_COLLECTION = 'interventionClosures'

export type ClosureActor = { uid: string; name: string; role: string }

export type SupportClosure = {
    id: string
    participantId: string
    participantName?: string
    interventionId: string
    interventionTitle?: string
    departmentId?: string | null
    programId?: string | null
    reason: CloseReason
    note?: string
    status: 'closed' | 'reopened'
    closedAt?: any
    closedBy?: string
    closedByName?: string
}

const clean = (value: unknown) => String(value ?? '').trim()

/** Key used to look a closure up from an SME and an intervention. */
export const closedKey = (participantId: string, interventionId: string) =>
    `${clean(participantId)}__${clean(interventionId)}`

async function loadAssignments(
    db: Firestore,
    participantId: string,
    interventionId: string,
    programId?: string | null
): Promise<Array<Record<string, any> & { id: string }>> {
    const snapshot = await getDocs(
        query(
            collection(db, 'assignedInterventions'),
            where('participantId', '==', participantId),
            where('interventionId', '==', interventionId)
        )
    )
    const wanted = clean(programId)
    return snapshot.docs
        .map(item => ({ ...(item.data() as Record<string, any>), id: item.id }) as Record<string, any> & { id: string })
        .filter(row => !wanted || !clean(row.programId) || clean(row.programId) === wanted)
}

/**
 * End the support for one SME. Undelivered assignments are cancelled with the
 * closure stamped on them; delivered work is untouched. One batch, so the
 * closure and the cancelled assignments either all land or none do.
 */
export async function closeSupport(input: {
    db: Firestore
    participantId: string
    participantName?: string
    interventionId: string
    interventionTitle?: string
    departmentId?: string | null
    programId?: string | null
    reason: CloseReason
    note?: string
    user: ClosureActor
}): Promise<{ cancelled: number; kept: number }> {
    const { db, user } = input
    if (!canCloseSupport(user.role)) throw new Error('Only an HOD can close support.')
    const problem = validateClosure({ reason: input.reason, note: input.note })
    if (problem) throw new Error(problem)

    const id = closureId(input)
    const rows = await loadAssignments(db, input.participantId, input.interventionId, input.programId)
    const { toClose, keep } = splitForClosure(rows)
    const now = Timestamp.now()

    const batch = writeBatch(db)
    batch.set(doc(db, CLOSURES_COLLECTION, id), {
        participantId: input.participantId,
        participantName: clean(input.participantName),
        interventionId: input.interventionId,
        interventionTitle: clean(input.interventionTitle),
        departmentId: input.departmentId || null,
        programId: input.programId || null,
        reason: input.reason,
        note: clean(input.note),
        status: 'closed',
        closedAt: now,
        closedBy: user.uid,
        closedByName: user.name
    })
    for (const row of toClose) {
        batch.update(
            doc(db, 'assignedInterventions', row.id),
            closedAssignmentPatch({
                previousStatus: row.assignmentStatus,
                closureId: id,
                reason: input.reason,
                note: input.note,
                byUid: user.uid,
                byName: user.name,
                at: now
            })
        )
    }
    await batch.commit()
    return { cancelled: toClose.length, kept: keep.length }
}

/** Undo a closure: the cancelled assignments return to the status they had, and history stays. */
export async function reopenSupport(input: { db: Firestore; closure: SupportClosure; user: ClosureActor }) {
    const { db, closure, user } = input
    if (!canCloseSupport(user.role)) throw new Error('Only an HOD can reopen support.')

    const rows = await loadAssignments(db, closure.participantId, closure.interventionId, closure.programId)
    const closedByThis = rows.filter(row => clean(row.supportClosureId) === closure.id)
    const now = Timestamp.now()

    const batch = writeBatch(db)
    batch.update(doc(db, CLOSURES_COLLECTION, closure.id), {
        status: 'reopened',
        reopenedAt: now,
        reopenedBy: user.uid,
        reopenedByName: user.name
    })
    for (const row of closedByThis) {
        batch.update(doc(db, 'assignedInterventions', row.id), {
            assignmentStatus: statusAfterReopen(row),
            assignmentStatusBeforeClosure: deleteField(),
            supportClosedAt: deleteField(),
            supportClosureId: deleteField(),
            supportClosedReason: deleteField(),
            supportClosedNote: deleteField(),
            supportClosedBy: deleteField(),
            supportClosedByName: deleteField(),
            updatedAt: now
        })
    }
    await batch.commit()
    return { restored: closedByThis.length }
}

/** Live map of currently-closed support, keyed by SME + intervention. */
export function subscribeClosures(
    db: Firestore,
    scope: { participantId?: string; programId?: string | null },
    onChange: (closed: Map<string, SupportClosure>) => void
): Unsubscribe {
    const base = collection(db, CLOSURES_COLLECTION)
    const q = scope.participantId
        ? query(base, where('participantId', '==', scope.participantId))
        : scope.programId
            ? query(base, where('programId', '==', scope.programId))
            : query(base)
    return onSnapshot(
        q,
        snapshot => {
            const closed = new Map<string, SupportClosure>()
            snapshot.docs.forEach(item => {
                const data = { id: item.id, ...(item.data() as Record<string, any>) } as SupportClosure
                if (data.status === 'closed') closed.set(closedKey(data.participantId, data.interventionId), data)
            })
            onChange(closed)
        },
        error => {
            console.error('Could not load closed support', error)
            onChange(new Map())
        }
    )
}
