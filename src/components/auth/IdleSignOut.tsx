import { useEffect, useRef } from 'react'

import { signOutApp } from '@/lib/firestoreCache'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { IDLE_LIMIT_MS, markActive, msUntilIdleLimit } from '@/utils/idleSession'

/**
 * Signs the user out once the app has gone untouched for too long.
 *
 * Sessions persist across launches so the installed app opens straight into
 * work, which means nothing else would ever end them. This is the bound on
 * that -- see src/utils/idleSession.ts for the limit and the reasoning.
 *
 * The stored timestamp is the real mechanism; this component just keeps it
 * fresh and reacts while the app is open. The case where the app is *closed*
 * past the limit is caught on the next launch, in IdentityContext.
 */
export const IdleSignOut = () => {
    const { user } = useFullIdentity()
    const timer = useRef<number | null>(null)
    const signedOut = useRef(false)

    useEffect(() => {
        if (!user?.uid) return

        // Entering the app counts as activity, and starts the clock for sessions
        // that have never had a stamp written.
        markActive(true)

        const expire = async () => {
            if (signedOut.current) return
            signedOut.current = true
            // The explanation rides on the URL rather than a toast: this fires
            // while nobody is watching, and anything rendered here dies with the
            // navigation. The login screen reads the flag and says why.
            await signOutApp('/login?reason=idle')
        }

        const schedule = () => {
            if (timer.current !== null) window.clearTimeout(timer.current)
            const remaining = msUntilIdleLimit()
            if (remaining === 0) {
                void expire()
                return
            }
            // setTimeout saturates past ~24.8 days; the limit is well inside that,
            // but clamp anyway so a longer limit degrades into re-checking rather
            // than firing immediately.
            timer.current = window.setTimeout(schedule, Math.min(remaining, 2_000_000_000))
        }

        const onActivity = () => {
            markActive()
            schedule()
        }

        const onVisibility = () => {
            // Coming back from the background is the moment a stale session is
            // most likely, and the timer may have been throttled while hidden.
            if (document.visibilityState === 'visible') onActivity()
        }

        const events: Array<keyof WindowEventMap> = [
            'mousemove',
            'keydown',
            'click',
            'scroll',
            'touchstart',
        ]
        events.forEach(event => window.addEventListener(event, onActivity, { passive: true }))
        document.addEventListener('visibilitychange', onVisibility)
        schedule()

        return () => {
            events.forEach(event => window.removeEventListener(event, onActivity))
            document.removeEventListener('visibilitychange', onVisibility)
            if (timer.current !== null) window.clearTimeout(timer.current)
        }
    }, [user?.uid])

    return null
}

export default IdleSignOut

/** Exported for the settings/help copy that has to state the limit. */
export const IDLE_LIMIT_DAYS = Math.round(IDLE_LIMIT_MS / (24 * 60 * 60 * 1000))
