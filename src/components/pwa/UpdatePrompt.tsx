import { useEffect, useRef, useState } from 'react'
import { App, Button, Modal, Typography } from 'antd'
import { ReloadOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useRegisterSW } from 'virtual:pwa-register/react'

const { Text } = Typography

/**
 * Registers the service worker and prompts before applying an update.
 *
 * The worker uses registerType: "prompt", so a new version installs and waits
 * until the user chooses to reload.
 */
export const UpdatePrompt = () => {
    const { message } = App.useApp()

    const announced = useRef(false)

    const [updateModalOpen, setUpdateModalOpen] = useState(false)
    const [updating, setUpdating] = useState(false)

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
        setUpdateModalOpen(true)
    }, [needRefresh])

    useEffect(() => {
        if (!offlineReady) return

        message.success('Ready to work offline')
        setOfflineReady(false)
    }, [offlineReady, setOfflineReady, message])

    const handleReload = async () => {
        try {
            setUpdating(true)
            await updateServiceWorker(true)
        } catch (error) {
            console.error('Failed to apply application update', error)
            message.error('Could not apply the update. Please try again.')
            setUpdating(false)
        }
    }

    const handleLater = () => {
        setUpdateModalOpen(false)
    }

    return (
        <Modal
            open={updateModalOpen}
            centered
            closable={false}
            keyboard={false}
            mask={{ closable: false }}
            width={460}
            title="A new version is available"
            onCancel={handleLater}
            footer={
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 10,
                        width: '100%',
                    }}
                >
                    <Button
                        block
                        shape="round"
                        icon={<ClockCircleOutlined />}
                        disabled={updating}
                        onClick={handleLater}
                    >
                        Later
                    </Button>

                    <Button
                        block
                        type="primary"
                        shape="round"
                        icon={<ReloadOutlined />}
                        loading={updating}
                        onClick={handleReload}
                    >
                        Reload
                    </Button>
                </div>
            }
            styles={{
                body: {
                    paddingTop: 4,
                    paddingBottom: 8,
                },
                footer: {
                    marginTop: 20,
                },
            }}
        >
            <Text type="secondary">
                Reload to pick up the latest changes. Anything unsaved on
                screen will be lost.
            </Text>
        </Modal>
    )
}

export default UpdatePrompt
