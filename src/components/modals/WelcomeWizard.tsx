import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Steps,
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
    Radio,
    Select,
    Tag
} from 'antd'
import {
    SmileOutlined,
    SafetyCertificateOutlined,
    EditOutlined,
    CloudSyncOutlined,
    SolutionOutlined,
    InboxOutlined
} from '@ant-design/icons'
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
import { LoadingOverlay } from '../shared/LoadingOverlay'

const { Title, Paragraph, Text } = Typography
const { Dragger } = Upload
const { useBreakpoint } = Grid
const { Option } = Select

type Role =
    | 'admin'
    | 'consultant'
    | 'incubatee'
    | 'operations'
    | 'director'
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

const FUNCTIONS_BASE = 'https://us-central1-lph-smart-inc.cloudfunctions.net'
const FONT_OPTIONS = ['Dancing Script', 'Great Vibes', 'Pacifico', 'Satisfy']
const roleKey = (r?: string): Role =>
    (r || '').toLowerCase().replace(/\s+/g, '') as Role

// Toggle off to bring consent back later
const HIDE_CONSENT = true

const WelcomeWizard: React.FC = () => {
    const navigate = useNavigate()
    const { user } = useFullIdentity()
    const screens = useBreakpoint()
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
    const [popiaModalOpen, setPopiaModalOpen] = useState(false)
    const [popiaSigned, setPopiaSigned] = useState(false)
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

            // POPIA check
            if (!ps.empty) {
                const pid = ps.docs[0].id
                const apps = await getDocs(
                    query(
                        collection(db, 'applications'),
                        where('participantId', '==', pid)
                    )
                )
                if (!apps.empty) {
                    const first = apps.docs[0].data() as any
                    const signed = { ...(first?.signedAgreements || {}) }
                    const legacy = Array.isArray(first?.signContracts)
                        ? first.signContracts
                        : Array.isArray(first?.signedContracts)
                            ? first.signedContracts
                            : []
                    legacy.forEach((slug: string) => {
                        if (!signed[slug]) signed[slug] = true
                    })
                    setPopiaSigned(!!signed['popia-act'])
                }
            }

            // Must-change-password logic
            const needsResetFromDoc = profile?.mustChangePassword
            const nonIncubatee = (r || 'unknown') !== 'incubatee'
            const must =
                typeof needsResetFromDoc === 'boolean'
                    ? needsResetFromDoc
                    : nonIncubatee
            setMustChangePassword(must)
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

        if (userRole !== 'incubatee') {
            const maybePwd = mustChangePassword ? [passwordStep] : []
            // NEW: only show company step for directors when mustRegisterCompany is true
            const maybeDirector =
                userRole === 'director' && mustRegisterCompany ? [director] : []
            const adminish = [...maybePwd, ...maybeDirector, sig, consent]
            return [...base, ...adminish]
        }

        // Incubatees flow
        return [...base, popia, sig, consent]
    }, [
        userRole,
        popiaSigned,
        signatureURL,
        consentGiven,
        directorProfileComplete,
        pwdStepComplete,
        mustChangePassword,
        mustRegisterCompany // NEW dependency
    ])

    // Hide consent entirely while you work on it
    const visibleSteps = useMemo(
        () => (HIDE_CONSENT ? steps.filter(s => s.key !== 'consent') : steps),
        [steps]
    )

    const currentKey = visibleSteps[current]?.key

    // Clamp current when steps change
    useEffect(() => {
        if (current >= visibleSteps.length) {
            setCurrent(Math.max(0, visibleSteps.length - 1))
        }
    }, [visibleSteps.length, current])

    // On load (or when prerequisites resolve), jump to first incomplete
    useEffect(() => {
        if (!loading && visibleSteps.length) {
            const firstIncomplete = visibleSteps.findIndex(s => !s.isComplete)
            setCurrent(
                firstIncomplete === -1 ? visibleSteps.length - 1 : firstIncomplete
            )
        }
    }, [loading, visibleSteps])

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
                { signatureURL: url },
                { merge: true }
            )
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
            const blob = await dataURLToBlob(dataURL)
            const url = await uploadSigBlob(blob, 'drawn.png')
            await setDoc(
                doc(db, 'users', auth.currentUser!.uid),
                { signatureURL: url },
                { merge: true }
            )
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
                { signatureURL: url },
                { merge: true }
            )
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
        let idx = current + 1
        while (idx < visibleSteps.length && visibleSteps[idx].isComplete) idx++
        setCurrent(Math.min(idx, visibleSteps.length - 1))
    }
    const goPrev = () => setCurrent(Math.max(0, current - 1))

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

        // mark welcome complete
        await setDoc(
            doc(db, 'users', userId),
            {
                firstLoginComplete: true,
                firstLoginCompletedAt: Timestamp.now()
            },
            { merge: true }
        )

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

                // GAP already completed → incubatee dashboard
                return navigate('/incubatee')
            }

            // if pending → tracker
            if (pending) return navigate('/applicant/tracker')

            // fallback → SME registration
            return navigate('/applicant')
        }

        // non-incubatee roles
        navigate(`/${r || 'unknown'}`)
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
    const renderWelcome = () => (
        <Card>
            <Title level={3} style={{ marginTop: 0 }}>
                Welcome to the Smart Incubation Platform 🎉
            </Title>
            <Paragraph>
                Before you dive in, complete a few first-time checks.
            </Paragraph>
            <ul style={{ marginTop: 8 }}>
                {userRole === 'incubatee' && <li>Sign the POPIA consent</li>}
                {userRole === 'director' && <li>Confirm your company details</li>}
                <li>Set up your digital signature (type or draw)</li>
                {!HIDE_CONSENT && (
                    <li>Give consent to connect your email & meeting tools</li>
                )}
            </ul>
            <Space style={{ marginTop: 16 }}>
                <Button type='primary' onClick={goNext} block={isMobile}>
                    Let’s get started
                </Button>
            </Space>
        </Card>
    )

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

                <Space wrap>
                    <Button onClick={goPrev} block={isMobile} disabled={savingPwd}>
                        Back
                    </Button>
                    <Button
                        type='primary'
                        htmlType='submit'
                        block={isMobile}
                        loading={savingPwd}
                        disabled={savingPwd}
                    >
                        Update Password
                    </Button>
                </Space>
            </Form>
        </Card>
    )

    const renderPopia = () => (
        <>
            <Card>
                <Title level={4} style={{ marginTop: 0 }}>
                    POPIA Act Consent
                </Title>
                {popiaSigned ? (
                    <Alert
                        type='success'
                        showIcon
                        message='POPIA consent already signed.'
                    />
                ) : (
                    <>
                        <Alert
                            type='info'
                            showIcon
                            message='We require your POPIA consent before continuing.'
                            style={{ marginBottom: 12 }}
                        />
                        <Space>
                            <Button
                                type='primary'
                                onClick={() => setPopiaModalOpen(true)}
                                block={isMobile}
                            >
                                Review & Sign POPIA
                            </Button>
                        </Space>
                    </>
                )}
            </Card>
            <div style={{ marginTop: 16 }}>
                <Space style={{ width: '100%' }} wrap>
                    <Button onClick={goPrev} block={isMobile}>
                        Back
                    </Button>
                    <Button
                        type='primary'
                        onClick={goNext}
                        disabled={!popiaSigned}
                        block={isMobile}
                    >
                        Next
                    </Button>
                </Space>
            </div>
            <PopiaContractModal
                open={popiaModalOpen}
                participantId={participantId || ''}
                onClose={() => setPopiaModalOpen(false)}
                onSigned={() => {
                    setPopiaModalOpen(false)
                    setPopiaSigned(true)
                    message.success('POPIA consent signed. Thank you!')
                }}
            />
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
                    <Button type='primary' htmlType='submit' block={isMobile}>
                        Save
                    </Button>
                </Form>
            </Card>
            <div style={{ marginTop: 16 }}>
                <Space style={{ width: '100%' }} wrap>
                    <Button onClick={goPrev} block={isMobile}>
                        Back
                    </Button>
                    <Button
                        type='primary'
                        onClick={async () => {
                            await saveDirectorProfile()
                            goNext()
                        }}
                        disabled={!directorProfileComplete}
                        block={isMobile}
                    >
                        Next
                    </Button>
                </Space>
            </div>
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

                    <Radio.Group
                        value={sigMode}
                        onChange={e => setSigMode(e.target.value)}
                        style={{ marginBottom: 12 }}
                    >
                        <Radio value='typed'>Type</Radio>
                        <Radio value='drawn'>Draw</Radio>
                        <Radio value='upload'>Upload (optional)</Radio>
                    </Radio.Group>

                    {/* TYPED */}
                    {sigMode === 'typed' && (
                        <div>
                            <div style={{ marginBottom: 12, maxWidth: 340 }}>
                                <Input
                                    placeholder='Your full name'
                                    value={typedName}
                                    onChange={e => setTypedName(e.target.value)}
                                />
                            </div>
                            <div style={{ marginBottom: 12, maxWidth: 260 }}>
                                <Select
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
                            <div
                                ref={styledRef}
                                style={{
                                    fontFamily: `${typedFont}, cursive`,
                                    fontSize: 40,
                                    padding: '10px 20px',
                                    border: '1px dashed #aaa',
                                    background: '#fff',
                                    display: 'inline-block',
                                    minWidth: 260
                                }}
                            >
                                {typedName || 'Your styled signature'}
                            </div>
                            <div style={{ marginTop: 12 }}>
                                <Button
                                    type='primary'
                                    onClick={saveTypedSignature}
                                    disabled={!typedName.trim()}
                                    block={isMobile}
                                >
                                    Save Typed Signature
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* DRAWN */}
                    {sigMode === 'drawn' && (
                        <div>
                            <div
                                style={{
                                    border: '1px dashed #aaa',
                                    width: '100%',
                                    maxWidth: 480,
                                    height: 160,
                                    marginBottom: 12,
                                    position: 'relative',
                                    background: '#fff'
                                }}
                            >
                                <SignatureCanvas
                                    ref={canvasRef}
                                    penColor='black'
                                    canvasProps={{
                                        width: Math.min(480, window.innerWidth - 64),
                                        height: 160,
                                        style: { background: 'white' }
                                    }}
                                />
                            </div>
                            <Space wrap>
                                <Button onClick={clearDrawnSignature} block={isMobile}>
                                    Clear
                                </Button>
                                <Button
                                    type='primary'
                                    onClick={saveDrawnSignature}
                                    block={isMobile}
                                >
                                    Save Drawn Signature
                                </Button>
                            </Space>
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
                            <Dragger {...uploadProps} style={{ maxWidth: 560 }}>
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
                            style={{
                                marginTop: 16,
                                padding: 12,
                                background: '#fafafa',
                                borderRadius: 8,
                                border: '1px dashed #d9d9d9',
                                display: 'inline-block'
                            }}
                        >
                            <img
                                src={signatureURL}
                                alt='Your signature'
                                style={{ maxHeight: 80 }}
                            />
                        </div>
                    )}
                </Spin>
            </Card>

            <div style={{ marginTop: 16 }}>
                <Space style={{ width: '100%' }} wrap>
                    <Button onClick={goPrev} block={isMobile}>
                        Back
                    </Button>
                    <Button
                        type='primary'
                        onClick={goNext}
                        disabled={!signatureURL}
                        block={isMobile}
                    >
                        Next
                    </Button>
                </Space>
            </div>
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
                            border: '1px solid #f0f0f0',
                            background: '#fafafa'
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
                                        <div style={{ fontSize: 12, color: '#888' }}>
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
                                <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
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
                                        <div style={{ fontSize: 12, color: '#888' }}>
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
                                <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
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
                                        <div style={{ fontSize: 12, color: '#888' }}>
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
                                <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
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
                                        'Your first-time setup is complete. You can change any of this later from your profile.',
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
    const renderCompleted = () => (
        <Card>
            <Alert
                type='success'
                showIcon
                message='Setup complete'
                description='Your first-time setup appears to be finished. You can continue to the system now.'
                style={{ marginBottom: 12 }}
            />
            <Space>
                <Button type='primary' onClick={finish}>
                    Continue to the system
                </Button>
            </Space>
        </Card>
    )

    // View map + safe lookup
    const viewMap: Record<string, JSX.Element> = {
        welcome: renderWelcome(),
        password: renderPassword(),
        popia: renderPopia(),
        directorProfile: renderDirectorProfile(),
        signature: renderSignature(),
        consent: renderConsent(), // not reachable while HIDE_CONSENT = true
        completed: renderCompleted()
    }

    // If everything is already done, show the completed fallback
    const allComplete = visibleSteps.every(s => s.isComplete)

    return (
        <>
            {loading ? (
                <LoadingOverlay tip='Getting everything ready...' />
            ) : (
                <div
                    style={{
                        minHeight: '100vh',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: isMobile ? 16 : 24,
                        background: '#f5f7fa'
                    }}
                >
                    <Card
                        style={{
                            width: '100%',
                            maxWidth: 880,
                            borderRadius: 12,
                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                            margin: 0
                        }}
                    >
                        <Title level={3} style={{ marginTop: 0, marginBottom: 8 }}>
                            First-time Setup
                        </Title>

                        {/* Stepper */}
                        {!isMobile ? (
                            <Steps
                                current={Math.min(
                                    current,
                                    Math.max(visibleSteps.length - 1, 0)
                                )}
                                items={visibleSteps.map(s => ({
                                    title: s.title,
                                    icon: s.icon,
                                    status:
                                        visibleSteps.indexOf(s) < current
                                            ? 'finish'
                                            : visibleSteps.indexOf(s) === current
                                                ? 'process'
                                                : s.isComplete
                                                    ? 'finish'
                                                    : 'wait'
                                }))}
                                style={{ marginBottom: 24 }}
                            />
                        ) : (
                            <div style={{ marginBottom: 12, color: 'rgba(0,0,0,.45)' }}>
                                Step {Math.min(current + 1, visibleSteps.length)} of{' '}
                                {visibleSteps.length}:{' '}
                                <b>{visibleSteps[current]?.title ?? 'Completed'}</b>
                            </div>
                        )}

                        {/* Body with safe fallback */}
                        {allComplete
                            ? viewMap.completed
                            : viewMap[currentKey ?? ''] ?? viewMap.completed}
                    </Card>
                </div>
            )}
        </>
    )
}

export default WelcomeWizard
