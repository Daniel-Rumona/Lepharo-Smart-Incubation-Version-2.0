import React from 'react'
import { Form, Input } from 'antd'
import type { FormInstance } from 'antd'
import MobileAuthShell from '@/components/auth/MobileAuthShell'
import { GoogleMark } from '../login/AuthSheet'

interface MobileRegisterScreenProps {
    form: FormInstance
    busy: boolean
    onFinish: (values: any) => void
    onGoogle: () => void
    onSignIn: () => void
    onBack: () => void
}

const MobileRegisterScreen: React.FC<MobileRegisterScreenProps> = ({
    form,
    busy,
    onFinish,
    onGoogle,
    onSignIn,
    onBack
}) => (
    <MobileAuthShell
        title='Create your account'
        subtitle='Join the Lepharo incubation programme.'
        onBack={onBack}
        footer={
            <>
                Already have an account?{' '}
                <button type='button' className='ml-link' onClick={onSignIn}>
                    Sign in
                </button>
            </>
        }
    >
        <Form
            form={form}
            layout='vertical'
            requiredMark={false}
            onFinish={onFinish}
            className='ml-form ml-rise'
            style={{ animationDelay: '100ms' }}
        >
            <Form.Item
                name='name'
                label='Full name'
                rules={[{ required: true, message: 'Please enter your full name' }]}
            >
                <Input size='large' autoComplete='name' placeholder='Your full name' />
            </Form.Item>

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
                    autoComplete='email'
                    placeholder='you@example.com'
                />
            </Form.Item>

            <Form.Item
                name='password'
                label='Password'
                rules={[
                    { required: true, message: 'Please enter your password' },
                    { min: 6, message: 'Use at least 6 characters' }
                ]}
            >
                <Input.Password
                    size='large'
                    autoComplete='new-password'
                    placeholder='6+ characters'
                />
            </Form.Item>

            <Form.Item
                name='confirmPassword'
                label='Confirm password'
                dependencies={['password']}
                rules={[
                    { required: true, message: 'Please confirm your password' },
                    ({ getFieldValue }) => ({
                        validator(_, value) {
                            if (!value || getFieldValue('password') === value)
                                return Promise.resolve()
                            return Promise.reject(new Error('The two passwords do not match'))
                        }
                    })
                ]}
            >
                <Input.Password
                    size='large'
                    autoComplete='new-password'
                    placeholder='Type it again'
                />
            </Form.Item>

            <button type='submit' className='ml-primary' disabled={busy}>
                Create account
            </button>

            <div className='ml-divider'>or</div>

            <button type='button' className='ml-google' disabled={busy} onClick={onGoogle}>
                <GoogleMark />
                Continue with Google
            </button>
        </Form>
    </MobileAuthShell>
)

export default MobileRegisterScreen
