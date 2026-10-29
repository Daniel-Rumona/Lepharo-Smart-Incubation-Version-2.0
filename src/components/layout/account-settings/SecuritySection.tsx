import React, { useState } from 'react'
import { Button, Form, Input, Tag, message } from 'antd'
import { EditOutlined, LockOutlined } from '@ant-design/icons'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { auth } from '@/firebase'
import { SectionHead, SectionLayout } from './SectionLayout'

const isStrongPassword = (value: string) =>
    /[A-Z]/.test(value) && /[a-z]/.test(value) && /[^A-Za-z]/.test(value)

export const SecuritySection: React.FC = () => {
    const [form] = Form.useForm()
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)

    const passwordProviderEnabled =
        auth.currentUser?.providerData?.some(provider => provider.providerId === 'password') ?? false

    const cancel = () => {
        form.resetFields()
        setEditing(false)
    }

    const handleSave = async () => {
        try {
            const values = await form.validateFields()
            const user = auth.currentUser
            if (!user?.email) throw new Error('No authenticated email account found.')

            setSaving(true)
            await reauthenticateWithCredential(
                user,
                EmailAuthProvider.credential(user.email, values.currentPassword)
            )
            await updatePassword(user, values.newPassword)

            message.success('Password updated.')
            cancel()
        } catch (error: any) {
            if (error?.errorFields) return
            console.error(error)
            if (error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password') {
                message.error('Your current password is incorrect.')
                return
            }
            message.error(error?.message || 'Failed to update password.')
        } finally {
            setSaving(false)
        }
    }

    if (editing) {
        return (
            <SectionLayout
                footer={
                    <>
                        <Button size='large' disabled={saving} onClick={cancel}>
                            Cancel
                        </Button>
                        <Button size='large' type='primary' loading={saving} onClick={handleSave}>
                            Update password
                        </Button>
                    </>
                }
            >
                <SectionHead
                    title='Change password'
                    sub='Enter your current password before setting a new one.'
                />
                <Form form={form} layout='vertical' onFinish={handleSave}>
                    <Form.Item
                        label='Current password'
                        name='currentPassword'
                        rules={[{ required: true, message: 'Enter your current password' }]}
                    >
                        <Input.Password size='large' autoComplete='current-password' autoFocus />
                    </Form.Item>

                    <div className='acs-grid-2' style={{ gap: '0 16px' }}>
                        <Form.Item
                            label='New password'
                            name='newPassword'
                            rules={[
                                { required: true, message: 'Enter a new password' },
                                { min: 8, message: 'Use at least 8 characters' },
                                {
                                    validator: (_, value) =>
                                        !value || isStrongPassword(value)
                                            ? Promise.resolve()
                                            : Promise.reject(
                                                new Error('Use uppercase, lowercase and a number or symbol')
                                            )
                                }
                            ]}
                        >
                            <Input.Password size='large' autoComplete='new-password' />
                        </Form.Item>

                        <Form.Item
                            label='Confirm new password'
                            name='confirmPassword'
                            dependencies={['newPassword']}
                            rules={[
                                { required: true, message: 'Confirm your new password' },
                                ({ getFieldValue }) => ({
                                    validator: (_, value) =>
                                        !value || getFieldValue('newPassword') === value
                                            ? Promise.resolve()
                                            : Promise.reject(new Error('Passwords do not match'))
                                })
                            ]}
                        >
                            <Input.Password size='large' autoComplete='new-password' />
                        </Form.Item>
                    </div>

                    <div className='acs-note' style={{ marginTop: 0 }}>
                        <ul>
                            <li>At least 8 characters</li>
                            <li>Uppercase and lowercase letters</li>
                            <li>At least one number or symbol</li>
                        </ul>
                    </div>
                </Form>
            </SectionLayout>
        )
    }

    return (
        <SectionLayout>
            <div className='acs-row' style={{ marginTop: 0 }}>
                <span className='acs-row-main'>
                    <span className='acs-tile'>
                        <LockOutlined />
                    </span>
                    <span>
                        <span className='acs-label'>Password</span>
                        <span className='acs-hint'>Change your account password.</span>
                    </span>
                </span>
                {passwordProviderEnabled ? (
                    <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                        Change password
                    </Button>
                ) : (
                    <Tag>Managed externally</Tag>
                )}
            </div>

            {!passwordProviderEnabled && (
                <div className='acs-note'>
                    Your password is managed by the provider you use to sign in, such as Google.
                </div>
            )}
        </SectionLayout>
    )
}

export default SecuritySection
