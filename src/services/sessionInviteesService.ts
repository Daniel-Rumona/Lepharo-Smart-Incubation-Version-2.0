import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '@/firebase'
import { invitationDocId } from '@/services/appointmentSchedulingService'
import type { Appointment, AppointmentSession } from '@/types/appointment'

export type InvitationDraft = Omit<Appointment, 'appointmentSessionId' | 'createdAt' | 'updatedAt'>

export type InviteeChange = {
    sessionId: string
    /** New invitations (an SME, or one of a training SME's people). */
    add: InvitationDraft[]
    /** Invitation ids to withdraw. */
    withdraw: string[]
    /** Other session fields that change with the guest list, e.g. a training session's category. */
    sessionPatch?: Partial<Pick<AppointmentSession, 'category'>>
}

export type InviteeChangeResult = { added: number; withdrawn: number; keptCheckedIn: number }

const isCheckedIn = (data: any) =>
    !!data?.attendance?.checkedInAt || ['attended', 'checked-in', 'checked-out'].includes(String(data?.attendance?.status || ''))

/**
 * Changes who is invited to a booked session in one transaction. Withdrawn
 * invitations are kept as cancelled (so the history stays and the SME gets
 * the usual cancellation email); someone who has already checked in is
 * never withdrawn. New invitations reuse the deterministic invitation id, so
 * re-inviting someone revives their earlier invitation instead of
 * duplicating it, and they take the session's programme, department and
 * facilitator so the rules' session match holds.
 */
export async function changeSessionInvitees({ sessionId, add, withdraw, sessionPatch }: InviteeChange): Promise<InviteeChangeResult> {
    const sessionRef = doc(db, 'appointmentSessions', sessionId)
    return runTransaction(db, async tx => {
        const snap = await tx.get(sessionRef)
        if (!snap.exists()) throw new Error('This session no longer exists.')
        const session = snap.data() as AppointmentSession
        if (session.coverage?.held !== null && session.coverage?.held !== undefined) {
            throw new Error('Coverage has been recorded for this session, so its guest list can no longer change.')
        }
        if (['completed', 'cancelled', 'postponed'].includes(String(session.status))) {
            throw new Error('This session is closed, so its guest list can no longer change.')
        }

        const withdrawRefs = withdraw.map(id => doc(db, 'appointments', id))
        const addRefs = add.map(draft => doc(db, 'appointments', invitationDocId(sessionId, draft.smeId, draft.attendeeId)))
        // Every read before any write, as transactions require.
        const [withdrawSnaps, addSnaps] = await Promise.all([
            Promise.all(withdrawRefs.map(ref => tx.get(ref))),
            Promise.all(addRefs.map(ref => tx.get(ref)))
        ])

        let withdrawn = 0
        let keptCheckedIn = 0
        withdrawSnaps.forEach((item, i) => {
            const data = item.data()
            if (!item.exists() || data?.appointmentSessionId !== sessionId || data?.status === 'cancelled') return
            if (isCheckedIn(data)) {
                keptCheckedIn += 1
                return
            }
            tx.update(withdrawRefs[i], { status: 'cancelled', updatedAt: serverTimestamp() })
            withdrawn += 1
        })

        let added = 0
        addSnaps.forEach((item, i) => {
            if (item.exists() && item.data()?.status !== 'cancelled') return
            tx.set(addRefs[i], {
                ...add[i],
                // A seeded session's late invitations stay seeded (no real emails).
                ...(session.dataOrigin === 'synthetic' ? { dataOrigin: 'synthetic', suppressNotifications: true } : {}),
                // The rules require an invitation to match the session it points at.
                programId: session.programId,
                departmentId: session.departmentId,
                assigneeId: session.assigneeId,
                assigneeName: session.assigneeName,
                assigneeEmail: session.assigneeEmail ?? null,
                assigneeRole: session.assigneeRole,
                appointmentSessionId: sessionId,
                status: 'scheduled',
                smeConfirmation: 'pending',
                smeDeclineReason: null,
                attendance: { status: 'expected', checkedInAt: null, checkedOutAt: null },
                completedAt: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            })
            added += 1
        })

        if (added || withdrawn || sessionPatch) {
            tx.update(sessionRef, {
                ...(sessionPatch || {}),
                attendanceSummary: {
                    ...session.attendanceSummary,
                    invitedCount: Math.max((session.attendanceSummary?.invitedCount || 0) + added - withdrawn, 0)
                },
                updatedAt: serverTimestamp()
            })
        }
        return { added, withdrawn, keptCheckedIn }
    })
}
