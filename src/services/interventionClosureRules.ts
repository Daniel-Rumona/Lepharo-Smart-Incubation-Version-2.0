// The rules for closing an intervention for one SME. Pure functions only, so
// the Developmental Plan and the Assignments page cannot disagree.
//
// Closing means: the HOD ends the support for this SME. No new cycles are
// assigned, assignments that have not been delivered yet are cancelled, and
// everything already delivered, confirmed or awaiting confirmation is left
// exactly as it is. A closure is reversible; history is never deleted.

import { resolveAssignmentLifecycle } from './assignmentLifecycleService'

export const CLOSE_REASONS = [
    { value: 'goal_met', label: 'Goal met', hint: 'The SME got what they needed.' },
    { value: 'sme_no_longer_needs', label: 'SME no longer needs it', hint: 'Their situation changed.' },
    { value: 'sme_unresponsive', label: 'SME unresponsive', hint: 'We could not keep the support going.' },
    { value: 'programme_ended', label: 'Programme ended', hint: 'The programme or funding period is over.' },
    { value: 'other', label: 'Other', hint: 'Explain in the note.' }
] as const

export type CloseReason = (typeof CLOSE_REASONS)[number]['value']

export const closeReasonLabel = (value: unknown) =>
    CLOSE_REASONS.find(reason => reason.value === value)?.label || 'Closed'

export const isCloseReason = (value: unknown): value is CloseReason =>
    CLOSE_REASONS.some(reason => reason.value === value)

/** Roles that may close or reopen support (HOD and above). */
export const CLOSURE_ROLES = ['operations', 'admin', 'system_admin'] as const
export const canCloseSupport = (role: unknown) =>
    (CLOSURE_ROLES as readonly string[]).includes(String(role || '').trim().toLowerCase())

const clean = (value: unknown) => String(value ?? '').trim()

/** One closure per programme, SME and intervention, whatever the number of cycles. */
export const closureId = (input: {
    programId?: string | null
    participantId: string
    interventionId: string
}) => [clean(input.programId) || 'noprog', clean(input.participantId), clean(input.interventionId)].join('__')

/** Returns a message when the closure cannot be recorded, otherwise null. */
export function validateClosure(input: { reason?: unknown; note?: unknown }): string | null {
    if (!isCloseReason(input.reason)) return 'Choose a reason.'
    if (input.reason === 'other' && !clean(input.note)) return 'Add a note explaining why.'
    return null
}

export const isClosedAssignment = (row: Record<string, any> | null | undefined) =>
    !!row?.supportClosedAt

/**
 * Which of an SME's assignments a closure ends. Only work that has not been
 * delivered yet is cancelled. Anything completed, or delivered and waiting for
 * the SME to confirm, is left alone so nothing already earned is lost.
 */
export function splitForClosure<T extends Record<string, any>>(rows: T[]): { toClose: T[]; keep: T[] } {
    const toClose: T[] = []
    const keep: T[] = []
    for (const row of rows) {
        if (isClosedAssignment(row)) continue
        const lifecycle = resolveAssignmentLifecycle(row)
        if (lifecycle.isOpen && (lifecycle.phase === 'acceptance' || lifecycle.phase === 'delivery')) {
            toClose.push(row)
        } else {
            keep.push(row)
        }
    }
    return { toClose, keep }
}

/** What is written to each assignment a closure ends (dates and identity are passed in). */
export function closedAssignmentPatch(input: {
    previousStatus: unknown
    closureId: string
    reason: CloseReason
    note?: string
    byUid: string
    byName: string
    at: unknown
}) {
    return {
        assignmentStatus: 'cancelled',
        assignmentStatusBeforeClosure: clean(input.previousStatus) || 'assigned',
        supportClosedAt: input.at,
        supportClosureId: input.closureId,
        supportClosedReason: input.reason,
        supportClosedNote: clean(input.note),
        supportClosedBy: input.byUid,
        supportClosedByName: input.byName,
        updatedAt: input.at
    }
}

/** The status a reopened assignment goes back to. */
export const statusAfterReopen = (row: Record<string, any>) =>
    clean(row.assignmentStatusBeforeClosure) || 'assigned'
