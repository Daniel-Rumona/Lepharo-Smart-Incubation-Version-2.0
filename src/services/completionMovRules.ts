// Who needs a signed MOV when an intervention is completed.
//
// A single delivery always does. In a group, an SME who attended nothing did
// not receive the intervention, so no MOV is raised in their name. This is the
// same rule the Allocated completion screen applies, kept in one place so the
// Appointments and dashboard completion dialogs agree with it.

import { hasRecordedAssignmentAttendance } from './assignmentLifecycleService'

export function splitMovRequirement<T extends Record<string, any>>(rows: T[]): { required: T[]; notRequired: T[] } {
    const required: T[] = []
    const notRequired: T[] = []
    for (const row of rows) {
        const grouped = String(row?.groupKey ?? '').trim() !== ''
        if (!grouped || hasRecordedAssignmentAttendance(row)) required.push(row)
        else notRequired.push(row)
    }
    return { required, notRequired }
}

/** Ids of the SMEs who still need a MOV file. */
export function missingMovAssignmentIds(
    required: Array<{ id: string }>,
    filesById: Record<string, unknown>
): string[] {
    return required.filter(row => !filesById[row.id]).map(row => row.id)
}
