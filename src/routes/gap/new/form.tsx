import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
    Form,
    Input,
    Button,
    Divider,
    Typography,
    Row,
    Col,
    Space,
    message,
    Steps,
    Card,
    Alert,
    Radio,
    Checkbox,
    Select,
    Spin,
    Grid,
    Modal,
    Progress
} from 'antd'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase'
import {
    addDoc,
    collection,
    updateDoc,
    doc,
    getDocs,
    Timestamp,
    query,
    where,
    setDoc,
    arrayUnion
} from 'firebase/firestore'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    CheckOutlined,
    LeftOutlined,
    RightOutlined,
    VerticalAlignTopOutlined
} from '@ant-design/icons'

const { Text } = Typography
const { TextArea } = Input
const { useBreakpoint } = Grid

type QA = { answer?: string; comment?: string }

const asQAArray = (arr?: any[]): QA[] =>
    Array.isArray(arr)
        ? arr.map(x => ({
            answer: x?.answer ?? '',
            comment: x?.comment ?? ''
        }))
        : []

const stripUndefinedDeep = (val: any): any => {
    if (Array.isArray(val))
        return val.map(stripUndefinedDeep).filter(v => v !== undefined)
    if (val && typeof val === 'object') {
        const out: any = {}
        Object.keys(val).forEach(k => {
            const v = stripUndefinedDeep(val[k])
            if (v !== undefined) out[k] = v
        })
        return out
    }
    return val === undefined ? undefined : val
}

/* ──────────────────────────────────────────────────────────────
   STEP META
────────────────────────────────────────────────────────────── */
type StepMeta = { short: string; description: string; subpoints?: string[] }
const STEP_META: StepMeta[] = [
    {
        short: 'Marketing & Psychometric',
        description: 'Confirm marketing assets and leadership development posture.',
        subpoints: [
            'Brand assets, e-signature readiness',
            'Psychometric assessments & personal development plan'
        ]
    },
    {
        short: 'Finance & Labour/HSE',
        description: 'Verify statutory registrations, accounts, and OHS basics.',
        subpoints: [
            'Tax/VAT/PAYE, AFS/management accounts, fixed assets',
            'Accounting system/legacy issues; UIF/COID, contracts, OHS'
        ]
    },
    {
        short: 'Wellness & Legal',
        description: 'Capture wellness interest and legal support needs.',
        subpoints: [
            'EAP options & HRA status',
            'B-BBEE, contracts/templates, insurance; legal areas as needed'
        ]
    },
    {
        short: 'Market Linkage & Quality',
        description: 'Assess market access readiness and QMS status.',
        subpoints: ['CSD, target clients/refs, capacity', 'QMS/ISO readiness']
    },
    {
        short: 'Training Needs',
        description: 'Record SDL/SETA context and role-based training needs',
        subpoints: [
            'SETA/WSP/SDF status',
            'Needs: management, supervisors, workforce, support'
        ]
    },
    {
        short: 'Review & Submit',
        description: 'Verify entries and submit; digital signature notice applies.',
        subpoints: ['Final review summary', 'Submission notices & confirmations']
    }
]
const TOTAL_STEPS = STEP_META.length

/* ──────────────────────────────────────────────────────────────
   Question banks
────────────────────────────────────────────────────────────── */
const marketingCommunication = [
    'Do you have a company profile, logo, domain, brochures, banners, and other Marketing/Advertising materials that are deemed necessary for the business?',
    'Does company have electronic signature software?'
]
const psychometric = [
    'Have you ever done a psychometric assessment?',
    'Have you in the past participated in or completed personal development courses/programmes for business growth (e.g., mentoring/coaching/counselling)?',
    'Does your organisation have a personal development plan in place for all directors that allows for the development of personal insight for business growth of an entrepreneur for each Director?'
]
const financialManagement = [
    'Do you have current or previous Accountant?',
    'Are you registered for Income Tax?',
    'Are you registered for Value Added Tax (VAT)?',
    'Are you registered for Pay As You Earn (PAYE)?',
    'Do you have your previous Annual Financial Statements (AFS)?',
    'Do you have a valid Tax Clearance Certificate (TCC)?',
    'Do you have a Business Plan in place (BP)?',
    'Do you have an existing accounting system in place?',
    'Do you have a Companies and Intellectual Property Commission (CIPC) disclosure certificate?',
    'Do you need assistance with industry tender pricing?',
    'Do you have a need for business funding?',
    'Do you need Finance training?',
    'Do you have current Management Accounts?',
    'Do you have a Fixed Asset Register?',
    'Do you have legacy accounting problems (prior year unfinished accounting/bookkeeping tasks)?',
    'Please assist with read-only access of business bank account – Bank statements only'
]
const labourHSE = [
    'UIF Registration (check if company has employees)?',
    'Are you registered for COID/RMA?',
    'Do your employees & directors have contracts of employment?',
    'Is the company registered/affiliated with any industry bodies? (e.g., Plumbing Council, CIDB, NAMC)',
    'Do you have an Occupational Health & Safety System in place?',
    'Have you done statutory OHS trainings (employer and employees)?',
    'Do you have a workshop/office where you operate from? (under lease or owned by the business)'
]
const wellness = [
    'Are you aware that Lepharo offers Employee Wellness Services?',
    'Are you aware of your employees’ or your own mental/emotional state that can derail your business?',
    'Do you have employee assistance programmes implemented in your workplace?',
    'Have you or your employees completed a Wellness Health Risk Assessment over the past 6 months?',
    'Are you interested in incorporating Health and Wellness in your company?'
]
const wellnessProgrammes = [
    'Alcohol/substance abuse and GBV support',
    'Coaching programmes to keep employees motivated and productive',
    'Healthy diet and physical wellbeing'
]
const legal = [
    'Are you aware that Lepharo provides business Legal Services?',
    'Do you need assistance with Broad-Based Black Economic Empowerment rating (B-BBEE)?',
    'Do the shareholders have shareholding certificates?',
    'Do you have employment contract templates in place?',
    'Does your company employ illegal immigrants?',
    'Do you have any Legal needs we can assist you with?',
    'Do you have a lease agreement in place?',
    'Does the business have insurance (e.g., public liability)?'
]
const legalAreas = [
    'Commercial Law',
    'Corporate Law',
    'Labour Laws',
    'Business Insurance Law',
    'Elementary Services to Fiduciary Services',
    'Elementary Services to Debt Agreements (e.g., AOD/settlement)'
]
const marketLinkage = [
    'Are you registered with Central Supplier Database (CSD)?',
    'Is the competency of the management team and workforce adequate?',
    'Do you have a list of clients you desire to service?',
    'Do you know the net worth of your business?',
    'Do you have current/previous trade references?',
    'Do you have the capacity/equipment to deliver product?'
]
const qualityManagement = [
    'Are you aware of Quality Management Systems (QMS)?',
    'Have you attended ISO 9001:2015 QMS training before? (If yes, where and do you have the certificate?)',
    'Do you have a Quality Management System in place?',
    'Do you have 6-month records of the implemented QMS?'
]
const trainingNeedsYN = [
    'Does the business pay Skills Development Levies?',
    'If yes, to which SETA? (enter below)',
    'Does the business prepare a Workplace Skills Plan?',
    'Do you have a Skills Development Facilitator (SDF) in the business?',
    'Do you have training needs of personnel in middle and senior management levels?',
    'Do you have training needs of supervisors in the business?',
    'Do you have training needs for the workforce/staff in the business?',
    'Do you have training needs of support staff (Administrators, Finance, HR)?'
]

/* ──────────────────────────────────────────────────────────────
   Render helpers
────────────────────────────────────────────────────────────── */
const YesNoWithComment: React.FC<{
    name: (string | number)[]
    label: string
    disabled?: boolean
    extra?: React.ReactNode
}> = ({ name, label, disabled, extra }) => (
    <Card
        size='small'
        bordered
        style={{
            width: '100%',
            height: '100%',
            borderRadius: 12,
            borderColor: '#e8edf5',
            boxShadow: '0 4px 14px rgba(15, 23, 42, 0.04)'
        }}
        bodyStyle={{ padding: 16 }}
    >
        <Form.Item
            label={label}
            style={{ marginBottom: 10 }}
            labelCol={{ style: { fontWeight: 600, lineHeight: 1.45 } }}
        >
            <Row gutter={[12, 12]} align='middle'>
                <Col xs={24} md={10}>
                    <Form.Item
                        name={[...name, 'answer']}
                        noStyle
                        rules={[{ required: true, message: 'Select Yes or No' }]}
                    >
                        <Radio.Group disabled={disabled}>
                            <Radio value='Yes'>Yes</Radio>
                            <Radio value='No'>No</Radio>
                        </Radio.Group>
                    </Form.Item>
                </Col>
                <Col xs={24} md={14}>
                    <Form.Item name={[...name, 'comment']} noStyle>
                        <Input placeholder='Comment (optional)' disabled={disabled} />
                    </Form.Item>
                </Col>
            </Row>
        </Form.Item>
        {extra}
    </Card>
)

const TwoColSection: React.FC<{
    baseKey: string
    questions: string[]
    disabled?: boolean
    extras?: (idx: number) => React.ReactNode
}> = ({ baseKey, questions, disabled, extras }) => (
    <Row gutter={16}>
        {questions.map((q, i) => (
            <Col
                key={`${baseKey}-${i}`}
                xs={24}
                md={12}
                style={{ display: 'flex', marginBottom: 16 }}
            >
                <YesNoWithComment
                    name={[...baseKey.split('.'), i]}
                    label={q}
                    disabled={disabled}
                    extra={extras?.(i)}
                />
            </Col>
        ))}
    </Row>
)

const StepIntro: React.FC<{
    meta: StepMeta
    step: number
    totalSteps: number
}> = ({ meta, step, totalSteps }) => (
    <div
        style={{
            marginBottom: 22,
            padding: '18px 20px',
            borderRadius: 14,
            border: '1px solid #dce8ff',
            background:
                'linear-gradient(135deg, rgba(22,119,255,0.10), rgba(255,255,255,0.96))'
        }}
    >
        <Row gutter={[12, 12]} align='middle' justify='space-between'>
            <Col flex='auto'>
                <Text
                    style={{
                        display: 'block',
                        marginBottom: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        color: '#1677ff'
                    }}
                >
                    Step {step + 1} of {totalSteps}
                </Text>
                <Text strong style={{ display: 'block', fontSize: 18 }}>
                    {meta.short}
                </Text>
                <Text type='secondary' style={{ display: 'block', marginTop: 4 }}>
                    {meta.description}
                </Text>
            </Col>
        </Row>
    </div>
)

/* ──────────────────────────────────────────────────────────────
  blocks in-app route changes with a modal
────────────────────────────────────────────────────────────── */

function useLeaveConfirmGuard(when: boolean, message: string) {
    useEffect(() => {
        if (!when) return

        // 1) Hard exits (refresh / close tab)
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = '' // required for Chrome
        }
        window.addEventListener('beforeunload', handleBeforeUnload)

        // 2) Browser back/forward
        // Push a dummy state so the first Back hits our popstate handler
        const pushState = () => window.history.pushState({ __guard__: true }, '')
        pushState()
        const onPopState = () => {
            // Show confirm; if user cancels, re-push to stay on page
            Modal.confirm({
                title: 'Leave this page?',
                content: message,
                okText: 'Leave',
                cancelText: 'Stay',
                onOk: () => {
                    // allow the back navigation by removing listeners then going back one more time
                    cleanup()
                    window.history.back()
                },
                onCancel: () => {
                    // put them back on current page
                    pushState()
                }
            })
        }
        window.addEventListener('popstate', onPopState)

        // 3) In-app link clicks (<Link> renders <a>) — capture phase catches everything
        const onDocClick = (ev: MouseEvent) => {
            if (!when) return
            // ignore modified clicks/new-tab etc.
            if (
                ev.defaultPrevented ||
                ev.button !== 0 ||
                ev.metaKey ||
                ev.ctrlKey ||
                ev.shiftKey ||
                ev.altKey
            )
                return

            // find nearest anchor
            const path = ev.composedPath?.() ?? []
            const anchor =
                (path.find(
                    n => (n as HTMLElement)?.tagName === 'A'
                ) as HTMLAnchorElement) || (ev.target as HTMLElement)?.closest?.('a')
            if (!anchor) return

            const href = anchor.getAttribute('href')
            if (
                !href ||
                href.startsWith('#') ||
                href.startsWith('mailto:') ||
                href.startsWith('tel:')
            )
                return

            // same-origin only (in-app nav)
            const url = new URL(href, window.location.href)
            if (url.origin !== window.location.origin) return

            // At this point, block and ask
            ev.preventDefault()
            Modal.confirm({
                title: 'Leave this page?',
                content: message,
                okText: 'Leave',
                cancelText: 'Stay',
                onOk: () => {
                    cleanup()
                    // navigate by setting location (works with any router)
                    window.location.href = url.href
                }
            })
        }
        document.addEventListener('click', onDocClick, true) // capture!

        // helper to remove listeners
        const cleanup = () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)
            window.removeEventListener('popstate', onPopState)
            document.removeEventListener('click', onDocClick, true)
        }

        return cleanup
    }, [when, message])
}

/* ──────────────────────────────────────────────────────────────
   Component
────────────────────────────────────────────────────────────── */
const GAPAnalysisForm: React.FC = () => {
    const [form] = Form.useForm()
    const navigate = useNavigate()
    const { user } = useFullIdentity() as any
    const { activeProgramId } = useActiveProgramId()
    const email: string | undefined = user?.email || ''
    const smmeName: string = user?.name || ''
    const smmeSignatureUrl: string = user?.signatureURL || ''

    const [step, setStep] = useState(0)
    const [showScrollTop, setShowScrollTop] = useState(false)
    const topAnchorRef = useRef<HTMLDivElement | null>(null)
    const hasRenderedInitialStep = useRef(false)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [appCryptoSignature, setAppCryptoSignature] = useState<string>('')

    // Dirty means the user has not completed the assessment yet.
    const [dirty, setDirty] = useState(true)

    // Block navigation if dirty
    useLeaveConfirmGuard(
        dirty,
        'If you exit before completion your application will not be considered and you would have to resubmit.'
    )

    // track value changes to mark as dirty
    const onValuesChange = useCallback(() => setDirty(true), [])

    // Load participant by email
    useEffect(() => {
        const load = async () => {
            try {
                if (!email) return
                const snap = await getDocs(
                    query(collection(db, 'participants'), where('email', '==', email))
                )
                if (snap.empty) {
                    message.error('Participant record not found for your account.')
                    setLoading(false)
                    return
                }
                const d = snap.docs[0]
                setParticipantId(d.id)
                const data = d.data()

                form.setFieldsValue({
                    company: {
                        name:
                            data.beneficiaryName ||
                            data.companyName ||
                            data.organisationName ||
                            '',
                        region: data.region || data.province || '',
                        contact: data.phone || data.contact || '',
                        email: data.email || email
                    }
                })
            } catch (e) {
                console.error(e)
                message.error('Failed to load your participant profile.')
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [email, form])

    // Fetch cryptographic signature from applications
    useEffect(() => {
        const loadAppSig = async () => {
            try {
                if (!email) return
                const q1 = participantId
                    ? query(
                        collection(db, 'applications'),
                        where('participantId', '==', participantId)
                    )
                    : query(collection(db, 'applications'), where('email', '==', email))
                const snap = await getDocs(q1)
                if (!snap.empty) {
                    const eligibleApplications = snap.docs.filter(snapshot =>
                        ['accepted', 'active'].includes(
                            String(snapshot.data()?.applicationStatus || '').toLowerCase()
                        )
                    )
                    const selectedApplication = (
                        activeProgramId
                            ? eligibleApplications.find(snapshot =>
                                String(snapshot.data()?.programId || '') === String(activeProgramId)
                            )
                            : null
                    ) || eligibleApplications[0] || snap.docs[0]
                    const app = selectedApplication.data()
                    setAppCryptoSignature(app?.digitalSignature || '')
                }
            } catch (e) {
                console.error('Failed to load application digital signature:', e)
            }
        }
        loadAppSig()
    }, [activeProgramId, email, participantId])

    const scrollToPageTop = useCallback(
        (behavior: ScrollBehavior = 'smooth') => {
            topAnchorRef.current?.scrollIntoView({
                behavior,
                block: 'start'
            })
        },
        []
    )

    useEffect(() => {
        if (!hasRenderedInitialStep.current) {
            hasRenderedInitialStep.current = true
            return
        }

        const frame = window.requestAnimationFrame(() => {
            scrollToPageTop('auto')
        })

        return () => window.cancelAnimationFrame(frame)
    }, [step, scrollToPageTop])

    useEffect(() => {
        if (loading || !topAnchorRef.current) return

        if (typeof IntersectionObserver === 'undefined') {
            setShowScrollTop(true)
            return
        }

        const observer = new IntersectionObserver(
            ([entry]) => setShowScrollTop(!entry.isIntersecting),
            { threshold: 0.1 }
        )

        observer.observe(topAnchorRef.current)

        return () => observer.disconnect()
    }, [loading])

    const goToStep = useCallback((nextStep: number) => {
        setStep(Math.max(0, Math.min(TOTAL_STEPS - 1, nextStep)))
    }, [])

    const handleFinish = async () => {
        try {
            if (!participantId) {
                return message.error(
                    'Cannot submit: participant not linked to your account.'
                )
            }
            setSubmitting(true)
            const values = form.getFieldsValue(true)
            const submittedAt = Timestamp.now()

            const rawBank = values.financialManagement?.bankAccess || {}
            const bankAccess = (
                rawBank.username ? { username: rawBank.username } : {}
            ) as any
            if (rawBank.password) bankAccess.password = rawBank.password

            const appSnap = await getDocs(
                query(
                    collection(db, 'applications'),
                    where('participantId', '==', participantId)
                )
            )
            const eligibleApplications = appSnap.docs.filter(snapshot =>
                ['accepted', 'active'].includes(
                    String(snapshot.data()?.applicationStatus || '').toLowerCase()
                )
            )
            const selectedApplication = (
                activeProgramId
                    ? eligibleApplications.find(snapshot =>
                        String(snapshot.data()?.programId || '') === String(activeProgramId)
                    )
                    : null
            ) || eligibleApplications[0] || appSnap.docs[0]
            const selectedApplicationData = selectedApplication?.data() as any

            const payload = {
                participantId,
                ...(selectedApplication ? { applicationId: selectedApplication.id } : {}),
                ...(selectedApplicationData?.programId
                    ? { programId: selectedApplicationData.programId }
                    : activeProgramId
                        ? { programId: activeProgramId }
                        : {}),
                formVersion: 'LEP-MOG QMS 087 F (Rev 01) – Effective 17 July 2025',
                company: {
                    name: values.company?.name || '',
                    region: values.company?.region || '',
                    contact: values.company?.contact || '',
                    email: values.company?.email || '',
                    dateOfEngagement: submittedAt
                },
                sections: {
                    marketingCommunication: asQAArray(values.marketingCommunication),
                    psychometric: asQAArray(values.psychometric),
                    financialManagement: {
                        q: asQAArray(values.financialManagement?.q),
                        ...(Object.keys(bankAccess).length ? { bankAccess } : {})
                    },
                    labourHSE: asQAArray(values.labourHSE),
                    wellness: {
                        q: asQAArray(values.wellness?.q),
                        programmes: Array.isArray(values.wellness?.programmes)
                            ? values.wellness.programmes
                            : []
                    },
                    legal: {
                        q: asQAArray(values.legal?.q),
                        areas: Array.isArray(values.legal?.areas) ? values.legal.areas : []
                    },
                    marketLinkage: asQAArray(values.marketLinkage),
                    qualityManagement: asQAArray(values.qualityManagement),
                    trainingNeeds: {
                        yn: asQAArray(values.trainingNeeds?.yn),
                        setaName: values.trainingNeeds?.setaName || '',
                        categories: {
                            management: values.trainingNeeds?.categories?.management || '',
                            supervisors: values.trainingNeeds?.categories?.supervisors || '',
                            workforce: values.trainingNeeds?.categories?.workforce || '',
                            support: values.trainingNeeds?.categories?.support || ''
                        }
                    }
                },
                signatures: {
                    smmeNameSurname: user?.name || '',
                    smmeSignatureUrl,
                    smmeCryptoSignature: appCryptoSignature || ''
                },
                submittedAt
            }

            const cleanPayload = stripUndefinedDeep(payload)

            await addDoc(collection(db, 'gapAnalysis'), cleanPayload)

            if (selectedApplication) {
                const appRef = doc(db, 'applications', selectedApplication.id)

                await setDoc(
                    doc(appRef, 'agreements', 'gap-analysis'),
                    {
                        agreementId: 'gap-analysis',
                        title: 'Gap Analysis (Signed)',
                        signed: true,
                        acceptedAt: submittedAt,
                        signatureURL: smmeSignatureUrl || null,
                        digitalSignature: appCryptoSignature || null,
                        signerName: user?.name || null,
                        signerEmail: user?.email || null,
                        updatedAt: submittedAt
                    },
                    { merge: true }
                )

                await updateDoc(appRef, {
                    [`signedAgreements.gap-analysis`]: {
                        acceptedAt: submittedAt.toDate().toISOString(),
                        signer: {
                            email: user?.email || '',
                            name: user?.name || '',
                            signatureURL: smmeSignatureUrl || '',
                            uid: user?.uid || ''
                        },
                        digitalSignature: appCryptoSignature || '',
                        version: 1
                    },
                    'complianceSummary.completed': arrayUnion('gap-analysis'),
                    gapAnalysisStatus: 'Completed',
                    gapSubmittedAt: submittedAt
                })
            }

            await updateDoc(doc(db, 'participants', participantId), {
                gapAnalysisStatus: 'Completed',
                gapSubmittedAt: submittedAt
            })

            // Allow exit after successful submit.
            setDirty(false)

            message.success('Assessment submitted successfully!')
            navigate('/incubatee')
        } catch (error: any) {
            console.error('Submission failed:', error)
            message.error(`Submission failed: ${error.message}`)
        } finally {
            setSubmitting(false)
        }
    }

    const screens = useBreakpoint()

    if (loading) {
        return (
            <Card
                style={{
                    minHeight: '60vh',
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 14
                }}
            >
                <Spin size='large' />
            </Card>
        )
    }

    const FOOTER_H = 92
    const showDesktopSteps = screens.md === true
    const stepProgress = Math.round(((step + 1) / TOTAL_STEPS) * 100)

    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative'
            }}
        >
            <div ref={topAnchorRef} style={{ scrollMarginTop: 12 }} />

            <Card
                style={{
                    borderRadius: 16,
                    marginBottom: 0,
                    flex: 1,
                    paddingBottom: FOOTER_H + 8,
                    border: '1px solid #edf0f5',
                    boxShadow: '0 10px 32px rgba(15, 23, 42, 0.06)'
                }}
                bodyStyle={{ padding: showDesktopSteps ? 24 : 14, paddingTop: 16 }}
                title={
                    <div style={{ padding: '4px 0' }}>
                        <Text strong style={{ display: 'block', fontSize: 19 }}>
                            GAP Analysis
                        </Text>
                        <Text type='secondary' style={{ fontSize: 13 }}>
                            Complete each section before reviewing and submitting your assessment.
                        </Text>
                    </div>
                }
            >
                <div
                    style={{
                        marginBottom: 20,
                        padding: showDesktopSteps ? '14px 16px' : '12px 14px',
                        borderRadius: 12,
                        background: '#fafcff',
                        border: '1px solid #edf2fb'
                    }}
                >
                    {showDesktopSteps ? (
                        <Steps
                            current={step}
                            size='small'
                            responsive={false}
                            items={STEP_META.map(meta => ({ title: meta.short }))}
                        />
                    ) : (
                        <>
                            <Row justify='space-between' align='middle' gutter={8}>
                                <Col flex='auto'>
                                    <Text strong>{STEP_META[step].short}</Text>
                                </Col>
                                <Col>
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        {step + 1} of {TOTAL_STEPS}
                                    </Text>
                                </Col>
                            </Row>
                            <Progress
                                percent={stepProgress}
                                showInfo={false}
                                size='small'
                                style={{ marginTop: 8, marginBottom: 0 }}
                            />
                        </>
                    )}
                </div>

                <StepIntro
                    meta={STEP_META[step]}
                    step={step}
                    totalSteps={TOTAL_STEPS}
                />

                <Form
                    form={form}
                    layout='vertical'
                    onFinish={handleFinish}
                    preserve
                    onValuesChange={onValuesChange}
                >
                    {/* STEP 0 */}
                    {step === 0 && (
                        <>

                            <Divider orientation='left'>Marketing & Communication</Divider>
                            <TwoColSection
                                baseKey='marketingCommunication'
                                questions={marketingCommunication}
                            />

                            <Divider orientation='left'>Psychometric Evaluation</Divider>
                            <TwoColSection baseKey='psychometric' questions={psychometric} />
                        </>
                    )}

                    {/* STEP 1 */}
                    {step === 1 && (
                        <>

                            <Divider orientation='left'>SMME Financial Management</Divider>
                            <TwoColSection
                                baseKey='financialManagement.q'
                                questions={financialManagement.slice(0, 15)}
                            />
                            <YesNoWithComment
                                name={['financialManagement', 'q', 15]}
                                label={financialManagement[15]}
                                extra={
                                    <Row gutter={12} style={{ marginTop: 8 }}>
                                        <Col xs={24} md={12}>
                                            <Form.Item
                                                name={['financialManagement', 'bankAccess', 'username']}
                                                label='Bank Username'
                                            >
                                                <Input placeholder='(Optional) Username for read-only access' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                            <Form.Item
                                                name={['financialManagement', 'bankAccess', 'password']}
                                                label='Bank Password'
                                            >
                                                <Input.Password placeholder='(Optional) Password for read-only access' />
                                            </Form.Item>
                                        </Col>
                                        <Col span={24}>
                                            <Text type='secondary'>
                                                Note: storing credentials in plaintext is discouraged.
                                                Share securely with finance only.
                                            </Text>
                                        </Col>
                                    </Row>
                                }
                            />

                            <Divider orientation='left'>Labour / HSE Compliance</Divider>
                            <TwoColSection baseKey='labourHSE' questions={labourHSE} />
                        </>
                    )}

                    {/* STEP 2 */}
                    {step === 2 && (
                        <>

                            <Divider orientation='left'>SMME Wellness</Divider>
                            <TwoColSection
                                baseKey='wellness.q'
                                questions={wellness}
                                extras={i =>
                                    i === 2 ? (
                                        <Form.Item
                                            label='If Yes, select programmes'
                                            name={['wellness', 'programmes']}
                                            style={{ marginTop: 8 }}
                                        >
                                            <Checkbox.Group options={wellnessProgrammes} />
                                        </Form.Item>
                                    ) : null
                                }
                            />

                            <Divider orientation='left'>SMME Legal</Divider>
                            <TwoColSection
                                baseKey='legal.q'
                                questions={legal}
                                extras={i =>
                                    i === 5 ? (
                                        <Form.Item
                                            label='Select Legal Areas (if applicable)'
                                            name={['legal', 'areas']}
                                            style={{ marginTop: 8 }}
                                        >
                                            <Select
                                                mode='multiple'
                                                allowClear
                                                placeholder='Select legal assistance areas'
                                                options={legalAreas.map(l => ({ value: l, label: l }))}
                                            />
                                        </Form.Item>
                                    ) : null
                                }
                            />
                        </>
                    )}

                    {/* STEP 3 */}
                    {step === 3 && (
                        <>

                            <Divider orientation='left'>Market Linkage</Divider>
                            <TwoColSection
                                baseKey='marketLinkage'
                                questions={marketLinkage}
                            />

                            <Divider orientation='left'>SMME Quality Management</Divider>
                            <TwoColSection
                                baseKey='qualityManagement'
                                questions={qualityManagement}
                            />
                        </>
                    )}

                    {/* STEP 4 */}
                    {step === 4 && (
                        <>

                            <Divider orientation='left'>SMME Training Needs</Divider>
                            <TwoColSection
                                baseKey='trainingNeeds.yn'
                                questions={trainingNeedsYN}
                            />

                            <Row gutter={16}>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        label='If yes to SDL, which SETA?'
                                        name={['trainingNeeds', 'setaName']}
                                    >
                                        <Input placeholder='SETA name (optional)' />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={16}>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        label='9.1 Middle & Senior Management'
                                        name={['trainingNeeds', 'categories', 'management']}
                                    >
                                        <TextArea
                                            rows={3}
                                            placeholder='Training needs for management'
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        label='9.2 Supervisors'
                                        name={['trainingNeeds', 'categories', 'supervisors']}
                                    >
                                        <TextArea
                                            rows={3}
                                            placeholder='Training needs for supervisors'
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        label='9.3 Workforce'
                                        name={['trainingNeeds', 'categories', 'workforce']}
                                    >
                                        <TextArea
                                            rows={3}
                                            placeholder='Training needs for workforce'
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        label='9.4 Support Staff'
                                        name={['trainingNeeds', 'categories', 'support']}
                                    >
                                        <TextArea
                                            rows={3}
                                            placeholder='Training needs for support staff'
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </>
                    )}

                    {/* STEP 5 — Review & Submit */}
                    {step === 5 && (
                        <Space direction='vertical' style={{ width: '100%' }}>

                            <Card
                                title='Review Summary'
                                bordered
                                style={{ background: '#fafafa', borderRadius: 12 }}
                            >
                                <Row gutter={16}>
                                    <Col xs={24} md={12}>
                                        <p>
                                            <strong>Company Name:</strong>{' '}
                                            {form.getFieldValue(['company', 'name'])}
                                        </p>
                                        <p>
                                            <strong>Region:</strong>{' '}
                                            {form.getFieldValue(['company', 'region'])}
                                        </p>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <p>
                                            <strong>Contact:</strong>{' '}
                                            {form.getFieldValue(['company', 'contact'])}
                                        </p>
                                        <p>
                                            <strong>Email:</strong>{' '}
                                            {form.getFieldValue(['company', 'email'])}
                                        </p>
                                    </Col>
                                </Row>

                                <Divider />

                                <Row gutter={16}>
                                    <Col xs={24} md={12}>
                                        <p>
                                            <strong>SMME (Name):</strong>{' '}
                                            {smmeName || <em>Not on profile</em>}
                                        </p>
                                        <p>
                                            <strong>Cryptographic Signature:</strong>{' '}
                                            {appCryptoSignature}
                                        </p>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <div>
                                            <strong>SMME Signature (image):</strong>
                                            <div style={{ marginTop: 8 }}>
                                                {smmeSignatureUrl ? (
                                                    <img
                                                        src={smmeSignatureUrl}
                                                        alt='SMME Signature'
                                                        style={{
                                                            maxWidth: 260,
                                                            maxHeight: 120,
                                                            objectFit: 'contain',
                                                            border: '1px solid #f0f0f0',
                                                            padding: 8,
                                                            borderRadius: 8
                                                        }}
                                                    />
                                                ) : (
                                                    <em>No signature image on profile</em>
                                                )}
                                            </div>
                                        </div>
                                    </Col>
                                </Row>
                            </Card>

                            <Alert
                                message='Confirm & Submit'
                                description='By submitting this assessment, you confirm that all the information provided is true and accurate to the best of your knowledge.'
                                type='info'
                                showIcon
                            />
                            <Alert
                                message='Digital Signature Notice'
                                description='Your name and a digital signature will be automatically attached to this document. The onboarding team will review your responses and contact you if further information is required.'
                                type='success'
                                showIcon
                            />
                            <Alert
                                message='Important'
                                description='Once submitted, you will not be able to edit your responses until the team reviews them.'
                                type='warning'
                                showIcon
                            />
                        </Space>
                    )}

                    {/* keep an empty item so form doesn't add default actions */}
                    <Form.Item style={{ margin: 0 }} />
                </Form>
            </Card>

            <div
                style={{
                    position: 'sticky',
                    bottom: 0,
                    zIndex: 10,
                    background: 'rgba(255, 255, 255, 0.96)',
                    backdropFilter: 'blur(12px)',
                    borderTop: '1px solid var(--ant-color-border, #f0f0f0)',
                    boxShadow: '0 -10px 28px rgba(15, 23, 42, 0.08)',
                    padding: '12px 16px calc(12px + env(safe-area-inset-bottom))'
                }}
            >
                <div
                    style={{
                        width: '100%',
                        maxWidth: 960,
                        margin: '0 auto',
                        display: 'grid',
                        gridTemplateColumns:
                            step > 0 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
                        gap: 12
                    }}
                >
                    {step > 0 && (
                        <Button
                            block
                            size='large'
                            icon={<LeftOutlined />}
                            onClick={() => goToStep(step - 1)}
                            disabled={submitting}
                        >
                            Previous
                        </Button>
                    )}

                    {step < TOTAL_STEPS - 1 && (
                        <Button
                            block
                            size='large'
                            type='primary'
                            icon={<RightOutlined />}
                            onClick={() => goToStep(step + 1)}
                            disabled={submitting}
                        >
                            Next
                        </Button>
                    )}

                    {step === TOTAL_STEPS - 1 && (
                        <Button
                            block
                            size='large'
                            type='primary'
                            icon={<CheckOutlined />}
                            onClick={() => form.submit()}
                            loading={submitting}
                        >
                            Submit Assessment
                        </Button>
                    )}
                </div>
            </div>

            {!showDesktopSteps && showScrollTop && (
                <Button
                    type='primary'
                    shape='circle'
                    size='large'
                    aria-label='Scroll to top'
                    icon={<VerticalAlignTopOutlined />}
                    onClick={() => scrollToPageTop('smooth')}
                    style={{
                        position: 'fixed',
                        right: 16,
                        bottom: 'calc(94px + env(safe-area-inset-bottom))',
                        zIndex: 11,
                        boxShadow: '0 8px 22px rgba(22, 119, 255, 0.28)'
                    }}
                />
            )}
        </div>
    )
}


export default GAPAnalysisForm
