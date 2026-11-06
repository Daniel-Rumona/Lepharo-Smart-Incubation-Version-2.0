import dayjs from 'dayjs'
import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/firebase'
import type { Appointment, AppointmentSession } from '@/types/appointment'

export type ScheduleSessionInput = {
  session: Omit<AppointmentSession, 'createdAt' | 'updatedAt'>
  invitations: Array<Omit<Appointment, 'appointmentSessionId' | 'createdAt' | 'updatedAt'>>
}

export class AppointmentSessionAlreadyExistsError extends Error {}

const safeKey = (value: string) => encodeURIComponent(value).replace(/%/g, '_')

/**
 * One invitation per SME per session, or, for a Training Academy SME that
 * sends several people, one per person (attendeeId). Older invitations keep
 * their SME-only id.
 */
export const invitationDocId = (sessionId: string, smeId: string, attendeeId?: string | null) =>
  `appointment_${safeKey(attendeeId ? `${sessionId}__${smeId}__${attendeeId}` : `${sessionId}__${smeId}`)}`

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
    ref: doc(db, 'appointments', invitationDocId(sessionId, invitation.smeId, invitation.attendeeId))
  }))

  const isCancelled = (data: any) => String(data?.status || '').trim().toLowerCase() === 'cancelled'

  await runTransaction(db, async transaction => {
    // A cancelled session at the same slot can be booked again: it's replaced.
    const existing = await transaction.get(sessionRef)
    if (existing.exists() && !isCancelled(existing.data())) {
      throw new AppointmentSessionAlreadyExistsError('This appointment session already exists.')
    }
    const invitationSnapshots = await Promise.all(invitationRefs.map(item => transaction.get(item.ref)))
    if (invitationSnapshots.some(snapshot => snapshot.exists() && !isCancelled(snapshot.data()))) {
      throw new AppointmentSessionAlreadyExistsError('One or more SME invitations already exist for this session.')
    }
    // Seeded / test assignments are marked synthetic; their sessions and
    // invitations carry the mark too, so nothing about them reaches a real person.
    const assignmentIds = Array.from(new Set(invitations.map(item => String(item.assignedInterventionId || '').trim()).filter(Boolean)))
    const assignments = await Promise.all(assignmentIds.map(id => transaction.get(doc(db, 'assignedInterventions', id))))
    const markOf = new Map(assignments.map(snapshot => {
      const data = (snapshot.data() || {}) as any
      const synthetic = data.dataOrigin === 'synthetic' || data.suppressNotifications === true
      return [snapshot.id, synthetic ? { dataOrigin: data.dataOrigin || 'synthetic', suppressNotifications: true } : null]
    }))
    // Training invitations have no assignment: they carry their own mark from
    // the SME's enrollment or person record.
    const ownMark = (invitation: ScheduleSessionInput['invitations'][number]) =>
      invitation.dataOrigin === 'synthetic' || invitation.suppressNotifications === true
        ? { dataOrigin: 'synthetic' as const, suppressNotifications: true }
        : null
    const markFor = (invitation: ScheduleSessionInput['invitations'][number]) =>
      markOf.get(String(invitation.assignedInterventionId || '').trim()) || ownMark(invitation)
    const sessionMark = invitations.map(markFor).find(Boolean) || null

    transaction.set(sessionRef, {
      ...session,
      ...(sessionMark || {}),
      attendanceSummary: { ...session.attendanceSummary, invitedCount: invitations.length },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
    invitationRefs.forEach(({ invitation, ref }) => transaction.set(ref, {
      ...invitation,
      ...(markFor(invitation) || {}),
      appointmentSessionId: sessionId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }))
  })
  return { sessionId }
}

/* ------------------------------------------------------------------ */
/* Overlap checking — shared by every screen that books or moves a      */
/* session, so they all enforce the same rule.                          */
/* ------------------------------------------------------------------ */

export type ScheduleClash = { title: string; start: Date; end: Date }

const clashDate = (value: any): Date | null => {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * The assignee's other session that overlaps [startsAt, endsAt), if any.
 * Cancelled sessions are ignored (and so are legacy 'postponed' ones: a
 * postpone now just moves a session to its new time and keeps it
 * 'scheduled'). Pass `excludeSessionId` when moving an existing session so it
 * doesn't clash with itself. Throws if the lookup fails.
 */
export async function findOverlappingSession(params: {
  assigneeId: string
  startsAt: Date
  endsAt: Date
  excludeSessionId?: string
}): Promise<ScheduleClash | null> {
  const assigneeId = String(params.assigneeId || '').trim()
  if (!assigneeId) return null

  const snapshot = await getDocs(query(
    collection(db, 'appointmentSessions'),
    where('assigneeId', '==', assigneeId)
  ))
  const start = params.startsAt.getTime()
  const end = params.endsAt.getTime()
  const exclude = String(params.excludeSessionId || '').trim()

  for (const item of snapshot.docs) {
    if (exclude && item.id === exclude) continue
    const data = item.data() as any
    if (['cancelled', 'postponed'].includes(String(data.status || '').trim().toLowerCase())) continue
    const existingStart = clashDate(data.startAt)
    const existingEnd = clashDate(data.endAt)
    if (!existingStart || !existingEnd) continue
    if (existingStart.getTime() < end && existingEnd.getTime() > start) {
      return { title: String(data.title || '').trim() || 'another session', start: existingStart, end: existingEnd }
    }
  }
  return null
}

/**
 * A user-facing message when the slot is taken, or null when it is free.
 * If the schedule can't be read this fails closed (returns a "try again"
 * message) rather than silently skipping the check.
 */
export async function checkScheduleClash(params: {
  assigneeId: string
  startsAt: Date
  endsAt: Date
  excludeSessionId?: string
}): Promise<string | null> {
  try {
    const clash = await findOverlappingSession(params)
    if (!clash) return null
    return `That overlaps "${clash.title}" (${dayjs(clash.start).format('HH:mm')}–${dayjs(clash.end).format('HH:mm')}). Pick a different time.`
  } catch (error) {
    console.error('Could not check for scheduling clashes', error)
    return 'Could not check for scheduling clashes right now. Please try again.'
  }
}
