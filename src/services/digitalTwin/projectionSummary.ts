import { clearDay } from './goalSeek'
import { busiestTeam, summariseRun } from './runSummary'
import type { SimulationResult, WorkStage } from './simulation'

export const TEAM_NAME: Record<WorkStage, string> = { delivery: 'Delivery', hod: 'Head of dept. review', cc: 'Centre coordinator', me: 'M&E quality check' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateText = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` }

/** One side of the comparison, in the plain terms a summary needs. */
export type SideFacts = { endOpen: number; peakOpen: number; peakDate: string; busiestTeam: string | null; busiestPercent: number | null; clearsOn: string | null }
/** Only numbers and short labels: no names and no records, so it is safe to send to the assistant. */
export type ProjectionFacts = { weeks: number; changes: string[]; ifNothing: SideFacts; withChange: SideFacts; endDifference: number; peakDifference: number }

const side = (r: SimulationResult, peak: { open: number; date: string }): SideFacts => {
    const busy = busiestTeam(r), clear = clearDay(r)
    return { endOpen: r.days.at(-1)!.backlog, peakOpen: peak.open, peakDate: dateText(peak.date), busiestTeam: busy ? TEAM_NAME[busy.stage] : null, busiestPercent: busy && busy.percentBusy !== null && !busy.noCapacity ? busy.percentBusy : null, clearsOn: clear === null || clear === 0 ? null : dateText(r.days[clear].date) }
}
export function buildFacts(baseline: SimulationResult, scenario: SimulationResult, changes: string[], weeks: number): ProjectionFacts {
    const s = summariseRun(baseline, scenario), ifNothing = side(baseline, s.peak.ifNothingChanges), withChange = side(scenario, s.peak.withChange)
    return { weeks, changes, ifNothing, withChange, endDifference: withChange.endOpen - ifNothing.endOpen, peakDifference: withChange.peakOpen - ifNothing.peakOpen }
}

const n = (v: number, one: string, many = one + 's') => `${v} ${v === 1 ? one : many}`
/** The built-in wording, used when the assistant is not available. Only says what the numbers say. */
export function ruleSummary(f: ProjectionFacts): string {
    const base = `If nothing changes, ${n(f.ifNothing.endOpen, 'open intervention')} ${f.ifNothing.endOpen === 1 ? 'is' : 'are'} left after ${n(f.weeks, 'week')}, with a peak of ${f.ifNothing.peakOpen} on ${f.ifNothing.peakDate}.${f.ifNothing.busiestTeam && f.ifNothing.busiestPercent !== null ? ` ${f.ifNothing.busiestTeam} is the busiest team at ${f.ifNothing.busiestPercent}%.` : ''}`
    if (!f.changes.length) return `${base} Turn a dial to see how a change would differ.`
    const verdict = f.endDifference === 0 ? `the same as the ${f.ifNothing.endOpen} left if nothing changes` : `${Math.abs(f.endDifference)} ${f.endDifference < 0 ? 'fewer' : 'more'} than the ${f.ifNothing.endOpen} left if nothing changes`
    const peak = f.peakDifference === 0 ? 'The peak is unchanged.' : `The peak is ${f.withChange.peakOpen}, ${Math.abs(f.peakDifference)} ${f.peakDifference < 0 ? 'lower' : 'higher'}.`
    const busy = f.withChange.busiestTeam && f.withChange.busiestPercent !== null ? ` ${f.withChange.busiestTeam} is then the busiest team at ${f.withChange.busiestPercent}%.` : ''
    const clears = f.withChange.clearsOn ? ` Everything clears on ${f.withChange.clearsOn}.` : ''
    return `With ${f.changes.join(', ')}, ${n(f.withChange.endOpen, 'open intervention')} ${f.withChange.endOpen === 1 ? 'is' : 'are'} left after ${n(f.weeks, 'week')}: ${verdict}. ${peak}${busy}${clears}`
}
