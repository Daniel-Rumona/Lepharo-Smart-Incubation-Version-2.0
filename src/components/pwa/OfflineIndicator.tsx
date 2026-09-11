import { useEffect, useState } from 'react'
import { Tag, Tooltip } from 'antd'
import { CloudOutlined, DisconnectOutlined } from '@ant-design/icons'

/**
 * Shows a badge whenever the browser has no connection.
 *
 * With the Firestore cache on, an offline app looks almost normal: screens
 * render, forms submit, nothing errors. What it cannot do is show data it never
 * loaded, so a screen the user has not visited before comes up empty rather than
 * failing. Without a visible offline state that reads as "there are no records",
 * which is a different and much worse message.
 *
 * This is a floor, not a substitute for per-screen handling -- lists that can be
 * legitimately empty still need to say "nothing cached yet" rather than "none".
 */
export const OfflineIndicator = () => {
    const [online, setOnline] = useState(() =>
        typeof navigator === 'undefined' ? true : navigator.onLine,
    )

    useEffect(() => {
        const goOnline = () => setOnline(true)
        const goOffline = () => setOnline(false)
        window.addEventListener('online', goOnline)
        window.addEventListener('offline', goOffline)
        return () => {
            window.removeEventListener('online', goOnline)
            window.removeEventListener('offline', goOffline)
        }
    }, [])

    if (online) return null

    return (
        <Tooltip
            title="Showing data saved on this device. Anything you save is queued and will sync when you reconnect."
            placement="left"
        >
            <Tag
                icon={<DisconnectOutlined />}
                color="warning"
                style={{
                    position: 'fixed',
                    // Clear of antd's notification stack, which sits top-right.
                    bottom: 16,
                    right: 16,
                    zIndex: 1050,
                    margin: 0,
                    padding: '5px 11px',
                    borderRadius: 999,
                    fontWeight: 500,
                    boxShadow: '0 2px 10px rgba(0, 0, 0, .18)',
                }}
            >
                Offline &mdash; showing saved data
            </Tag>
        </Tooltip>
    )
}

export default OfflineIndicator

/**
 * Unused here, but the piece every screen-level fix needs: Firestore tags each
 * snapshot with whether it came from the local cache. Pair it with an empty
 * result to tell "there are genuinely no records" apart from "this device has
 * never loaded these records".
 *
 *   const snap = await getDocs(q)
 *   if (snap.empty && snap.metadata.fromCache) // not loaded yet, not empty
 *
 * onSnapshot callers get the same flag, and will be called a second time with
 * fromCache: false once the server responds.
 */
export const isUnloaded = (snapshot: {
    empty: boolean
    metadata: { fromCache: boolean }
}) => snapshot.empty && snapshot.metadata.fromCache
