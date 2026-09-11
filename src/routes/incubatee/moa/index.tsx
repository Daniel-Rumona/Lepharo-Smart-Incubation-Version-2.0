// src/pages/incubatee/MOAForm.tsx
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import {
    Alert,
    Button,
    Card,
    Divider,
    message,
    Modal,
    Space,
    Typography
} from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    serverTimestamp,
    getDocs,
    where,
    collection,
    query
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import dayjs from 'dayjs'
import {
    MoaVars,
    saveMoaDocx,
    renderMoaPages
} from '@/components/modals/Contracts/moa.pages'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { DownloadOutlined } from '@ant-design/icons'
import '@/styles/contract-paper.css'

const { Title, Text } = Typography

export default function MOAForm() {
    const { state } = useLocation() as any
    const navigate = useNavigate()
    const { user } = useFullIdentity()

    const appId: string | null = state?.appId ?? null
    const participantId: string | null = state?.participantId ?? null

    const [alreadySigned, setAlreadySigned] = useState<boolean | null>(null)
    // track both signatures
    const [moaStatus, setMoaStatus] = useState({
        incubateeSigned: false,
        incubatorSigned: false,
        loading: true
    })

    const [signing, setSigning] = useState(false)
    const [vars, setVars] = useState<MoaVars | null>(null)
    const [loadingVars, setLoadingVars] = useState<boolean>(true)
    const [signedAgreementMeta, setSignedAgreementMeta] = useState<any>(null)

    // Load "signed" status
    useEffect(() => {
        ; (async () => {
            if (!appId) {
                setAlreadySigned(false)
                setMoaStatus(s => ({ ...s, loading: false }))
                return
            }

            const [snap, appSnap] = await Promise.all([
                getDoc(doc(db, 'applications', appId, 'agreements', 'moa')),
                getDoc(doc(db, 'applications', appId))
            ])
            const embedded = appSnap.exists()
                ? (appSnap.data() as any)?.signedAgreements?.moa || {}
                : {}
            const d = { ...embedded, ...(snap.exists() ? snap.data() as any : {}) }
            setSignedAgreementMeta(d)

            const incubateeSigned = !!d.signed && (!!d.signatureURL || !!d.signerName)

            const incubatorSigned =
                !!d.romSigned && (!!d.romSignatureURL || !!d.romSignerName)

            setAlreadySigned(incubateeSigned) // keep your existing flag semantics
            setMoaStatus({ incubateeSigned, incubatorSigned, loading: false })
        })()
    }, [appId])

    // Helper to open signature settings
    const openAccountSettings = () => {
        window.dispatchEvent(
            new CustomEvent('open-account-settings', {
                detail: { focus: 'signature' }
            })
        )
    }

    // Build MoaVars from: participant → application (+ overrides from state), program dates
    const loadVars = useCallback(async (): Promise<MoaVars> => {
        // ── 1) Resolve application (by state.appId, else by user.email)
        let appDocId = state?.appId as string | null
        let appData: any = null

        if (!appDocId) {
            if (!user?.email)
                throw new Error('Missing user email to resolve application.')
            const appsSnap = await getDocs(
                query(collection(db, 'applications'), where('email', '==', user.email))
            )
            const apps = appsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))
            appData = apps.find(
                a => (a.applicationStatus || '').toLowerCase() === 'accepted'
            )
            if (!appData)
                throw new Error('No accepted application found for your account.')
            appDocId = appData.id
        }

        if (!appData) {
            const appSnap = await getDoc(doc(db, 'applications', appDocId!))
            if (!appSnap.exists()) throw new Error('Application not found.')
            appData = { id: appDocId, ...appSnap.data() }
        }

        // ── 2) Resolve participant
        let participantId: string | null =
            state?.participantId ?? appData?.participantId ?? null
        let participant: any = null

        if (!participantId) {
            // Fallback by email
            const emailToFind = state?.email ?? appData?.email ?? user?.email
            if (emailToFind) {
                const ps = await getDocs(
                    query(
                        collection(db, 'participants'),
                        where('email', '==', emailToFind)
                    )
                )
                const doc0 = ps.docs[0]
                if (doc0) {
                    participantId = doc0.id
                    participant = { id: doc0.id, ...(doc0.data() as any) }
                }
            }
        }
        if (participantId && !participant) {
            const pSnap = await getDoc(doc(db, 'participants', participantId))
            if (pSnap.exists())
                participant = { id: participantId, ...(pSnap.data() as any) }
        }

        // ── 3) Resolve program
        const programId: string | null =
            state?.programId ?? appData?.programId ?? null
        if (!programId) throw new Error('Missing programId on application.')
        const progSnap = await getDoc(doc(db, 'programs', programId))
        if (!progSnap.exists()) throw new Error('Program not found.')
        const p: any = progSnap.data()

        const start = p?.startDate?.toDate ? p.startDate.toDate() : p?.startDate
        const end = p?.endDate?.toDate ? p.endDate.toDate() : p?.endDate

        const effectiveDate = dayjs(start).isValid()
            ? dayjs(start).format('DD MMMM YYYY')
            : '________'
        const graduationDate = dayjs(end).isValid()
            ? dayjs(end).format('DD MMMM YYYY')
            : '________'

        // ── 4) Build placeholders with precedence:
        //     state → participant → application → blanks
        const beneficiaryName =
            state?.beneficiaryName ??
            participant?.beneficiaryName ??
            appData?.beneficiaryName ??
            '________'

        const registrationNumber =
            state?.registrationNumber ??
            participant?.registrationNumber ?? // ← participants doc is the source of truth
            appData?.registrationNumber ??
            '________'

        const participantName =
            state?.participantName ??
            participant?.participantName ??
            participant?.fullName ??
            participant?.beneficiaryName ??
            appData?.participantName ??
            appData?.applicantName ??
            '________'

        const idNumber =
            state?.idNumber ??
            participant?.idNumber ?? // ← participants doc is the source of truth
            participant?.nationalId ??
            '________'

        const businessAddress =
            state?.businessAddress ??
            participant?.businessAddress ??
            participant?.registeredAddress ??
            appData?.businessAddress ??
            appData?.registeredAddress ??
            '________'

        const contactNumber =
            state?.contactNumber ??
            participant?.contactNumber ??
            participant?.phone ??
            appData?.contactNumber ??
            appData?.phone ??
            '________'

        const email =
            state?.email ??
            participant?.email ??
            appData?.email ??
            user?.email ??
            '________'

        return {
            beneficiaryName,
            registrationNumber,
            participantName,
            idNumber,
            businessAddress,
            contactNumber,
            email,
            effectiveDate,
            graduationDate
        }
    }, [state, user])

    // Load vars on mount
    useEffect(() => {
        ; (async () => {
            try {
                setLoadingVars(true)
                const v = await loadVars()
                setVars(v)
            } catch (e) {
                console.error(e)
                message.error(
                    (e as any)?.message || 'Failed to load agreement details.'
                )
            } finally {
                setLoadingVars(false)
            }
        })()
    }, [loadVars])

    const handleDownloadDocx = useCallback(async () => {
        try {
            if (!vars) throw new Error('No agreement data to export.')

            // header meta (unchanged)
            const headerMeta = {
                centerTitle: 'INCUBATION MEMORANDUM OF AGREEMENT',
                formNo: 'LEP QMS 074.1 F',
                revisionNo: '0',
                effectiveDate: vars.effectiveDate || '01 October 2020'
            }

            // pull both parties’ signature/name from the stored agreement
            let sigs: { incubatee?: any; incubator?: any } = {}

            if (appId) {
                const agSnap = await getDoc(
                    doc(db, 'applications', appId, 'agreements', 'moa')
                )
                const ag = agSnap.exists() ? (agSnap.data() as any) : {}

                sigs = {
                    incubatee: {
                        name: ag.signerName || vars.participantName,
                        positionOrTitle: ag.signerTitle || 'Director', // if you store it, use it
                        place: ag.place || 'Rustenburg',
                        day: ag.signedAtDay || dayjs().format('DD'),
                        month: ag.signedAtMonth || dayjs().format('MMMM'),
                        year: ag.signedAtYear || dayjs().format('YYYY'),
                        signatureUrl: ag.signatureURL || user?.signatureURL || '',
                        witnessName: ag.witnessName || '',
                        witnessSignatureUrl: ag.witnessSignatureURL || ''
                    },
                    incubator: {
                        name: ag.romSignerName || '', // ← ROM fills these when they sign
                        positionOrTitle: ag.romSignerTitle || 'CENTRE COORDINATOR',
                        place: ag.romPlace || 'Rustenburg',
                        day: ag.romSignedAtDay || '',
                        month: ag.romSignedAtMonth || '',
                        year: ag.romSignedAtYear || '',
                        signatureUrl: ag.romSignatureURL || '',
                        witnessName: ag.romWitnessName || '',
                        witnessSignatureUrl: ag.romWitnessSignatureURL || ''
                    }
                }
            }

            await saveMoaDocx(
                vars,
                `MOA_${vars.beneficiaryName}.docx`,
                headerMeta,
                sigs
            )
            message.success('MOA downloaded (.docx).')
        } catch (e) {
            console.error(e)
            message.error((e as any)?.message || 'Download failed.')
        }
    }, [vars, appId, user])

    const handleSign = async () => {
        if (!appId) return message.error('Missing application context.')
        if (!user?.signatureURL) {
            Modal.info({
                title: 'Signature required',
                content:
                    'Please open Account Settings and add your signature to proceed.',
                okText: 'Take me there',
                onOk: openAccountSettings
            })
            return
        }
        const optimisticSignedAt = new Date().toISOString()
        const previousMeta = signedAgreementMeta
        setSignedAgreementMeta({
            ...signedAgreementMeta,
            signed: true,
            acceptedAt: optimisticSignedAt,
            signatureURL: user.signatureURL,
            signerName: user?.name || null,
            signerEmail: user?.email || null
        })
        setAlreadySigned(true)
        setMoaStatus(current => ({ ...current, incubateeSigned: true }))
        try {
            setSigning(true)
            const payload = {
                agreementId: 'moa',
                title: 'Memorandum of Agreement (MOA)',
                signed: true,
                acceptedAt: serverTimestamp(),
                signatureURL: user.signatureURL || null,
                signerName: user?.name || null,
                signerEmail: user?.email || null,
                participantId: participantId || null,
                updatedAt: serverTimestamp()
            }
            await setDoc(
                doc(db, 'applications', appId, 'agreements', 'moa'),
                payload,
                {
                    merge: true
                }
            )
            await updateDoc(doc(db, 'applications', appId), {
                ['signedAgreements.moa']: payload,
                moaSigned: true,
                moaStatus: 'Completed',
                updatedAt: serverTimestamp()
            })
            message.success('MOA signed successfully.')
        } catch (e) {
            console.error(e)
            setSignedAgreementMeta(previousMeta)
            setAlreadySigned(false)
            setMoaStatus(current => ({ ...current, incubateeSigned: false }))
            message.error('Could not sign the MOA. Please try again.')
        } finally {
            setSigning(false)
        }
    }

    const previewTextBlocks = useMemo(() => {
        if (!vars) return []
        return renderMoaPages(vars)
    }, [vars])

    const signedDate = useMemo(() => {
        const value = signedAgreementMeta?.acceptedAt || signedAgreementMeta?.signedAt
        const raw = value?.toDate?.() ?? (value?.seconds ? new Date(value.seconds * 1000) : value)
        return raw && dayjs(raw).isValid() ? dayjs(raw).format('DD MMMM YYYY') : 'Date not recorded'
    }, [signedAgreementMeta])

    if (alreadySigned === null) return null

    return (
        <div
            style={{
                padding: 24,
                minHeight: '100vh',
                maxWidth: 1100,
                margin: '0 auto'
            }}
        >
            <Title level={3} style={{ marginTop: 8 }}>
                Memorandum of Agreement (MOA)
            </Title>

            {alreadySigned ? (
                <Alert
                    type='success'
                    showIcon
                    message='This agreement has already been signed.'
                    action={
                        <Button onClick={() => navigate('/incubatee')}>
                            Go to Dashboard
                        </Button>
                    }
                    style={{ margin: '12px 0 20px' }}
                />
            ) : (
                <Alert
                    type='warning'
                    showIcon
                    message='Action required'
                    description='Your application indicates you must sign the MOA to continue in the programme.'
                    style={{ margin: '12px 0 20px' }}
                />
            )}

            <MotionCard
                size='small'
                style={{ borderRadius: 10, border: '1px solid #e6f0ff' }}
                bodyStyle={{ padding: 18 }}
            >
                <Space
                    style={{
                        marginBottom: 12,
                        display: 'flex',
                        justifyContent: 'space-between'
                    }}
                >
                    <Space>
                        <Button onClick={() => navigate('/incubatee')}>Cancel</Button>

                        {vars && (
                            <Button
                                icon={<DownloadOutlined />}
                                onClick={handleDownloadDocx}
                                disabled={!vars || loadingVars || moaStatus.loading}
                            >
                                Download MOA
                            </Button>
                        )}

                        {/* Show “I agree & Sign” only until the incubatee (user) has signed */}
                        {!moaStatus.incubateeSigned && (
                            <Button
                                type='primary'
                                onClick={handleSign}
                                loading={signing}
                                disabled={!vars || loadingVars}
                            >
                                I agree &amp; Sign
                            </Button>
                        )}
                    </Space>
                </Space>

                <Divider style={{ margin: '8px 0 16px' }} />

                {vars ? (
                    <div className='contract-document-stage'>
                        {previewTextBlocks.map((txt, i) => (
                            <article key={i} className='contract-paper contract-paper--page'>
                                <header className='contract-paper__header'>
                                    <div>
                                        <img src='/assets/images/lepharo.png' alt='Lepharo' />
                                    </div>
                                    <div className='contract-paper__header-title'>
                                        INCUBATION MEMORANDUM OF AGREEMENT
                                    </div>
                                    <div className='contract-paper__header-meta'>
                                        <span><strong>Form No:</strong> LEP QMS 074.1 F</span>
                                        <span><strong>Revision No:</strong> 0</span>
                                        <span><strong>Effective date:</strong> {vars.effectiveDate}</span>
                                    </div>
                                </header>
                                <pre className='contract-paper__text'>{txt}</pre>
                                <span className='contract-paper__page-number'>
                                    Page {i + 1} of {previewTextBlocks.length + (alreadySigned ? 1 : 0)}
                                </span>
                            </article>
                        ))}
                        {alreadySigned && (
                            <article className='contract-paper contract-paper--page'>
                                <header className='contract-paper__header'>
                                    <div><img src='/assets/images/lepharo.png' alt='Lepharo' /></div>
                                    <div className='contract-paper__header-title'>SIGNATURES</div>
                                    <div className='contract-paper__header-meta'>
                                        <span><strong>Form No:</strong> LEP QMS 074.1 F</span>
                                        <span><strong>Revision No:</strong> 0</span>
                                    </div>
                                </header>
                                <Title level={4}>Execution of the Agreement</Title>
                                <Text>This page records the signatures held against this Memorandum of Agreement.</Text>
                                <div className='contract-paper__signature-grid'>
                                    <section className='contract-paper__signature-block'>
                                        <h3>For the Incubatee</h3>
                                        {signedAgreementMeta?.signatureURL ? (
                                            <img className='contract-paper__signature-image' src={signedAgreementMeta.signatureURL} alt='Incubatee signature' />
                                        ) : <div className='contract-paper__signature-line' />}
                                        <p className='contract-paper__signature-name'>
                                            {signedAgreementMeta?.signerName || vars?.participantName || 'Name not recorded'}
                                        </p>
                                        <p className='contract-paper__signature-detail'>{signedAgreementMeta?.signerEmail || vars?.email}</p>
                                        <p className='contract-paper__signature-detail'>Signed on {signedDate}</p>
                                    </section>
                                    <section className='contract-paper__signature-block'>
                                        <h3>For Lepharo Incubation Programme</h3>
                                        {signedAgreementMeta?.romSignatureURL ? (
                                            <img className='contract-paper__signature-image' src={signedAgreementMeta.romSignatureURL} alt='Incubator signature' />
                                        ) : <div className='contract-paper__signature-line' />}
                                        <p className='contract-paper__signature-name'>
                                            {signedAgreementMeta?.romSignerName || 'Awaiting Lepharo signature'}
                                        </p>
                                        <p className='contract-paper__signature-detail'>
                                            {signedAgreementMeta?.romSignerTitle || 'Centre Coordinator'}
                                        </p>
                                    </section>
                                </div>
                                <span className='contract-paper__page-number'>
                                    Page {previewTextBlocks.length + 1} of {previewTextBlocks.length + 1}
                                </span>
                            </article>
                        )}
                    </div>
                ) : (
                    <Text type='secondary'>Loading agreement…</Text>
                )}
            </MotionCard>
        </div>
    )
}
