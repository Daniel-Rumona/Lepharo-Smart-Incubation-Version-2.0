import dayjs from 'dayjs'

/** Session records (src/utils/sessionTracking.ts) turned into per-person and per-day activity. */

export type SessionDoc = {
    uid?: string
    email?: string | null
    role?: string
    startedAt?: any
    lastSeenAt?: any
    endedAt?: any
    endReason?: string
}

export type Session = {
    personId: string
    email: string
    role: string
    started: number
    lastSeen: number | null
    ended: number | null
    minutes: number
}

export type Person = {
    id: string
    email: string
    name: string
    team: string
    photo?: string
    roles: string[]
    active: boolean
    lastSeen: number | null
    lastStarted: number | null
    sessionsToday: number
    sessions: number
    minutes: number
}

/** A person counts as active now if they did something in the last 10 minutes. */
export const ACTIVE_WINDOW_MS = 10 * 60 * 1000

/**
 * Longest a single session can count for. Older sessions recorded the time a
 * tab was finally closed as their last activity, so a tab left open for days
 * would otherwise read as days of use.
 */
const MAX_SESSION_MINUTES = 12 * 60

export const toMs = (v: any): number | null => {
    if (!v) return null
    if (typeof v?.toMillis === 'function') return v.toMillis()
    if (typeof v?.toDate === 'function') return v.toDate().getTime()
    if (v instanceof Date) return v.getTime()
    const n = new Date(v).getTime()
    return Number.isNaN(n) ? null : n
}

export const toSession = (raw: SessionDoc): Session | null => {
    const started = toMs(raw.startedAt)
    if (!started) return null
    const email = String(raw.email || '').trim().toLowerCase()
    const lastSeen = toMs(raw.lastSeenAt)
    const ended = toMs(raw.endedAt)
    // Last activity, not the moment the tab closed.
    const until = lastSeen ?? ended ?? started
    return {
        personId: String(raw.uid || email || 'unknown'),
        email,
        role: String(raw.role || '').trim().toLowerCase(),
        started,
        lastSeen,
        ended,
        minutes: Math.min(MAX_SESSION_MINUTES, Math.max(0, Math.round((until - started) / 60000)))
    }
}

export const isActiveNow = (s: Session, now: number) =>
    !s.ended && !!s.lastSeen && now - s.lastSeen <= ACTIVE_WINDOW_MS

/** Local calendar day (not UTC), so late-evening sessions land on the right day. */
export const dayKey = (ms: number) => dayjs(ms).format('YYYY-MM-DD')

export const summarise = (sessions: Session[], now: number) => {
    const people = new Set(sessions.map(s => s.personId))
    const minutes = sessions.reduce((sum, s) => sum + s.minutes, 0)
    return {
        people: people.size,
        activeNow: new Set(sessions.filter(s => isActiveNow(s, now)).map(s => s.personId)).size,
        sessions: sessions.length,
        minutes,
        avgMinutes: sessions.length ? minutes / sessions.length : 0
    }
}

export const buildPeople = (
    sessions: Session[],
    lookup: (personId: string, email: string) => { name: string; team: string; photo?: string },
    now: number
): Person[] => {
    const todayStart = dayjs(now).startOf('day').valueOf()
    const byId = new Map<string, Person>()
    sessions.forEach(s => {
        let p = byId.get(s.personId)
        if (!p) {
            const info = lookup(s.personId, s.email)
            p = {
                id: s.personId,
                email: s.email,
                name: info.name || s.email || 'Unknown user',
                team: info.team,
                photo: info.photo,
                roles: [],
                active: false,
                lastSeen: null,
                lastStarted: null,
                sessionsToday: 0,
                sessions: 0,
                minutes: 0
            }
            byId.set(s.personId, p)
        }
        if (s.role && !p.roles.includes(s.role)) p.roles.push(s.role)
        if (isActiveNow(s, now)) p.active = true
        const seen = s.lastSeen ?? s.started
        if (!p.lastSeen || seen > p.lastSeen) p.lastSeen = seen
        if (!p.lastStarted || s.started > p.lastStarted) p.lastStarted = s.started
        if (s.started >= todayStart) p.sessionsToday += 1
        p.sessions += 1
        p.minutes += s.minutes
    })
    return Array.from(byId.values())
}

/** One entry per day in the window: people active and hours logged. */
export const dailySeries = (sessions: Session[], days: number, now: number) => {
    const keys = Array.from({ length: days }, (_, i) => dayKey(dayjs(now).subtract(days - 1 - i, 'day').valueOf()))
    const people = new Map(keys.map(k => [k, new Set<string>()]))
    const minutes = new Map(keys.map(k => [k, 0]))
    sessions.forEach(s => {
        const k = dayKey(s.started)
        if (!people.has(k)) return
        people.get(k)!.add(s.personId)
        minutes.set(k, (minutes.get(k) || 0) + s.minutes)
    })
    return keys.map(k => ({ key: k, people: people.get(k)!.size, hours: Math.round(((minutes.get(k) || 0) / 60) * 10) / 10 }))
}

export const formatDuration = (mins: number) => {
    const m = Math.round(mins || 0)
    const h = Math.floor(m / 60)
    return h ? `${h}h ${m % 60}m` : `${m}m`
}

export const formatAgo = (ms: number | null, now: number) => {
    if (!ms) return '—'
    const mins = Math.round((now - ms) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    return days < 30 ? `${days}d ago` : dayjs(ms).format('D MMM YYYY')
}
