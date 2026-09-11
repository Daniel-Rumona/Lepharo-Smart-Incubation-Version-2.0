// Centralized intervention actions for reuse across UI surfaces.
//
// Collections referenced: applications, participants, assignedInterventions,
// interventions, movDocuments, notifications, workflowQueries.
//
// Firestore rules assumed: caller has permission to update relevant docs.

import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    Timestamp,
    updateDoc,
    where,
    writeBatch,
    runTransaction,
    Firestore
} from 'firebase/firestore'
import {
    isAssignmentAccepted,
    loadAssignmentGroup,
    normalizeAssignmentGroupKey
} from './assignmentIdentity'
import { workflowQueryService } from '@/services/workflowQueryService'
import { toAssignedInterventionView } from '@/services/assignedInterventionService'
import { buildParticipantLifecycleTransition } from '@/services/assignmentLifecycleService'
import { findMovForAssignment } from '@/services/movService'

export type AStatus = 'pending' | 'accepted' | 'declined'
export type CComplete = 'pending' | 'completed'
export type UComplete = 'pending' | 'confirmed' | 'rejected'

export interface AssignedIntervention {
    id: string
    interventionId: string
    participantId: string
    assigneeId: string
    participantName: string
    interventionTitle: string
    areaOfSupport: string
    dueDate?: any
    createdAt?: any
    updatedAt?: any
    type?: 'singular' | 'recurring'
    targetType?: 'percentage' | 'metric' | 'custom'
    targetMetric?: string
    targetValue?: number
    timeSpent?: number
    assigneeAcceptanceStatus: AStatus
    participantAcceptanceStatus: AStatus
    groupKey?: string | null
    groupAssignmentId?: string | null
    groupId?: string | null
    assigneeCompletionStatus: CComplete
    participantCompletionStatus: UComplete
    movDocumentId?: string
    programId?: string
    assignmentStatus?: string
}

export interface DenormInterventionEntry {
    assignedInterventionId: string
    interventionId: string
    title: string
    areaOfSupport?: string
    dueDate?: any
    status: 'assigned' | 'completed'
    acceptedAt?: any
    declinedAt?: any
    completedAt?: any
    feedback?: { rating: number; comments: string }
    declineReason?: string
}

type Role = 'projectadmin' | 'consultant' | 'beneficiary'

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

async function getApplicationIdByParticipant(db: Firestore, participantId: string) {
    const apps = await getDocs(
        query(collection(db, 'applications'), where('participantId', '==', participantId))
    )
    if (apps.empty) return null
    // Prefer the accepted application when multiple exist
    const accepted = apps.docs.find(
        d => String((d.data() as any).applicationStatus || '').toLowerCase() === 'accepted'
    )
    return (accepted ?? apps.docs[0]).id
}

async function ensureCompletionMov(
    db: Firestore,
    assignment: AssignedIntervention,
    feedback: { rating?: number; comments?: string } = {},
    opts?: { signerSignatureUrl?: string }
) {
    const participantSnap = await getDoc(doc(db, 'participants', assignment.participantId))
    const participant = participantSnap.exists() ? (participantSnap.data() as any) : {}
    const applicationId = await getApplicationIdByParticipant(db, assignment.participantId)
    const applicationSnap = applicationId
        ? await getDoc(doc(db, 'applications', applicationId))
        : null
    const application = applicationSnap?.exists() ? (applicationSnap.data() as any) : {}
    const confirmedAt = new Date()

    const existingMov = await findMovForAssignment(db, assignment.id)
    if (!existingMov.movDocumentId) {
        throw new Error(
            'The facilitator has not created the MOV yet. Please ask them to complete the intervention submission before confirming.'
        )
    }

    await updateDoc(doc(db, 'movDocuments', existingMov.movDocumentId), {
        smmeAccepted: true,
        smmeAcceptedAt: confirmedAt,
        smmeSignedAt: confirmedAt,
        periodEnd: confirmedAt,
        smmeId: assignment.participantId,
        participantId: assignment.participantId,
        smmeName:
            participant.participantName ||
            participant.name ||
            assignment.participantName ||
            '',
        smmeCompanyName:
            participant.beneficiaryName ||
            application.companyName ||
            application.businessName ||
            '',
        smmeNo: participant.smmeNo || application.smmeNo || '',
        smmeSignatureUrl: opts?.signerSignatureUrl || '',
        smmeDigitalSignature: application.digitalSignature || '',
        smmeFeedback: {
            rating: feedback.rating || 0,
            comments: feedback.comments || ''
        },
        status: 'awaiting_hod',
        approvedByHod: false,
        programId: assignment.programId || application.programId || participant.programId || null,
        updatedAt: confirmedAt
    })

    await updateDoc(doc(db, 'assignedInterventions', assignment.id), {
        movDocumentId: existingMov.movDocumentId,
        updatedAt: confirmedAt
    })

    return {
        movDocumentId: existingMov.movDocumentId,
        applicationId
    }
}

function withoutDup<T extends DenormInterventionEntry>(arr: T[], key: keyof T, val: string) {
    return (arr || []).filter(x => String(x[key]) !== val)
}

function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(obj).filter(([, value]) => value !== undefined)
    ) as Partial<T>
}

function sanitizeDenormEntry(entry: DenormInterventionEntry): DenormInterventionEntry {
    return stripUndefined({
        ...entry,
        areaOfSupport: entry.areaOfSupport ?? null,
        dueDate: entry.dueDate ?? null,
        declineReason: entry.declineReason ?? null,
        feedback: entry.feedback
            ? {
                rating: typeof entry.feedback.rating === 'number' ? entry.feedback.rating : 0,
                comments: entry.feedback.comments || ''
            }
            : undefined
    }) as DenormInterventionEntry
}

async function pushDenormEntry(
    db: Firestore,
    applicationId: string,
    lane: 'assigned' | 'completed',
    entry: DenormInterventionEntry
) {
    const appRef = doc(db, 'applications', applicationId)

    await runTransaction(db, async tx => {
        const snap = await tx.get(appRef)
        if (!snap.exists()) throw new Error('Application not found')

        const data = snap.data() || {}
        const interventions = data.interventions || {}
        const bucket: DenormInterventionEntry[] = Array.isArray(interventions[lane])
            ? interventions[lane]
            : []

        const cleanEntry = sanitizeDenormEntry(entry)

        const next = withoutDup(bucket, 'assignedInterventionId', entry.assignedInterventionId)
        next.push(cleanEntry)

        tx.update(appRef, {
            [`interventions.${lane}`]: next
        })
    })
}

async function createNotification(db: Firestore, payload: any) {
    await addDoc(collection(db, 'notifications'), stripUndefined({
        ...payload,
        createdAt: new Date(),
        readBy: {}
    }))
}

// ─────────────────────────────A────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/** Accept an assigned intervention (incubatee action). */
export async function acceptAssignedIntervention(db: Firestore, assignedInterventionId: string) {
    const ref = doc(db, 'assignedInterventions', assignedInterventionId)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('Intervention not found')

    const a = toAssignedInterventionView(snap.id, snap.data()) as unknown as AssignedIntervention

    // Group progress belongs to the accepted cohort. If this SME accepts after
    // sessions have already started, inherit the latest accepted group snapshot
    // instead of leaving this assignment permanently behind.
    const groupKey = normalizeAssignmentGroupKey(a)
    let groupProgressPatch: Record<string, any> = {}
    if (groupKey) {
        const peers = (await loadAssignmentGroup(db, groupKey))
            .filter(peer => peer.id !== assignedInterventionId && isAssignmentAccepted(peer))
            .sort((left, right) =>
                Number(right?.computedProgress || right?.progress || 0) -
                Number(left?.computedProgress || left?.progress || 0)
            )
        const snapshot = peers[0]
        if (snapshot) {
            const progress = Number(snapshot.computedProgress || snapshot.progress || 0)
            groupProgressPatch = {
                tracking: snapshot.tracking || {},
                computedProgress: progress,
                progressUpdates: snapshot.progressUpdates || [],
                groupProgressSyncedAt: new Date(),
                groupProgressSourceAssignmentId: snapshot.id,
                ...(progress >= 100 ? { needsCompletionSync: true } : {})
            }
        }
    }

    // Update source of truth
    await updateDoc(ref, {
        ...groupProgressPatch,
        ...buildParticipantLifecycleTransition('accept-assignment', a, { now: new Date() })
    })

    // Denormalize to application.assigned
    const applicationId = await getApplicationIdByParticipant(db, a.participantId)
    if (applicationId) {
        await pushDenormEntry(db, applicationId, 'assigned', {
            assignedInterventionId: assignedInterventionId,
            interventionId: a.interventionId,
            title: a.interventionTitle,
            areaOfSupport: a.areaOfSupport,
            dueDate: a.dueDate ?? null,
            status: 'assigned',
            acceptedAt: new Date()
        })
    }

    // Notify
    await createNotification(db, {
        participantId: a.participantId,
        consultantId: a.assigneeId,
        interventionId: assignedInterventionId,
        interventionTitle: a.interventionTitle,
        type: 'intervention-accepted',
        recipientRoles: ['projectadmin', 'consultant', 'beneficiary' as Role],
        message: {
            consultant: `Beneficiary ${a.participantName} accepted: ${a.interventionTitle}.`,
            projectadmin: `Beneficiary ${a.participantName} accepted the intervention.`,
            beneficiary: `You accepted: ${a.interventionTitle}.`
        }
    })
}

/** Decline an assigned intervention (incubatee action). */
export async function declineAssignedIntervention(
    db: Firestore,
    assignedInterventionId: string,
    reason: string
) {
    const ref = doc(db, 'assignedInterventions', assignedInterventionId)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('Intervention not found')

    const a = toAssignedInterventionView(snap.id, snap.data()) as unknown as AssignedIntervention

    await updateDoc(ref, buildParticipantLifecycleTransition('decline-assignment', a, {
        now: new Date(),
        reason
    }))

    // Optional: reflect decline inside application.assigned (keeps history)
    const applicationId = await getApplicationIdByParticipant(db, a.participantId)
    if (applicationId) {
        await pushDenormEntry(db, applicationId, 'assigned', {
            assignedInterventionId,
            interventionId: a.interventionId,
            title: a.interventionTitle,
            areaOfSupport: a.areaOfSupport,
            dueDate: a.dueDate ?? null,
            status: 'assigned',
            declinedAt: new Date(),
            declineReason: reason
        })
    }

    await createNotification(db, {
        participantId: a.participantId,
        consultantId: a.assigneeId,
        interventionId: assignedInterventionId,
        interventionTitle: a.interventionTitle,
        type: 'intervention-declined',
        recipientRoles: ['projectadmin', 'consultant', 'beneficiary' as Role],
        message: {
            consultant: `Beneficiary ${a.participantName} declined: ${a.interventionTitle}.`,
            projectadmin: `Beneficiary ${a.participantName} declined the intervention.`,
            beneficiary: `You declined: ${a.interventionTitle}.`
        },
        reason
    })
}

/** Reject a consultant’s completion claim (incubatee action). */
export async function rejectCompletion(
    db: Firestore,
    assignedInterventionId: string,
    reason: string,
    raisedBy: { deptName?: string; uid?: string }
) {
    const ref = doc(db, 'assignedInterventions', assignedInterventionId)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('Intervention not found')
    const a = toAssignedInterventionView(snap.id, snap.data()) as unknown as AssignedIntervention

    await updateDoc(ref, buildParticipantLifecycleTransition('reject-completion', a, {
        now: new Date(),
        reason
    }))

    await createNotification(db, {
        participantId: a.participantId,
        consultantId: a.assigneeId,
        interventionId: assignedInterventionId,
        interventionTitle: a.interventionTitle,
        type: 'completion-rejected',
        recipientRoles: ['projectadmin', 'consultant', 'beneficiary' as Role],
        message: {
            consultant: `Beneficiary ${a.participantName} rejected completion: ${a.interventionTitle}.`,
            projectadmin: `Completion rejected for: ${a.interventionTitle}.`,
            beneficiary: `You rejected the completion of: ${a.interventionTitle}.`
        },
        reason
    })

    // Log a query for follow-up
    await workflowQueryService.create({
        programId: a.programId || '',
        type: 'completion-rejected',
        message: reason,
        raisedById: raisedBy.uid || a.participantId,
        raisedBy: {
            role: 'beneficiary',
            departmentName: raisedBy.deptName || 'Beneficiary'
        },
        resolverId: a.assigneeId,
        resolver: { role: 'coordinator' },
        target: { type: 'assigned-intervention', id: assignedInterventionId },
        context: {
            participantId: a.participantId,
            interventionId: assignedInterventionId,
            interventionTitle: a.interventionTitle
        }
    })
}

/** Confirm completion (incubatee action) + denorm into application.completed + MOV update. */
export async function confirmCompletion(
    db: Firestore,
    assignedInterventionId: string,
    feedback: { rating?: number; comments?: string } = {},
    opts?: { signerSignatureUrl?: string } // ⬅️ NEW: pass the logged-in user's signature URL
) {
    const ref = doc(db, 'assignedInterventions', assignedInterventionId)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('Intervention not found')
    const a = toAssignedInterventionView(snap.id, snap.data()) as unknown as AssignedIntervention

    // Validate eligibility before creating/signing a MOV. The same lifecycle
    // gate is used by the SME UI, including recorded attendance without RSVP.
    const completionPatch = buildParticipantLifecycleTransition('confirm-completion', a, {
        now: new Date(),
        feedback
    })

    // The assignment must never become completed without a linked MOV. Find or
    // create the MOV first; if that fails, the lifecycle transition is not written.
    const { applicationId } = await ensureCompletionMov(db, a, feedback, opts)

    // Commit completion only after the MOV exists and is linked.
    await updateDoc(ref, completionPatch)

    // Denorm to applications.completed.
    if (applicationId) {
        await pushDenormEntry(db, applicationId, 'completed', {
            assignedInterventionId,
            interventionId: a.interventionId,
            title: a.interventionTitle,
            areaOfSupport: a.areaOfSupport,
            dueDate: a.dueDate ?? null,
            status: 'completed',
            completedAt: new Date(),
            feedback: { rating: feedback.rating || 0, comments: feedback.comments || '' }
        })
    }

    // 5) notify (unchanged)
    await createNotification(db, {
        participantId: a.participantId,
        consultantId: a.assigneeId,
        interventionId: assignedInterventionId,
        interventionTitle: a.interventionTitle,
        type: 'intervention-confirmed',
        recipientRoles: ['consultant', 'projectadmin', 'beneficiary'],
        message: {
            consultant: `Beneficiary ${a.participantName || 'client'} confirmed: ${a.interventionTitle}.`,
            projectadmin: `Intervention "${a.interventionTitle}" has been confirmed by the beneficiary.`,
            beneficiary: `You confirmed the completion of: ${a.interventionTitle}.`
        }
    })
}
