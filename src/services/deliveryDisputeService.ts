import { Timestamp, arrayUnion, collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { groupDeliveryRef } from '@/services/groupInterventionDeliveryService'
import { db } from '@/firebase'
import { findMovForAssignment } from '@/services/movService'
import { workflowQueryService, type WorkflowQueryActorInput } from '@/services/workflowQueryService'

/**
 * SME delivery disputes. When an SME rejects a facilitator's completion:
 *
 *   SME rejects (with a reason category)  -> dispute query to the facilitator; HOD informed
 *   Facilitator responds with one of:
 *     corrected              -> SME asked to confirm again (details / evidence fixed)
 *     redeliver              -> back to delivery; completing again re-asks the SME
 *     delivered-as-recorded  -> escalated to the department's HOD
 *   HOD decides an escalation:
 *     sme          -> back to the facilitator to redo or correct
 *     facilitator  -> delivery counts as confirmed "by HOD decision" (reason on the MOV)
 *   SME confirms after a correction or re-delivery -> the dispute closes itself.
 *
 * The dispute is a workflowQueries record of type 'completion-rejected' whose
 * target is the assignedIntervention.
 */

export type DisputeCategory = 'not-delivered' | 'partly-delivered' | 'details-wrong' | 'other'

export const DISPUTE_CATEGORIES: { value: DisputeCategory; label: string; detail: string }[] = [
    { value: 'not-delivered', label: 'It wasn’t delivered', detail: 'The session or support didn’t happen' },
    { value: 'partly-delivered', label: 'Only partly delivered', detail: 'Some sessions or parts are missing' },
    { value: 'details-wrong', label: 'Details are wrong', detail: 'Dates, sessions or what was covered' },
    { value: 'other', label: 'Something else', detail: 'Any other problem with this completion' }
]

export const disputeCategoryLabel = (value?: string | null) =>
    DISPUTE_CATEGORIES.find(c => c.value === value)?.label || null

export type DisputeOutcome = 'corrected' | 'redeliver' | 'delivered-as-recorded'

export const DISPUTE_OUTCOMES: { value: DisputeOutcome; label: string; detail: string }[] = [
    { value: 'corrected', label: 'Correct and resend', detail: 'Fix the details or evidence; the SME is asked to confirm again' },
    { value: 'redeliver', label: 'Deliver what’s missing', detail: 'Back to delivery; complete it again when done' },
    { value: 'delivered-as-recorded', label: 'It was delivered as recorded', detail: 'Explain and attach proof; the HOD decides' }
]

export const disputeOutcomeLabel = (value?: string | null) =>
    DISPUTE_OUTCOMES.find(o => o.value === value)?.label || null

/**
 * Who a redelivery is for, on a grouped intervention (one delivery to many SMEs):
 *   member  just the SME who disputed: a catch-up of their own; the group stays delivered
 *   group   the whole group: shared progress goes back to before completion;
 *           SMEs who already confirmed keep their confirmation and MOV
 */
export type RedeliveryScope = 'member' | 'group'

/** The progress a delivery had before it was completed: the last update under 100%. */
export const progressBeforeCompletion = (updates: any[] = []) => {
    const toMillis = (v: any) => (v?.toMillis ? v.toMillis() : typeof v?.seconds === 'number' ? v.seconds * 1000 : v ? new Date(v).getTime() : 0)
    const before = updates
        .filter(u => Number.isFinite(Number(u?.computedProgress)) && Number(u.computedProgress) < 100)
        .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt))
    return before.length ? Math.max(0, Number(before[before.length - 1].computedProgress)) : 0
}

/** An SME catching up on a grouped intervention they disputed (see RedeliveryScope). */
export const isCatchingUp = (assignment: any) =>
    assignment?.catchUp?.status === 'active' && String(assignment?.assigneeCompletionStatus || '').toLowerCase() !== 'completed'

export const isDisputeQuery = (q: any) => ['completion-rejected', 'completion-rejection'].includes(String(q?.queryType || q?.type || ''))

type Actor = { id: string } & WorkflowQueryActorInput

const snapshotOf = (actor: Actor) => ({
    name: actor.name || null,
    email: actor.email || null,
    role: actor.role || null,
    departmentName: actor.departmentName || null
})

/** The facilitator's response to a dispute. Evidence files are already uploaded and synced by the caller. */
export async function respondToDispute(input: {
    query: any
    outcome: DisputeOutcome
    message: string
    attachmentUrls: string[]
    /** Evidence already on the MOV / intervention that the facilitator says shows it was delivered. */
    existingEvidenceUrls?: string[]
    /** Grouped interventions, when redelivering: just this SME (default) or the whole group. */
    scope?: RedeliveryScope
    actor: Actor
}) {
    const assignmentId = String(input.query?.target?.id || input.query?.interventionId || '').trim()
    if (!assignmentId) throw new Error('The disputed intervention could not be found.')
    const existing = (input.existingEvidenceUrls || []).filter(Boolean)
    // Standing by the record goes to the HOD only with proof: new files, or what's already on file.
    if (input.outcome === 'delivered-as-recorded' && !input.attachmentUrls.length && !existing.length) {
        throw new Error('proof-required')
    }
    const now = new Date()

    await workflowQueryService.answer(input.query.id, {
        message: input.message,
        attachmentUrls: input.attachmentUrls,
        outcome: input.outcome,
        actorId: input.actor.id,
        actor: input.actor
    })

    const batch = writeBatch(db)
    const assignment = doc(db, 'assignedInterventions', assignmentId)
    if (input.outcome === 'corrected') {
        // Delivered, details now right: the SME is asked to confirm again.
        batch.update(assignment, {
            participantCompletionStatus: 'pending',
            assignmentStatus: 'in-progress',
            deliveryDispute: { status: 'corrected', queryId: input.query.id, at: now },
            updatedAt: now
        })
    } else if (input.outcome === 'redeliver') {
        const reopen = {
            assigneeCompletionStatus: 'pending',
            participantCompletionStatus: 'pending',
            assignmentStatus: 'in-progress',
            deliveryDispute: { status: 'redelivering', queryId: input.query.id, at: now, scope: input.scope || 'member' },
            updatedAt: now
        }
        const record = (await getDoc(assignment)).data() as any
        const groupKey = String(record?.groupKey || record?.groupId || record?.groupAssignmentId || '').trim()
        const group = groupKey ? ((await getDoc(groupDeliveryRef(db, groupKey))).data() as any) : null
        const fromProgress = progressBeforeCompletion(group?.progressUpdates || record?.progressUpdates || [])

        if (groupKey && input.scope === 'group') {
            // The whole group: shared progress back to before completion. Every SME
            // who hasn't confirmed is back in delivery; confirmed SMEs keep theirs.
            const members = await getDocs(query(collection(db, 'assignedInterventions'), where('groupKey', '==', groupKey)))
            members.docs.forEach(member => {
                const data = member.data() as any
                if (String(data.participantCompletionStatus || '').toLowerCase() === 'confirmed') return
                batch.update(member.ref, member.id === assignmentId ? reopen : { ...reopen, deliveryDispute: { ...reopen.deliveryDispute, viaGroup: true } })
            })
            batch.set(groupDeliveryRef(db, groupKey), {
                progress: fromProgress,
                deliveryStatus: 'in_progress',
                progressUpdates: arrayUnion({
                    type: 'reopened',
                    note: `Back in delivery after a dispute: ${input.message}`,
                    by: input.actor.id,
                    computedProgress: fromProgress,
                    createdAt: Timestamp.now()
                }),
                updatedAt: serverTimestamp()
            }, { merge: true })
        } else {
            // One SME (a single intervention, or a catch-up within a group). The group's
            // shared delivery is untouched; this SME's own progress starts from before completion.
            batch.update(assignment, {
                ...reopen,
                ...(groupKey ? { catchUp: { status: 'active', startedAt: now, fromProgress, queryId: input.query.id } } : {})
            })
        }
    } else {
        // The facilitator stands by the record: the HOD decides.
        batch.update(doc(db, 'workflowQueries', input.query.id), {
            escalation: { to: 'hod', at: Timestamp.now(), byId: input.actor.id, by: snapshotOf(input.actor), decision: null, existingEvidenceUrls: existing },
            thread: arrayUnion({ kind: 'escalated', message: 'Sent to the HOD to decide.', byId: input.actor.id, by: snapshotOf(input.actor), at: Timestamp.now() }),
            updatedAt: serverTimestamp()
        })
        batch.update(assignment, {
            deliveryDispute: { status: 'escalated', queryId: input.query.id, at: now },
            updatedAt: now
        })
    }
    await batch.commit()
}

/** The HOD's decision on an escalated dispute. */
export async function decideDispute(input: {
    query: any
    decision: 'sme' | 'facilitator'
    notes: string
    actor: Actor
}) {
    const notes = String(input.notes || '').trim()
    if (!notes) throw new Error('A reason for the decision is required.')
    const assignmentId = String(input.query?.target?.id || input.query?.interventionId || '').trim()
    if (!assignmentId) throw new Error('The disputed intervention could not be found.')
    const now = new Date()
    const by = snapshotOf(input.actor)
    const decided = { ...(input.query.escalation || { to: 'hod' }), decision: input.decision, decisionNotes: notes, decidedAt: Timestamp.now(), decidedBy: by }

    const batch = writeBatch(db)
    const queryRef = doc(db, 'workflowQueries', input.query.id)
    const assignment = doc(db, 'assignedInterventions', assignmentId)

    if (input.decision === 'sme') {
        // The SME is right: back to the facilitator to redo or correct it.
        batch.update(queryRef, {
            status: 'open',
            escalation: decided,
            lastSentBack: { notes: `HOD decision: ${notes}`, at: Timestamp.now(), by },
            thread: arrayUnion({ kind: 'decided', message: `Sided with the SME: ${notes}`, outcome: 'sme', byId: input.actor.id, by, at: Timestamp.now() }),
            updatedAt: serverTimestamp()
        })
        batch.update(assignment, {
            assigneeCompletionStatus: 'pending',
            participantCompletionStatus: 'pending',
            assignmentStatus: 'in-progress',
            deliveryDispute: { status: 'sme-upheld', queryId: input.query.id, notes, at: now },
            updatedAt: now
        })
    } else {
        // The facilitator is right: delivery counts as confirmed by the HOD's decision.
        const { movDocumentId } = await findMovForAssignment(db, assignmentId)
        if (!movDocumentId) throw new Error('The MOV for this intervention could not be found.')
        const override = { byUid: input.actor.id, byName: input.actor.name || null, at: now, reason: notes }
        batch.update(doc(db, 'movDocuments', movDocumentId), {
            confirmationOverride: override,
            periodEnd: now,
            status: 'awaiting_hod',
            approvedByHod: false,
            updatedAt: now
        })
        batch.update(assignment, {
            participantCompletionStatus: 'confirmed',
            participantConfirmedAt: now,
            participantConfirmedByDecision: true,
            completedAt: now,
            assignmentStatus: 'completed',
            deliveryDispute: { status: 'facilitator-upheld', queryId: input.query.id, notes, at: now },
            updatedAt: now
        })
        batch.update(queryRef, {
            status: 'resolved',
            escalation: decided,
            resolution: { notes: `HOD decision: ${notes}`, attachmentUrl: null, resolvedById: input.actor.id, resolvedBy: by, resolvedAt: serverTimestamp() },
            thread: arrayUnion({ kind: 'decided', message: `Sided with the facilitator: ${notes}`, outcome: 'facilitator', byId: input.actor.id, by, at: Timestamp.now() }),
            updatedAt: serverTimestamp()
        })
    }
    await batch.commit()
}

/** Open (not yet resolved) dispute on an assignment, if any. */
export async function openDisputeFor(assignmentId: string) {
    const rows = await workflowQueryService.list({ targetType: 'assigned-intervention', targetId: assignmentId })
    return rows.find(q => isDisputeQuery(q) && String(q.status) !== 'resolved') || null
}

/** When the SME confirms after a correction or re-delivery, their dispute closes itself. */
export async function closeDisputeOnConfirmation(assignmentId: string, actor: Actor) {
    const open = await openDisputeFor(assignmentId)
    if (!open) return
    await workflowQueryService.accept(open.id, { notes: 'The SME confirmed the delivery.', actorId: actor.id, actor })
    const snap = await getDoc(doc(db, 'assignedInterventions', assignmentId))
    if (snap.exists()) {
        const batch = writeBatch(db)
        batch.update(snap.ref, { deliveryDispute: { status: 'closed', queryId: open.id, at: new Date() }, updatedAt: new Date() })
        await batch.commit()
    }
}
