import dayjs from 'dayjs'
import { countLeaveDays, type LeaveRequest, type LeaveSettings, type LeaveType } from './types'

/**
 * Leave policy rules, kept free of React and Firestore so the page, the
 * wizard and the balances all count the same way.
 */

export const POLICY_DEFAULTS: LeaveSettings = {
    type: 'leave',
    caps: {
        annual: 21,
        sick: { per12: 15, per24: 30 },
        family: 3,
        study: 5,
        maternity: 80,
        parental: 10
    },
    sickProofAfterDays: 2,
    autoApproveHalfDay: false,
    blackoutDates: []
}

export const LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'family', 'study', 'maternity', 'parental']

/** The rolling window each type's cap applies to, in days. */
const WINDOW: Record<LeaveType, number> = {
    annual: 365,
    sick: 365,
    family: 365,
    study: 365,
    maternity: 730,
    parental: 365,
    personal: 365
}

export const mergeSettings = (data?: Partial<LeaveSettings> | null): LeaveSettings => ({
    ...POLICY_DEFAULTS,
    ...(data || {}),
    caps: {
        ...POLICY_DEFAULTS.caps,
        ...(data?.caps || {}),
        sick: { ...POLICY_DEFAULTS.caps.sick, ...(data?.caps?.sick || {}) }
    },
    blackoutDates: Array.isArray(data?.blackoutDates) ? data!.blackoutDates : []
})

/**
 * Working days a request takes, always counted from its dates: older requests
 * stored calendar days in `days`, so that field isn't trusted for balances.
 */
export const requestDays = (r: Pick<LeaveRequest, 'from' | 'to'>) => countLeaveDays(r.from, r.to)

/**
 * Approved days of a type in the window, optionally leaving one request out
 * (the one being edited or approved, so it isn't counted against itself).
 */
export const usedWithin = (
    requests: LeaveRequest[],
    userId: string,
    type: LeaveType,
    sinceDays: number,
    excludeId?: string
) => {
    const since = dayjs().subtract(sinceDays, 'day')
    return requests
        .filter(
            r =>
                r.id !== excludeId &&
                r.employeeId === userId &&
                r.status === 'approved' &&
                r.type === type &&
                dayjs(r.to).isAfter(since)
        )
        .reduce((sum, r) => sum + requestDays(r), 0)
}

export const capFor = (settings: LeaveSettings, type: LeaveType): number | null => {
    switch (type) {
        case 'sick':
            return settings.caps.sick.per12
        case 'personal':
            return null
        default:
            return settings.caps[type]
    }
}

/** Days still available for a type; sick leave honours both its 12- and 24-month caps. */
export const remainingFor = (
    requests: LeaveRequest[],
    settings: LeaveSettings,
    userId: string,
    type: LeaveType,
    excludeId?: string
): number | null => {
    const cap = capFor(settings, type)
    if (cap === null) return null
    const rem = Math.max(0, cap - usedWithin(requests, userId, type, WINDOW[type], excludeId))
    if (type !== 'sick') return rem
    const rem24 = Math.max(0, settings.caps.sick.per24 - usedWithin(requests, userId, 'sick', 730, excludeId))
    return Math.min(rem, rem24)
}

export const isOnLeaveOn = (r: Pick<LeaveRequest, 'from' | 'to'>, day = dayjs()) =>
    !day.isBefore(dayjs(r.from), 'day') && !day.isAfter(dayjs(r.to), 'day')

const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) =>
    !dayjs(a.to).isBefore(dayjs(b.from), 'day') && !dayjs(b.to).isBefore(dayjs(a.from), 'day')

/** The employee's other approved or pending leave that shares any day with this range. */
export const overlappingFor = (
    requests: LeaveRequest[],
    userId: string,
    range: { from: string; to: string },
    excludeId?: string
) =>
    requests.filter(
        r =>
            r.id !== excludeId &&
            r.employeeId === userId &&
            (r.status === 'approved' || r.status === 'pending') &&
            overlaps(r, range)
    )

export const hitsBlackout = (settings: LeaveSettings, from: string, to: string) => {
    const set = new Set(settings.blackoutDates || [])
    if (!set.size) return false
    for (let d = dayjs(from); !d.isAfter(dayjs(to), 'day'); d = d.add(1, 'day')) {
        if (set.has(d.format('YYYY-MM-DD'))) return true
    }
    return false
}

/** Every day from each picked range, as stored in the policy. */
export const expandRanges = (ranges: Array<[dayjs.Dayjs, dayjs.Dayjs]>) => {
    const days = new Set<string>()
    ranges.forEach(([start, end]) => {
        for (let d = start.startOf('day'); !d.isAfter(end, 'day'); d = d.add(1, 'day')) {
            days.add(d.format('YYYY-MM-DD'))
        }
    })
    return Array.from(days).sort()
}

/** Stored blackout days back into consecutive ranges, for editing. */
export const collapseDays = (days: string[]): Array<[dayjs.Dayjs, dayjs.Dayjs]> => {
    const sorted = Array.from(new Set(days)).sort()
    const ranges: Array<[dayjs.Dayjs, dayjs.Dayjs]> = []
    sorted.forEach(day => {
        const d = dayjs(day)
        const last = ranges[ranges.length - 1]
        if (last && last[1].add(1, 'day').isSame(d, 'day')) last[1] = d
        else ranges.push([d, d])
    })
    return ranges
}

/**
 * Whether this leave can be approved or saved: blackout days, overlap with the
 * employee's other leave, and the type's cap (not counting this request itself).
 */
export const validateLeave = (
    requests: LeaveRequest[],
    settings: LeaveSettings,
    userId: string,
    type: LeaveType,
    from: string,
    to: string,
    excludeId?: string
): { ok: boolean; reason?: string } => {
    if (dayjs(to).isBefore(dayjs(from), 'day')) return { ok: false, reason: 'The end date is before the start date.' }
    if (countLeaveDays(from, to) === 0) return { ok: false, reason: 'These dates are all weekends or public holidays.' }
    if (hitsBlackout(settings, from, to)) return { ok: false, reason: 'The dates include a blackout day.' }
    const clash = overlappingFor(requests, userId, { from, to }, excludeId)[0]
    if (clash) {
        return {
            ok: false,
            reason: `Overlaps ${clash.status} leave on ${dayjs(clash.from).format('D MMM')} – ${dayjs(clash.to).format('D MMM YYYY')}.`
        }
    }
    const remaining = remainingFor(requests, settings, userId, type, excludeId)
    const days = countLeaveDays(from, to)
    if (remaining !== null && days > remaining) {
        return { ok: false, reason: `Only ${remaining} ${type} day${remaining === 1 ? '' : 's'} left; this needs ${days}.` }
    }
    return { ok: true }
}
