/**
 * How long a record may sit at each step before it counts as "past target".
 * PLACEHOLDERS: these are not agreed service levels. Replace them with the team's real targets.
 * Keys are the Current state step ids (see STATIONS in JourneyMap).
 */
export const WAIT_TARGET_DAYS: Record<string, number> = {
    response: 5, delivery: 7, confirmation: 3,
    prepare: 7, hod: 5, cc: 7, me: 7
}
export const TARGETS_ARE_PLACEHOLDERS = true

export function median(values: number[]): number | null {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export type WaitSummary = { known: number; unknown: number; median: number | null; oldest: number | null; pastTarget: number }
/** Waits in whole days from explicit stage-entry dates only; records without one are counted as unknown, never zero. */
export function summariseWaits(enteredAt: Array<number | null>, now: number, targetDays: number): WaitSummary {
    const days = enteredAt.filter((t): t is number => t !== null && t <= now).map(t => Math.floor((now - t) / 86400000))
    const m = median(days)
    return { known: days.length, unknown: enteredAt.length - days.length, median: m === null ? null : Math.round(m), oldest: days.length ? Math.max(...days) : null, pastTarget: days.filter(d => d > targetDays).length }
}

/** An invitation the SME has not answered for this many days counts as needing attention (the Control Tower treats it as stuck at the same point). */
export const ACCEPTANCE_OVERDUE_DAYS = 3
/** Invitations still waiting for the SME to accept, only those past the limit. Records without a start date are never counted: their wait is unknown. */
export function overdueAcceptance<T extends { stage: string; enteredAt: number | null }>(items: T[], clock: number, days = ACCEPTANCE_OVERDUE_DAYS): T[] {
    return items.filter(i => i.stage === 'awaiting-participant-acceptance' && i.enteredAt !== null && i.enteredAt <= clock && Math.floor((clock - i.enteredAt) / 86400000) >= days)
}
