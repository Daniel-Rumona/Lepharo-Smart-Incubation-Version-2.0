import React, { useEffect, useRef } from "react"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { auth, db } from "@/firebase"
import { startSession, pingSession, endSession, clearLocalSessionId } from "@/utils/sessionTracking"

export const AuthSessionTracker: React.FC = () => {
    const throttledPingTimer = useRef<number | null>(null)
    const lastPingAt = useRef<number>(0)
    const signedIn = useRef<boolean>(false)

    useEffect(() => {
        const doPingThrottled = () => {
            if (!signedIn.current) return
            if (document.visibilityState !== "visible") return

            const now = Date.now()
            // throttle: at most once per 60s
            if (now - lastPingAt.current < 60_000) return

            lastPingAt.current = now
            pingSession().catch(() => { })
        }

        const onActivity = () => doPingThrottled()
        const onVisibility = () => {
            if (document.visibilityState === "visible") doPingThrottled()
        }

        const onPageHide = () => {
            // Best-effort end. Firestore writes may be throttled by the browser,
            // but this still improves closure rate drastically.
            if (!signedIn.current) return
            endSession("forced").catch(() => { })
        }

        // Attach once
        const activityEvents: Array<keyof WindowEventMap> = [
            "mousemove",
            "keydown",
            "click",
            "scroll",
            "touchstart"
        ]

        activityEvents.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
        document.addEventListener("visibilitychange", onVisibility)
        window.addEventListener("pagehide", onPageHide)
        window.addEventListener("beforeunload", onPageHide)

        const unsub = onAuthStateChanged(auth, async (fbUser) => {
            // user signed out
            if (!fbUser) {
                if (signedIn.current) {
                    await endSession("logout").catch(() => { })
                }
                signedIn.current = false
                clearLocalSessionId()
                return
            }

            signedIn.current = true

            // pull role from users/{uid}
            let role = "unknown"


            try {
                const uSnap = await getDoc(doc(db, "users", fbUser.uid))
                if (uSnap.exists()) {
                    const u = uSnap.data() as any
                    role = String(u.role || "unknown").toLowerCase().replace(/\s+/g, "")
                }
            } catch {
                // keep unknown
            }

            const providerId = fbUser.providerData?.[0]?.providerId || ""
            const provider = providerId.includes("google") ? "google" : "password"

            await startSession({
                uid: fbUser.uid,
                email: fbUser.email,
                role,
                provider
            })

            // immediate ping when session starts
            lastPingAt.current = 0
            doPingThrottled()
        })

        return () => {
            unsub()
            activityEvents.forEach((e) => window.removeEventListener(e, onActivity))
            document.removeEventListener("visibilitychange", onVisibility)
            window.removeEventListener("pagehide", onPageHide)
            window.removeEventListener("beforeunload", onPageHide)

            if (throttledPingTimer.current) {
                window.clearTimeout(throttledPingTimer.current)
                throttledPingTimer.current = null
            }
        }
    }, [])

    return null
}
