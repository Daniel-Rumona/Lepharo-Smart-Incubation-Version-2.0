import type { Timestamp } from 'firebase/firestore'

export type InterventionFrequency = 'as-needed' | 'monthly' | 'biweekly' | 'weekly';
export type InterventionType = 'singular' | 'grouped'
export type AssigneeRole = 'coordinator' | 'operations'
export type AssignmentStatus = 'assigned' | 'in-progress' | 'completed' | 'cancelled' | 'needs-reassignment'
export type AcceptanceStatus = 'pending' | 'accepted' | 'declined'
export type AssigneeCompletionStatus = 'pending' | 'completed'
export type ParticipantCompletionStatus = 'pending' | 'confirmed' | 'rejected'
export const INTERVENTION_FREQUENCIES: {label:string, value: InterventionFrequency}[] = [
  { label: 'As needed', value: 'as-needed' },
  { label: 'Once a month', value: 'monthly' },
  { label: 'Every two weeks', value: 'biweekly' },
  { label: 'Weekly', value: 'weekly' },
];

export type Target =
  | { mode: 'hours'; hoursEstimate: number }
  | {
      mode: 'sessions'
      sessionsEstimate: number
      hoursPerSessionEstimate?: number
    }
  | {
      mode: 'documents'
      requiredDocs: { id: string; label: string; required: boolean }[]
      autoCompleteOnFirst?: boolean
    }
  | {
      mode: 'milestones'
      milestones: { id: string; label: string; weight?: number }[]
    }
  | { mode: 'percentage'; percentLabel?: string }

export type DeliveryMethod = 'in_person' | 'online' | 'telephonic' | 'other'

export type Tracking = {
  sessionsLogged: number
}

export interface Assignment {
    id?: string
    smmeNo?: string | null
    interventionId: string
    participantId: string
    participantName: string
    interventionTitle: string
    subInterventionId?: string | null
    subInterventionTitle?: string | null
    definitionVersion?: number
    definitionSnapshot?: {
      version: number
      interventionId: string
      interventionTitle: string
      subInterventionId?: string | null
      subInterventionTitle?: string | null
      capturedAt: Timestamp
    }
    type: InterventionType
    frequency?: InterventionFrequency
    assigneeRole: AssigneeRole
    assigneeId: string
    assigneeName: string
    assigneeEmail?: string | null
    assigneeProfileId?: string | null

    assignmentStatus: AssignmentStatus
    assigneeAcceptanceStatus: AcceptanceStatus
    participantAcceptanceStatus: AcceptanceStatus
    assigneeCompletionStatus: AssigneeCompletionStatus
    participantCompletionStatus: ParticipantCompletionStatus

    groupKey?: string | null
    groupedAt?: Timestamp | null
    scheduleMode?: 'once-off' | 'recurring' | 'ad-hoc'
    cycleKey?: string | null
    recurrence?: { every: number; unit: 'day' | 'week' | 'month' | 'quarter' | 'year'; strict: boolean } | null

    createdAt: Timestamp
    updatedAt?: Timestamp
    dueDate?: Timestamp | null
    feedback?: { rating: number; comments: string } | null

    areaOfSupport?: string | null
    departmentId?: string | null
    tracking?: Tracking | null
    computedProgress?: number
    plannedSessions?: number | null
    resources?: { id?: string; type?: string; label?: string; link: string }[]
    progressUpdates?: Array<Record<string, any>>
  }

 export  interface Participant {
    id: string
    smmeNo?: string | null
    beneficiaryName: string
    requiredInterventions: Array<{
      id: string | number
      title?: string
      interventionTitle?: string
      area?: string
      areaOfSupport?: string
      departmentId?: string
    }>
    completedInterventions: { id: string; title: string }[]
    sector?: string
    stage?: string
    province?: string
    city?: string
    location?: string
    programName?: string
  }
