import { useCallback, useEffect, useState } from 'react'
import { App } from 'antd'
import { arrayUnion, doc, updateDoc } from 'firebase/firestore'
import { getToken, onMessage } from 'firebase/messaging'

import { db, getMessagingInstance } from '@/firebase'
import { useFullIdentity } from './useFullIdentity'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined

export type PushPermissionState = NotificationPermission | 'unsupported'

/**
 * Resolves the app's active service worker registration, or null.
 *
 * navigator.serviceWorker.ready never rejects and never times out -- in dev,
 * where the worker is disabled, it would hang the caller forever. Bound it so
 * enabling push fails visibly instead of spinning.
 */
async function activeServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null

    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 10_000)),
    ])
}

export function usePushNotifications() {
    const { user } = useFullIdentity()
    const { notification } = App.useApp()
    const [permission, setPermission] = useState<PushPermissionState>(
        typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    )
    const [registering, setRegistering] = useState(false)

    const requestPermission = useCallback(async () => {
        if (typeof window === 'undefined' || typeof Notification === 'undefined') {
            setPermission('unsupported')
            return
        }
        if (!VAPID_KEY) {
            console.warn('VITE_FIREBASE_VAPID_KEY is not configured; push notifications are disabled.')
            return
        }
        if (!user?.uid) return

        setRegistering(true)
        try {
            const messaging = await getMessagingInstance()
            if (!messaging) {
                setPermission('unsupported')
                return
            }

            const result = await Notification.requestPermission()
            setPermission(result)
            if (result !== 'granted') return

            // Push shares the app's one service worker (src/sw.ts) -- registering a
            // second one here would claim the same "/" scope and silently replace it,
            // costing us either push or offline support. UpdatePrompt registers it on
            // mount; we just wait for it to become active.
            const registration = await activeServiceWorker()
            if (!registration) {
                console.warn('No active service worker; push notifications are unavailable.')
                return
            }

            const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
            if (token) {
                await updateDoc(doc(db, 'users', user.uid), { fcmTokens: arrayUnion(token) })
            }
        } catch (error) {
            console.error('Failed to enable push notifications', error)
        } finally {
            setRegistering(false)
        }
    }, [user?.uid])

    useEffect(() => {
        let unsubscribe: (() => void) | undefined

        getMessagingInstance().then(messaging => {
            if (!messaging) return
            unsubscribe = onMessage(messaging, payload => {
                notification.info({
                    message: payload.notification?.title || 'Notification',
                    description: payload.notification?.body
                })
            })
        })

        return () => unsubscribe?.()
    }, [notification])

    return { permission, registering, requestPermission }
}
