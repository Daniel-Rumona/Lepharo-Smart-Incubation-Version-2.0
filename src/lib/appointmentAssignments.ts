import dayjs from 'dayjs'

type AssignmentRow = Record<string, any>

/** Assignment time is not the appointment date or the last edit time. */
export function assignmentDate(row: AssignmentRow): Date | null {
    for (const raw of [row.assignedAt, row.createdAt]) {
        if (raw == null || raw === '') continue
        const value = typeof raw?.toDate === 'function'
            ? raw.toDate()
            : typeof raw?.seconds === 'number'
                ? new Date(raw.seconds * 1000)
                : new Date(raw)
        if (!Number.isNaN(value.getTime())) return value
    }
    return null
}

export function assignmentDateLabel(row: AssignmentRow): string {
    const date = assignmentDate(row)
    return date ? dayjs(date).format('DD MMM YYYY') : 'Date not recorded'
}


/**
 * When the session is actually scheduled, from scheduling fields only.
 *
 * A v5 appointment document holds no date of its own - the date lives on the
 * linked appointmentSession - so this returns null for a raw document and a
 * real date for a hydrated view. Never substitute the appointment's createdAt:
 * a document written in August for an April session would then look like an
 * August session and could be linked to an August allocation.
 */
export function scheduledAppointmentDate(row: AssignmentRow): Date | null {
    for (const raw of [
        row.schedule?.startAt,
        row.schedule?.startTime,
        row.startsAt,
        row.date,
        row.startAt,
        row.startTime
    ]) {
        if (raw == null || raw === '') continue
        const value = typeof raw?.toDate === 'function'
            ? raw.toDate()
            : typeof raw?.seconds === 'number'
                ? new Date(raw.seconds * 1000)
                : new Date(raw)
        if (!Number.isNaN(value.getTime())) return value
    }
    return null
}

/** The scheduled appointment date, with legacy creation time as a last resort. */
export function appointmentDate(row: AssignmentRow): Date | null {
    for (const raw of [
        row.schedule?.startAt,
        row.schedule?.startTime,
        row.startsAt,
        row.date,
        row.startAt,
        row.startTime,
        row.createdAt
    ]) {
        if (raw == null || raw === '') continue
        const value = typeof raw?.toDate === 'function'
            ? raw.toDate()
            : typeof raw?.seconds === 'number'
                ? new Date(raw.seconds * 1000)
                : new Date(raw)
        if (!Number.isNaN(value.getTime())) return value
    }
    return null
}

/**
 * A linked assignment must match the appointment identity and exist by its
 * appointment day.
 *
 * `requireScheduledDate` refuses the match when the real session date cannot be
 * established. Use it whenever the answer decides a NEW link: guessing an owner
 * for an appointment of unknown date is what put April sessions under August
 * allocations. Validating an EXISTING link stays permissive, so a row that
 * simply lacks a date is not torn off the assignment it already has.
 */
export function assignmentCanOwnAppointment(
    appointment: AssignmentRow,
    assignment: AssignmentRow,
    options: { requireScheduledDate?: boolean } = {}
): boolean {
    const participantId = String(appointment.participantId || appointment.smeId || '').trim()
    const assignmentParticipantId = String(assignment.participantId || assignment.beneficiaryId || '').trim()
    if (participantId && assignmentParticipantId && participantId !== assignmentParticipantId) return false
    if (appointment.interventionId && String(assignment.interventionId || '') !== String(appointment.interventionId)) return false

    for (const field of ['programId', 'departmentId', 'cycleKey', 'groupKey', 'assigneeId', 'subInterventionId']) {
        if (appointment[field] && String(assignment[field] || '') !== String(appointment[field])) return false
    }

    const strict = scheduledAppointmentDate(appointment)
    if (options.requireScheduledDate && !strict) return false

    // Only fall back to createdAt when this is not deciding a new link.
    const scheduled = options.requireScheduledDate ? strict : appointmentDate(appointment)
    const assigned = assignmentDate(assignment)
    if (scheduled && assigned && dayjs(scheduled).startOf('day').isBefore(dayjs(assigned).startOf('day'))) return false

    return true
}

/** Overlapping identity queries can repeat IDs; different allocation IDs stay distinct. */
export function distinctAppointmentAssignments<T extends AssignmentRow>(rows: T[]): T[] {
    return [...new Map(rows.filter(row => row.id).map(row => [String(row.id), row])).values()]
        .sort((a, b) =>
            (assignmentDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (assignmentDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
            String(a.id).localeCompare(String(b.id))
        )
}

export function assignmentOptionLabel(row: AssignmentRow): string {
    return [
        row.interventionTitle || row.title || 'Intervention',
        row.subInterventionTitle,
        `Assigned ${assignmentDateLabel(row)}`,
        row.cycleKey ? `Cycle ${row.cycleKey}` : '',
        row.id ? `Ref ${String(row.id).slice(0, 8)}` : ''
    ].filter(Boolean).join(' · ')
}

/** Repair a missing link only when the stored appointment identity has one exact match. */
export function unambiguousAppointmentAssignment(
    appointment: AssignmentRow,
    candidates: AssignmentRow[]
): AssignmentRow | null {
    const participantId = String(appointment.participantId || appointment.smeId || '').trim()
    const matches = distinctAppointmentAssignments(candidates).filter(candidate => {
        if (!participantId || !appointment.interventionId) return false
        // Deciding a new owner, so the session date has to be known.
        if (!assignmentCanOwnAppointment(appointment, candidate, { requireScheduledDate: true })) return false
        return String(candidate.subInterventionId || '') === String(appointment.subInterventionId || '')
    })
    return matches.length === 1 ? matches[0] : null
}
