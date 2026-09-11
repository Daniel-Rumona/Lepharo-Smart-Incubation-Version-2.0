import React, { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth'
import { auth } from '@/firebase'
import { Form, Input, Button, Typography, message } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import {
    EyeInvisibleOutlined,
    EyeTwoTone,
    KeyOutlined,
    LoginOutlined,
    ArrowLeftOutlined,
    CheckCircleOutlined
} from '@ant-design/icons'

const { Title, Text } = Typography

export const ResetPasswordPage: React.FC = () => {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const oobCode = searchParams.get('oobCode') || ''
    const [status, setStatus] = useState<
        'checking' | 'invalid' | 'ready' | 'submitting' | 'done'
    >('checking')
    const [email, setEmail] = useState<string | null>(null)
    const [form] = Form.useForm()

    useEffect(() => {
        if (!oobCode) {
            setStatus('invalid')
            return
        }
        verifyPasswordResetCode(auth, oobCode)
            .then(e => {
                setEmail(e)
                setStatus('ready')
            })
            .catch(() => setStatus('invalid'))
    }, [oobCode])

    const onFinish = async (values: { password: string }) => {
        try {
            setStatus('submitting')
            await confirmPasswordReset(auth, oobCode, values.password)
            setStatus('done')
        } catch (e: any) {
            message.error(e?.message || 'Could not reset password.')
            setStatus('ready')
        }
    }

    const Card = ({ children }: { children: React.ReactNode }) => (
        <div
            style={{
                width: 420,
                maxWidth: '92vw',
                background: '#fff',
                borderRadius: 14,
                boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
                padding: 24,
                textAlign: 'center'
            }}
        >
            {children}
        </div>
    )

    const ShadedIcon = ({
        icon,
        bg = 'rgba(15,118,110,0.12)'
    }: {
        icon: React.ReactNode
        bg?: string
    }) => (
        <div
            style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                margin: '0 auto 14px',
                background: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}
        >
            {icon}
        </div>
    )

    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f6f7fb',
                position: 'relative',
                padding: 16
            }}
        >
            <AnimatePresence mode='wait'>
                {status === 'checking' && (
                    <motion.div
                        key='checking'
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        <Card>
                            <ShadedIcon
                                icon={
                                    <KeyOutlined style={{ fontSize: 24, color: '#0f766e' }} />
                                }
                            />
                            <Text>Checking your reset link…</Text>
                        </Card>
                    </motion.div>
                )}

                {status === 'invalid' && (
                    <motion.div
                        key='invalid'
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        <Card>
                            <ShadedIcon
                                icon={
                                    <KeyOutlined style={{ fontSize: 24, color: '#b91c1c' }} />
                                }
                                bg='rgba(185,28,28,0.12)'
                            />
                            <Title level={4} style={{ marginBottom: 6 }}>
                                Link invalid or expired
                            </Title>
                            <Text type='secondary'>
                                Request a fresh reset email and try again.
                            </Text>

                            <div
                                style={{
                                    marginTop: 16,
                                    display: 'flex',
                                    justifyContent: 'center',
                                    gap: 8
                                }}
                            >
                                {/* Primary: takes user to Sign In with reset modal trigger */}
                                <Button
                                    type='primary'
                                    icon={<LoginOutlined />}
                                    onClick={() => navigate('/login?reset=1')}
                                    style={{
                                        background: '#0f766e',
                                        borderColor: '#0f766e',
                                        borderRadius: 10,
                                        fontWeight: 600
                                    }}
                                >
                                    Request new link
                                </Button>
                            </div>
                        </Card>
                    </motion.div>
                )}

                {(status === 'ready' || status === 'submitting') && (
                    <motion.div
                        key='ready'
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        <Card>
                            <ShadedIcon
                                icon={
                                    <KeyOutlined style={{ fontSize: 24, color: '#0f766e' }} />
                                }
                            />
                            <div style={{ marginBottom: 8 }}>
                                <Title level={4} style={{ margin: 0 }}>
                                    Set a new password
                                </Title>
                                <Text type='secondary'>Keep it private, make it strong.</Text>
                                {email && (
                                    <div style={{ marginTop: 4 }}>
                                        <Text type='secondary'>
                                            for <b>{email}</b>
                                        </Text>
                                    </div>
                                )}
                            </div>

                            <Form
                                form={form}
                                layout='vertical'
                                onFinish={onFinish}
                                style={{ textAlign: 'left' }}
                            >
                                <Form.Item
                                    name='password'
                                    label='New password'
                                    rules={[
                                        { required: true, message: 'Enter a password' },
                                        { min: 6, message: 'At least 6 characters' }
                                    ]}
                                >
                                    <Input.Password
                                        placeholder='Enter new password'
                                        size='large'
                                        iconRender={v =>
                                            v ? <EyeTwoTone /> : <EyeInvisibleOutlined />
                                        }
                                    />
                                </Form.Item>

                                <Form.Item
                                    name='confirm'
                                    label='Confirm password'
                                    dependencies={['password']}
                                    hasFeedback
                                    rules={[
                                        { required: true, message: 'Confirm your password' },
                                        ({ getFieldValue }) => ({
                                            validator(_, value) {
                                                if (!value || getFieldValue('password') === value)
                                                    return Promise.resolve()
                                                return Promise.reject(
                                                    new Error('Passwords do not match')
                                                )
                                            }
                                        })
                                    ]}
                                >
                                    <Input.Password
                                        placeholder='Re-enter password'
                                        size='large'
                                        iconRender={v =>
                                            v ? <EyeTwoTone /> : <EyeInvisibleOutlined />
                                        }
                                    />
                                </Form.Item>

                                <Button
                                    type='primary'
                                    htmlType='submit'
                                    block
                                    size='large'
                                    loading={status === 'submitting'}
                                    icon={<KeyOutlined />}
                                    style={{
                                        background: '#0f766e',
                                        borderColor: '#0f766e',
                                        borderRadius: 10,
                                        fontWeight: 600
                                    }}
                                >
                                    Reset password
                                </Button>
                            </Form>

                            <div style={{ marginTop: 12 }}>
                                <Button
                                    type='default'
                                    ghost
                                    icon={<ArrowLeftOutlined />}
                                    onClick={() => navigate('/login')}
                                    style={{ borderRadius: 10 }}
                                >
                                    Back to log in
                                </Button>
                            </div>
                        </Card>
                    </motion.div>
                )}

                {status === 'done' && (
                    <motion.div
                        key='done'
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        <Card>
                            <ShadedIcon
                                icon={
                                    <CheckCircleOutlined
                                        style={{ fontSize: 26, color: '#0f766e' }}
                                    />
                                }
                                bg='rgba(15,118,110,0.12)'
                            />
                            <Title level={3} style={{ marginBottom: 6 }}>
                                All set!
                            </Title>
                            <Text type='secondary'>Your password has been updated.</Text>
                            <div
                                style={{
                                    marginTop: 16,
                                    display: 'flex',
                                    justifyContent: 'center',
                                    gap: 8
                                }}
                            >
                                <Button
                                    type='primary'
                                    icon={<LoginOutlined />}
                                    onClick={() => navigate('/login')}
                                    style={{
                                        background: '#0f766e',
                                        borderColor: '#0f766e',
                                        borderRadius: 10,
                                        fontWeight: 600
                                    }}
                                >
                                    Move on to sign in
                                </Button>
                                <Button
                                    ghost
                                    icon={<ArrowLeftOutlined />}
                                    onClick={() => navigate('/')}
                                    style={{ borderRadius: 10 }}
                                >
                                    Go to home
                                </Button>
                            </div>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Bottom-right QuantO logo with dark background */}
            <div
                style={{
                    position: 'fixed',
                    bottom: 20,
                    right: 20,
                    height: 60,
                    width: 110,
                    zIndex: 9,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    borderRadius: 8,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: 6,
                    boxShadow: '0 6px 18px rgba(0,0,0,0.25)'
                }}
            >
                <img
                    src='/assets/images/QuantilytixO.png'
                    alt='QuantO Logo'
                    style={{ height: '100%', width: '100%', objectFit: 'contain' }}
                />
            </div>
        </div>
    )
}

export default ResetPasswordPage
