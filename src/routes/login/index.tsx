import React, { useEffect, useState } from 'react'
import { GoogleOutlined, WarningOutlined } from '@ant-design/icons'
import { Button, Form, Input, Grid, message } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    fetchSignInMethodsForEmail
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { motion } from 'framer-motion'
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
import { signOutApp } from '@/lib/firestoreCache'
import SignInHelpSheet, { type SignInHelp } from './SignInHelpSheet'
import PickupSheet from './PickupSheet'
import ResetPasswordSheet from './ResetPasswordSheet'
import HowToAccessSheet from './HowToAccessSheet'
import MobileLoginScreen from './MobileLoginScreen'
import { AuthShell } from '@/components/auth/AuthShell'
import { DashboardLoader } from '@/components/layout/DashboardLoader'
import { shouldPromptWhatsApp } from '@/services/whatsappConsentPrompt'
import { needsWelcomeSetup } from '@/services/welcomeSteps'
import { hasSignedPopia } from '@/services/popiaConsent'

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

type ErrorContext = 'signin' | 'google' | 'reset'

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
    // Only staff may scan applications; a new applicant's scan is denied and
    // simply finds nothing.
    if (apps.length === 0) {
        const allSnap = await getDocs(collection(db, 'applications')).catch(() => null)
        const all = (allSnap?.docs || []).map(d => ({ id: d.id, ...d.data() } as any))
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
    const [form] = Form.useForm()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const redirectParam = searchParams.get('redirect')
    const safeRedirect =
        redirectParam && redirectParam.startsWith('/') ? redirectParam : null
    // Training SMEs land on their portal, except when they signed in from a
    // session's QR code: then they go back to check in.
    const isCheckInRedirect = !!safeRedirect && /^\/meeting-checkin(\?|$)/.test(safeRedirect)
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const [tutorialVisible, setTutorialVisible] = useState(false)
    const [loading, setLoading] = useState(false)
    const [googleLoading, setGoogleLoading] = useState(false)
    const [redirecting, setRedirecting] = useState(false)
    const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false)
    const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
    const [resetSending, setResetSending] = useState(false)
    const [signInHelp, setSignInHelp] = useState<SignInHelp | null>(null)
    const [isPanelEntering, setIsPanelEntering] = useState(
        searchParams.get('flip') === '1'
    )
    const [isLeavingForRegistration, setIsLeavingForRegistration] = useState(false)
    const [pickupUser, setPickupUser] = useState<any>(null)
    const [pickupBusy, setPickupBusy] = useState(false)
    const [capsLockOn, setCapsLockOn] = useState(false)

    // Caps Lock is the usual culprit behind a "wrong password" that isn't.
    const syncCapsLock = (e: React.KeyboardEvent) =>
        setCapsLockOn(e.getModifierState?.('CapsLock') ?? false)


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

    // Goes through signOutApp rather than a bare signOut(): that also hands the
    // Firestore cache back unowned. Otherwise the next account to sign in is
    // detected as a different owner mid-session and IdentityContext forces a
    // reload, which reads as having to sign in twice. It ends in a full page
    // navigation back here, so the modal never needs closing by hand.
    const handlePickupDifferentAccount = async () => {
        setPickupBusy(true)
        await signOutApp(window.location.pathname + window.location.search)
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
        const { error, message: errMsg, role, setupNeeded, whatsappPromptNeeded, mustChangePassword } = await checkUser(user as any)

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

        // Setup comes first: a default password, an SME's first visit, or a missing
        // signature or POPIA consent. Checking in at a meeting from its QR code is not
        // held up by it (except to replace a default password).
        if (setupNeeded) {
            navigateAfterLogin('/welcome', { allowRedirect: !mustChangePassword && isCheckInRedirect })
            return
        }

        // Training SMEs only ever see the /training portal, unless they signed in to check in.
        if (role === 'training_sme') {
            navigateAfterLogin('/training', { allowRedirect: isCheckInRedirect })
            return
        }

        // SMEs who signed up before WhatsApp updates existed see just that one question.
        if (role === 'incubatee' && whatsappPromptNeeded) {
            navigateAfterLogin('/whatsapp-consent')
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

                // Through the plan review first; it moves straight on when nothing waits.
                navigateAfterLogin('/plan-review', {
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
                firstLoginDone: false,
                setupNeeded: false,
                mustChangePassword: false,
                whatsappPromptNeeded: false
            }
        }

        const data = userSnap.data() as any
        const normalizeRole = (role: string) =>
            role?.toLowerCase()?.replace(/\s+/g, '') || ''

        const firstLoginDone = Boolean(data.firstLoginComplete === true)
        const role = normalizeRole(data.role)
        const mustChangePassword = data.mustChangePassword === true
        // Every user needs a saved signature and a signed POPIA notice; missing
        // either sends them through the setup wizard first.
        const setupNeeded = needsWelcomeSetup({
            role,
            firstLoginDone,
            mustChangePassword,
            hasSignature: Boolean(data.signatureURL),
            popiaSigned: await hasSignedPopia(data, role, user.email)
        })

        return {
            error: false,
            message: null,
            role,
            firstLoginDone,
            setupNeeded,
            mustChangePassword,
            // Existing SMEs who were never asked are asked once, on this page only.
            whatsappPromptNeeded: shouldPromptWhatsApp(data)
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

    // "Forgot password?" from the form: carry over whatever they already typed.
    const openForgotPassword = () => {
        setForgotPasswordEmail(form.getFieldValue('email') ?? '')
        setForgotPasswordVisible(true)
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

            const { error, message: errMsg, role, setupNeeded, whatsappPromptNeeded, mustChangePassword } = await checkUser(user as any)

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

            // Setup comes first: a default password, an SME's first visit, or a missing
            // signature or POPIA consent. Checking in at a meeting from its QR code is not
            // held up by it (except to replace a default password).
            if (setupNeeded) {
                navigateAfterLogin('/welcome', { allowRedirect: !mustChangePassword && isCheckInRedirect })
                return
            }

            // Training SMEs only ever see the /training portal, unless they signed in to check in.
            if (role === 'training_sme') {
                navigateAfterLogin('/training', { allowRedirect: isCheckInRedirect })
                return
            }

            if (role === 'incubatee' && whatsappPromptNeeded) {
                navigateAfterLogin('/whatsapp-consent')
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

                    // Through the plan review first; it moves straight on when nothing waits.
                    navigateAfterLogin('/plan-review', {
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
        setResetSending(true)
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
        } finally {
            setResetSending(false)
        }
    }

    const isSubmitting = loading || googleLoading || redirecting

    return (
        <>
            <Helmet>
                <title>Login | Smart Incubation Platform</title>
            </Helmet>

            {isMobile ? (
                <MobileLoginScreen
                    form={form}
                    onFinish={handleLogin}
                    onGoogle={handleGoogleLogin}
                    onForgotPassword={openForgotPassword}
                    onHowTo={() => setTutorialVisible(true)}
                    onSignUp={() => navigate('/registration')}
                    onBack={() => navigate('/')}
                />
            ) : (
                <AuthShell>
                    <motion.div
                        className='as-form-inner'
                        initial={false}
                        animate={{
                            rotateY: isPanelEntering ? 90 : isLeavingForRegistration ? 90 : 0
                        }}
                        transition={{ duration: 0.32, ease: 'easeInOut' }}
                        style={{ transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
                    >
                        <h1 className='as-title'>Welcome back</h1>
                        <p className='as-sub'>Sign in to continue to Lepharo Smart Incubation.</p>

                        <Form
                            layout='vertical'
                            form={form}
                            onFinish={handleLogin}
                            requiredMark={false}
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
                                    placeholder='you@example.com'
                                    autoComplete='username'
                                    inputMode='email'
                                    autoFocus
                                />
                            </Form.Item>

                            {/* The reset link sits beside the label but outside it, so
                                it is not read out as part of the field's name. */}
                            <div className='as-field-with-link'>
                                <Form.Item
                                    name='password'
                                    label='Password'
                                    rules={[{ required: true, message: 'Please enter your password' }]}
                                    extra={
                                        capsLockOn ? (
                                            <span className='as-caps' role='status'>
                                                <WarningOutlined /> Caps Lock is on
                                            </span>
                                        ) : undefined
                                    }
                                >
                                    <Input.Password
                                        size='large'
                                        placeholder='Enter your password'
                                        autoComplete='current-password'
                                        onKeyDown={syncCapsLock}
                                        onKeyUp={syncCapsLock}
                                        onBlur={() => setCapsLockOn(false)}
                                    />
                                </Form.Item>
                                <button
                                    type='button'
                                    className='as-link as-field-link'
                                    onClick={openForgotPassword}
                                >
                                    Forgot password?
                                </button>
                            </div>

                            <Form.Item style={{ marginTop: 4, marginBottom: 18 }}>
                                <Button type='primary' htmlType='submit' size='large' block>
                                    Sign in
                                </Button>
                            </Form.Item>

                            <div className='as-divider'>or</div>

                            <Button
                                icon={<GoogleOutlined />}
                                size='large'
                                block
                                onClick={handleGoogleLogin}
                            >
                                Continue with Google
                            </Button>
                        </Form>

                        <p className='as-alt'>
                            Don't have an account?{' '}
                            <button type='button' className='as-link' onClick={transitionToRegistration}>
                                Create one
                            </button>
                            <span className='as-alt-sep' aria-hidden='true'>·</span>
                            <button type='button' className='as-link' onClick={() => setTutorialVisible(true)}>
                                How to get access
                            </button>
                        </p>
                    </motion.div>
                </AuthShell>
            )}

            <PickupSheet
                email={pickupUser ? pickupUser.email ?? 'your last account' : null}
                busy={pickupBusy}
                onContinue={remember => void handlePickupContinue(remember)}
                onDifferentAccount={() => void handlePickupDifferentAccount()}
            />

            <SignInHelpSheet
                help={signInHelp}
                onClose={() => setSignInHelp(null)}
                onContinueWithGoogle={() => {
                    setSignInHelp(null)
                    void handleGoogleLogin()
                }}
                onResetPassword={openPasswordSetup}
            />

            <ResetPasswordSheet
                open={forgotPasswordVisible}
                email={forgotPasswordEmail}
                sending={resetSending}
                onEmailChange={setForgotPasswordEmail}
                onSubmit={handleForgotPassword}
                onClose={() => setForgotPasswordVisible(false)}
            />

            <HowToAccessSheet
                open={tutorialVisible}
                onClose={() => setTutorialVisible(false)}
            />

            {/* Same frosted loader the rest of the app uses for blocking waits. */}
            {isSubmitting && (
                <DashboardLoader
                    overlay
                    backdrop='translucent'
                    label={
                        googleLoading
                            ? 'Signing in with Google…'
                            : redirecting
                                ? 'Taking you to your workspace…'
                                : 'Signing you in…'
                    }
                />
            )}
        </>
    )
}

export const LoginPage = LoginPageContent

export default LoginPage
