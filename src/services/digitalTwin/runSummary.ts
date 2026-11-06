import { WORK_STAGES, type SimulationResult, type WorkStage } from './simulation'

export type TeamLoad = { stage: WorkStage; percentBusy: number | null; endQueue: number; noCapacity: boolean }
export type Peak = { open: number; dayIndex: number; date: string }
export type RunSummary = {
    /** Open interventions on the last day of the period. */
    endOpen: { ifNothingChanges: number; withChange: number }
    /** The team working closest to its limit (with the change), or null when nothing was worked on. */
    busiest: TeamLoad | null
    busiestIfNothingChanges: TeamLoad | null
    /** The highest number of open interventions on any day, and the first day it was reached. */
    peak: { withChange: Peak; ifNothingChanges: Peak }
}

const peakOf = (r: SimulationResult): Peak => {
    let best = 0
    r.days.forEach((d, i) => { if (d.backlog > r.days[best].backlog) best = i })
    return { open: r.days[best].backlog, dayIndex: best, date: r.days[best].date }
}

/** Busiest = highest share of available time used. A team with work waiting but no time at all counts as the busiest of all. */
export function busiestTeam(r: SimulationResult): TeamLoad | null {
    const loads: TeamLoad[] = WORK_STAGES.map(stage => {
        const available = r.minutesAvailable[stage], used = r.minutesUsed[stage], endQueue = r.days.at(-1)!.queues[stage]
        return { stage, percentBusy: available > 0 ? Math.round(used / available * 100) : null, endQueue, noCapacity: available <= 0 && endQueue > 0 }
    })
    const worked = loads.filter(l => l.noCapacity || (l.percentBusy ?? 0) > 0)
    if (!worked.length) return null
    return worked.sort((a, b) => Number(b.noCapacity) - Number(a.noCapacity) || (b.percentBusy ?? 0) - (a.percentBusy ?? 0) || b.endQueue - a.endQueue)[0]
}

export function summariseRun(ifNothingChanges: SimulationResult, withChange: SimulationResult): RunSummary {
    return {
        endOpen: { ifNothingChanges: ifNothingChanges.days.at(-1)!.backlog, withChange: withChange.days.at(-1)!.backlog },
        busiest: busiestTeam(withChange), busiestIfNothingChanges: busiestTeam(ifNothingChanges),
        peak: { withChange: peakOf(withChange), ifNothingChanges: peakOf(ifNothingChanges) }
    }
}
