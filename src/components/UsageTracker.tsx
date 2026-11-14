import React, { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { useIdentity } from "@/contexts/IdentityContext"
import {
    captureClick,
    endVisit,
    flushVisit,
    maybeFlushVisit,
    noteInput,
    noteVisibility,
    startVisit,
} from "@/utils/usageTracking"

/** Records page visits, active time and clicks for signed-in users (see utils/usageTracking.ts). */
export const UsageTracker: React.FC = () => {
    const { pathname } = useLocation()
    const { actor, viewedUser, isViewingAs } = useIdentity()

    const uid = actor?.uid

    // A new visit per page, and none while signed out.
    useEffect(() => {
        if (!actor) return
        startVisit(
            {
                uid: actor.uid,
                email: actor.email,
                name: actor.name,
                role: actor.role,
                viewingAsUid: isViewingAs ? viewedUser?.uid ?? null : null,
            },
            pathname
        )
        return () => endVisit()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uid, pathname, isViewingAs])

    useEffect(() => {
        const inputEvents: Array<keyof WindowEventMap> = ["mousemove", "keydown", "click", "scroll", "touchstart"]
        const onVisibility = () => {
            const shown = document.visibilityState === "visible"
            noteVisibility(shown)
            // Save on the way out: a hidden tab may never come back.
            if (!shown) flushVisit()
        }
        const onPageHide = () => endVisit()
        const timer = window.setInterval(maybeFlushVisit, 15_000)

        inputEvents.forEach(e => window.addEventListener(e, noteInput, { passive: true }))
        document.addEventListener("click", captureClick, true)
        document.addEventListener("visibilitychange", onVisibility)
        window.addEventListener("pagehide", onPageHide)

        return () => {
            window.clearInterval(timer)
            inputEvents.forEach(e => window.removeEventListener(e, noteInput))
            document.removeEventListener("click", captureClick, true)
            document.removeEventListener("visibilitychange", onVisibility)
            window.removeEventListener("pagehide", onPageHide)
        }
    }, [])

    return null
}
