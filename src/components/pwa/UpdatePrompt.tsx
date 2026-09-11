import { useEffect, useRef } from 'react'
import { App, Button, Space } from 'antd'
import { useRegisterSW } from 'virtual:pwa-register/react'

const UPDATE_KEY = 'pwa-update-available'

/**
 * Registers the service worker and asks before applying an update.
 *
 * A cached SPA will otherwise serve a stale build indefinitely, which shows up
 * as bug reports for bugs that were already fixed. The worker is registered with
 * registerType: "prompt", so a new version installs and then waits -- this is
 * what lets it through, and only when the user says so, since reloading
 * discards anything half-typed on screen.
 */
export const UpdatePrompt = () => {
    const { notification, message } = App.useApp()
    // Notifications are dismissible; without this a re-render would re-open one
    // the user just closed.
    const announced = useRef(false)

    const {
        needRefresh: [needRefresh],
        offlineReady: [offlineReady, setOfflineReady],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisterError(error) {
            console.error('Service worker registration failed', error)
        },
    })

    useEffect(() => {
        if (!needRefresh || announced.current) return
        announced.current = true

        notification.info({
            key: UPDATE_KEY,
            message: 'A new version is available',
            description: 'Reload to pick up the latest changes. Anything unsaved on screen will be lost.',
            duration: 0,
            btn: (
                <Space>
                    <Button size="small" onClick={() => notification.destroy(UPDATE_KEY)}>
                        Later
                    </Button>
                    <Button size="small" type="primary" onClick={() => updateServiceWorker(true)}>
                        Reload
                    </Button>
                </Space>
            ),
        })
    }, [needRefresh, notification, updateServiceWorker])

    useEffect(() => {
        if (!offlineReady) return
        message.success('Ready to work offline')
        setOfflineReady(false)
    }, [offlineReady, setOfflineReady, message])

    return null
}

export default UpdatePrompt
