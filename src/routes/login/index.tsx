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
    Carousel,
    Grid,
    Modal,
    Alert,
    message,
    Space,
    Divider
} from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    fetchSignInMethodsForEmail,
    signOut
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where, addDoc, serverTimestamp
} from 'firebase/firestore'
import { auth, db, functions } from '@/firebase'
import { Helmet } from 'react-helmet'
import { useAuthSurfacePalette } from '@/hooks/useAuthSurfacePalette'
import { ThemeToggle } from '@/components/layout/theme-toggle'

const { Title, Text } = Typography
const { useBreakpoint } = Grid

// Whether a returning, already-signed-in user should be routed straight into
// the app or asked first. Keyed per-uid so one device with multiple accounts
// doesn't inherit another account's choice.
type AutoSignInPreference = 'always' | 'ask'
const AUTO_SIGNIN_PREF_PREFIX = 'lph-auto-signin-pref:'

const getAutoSignInPreference = (uid: string): AutoSignInPreference | null => {
    try {
        const value = window.localStorage.getItem(AUTO_SIGNIN_PREF_PREFIX + uid)
        return value === 'always' || value === 'ask' ? value : null
    } catch {
        return null
    }
}

const setAutoSignInPreference = (uid: string, preference: AutoSignInPreference) => {
    try {
        window.localStorage.setItem(AUTO_SIGNIN_PREF_PREFIX + uid, preference)
    } catch {
        // localStorage unavailable -- the prompt just reappears next visit.
    }
}

// IdentityContext can force a hard `window.location.reload()` right after an
// interactive sign-in, to reconcile the on-disk Firestore cache when it still
// belongs to a previously signed-in account (see IdentityContext.tsx's
// cacheBelongsToAnotherAccount check). That reload re-mounts this screen with
// the new user already in auth.currentUser, which would otherwise look
// exactly like a cold app restart and trigger the "welcome back" prompt a
// second time for someone who just typed their password. sessionStorage
// survives that reload (unlike component state) but not a real new session,
// so it is the right place to mark "a sign-in on this screen is in flight."
const INTERACTIVE_SIGNIN_FLAG = 'lph-interactive-signin'

const markInteractiveSignIn = () => {
    try {
        window.sessionStorage.setItem(INTERACTIVE_SIGNIN_FLAG, '1')
    } catch {
        // sessionStorage unavailable -- worst case, the prompt reappears once.
    }
}

const clearInteractiveSignInFlag = () => {
    try {
        window.sessionStorage.removeItem(INTERACTIVE_SIGNIN_FLAG)
    } catch {
        /* noop */
    }
}

const consumeInteractiveSignInFlag = (): boolean => {
    try {
        const had = window.sessionStorage.getItem(INTERACTIVE_SIGNIN_FLAG) === '1'
        if (had) window.sessionStorage.removeItem(INTERACTIVE_SIGNIN_FLAG)
        return had
    } catch {
        return false
    }
}

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

type ErrorContext = 'signin' | 'google' | 'reset'

type SignInHelp = {
    email: string
    googleOnly: boolean
}

export function formatFirebaseError(
    error: any,
    ctx: ErrorContext = 'signin'
): string {
    const code = String(error?.code || '').toLowerCase()

    const generic =
        ctx === 'reset'
            ? 'If an account exists for that email, we’ll send a reset link.'
            : 'Something went wrong. Please try again.'

    const M: Record<string, string> = {
        'auth/invalid-credential': 'The email or password is incorrect.',
        'auth/invalid-login-credentials': 'The email or password is incorrect.',
        'auth/wrong-password': 'The email or password is incorrect.',
        'auth/user-not-found':
            ctx === 'reset'
                ? 'If an account exists for that email, we’ll send a reset link.'
                : 'The email or password is incorrect.',
        'auth/user-disabled':
            'This account has been disabled. Please contact support.',
        'auth/operation-not-allowed':
            'This sign-in method is not enabled. Please contact support.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/missing-email': 'Please enter your email address.',
        'auth/too-many-requests':
            'Too many attempts. Try again later or reset your password.',
        'auth/network-request-failed':
            'We couldn’t reach the server. Check your internet connection.',
        unavailable:
            'Service is temporarily unavailable. Please try again shortly.',
        'deadline-exceeded': 'Request took too long. Please try again.',
        'resource-exhausted': 'Temporary limit reached. Please try again shortly.',
        'auth/popup-closed-by-user':
            'The sign-in window was closed before finishing.',
        'auth/cancelled-popup-request':
            'Another sign-in window is already open. Use the latest one.',
        'auth/popup-blocked':
            'Your browser blocked the sign-in window. Allow pop-ups and try again.',
        'auth/unauthorized-domain':
            'This domain is not allowed for sign-in. Please contact support.',
        'auth/account-exists-with-different-credential':
            'An account already exists with this email using a different sign-in method. Sign in with your email and password, then link Google in your profile.',
        'auth/credential-already-in-use':
            'Those sign-in details are already linked to another account.',
        'permission-denied': 'You don’t have access to complete that action.',
        'not-found': 'We couldn’t find what you were looking for.'
    }

    if (M[code]) return M[code]
    const trimmed = code.replace(/^auth\//, '')
    if (M[trimmed]) return M[trimmed]

    const msg = String(error?.message || '').toLowerCase()
    if (msg.includes('network')) return M['auth/network-request-failed']
    if (
        ctx === 'reset' &&
        (code.includes('user-not-found') || msg.includes('user not found'))
    ) {
        return M['auth/user-not-found']
    }

    return generic
}

const normEmail = (v?: string) => (v ?? '').trim().toLowerCase()
const norm = (v?: string) => (v ?? '').toLowerCase().trim()

const isInvalidCredentialError = (error: any) =>
    [
        'auth/invalid-credential',
        'auth/invalid-login-credentials',
        'auth/wrong-password',
        'auth/user-not-found'
    ].includes(String(error?.code || '').toLowerCase())

const getEffectiveAppStatus = (app: any) => {
    // primary
    const s1 = norm(app?.applicationStatus)

    // fallback: decision.status (common patterns)
    const s2 = norm(app?.decision?.status)

    return s1 || s2
}

async function getAppsByEmailAnyField(email?: string) {
    const e = normEmail(email)
    if (!e) return []

    // 1) Try exact matches on both fields (fast path)
    const [byEmail, byApplicantEmail] = await Promise.all([
        getDocs(query(collection(db, 'applications'), where('email', '==', e))),
        getDocs(query(collection(db, 'applications'), where('applicantEmail', '==', e)))
    ])

    const mapDocs = (snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any))
    let apps = [...mapDocs(byEmail), ...mapDocs(byApplicantEmail)]

    // 2) If still none, fallback: scan and match normalized (handles hidden spaces/casing in stored data)
    if (apps.length === 0) {
        const allSnap = await getDocs(collection(db, 'applications'))
        const all = allSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))
        apps = all.filter(a => {
            const aEmail = normEmail(a.email)
            const aApplicantEmail = normEmail(a.applicantEmail)
            return aEmail === e || aApplicantEmail === e
        })
    }

    // de-dupe by id
    const seen = new Set<string>()
    return apps.filter(a => (seen.has(a.id) ? false : (seen.add(a.id), true)))
}

async function getAcceptedAppByEmail(email?: string) {
    const apps = await getAppsByEmailAnyField(email)
    return apps.find(a => getEffectiveAppStatus(a) === 'accepted') || null
}


async function getParticipantByEmail(email?: string) {
    const e = normEmail(email)
    if (!e) return null

    const ps = await getDocs(
        query(collection(db, 'participants'), where('email', '==', e))
    )
    const doc0 = ps.docs[0]
    return doc0 ? { id: doc0.id, ...(doc0.data() as any) } : null
}

const LoginPageContent: React.FC = () => {
    const palette = useAuthSurfacePalette()
    const [form] = Form.useForm()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const redirectParam = searchParams.get('redirect')
    const safeRedirect =
        redirectParam && redirectParam.startsWith('/') ? redirectParam : null
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const [tutorialVisible, setTutorialVisible] = useState(false)
    const [loading, setLoading] = useState(false)
    const [googleLoading, setGoogleLoading] = useState(false)
    const [redirecting, setRedirecting] = useState(false)
    const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false)
    const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
    const [signInHelp, setSignInHelp] = useState<SignInHelp | null>(null)
    const [isPanelEntering, setIsPanelEntering] = useState(
        searchParams.get('flip') === '1'
    )
    const [isLeavingForRegistration, setIsLeavingForRegistration] = useState(false)
    const [pickupUser, setPickupUser] = useState<any>(null)
    const [pickupBusy, setPickupBusy] = useState(false)

    // framer-motion helpers
    const reduceMotion = useReducedMotion()

    const overlayVariants = {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.8 } },
        exit: { opacity: 0, transition: { duration: 0.6 } }
    }

    useEffect(() => {
        if (!isPanelEntering) return
        const timer = window.setTimeout(() => setIsPanelEntering(false), 30)
        return () => window.clearTimeout(timer)
    }, [isPanelEntering])

    // Sessions persist across launches now, so being back here is unusual enough
    // to need an explanation. IdleSignOut sends people here with this flag after
    // the inactivity limit runs out.
    useEffect(() => {
        if (searchParams.get('reason') !== 'idle') return
        message.info({
            content: 'You were signed out after a long period of inactivity.',
            duration: 6
        })
    }, [searchParams])

    // Someone can reach this screen already signed in, now that sessions survive
    // the app being closed -- by opening the app cold, by navigating here
    // directly, or after an internal reload. Only route them on silently when
    // they've previously said to always do that for this account; otherwise
    // confirm first via the "welcome back" modal below, since jumping straight
    // into someone else's last session on a shared device is surprising.
    //
    // auth.currentUser is reliable here because main.tsx waits for
    // authStateReady() before the app renders.
    useEffect(() => {
        const user = auth.currentUser
        if (!user) return

        const skipPrompt =
            getAutoSignInPreference(user.uid) === 'always' ||
            consumeInteractiveSignInFlag()

        if (!skipPrompt) {
            setPickupUser(user)
            return
        }

        let cancelled = false
        void (async () => {
            try {
                if (!cancelled) await routeSignedInUser(user as any)
            } catch {
                // Their profile could not be read -- leave them on the form
                // rather than trapping them behind an error they cannot action.
            }
        })()

        return () => {
            cancelled = true
        }
        // Runs once on mount: routeSignedInUser closes over navigation helpers
        // that are stable for the life of the screen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handlePickupContinue = async (remember: AutoSignInPreference) => {
        const user = pickupUser
        if (!user) return
        setAutoSignInPreference(user.uid, remember)
        setPickupBusy(true)
        markInteractiveSignIn()
        try {
            await routeSignedInUser(user)
        } catch {
            // Their profile could not be read -- leave them on the form.
        } finally {
            setPickupBusy(false)
            setPickupUser(null)
            clearInteractiveSignInFlag()
        }
    }

    const handlePickupDifferentAccount = async () => {
        setPickupBusy(true)
        try {
            await signOut(auth)
        } catch {
            // Best effort -- the empty form below still lets them sign in fresh.
        } finally {
            setPickupBusy(false)
            setPickupUser(null)
        }
    }

    const spinnerVariants = {
        animate: {
            rotate: [0, 180, 360],
            scale: [1, 1.03, 1], // was 1.08
            transition: { duration: 2.0, repeat: Infinity, ease: 'easeInOut' } // was 1.1
        }
    }

    const toDate = (v: any): Date | null => {
        if (!v) return null
        if (v?.seconds) return new Date(v.seconds * 1000)
        if (typeof v === 'string') {
            const d = new Date(v)
            return isNaN(+d) ? null : d
        }
        if (v instanceof Date) return v
        return null
    }

    const monthsBetween = (from: Date, to: Date) => {
        const years = to.getFullYear() - from.getFullYear()
        const months = to.getMonth() - from.getMonth()
        return years * 12 + months - (to.getDate() < from.getDate() ? 1 : 0)
    }

    async function shouldRouteToMoa(acceptedApp: any): Promise<boolean> {
        // 1) Prefer Cloud Function flag if present
        const needsFlag =
            acceptedApp?.needsMOA === true ||
            String(acceptedApp?.moaStatus || '').toLowerCase() === 'required'
        if (needsFlag) return true

        if (
            acceptedApp?.needsMOA === false ||
            String(acceptedApp?.moaStatus || '').toLowerCase() === 'completed'
        ) {
            return false
        }

        // 2) Fallback: check subdoc and 3+ months rule
        const moaRef = doc(db, 'applications', acceptedApp.id, 'agreements', 'moa')
        const moaSnap = await getDoc(moaRef)
        if (moaSnap.exists() && moaSnap.data()?.signed === true) return false

        const acceptedAt =
            toDate(acceptedApp?.acceptedAt) || toDate(acceptedApp?.dateAccepted)
        if (!acceptedAt) return false

        return monthsBetween(acceptedAt, new Date()) >= 3
    }

    /**
     * Sends an authenticated user wherever their role and application state say
     * they belong. Shared by the sign-in handler and the already-signed-in check
     * below, so both land people in exactly the same place.
     */
    const routeSignedInUser = async (user: any) => {
        const { error, message: errMsg, role, firstLoginDone } = await checkUser(user as any)

        const actor = {
            uid: user.uid,
            email: user.email,
            role: role ?? null,
        }
        const target = actor

        if (error) {
            // only log this if somehow the role is incubatee later; otherwise skip
            message.error(errMsg)
            return
        }

        // welcome gate for incubatee only
        if (role === 'incubatee' && !firstLoginDone) {
            navigateAfterLogin('/welcome')
            return
        }

        if (role === 'incubatee') {
            const accepted = await getAcceptedAppByEmail(user.email || undefined)

            if (accepted) {
                const gapDone = norm(accepted.gapAnalysisStatus) === 'completed'

                if (!gapDone) {
                    const participant = await getParticipantByEmail(user.email || undefined)

                    if (safeRedirect && safeRedirect.startsWith('/meeting-checkin')) {
                        navigate(safeRedirect, { replace: true })
                    } else {
                        navigate('/incubatee/gap-analysis', {
                            state: {
                                participantId: participant?.id ?? null,
                                prefillData: {
                                    companyName: participant?.beneficiaryName ?? '',
                                    region: participant?.province ?? '',
                                    contactDetails: participant?.phone ?? '',
                                    email: participant?.email ?? user.email,
                                    dateOfEngagement: accepted?.dateAccepted ?? null
                                }
                            }
                        })
                    }
                    return
                }

                const routeToMoa = await shouldRouteToMoa(accepted)

                if (routeToMoa) {
                    const participant = await getParticipantByEmail(user.email || undefined)

                    setRedirecting(true)

                    if (safeRedirect && safeRedirect.startsWith('/meeting-checkin')) {
                        navigate(safeRedirect, { replace: true })
                    } else {
                        navigate('/incubatee/moa', {
                            state: {
                                appId: accepted.id,
                                programId: accepted?.programId ?? null,
                                participantId: participant?.id ?? null
                            }
                        })
                    }
                    return
                }

                navigateAfterLogin('/incubatee', {
                    allowRedirect: false
                })
                return
            }

            const apps = await getAppsByEmailAnyField(user.email || undefined)

            if (apps.length === 0) {
                navigateAfterLogin('/applicant')
                return
            }

            const pending = apps.find(a => getEffectiveAppStatus(a) === 'pending')

            if (pending) {
                navigateAfterLogin('/applicant/tracker')
                return
            }

            navigateAfterLogin('/applicant')
            return
        }

        if (role === 'employee') {
            navigateAfterLogin('/timesheet', {
                allowRedirect: false
            })
            return
        }

        navigateAfterLogin(`/${role}`)
    }

    async function checkUser(user: any) {
        const userRef = doc(db, 'users', user.uid)
        const userSnap = await getDoc(userRef)

        if (!userSnap.exists()) {
            return {
                error: true,
                message: 'User not found in the system. Please contact the admin.',
                role: null,
                firstLoginDone: false
            }
        }

        const data = userSnap.data() as any
        const normalizeRole = (role: string) =>
            role?.toLowerCase()?.replace(/\s+/g, '') || ''

        const firstLoginDone = Boolean(data.firstLoginComplete === true)

        return {
            error: false,
            message: null,
            role: normalizeRole(data.role),
            firstLoginDone
        }
    }

    const navigateAfterLogin = (
        fallback: string,
        options?: {
            allowRedirect?: boolean
        }
    ) => {
        const allowRedirect = options?.allowRedirect ?? true

        navigate(
            allowRedirect && safeRedirect
                ? safeRedirect
                : fallback,
            { replace: true }
        )
    }

    const transitionToRegistration = () => {
        if (isLeavingForRegistration) return
        setIsLeavingForRegistration(true)
        window.setTimeout(() => navigate('/registration?flip=1'), 320)
    }

    const openPasswordSetup = (email: string) => {
        setSignInHelp(null)
        setForgotPasswordEmail(email)
        setForgotPasswordVisible(true)
    }

    const showSignInHelp = async (email: string) => {
        const normalizedEmail = normEmail(email)
        let googleOnly = false

        try {
            // Firebase may return an empty list when email-enumeration protection
            // is enabled. In that case we keep the recovery prompt neutral.
            const methods = await fetchSignInMethodsForEmail(auth, normalizedEmail)
            googleOnly = methods.includes('google.com') && !methods.includes('password')
        } catch {
            // Provider discovery is a UX enhancement; sign-in recovery remains
            // available even when the project disallows this lookup.
        }

        setSignInHelp({ email: normalizedEmail, googleOnly })
    }

    // 1) Email/password
    const handleLogin = async (values: { email: string; password: string }) => {
        const fromPath = '/login'

        try {
            setLoading(true)
            markInteractiveSignIn()

            const { user } = await signInWithEmailAndPassword(
                auth,
                values.email,
                values.password
            )

            await routeSignedInUser(user as any)
        } catch (error: any) {
            try {
                const u = auth.currentUser
                const checked = u ? await checkUser(u) : null


            } catch { }

            if (isInvalidCredentialError(error)) {
                await showSignInHelp(values.email)
            } else {
                message.error(formatFirebaseError(error, 'signin'))
            }
        } finally {
            setLoading(false)
            // If we got here, this run of handleLogin finished on its own --
            // no cache-reconciliation reload interrupted it -- so there is
            // nothing left for a future mount of this screen to pick up.
            clearInteractiveSignInFlag()
        }
    }

    // 2) Google sign-in
    const handleGoogleLogin = async () => {
        const fromPath = '/login/google'

        try {
            setGoogleLoading(true)
            markInteractiveSignIn()

            const result = await signInWithPopup(auth, new GoogleAuthProvider())
            const user = result.user

            const { error, message: errMsg, role, firstLoginDone } = await checkUser(user as any)

            const actor = {
                uid: user.uid,
                email: user.email,
                role: role ?? null,
            }
            const target = actor

            if (error) {
                message.error(errMsg)
                return
            }

            if (role === 'incubatee' && !firstLoginDone) {
                navigateAfterLogin('/welcome')
                return
            }

            if (role === 'incubatee') {
                const accepted = await getAcceptedAppByEmail(user.email || undefined)

                if (accepted) {
                    const gapDone = norm(accepted.gapAnalysisStatus) === 'completed'

                    if (!gapDone) {
                        const participant = await getParticipantByEmail(user.email || undefined)

                        if (safeRedirect && safeRedirect.startsWith('/meeting-checkin')) {
                            navigate(safeRedirect, { replace: true })
                        } else {
                            navigate('/incubatee/gap-analysis', {
                                state: {
                                    participantId: participant?.id ?? null,
                                    prefillData: {
                                        companyName: participant?.beneficiaryName ?? '',
                                        region: participant?.province ?? '',
                                        contactDetails: participant?.phone ?? '',
                                        email: participant?.email ?? user.email,
                                        dateOfEngagement: accepted?.dateAccepted ?? null
                                    }
                                }
                            })
                        }
                        return
                    }

                    const routeToMoa = await shouldRouteToMoa(accepted)

                    if (routeToMoa) {
                        const participant = await getParticipantByEmail(user.email || undefined)

                        setRedirecting(true)

                        if (safeRedirect && safeRedirect.startsWith('/meeting-checkin')) {
                            navigate(safeRedirect, { replace: true })
                        } else {
                            navigate('/incubatee/moa', {
                                state: {
                                    appId: accepted.id,
                                    programId: accepted?.programId ?? null,
                                    participantId: participant?.id ?? null
                                }
                            })
                        }
                        return
                    }


                    navigateAfterLogin('/incubatee', {
                        allowRedirect: false
                    })
                    return
                }

                const apps = await getAppsByEmailAnyField(user.email || undefined)

                if (apps.length === 0) {

                    navigateAfterLogin('/applicant')
                    return
                }

                const pending = apps.find(a => getEffectiveAppStatus(a) === 'pending')

                if (pending) {
                    navigateAfterLogin('/applicant/tracker')
                    return
                }

                navigateAfterLogin('/applicant')
                return
            }

            message.success('Google login successful! Redirecting...', 1.2)

            if (role === 'employee') {
                navigateAfterLogin('/timesheet', {
                    allowRedirect: false
                })
                return
            }

            if (role === 'projectmanager') {
                navigateAfterLogin('/projectmanager')
                return
            }

            navigateAfterLogin(`/${role}`)
        } catch (error: any) {
            try {
                const u = auth.currentUser
                const checked = u ? await checkUser(u) : null
            } catch { }

            message.error(formatFirebaseError(error, 'google'))
        } finally {
            setGoogleLoading(false)
            // Same reasoning as handleLogin's finally: only reached when no
            // reconciliation reload interrupted this attempt.
            clearInteractiveSignInFlag()
        }
    }

    const handleForgotPassword = async () => {
        if (!forgotPasswordEmail) {
            message.warning('Please enter your email.')
            return
        }
        try {
            const sendReset = httpsCallable(
                functions,
                'sendLoggedPasswordResetEmail'
            )
            await sendReset({ email: forgotPasswordEmail })
            message.success(
                `A password reset link has been sent to ${forgotPasswordEmail}. Please check your inbox.`
            )
            setForgotPasswordVisible(false)
            setForgotPasswordEmail('')
        } catch (error: any) {
            if (String(error?.code).toLowerCase() === 'auth/user-not-found') {
                message.success(formatFirebaseError(error, 'reset'))
            } else {
                message.error(formatFirebaseError(error, 'reset'))
            }
        }
    }

    const isSubmitting = loading || googleLoading || redirecting

    return (
        <>
            <Helmet>
                <title>Login | Smart Incubation Platform</title>
            </Helmet>

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
                {/* The only colour-mode control reachable before sign-in — the
                    topbar one lives inside the authenticated shell. */}
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

                {/* Subtle decorative elements */}
                <motion.div
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
                    animate={reduceMotion ? {} : { y: [0, -10, 0] }}
                    transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div
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
                    animate={reduceMotion ? {} : { y: [0, 12, 0] }}
                    transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
                />

                {/* Card */}
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
                    {/* Left Panel */}
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
                                    alt='Swirl'
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        opacity: palette.discImageOpacity,
                                        filter: palette.discImageFilter
                                    }}
                                />
                            </div>

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

                    {/* Right Panel */}
                    <motion.div
                        initial={false}
                        animate={{
                            rotateY: isPanelEntering ? 90 : isLeavingForRegistration ? 90 : 0
                        }}
                        transition={{ duration: 0.32, ease: 'easeInOut' }}
                        style={{
                            flex: 1,
                            padding: isMobile ? '24px 20px' : '40px 34px',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            transformStyle: 'preserve-3d',
                            backfaceVisibility: 'hidden'
                        }}
                    >
                        <Title
                            level={3}
                            style={{ color: '#1c2541', textAlign: 'center', marginBottom: 6 }}
                        >
                            Welcome Back
                        </Title>
                        <Text
                            style={{
                                display: 'block',
                                textAlign: 'center',
                                marginBottom: 20,
                                color: '#666'
                            }}
                        >
                            Sign in to your account
                        </Text>

                        <Form
                            layout='vertical'
                            form={form}
                            onFinish={handleLogin}
                            requiredMark={false}
                        >
                            <Form.Item
                                name='email'
                                label={<span style={{ color: '#333' }}>Email</span>}
                                rules={[
                                    { required: true, message: 'Please enter your email' },
                                    { type: 'email', message: 'Enter a valid email' }
                                ]}
                            >
                                <Input
                                    placeholder='you@example.com'
                                    size='large'
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
                                    { required: true, message: 'Please enter your password' }
                                ]}
                            >
                                <Input.Password
                                    placeholder='Enter your password'
                                    size='large'
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

                            <div style={{ textAlign: 'right', marginBottom: 12 }}>
                                <Space>
                                    <Button
                                        type='link'
                                        shape='round'
                                        onClick={() => setTutorialVisible(true)}
                                        style={{ border: '1px solid blue', padding: 12, color: '#1677ff' }}
                                    >
                                        How To Access
                                    </Button>

                                    <Button
                                        type='link'
                                        onClick={() => setForgotPasswordVisible(true)}
                                        style={{ color: '#666' }}
                                    >
                                        Forgot password?
                                    </Button>
                                </Space>
                            </div>

                            <Form.Item>
                                <Button
                                    type='primary'
                                    htmlType='submit'
                                    block
                                    size='large'
                                    style={{
                                        background: palette.accent,
                                        borderColor: palette.accent,
                                        borderRadius: 10,
                                        fontWeight: 600
                                    }}
                                >
                                    Sign In
                                </Button>
                            </Form.Item>

                            <Divider
                                style={{
                                    color: palette.dividerText,
                                    borderColor: palette.dividerLine,
                                    fontWeight: 600
                                }}
                            >
                                OR
                            </Divider>

                            <Button
                                icon={<GoogleOutlined />}
                                block
                                size='large'
                                onClick={handleGoogleLogin}
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
                        </Form>



                        <div style={{ textAlign: 'center', marginTop: 20 }}>
                            <Text style={{ color: '#666' }}>
                                Don't have an account?{' '}
                                <Button
                                    type='link'
                                    style={{ padding: 0, color: palette.accentLink, fontWeight: 600 }}
                                    onClick={transitionToRegistration}
                                >
                                    Create one
                                </Button>
                            </Text>
                        </div>
                    </motion.div>
                </div>

                {/* Bottom-right brand with dark container for white logo */}
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
                        style={{
                            height: '100%',
                            width: '100%',
                            objectFit: 'contain'
                        }}
                    />
                </div>
            </div>

            <Modal
                title='Welcome back'
                open={Boolean(pickupUser)}
                closable={false}
                maskClosable={false}
                footer={null}
                width={380}
                centered
            >
                <Alert
                    type='info'
                    showIcon
                    message={`Pick up where you left off as ${pickupUser?.email ?? 'your last account'}?`}
                />
                <Space direction='vertical' size={10} style={{ width: '100%', marginTop: 18 }}>
                    <Button
                        type='primary'
                        block
                        loading={pickupBusy}
                        onClick={() => void handlePickupContinue('always')}
                    >
                        Always sign me in automatically
                    </Button>
                    <Button
                        block
                        loading={pickupBusy}
                        onClick={() => void handlePickupContinue('ask')}
                    >
                        Continue, but ask me every time
                    </Button>
                    <Button
                        block
                        loading={pickupBusy}
                        onClick={() => void handlePickupDifferentAccount()}
                    >
                        Use a different account
                    </Button>
                </Space>
            </Modal>

            <Modal
                title={
                    signInHelp?.googleOnly
                        ? 'This account uses Google sign-in'
                        : 'Having trouble signing in?'
                }
                open={Boolean(signInHelp)}
                onCancel={() => setSignInHelp(null)}
                footer={null}
                destroyOnClose
            >
                <Alert
                    type={signInHelp?.googleOnly ? 'info' : 'warning'}
                    showIcon
                    message={
                        signInHelp?.googleOnly
                            ? 'You previously registered using Google.'
                            : 'Your email or password could not be verified.'
                    }
                    description={
                        signInHelp?.googleOnly
                            ? 'Continue with Google to access your account, or send yourself a link to set up a password for future email sign-ins.'
                            : 'If you originally registered with Google, continue with Google. You can also send a link to set up or reset a password.'
                    }
                />
                <Space direction='vertical' size={10} style={{ width: '100%', marginTop: 18 }}>
                    <Button
                        icon={<GoogleOutlined />}
                        block
                        onClick={() => {
                            setSignInHelp(null)
                            void handleGoogleLogin()
                        }}
                    >
                        Continue with Google
                    </Button>
                    <Button
                        type='primary'
                        block
                        onClick={() => openPasswordSetup(signInHelp?.email || '')}
                    >
                        Set up or reset password
                    </Button>
                    <Button block onClick={() => setSignInHelp(null)}>
                        Try a different password
                    </Button>
                </Space>
            </Modal>

            {/* Password setup / reset modal */}
            <Modal
                title='Set Up or Reset Your Password'
                open={forgotPasswordVisible}
                onCancel={() => setForgotPasswordVisible(false)}
                footer={null}
            >
                <Alert
                    message='How it works'
                    description="Enter your registered email below. We'll email you a secure link to set up or reset your password."
                    type='info'
                    showIcon
                />
                <Input
                    placeholder='you@example.com'
                    type='email'
                    value={forgotPasswordEmail}
                    onChange={e => setForgotPasswordEmail(e.target.value)}
                    style={{ marginBottom: 18, marginTop: 18 }}
                    autoFocus
                />
                <div style={{ textAlign: 'right' }}>
                    <Button
                        style={{ marginRight: 8 }}
                        onClick={() => setForgotPasswordVisible(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        type='primary'
                        onClick={handleForgotPassword}
                        loading={loading}
                    >
                        Send Setup Link
                    </Button>
                </div>
            </Modal>

            <Modal
                title='How To Tutorial'
                open={tutorialVisible}
                onCancel={() => setTutorialVisible(false)}
                footer={null}
                width={900}
                centered
                destroyOnClose
            >
                <div
                    style={{
                        position: 'relative',
                        width: '100%',
                        paddingTop: '56.25%',
                        borderRadius: 12,
                        overflow: 'hidden',
                        background: '#000'
                    }}
                >
                    <iframe
                        src='https://www.youtube.com/embed/AQl59BjWAt0'
                        title='How To Tutorial Video'
                        allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                        allowFullScreen
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            border: 'none'
                        }}
                    />
                </div>
            </Modal>

            {/* 🔥 Animated loading overlay */}
            <AnimatePresence>
                {isSubmitting && (
                    <motion.div
                        key='loading'
                        variants={overlayVariants}
                        initial='initial'
                        animate='animate'
                        exit='exit'
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 9999,
                            backdropFilter: 'blur(3px)',
                            background: palette.overlayVeil,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'wait'
                        }}
                        aria-live='polite'
                        role='status'
                        aria-busy='true'
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25 }}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 12
                            }}
                        >
                            {/* Spinner ring */}
                            <motion.div
                                variants={spinnerVariants}
                                animate={reduceMotion ? { rotate: 0, scale: 1 } : 'animate'}
                                style={{
                                    width: 58,
                                    height: 58,
                                    borderRadius: '50%',
                                    border: '4px solid rgba(245,83,46,0.25)',
                                    borderTopColor: '#f5532e',
                                    boxShadow: '0 0 0 2px rgba(245,83,46,0.06) inset'
                                }}
                            />
                            <div
                                style={{
                                    fontWeight: 600,
                                    color: '#1c2541',
                                    letterSpacing: '0.2px'
                                }}
                            >
                                {googleLoading
                                    ? 'Signing in with Google…'
                                    : redirecting
                                        ? 'Redirecting…'
                                        : 'Signing you in…'}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    )
}

export const LoginPage = LoginPageContent

export default LoginPage
