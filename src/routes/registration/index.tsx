import React, { useEffect, useState } from 'react'
import {
    EyeInvisibleOutlined,
    EyeTwoTone,
    GoogleOutlined
} from '@ant-design/icons'
import {
    Button,
    Form,
    Input,
    Typography,
    Spin,
    Carousel,
    Grid,
    Modal,
    Alert,
    message
} from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from 'firebase/auth'
import { auth, db } from '@/firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { useAuthSurfacePalette } from '@/hooks/useAuthSurfacePalette'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { motion } from 'framer-motion'

const { Title, Text } = Typography
const { useBreakpoint } = Grid

// --- Reuse the same small Carousel slide used on Login ---
interface CarouselSlideProps {
    title: string
    description: string
}
const CarouselSlide: React.FC<CarouselSlideProps> = ({
    title,
    description
}) => {
    const palette = useAuthSurfacePalette()

    return (
        <div
            style={{
                minHeight: 140,
                padding: '16px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center'
            }}
        >
            <h3
                style={{
                    marginBottom: 12,
                    color: palette.slideTitle,
                    fontSize: '20px',
                    fontWeight: '700',
                    letterSpacing: '-0.5px'
                }}
            >
                {title}
            </h3>
            <p
                style={{
                    fontSize: 16,
                    margin: 0,
                    color: palette.slideBody,
                    lineHeight: 1.5,
                    fontWeight: '500'
                }}
            >
                {description}
            </p>
        </div>
    )
}

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
    const palette = useAuthSurfacePalette()
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
        <Spin spinning={isSubmitting} size='large'>
            <Helmet>
                <title>Register | Smart Incubation Platform</title>
            </Helmet>
            {/* === SAME PAGE BACKGROUND AS LOGIN === */}
            <div
                style={{
                    height: '100vh',
                    width: '100vw',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    background: palette.pageWash,
                    position: 'relative',
                    overflow: 'hidden',
                    padding: isMobile ? '16px' : '24px'
                }}
            >
                {/* Pre-auth colour-mode control — see routes/login. */}
                <div
                    style={{
                        position: 'absolute',
                        top: isMobile ? 12 : 20,
                        right: isMobile ? 12 : 24,
                        zIndex: 3
                    }}
                >
                    <ThemeToggle compact={isMobile} />
                </div>

                {/* Blurred radial accents (same as login) */}
                <div
                    style={{
                        position: 'absolute',
                        top: '-100px',
                        left: '-120px',
                        width: 350,
                        height: 350,
                        borderRadius: '50%',
                        background: palette.blobCool,
                        filter: 'blur(80px)',
                        zIndex: 0
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        bottom: '-150px',
                        right: '-150px',
                        width: 450,
                        height: 450,
                        borderRadius: '50%',
                        background: palette.blobWarm,
                        filter: 'blur(80px)',
                        zIndex: 0
                    }}
                />

                {/* === CARD LAYOUT (IDENTICAL STRUCTURE) === */}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        width: isMobile ? '100%' : '900px',
                        maxWidth: '95%',
                        height: isMobile ? 'auto' : '560px',
                        borderRadius: 16,
                        overflow: 'hidden',
                        background: '#ffffff',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.1)',
                        zIndex: 1,
                        padding: isMobile ? '16px' : '24px',
                        boxSizing: 'border-box',
                        perspective: '1400px'
                    }}
                >
                    {/* LEFT PANEL — same as login (hero image + swirl + carousel) */}
                    {!isMobile && (
                        <div
                            style={{
                                flex: 1,
                                background: `url('/assets/images/welding.jpg') center/cover no-repeat`,
                                backgroundColor: '#f0f4f8',
                                borderRadius: 12,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                padding: '32px',
                                color: '#333',
                                position: 'relative',
                                marginRight: '24px'
                            }}
                        >
                            <div
                                style={{
                                    width: 120,
                                    height: 120,
                                    borderRadius: '50%',
                                    overflow: 'hidden',
                                    marginTop: '24px',
                                    marginBottom: '16px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                    border: palette.discBorder,
                                    backgroundColor: palette.discBg
                                }}
                            >
                                <img
                                    src='/assets/images/swirl-bg.png'
                                    alt='Decorative swirl'
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        opacity: palette.discImageOpacity,
                                        filter: palette.discImageFilter
                                    }}
                                />
                            </div>

                            {/* Bottom carousel with value props */}
                            <div
                                style={{
                                    width: '100%',
                                    maxWidth: 340,
                                    textAlign: 'center',
                                    position: 'absolute',
                                    bottom: '32px',
                                    borderRadius: '12px',
                                    background: palette.slideScrim,
                                    backdropFilter: palette.slideScrimBlur,
                                    WebkitBackdropFilter: palette.slideScrimBlur,
                                    border: palette.slideScrimBorder,
                                    boxSizing: 'border-box',
                                    padding: '16px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                }}
                            >
                                <Carousel autoplay>
                                    <CarouselSlide
                                        title='AI Application Processing'
                                        description='Streamline submissions with AI-driven processing, reducing delays and errors in evaluation.'
                                    />
                                    <CarouselSlide
                                        title='Intervention Tracking'
                                        description='Monitor and manage interventions with real-time progress updates and accountability features.'
                                    />
                                    <CarouselSlide
                                        title='Advanced Analytics'
                                        description='Gain deeper insights with powerful analytics dashboards, enabling better decision-making.'
                                    />
                                </Carousel>
                            </div>
                        </div>
                    )}

                    {/* RIGHT PANEL — register form mirrors login styles */}
                    <motion.div
                        initial={false}
                        animate={{
                            rotateY: isPanelEntering ? 90 : isLeavingForLogin ? -90 : 0
                        }}
                        transition={{ duration: 0.32, ease: 'easeInOut' }}
                        style={{
                            flex: 1,
                            padding: isMobile ? '24px 20px' : '28px 34px',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            transformStyle: 'preserve-3d',
                            backfaceVisibility: 'hidden'
                        }}
                    >
                        <Title
                            level={3}
                            style={{ color: '#1c2541', textAlign: 'center', marginBottom: 2 }}
                        >
                            Create Account
                        </Title>
                        <Text
                            style={{
                                display: 'block',
                                textAlign: 'center',
                                marginBottom: 12,
                                color: '#666'
                            }}
                        >
                            Join the Lepharo Incubation Programme
                        </Text>

                        {/* Mobile: quick link to Login */}
                        {isMobile && (
                            <div style={{ textAlign: 'center', marginBottom: 8 }}>
                                <Button type='link' onClick={transitionToLogin}>
                                    Already have an account? Sign in
                                </Button>
                            </div>
                        )}

                        <Form
                            layout='vertical'
                            form={form}
                            onFinish={handleRegister}
                            requiredMark={false}
                        >
                            <Form.Item
                                name='name'
                                label={<span style={{ color: '#333' }}>Name</span>}
                                rules={[
                                    { required: true, message: 'Please enter your full name' }
                                ]}
                                style={{ marginBottom: 6 }}
                            >
                                <Input
                                    placeholder='Your full name'
                                    size='large'
                                    autoComplete='name'
                                    style={{
                                        borderRadius: 10,
                                        background: '#fff',
                                        color: '#333',
                                        border: '1px solid #d9d9d9'
                                    }}
                                />
                            </Form.Item>

                            <Form.Item
                                name='email'
                                label={<span style={{ color: '#333' }}>Email</span>}
                                rules={[
                                    { required: true, message: 'Please enter your email' },
                                    { type: 'email', message: 'Enter a valid email' }
                                ]}
                                style={{ marginBottom: 6 }}
                            >
                                <Input
                                    placeholder='you@example.com'
                                    size='large'
                                    autoComplete='email'
                                    inputMode='email'
                                    style={{
                                        borderRadius: 10,
                                        background: '#fff',
                                        color: '#333',
                                        border: '1px solid #d9d9d9'
                                    }}
                                />
                            </Form.Item>

                            <Form.Item
                                name='password'
                                label={<span style={{ color: '#333' }}>Password</span>}
                                rules={[
                                    { required: true, message: 'Please enter your password' },
                                    { min: 6, message: 'Password must be at least 6 characters' }
                                ]}
                                hasFeedback
                                style={{ marginBottom: 6 }}
                            >
                                <Input.Password
                                    placeholder='Enter your password'
                                    size='large'
                                    autoComplete='new-password'
                                    style={{
                                        borderRadius: 10,
                                        background: '#fff',
                                        color: '#333',
                                        border: '1px solid #d9d9d9'
                                    }}
                                    iconRender={visible =>
                                        visible ? (
                                            <EyeTwoTone twoToneColor='#666' />
                                        ) : (
                                            <EyeInvisibleOutlined />
                                        )
                                    }
                                />
                            </Form.Item>

                            <Form.Item
                                name='confirmPassword'
                                label={<span style={{ color: '#333' }}>Confirm Password</span>}
                                dependencies={['password']}
                                hasFeedback
                                rules={[
                                    { required: true, message: 'Please confirm your password' },
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            if (!value || getFieldValue('password') === value)
                                                return Promise.resolve()
                                            return Promise.reject(
                                                new Error('The two passwords do not match!')
                                            )
                                        }
                                    })
                                ]}
                                style={{ marginBottom: 8 }}
                            >
                                <Input.Password
                                    placeholder='Confirm your password'
                                    size='large'
                                    autoComplete='new-password'
                                    style={{
                                        borderRadius: 10,
                                        background: '#fff',
                                        color: '#333',
                                        border: '1px solid #d9d9d9'
                                    }}
                                    iconRender={visible =>
                                        visible ? (
                                            <EyeTwoTone twoToneColor='#666' />
                                        ) : (
                                            <EyeInvisibleOutlined />
                                        )
                                    }
                                />
                            </Form.Item>

                            <Form.Item style={{ marginBottom: 6 }}>
                                <Button
                                    type='primary'
                                    htmlType='submit'
                                    block
                                    size='large'
                                    loading={loading}
                                    style={{
                                        background: palette.accent,
                                        borderColor: palette.accent,
                                        borderRadius: 10,
                                        fontWeight: 600
                                    }}
                                >
                                    Sign Up
                                </Button>
                            </Form.Item>

                            <div
                                style={{
                                    textAlign: 'center',
                                    margin: '8px 0',
                                    color: '#8c8c8c'
                                }}
                            >
                                or
                            </div>

                            <Button
                                icon={<GoogleOutlined />}
                                block
                                size='large'
                                onClick={handleGoogleRegister}
                                loading={googleLoading}
                                aria-label='Continue with Google'
                                style={{
                                    borderRadius: 10,
                                    border: '1px solid #d9d9d9',
                                    background: '#fff',
                                    fontWeight: 600,
                                    color: '#333'
                                }}
                            >
                                Continue with Google
                            </Button>

                            {/* Desktop-only quick link below form to keep parity with login’s layout */}
                            {!isMobile && (
                                <div style={{ textAlign: 'center', marginTop: 12 }}>
                                    <Text style={{ color: '#666' }}>
                                        Already have an account?{' '}
                                        <Button
                                            type='link'
                                            style={{ padding: 0, color: palette.accentLink, fontWeight: 600 }}
                                            onClick={transitionToLogin}
                                        >
                                            Sign in
                                        </Button>
                                    </Text>
                                </div>
                            )}
                        </Form>
                    </motion.div>
                </div>

                {/* Bottom-right brand pill (same as login) */}
                <div
                    style={{
                        position: 'fixed',
                        bottom: 22,
                        right: 20,
                        height: 46,
                        width: 110,
                        zIndex: 99,
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        padding: '4px'
                    }}
                >
                    <img
                        src='/assets/images/QuantilytixO.png'
                        alt='Quantilytix Logo'
                        style={{ height: '100%', width: '100%', objectFit: 'contain' }}
                    />
                </div>
            </div>
        </Spin>
    )
}

// Pre-auth surface — see routes/login for why this stays light.
export const RegisterPage = RegisterPageContent

export default RegisterPage
