import React, { useState } from 'react'
import { Modal, Form, Input, message } from 'antd'
import { auth } from '@/firebase'

interface AdminPasswordResetModalProps {
    visible: boolean
    onClose: () => void
    userId: string | null
}


const FUNCTIONS_BASE = `https://us-central1-lph-smart-inc.cloudfunctions.net`
const ENDPOINT = `${FUNCTIONS_BASE}/adminResetUserPassword`

const AdminPasswordResetModal: React.FC<AdminPasswordResetModalProps> = ({
    visible,
    onClose,
    userId
}) => {
    const [form] = Form.useForm()
    const [submitting, setSubmitting] = useState(false)

    const handleReset = async () => {
        try {
            if (!userId) {
                message.error('User ID not found.')
                return
            }

            const { newPassword } = await form.validateFields()

            const currentUser = auth.currentUser
            if (!currentUser) {
                message.error('You must be signed in to perform this action.')
                return
            }

            setSubmitting(true)
            const idToken = await currentUser.getIdToken(/* forceRefresh */ true)

            const resp = await fetch(ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    uid: userId,
                    newPassword, // admin-set password
                    mode: 'set', // ensure we’re using the “set temp password” path
                    sendEmail: false // we’re not emailing the password; UI handles comms
                })
            })

            const data = await resp.json().catch(() => ({}))
            if (!resp.ok || data?.ok === false) {
                const errMsg =
                    data?.detail || data?.error || `Request failed with ${resp.status}`
                throw new Error(errMsg)
            }

            message.success('Password reset successfully.')
            form.resetFields()
            onClose()
        } catch (error: any) {
            console.error('Password reset error:', error)
            message.error(error?.message || 'Failed to reset password.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal
            title='Admin Password Reset'
            open={visible}
            onCancel={() => {
                onClose()
                form.resetFields()
            }}
            onOk={handleReset}
            confirmLoading={submitting}
            okText='Reset Password'
            destroyOnClose
            centered
        >
            <Form form={form} layout='vertical' preserve={false}>
                <Form.Item
                    name='newPassword'
                    label='New Password'
                    rules={[
                        { required: true, message: 'Please enter a new password' },
                        { min: 6, message: 'Password must be at least 6 characters' }
                    ]}
                >
                    <Input.Password placeholder='Enter new password' autoFocus />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default AdminPasswordResetModal
