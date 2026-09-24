import { useEffect, useMemo, useRef, useState } from 'react'
import { App } from 'antd'
import {
    collection,
    doc,
    limit,
    onSnapshot,
    orderBy,
    query,
    updateDoc,
    where,
    type QuerySnapshot,
} from 'firebase/firestore'

import { db } from '@/firebase'
import { useFullIdentity } from './useFullIdentity'

export type NotificationAction = {
    actionId: string
    label: string
    style?: 'primary' | 'default' | 'danger'
    patch: Record<string, unknown>
}

export type NotificationRecord = {
    id: string
    type?: string
    message?: string | Record<string, string>
    link?: string
    createdAt?: any
    readBy?: Record<string, true>
    actions?: NotificationAction[]
    actionTarget?: { collection: string; docId: string }
    [key: string]: unknown
}

const PAGE_LIMIT = 50

export function resolveNotificationMessage(notif: NotificationRecord, role?: string): string {
    if (typeof notif.message === 'string' && notif.message) return notif.message
    if (notif.message && typeof notif.message === 'object') {
        if (role && notif.message[role]) return notif.message[role]
        const first = Object.values(notif.message).find(Boolean)
        if (first) return String(first)
    }
    return notif.type ? `Update: ${String(notif.type).replace(/[_-]+/g, ' ')}` : 'You have a new notification.'
}

function createdAtMillis(notif: NotificationRecord): number {
    const value: any = notif.createdAt
    if (value?.toMillis) return value.toMillis()
    if (value instanceof Date) return value.getTime()
    return 0
}

/**
 * Live notification center: merges two listeners (Firestore can't OR two
 * array-contains clauses in one query) scoped to the current user's uid and
 * role, de-duplicated by doc id. Also fires a toast for notifications that
 * arrive after mount (not for the initial backlog).
 */
export function useNotificationCenter() {
    const { user } = useFullIdentity()
    const { notification } = App.useApp()
    const [byId, setById] = useState<Record<string, NotificationRecord>>({})
    const toastedIds = useRef<Set<string>>(new Set())

    useEffect(() => {
        if (!user?.uid) {
            setById({})
            return
        }
        toastedIds.current = new Set()
        setById({})

        const role = user.role as string | undefined
        const unsubscribers: Array<() => void> = []

        const makeHandler = () => {
            let ready = false
            return (snap: QuerySnapshot) => {
                const docs: NotificationRecord[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as NotificationRecord)
                setById((prev) => {
                    const next = { ...prev }
                    docs.forEach((d) => { next[d.id] = d })
                    return next
                })

                if (ready) {
                    snap.docChanges().forEach((change) => {
                        if (change.type !== 'added') return
                        const id = change.doc.id
                        if (toastedIds.current.has(id)) return
                        toastedIds.current.add(id)
                        const data = { id, ...change.doc.data() } as NotificationRecord
                        notification.info({
                            message: data.type ? String(data.type).replace(/[_-]+/g, ' ') : 'New notification',
                            description: resolveNotificationMessage(data, role),
                        })
                    })
                }
                ready = true
            }
        }

        unsubscribers.push(
            onSnapshot(
                query(
                    collection(db, 'notifications'),
                    where('recipientIds', 'array-contains', user.uid),
                    orderBy('createdAt', 'desc'),
                    limit(PAGE_LIMIT)
                ),
                makeHandler()
            )
        )

        if (role) {
            unsubscribers.push(
                onSnapshot(
                    query(
                        collection(db, 'notifications'),
                        where('recipientRoles', 'array-contains', role),
                        orderBy('createdAt', 'desc'),
                        limit(PAGE_LIMIT)
                    ),
                    makeHandler()
                )
            )
        }

        return () => unsubscribers.forEach((fn) => fn())
    }, [user?.uid, user?.role, notification])

    const notifications = useMemo(
        () => Object.values(byId).sort((a, b) => createdAtMillis(b) - createdAtMillis(a)).slice(0, PAGE_LIMIT),
        [byId]
    )

    const unreadCount = useMemo(
        () => (user?.uid ? notifications.filter((n) => !n.readBy?.[user.uid]).length : 0),
        [notifications, user?.uid]
    )

    const markAsRead = async (id: string) => {
        if (!user?.uid) return
        try {
            await updateDoc(doc(db, 'notifications', id), { [`readBy.${user.uid}`]: true })
        } catch (error) {
            console.error('Failed to mark notification as read', error)
        }
    }

    const applyAction = async (notif: NotificationRecord, actionId: string) => {
        const action = notif.actions?.find((a) => a.actionId === actionId)
        if (!action || !notif.actionTarget) return
        try {
            await updateDoc(doc(db, notif.actionTarget.collection, notif.actionTarget.docId), action.patch as any)
        } catch (error) {
            console.error('Failed to apply notification action', error)
            return
        }
        await markAsRead(notif.id)
    }

    return {
        notifications,
        unreadCount,
        markAsRead,
        applyAction,
        resolveMessage: (n: NotificationRecord) => resolveNotificationMessage(n, user?.role as string | undefined),
    }
}
