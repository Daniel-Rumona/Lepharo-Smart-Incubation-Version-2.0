import React, { useEffect, useState } from 'react'
import { Button, Form, Input, message } from 'antd'
import { WhatsAppOutlined } from '@ant-design/icons'
import type { User } from 'firebase/auth'
import {
    phoneLoginError,
    registerWithPhoneCode,
    requestPhoneCode,
    signInWithPhoneCode
} from '@/services/phoneLogin'

/**
 * Phone + WhatsApp code, for SMEs who sign in or register without an email
 * (docs/sme-identity-migration-plan.md, Phase 5). Step one asks for the number,
 * step two for the six-digit code (and, when registering, a name). `variant`
 * picks the desktop (AuthShell) or mobile (MobileAuthShell) look.
 */
type Props = {
    mode: 'login' | 'register'
    variant: 'desktop' | 'mobile'
    onSignedIn: (user: User) => void | Promise<void>
    onCancel: () => void
}

const RESEND_SECONDS = 60

const PhoneCodeForm: React.FC<Props> = ({ mode, variant, onSignedIn, onCancel }) => {
    const [form] = Form.useForm()
    const [phone, setPhone] = useState('')
    const [step, setStep] = useState<'phone' | 'code'>('phone')
    const [busy, setBusy] = useState(false)
    const [resendIn, setResendIn] = useState(0)

    useEffect(() => {
        if (resendIn <= 0) return
        const timer = window.setTimeout(() => setResendIn(value => value - 1), 1000)
        return () => window.clearTimeout(timer)
    }, [resendIn])

    const sendCode = async (number: string) => {
        setBusy(true)
        try {
            await requestPhoneCode(number, mode)
            setPhone(number)
            setStep('code')
            setResendIn(RESEND_SECONDS)
        } catch (error) {
            message.error(phoneLoginError(error))
        } finally {
            setBusy(false)
        }
    }

    const submitCode = async (values: { code: string; name?: string }) => {
        setBusy(true)
        try {
            const user = mode === 'login'
                ? await signInWithPhoneCode(phone, values.code)
                : await registerWithPhoneCode(phone, values.code, values.name || '')
            await onSignedIn(user)
        } catch (error) {
            message.error(phoneLoginError(error))
        } finally {
            setBusy(false)
        }
    }

    const mobile = variant === 'mobile'
    const linkClass = mobile ? 'ml-link' : 'as-link'
    const primary = (label: string) => mobile
        ? <button type='submit' className='ml-primary' disabled={busy}>{busy ? 'Please wait…' : label}</button>
        : <Button type='primary' htmlType='submit' size='large' block loading={busy}>{label}</Button>

    if (step === 'phone') {
        return (
            <Form
                form={form}
                layout='vertical'
                requiredMark={false}
                className={mobile ? 'ml-form' : undefined}
                onFinish={(values: { phone: string }) => void sendCode(values.phone)}
            >
                <Form.Item
                    name='phone'
                    label='Mobile number (WhatsApp)'
                    extra={mode === 'login'
                        ? "We'll send a sign-in code on WhatsApp if this number is registered."
                        : "We'll send a code on WhatsApp to confirm the number."}
                    rules={[
                        { required: true, message: 'Please enter your mobile number' },
                        { pattern: /^[+\d][\d\s()-]{8,}$/, message: 'Enter a valid mobile number, e.g. 082 123 4567' }
                    ]}
                >
                    <Input
                        size='large'
                        type='tel'
                        inputMode='tel'
                        autoComplete='tel'
                        placeholder='082 123 4567'
                        prefix={<WhatsAppOutlined />}
                        autoFocus={!mobile}
                    />
                </Form.Item>
                <Form.Item style={{ marginBottom: 12 }}>{primary('Send code')}</Form.Item>
                <button type='button' className={linkClass} onClick={onCancel}>
                    {mode === 'login' ? 'Use email instead' : 'Register with email instead'}
                </button>
            </Form>
        )
    }

    return (
        <Form
            form={form}
            layout='vertical'
            requiredMark={false}
            className={mobile ? 'ml-form' : undefined}
            onFinish={values => void submitCode(values)}
        >
            <p className={mobile ? undefined : 'as-sub'} style={{ marginBottom: 12 }}>
                Enter the 6-digit code we sent on WhatsApp to <strong>{phone}</strong>.
            </p>
            {mode === 'register' && (
                <Form.Item
                    name='name'
                    label='Your name'
                    rules={[{ required: true, message: 'Please enter your name' }]}
                >
                    <Input size='large' autoComplete='name' placeholder='Full name' />
                </Form.Item>
            )}
            <Form.Item
                name='code'
                label='Code'
                rules={[
                    { required: true, message: 'Please enter the code' },
                    { pattern: /^\d{6}$/, message: 'The code is 6 digits' }
                ]}
            >
                <Input
                    size='large'
                    inputMode='numeric'
                    autoComplete='one-time-code'
                    maxLength={6}
                    placeholder='123456'
                    autoFocus={!mobile}
                />
            </Form.Item>
            <Form.Item style={{ marginBottom: 12 }}>
                {primary(mode === 'login' ? 'Sign in' : 'Create account')}
            </Form.Item>
            <button
                type='button'
                className={linkClass}
                disabled={busy || resendIn > 0}
                onClick={() => void sendCode(phone)}
            >
                {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
            </button>
            <span aria-hidden='true'> · </span>
            <button type='button' className={linkClass} onClick={() => { form.resetFields(); setStep('phone') }}>
                Change number
            </button>
        </Form>
    )
}

export default PhoneCodeForm
