/**
 * Bounds how long a signed-in session can sit idle.
 *
 * Auth persists across app launches (see src/firebase.ts) so the installed PWA
 * opens straight into the app and works offline. The cost of that is a session
 * that would otherwise last forever, which is the wrong answer for a lost or
 * stolen phone. This puts a ceiling on it.
 *
 * The clock is stored, not held in memory, because the point is to catch the app
 * being *closed* for a long stretch -- an in-memory timer dies with the tab and
 * would never fire.
 */

const LAST_ACTIVE_KEY = 'lph-last-active'

/**
 * Fourteen days. Long enough that an incubatee who opens the app every week or
 * two is never logged out mid-task, short enough to bound a lost device. Shorten
 * it (7 days, or 12 hours) if the compliance posture calls for it -- everything
 * downstream reads this constant.
 *
 * Note this is a ceiling on *inactivity*, not on session length: any interaction
 * pushes it back.
 */
export const IDLE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000

/** Writing on every mousemove would hammer localStorage; once a minute is plenty. */
const WRITE_THROTTLE_MS = 60_000

let lastWrite = 0

const read = (): number | null => {
    try {
        const raw = window.localStorage.getItem(LAST_ACTIVE_KEY)
        const value = raw ? Number(raw) : NaN
        return Number.isFinite(value) ? value : null
    } catch {
        return null
    }
}

/** Records that the user is here. Safe to call on every input event. */
export const markActive = (force = false): void => {
    if (typeof window === 'undefined') return
    const now = Date.now()
    if (!force && now - lastWrite < WRITE_THROTTLE_MS) return
    lastWrite = now
    try {
        window.localStorage.setItem(LAST_ACTIVE_KEY, String(now))
    } catch {
        /* storage unavailable -- the session simply is not idle-bounded */
    }
}

export const clearActivity = (): void => {
    lastWrite = 0
    try {
        window.localStorage.removeItem(LAST_ACTIVE_KEY)
    } catch {
        /* nothing to clean up */
    }
}

/** Milliseconds until the session goes stale, or 0 if it already has. */
export const msUntilIdleLimit = (): number => {
    const last = read()
    // No stamp yet means this session just started; give it a full window.
    if (last === null) return IDLE_LIMIT_MS
    return Math.max(0, last + IDLE_LIMIT_MS - Date.now())
}

/**
 * True when the app has gone untouched past the limit -- typically because it
 * was closed for a fortnight, which is exactly the case an in-app timer misses.
 */
export const isSessionStale = (): boolean => read() !== null && msUntilIdleLimit() === 0
