/**
 * The project admin report's Engagement tab: appointment sessions and walk-ins.
 *
 * - Sessions come from appointmentSessions (one per meeting, individual or group),
 *   counted by when they were scheduled to start. Cancelled sessions are counted
 *   apart; attendance is counted only on sessions that were held.
 * - Walk-ins are inquiries whose channel is Walk-in, counted by when they were logged.
 */
import { resolveInquiryAudience, resolveInquiryChannel } from '@/utils/inquirySource'

export type Count = { label: string; value: number }

export type SessionCounts = {
    held: number
    notHeld: number
    /** In the past with no outcome recorded yet. */
    awaitingOutcome: number
    upcoming: number
}

export type DepartmentSessions = SessionCounts & { id: string; label: string; total: number }

export type EngagementModel = {
    sessions: SessionCounts & {
        total: number
        cancelled: number
        individual: number
        group: number
        byMethod: Count[]
        invited: number
        attended: number
    }
    departments: DepartmentSessions[]
    walkIns: {
        total: number
        incubated: number
        nonIncubated: number
        byType: Count[]
        open: number
        closed: number
    }
    trend: { categories: string[]; held: number[]; walkIns: number[] }
}

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000)
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()

const METHOD_LABEL: Record<string, string> = {
    in_person: 'In person',
    virtual: 'Online',
    telephonically: 'Phone'
}

const CLOSED_STATUSES = new Set(['resolved', 'closed', 'converted', 'lost'])

const tally = (labels: string[]): Count[] => {
    const counts = new Map<string, number>()
    labels.forEach(label => counts.set(label, (counts.get(label) || 0) + 1))
    return Array.from(counts, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

export const sessionState = (session: any, now: Date): keyof SessionCounts => {
    const status = lower(session?.status)
    if (status === 'completed' || session?.coverage?.held === true) return 'held'
    if (session?.coverage?.held === false) return 'notHeld'
    const start = toDate(session?.startAt)
    return start && start > now ? 'upcoming' : 'awaitingOutcome'
}

export function buildEngagementModel({
    sessions,
    inquiries,
    inRange,
    programId,
    departmentLabel,
    matchesDepartment,
    monthKeys,
    monthKeyOf,
    monthLabel,
    now = new Date()
}: {
    sessions: any[]
    inquiries: any[]
    inRange: (value: unknown) => boolean
    /** The active programme, if any. Walk-ins without a programme still count. */
    programId?: string | null
    departmentLabel: (departmentId: string) => string
    /** The Department filter, by department id. */
    matchesDepartment: (departmentId: string) => boolean
    monthKeys: string[]
    monthKeyOf: (date: Date) => string
    monthLabel: (key: string) => string
    now?: Date
}): EngagementModel {
    const monthly = new Map<string, { held: number; walkIns: number }>()
    const bump = (date: Date | null, key: 'held' | 'walkIns') => {
        if (!date) return
        const month = monthKeyOf(date)
        const m = monthly.get(month) || { held: 0, walkIns: 0 }
        m[key] += 1
        monthly.set(month, m)
    }

    // ---- Sessions
    const inPeriod = sessions.filter(s => inRange(s?.startAt) && matchesDepartment(String(s?.departmentId || '')))
    const cancelled = inPeriod.filter(s => lower(s?.status) === 'cancelled').length
    const active = inPeriod.filter(s => lower(s?.status) !== 'cancelled')

    const totals: SessionCounts = { held: 0, notHeld: 0, awaitingOutcome: 0, upcoming: 0 }
    const byDepartment = new Map<string, DepartmentSessions>()
    let invited = 0
    let attended = 0
    active.forEach(session => {
        const state = sessionState(session, now)
        totals[state] += 1
        if (state === 'held') {
            invited += Number(session?.attendanceSummary?.invitedCount || 0)
            attended += Number(session?.attendanceSummary?.attendedCount || 0)
            bump(toDate(session?.startAt), 'held')
        }
        const id = String(session?.departmentId || '') || 'none'
        if (!byDepartment.has(id)) {
            byDepartment.set(id, {
                id,
                label: id === 'none' ? 'No department' : departmentLabel(id),
                total: 0,
                held: 0,
                notHeld: 0,
                awaitingOutcome: 0,
                upcoming: 0
            })
        }
        const row = byDepartment.get(id)!
        row.total += 1
        row[state] += 1
    })

    // ---- Walk-ins
    const walkIns = inquiries.filter(item => {
        if (resolveInquiryChannel(item?.source) !== 'Walk-in') return false
        if (programId && item?.programId && String(item.programId) !== programId) return false
        if (!inRange(item?.submittedAt ?? item?.createdAt)) return false
        return matchesDepartment(String(item?.inquiryDetails?.departmentId || ''))
    })
    walkIns.forEach(item => bump(toDate(item?.submittedAt ?? item?.createdAt), 'walkIns'))
    const incubated = walkIns.filter(item => resolveInquiryAudience(item) === 'Incubatee').length
    const closed = walkIns.filter(item => CLOSED_STATUSES.has(lower(item?.status))).length

    const keys = monthKeys.length ? monthKeys : Array.from(monthly.keys()).sort()

    return {
        sessions: {
            ...totals,
            total: active.length,
            cancelled,
            individual: active.filter(s => lower(s?.sessionType) !== 'group').length,
            group: active.filter(s => lower(s?.sessionType) === 'group').length,
            byMethod: tally(active.map(s => METHOD_LABEL[lower(s?.deliveryMethod)] || 'Not set')),
            invited,
            attended
        },
        departments: Array.from(byDepartment.values()).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)),
        walkIns: {
            total: walkIns.length,
            incubated,
            nonIncubated: walkIns.length - incubated,
            byType: tally(walkIns.map(item => String(item?.inquiryDetails?.inquiryType || '').trim() || 'Other')),
            open: walkIns.length - closed,
            closed
        },
        trend: {
            categories: keys.map(monthLabel),
            held: keys.map(k => monthly.get(k)?.held || 0),
            walkIns: keys.map(k => monthly.get(k)?.walkIns || 0)
        }
    }
}
