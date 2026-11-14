// Which tab a follow-up belongs in, and how its due date reads, decided in one
// place for the receptionist's follow-ups page and dashboard tile.
//
// Overdue means due before today, not "earlier than this minute": a follow-up
// booked for today stays under Today all day.

export type FollowUpBucket = 'overdue' | 'today' | 'upcoming' | 'escalated' | 'done'

type Bucketable = { status: string; scheduledDate?: Date | null; escalatedToUids?: string[] | null }

/**
 * Open and handed to a department: its coordinators work it now, so reception
 * sees it under Escalated rather than in its own due lists.
 */
export const isEscalatedOpen = (followUp: Bucketable) =>
    isOpenFollowUp(followUp) && Array.isArray(followUp.escalatedToUids) && followUp.escalatedToUids.length > 0

const DAY = 24 * 60 * 60 * 1000

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** Whole calendar days from `now`'s day to `date`'s day (negative in the past). */
export const daysFromToday = (date: Date, now: Date) =>
    Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY)

/** Completed and cancelled follow-ups are done; anything else is still open. */
export const isOpenFollowUp = (followUp: Bucketable) => followUp.status !== 'Completed' && followUp.status !== 'Cancelled'

/**
 * `separateEscalated` is for reception's view: escalated follow-ups get their
 * own tab. A department coordinator's view leaves it off, since everything
 * they see is escalated, and sorts by due date instead.
 */
export function followUpBucket(followUp: Bucketable, now: Date, separateEscalated = false): FollowUpBucket {
    if (!isOpenFollowUp(followUp)) return 'done'
    if (separateEscalated && isEscalatedOpen(followUp)) return 'escalated'
    // An open follow-up with no date has nothing to wait for: treat it as due today.
    if (!followUp.scheduledDate) return 'today'
    const days = daysFromToday(followUp.scheduledDate, now)
    return days < 0 ? 'overdue' : days === 0 ? 'today' : 'upcoming'
}

/**
 * Reception's open follow-ups due today or earlier: what the dashboard tile
 * counts. Ones escalated to a department are theirs now, so they don't count.
 */
export const countDueFollowUps = (followUps: Bucketable[], now: Date) =>
    followUps.filter(f => {
        const bucket = followUpBucket(f, now, true)
        return bucket === 'overdue' || bucket === 'today'
    }).length

/** 09:00 on the next working day: when a new SME portal inquiry is due a reply. */
export const nextWorkingMorning = (now: Date) => {
    const next = new Date(now)
    next.setDate(next.getDate() + 1)
    const day = onWorkingDay(next)
    day.setHours(9, 0, 0, 0)
    return day
}

/** A time is shown only when one was set (not midnight). */
export const hasTimeOfDay = (date: Date) => date.getHours() !== 0 || date.getMinutes() !== 0

const pad = (n: number) => String(n).padStart(2, '0')
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Mon 9 Nov" or "Mon 9 Nov, 09:30": a fixed date, for records that should not shift with today. */
export const formatDayTime = (date: Date) =>
    `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}${hasTimeOfDay(date) ? `, ${pad(date.getHours())}:${pad(date.getMinutes())}` : ''}`

/** "3 days overdue", "Today, 10:00", "Tomorrow", "Mon 9 Nov". */
export function dueLabel(date: Date | null | undefined, now: Date): string {
    if (!date) return 'No date set'
    const days = daysFromToday(date, now)
    const time = hasTimeOfDay(date) ? `, ${pad(date.getHours())}:${pad(date.getMinutes())}` : ''
    if (days < 0) return `${-days} ${days === -1 ? 'day' : 'days'} overdue`
    if (days === 0) return `Today${time}`
    if (days === 1) return `Tomorrow${time}`
    return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}${time}`
}

export const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6

/** The day itself if it is a weekday, otherwise the Monday after it. */
export const onWorkingDay = (date: Date) => {
    const d = startOfDay(date)
    while (isWeekend(d)) d.setDate(d.getDate() + 1)
    return d
}

/**
 * The quick reschedule choices, never on a weekend: the next working day, and
 * a week from today (moved to the Monday if that falls on a weekend). Each
 * keeps the follow-up's own time of day.
 */
export function rescheduleOptions(current: Date | null | undefined, now: Date): { key: string; label: string; date: Date }[] {
    const withTime = (day: Date) => {
        const d = new Date(day)
        if (current) d.setHours(current.getHours(), current.getMinutes(), 0, 0)
        return d
    }
    const today = startOfDay(now)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const weekOn = new Date(today)
    weekOn.setDate(weekOn.getDate() + 7)
    return [
        { key: 'next', label: 'Next working day', date: withTime(onWorkingDay(tomorrow)) },
        { key: 'week', label: 'In a week', date: withTime(onWorkingDay(weekOn)) }
    ]
}
