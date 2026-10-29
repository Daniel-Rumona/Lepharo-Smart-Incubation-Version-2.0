import React, { useState } from 'react'
import { Form, Input } from 'antd'
import type { FormInstance } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import MobileAuthShell from '@/components/auth/MobileAuthShell'
import { GoogleMark } from './AuthSheet'

interface MobileLoginScreenProps {
    form: FormInstance
    onFinish: (values: { email: string; password: string }) => void
    onGoogle: () => void
    onForgotPassword: () => void
    onHowTo: () => void
    onSignUp: () => void
    onBack: () => void
}

const MobileLoginScreen: React.FC<MobileLoginScreenProps> = ({
    form,
    onFinish,
    onGoogle,
    onForgotPassword,
    onHowTo,
    onSignUp,
    onBack
}) => {
    const [capsLockOn, setCapsLockOn] = useState(false)
    // Caps Lock is the usual culprit behind a "wrong password" that isn't.
    // Mostly matters for phones with a hardware keyboard or tablets.
    const syncCapsLock = (e: React.KeyboardEvent) =>
        setCapsLockOn(e.getModifierState?.('CapsLock') ?? false)

    return (
        <MobileAuthShell
            title='Welcome back'
            subtitle='Sign in to continue to Lepharo Smart Incubation.'
            onBack={onBack}
            footer={
                <>
                    Don't have an account?{' '}
                    <button type='button' className='ml-link' onClick={onSignUp}>
                        Sign up
                    </button>
                    <span className='ml-footer-line'>
                        <button type='button' className='ml-link' onClick={onHowTo}>
                            How to get access
                        </button>
                    </span>
                </>
            }
        >
            {/* No autofocus here, unlike desktop: on a phone it throws the
                keyboard over the page before the user has seen it. */}
            <Form
                form={form}
                layout='vertical'
                requiredMark={false}
                onFinish={onFinish}
                className='ml-form ml-rise'
                style={{ animationDelay: '100ms' }}
            >
                <Form.Item
                    name='email'
                    label='Email'
                    rules={[
                        { required: true, message: 'Please enter your email' },
                        { type: 'email', message: 'Enter a valid email' }
                    ]}
                >
                    <Input
                        size='large'
                        type='email'
                        inputMode='email'
                        autoComplete='username'
                        placeholder='you@example.com'
                    />
                </Form.Item>

                <div className='ml-field-with-link'>
                    <Form.Item
                        name='password'
                        label='Password'
                        rules={[{ required: true, message: 'Please enter your password' }]}
                        extra={
                            capsLockOn ? (
                                <span className='ml-caps' role='status'>
                                    <WarningOutlined /> Caps Lock is on
                                </span>
                            ) : undefined
                        }
                    >
                        <Input.Password
                            size='large'
                            autoComplete='current-password'
                            placeholder='Enter your password'
                            onKeyDown={syncCapsLock}
                            onKeyUp={syncCapsLock}
                            onBlur={() => setCapsLockOn(false)}
                        />
                    </Form.Item>
                    <button
                        type='button'
                        className='ml-link ml-field-link'
                        onClick={onForgotPassword}
                    >
                        Forgot password?
                    </button>
                </div>

                <button type='submit' className='ml-primary'>
                    Sign in
                </button>

                <div className='ml-divider'>or</div>

                <button type='button' className='ml-google' onClick={onGoogle}>
                    <GoogleMark />
                    Continue with Google
                </button>
            </Form>
        </MobileAuthShell>
    )
}

export default MobileLoginScreen
