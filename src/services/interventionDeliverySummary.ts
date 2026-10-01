// Delivery and outcome figures for ONE intervention, kept apart on purpose:
// assigned, delivered, MOV approved, deliverable received and outcome are
// different questions, and "completed" answers only some of them.

import { resolveAssignmentLifecycle } from './assignmentLifecycleService'
import { hasDeliverableFile } from './deliverableFiles'

export type DeliverySummary = {
    assigned: number
    inDelivery: number
    awaitingSme: number
    completed: number
    closed: number
    movApproved: number
    deliverableReceived: number
    outcomeAchieved: number
    outcomePartial: number
    outcomeNotYet: number
    checkBackDue: number
}

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()
const millis = (value: any): number => {
    if (!value) return 0
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
    return 0
}

export function summariseDelivery(
    assignments: Array<Record<string, any>>,
    movs: Array<Record<string, any>> = [],
    followUps: Array<Record<string, any>> = [],
    now: number = Date.now()
): DeliverySummary {
    const summary: DeliverySummary = {
        assigned: 0, inDelivery: 0, awaitingSme: 0, completed: 0, closed: 0,
        movApproved: 0, deliverableReceived: 0,
        outcomeAchieved: 0, outcomePartial: 0, outcomeNotYet: 0, checkBackDue: 0
    }

    for (const row of assignments) {
        const lifecycle = resolveAssignmentLifecycle(row)
        if (row.supportClosedAt) {
            summary.closed += 1
            continue
        }
        // Cancelled, declined and reassigned rows are not work the department delivered.
        if (lifecycle.key === 'cancelled' || lifecycle.key === 'needs-reassignment' || lifecycle.key === 'participant-declined') continue

        summary.assigned += 1
        if (lifecycle.isCompleted) summary.completed += 1
        else if (lifecycle.phase === 'confirmation') summary.awaitingSme += 1
        else summary.inDelivery += 1

        if (hasDeliverableFile(row.resources)) summary.deliverableReceived += 1

        const outcome = lower(row.outcome?.status)
        if (outcome === 'achieved') summary.outcomeAchieved += 1
        else if (outcome === 'partial') summary.outcomePartial += 1
        else if (outcome === 'not_yet') summary.outcomeNotYet += 1
    }

    // A MOV proves delivery only once the HOD has approved it.
    summary.movApproved = movs.filter(mov => lower(mov.status) === 'approved').length

    summary.checkBackDue = followUps.filter(
        item => !item.answer && millis(item.dueAt) > 0 && millis(item.dueAt) <= now
    ).length

    return summary
}
