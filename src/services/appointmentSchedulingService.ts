import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '@/firebase'
import type { Appointment, AppointmentSession } from '@/types/appointment'

export type ScheduleSessionInput = {
  session: Omit<AppointmentSession, 'createdAt' | 'updatedAt'>
  invitations: Array<Omit<Appointment, 'appointmentSessionId' | 'createdAt' | 'updatedAt'>>
}

export class AppointmentSessionAlreadyExistsError extends Error {}

const safeKey = (value: string) => encodeURIComponent(value).replace(/%/g, '_')

/**
 * The single creation boundary for all appointment screens. A stable session
 * ID and stable invitation IDs make a retried request idempotent; the
 * transaction makes an incomplete group write impossible.
 */
export async function scheduleAppointmentSession(input: ScheduleSessionInput) {
  const { session, invitations } = input
  if (!invitations.length) throw new Error('At least one SME must be invited.')
  const start = session.startAt.toMillis()
  const scope = session.sessionType === 'group'
    ? String(session.groupKey || '').trim()
    : String(invitations[0].assignedInterventionId || '').trim()
  if (!scope) throw new Error('A group or assigned intervention is required.')

  const sessionId = `session_${safeKey([session.programId, session.departmentId, session.interventionId, scope, start, session.assigneeId].join('__'))}`
  const sessionRef = doc(db, 'appointmentSessions', sessionId)
  const invitationRefs = invitations.map(invitation => ({
    invitation,
    ref: doc(db, 'appointments', `appointment_${safeKey(`${sessionId}__${invitation.smeId}`)}`)
  }))

  await runTransaction(db, async transaction => {
    const existing = await transaction.get(sessionRef)
    if (existing.exists()) throw new AppointmentSessionAlreadyExistsError('This appointment session already exists.')
    const invitationSnapshots = await Promise.all(invitationRefs.map(item => transaction.get(item.ref)))
    if (invitationSnapshots.some(snapshot => snapshot.exists())) {
      throw new AppointmentSessionAlreadyExistsError('One or more SME invitations already exist for this session.')
    }
    transaction.set(sessionRef, {
      ...session,
      attendanceSummary: { ...session.attendanceSummary, invitedCount: invitations.length },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
    invitationRefs.forEach(({ invitation, ref }) => transaction.set(ref, {
      ...invitation,
      appointmentSessionId: sessionId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }))
  })
  return { sessionId }
}
