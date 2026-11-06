import { getDayHours, plannedMinutes, OPERATING_DAYS, clockMinutes, type BranchOperatingHours } from '../../utils/branchOperatingHours'
import { millis, type ProcessModel } from './processTwin'

const DAY = 86400000, OFFSET = 7200000 // days run on UTC+2 like the simulation

export type CentreStaffing = {
    branchId: string; name: string; hours: BranchOperatingHours; hoursConfigured: boolean
    facilitators: number; facilitatorsSource: 'records' | 'sessions' | 'assumed' | 'edited'
    centreCoordinators: number; centreCoordinatorsSource: 'records' | 'users' | 'assumed' | 'edited'
}
/** Minutes of work available on each simulation day (day 0 = the snapshot day). */
export type CentreCapacity = { delivery: number[]; cc: number[] }

const localNoon = (startAt: number, i: number) => { const d = new Date(startAt + i * DAY + OFFSET); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12) }

/**
 * Coordinators (who deliver) and centre coordinators (projectadmin role) work the centre's operating hours; operations-role
 * staff (HOD, M&E) do not, so they are not part of this. Each day's minutes = people x that day's opening length x the share of
 * that time spent on this work. Closed days, per-day overrides and the branch's public-holiday rule come from the branch itself.
 */
export function buildCentreCapacity(centres: Array<Pick<CentreStaffing, 'hours' | 'facilitators' | 'centreCoordinators'>>, startAt: number, days: number, share: number): CentreCapacity {
    const delivery = Array<number>(days).fill(0), cc = Array<number>(days).fill(0)
    for (const c of centres) for (let i = 0; i < days; i++) {
        const minutes = plannedMinutes(getDayHours(c.hours, localNoon(startAt, i)))
        delivery[i] += minutes * c.facilitators * share
        cc[i] += minutes * c.centreCoordinators * share
    }
    return { delivery, cc }
}

/** Opening hours per week for one person, from the branch's own weekday settings (ignores public-holiday overrides). */
export function weeklyOpenHours(hours: BranchOperatingHours): number {
    return Math.round(OPERATING_DAYS.reduce((n, { key }) => n + plannedMinutes(hours[key]), 0) / 6) / 10
}
export function describeHours(hours: BranchOperatingHours): string {
    const open = OPERATING_DAYS.filter(({ key }) => !hours[key].closed)
    if (!open.length) return 'Closed every day'
    const first = hours[open[0].key], uniform = open.every(({ key }) => hours[key].opens === first.opens && hours[key].closes === first.closes)
    const label = (d: { label: string }) => d.label.slice(0, 3)
    const contiguous = open.every(({ key }, i) => i === 0 || OPERATING_DAYS.findIndex(d => d.key === key) === OPERATING_DAYS.findIndex(d => d.key === open[i - 1].key) + 1)
    const span = contiguous && open.length > 1 ? `${label(open[0])}–${label(open[open.length - 1])}` : open.map(label).join(', ')
    return uniform ? `${span} ${first.opens}–${first.closes}` : `${span}, hours vary by day`
}
export { clockMinutes }

/** People who delivered sessions or were assigned work in the last `weeks` weeks, per centre. Operations-role assignees are not centre staff. */
export function recentFacilitators(model: Pick<ProcessModel, 'sessions' | 'assignments'>, now: number, weeks = 12): Map<string, number> {
    const from = now - weeks * 7 * DAY, seen = new Map<string, Set<string>>()
    const add = (branchId: any, id: any, role: any) => {
        if (!branchId || !id || String(role || '').toLowerCase() === 'operations') return
        if (!seen.has(String(branchId))) seen.set(String(branchId), new Set())
        seen.get(String(branchId))!.add(String(id))
    }
    for (const s of model.sessions) { const at = millis(s.startAt); if (at !== null && at >= from && at <= now) add(s.branchId, s.assigneeId, s.assigneeRole) }
    for (const a of model.assignments) { const at = millis(a.assignedAt); if (at !== null && at >= from && at <= now) add(a.branchId, a.assigneeId, a.assigneeRole) }
    return new Map([...seen].map(([branch, ids]) => [branch, ids.size]))
}
