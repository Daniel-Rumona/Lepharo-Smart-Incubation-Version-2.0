import {
  collection,
  doc,
  documentId,
  getDocs,
  query,
  where,
  type Timestamp
} from 'firebase/firestore'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import type { Appointment, AppointmentSession } from '@/types/appointment'

type AppointmentView = Record<string, any>

const chunks = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  )

/**
 * Converts only the v5 canonical appointment + session pair into the shape
 * currently consumed by appointment screens. This is a projection, not a
 * legacy-field fallback: old fields are never read.
 */
export const toAppointmentView = (
  id: string,
  appointment: Appointment,
  session: AppointmentSession
): AppointmentView => {
  // A v5 session always has a coverage container. It is not, however, a
  // coverage record until Operations has recorded whether the session was
  // held. Existing appointment screens use `latest` to mean "recorded".
  const latestCoverage = session.coverage.held === null
    ? null
    : {
        held: session.coverage.held,
        coveredPoints: session.coverage.coveredPoints,
        photos: session.coverage.photos || [],
        notes: session.coverage.outcomeSummary,
        reasonNotHeld: session.coverage.reasonNotHeld,
        createdAt: session.coverage.recordedAt,
        smeAttendance: (session.coverage as any).smeAttendance,
        attendanceByParticipant: (session.coverage as any).attendanceByParticipant,
        completionRequired: (session.coverage as any).completionRequired,
        completionAssignmentIds: (session.coverage as any).completionAssignmentIds,
        completionGroupKey: (session.coverage as any).completionGroupKey
      }

  return {
  id,
  appointmentSessionId: appointment.appointmentSessionId,
  schemaVersion: appointment.schemaVersion,
  programId: appointment.programId,
  departmentId: appointment.departmentId,
  assignedInterventionId: appointment.assignedInterventionId,
  participantId: appointment.smeId,
  participantName: appointment.smeName,
  participantEmail: appointment.smeEmail || '',
  interventionId: appointment.interventionId,
  interventionTitle: appointment.interventionTitle,
  subInterventionId: appointment.subInterventionId,
  subInterventionTitle: appointment.subInterventionTitle,
  cycleKey: appointment.cycleKey,
  assigneeId: appointment.assigneeId,
  assigneeName: appointment.assigneeName,
  assigneeEmail: appointment.assigneeEmail || '',
  assigneeRole: appointment.assigneeRole,
  groupKey: appointment.groupKey,
  isGroupAppointment: session.sessionType === 'group',
  status: appointment.status,
  userConfirmation: appointment.smeConfirmation,
  declineReason: appointment.smeDeclineReason || '',
  smeRescheduleRequest: appointment.smeRescheduleRequest || null,
  attendance: appointment.attendance,
  foodSelections: appointment.foodSelections,
  // The appointment screen uses a local calendar date. `toISOString()` converts
  // through UTC and can move early-morning appointments onto the prior day.
  date: dayjs(session.startAt.toDate()).format('YYYY-MM-DD'),
  startTime: session.startAt,
  endTime: session.endAt,
  deliveryMethod: session.deliveryMethod,
  location: session.location || '',
  meetingLink: session.meetingLink || '',
  sessionTitle: session.title,
  plannedTopics: session.plannedTopics || [],
  plannedCoverage: session.plannedCoverage,
  sessionCoverage: {
    title: session.title,
    plannedTopics: session.plannedTopics || [],
    plannedCoverage: session.plannedCoverage,
    latest: latestCoverage
  },
  attendanceSession: session.attendanceSession,
  attendanceSummary: {
    count: session.attendanceSummary.checkedInCount,
    checkedOutCount: session.attendanceSummary.checkedOutCount,
    currentlyPresentCount: Math.max(
      session.attendanceSummary.checkedInCount - session.attendanceSummary.checkedOutCount,
      0
    )
  },
  foodMenuEnabled: session.foodMenu.length > 0,
  foodMenu: session.foodMenu,
  scheduleHistory: session.scheduleHistory || [],
  createdAt: appointment.createdAt,
  updatedAt: appointment.updatedAt,
  completedAt: appointment.completedAt
  }
}

export async function hydrateAppointmentViews(
  appointments: Array<{ id: string; data: Appointment }>
): Promise<AppointmentView[]> {
  // Callers can be fed a broad appointments snapshot while the v5 rollout is
  // still retaining historic invitation documents. Only canonical invitations
  // have a linked delivery session; never let an older document make an
  // invalid documentId() query and hide the valid calendar entries.
  const canonicalAppointments = appointments.filter(item =>
    item.data?.schemaVersion === 5 &&
    typeof item.data?.appointmentSessionId === 'string' &&
    item.data.appointmentSessionId.trim().length > 0
  )
  const sessionIds = Array.from(new Set(
    canonicalAppointments.map(item => item.data.appointmentSessionId.trim())
  ))
  if (!sessionIds.length) return []

  const sessions = new Map<string, AppointmentSession>()
  for (const group of chunks(sessionIds, 30)) {
    const snapshot = await getDocs(query(
      collection(db, 'appointmentSessions'),
      where(documentId(), 'in', group)
    ))
    snapshot.docs.forEach(item => sessions.set(item.id, item.data() as AppointmentSession))
  }

  const views = canonicalAppointments.flatMap(item => {
    const session = sessions.get(item.data.appointmentSessionId.trim())
    return session ? [toAppointmentView(item.id, item.data, session)] : []
  })
  const bySessionId = new Map<string, AppointmentView[]>()
  views.forEach(view => {
    const key = String(view.appointmentSessionId)
    bySessionId.set(key, [...(bySessionId.get(key) || []), view])
  })
  bySessionId.forEach(members => {
    const checkedInEmails = members
      // An attended outcome from coverage is not a timed check-in.
      .filter(member => member.attendance?.checkedInAt)
      .map(member => String(member.participantEmail || '').trim().toLowerCase())
      .filter(Boolean)
    const checkedOutEmails = members
      .filter(member => member.attendance?.checkedOutAt)
      .map(member => String(member.participantEmail || '').trim().toLowerCase())
      .filter(Boolean)
    members.forEach(view => {
      view.attendanceSessionGroupEmails = members
        .map(member => String(member.participantEmail || '').trim().toLowerCase())
        .filter(Boolean)
      view.attendanceSessionGroupNames = members.map(member => String(member.participantName || '').trim()).filter(Boolean)
      view.attendanceSummary = {
        ...view.attendanceSummary,
        checkedInEmails,
        checkedOutEmails
      }
    })
  })
  return views
}

export const sessionReference = (id: string) => doc(db, 'appointmentSessions', id)

export type CanonicalSessionTimestamps = {
  startAt: Timestamp
  endAt: Timestamp
}
