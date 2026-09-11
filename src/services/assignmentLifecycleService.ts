export type AssignmentLifecycleKey =
    | 'cancelled'
    | 'needs-reassignment'
    | 'participant-declined'
    | 'participant-rejected'
    | 'completed'
    | 'awaiting-participant-acceptance'
    | 'in-delivery'
    | 'awaiting-participant-confirmation'
    | 'assigned'

export type NormalizedAcceptance = 'pending' | 'accepted' | 'declined'
export type NormalizedAssigneeCompletion = 'pending' | 'completed'
export type NormalizedParticipantCompletion = 'pending' | 'confirmed' | 'rejected'

export type AssignmentLifecycle = {
    key: AssignmentLifecycleKey
    label: string
    color: string
    waitingOn: 'assignee' | 'participant' | 'none'
    phase: 'acceptance' | 'delivery' | 'confirmation' | 'closed'
    isOpen: boolean
    isCompleted: boolean
    isDeclined: boolean
    assigneeAcceptance: NormalizedAcceptance
    participantAcceptance: NormalizedAcceptance
    assigneeCompletion: NormalizedAssigneeCompletion
    participantCompletion: NormalizedParticipantCompletion
}

export type ParticipantLifecycleAction =
    | 'accept-assignment'
    | 'decline-assignment'
    | 'confirm-completion'
    | 'reject-completion'

const DEFINITIONS: Record<AssignmentLifecycleKey, Omit<AssignmentLifecycle,
    'key' | 'assigneeAcceptance' | 'participantAcceptance' | 'assigneeCompletion' | 'participantCompletion'>> = {
    cancelled: { label: 'Cancelled', color: 'red', waitingOn: 'none', phase: 'closed', isOpen: false, isCompleted: false, isDeclined: false },
    'needs-reassignment': { label: 'Needs Reassignment', color: 'magenta', waitingOn: 'none', phase: 'closed', isOpen: false, isCompleted: false, isDeclined: true },
    'participant-declined': { label: 'Appointment Declined', color: 'red', waitingOn: 'assignee', phase: 'acceptance', isOpen: true, isCompleted: false, isDeclined: true },
    'participant-rejected': { label: 'SME Rejected Completion', color: 'red', waitingOn: 'assignee', phase: 'delivery', isOpen: true, isCompleted: false, isDeclined: true },
    completed: { label: 'Completed', color: 'green', waitingOn: 'none', phase: 'closed', isOpen: false, isCompleted: true, isDeclined: false },
    'awaiting-participant-acceptance': { label: 'Awaiting Appointment Response', color: 'orange', waitingOn: 'participant', phase: 'acceptance', isOpen: true, isCompleted: false, isDeclined: false },
    'in-delivery': { label: 'In Delivery', color: 'geekblue', waitingOn: 'assignee', phase: 'delivery', isOpen: true, isCompleted: false, isDeclined: false },
    'awaiting-participant-confirmation': { label: 'Awaiting SME Confirmation', color: 'purple', waitingOn: 'participant', phase: 'confirmation', isOpen: true, isCompleted: false, isDeclined: false },
    assigned: { label: 'Assigned', color: 'blue', waitingOn: 'assignee', phase: 'acceptance', isOpen: true, isCompleted: false, isDeclined: false }
}

export function normalizeAssignmentStatus(value: unknown) {
    const status = normalize(value).replace(/_/g, '-')
    if (status === 'declined' || status === 'needs reassignment') return 'needs-reassignment'
    if (['assigned', 'in-progress', 'completed', 'cancelled', 'needs-reassignment'].includes(status)) return status
    return 'assigned'
}

export function normalizeAcceptanceStatus(value: unknown): NormalizedAcceptance {
    const status = normalize(value)
    if (status === 'accepted' || status === 'confirmed') return 'accepted'
    if (status === 'declined' || status === 'rejected') return 'declined'
    return 'pending'
}

export function normalizeAssigneeCompletionStatus(value: unknown): NormalizedAssigneeCompletion {
    return ['done', 'complete', 'completed'].includes(normalize(value)) ? 'completed' : 'pending'
}

export function normalizeParticipantCompletionStatus(value: unknown): NormalizedParticipantCompletion {
    const status = normalize(value)
    if (status === 'confirmed' || status === 'done' || status === 'completed') return 'confirmed'
    if (status === 'rejected' || status === 'declined') return 'rejected'
    return 'pending'
}

/** Coverage stores attendance on each SME's assignment, even for group sessions. */
export function hasRecordedAssignmentAttendance(data: Record<string, any>): boolean {
    const attendance = data.sessionAttendanceByAppointment
    if (!attendance || typeof attendance !== 'object' || Array.isArray(attendance)) return false

    // Shared group progress/coverage and a facilitator's completion claim do
    // not prove this SME attended. Only use their individual attendance map.
    return Object.values(attendance).some((record: any) =>
        record?.held !== false && normalize(record?.outcome) === 'attended'
    )
}

export function resolveAssignmentLifecycle(data: Record<string, any>): AssignmentLifecycle {
    const assignmentStatus = normalizeAssignmentStatus(data.assignmentStatus)
    const assigneeAcceptance = normalizeAcceptanceStatus(data.assigneeAcceptanceStatus)
    const participantAcceptance = normalizeAcceptanceStatus(
        data.appointmentResponseStatus ?? data.participantAcceptanceStatus
    )
    const assigneeCompletion = normalizeAssigneeCompletionStatus(data.assigneeCompletionStatus)
    const participantCompletion = normalizeParticipantCompletionStatus(data.participantCompletionStatus)

    let key: AssignmentLifecycleKey
    if (assigneeAcceptance === 'declined' ||
        (assignmentStatus === 'needs-reassignment' && participantAcceptance !== 'declined')) key = 'needs-reassignment'
    else if (participantAcceptance === 'declined') key = 'participant-declined'
    else if (assignmentStatus === 'cancelled') key = 'cancelled'
    else if (assignmentStatus === 'completed' || participantCompletion === 'confirmed') key = 'completed'
    else if (participantCompletion === 'rejected') key = 'participant-rejected'
    // Facilitator completion is a later workflow event than appointment RSVP.
    // Let the SME confirm or reject the delivered work without rewriting a
    // missing RSVP as accepted. A separate open appointment cannot move a
    // completed single delivery backwards to the acceptance phase. Group
    // members still require their own acceptance or recorded attendance.
    else if (assigneeCompletion === 'completed' && !data.groupKey) key = 'awaiting-participant-confirmation'
    // Attendance can be recorded when connectivity prevented an invite
    // response. It satisfies the delivery gate without inventing acceptance
    // or changing the separate SME completion confirmation.
    else if (participantAcceptance === 'pending' && !hasRecordedAssignmentAttendance(data)) key = 'awaiting-participant-acceptance'
    else if (assigneeCompletion === 'pending') key = 'in-delivery'
    else if (participantCompletion === 'pending') key = 'awaiting-participant-confirmation'
    else key = 'assigned'

    return { key, ...DEFINITIONS[key], assigneeAcceptance, participantAcceptance, assigneeCompletion, participantCompletion }
}

export function buildParticipantLifecycleTransition(
    action: ParticipantLifecycleAction,
    data: any,
    options: { now?: any; reason?: string; feedback?: { rating?: number; comments?: string } } = {}
) {
    const lifecycle = resolveAssignmentLifecycle(data)
    const now = options.now || new Date()

    if (action === 'accept-assignment') {
        if (lifecycle.key !== 'awaiting-participant-acceptance') {
            throw new Error('This intervention is not awaiting an appointment response.')
        }
        return {
            appointmentResponseStatus: 'confirmed',
            participantAcceptanceStatus: 'accepted',
            participantAcceptedAt: now,
            assignmentStatus: 'in-progress',
            updatedAt: now
        }
    }

    if (action === 'decline-assignment') {
        if (lifecycle.key !== 'awaiting-participant-acceptance') {
            throw new Error('This intervention is not awaiting an appointment response.')
        }
        const reason = String(options.reason || '').trim()
        if (!reason) throw new Error('A decline reason is required.')
        return {
            appointmentResponseStatus: 'declined',
            participantAcceptanceStatus: 'declined',
            participantDeclinedAt: now,
            participantDeclineReason: reason,
            assignmentStatus: 'cancelled',
            updatedAt: now
        }
    }

    if (lifecycle.key !== 'awaiting-participant-confirmation') {
        throw new Error('This intervention is not awaiting SME completion confirmation.')
    }

    if (action === 'confirm-completion') {
        return {
            participantCompletionStatus: 'confirmed',
            participantConfirmedAt: now,
            completedAt: now,
            assignmentStatus: 'completed',
            feedback: {
                rating: Number(options.feedback?.rating || 0),
                comments: String(options.feedback?.comments || '')
            },
            updatedAt: now
        }
    }

    const reason = String(options.reason || '').trim()
    if (!reason) throw new Error('A rejection reason is required.')
    return {
        participantCompletionStatus: 'rejected',
        participantCompletionRejectedAt: now,
        participantCompletionRejectionReason: reason,
        assignmentStatus: 'in-progress',
        updatedAt: now
    }
}

export function assignmentAssignedDate(data: Record<string, any>): Date | null {
    return toDate(data.assignedAtResolved || data.assignedAt || data.createdAt || data.startDate)
}

export function assignmentCompletedDate(data: Record<string, any>): Date | null {
    return toDate(data.completedAt || data.participantConfirmedAt || data.assigneeCompletedAt || data.updatedAt || data.createdAt)
}

export function assignmentReminderReason(data: Record<string, any>): 'acceptance' | 'confirmation' | null {
    const lifecycle = resolveAssignmentLifecycle(data)
    if (lifecycle.key === 'awaiting-participant-acceptance') return 'acceptance'
    if (lifecycle.key === 'awaiting-participant-confirmation') return 'confirmation'
    return null
}

/**
 * Distinguishes "this cycle/assignment is done" from "this SME has finished
 * the whole intervention". A single completed assignment only finishes the
 * intervention when it has no sub-interventions; otherwise every active
 * sub-intervention needs at least one completed assignment for that SME.
 *
 * `interventionDefsById` only needs `hasSubInterventions` and
 * `subInterventions` (each `{ subId, active?, archivedAt? }`) per intervention.
 */
export function computeSmeCompletedInterventionIds(
    assignments: Array<Record<string, any>>,
    interventionDefsById: Record<string, any>
): Set<string> {
    const byIntervention = new Map<string, Array<Record<string, any>>>()
    assignments.forEach(a => {
        const interventionId = String(a?.interventionId || '').trim()
        if (!interventionId) return
        if (!byIntervention.has(interventionId)) byIntervention.set(interventionId, [])
        byIntervention.get(interventionId)!.push(a)
    })

    const completed = new Set<string>()

    byIntervention.forEach((rows, interventionId) => {
        const def = interventionDefsById[interventionId]
        const activeSubIds = (Array.isArray(def?.subInterventions) ? def.subInterventions : [])
            .filter((s: any) => s?.active !== false && !s?.archivedAt)
            .map((s: any) => String(s?.subId || s?.id || s?.title || '').trim())
            .filter(Boolean)
        const hasSubs = !!def?.hasSubInterventions && activeSubIds.length > 0

        if (!hasSubs) {
            if (rows.some(a => resolveAssignmentLifecycle(a).isCompleted)) completed.add(interventionId)
            return
        }

        const completedSubIds = new Set(
            rows
                .filter(a => resolveAssignmentLifecycle(a).isCompleted)
                .map(a => String(a?.subInterventionId || '').trim())
                .filter(Boolean)
        )
        if (activeSubIds.every((subId: string) => completedSubIds.has(subId))) completed.add(interventionId)
    })

    return completed
}

export const assignmentLifecycleService = {
    resolve: resolveAssignmentLifecycle,
    participantTransition: buildParticipantLifecycleTransition,
    assignedDate: assignmentAssignedDate,
    completedDate: assignmentCompletedDate,
    reminderReason: assignmentReminderReason,
    smeCompletedInterventionIds: computeSmeCompletedInterventionIds
}

function normalize(value: unknown) {
    return String(value ?? '').trim().toLowerCase()
}

function toDate(value: any): Date | null {
    if (!value) return null
    const date = typeof value?.toDate === 'function'
        ? value.toDate()
        : value instanceof Date
            ? value
            : typeof value === 'number' || typeof value === 'string'
                ? new Date(value)
                : null
    return date && !Number.isNaN(date.getTime()) ? date : null
}
