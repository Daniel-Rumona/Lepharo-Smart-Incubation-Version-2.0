import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Card,
    Typography,
    Button,
    Space,
    Alert,
    Checkbox,
    Upload,
    message,
    Modal,
    Spin,
    Form,
    Input,
    Grid,
    Segmented,
    Select,
    Tag,
    theme
} from 'antd'
import {
    SmileOutlined,
    ArrowRightOutlined,
    SafetyCertificateOutlined,
    EditOutlined,
    CloudSyncOutlined,
    SolutionOutlined,
    InboxOutlined,
    ArrowLeftOutlined,
    CheckOutlined,
    SaveOutlined,
    ClearOutlined,
    DownloadOutlined,
    FontSizeOutlined,
    UploadOutlined
} from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { UploadProps } from 'antd'
import { useNavigate } from 'react-router-dom'

// Firebase
import { db, auth } from '@/firebase'
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc,
    setDoc,
    Timestamp,
    onSnapshot
} from 'firebase/firestore'
import {
    getStorage,
    ref as storageRef,
    uploadBytes,
    getDownloadURL
} from 'firebase/storage'
import {
    EmailAuthProvider,
    getAuth,
    GoogleAuthProvider,
    OAuthProvider,
    onAuthStateChanged,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    updatePassword
} from 'firebase/auth'

// Signature helpers
import SignatureCanvas from 'react-signature-canvas'
import html2canvas from 'html2canvas'

// App bits
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { PopiaContractModal } from '@/components/modals/Contracts/POPIA'
import { DashboardLoader } from '@/components/layout/DashboardLoader'
import { WhatsAppConsentCard } from '@/components/modals/WhatsAppConsentCard'
import { needsWhatsAppPrompt } from '@/services/whatsappConsent'
import {
    mustChangePasswordFor,
    pendingWelcomeSteps,
    welcomeStepKeys,
    type WelcomeStepKey
} from '@/services/welcomeSteps'
import { hasSignedPopia } from '@/services/popiaConsent'
import { functionsBaseUrl } from '@/firebaseConfig'
import { captureSignatureStrokes, rememberProfileSignature } from '@/utils/signatureReplay'

const { Title, Paragraph, Text } = Typography
const { Dragger } = Upload
const { useBreakpoint } = Grid
const { Option } = Select

type Role =
    | 'system_admin'
    | 'consultant'
    | 'incubatee'
    | 'operations'
    | 'director'
    | 'training_sme'
    | 'unknown'
type ProviderKey = 'google' | 'microsoft' | 'zoom'
type ConnectionDoc = {
    provider: ProviderKey
    status: 'connected' | 'not_connected'
    updatedAt?: Timestamp
    scopes?: string[]
    hasRefreshToken?: boolean
    externalAccountEmail?: string
}

const FUNCTIONS_BASE = functionsBaseUrl
const FONT_OPTIONS = ['Dancing Script', 'Great Vibes', 'Pacifico', 'Satisfy']
const roleKey = (r?: string): Role =>
    (r || '').toLowerCase().replace(/\s+/g, '') as Role

// Toggle off to bring consent back later
const HIDE_CONSENT = true

// What each step asks for, on the welcome screen, and what it leaves saved, on the last one.
const STEP_ASK: Partial<Record<WelcomeStepKey, string>> = {
    directorProfile: 'Confirm your company details',
    signature: 'Set up your signature',
    popia: 'Sign the POPIA privacy notice',
    whatsapp: 'Choose WhatsApp updates',
    consent: 'Connect your email & meeting tools'
}
// A friendly line under each item on the welcome screen.
const STEP_HINT: Partial<Record<WelcomeStepKey, string>> = {
    directorProfile: 'Just your company name.',
    signature: 'Type it or draw it. It is used whenever you sign a document here, starting with the POPIA notice.',
    popia: 'How we look after your personal information. Read it, then sign.',
    whatsapp: 'Optional reminders and updates on your phone.',
    consent: 'Lets the platform schedule meetings in your calendar.'
}
const STEP_SAVED: Partial<Record<WelcomeStepKey, string>> = {
    directorProfile: 'your company details',
    signature: 'your signature',
    popia: 'your POPIA consent',
    whatsapp: 'your WhatsApp choice',
    consent: 'your email & meetings consent'
}
const joinList = (items: string[]) =>
    items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

const WelcomeWizard: React.FC = () => {
    const navigate = useNavigate()
    const { user } = useFullIdentity()
    const screens = useBreakpoint()
    // Colours come from the active theme so the screen matches light or dark mode.
    const { token } = theme.useToken()
    const isMobile = !screens.md
    // whether this user must register company details (directors)
    // default to true so old users still see the step unless explicitly set to false
    const [mustRegisterCompany, setMustRegisterCompany] = useState<boolean>(true)

    // Connections (kept even if consent is hidden — future-proof)
    const [connections, setConnections] = useState<
        Record<ProviderKey, ConnectionDoc | undefined>
    >({ google: undefined, microsoft: undefined, zoom: undefined })
    const [connecting, setConnecting] = useState<ProviderKey | null>(null)

    // Who am I?
    const [userRole, setUserRole] = useState<Role>('unknown')
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [userId, setUserId] = useState<string | null>(null)

    // step states
    // The signed POPIA copy made on this visit, offered for download.
    const [popiaPdfUrl, setPopiaPdfUrl] = useState('')
    const [popiaSigned, setPopiaSigned] = useState(false)
    // An SME who has not finished setup before, as opposed to someone sent back for a missing item.
    const [firstVisit, setFirstVisit] = useState(false)
    // The steps this visit asks for, fixed once the profile is read so finished
    // steps stay in the stepper rather than vanishing.
    const [plan, setPlan] = useState<WelcomeStepKey[] | null>(null)
    // WhatsApp updates: answered, or put off until the next login.
    const [whatsappAnswered, setWhatsappAnswered] = useState(false)
    const [whatsappSkipped, setWhatsappSkipped] = useState(false)
    const [whatsappNumber, setWhatsappNumber] = useState('')
    const [signatureURL, setSignatureURL] = useState<string | null>(null)

    // consent-related (kept but hidden if HIDE_CONSENT)
    const [consentGiven, setConsentGiven] = useState(false)
    const [consentVendors, setConsentVendors] = useState({
        google: false,
        zoom: false,
        teams: false
    })

    // director-only profile data
    const [directorProfileComplete, setDirectorProfileComplete] = useState(false)
    const [directorForm] = Form.useForm()

    // UI
    const [current, setCurrent] = useState(0)
    // Which way the last step change went, so the next screen slides in from that side.
    const [direction, setDirection] = useState<1 | -1>(1)
    const reduceMotion = useReducedMotion()
    // The drawing pad fills its box; its pixel width follows the box's width.
    const sigPadRef = useRef<HTMLDivElement | null>(null)
    const [sigPadWidth, setSigPadWidth] = useState(480)
    const [loading, setLoading] = useState(true)
    const storage = getStorage()

    // --- Signature state (typed / drawn / upload optional)
    const [sigMode, setSigMode] = useState<'typed' | 'drawn' | 'upload'>('typed')
    const [typedName, setTypedName] = useState('')
    const [typedFont, setTypedFont] = useState(FONT_OPTIONS[0])
    const styledRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<SignatureCanvas>(null)

    // password step state
    const [mustChangePassword, setMustChangePassword] = useState(false)
    const [pwdStepComplete, setPwdStepComplete] = useState(false)
    // Fixed when the page loads: a person on a default password sees only the password
    // step, and this must not flip when the password is saved or the rest would appear.
    const [passwordOnly, setPasswordOnly] = useState(false)
    const [pwdForm] = Form.useForm()

    // loading guards
    const [savingPwd, setSavingPwd] = useState(false)
    const [savingSig, setSavingSig] = useState(false)

    // Resolve role, preload progress
    useEffect(() => {
        const off = onAuthStateChanged(getAuth(), async u => {
            if (!u) {
                setLoading(false)
                return
            }
            setUserId(u.uid)

            // role
            let r = roleKey(user?.role || user?.roleName)
            if (!r || r === 'unknown') {
                const us = await getDocs(
                    query(collection(db, 'users'), where('email', '==', u.email))
                )
                if (!us.empty) r = roleKey(us.docs[0].data().role)
            }
            setUserRole(r || 'unknown')

            // participant by email (for POPIA)
            const ps = await getDocs(
                query(collection(db, 'participants'), where('email', '==', u.email))
            )
            if (!ps.empty) setParticipantId(ps.docs[0].id)

            // profile (signature/consent and prefill director fields)
            const uref = doc(db, 'users', u.uid)
            const udal = await getDoc(uref)
            let profile: any = null
            if (udal.exists()) {
                profile = udal.data()

                // NEW: mustRegister flag — hide company step when false
                // default to true if missing, to preserve previous behavior
                setMustRegisterCompany(profile.mustRegister !== false)

                if (profile.signatureURL) setSignatureURL(profile.signatureURL)
                if (profile.consents?.integrations) {
                    setConsentGiven(!!profile.consents.integrations.master)
                    setConsentVendors({
                        google: !!profile.consents.integrations.google,
                        zoom: !!profile.consents.integrations.zoom,
                        teams: !!profile.consents.integrations.teams
                    })
                }
                if (r === 'director') {
                    directorForm.setFieldsValue({
                        company: profile.company || '',

                    })
                    setDirectorProfileComplete(
                        Boolean(profile.company)
                    )
                }
            }

            // POPIA: every user signs it (profile record, or an SME's application).
            setPopiaSigned(await hasSignedPopia(profile, r || 'unknown', u.email))
            setFirstVisit(r === 'incubatee' && profile?.firstLoginComplete !== true)

            // WhatsApp updates: already answered (e.g. on an earlier visit), and a number to prefill.
            setWhatsappAnswered(!needsWhatsAppPrompt(profile))
            setWhatsappNumber(String(profile?.phone || profile?.phoneNumber || ''))

            // Must-change-password logic
            const needsResetFromDoc = profile?.mustChangePassword
            const must = mustChangePasswordFor(needsResetFromDoc, r || 'unknown')
            setMustChangePassword(must)
            setPasswordOnly(must)
            setPwdStepComplete(!must)

            setLoading(false)
        })
        return () => off()
    }, [user?.role, user?.roleName, user?.email, directorForm])

    // Steps list (POPIA for incubatees; Director Profile for directors)
    const steps = useMemo(() => {
        const base = [
            {
                key: 'welcome',
                title: 'Welcome',
                icon: <SmileOutlined />,
                isComplete: true
            }
        ]

        const passwordStep = {
            key: 'password',
            title: 'Change Password',
            icon: <SafetyCertificateOutlined />,
            isComplete: pwdStepComplete
        }
        const director = {
            key: 'directorProfile',
            title: 'Company Details',
            icon: <SolutionOutlined />,
            isComplete: directorProfileComplete
        }
        const sig = {
            key: 'signature',
            title: 'Signature Setup',
            icon: <EditOutlined />,
            isComplete: !!signatureURL
        }
        const consent = {
            key: 'consent',
            title: 'Email & Meetings Consent',
            icon: <CloudSyncOutlined />,
            isComplete: !!consentGiven
        }
        const popia = {
            key: 'popia',
            title: 'Sign POPIA',
            icon: <SafetyCertificateOutlined />,
            isComplete: popiaSigned
        }
        const whatsapp = {
            key: 'whatsapp',
            title: 'WhatsApp Updates',
            icon: <CloudSyncOutlined />,
            isComplete: whatsappAnswered || whatsappSkipped
        }

        // The decision of which steps to show lives in welcomeSteps (and is tested there).
        const byKey: Record<string, (typeof base)[number] | typeof passwordStep> = {
            welcome: base[0],
            password: passwordStep,
            directorProfile: director,
            popia,
            whatsapp,
            signature: sig,
            consent
        }
        return (plan ?? []).map(key => byKey[key])
    }, [
        plan,
        userRole,
        popiaSigned,
        whatsappAnswered,
        whatsappSkipped,
        signatureURL,
        consentGiven,
        directorProfileComplete,
        pwdStepComplete,
        passwordOnly,
        mustRegisterCompany // NEW dependency
    ])

    // Hide consent entirely while you work on it
    const visibleSteps = useMemo(
        () => (HIDE_CONSENT ? steps.filter(s => s.key !== 'consent') : steps),
        [steps]
    )
    // What this visit set out to do, for the welcome and completion wording.
    const plannedTasks = visibleSteps.map(s => s.key as WelcomeStepKey).filter(key => key !== 'welcome')

    const currentKey = visibleSteps[current]?.key

    // Clamp current when steps change
    useEffect(() => {
        if (current >= visibleSteps.length) {
            setCurrent(Math.max(0, visibleSteps.length - 1))
        }
    }, [visibleSteps.length, current])

    // Once the profile is read, settle which steps this visit needs and start at the first.
    useEffect(() => {
        if (loading || plan) return
        const keys = welcomeStepKeys({
            role: userRole,
            passwordOnly,
            mustRegisterCompany,
            hideConsent: false
        })
        setPlan(
            pendingWelcomeSteps(
                keys,
                {
                    password: pwdStepComplete,
                    directorProfile: directorProfileComplete,
                    signature: !!signatureURL,
                    popia: popiaSigned,
                    whatsapp: whatsappAnswered,
                    consent: !!consentGiven
                },
                firstVisit
            )
        )
        setCurrent(0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, plan])

    // ---- Signature helpers ----
    const dataURLToBlob = async (dataUrl: string) => {
        const res = await fetch(dataUrl)
        return await res.blob()
    }

    const uploadSigBlob = async (blob: Blob, filename = 'signature.png') => {
        if (!auth.currentUser) throw new Error('Not signed in')
        const uid = auth.currentUser.uid
        const path = `signatures/${uid}/${Date.now()}_${filename}`
        const ref = storageRef(storage, path)
        await uploadBytes(ref, blob)
        return await getDownloadURL(ref)
    }

    const saveTypedSignature = async () => {
        if (!styledRef.current) {
            message.error('Signature preview not ready')
            return
        }
        setSavingSig(true)
        try {
            // Loaded on demand: html2canvas is large, and this component is
            // reachable from the always-mounted layout -- a static import puts it
            // in the shell every user downloads, for a feature few will use.
            const { default: html2canvas } = await import('html2canvas')
            const canvas = await html2canvas(styledRef.current)
            const dataURL = canvas.toDataURL('image/png')
            const blob = await dataURLToBlob(dataURL)
            const url = await uploadSigBlob(blob, 'typed.png')
            await setDoc(
                doc(db, 'users', auth.currentUser!.uid),
                { signatureURL: url, signatureMethod: 'typed', signatureStrokes: null },
                { merge: true }
            )
            rememberProfileSignature(auth.currentUser!.uid, url, null)
            setSignatureURL(url)
            message.success('Typed signature saved to your profile.')
        } catch (e: any) {
            message.error(e?.message || 'Failed to save signature.')
        } finally {
            setSavingSig(false)
        }
    }

    const saveDrawnSignature = async () => {
        const c = canvasRef.current
        if (!c || c.isEmpty()) {
            message.warning('Please draw your signature first.')
            return
        }
        setSavingSig(true)
        try {
            const dataURL = c.toDataURL('image/png')
            // The PNG is the whole pad, so the strokes are not trimmed either.
            const signatureStrokes = captureSignatureStrokes(c, false)
            const blob = await dataURLToBlob(dataURL)
            const url = await uploadSigBlob(blob, 'drawn.png')
            await setDoc(
                doc(db, 'users', auth.currentUser!.uid),
                { signatureURL: url, signatureMethod: 'drawn', signatureStrokes },
                { merge: true }
            )
            rememberProfileSignature(auth.currentUser!.uid, url, signatureStrokes)
            setSignatureURL(url)
            message.success('Drawn signature saved to your profile.')
        } catch (e: any) {
            message.error(e?.message || 'Failed to save signature.')
        } finally {
            setSavingSig(false)
        }
    }

    const clearDrawnSignature = () => canvasRef.current?.clear()

    // Optional: upload an image instead
    const handleUploadSignatureFile = async (file: File) => {
        setSavingSig(true)
        try {
            const url = await uploadSigBlob(file, file.name)
            await setDoc(
                doc(db, 'users', auth.currentUser!.uid),
                { signatureURL: url, signatureMethod: 'uploaded', signatureStrokes: null },
                { merge: true }
            )
            rememberProfileSignature(auth.currentUser!.uid, url, null)
            setSignatureURL(url)
            message.success('Signature image uploaded.')
        } finally {
            setSavingSig(false)
        }
    }

    const uploadProps: UploadProps = {
        multiple: false,
        accept: '.png,.jpg,.jpeg,.gif,.webp',
        showUploadList: false,
        customRequest: async (options: any) => {
            const { file, onError, onSuccess } = options
            try {
                await handleUploadSignatureFile(file as File)
                onSuccess?.('ok')
            } catch (e: any) {
                message.error(e?.message || 'Upload failed')
                onError?.(e)
            }
        }
    }

    // ---- Consent + Director helpers (consent UI is hidden for now) ----
    const persistConsent = async () => {
        if (!auth.currentUser) return
        const uid = auth.currentUser.uid
        await setDoc(
            doc(db, 'users', uid),
            {
                consents: {
                    integrations: {
                        master: true,
                        google: consentVendors.google,
                        zoom: consentVendors.zoom,
                        teams: consentVendors.teams,
                        updatedAt: Timestamp.now()
                    }
                }
            },
            { merge: true }
        )
    }

    const saveDirectorProfile = async (vals?: any) => {
        if (!userId) return
        const values = vals ?? (await directorForm.validateFields())
        await setDoc(
            doc(db, 'users', userId),
            { company: values.company },
            { merge: true }
        )
        setDirectorProfileComplete(true)
        message.success('Company details saved.')
    }

    // Navigation helpers (skip completed)
    const goNext = () => {
        setDirection(1)
        let idx = current + 1
        while (idx < visibleSteps.length && visibleSteps[idx].isComplete) idx++
        setCurrent(Math.min(idx, visibleSteps.length - 1))
    }
    const goPrev = () => {
        setDirection(-1)
        setCurrent(Math.max(0, current - 1))
    }

    useEffect(() => {
        if (sigMode !== 'drawn') return
        const pad = sigPadRef.current
        if (!pad) return
        const update = () => {
            // Inside the border, so pen and ink line up exactly.
            const width = pad.clientWidth
            if (width > 0) setSigPadWidth(width)
        }
        update()
        const observer = new ResizeObserver(update)
        observer.observe(pad)
        return () => observer.disconnect()
    }, [sigMode, currentKey])

    // Back / Next and the like: one row, the buttons sharing it evenly.
    const actionRow = (children: React.ReactNode, marginTop = 16) => (
        <div
            style={{
                display: 'grid',
                gridAutoFlow: 'column',
                gridAutoColumns: 'minmax(0, 1fr)',
                gap: 12,
                marginTop
            }}
        >
            {children}
        </div>
    )
    const backButton = (disabled?: boolean) => (
        <Button size='large' block icon={<ArrowLeftOutlined />} onClick={goPrev} disabled={disabled}>
            Back
        </Button>
    )
    // The last step's button finishes rather than moving on.
    const isLastStep = current >= visibleSteps.length - 1
    const nextButton = (props: { disabled?: boolean; onClick?: () => void }) => (
        <Button
            size='large'
            block
            type='primary'
            icon={isLastStep ? <CheckOutlined /> : <ArrowRightOutlined />}
            iconPosition='end'
            disabled={props.disabled}
            onClick={props.onClick ?? goNext}
        >
            {isLastStep ? 'Finish' : 'Next'}
        </Button>
    )

    // OAuth helpers (kept for future when consent step is re-enabled)
    const openAuthUrl = (authUrl: string) => {
        window.location.href = authUrl
    }

    const oauthStartSafe = async (provider: ProviderKey) => {
        const u = auth.currentUser
        if (!u) throw new Error('Not signed in')
        const idToken = await u.getIdToken(true)

        try {
            const res = await fetch(`${FUNCTIONS_BASE}/oauth/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({ provider, redirect: window.location.origin })
            })
            if (!res.ok) throw new Error(await res.text())
            const data = await res.json()
            if (!data?.authUrl) throw new Error('No authUrl returned')
            openAuthUrl(data.authUrl)
        } catch (e) {
            if (provider === 'google') {
                const url = `${FUNCTIONS_BASE}/googleOAuthStart?idToken=${encodeURIComponent(
                    idToken
                )}&redirect=${encodeURIComponent(window.location.origin)}`
                openAuthUrl(url)
                return
            }
            throw e
        }
    }

    const handleConnect = async (provider: ProviderKey) => {
        try {
            setConnecting(provider)
            await oauthStartSafe(provider)
            message.info('Complete consent; you’ll be redirected back here.')
        } catch (e: any) {
            message.error(e?.message || 'Could not start connection')
        } finally {
            setConnecting(null)
        }
    }

    const handleReconnect = async (provider: ProviderKey) => {
        await handleConnect(provider)
    }

    const handleDisconnect = async (provider: ProviderKey) => {
        const u = auth.currentUser
        if (!u) {
            message.error('Not signed in')
            return
        }
        try {
            const idToken = await u.getIdToken(true)
            const res = await fetch(`${FUNCTIONS_BASE}/oauth/revoke`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({ provider })
            })
            if (!res.ok) throw new Error(await res.text())
            message.success('Disconnected')
        } catch (e: any) {
            message.error(e?.message || 'Failed to disconnect')
        }
    }

    // Final redirect (role-aware)
    const finish = async () => {
        if (!userId) return

        // mark welcome complete. After a password-only visit the rest of the setup
        // (POPIA, WhatsApp, signature) has not happened yet, so it is left to appear next time.
        if (!passwordOnly) {
            await setDoc(
                doc(db, 'users', userId),
                {
                    firstLoginComplete: true,
                    firstLoginCompletedAt: Timestamp.now()
                },
                { merge: true }
            )
        }

        // role + email
        const uref = await getDoc(doc(db, 'users', userId))
        const r = roleKey((uref.data() as any)?.role)
        const email = auth.currentUser?.email || ''

        // Helper to normalize statuses
        const norm = (v?: string) => (v || '').trim().toLowerCase()

        if (r === 'incubatee') {
            // find applications by email
            const appsSnap = await getDocs(
                query(collection(db, 'applications'), where('email', '==', email))
            )
            const apps = appsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))

            // no app → go to SME registration
            if (apps.length === 0) return navigate('/applicant')

            // pick accepted / pending
            const pending = apps.find(app =>
                ['pending', ''].includes(norm(app.applicationStatus))
            )
            const accepted = apps.find(
                app => norm(app.applicationStatus) === 'accepted'
            )

            // if accepted → check GAP
            if (accepted) {
                const gapDone = norm(accepted.gapAnalysisStatus) === 'completed'
                if (!gapDone) {
                    // fetch participant (for prefill)
                    const participantsSnap = await getDocs(
                        query(collection(db, 'participants'), where('email', '==', email))
                    )
                    const participantDoc = participantsSnap.docs[0]
                    const participant = participantDoc
                        ? { id: participantDoc.id, ...(participantDoc.data() as any) }
                        : null

                    return navigate('/incubatee/gap-analysis', {
                        state: {
                            participantId: participant?.id ?? null,
                            prefillData: {
                                companyName: participant?.beneficiaryName ?? '',
                                region: participant?.province ?? '',
                                contactDetails: participant?.phone ?? '',
                                email: participant?.email ?? email,
                                dateOfEngagement: accepted?.dateAccepted ?? null
                            }
                        }
                    })
                }

                // GAP already completed → plan review, then the incubatee dashboard
                return navigate('/plan-review')
            }

            // if pending → tracker
            if (pending) return navigate('/applicant/tracker')

            // fallback → SME registration
            return navigate('/applicant')
        }

        // non-incubatee roles
        navigate(r === 'training_sme' ? '/training' : `/${r || 'unknown'}`)
    }

    // Subscribe to connections docs (for when consent returns)
    useEffect(() => {
        if (!userId) return
        const unsub = onSnapshot(
            collection(db, 'users', userId, 'connections'),
            snap => {
                const next: Record<ProviderKey, ConnectionDoc | undefined> = {
                    google: undefined,
                    microsoft: undefined,
                    zoom: undefined
                }
                snap.forEach(d => {
                    const id = d.id as ProviderKey
                    if (id === 'google' || id === 'microsoft' || id === 'zoom') {
                        const data = d.data() as any
                        next[id] = {
                            provider: id,
                            status: data.status ?? 'connected',
                            updatedAt: data.updatedAt,
                            scopes: data.scopes ?? [],
                            hasRefreshToken: !!data.hasRefreshToken,
                            externalAccountEmail: data.externalAccountEmail ?? undefined
                        }
                    }
                })
                setConnections(next)
            }
        )
        return () => unsub()
    }, [userId])

    useEffect(() => {
        const url = new URL(window.location.href)
        const connected = url.searchParams.get('connected') as ProviderKey | null
        if (
            connected &&
            (connected === 'google' ||
                connected === 'microsoft' ||
                connected === 'zoom')
        ) {
            url.searchParams.delete('connected')
            window.history.replaceState({}, '', url.toString())
            message.success(
                `${connected[0].toUpperCase()}${connected.slice(1)} connected`
            )
        }
    }, [])

    // ---- Renderers ----
    // Lists only what this visit asks for, so someone back for one item is not
    // told about steps they finished long ago.
    const renderWelcome = () => {
        const tasks = visibleSteps.filter(step => step.key !== 'welcome' && STEP_ASK[step.key as WelcomeStepKey])
        const firstName = String(user?.name || '').trim().split(/\s+/)[0]
        const greeting = firstVisit
            ? `Welcome${firstName ? `, ${firstName}` : ''}! 👋`
            : `Welcome back${firstName ? `, ${firstName}` : ''} 👋`
        const intro = firstVisit
            ? 'We’re glad you’re here. A few quick steps and you’re ready to go.'
            : tasks.length === 1
                ? 'Just one quick thing before you carry on. It only takes a minute.'
                : 'Just a couple of quick things before you carry on. They only take a minute.'
        return (
            <div style={{ textAlign: 'center' }}>
                <div
                    aria-hidden='true'
                    style={{
                        width: 64,
                        height: 64,
                        margin: '4px auto 16px',
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 30,
                        color: token.colorPrimary,
                        background: token.colorPrimaryBg
                    }}
                >
                    <SmileOutlined />
                </div>
                <Title level={2} style={{ margin: 0 }}>
                    {greeting}
                </Title>
                <Paragraph type='secondary' style={{ fontSize: 15, margin: '8px 0 24px' }}>
                    {intro}
                </Paragraph>

                <ol style={{ listStyle: 'none', padding: 0, margin: 0, textAlign: 'left', display: 'grid', gap: 10 }}>
                    {tasks.map((step, index) => (
                        <li
                            key={step.key}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 14,
                                padding: '14px 16px',
                                borderRadius: 12,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorFillQuaternary
                            }}
                        >
                            <span
                                aria-hidden='true'
                                style={{
                                    flex: '0 0 auto',
                                    width: 38,
                                    height: 38,
                                    borderRadius: 10,
                                    display: 'grid',
                                    placeItems: 'center',
                                    fontSize: 18,
                                    color: token.colorPrimary,
                                    background: token.colorPrimaryBg
                                }}
                            >
                                {step.icon}
                            </span>
                            <span style={{ minWidth: 0 }}>
                                <Text strong style={{ display: 'block' }}>
                                    {tasks.length > 1 ? `${index + 1}. ` : ''}{STEP_ASK[step.key as WelcomeStepKey]}
                                </Text>
                                {STEP_HINT[step.key as WelcomeStepKey] && (
                                    <Text type='secondary' style={{ fontSize: 13 }}>
                                        {STEP_HINT[step.key as WelcomeStepKey]}
                                    </Text>
                                )}
                            </span>
                        </li>
                    ))}
                </ol>

                <Button
                    type='primary'
                    size='large'
                    block
                    onClick={goNext}
                    style={{ marginTop: 24 }}
                >
                    {firstVisit || tasks.length > 1 ? 'Let’s get started' : 'Continue'} <ArrowRightOutlined />
                </Button>
            </div>
        )
    }

    const reauthAndRetryPasswordUpdate = async (newPassword: string) => {
        const cur = auth.currentUser
        if (!cur) throw new Error('Not signed in')

        const providerId = cur.providerData?.[0]?.providerId // 'password' | 'google.com' | 'microsoft.com' | etc.

        // Branch by provider
        if (providerId === 'password') {
            // Ask for current password in a modal, then reauth
            return new Promise<void>((resolve, reject) => {
                const modal = Modal.confirm({
                    title: 'Re-authentication required',
                    content: (
                        <Form
                            layout='vertical'
                            onFinish={async (vals: any) => {
                                try {
                                    const cred = EmailAuthProvider.credential(
                                        cur.email || '',
                                        vals.currentPassword
                                    )
                                    await reauthenticateWithCredential(cur, cred)
                                    await updatePassword(cur, newPassword)
                                    modal.destroy()
                                    resolve()
                                } catch (e: any) {
                                    message.error(e?.message || 'Re-authentication failed.')
                                }
                            }}
                        >
                            <Form.Item
                                name='currentPassword'
                                label='Current password'
                                rules={[
                                    {
                                        required: true,
                                        message: 'Please enter your current password'
                                    }
                                ]}
                            >
                                <Input.Password autoFocus />
                            </Form.Item>
                            <Button type='primary' htmlType='submit'>
                                Confirm
                            </Button>
                        </Form>
                    ),
                    icon: null,
                    okButtonProps: { style: { display: 'none' } },
                    cancelText: 'Cancel',
                    onCancel: () => reject(new Error('User cancelled re-authentication'))
                })
            })
        }

        // Google reauth (popup)
        if (providerId === 'google.com') {
            const g = new GoogleAuthProvider()
            await reauthenticateWithPopup(cur, g)
            await updatePassword(cur, newPassword)
            return
        }

        // Microsoft reauth (popup)
        if (providerId === 'microsoft.com') {
            const ms = new OAuthProvider('microsoft.com')
            await reauthenticateWithPopup(cur, ms)
            await updatePassword(cur, newPassword)
            return
        }

        // Fallback: ask for password as last resort (for any other provider)
        return new Promise<void>((resolve, reject) => {
            const modal = Modal.confirm({
                title: 'Re-authentication required',
                content: (
                    <Form
                        layout='vertical'
                        onFinish={async (vals: any) => {
                            try {
                                const cred = EmailAuthProvider.credential(
                                    cur.email || '',
                                    vals.currentPassword
                                )
                                await reauthenticateWithCredential(cur, cred)
                                await updatePassword(cur, newPassword)
                                modal.destroy()
                                resolve()
                            } catch (e: any) {
                                message.error(e?.message || 'Re-authentication failed.')
                            }
                        }}
                    >
                        <Form.Item
                            name='currentPassword'
                            label='Current password'
                            rules={[
                                {
                                    required: true,
                                    message: 'Please enter your current password'
                                }
                            ]}
                        >
                            <Input.Password autoFocus />
                        </Form.Item>
                        <Button type='primary' htmlType='submit'>
                            Confirm
                        </Button>
                    </Form>
                ),
                icon: null,
                okButtonProps: { style: { display: 'none' } },
                cancelText: 'Cancel',
                onCancel: () => reject(new Error('User cancelled re-authentication'))
            })
        })
    }

    const renderPassword = () => (
        <Card>
            <Title level={4} style={{ marginTop: 0 }}>
                Change your default password
            </Title>
            <Alert
                type='warning'
                showIcon
                style={{ marginBottom: 12 }}
                message='Default password in use'
                description={
                    <span>
                        For security, please change the default password <b>Password@1</b>{' '}
                        now.
                    </span>
                }
            />
            <Form
                form={pwdForm}
                layout='vertical'
                onFinish={async (vals: any) => {
                    const cur = auth.currentUser
                    if (!cur) return message.error('You are not signed in')
                    setSavingPwd(true)
                    try {
                        await updatePassword(cur, vals.newPassword)
                        await setDoc(
                            doc(db, 'users', cur.uid),
                            { mustChangePassword: false, passwordChangedAt: Timestamp.now() },
                            { merge: true }
                        )
                        setPwdStepComplete(true)
                        setMustChangePassword(false)
                        message.success('Password updated.')
                        goNext()
                    } catch (e: any) {
                        if (e?.code === 'auth/requires-recent-login') {
                            try {
                                await reauthAndRetryPasswordUpdate(vals.newPassword)
                                await setDoc(
                                    doc(db, 'users', cur.uid),
                                    {
                                        mustChangePassword: false,
                                        passwordChangedAt: Timestamp.now()
                                    },
                                    { merge: true }
                                )
                                setPwdStepComplete(true)
                                setMustChangePassword(false)
                                message.success('Password updated.')
                                goNext()
                            } catch {
                                // user cancelled or failed; message already shown
                            }
                        } else {
                            message.error(e?.message || 'Failed to update password.')
                        }
                    } finally {
                        setSavingPwd(false)
                    }
                }}
            >
                <Form.Item
                    name='newPassword'
                    label='New password'
                    rules={[
                        { required: true, message: 'Please enter a new password' },
                        { min: 8, message: 'Use at least 8 characters' },
                        {
                            validator: (_, v) =>
                                v === 'Password@1'
                                    ? Promise.reject(
                                        new Error(
                                            'Please choose a password different from the default'
                                        )
                                    )
                                    : Promise.resolve()
                        },
                        {
                            pattern: /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/,
                            message: 'Add an uppercase, a number and a symbol'
                        }
                    ]}
                    hasFeedback
                >
                    <Input.Password placeholder='Enter a strong password' />
                </Form.Item>

                <Form.Item
                    name='confirmPassword'
                    label='Confirm new password'
                    dependencies={['newPassword']}
                    hasFeedback
                    rules={[
                        { required: true, message: 'Please confirm the password' },
                        ({ getFieldValue }) => ({
                            validator(_, value) {
                                return !value || getFieldValue('newPassword') === value
                                    ? Promise.resolve()
                                    : Promise.reject(new Error('Passwords do not match'))
                            }
                        })
                    ]}
                >
                    <Input.Password placeholder='Re-enter password' />
                </Form.Item>

                {actionRow(
                    <>
                        {!passwordOnly && backButton(savingPwd)}
                        <Button
                            size='large'
                            block
                            type='primary'
                            htmlType='submit'
                            icon={<SafetyCertificateOutlined />}
                            loading={savingPwd}
                            disabled={savingPwd}
                        >
                            Update Password
                        </Button>
                    </>,
                    8
                )}
            </Form>
        </Card>
    )

    // The notice is read and signed right here, not in a window on top of the wizard.
    const renderPopia = () => (
        <>
            <Card>
                <Title level={4} style={{ marginTop: 0 }}>
                    POPIA privacy notice
                </Title>
                {popiaSigned ? (
                    <>
                        <Alert
                            type='success'
                            showIcon
                            message='POPIA notice signed'
                            description='Thank you. A signed copy is kept with your account.'
                        />
                        {popiaPdfUrl && (
                            <Button
                                size='large'
                                block
                                icon={<DownloadOutlined />}
                                href={popiaPdfUrl}
                                target='_blank'
                                rel='noopener noreferrer'
                                style={{ marginTop: 12 }}
                            >
                                Download signed copy
                            </Button>
                        )}
                    </>
                ) : (
                    <>
                        <Paragraph type='secondary'>
                            Please read how we collect, use and protect your personal information,
                            then tick the box at the end and sign.
                        </Paragraph>
                        <PopiaContractModal
                            inline
                            open
                            participantId={participantId || ''}
                            onClose={() => undefined}
                            onSigned={meta => {
                                setPopiaPdfUrl(meta.pdfUrl || '')
                                setPopiaSigned(true)
                            }}
                        />
                    </>
                )}
            </Card>
            {actionRow(
                <>
                    {backButton()}
                    {nextButton({ disabled: !popiaSigned })}
                </>
            )}
        </>
    )

    const renderWhatsApp = () => (
        <>
            <Card>
                <Title level={4} style={{ marginTop: 0 }}>
                    Updates on WhatsApp
                </Title>
                {userId ? (
                    <WhatsAppConsentCard
                        userId={userId}
                        initialNumber={whatsappNumber}
                        source='welcome'
                        onAnswered={() => {
                            setWhatsappAnswered(true)
                            goNext()
                        }}
                        onLater={() => {
                            setWhatsappSkipped(true)
                            goNext()
                        }}
                    />
                ) : null}
            </Card>
            {actionRow(backButton())}
        </>
    )

    const renderDirectorProfile = () => (
        <>
            <Card>
                <Title level={4} style={{ marginTop: 0 }}>
                    Company Details
                </Title>
                <Form
                    form={directorForm}
                    layout='vertical'
                    onFinish={saveDirectorProfile}
                >
                    <Form.Item
                        name='company'
                        label='Company Name'
                        rules={[{ required: true, message: 'Please enter company name' }]}
                    >
                        <Input />
                    </Form.Item>
                    <Button size='large' block type='primary' htmlType='submit' icon={<SaveOutlined />}>
                        Save
                    </Button>
                </Form>
            </Card>
            {actionRow(
                <>
                    {backButton()}
                    {nextButton({
                        disabled: !directorProfileComplete,
                        onClick: async () => {
                            await saveDirectorProfile()
                            goNext()
                        }
                    })}
                </>
            )}
        </>
    )

    const renderSignature = () => (
        <>
            <Card>
                <Title level={4} style={{ marginTop: 0 }}>
                    Set up your signature
                </Title>
                <Spin spinning={savingSig}>
                    {signatureURL && (
                        <Alert
                            type='success'
                            showIcon
                            message='Signature on file'
                            description='You can replace it using one of the methods below.'
                            style={{ marginBottom: 12 }}
                        />
                    )}

                    {/* Large, full-width choice: the radio buttons were easy to miss. */}
                    <Segmented
                        block
                        size='large'
                        value={sigMode}
                        onChange={value => setSigMode(value as typeof sigMode)}
                        style={{ marginBottom: 16 }}
                        // On phones the icon sits above the word, so all three fit uncut.
                        options={([
                            ['typed', 'Type', <FontSizeOutlined key='t' />],
                            ['drawn', 'Draw', <EditOutlined key='d' />],
                            ['upload', 'Upload', <UploadOutlined key='u' />]
                        ] as const).map(([value, text, icon]) =>
                            isMobile
                                ? {
                                    value,
                                    label: (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 0', lineHeight: 1.2 }}>
                                            <span style={{ fontSize: 18 }}>{icon}</span>
                                            <span>{text}</span>
                                        </div>
                                    )
                                }
                                : { value, label: text, icon }
                        )}
                    />

                    {/* TYPED */}
                    {sigMode === 'typed' && (
                        <div>
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 2fr) minmax(0, 1fr)',
                                    gap: 12,
                                    marginBottom: 12
                                }}
                            >
                                <Input
                                    size='large'
                                    placeholder='Your full name'
                                    value={typedName}
                                    onChange={e => setTypedName(e.target.value)}
                                />
                                <Select
                                    size='large'
                                    value={typedFont}
                                    onChange={setTypedFont}
                                    style={{ width: '100%' }}
                                >
                                    {FONT_OPTIONS.map(f => (
                                        <Option key={f} value={f}>
                                            {f}
                                        </Option>
                                    ))}
                                </Select>
                            </div>
                            {/* keep-light: this box is photographed into the signature PNG, so the
                                dark theme must not repaint it (that would save light ink on dark). */}
                            <div
                                ref={styledRef}
                                className='keep-light'
                                style={{
                                    fontFamily: `${typedFont}, cursive`,
                                    fontSize: isMobile ? 34 : 44,
                                    padding: '16px 24px',
                                    border: '1px dashed #aaa',
                                    borderRadius: 8,
                                    background: '#fff',
                                    color: '#111',
                                    textAlign: 'center',
                                    overflowWrap: 'anywhere'
                                }}
                            >
                                {typedName || 'Your styled signature'}
                            </div>
                            {actionRow(
                                <Button
                                    size='large'
                                    block
                                    type='primary'
                                    icon={<SaveOutlined />}
                                    onClick={saveTypedSignature}
                                    disabled={!typedName.trim()}
                                >
                                    {isMobile ? 'Save signature' : 'Save Typed Signature'}
                                </Button>,
                                12
                            )}
                        </div>
                    )}

                    {/* DRAWN */}
                    {sigMode === 'drawn' && (
                        <div>
                            <div
                                ref={sigPadRef}
                                className='keep-light'
                                style={{
                                    border: '1px dashed #aaa',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    width: '100%',
                                    height: 200,
                                    position: 'relative',
                                    background: '#fff'
                                }}
                            >
                                <SignatureCanvas
                                    ref={canvasRef}
                                    penColor='black'
                                    canvasProps={{
                                        width: sigPadWidth,
                                        height: 200,
                                        style: { display: 'block', width: '100%', height: 200, cursor: 'crosshair' }
                                    }}
                                />
                            </div>
                            {actionRow(
                                <>
                                    <Button size='large' block icon={<ClearOutlined />} onClick={clearDrawnSignature}>
                                        Clear
                                    </Button>
                                    <Button
                                        size='large'
                                        block
                                        type='primary'
                                        icon={<SaveOutlined />}
                                        onClick={saveDrawnSignature}
                                    >
                                        {isMobile ? 'Save' : 'Save Drawn Signature'}
                                    </Button>
                                </>,
                                12
                            )}
                        </div>
                    )}

                    {/* UPLOAD (optional) */}
                    {sigMode === 'upload' && (
                        <>
                            <Alert
                                type='info'
                                showIcon
                                message='Upload an image of your signature (PNG/JPG).'
                                style={{ marginBottom: 12 }}
                            />
                            <Dragger {...uploadProps}>
                                <p className='ant-upload-drag-icon'>
                                    <InboxOutlined />
                                </p>
                                <p className='ant-upload-text'>
                                    Click or drag a signature image to this area to upload
                                </p>
                                <p className='ant-upload-hint'>
                                    We’ll store it securely and attach it to approvals you make on
                                    the platform.
                                </p>
                            </Dragger>
                        </>
                    )}

                    {signatureURL && (
                        <div
                            className='keep-light'
                            style={{
                                marginTop: 16,
                                padding: 12,
                                background: '#fff',
                                borderRadius: 8,
                                border: `1px dashed ${token.colorBorder}`,
                                textAlign: 'center'
                            }}
                        >
                            <img
                                src={signatureURL}
                                alt='Your signature'
                                style={{ maxHeight: 90, maxWidth: '100%' }}
                            />
                        </div>
                    )}
                </Spin>
            </Card>

            {actionRow(
                <>
                    {backButton()}
                    {nextButton({ disabled: !signatureURL })}
                </>
            )}
        </>
    )

    // Hidden for now (kept for when you re-enable)
    const renderConsent = () => {
        const g = connections.google
        const m = connections.microsoft
        const z = connections.zoom

        const statusTag = (c?: ConnectionDoc) =>
            c?.status === 'connected' ? (
                <Tag color='green'>Connected</Tag>
            ) : (
                <Tag>Not connected</Tag>
            )

        return (
            <>
                <Card>
                    <Title level={4} style={{ marginTop: 0 }}>
                        Consent to connect email & meetings
                    </Title>
                    <Paragraph style={{ marginBottom: 8 }}>
                        With your permission, we’ll connect your email/calendar and meeting
                        tools to make scheduling and communications seamless.
                    </Paragraph>

                    <Checkbox
                        checked={consentGiven}
                        onChange={e => setConsentGiven(e.target.checked)}
                    >
                        I consent to connect my mailbox & calendar for this account.
                    </Checkbox>

                    <div
                        style={{
                            marginTop: 12,
                            padding: 12,
                            borderRadius: 8,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            background: token.colorFillAlter
                        }}
                    >
                        <Text strong>Choose providers you want to enable:</Text>
                        <div style={{ marginTop: 8 }}>
                            <Checkbox
                                checked={consentVendors.google}
                                onChange={e =>
                                    setConsentVendors(s => ({ ...s, google: e.target.checked }))
                                }
                            >
                                Google (Gmail & Calendar)
                            </Checkbox>
                            <br />
                            <Checkbox
                                checked={consentVendors.zoom}
                                onChange={e =>
                                    setConsentVendors(s => ({ ...s, zoom: e.target.checked }))
                                }
                            >
                                Zoom
                            </Checkbox>
                            <br />
                            <Checkbox
                                checked={consentVendors.teams}
                                onChange={e =>
                                    setConsentVendors(s => ({ ...s, teams: e.target.checked }))
                                }
                            >
                                Microsoft Teams
                            </Checkbox>
                        </div>

                        {/* Quick connection cards */}
                        <div style={{ marginTop: 12 }}>
                            <Card size='small' style={{ marginBottom: 8 }}>
                                <Space
                                    style={{ width: '100%', justifyContent: 'space-between' }}
                                >
                                    <div>
                                        <Text strong>Google</Text>
                                        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                                            {g?.externalAccountEmail || '—'}
                                        </div>
                                    </div>
                                    <Space>
                                        {statusTag(g)}
                                        {g?.status === 'connected' ? (
                                            <Space>
                                                <Button
                                                    onClick={() => handleReconnect('google')}
                                                    disabled={!consentGiven}
                                                    loading={connecting === 'google'}
                                                >
                                                    Re-connect
                                                </Button>
                                                <Button
                                                    danger
                                                    onClick={() => handleDisconnect('google')}
                                                    disabled={!consentGiven}
                                                >
                                                    Disconnect
                                                </Button>
                                            </Space>
                                        ) : (
                                            <Button
                                                type='primary'
                                                onClick={() => handleConnect('google')}
                                                disabled={
                                                    !consentGiven ||
                                                    !consentVendors.google ||
                                                    connecting !== null
                                                }
                                                loading={connecting === 'google'}
                                            >
                                                Connect
                                            </Button>
                                        )}
                                    </Space>
                                </Space>
                                <div style={{ marginTop: 6, fontSize: 12, color: token.colorTextTertiary }}>
                                    Last updated:{' '}
                                    {g?.updatedAt ? g.updatedAt.toDate().toLocaleString() : '—'}
                                </div>
                            </Card>

                            <Card size='small' style={{ marginBottom: 8 }}>
                                <Space
                                    style={{ width: '100%', justifyContent: 'space-between' }}
                                >
                                    <div>
                                        <Text strong>Microsoft 365 (Outlook & Teams)</Text>
                                        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                                            {m?.externalAccountEmail || '—'}
                                        </div>
                                    </div>
                                    <Space>
                                        {statusTag(m)}
                                        {m?.status === 'connected' ? (
                                            <Space>
                                                <Button
                                                    onClick={() => handleReconnect('microsoft')}
                                                    disabled={!consentGiven}
                                                    loading={connecting === 'microsoft'}
                                                >
                                                    Re-connect
                                                </Button>
                                                <Button
                                                    danger
                                                    onClick={() => handleDisconnect('microsoft')}
                                                    disabled={!consentGiven}
                                                >
                                                    Disconnect
                                                </Button>
                                            </Space>
                                        ) : (
                                            <Button
                                                type='primary'
                                                onClick={() => handleConnect('microsoft')}
                                                disabled={
                                                    !consentGiven ||
                                                    !consentVendors.teams ||
                                                    connecting !== null
                                                }
                                                loading={connecting === 'microsoft'}
                                            >
                                                Connect
                                            </Button>
                                        )}
                                    </Space>
                                </Space>
                                <div style={{ marginTop: 6, fontSize: 12, color: token.colorTextTertiary }}>
                                    Last updated:{' '}
                                    {m?.updatedAt ? m.updatedAt.toDate().toLocaleString() : '—'}
                                </div>
                            </Card>

                            <Card size='small'>
                                <Space
                                    style={{ width: '100%', justifyContent: 'space-between' }}
                                >
                                    <div>
                                        <Text strong>Zoom</Text>
                                        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                                            {z?.externalAccountEmail || '—'}
                                        </div>
                                    </div>
                                    <Space>
                                        {statusTag(z)}
                                        {z?.status === 'connected' ? (
                                            <Space>
                                                <Button
                                                    onClick={() => handleReconnect('zoom')}
                                                    disabled={!consentGiven}
                                                    loading={connecting === 'zoom'}
                                                >
                                                    Re-connect
                                                </Button>
                                                <Button
                                                    danger
                                                    onClick={() => handleDisconnect('zoom')}
                                                    disabled={!consentGiven}
                                                >
                                                    Disconnect
                                                </Button>
                                            </Space>
                                        ) : (
                                            <Button
                                                type='primary'
                                                onClick={() => handleConnect('zoom')}
                                                disabled={
                                                    !consentGiven ||
                                                    !consentVendors.zoom ||
                                                    connecting !== null
                                                }
                                                loading={connecting === 'zoom'}
                                            >
                                                Connect
                                            </Button>
                                        )}
                                    </Space>
                                </Space>
                                <div style={{ marginTop: 6, fontSize: 12, color: token.colorTextTertiary }}>
                                    Last updated:{' '}
                                    {z?.updatedAt ? z.updatedAt.toDate().toLocaleString() : '—'}
                                </div>
                            </Card>
                        </div>
                    </div>
                </Card>

                <div style={{ marginTop: 16 }}>
                    <Space style={{ width: '100%' }} wrap>
                        <Button onClick={goPrev} block={isMobile}>
                            Back
                        </Button>
                        <Button
                            type='primary'
                            onClick={async () => {
                                await persistConsent()
                                Modal.success({
                                    title: 'All set!',
                                    content:
                                        'Your setup is complete. You can change any of this later from your profile.',
                                    onOk: finish
                                })
                            }}
                            disabled={!consentGiven}
                            block={isMobile}
                        >
                            Finish
                        </Button>
                    </Space>
                </div>
            </>
        )
    }

    // --- Completed fallback: shown if all steps complete OR an unknown key is selected
    // Names what this visit saved, rather than a generic "first-time setup".
    const renderCompleted = () => {
        const saved = plannedTasks.map(key => STEP_SAVED[key]).filter(Boolean) as string[]
        const description = passwordOnly
            ? 'Your account is secure. The rest of your setup will appear the next time you sign in.'
            : saved.length
                ? `${joinList(saved).replace(/^./, c => c.toUpperCase())} ${saved.length === 1 ? 'is' : 'are'} saved. You can continue to the system now.`
                : 'Everything on your account is already set up. You can continue to the system now.'
        return (
        <Card>
            <Alert
                type='success'
                showIcon
                message={passwordOnly ? 'Password updated' : saved.length ? 'All done' : 'Nothing to set up'}
                description={description}
                style={{ marginBottom: 12 }}
            />
            <Button
                size='large'
                block
                type='primary'
                icon={<ArrowRightOutlined />}
                iconPosition='end'
                onClick={finish}
            >
                Continue to the system
            </Button>
        </Card>
        )
    }

    // View map + safe lookup
    const viewMap: Record<string, JSX.Element> = {
        welcome: renderWelcome(),
        password: renderPassword(),
        popia: renderPopia(),
        whatsapp: renderWhatsApp(),
        directorProfile: renderDirectorProfile(),
        signature: renderSignature(),
        consent: renderConsent(), // not reachable while HIDE_CONSENT = true
        completed: renderCompleted()
    }

    // If everything is already done, show the completed fallback
    const allComplete = visibleSteps.every(s => s.isComplete)
    // The steps that ask for something, without the welcome screen.
    const taskSteps = visibleSteps.filter(s => s.key !== 'welcome')

    return (
        <>
            {/* Wait for the step list too, or "Nothing to set up" flashes first. */}
            {loading || !plan ? (
                <DashboardLoader overlay label='Getting everything ready...' />
            ) : (
                <div
                    style={{
                        minHeight: '100vh',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: isMobile ? 16 : 24,
                        background: token.colorBgLayout
                    }}
                >
                    <Card
                        style={{
                            width: '100%',
                            maxWidth: 880,
                            borderRadius: 12,
                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                            margin: 0,
                            // Keeps the sliding screens from widening the page mid-move.
                            overflow: 'hidden'
                        }}
                        styles={{ body: { padding: isMobile ? 16 : 24 } }}
                        // Phones: the step cards inside drop their own frame and padding,
                        // so the content gets the whole width.
                        className='ww-shell'
                    >
                        {isMobile && (
                            <style>{`.ww-shell .ant-card { border: 0; background: transparent; box-shadow: none; } .ww-shell .ant-card > .ant-card-body { padding: 0; }`}</style>
                        )}
                        {/* Each screen slides in from the side it is moving towards
                            (a plain fade with reduced motion). */}
                        <AnimatePresence mode='wait' initial={false} custom={direction}>
                        <motion.div
                            key={allComplete ? 'completed' : currentKey ?? 'none'}
                            custom={direction}
                            variants={{
                                enter: (dir: number) => ({ opacity: 0, x: reduceMotion ? 0 : dir * 48 }),
                                center: { opacity: 1, x: 0 },
                                exit: (dir: number) => ({ opacity: 0, x: reduceMotion ? 0 : dir * -48 })
                            }}
                            initial='enter'
                            animate='center'
                            exit='exit'
                            transition={{ duration: reduceMotion ? 0.12 : 0.28, ease: [0.22, 0.8, 0.2, 1] }}
                        >
                        {/* The welcome screen is its own greeting; the other steps get a
                            title and a quiet "Step x of y" line in place of a step bar. */}
                        {!allComplete && currentKey !== 'welcome' && (
                            <>
                                <Title level={isMobile ? 4 : 3} style={{ marginTop: 0, marginBottom: 4 }}>
                                    {passwordOnly
                                        ? 'Secure your account'
                                        : firstVisit
                                            ? 'First-time Setup'
                                            : 'Finish setting up your account'}
                                </Title>
                                {taskSteps.length > 1 && (
                                    <div style={{ marginBottom: 16, color: token.colorTextSecondary }}>
                                        Step {taskSteps.findIndex(s => s.key === currentKey) + 1} of {taskSteps.length}:{' '}
                                        <b>{visibleSteps[current]?.title}</b>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Body with safe fallback */}
                        {allComplete
                            ? viewMap.completed
                            : viewMap[currentKey ?? ''] ?? viewMap.completed}
                        </motion.div>
                        </AnimatePresence>
                    </Card>
                </div>
            )}
        </>
    )
}

export default WelcomeWizard
