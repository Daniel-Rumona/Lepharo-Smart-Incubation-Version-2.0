import { useEffect, useRef } from 'react'
import { App } from 'antd'
import { useRegisterSW } from 'virtual:pwa-register/react'

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
    const { modal, message } = App.useApp()
    // A corner notification is easy to miss; a centered modal forces the
    // choice. Guard against re-announcing one the user already dismissed.
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

        modal.confirm({
            title: 'A new version is available',
            content: 'Reload to pick up the latest changes. Anything unsaved on screen will be lost.',
            centered: true,
            okText: 'Reload',
            cancelText: 'Later',
            onOk: () => updateServiceWorker(true),
        })
    }, [needRefresh, modal, updateServiceWorker])

    useEffect(() => {
        if (!offlineReady) return
        message.success('Ready to work offline')
        setOfflineReady(false)
    }, [offlineReady, setOfflineReady, message])

    return null
}

export default UpdatePrompt
