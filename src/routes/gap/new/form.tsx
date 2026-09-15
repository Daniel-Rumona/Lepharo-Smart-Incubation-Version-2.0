import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, Form, Grid, Spin, Typography, message, theme } from 'antd'
import { useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase'
import {
    addDoc,
    arrayUnion,
    collection,
    doc,
    getDocs,
    query,
    setDoc,
    Timestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'

import { STEP_META, TOTAL_STEPS } from './questionBanks'
import type { FlowDirection, GroupId } from './types'
import {
    buildGapAnalysisPayload,
    groupMetaById,
    isStepComplete,
    useLeaveConfirmGuard
} from './gapHelpers'
import GapStepHeader from './components/GapStepHeader'
import GapStepShell from './components/GapStepShell'
import Step0MarketingPsychometric from './steps/Step0MarketingPsychometric'
import Step1FinanceLabour from './steps/Step1FinanceLabour'
import Step2WellnessLegal from './steps/Step2WellnessLegal'
import Step3MarketQuality from './steps/Step3MarketQuality'
import Step4TrainingNeeds from './steps/Step4TrainingNeeds'
import StepReview from './steps/StepReview'

const { Text } = Typography

const REVIEW_STEP = TOTAL_STEPS - 1

/* ──────────────────────────────────────────────────────────────
   Component
────────────────────────────────────────────────────────────── */
const GAPAnalysisForm: React.FC = () => {
    const { token } = theme.useToken()
    const reduceMotion = useReducedMotion()
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const [form] = Form.useForm()
    const navigate = useNavigate()
    const { user } = useFullIdentity() as any
    const { activeProgramId } = useActiveProgramId()
    const email: string | undefined = user?.email || ''
    const smmeName: string = user?.name || ''
    const smmeSignatureUrl: string = user?.signatureURL || ''

    const [step, setStep] = useState(0)
    const [direction, setDirection] = useState<FlowDirection>('forward')
    const [reviewEditSection, setReviewEditSection] = useState<GroupId | null>(null)
    const [pendingScrollGroup, setPendingScrollGroup] = useState<GroupId | null>(null)
    const groupRefs = useRef<Partial<Record<GroupId, HTMLDivElement | null>>>({})

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

    // Form.useWatch([]) only reliably reflects fields whose Form.Item is
    // currently mounted — with each step's questions mounted/unmounted as
    // the user navigates, that leaves values for OTHER steps looking empty
    // even though they're still in the form's internal store. It's used
    // here purely as a "something changed, recompute" trigger; the actual
    // values always come fresh from form.getFieldsValue(true), the same
    // source handleFinish uses for the real submission, which does hold
    // every step's data regardless of what's mounted.
    const watchedValues = Form.useWatch([], form)

    const canContinueStep = useMemo(
        () => {
            const values = form.getFieldsValue(true)
            return STEP_META.map((_, index) => isStepComplete(index, values))
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [watchedValues, form]
    )

    const goTo = useCallback((nextStep: number, dir: FlowDirection) => {
        setDirection(dir)
        setStep(Math.max(0, Math.min(REVIEW_STEP, nextStep)))
    }, [])

    const registerGroupRef = useCallback(
        (id: GroupId, el: HTMLDivElement | null) => {
            groupRefs.current[id] = el
        },
        []
    )

    const startReviewEdit = useCallback((groupId: GroupId) => {
        const meta = groupMetaById(groupId)
        setReviewEditSection(groupId)
        setDirection('backward')
        setStep(meta.step)
        setPendingScrollGroup(groupId)
    }, [])

    const finishReviewEdit = useCallback(() => {
        setReviewEditSection(null)
        setDirection('forward')
        setStep(REVIEW_STEP)
    }, [])

    // After a review-edit jump lands on the target step, scroll that
    // question group into view. AnimatePresence's mode="wait" means the
    // incoming step's content doesn't mount until the outgoing step's exit
    // animation finishes, so the target ref isn't there on the first paint
    // after `step` changes — poll a few frames until it shows up rather than
    // giving up immediately.
    useEffect(() => {
        if (!pendingScrollGroup) return

        let rafId: number
        let attempts = 0

        const tryScroll = () => {
            const el = groupRefs.current[pendingScrollGroup]
            if (el) {
                el.scrollIntoView({
                    behavior: reduceMotion ? 'auto' : 'smooth',
                    block: 'start'
                })
                setPendingScrollGroup(null)
                return
            }

            attempts += 1
            if (attempts > 90) {
                // Give up quietly — the step is still visible, just not
                // scrolled to the exact group.
                setPendingScrollGroup(null)
                return
            }

            rafId = window.requestAnimationFrame(tryScroll)
        }

        rafId = window.requestAnimationFrame(tryScroll)

        return () => window.cancelAnimationFrame(rafId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, pendingScrollGroup])

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

            const cleanPayload = buildGapAnalysisPayload(values, {
                participantId,
                submittedAt,
                selectedApplicationId: selectedApplication?.id,
                programId: selectedApplicationData?.programId || activeProgramId || undefined,
                userName: user?.name || '',
                smmeSignatureUrl,
                appCryptoSignature
            })

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

    if (loading) {
        return (
            <div
                style={{
                    height: '100dvh',
                    display: 'grid',
                    placeItems: 'center',
                    background: token.colorBgLayout
                }}
            >
                <Card style={{ borderRadius: 24, padding: 8 }}>
                    <Spin size="large" />
                </Card>
            </div>
        )
    }

    const isEditingThisStep =
        reviewEditSection !== null && groupMetaById(reviewEditSection).step === step

    const handleBack = () => {
        if (isEditingThisStep) {
            finishReviewEdit()
            return
        }
        goTo(step - 1, 'backward')
    }

    const handleContinue = () => {
        if (isEditingThisStep) {
            finishReviewEdit()
            return
        }
        if (step === REVIEW_STEP) {
            form.submit()
            return
        }
        goTo(step + 1, 'forward')
    }

    const showBack = step > 0 || isEditingThisStep
    const isFinalStep = step === REVIEW_STEP
    const stepDisabled = submitting

    const renderStepContent = () => {
        switch (step) {
            case 0:
                return (
                    <Step0MarketingPsychometric
                        disabled={stepDisabled}
                        registerGroupRef={registerGroupRef}
                    />
                )
            case 1:
                return (
                    <Step1FinanceLabour
                        disabled={stepDisabled}
                        registerGroupRef={registerGroupRef}
                    />
                )
            case 2:
                return (
                    <Step2WellnessLegal
                        disabled={stepDisabled}
                        registerGroupRef={registerGroupRef}
                    />
                )
            case 3:
                return (
                    <Step3MarketQuality
                        disabled={stepDisabled}
                        registerGroupRef={registerGroupRef}
                    />
                )
            case 4:
                return (
                    <Step4TrainingNeeds
                        disabled={stepDisabled}
                        registerGroupRef={registerGroupRef}
                    />
                )
            default:
                return (
                    <StepReview
                        values={form.getFieldsValue(true)}
                        smmeName={smmeName}
                        smmeSignatureUrl={smmeSignatureUrl}
                        onEditGroup={startReviewEdit}
                    />
                )
        }
    }

    return (
        <div
            style={{
                height: '100dvh',
                boxSizing: 'border-box',
                overflow: 'hidden',
                background: token.colorBgLayout,
                display: 'flex',
                justifyContent: 'center',
                padding: '20px 16px'
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: isFinalStep ? 1120 : 760,
                    minWidth: 0,
                    height: '100%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column'
                }}
            >
                {!isFinalStep && (
                    <GapStepHeader
                        label={STEP_META[step].short}
                        current={step + 1}
                        total={TOTAL_STEPS}
                    />
                )}

                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleFinish}
                    preserve
                    onValuesChange={onValuesChange}
                    style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
                >
                    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        <GapStepShell
                            stepKey={String(step)}
                            direction={direction}
                            align="start"
                            title={
                                isFinalStep
                                    ? 'Does everything look right?'
                                    : STEP_META[step].short
                            }
                            description={
                                isFinalStep
                                    ? 'Review your answers below, then submit your assessment.'
                                    : STEP_META[step].description
                            }
                            onBack={showBack ? handleBack : undefined}
                            showBack={showBack}
                            onContinue={handleContinue}
                            continueLabel={
                                isFinalStep
                                    ? isMobile
                                        ? 'Submit'
                                        : 'Submit Assessment'
                                    : undefined
                            }
                            continueDisabled={
                                !isFinalStep
                                    ? !canContinueStep[step]
                                    : submitting || !canContinueStep.slice(0, REVIEW_STEP).every(Boolean)
                            }
                            continueLoading={isFinalStep ? submitting : false}
                            isFinalStep={isFinalStep}
                            isEditing={isEditingThisStep}
                        >
                            {renderStepContent()}
                        </GapStepShell>
                    </div>

                    {/* keep an empty item so the form doesn't add default actions */}
                    <Form.Item style={{ margin: 0, display: 'none' }} />
                </Form>
            </div>
        </div>
    )
}

export default GAPAnalysisForm
