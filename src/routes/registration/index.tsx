import React, { useEffect, useState } from 'react'
import { GoogleOutlined } from '@ant-design/icons'
import { Button, Form, Input, Grid, message } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from 'firebase/auth'
import { auth, db } from '@/firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { motion } from 'framer-motion'
import MobileRegisterScreen from './MobileRegisterScreen'
import { AuthShell } from '@/components/auth/AuthShell'
import { DashboardLoader } from '@/components/layout/DashboardLoader'

const { useBreakpoint } = Grid

// --- Friendly Firebase error messages (signup / google) ---
function formatFirebaseError(error: any) {
    const code = String(error?.code || '').toLowerCase()
    const M: Record<string, string> = {
        'auth/email-already-in-use':
            'This email is already in use. Try logging in.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/network-request-failed': 'Network error. Check your connection.',
        'auth/popup-closed-by-user': 'The sign-up window was closed early.',
        'auth/cancelled-popup-request':
            'Another Google window is already open. Use the latest one.',
        'auth/popup-blocked':
            'Your browser blocked the window. Allow pop-ups and try again.',
        'auth/operation-not-allowed':
            'This sign-in method is not enabled. Please contact support.',
        'auth/credential-already-in-use':
            'Those sign-in details are already linked to another account.',
        'auth/account-exists-with-different-credential':
            'An account already exists with this email using a different method. Sign in with email/password, then link Google in your profile.'
    }
    if (M[code]) return M[code]
    if (code.includes('network')) return M['auth/network-request-failed']
    return error?.message || 'Registration failed. Please try again.'
}

const RegisterPageContent: React.FC = () => {
    const [form] = Form.useForm()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const [searchParams] = useSearchParams()
    const code = searchParams.get('code') || ''
    const [isPanelEntering, setIsPanelEntering] = useState(
        searchParams.get('flip') === '1'
    )

    const [loading, setLoading] = useState(false)
    const [googleLoading, setGoogleLoading] = useState(false)
    const [redirecting, setRedirecting] = useState(false)
    const [isLeavingForLogin, setIsLeavingForLogin] = useState(false)

    useEffect(() => {
        document.title = 'Register | Smart Incubation Platform'
    }, [])

    useEffect(() => {
        if (!isPanelEntering) return
        const timer = window.setTimeout(() => setIsPanelEntering(false), 30)
        return () => window.clearTimeout(timer)
    }, [isPanelEntering])

    const transitionToLogin = () => {
        if (isLeavingForLogin) return
        setIsLeavingForLogin(true)
        window.setTimeout(() => navigate('/login?flip=1'), 320)
    }

    const handleRegister = async (values: any) => {
        try {
            setLoading(true)
            if (values.password !== values.confirmPassword) {
                message.error('Passwords do not match.')
                return
            }

            const userCred = await createUserWithEmailAndPassword(
                auth,
                values.email,
                values.password
            )
            const user = userCred.user
            const assignedRole = 'incubatee'

            const userDoc: any = {
                uid: user.uid,
                email: user.email,
                name: values.name || '',
                createdAt: new Date().toISOString(),
                role: assignedRole,
                firstLoginComplete: true
            }
            await setDoc(doc(db, 'users', user.uid), userDoc)

            message.success('🎉 Registration successful! Redirecting...', 1.4)
            setRedirecting(true)

            navigate('/applicant')
        } catch (err: any) {
            message.error(formatFirebaseError(err))
        } finally {
            setLoading(false)
        }
    }

    const handleGoogleRegister = async () => {
        try {
            setGoogleLoading(true)
            const provider = new GoogleAuthProvider()
            const result = await signInWithPopup(auth, provider)
            const user = result.user
            const userRef = doc(db, 'users', user.uid)
            const existingUser = await getDoc(userRef)

            // A registration always creates an incubatee account. Do not overwrite an
            // existing account's role when its owner uses Google from this page.
            if (!existingUser.exists()) {
                await setDoc(userRef, {
                    uid: user.uid,
                    name: user.displayName || '',
                    email: user.email,
                    role: 'incubatee',
                    createdAt: new Date().toISOString(),
                    firstLoginComplete: true
                })
            }

            message.success('Google sign-up successful! Redirecting...', 1.2)
            setRedirecting(true)

            navigate('/applicant')
        } catch (err: any) {
            message.error(formatFirebaseError(err))
        } finally {
            setGoogleLoading(false)
        }
    }

    const isSubmitting = loading || googleLoading || redirecting

    return (
        <>
            <Helmet>
                <title>Register | Smart Incubation Platform</title>
            </Helmet>
            {isMobile ? (
                <MobileRegisterScreen
                    form={form}
                    busy={isSubmitting}
                    onFinish={handleRegister}
                    onGoogle={handleGoogleRegister}
                    onSignIn={() => navigate('/login')}
                    onBack={() => navigate('/')}
                />
            ) : (
                <AuthShell>
                    <motion.div
                        className='as-form-inner'
                        initial={false}
                        animate={{
                            rotateY: isPanelEntering ? 90 : isLeavingForLogin ? -90 : 0
                        }}
                        transition={{ duration: 0.32, ease: 'easeInOut' }}
                        style={{ transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
                    >
                        <h1 className='as-title'>Create your account</h1>
                        <p className='as-sub'>Join the Lepharo incubation programme.</p>

                        <Form
                            layout='vertical'
                            form={form}
                            onFinish={handleRegister}
                            requiredMark={false}
                            className='as-form-compact'
                        >
                            <Form.Item
                                name='name'
                                label='Full name'
                                rules={[{ required: true, message: 'Please enter your full name' }]}
                            >
                                <Input size='large' placeholder='Your full name' autoComplete='name' autoFocus />
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
                                    placeholder='you@example.com'
                                    autoComplete='email'
                                    inputMode='email'
                                />
                            </Form.Item>

                            {/* Side by side: saves a row, so the card fits short laptop screens. */}
                            <div className='as-row-2'>
                            <Form.Item
                                name='password'
                                label='Password'
                                rules={[
                                    { required: true, message: 'Please enter a password' },
                                    { min: 6, message: 'Use at least 6 characters' }
                                ]}
                                hasFeedback
                            >
                                <Input.Password
                                    size='large'
                                    placeholder='6+ characters'
                                    autoComplete='new-password'
                                />
                            </Form.Item>

                            <Form.Item
                                name='confirmPassword'
                                label='Confirm password'
                                dependencies={['password']}
                                hasFeedback
                                rules={[
                                    { required: true, message: 'Please confirm your password' },
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            if (!value || getFieldValue('password') === value)
                                                return Promise.resolve()
                                            return Promise.reject(
                                                new Error('The two passwords do not match')
                                            )
                                        }
                                    })
                                ]}
                            >
                                <Input.Password
                                    size='large'
                                    placeholder='Type it again'
                                    autoComplete='new-password'
                                />
                            </Form.Item>
                            </div>

                            <Form.Item style={{ marginTop: 4, marginBottom: 14 }}>
                                <Button type='primary' htmlType='submit' size='large' block>
                                    Create account
                                </Button>
                            </Form.Item>

                            <div className='as-divider'>or</div>

                            <Button
                                icon={<GoogleOutlined />}
                                size='large'
                                block
                                onClick={handleGoogleRegister}
                            >
                                Continue with Google
                            </Button>
                        </Form>

                        <p className='as-alt'>
                            Already have an account?{' '}
                            <button type='button' className='as-link' onClick={transitionToLogin}>
                                Sign in
                            </button>
                        </p>
                    </motion.div>
                </AuthShell>
            )}

            {/* Same frosted loader the rest of the app uses for blocking waits. */}
            {isSubmitting && (
                <DashboardLoader
                    overlay
                    backdrop='translucent'
                    label={
                        googleLoading
                            ? 'Signing up with Google…'
                            : redirecting
                                ? 'Taking you to your application…'
                                : 'Creating your account…'
                    }
                />
            )}
        </>
    )
}

// Pre-auth surface — see routes/login for why this stays light.
export const RegisterPage = RegisterPageContent

export default RegisterPage
