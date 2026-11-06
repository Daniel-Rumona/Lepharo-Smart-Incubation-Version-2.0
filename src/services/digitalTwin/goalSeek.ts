import { simulate, type Assumptions, type SimulationResult, type SimulationSnapshot } from './simulation'

/** Everything a user can change in Scenarios. Hours are extra hours per week on top of the starting capacity. */
export type Levers = { hours: number; cc: number; me: number; hod: number; intake: number }
export const MAX_HORIZON_WEEKS = 26

export function scenarioAssumptions(base: Assumptions, levers: Levers, weeks = base.weeks): Assumptions {
    return { ...base, weeks, closedDates: [...base.closedDates], deliveryHours: base.deliveryHours + levers.hours, ccHours: base.ccHours + levers.cc, meHours: base.meHours + levers.me, hodWindows: levers.hod, intake: levers.intake }
}

/** Index of the first day with no outstanding work, or null if work remains at the end. */
export function clearDay(result: SimulationResult): number | null {
    const i = result.days.findIndex(d => d.backlog === 0)
    return i < 0 ? null : i
}

export type GoalSuggestion =
    | { status: 'already'; levers: Levers; clearDay: number | null; waiting: number }
    | { status: 'found'; levers: Levers; clearDay: number | null; waiting: number; added: Partial<Levers> }
    | { status: 'unreachable'; stillWaiting: number }
    | { status: 'too_far' }

const STEP: Record<'hours' | 'cc' | 'me' | 'hod', number> = { hours: 2, cc: 1, me: 1, hod: 1 }
const LIMIT = (base: Assumptions) => ({ hours: Math.max(0, 240 - base.deliveryHours), cc: Math.max(0, 200 - base.ccHours), me: Math.max(0, 200 - base.meHours), hod: 5 })

/**
 * Smallest capacity increase (found greedily, then trimmed) that leaves no more work waiting on `targetDay` than is physically unavoidable.
 * With no new work arriving that is zero; with steady inflow some work is always in flight, so the target is the fewest open interventions
 * the same model leaves waiting with every team at its maximum capacity.
 * Intake and everything else the user chose stay fixed. Cost counts one unit per extra hour a week,
 * and a HOD window costs its length in hours. This finds a sufficient change within the model, not a proven optimum.
 */
export function suggestForGoal(snapshot: SimulationSnapshot, base: Assumptions, current: Levers, targetDay: number): GoalSuggestion {
    if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay + 1 > MAX_HORIZON_WEEKS * 7) return { status: 'too_far' }
    const weeks = Math.min(MAX_HORIZON_WEEKS, Math.max(base.weeks, Math.ceil((targetDay + 1) / 7)))
    const run = (l: Levers) => simulate(snapshot, scenarioAssumptions(base, l, weeks))
    const limit = LIMIT(base)
    const ceiling: Levers = { hours: Math.max(current.hours, limit.hours), cc: Math.max(current.cc, limit.cc), me: Math.max(current.me, limit.me), hod: limit.hod, intake: current.intake }
    const floor = run(ceiling).days[targetDay].backlog
    const meets = (r: SimulationResult) => r.days[targetDay].backlog <= floor
    const start = run(current)
    if (meets(start)) return { status: 'already', levers: current, clearDay: clearDay(start), waiting: start.days[targetDay].backlog }
    const cost = (key: keyof typeof STEP) => key === 'hod' ? Math.max(0.5, base.hodWindowMinutes / 60) : STEP[key]
    const keys = ['hours', 'cc', 'me', 'hod'] as const
    const area = (r: SimulationResult) => r.days.reduce((n, d) => n + d.backlog, 0)
    let levers = { ...current }, result = start
    for (let guard = 0; guard < 120 && !meets(result); guard++) {
        let best: { key: typeof keys[number]; levers: Levers; result: SimulationResult; score: number } | null = null
        for (const key of keys) {
            const next = { ...levers, [key]: levers[key] + STEP[key] } as Levers
            const overLimit = next[key] > Math.max(limit[key], current[key])
            if (overLimit) continue
            const r = run(next)
            // Prefer lowering what is left on the target day, then total outstanding work, per unit of cost.
            const gain = (result.days[targetDay].backlog - r.days[targetDay].backlog) * 1000 + (area(result) - area(r))
            if (gain <= 0) continue
            const score = gain / cost(key)
            if (!best || score > best.score) best = { key, levers: next, result: r, score }
        }
        if (!best) return { status: 'unreachable', stillWaiting: result.days[targetDay].backlog }
        levers = best.levers; result = best.result
    }
    if (!meets(result)) return { status: 'unreachable', stillWaiting: result.days[targetDay].backlog }

    // Trim: give back any step that is no longer needed.
    for (const key of keys) while (levers[key] - STEP[key] >= current[key]) {
        const trial = { ...levers, [key]: levers[key] - STEP[key] } as Levers
        const r = run(trial)
        if (!meets(r)) break
        levers = trial; result = r
    }
    const added: Partial<Levers> = {}
    for (const key of keys) if (levers[key] !== current[key]) added[key] = levers[key] - current[key]
    return { status: 'found', levers, clearDay: clearDay(result), waiting: result.days[targetDay].backlog, added }
}
