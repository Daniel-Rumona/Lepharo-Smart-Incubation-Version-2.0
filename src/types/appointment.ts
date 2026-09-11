import type { Timestamp } from 'firebase/firestore'

export type AppointmentStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'postponed'
export type SmeConfirmation = 'pending' | 'confirmed' | 'declined'
export type AttendanceStatus = 'expected' | 'attended' | 'absent' | 'declined'
export type DeliveryMethod = 'in_person' | 'virtual' | 'telephonically'

export type AppointmentAttendance = {
  status: AttendanceStatus
  checkedInAt: Timestamp | null
  checkedOutAt: Timestamp | null
}

export type SmeRescheduleProposal = {
  id: string
  startTime: Timestamp
  endTime: Timestamp
}

export type SmeRescheduleRequest = {
  status: 'proposed' | 'accepted' | 'dismissed'
  reasonCode: string
  reasonText: string
  proposals: SmeRescheduleProposal[]
  acceptedProposalId?: string | null
  decidedAt?: Timestamp | null
}

/** One SME's invitation to a session. This is the only per-SME appointment record. */
export type Appointment = {
  schemaVersion: 5
  programId: string
  departmentId: string
  assignedInterventionId: string
  appointmentSessionId: string

  smeId: string
  smeName: string
  smeEmail: string | null

  interventionId: string
  interventionTitle: string
  subInterventionId: string | null
  subInterventionTitle: string | null
  cycleKey: string | null

  assigneeId: string
  assigneeName: string
  assigneeEmail: string | null
  assigneeRole: 'coordinator' | 'operations'

  groupKey: string | null
  status: AppointmentStatus
  smeConfirmation: SmeConfirmation
  smeDeclineReason: string | null
  smeRescheduleRequest?: SmeRescheduleRequest | null
  attendance: AppointmentAttendance
  foodSelections: FoodSelection[]

  createdAt: Timestamp
  updatedAt: Timestamp
  completedAt: Timestamp | null
}

/** Data shared by everyone invited to one actual session. */
export type AppointmentSession = {
  schemaVersion: 5
  programId: string
  departmentId: string
  interventionId: string
  interventionTitle: string
  cycleKey: string | null
  groupKey: string | null
  sessionType: 'individual' | 'group'

  assigneeId: string
  assigneeName: string
  assigneeEmail: string | null
  assigneeRole: 'coordinator' | 'operations'

  title: string
  startAt: Timestamp
  endAt: Timestamp
  deliveryMethod: DeliveryMethod
  location: string | null
  meetingLink: string | null

  /** Structured curriculum or unit-standard topics, used by Training Academy departments. */
  plannedTopics?: string[]
  plannedCoverage: string[]
  coverage: {
    held: boolean | null
    outcomeSummary: string | null
    coveredPoints: string[]
    photos?: string[]
    reasonNotHeld: string | null
    recordedAt: Timestamp | null
    recordedById: string | null
  }
  attendanceSession: {
    token: string
    qrUrl: string
    status: 'active' | 'closed'
    startedAt: Timestamp
    expiresAt: Timestamp
    closedAt: Timestamp | null
  } | null
  attendanceSummary: {
    invitedCount: number
    attendedCount: number
    checkedInCount: number
    checkedOutCount: number
  }
  foodMenu: FoodMenuItem[]
  /** Immutable audit entries appended whenever the slot is moved. */
  scheduleHistory?: Array<{
    previousStartAt: Timestamp
    previousEndAt: Timestamp
    nextStartAt: Timestamp
    nextEndAt: Timestamp
    reason: string
    changedAt: Timestamp
    changedById: string | null
  }>

  status: AppointmentStatus
  createdAt: Timestamp
  updatedAt: Timestamp
  completedAt: Timestamp | null
}

export type FoodMenuItem = {
  id: string
  name: string
  category: 'meal' | 'snack' | 'drink' | 'other'
}

export type FoodSelection = {
  menuItemId: string
  quantity: number
}
