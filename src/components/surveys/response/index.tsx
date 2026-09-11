import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Form,
    Input,
    Button,
    Select,
    Typography,
    Space,
    Divider,
    Upload,
    DatePicker,
    Checkbox,
    Radio,
    Rate,
    Alert,
    Result,
    message
} from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    UploadOutlined,
    SaveOutlined,
    SendOutlined
} from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import {
    collection,
    collectionGroup,
    doc,
    getDoc,
    getDocs,
    query,
    updateDoc,
    where,
    Timestamp
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import dayjs, { Dayjs } from 'dayjs'
import { db, storage } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    isPrefillKey,
    resolvePrefillValue,
    type PrefillKey
} from '@/lib/surveyPrefill'
import SurveyQuestionFrame, {
    findSectionLabel
} from '@/components/surveys/shared/SurveyQuestionFrame'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { roundBtn } from '@/components/shared/StyledButton'
import { Helmet } from 'react-helmet'

const { Title, Text, Paragraph } = Typography
const { Option } = Select
const { TextArea } = Input

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type ResponseType = 'multiple' | 'scale' | 'short'

type Question = {
    id: string
    type: ResponseType
    questionText: string
    required?: boolean
    options?: string[]
    multipleMode?: 'single' | 'multi'
    min?: number
    max?: number
    step?: number
    placeholder?: string
    /** Set by the builder when the answer comes from the SME's profile. */
    prefill?: PrefillKey
}

type SentSurveyDoc = {
    title?: string
    description?: string
    templateId?: string
    // some installs also keep questions here (optional)
    questions?: any[]
}

type ResponseDoc = {
    participantId: string
    name?: string
    completed?: boolean
    submittedAt?: any
    questions?: any[]
    answers?: Record<string, any>
    answersDraft?: Record<string, any>
}

type SurveyTemplateDoc = {
    id?: string
    title?: string
    description?: string
    // builder v2: `fields` (preferred)
    fields?: any[]
    // legacy: `questions`
    questions?: any[]
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function normalizeQuestions(raw?: any[]): Question[] {
    if (!Array.isArray(raw)) return []
    return raw.map((q, i) => {
        const type = q?.type ?? 'short'
        const id = q?.id ?? q?.key ?? `q_${i}`
        const questionText =
            q?.questionText ?? q?.question ?? q?.label ?? `Question ${i + 1}`

        let options: string[] | undefined
        if (
            type === 'multiple' ||
            type === 'select' ||
            type === 'radio' ||
            type === 'checkbox'
        ) {
            // accept several shapes
            if (Array.isArray(q?.options)) options = q.options
            else if (Array.isArray(q?.options?.options)) options = q.options.options
            else if (q?.options && typeof q.options === 'object') {
                const vals = Object.values(q.options).filter(v => typeof v === 'string')
                options = (vals.length ? vals : undefined) as string[] | undefined
            }
        }

        // map builder field types → responder types
        const mappedType: ResponseType =
            q?.type === 'checkbox'
                ? 'multiple'
                : q?.type === 'radio'
                    ? 'multiple'
                    : q?.type === 'select'
                        ? 'multiple'
                        : q?.type === 'rating'
                            ? 'scale'
                            : q?.type === 'textarea'
                                ? 'short'
                                : (type as ResponseType)

        const multipleMode: 'single' | 'multi' =
            q?.type === 'checkbox' ? 'multi' : 'single'

        return {
            id,
            type: mappedType,
            questionText,
            required: !!q?.required,
            multipleMode: mappedType === 'multiple' ? multipleMode : undefined,
            min: q?.min ?? q?.options?.min,
            max: q?.max ?? q?.options?.max,
            step: q?.step ?? q?.options?.step,
            placeholder: q?.placeholder,
            prefill: isPrefillKey(q?.prefill) ? q.prefill : undefined,
            options
        } as Question
    })
}

async function fetchTemplate(
    templateId: string
): Promise<SurveyTemplateDoc | null> {
    if (!templateId) return null
    try {
        // Primary: formTemplates (your builder)
        const tSnap = await getDoc(doc(db, 'formTemplates', templateId))
        if (tSnap.exists()) return { id: tSnap.id, ...(tSnap.data() as any) }

        // Optional legacy fallback: departmentForms
        const dSnap = await getDoc(doc(db, 'departmentForms', templateId))
        if (dSnap.exists()) return { id: dSnap.id, ...(dSnap.data() as any) }

        return null
    } catch (e) {
        console.error('fetchSurveyTemplate error', e)
        return null
    }
}

const RespondSurvey: React.FC = () => {
    const { user } = useFullIdentity()
    const { surveyId } = useParams()
    const navigate = useNavigate()
    const [form] = Form.useForm()

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)

    const [sentSurvey, setSentSurvey] = useState<SentSurveyDoc | null>(null)
    const [template, setTemplate] = useState<SurveyTemplateDoc | null>(null)

    const [responseDocId, setResponseDocId] = useState<string | null>(null)
    const [response, setResponse] = useState<ResponseDoc | null>(null)
    const [fileUploads, setFileUploads] = useState<Record<string, any>>({})

    const [participantId, setParticipantId] = useState<string | null>(null)
    // Kept alongside the id so profile-prefilled questions can read from it.
    const [participant, setParticipant] = useState<Record<string, any> | null>(
        null
    )
    const participantName = useMemo(() => response?.name || '', [response])

    // Resolve participant by email (faster: direct where query)
    useEffect(() => {
        let mounted = true
            ; (async () => {
                try {
                    if (!user?.email) return
                    const qry = query(
                        collection(db, 'participants'),
                        where('email', '==', user.email)
                    )
                    const snap = await getDocs(qry)
                    if (!mounted) return
                    if (!snap.empty) {
                        setParticipantId(snap.docs[0].id)
                        setParticipant(snap.docs[0].data() as Record<string, any>)
                    }
                } catch (err) {
                    console.error('participant lookup error', err)
                }
            })()
        return () => {
            mounted = false
        }
    }, [user?.email])

    // Load sent survey, my response, and template fallback
    useEffect(() => {
        let mounted = true
            ; (async () => {
                try {
                    setLoading(true)
                    if (!surveyId) throw new Error('No survey id.')

                    // sent survey
                    const sSnap = await getDoc(doc(db, 'sentForms', surveyId))
                    if (!sSnap.exists()) throw new Error('Survey not found.')
                    const sData = (sSnap.data() || {}) as SentSurveyDoc
                    if (!mounted) return
                    setSentSurvey(sData)

                    // id for my response doc
                    const myRespId = (participantId ||
                        user?.id ||
                        user?.email ||
                        'anon') as string
                    setResponseDocId(myRespId)

                    // my response
                    const rSnap = await getDoc(
                        doc(db, 'sentForms', surveyId, 'responses', myRespId)
                    )
                    if (!mounted) return
                    if (rSnap.exists()) {
                        const rData = rSnap.data() as ResponseDoc
                        setResponse(rData)
                        if (!rData.completed && rData.answersDraft) {
                            form.setFieldsValue(rData.answersDraft)
                        }
                        if (rData.completed) setSubmitted(true)
                    } else {
                        setResponse({
                            participantId: myRespId,
                            completed: false,
                            questions: [],
                            answersDraft: {}
                        })
                    }

                    // If we *don't* already have questions on response/sent, hydrate from template
                    const hasRespQs =
                        Array.isArray((rSnap.data() as any)?.questions) &&
                        (rSnap.data() as any)?.questions?.length
                    const hasSentQs =
                        Array.isArray(sData?.questions) && (sData?.questions?.length || 0) > 0

                    if (sData?.templateId && !hasRespQs && !hasSentQs) {
                        const tpl = await fetchTemplate(sData.templateId)
                        if (mounted) setTemplate(tpl)
                    }
                } catch (e: any) {
                    console.error(e)
                    message.error(e?.message || 'Failed to load survey.')
                    navigate('/operations/surveys')
                } finally {
                    if (mounted) setLoading(false)
                }
            })()
        return () => {
            mounted = false
        }
        // Re-run if participantId resolves later (common on first paint)
    }, [surveyId, participantId, user?.id, user?.email, form, navigate])

    // Final questions resolver (priority: response → sent → template(fields|questions))
    const questions = useMemo(() => {
        const fromResponse = normalizeQuestions(response?.questions)
        if (fromResponse.length) return fromResponse

        const fromSent = normalizeQuestions(sentSurvey?.questions)
        if (fromSent.length) return fromSent

        const raw =
            (template?.fields as any[]) || (template?.questions as any[]) || []
        const mapped = raw.map((f: any, i: number) => ({
            id: f?.id ?? `q_${i}`,
            type:
                f?.type === 'checkbox'
                    ? 'multiple'
                    : f?.type === 'radio'
                        ? 'multiple'
                        : f?.type === 'select'
                            ? 'multiple'
                            : f?.type === 'rating'
                                ? 'scale'
                                : f?.type === 'textarea'
                                    ? 'short'
                                    : f?.type ?? 'short',
            questionText:
                f?.questionText ?? f?.label ?? f?.title ?? `Question ${i + 1}`,
            required: !!f?.required,
            options: Array.isArray(f?.options) ? f.options : undefined,
            multipleMode: f?.type === 'checkbox' ? 'multi' : 'single',
            min: f?.min,
            max: f?.max,
            step: f?.step,
            placeholder: f?.placeholder,
            prefill: f?.prefill
        }))
        return normalizeQuestions(mapped)
    }, [response?.questions, sentSurvey?.questions, template])

    /**
     * Seed profile-answered questions.
     *
     * Only ever fills a blank: a saved draft or an already-submitted answer
     * always wins, so an SME's correction survives a reload. Values are written
     * to the response on submit and never back to their profile.
     */
    useEffect(() => {
        if (loading || submitted) return

        const prefilled = questions.filter(q => q.prefill)
        if (!prefilled.length) return

        const saved = { ...(response?.answers || {}), ...(response?.answersDraft || {}) }
        const patch: Record<string, any> = {}

        for (const q of prefilled) {
            const existing = form.getFieldValue(q.id) ?? saved[q.id]
            if (String(existing ?? '').trim()) continue

            const value = resolvePrefillValue(q.prefill as PrefillKey, {
                user,
                participant
            })
            if (value) patch[q.id] = value
        }

        if (Object.keys(patch).length) form.setFieldsValue(patch)
    }, [loading, submitted, questions, response, user, participant, form])

    // Title/description fallback to template metadata if missing on sent survey
    const title = sentSurvey?.title || template?.title || 'Survey'
    const description = sentSurvey?.description || template?.description || ''

    const normalizeValue = (v: any) =>
        dayjs.isDayjs(v) ? (v as Dayjs).toISOString() : v

    const collectValues = async () => {
        const raw = form.getFieldsValue(true)
        const out: Record<string, any> = {}
        for (const [k, v] of Object.entries(raw)) out[k] = normalizeValue(v)

        // handle file uploads (Firebase Storage)
        for (const [fieldId, info] of Object.entries(fileUploads)) {
            const f = info?.fileList?.[0]?.originFileObj as File | undefined
            if (!f || !surveyId || !responseDocId) continue
            const storageRef = ref(
                storage,
                `survey_uploads/${surveyId}/${responseDocId}/${fieldId}/${f.name}`
            )
            const snap = await uploadBytes(storageRef, f)
            out[fieldId] = await getDownloadURL(snap.ref)
        }
        return out
    }

    const saveDraft = async () => {
        if (!surveyId || !responseDocId) return
        try {
            setSaving(true)
            const draft = await collectValues()
            await updateDoc(
                doc(db, 'sentForms', surveyId, 'responses', responseDocId),
                { answersDraft: draft, completed: false, updatedAt: Timestamp.now() }
            )
            message.success('Progress saved')
        } catch (e) {
            console.error(e)
            message.error('Failed to save draft')
        } finally {
            setSaving(false)
        }
    }

    const submit = async () => {
        if (!surveyId || !responseDocId) return

        // Unmounted questions aren't validated by antd, so check the skipped
        // ones ourselves and take the SME straight to the first gap.
        const gap = firstUnansweredRequired()
        if (gap >= 0) {
            setCurrentIndex(gap)
            message.warning('Please answer all required questions.')
            return
        }

        try {
            setSubmitting(true)
            await form.validateFields()
            const answers = await collectValues()

            if (!Object.keys(answers || {}).length) {
                message.error(
                    'No answers captured. Please answer the questions before submitting.'
                )
                return
            }

            await updateDoc(
                doc(db, 'sentForms', surveyId, 'responses', responseDocId),
                {
                    completed: true,
                    submittedAt: Timestamp.now(),
                    answers,
                    answersDraft: {}
                }
            )

            message.success('Submitted!')
            setSubmitted(true)
        } catch (e: any) {
            if (e?.errorFields) {
                message.warning('Please answer all required questions.')
            } else {
                console.error(e)
                message.error('Submission failed.')
            }
        } finally {
            setSubmitting(false)
        }
    }

    // ── One-question-at-a-time navigation ──────────────────────
    // Headings aren't questions; they become the section eyebrow above the
    // question that follows them.
    // `type` is declared as ResponseType but normalizeQuestions passes builder
    // types like 'heading' straight through, hence the cast used elsewhere here.
    const answerable = useMemo(
        () => questions.filter(q => (q as any).type !== 'heading'),
        [questions]
    )

    const frameFields = useMemo(
        () =>
            questions.map(q => ({
                id: q.id,
                type: q.type as string,
                label: q.questionText
            })),
        [questions]
    )

    const [currentIndex, setCurrentIndex] = useState(0)

    // Keep the cursor in range if the question list resolves late or shrinks.
    useEffect(() => {
        if (answerable.length && currentIndex > answerable.length - 1) {
            setCurrentIndex(answerable.length - 1)
        }
    }, [answerable.length, currentIndex])

    const currentQuestion = answerable[currentIndex]
    const isFirst = currentIndex === 0
    const isLast = currentIndex === answerable.length - 1

    const watchedValues = Form.useWatch([], form)

    const hasAnswer = (q: Question, value: unknown): boolean => {
        if (value === undefined || value === null) return false
        if (Array.isArray(value)) return value.length > 0
        if (typeof value === 'string') return value.trim().length > 0
        if (q.type === 'scale') return typeof value === 'number' && value > 0
        return true
    }

    const answeredCount = useMemo(() => {
        const values = (watchedValues || {}) as Record<string, any>
        return answerable.filter(q => hasAnswer(q, values[q.id])).length
    }, [watchedValues, answerable])

    const goPrevious = () => setCurrentIndex(i => Math.max(0, i - 1))

    const goNext = async () => {
        if (currentQuestion?.required) {
            try {
                await form.validateFields([currentQuestion.id])
            } catch {
                return
            }
        }
        setCurrentIndex(i => Math.min(answerable.length - 1, i + 1))
    }

    /**
     * Only the mounted question is registered with the Form, so
     * `validateFields()` can't catch a required question the SME skipped past.
     * Check them all against the current values and jump to the first gap.
     */
    const firstUnansweredRequired = (): number => {
        const values = (watchedValues || form.getFieldsValue(true) || {}) as Record<
            string,
            any
        >
        return answerable.findIndex(q => q.required && !hasAnswer(q, values[q.id]))
    }

    const fieldRules = (q: Question) =>
        q.required
            ? [{ required: true, message: `Please answer: ${q.questionText}` }]
            : []

    const renderField = (q: Question) => {
        const itemProps = {
            // No label: SurveyQuestionFrame renders the question heading, so a
            // Form.Item label here would print it twice.
            name: q.id,
            key: q.id,
            rules: fieldRules(q),
            // Editable on purpose: the profile can be out of date, and a locked
            // wrong value would be a dead end. Corrections stay on the response.
            extra: q.prefill ? (
                <Text type='secondary' style={{ fontSize: 12 }}>
                    Filled in from your profile — edit it here if it&apos;s not
                    right. Your profile won&apos;t change.
                </Text>
            ) : undefined
        } as const

        if (q.type === 'short')
            return (
                <Form.Item {...itemProps}>
                    <Input placeholder={q.placeholder} />
                </Form.Item>
            )

        if (q.type === 'scale') {
            const max = q.max ?? 5
            return (
                <Form.Item {...itemProps}>
                    <Rate count={max} />
                </Form.Item>
            )
        }

        // multiple (single or multi)
        if (q.type === 'multiple') {
            const mode = q.multipleMode ?? 'single'
            const opts = q.options || []
            return mode === 'single' ? (
                <Form.Item {...itemProps}>
                    <Radio.Group>
                        <Space direction='vertical'>
                            {opts.map(o => (
                                <Radio key={o} value={o}>
                                    {o}
                                </Radio>
                            ))}
                        </Space>
                    </Radio.Group>
                </Form.Item>
            ) : (
                <Form.Item {...itemProps} valuePropName='value'>
                    <Checkbox.Group>
                        <Space direction='vertical'>
                            {opts.map(o => (
                                <Checkbox key={o} value={o}>
                                    {o}
                                </Checkbox>
                            ))}
                        </Space>
                    </Checkbox.Group>
                </Form.Item>
            )
        }

        // builder parity
        if ((q as any).type === 'textarea')
            return (
                <Form.Item {...itemProps}>
                    <TextArea rows={4} placeholder={q.placeholder} />
                </Form.Item>
            )

        if ((q as any).type === 'email')
            return (
                <Form.Item {...itemProps} rules={[...fieldRules(q), { type: 'email' }]}>
                    <Input type='email' placeholder={q.placeholder} />
                </Form.Item>
            )

        if ((q as any).type === 'number')
            return (
                <Form.Item {...itemProps}>
                    <Input type='number' placeholder={q.placeholder} />
                </Form.Item>
            )

        if ((q as any).type === 'select')
            return (
                <Form.Item {...itemProps}>
                    <Select placeholder={q.placeholder}>
                        {(q.options || []).map(o => (
                            <Option key={o} value={o}>
                                {o}
                            </Option>
                        ))}
                    </Select>
                </Form.Item>
            )

        if ((q as any).type === 'date')
            return (
                <Form.Item {...itemProps}>
                    <DatePicker style={{ width: '100%' }} />
                </Form.Item>
            )

        if ((q as any).type === 'file')
            return (
                <Form.Item
                    {...itemProps}
                    valuePropName='fileList'
                    getValueFromEvent={e => e?.fileList}
                >
                    <Upload
                        listType='text'
                        maxCount={1}
                        beforeUpload={() => false}
                        onChange={info =>
                            setFileUploads(prev => ({ ...prev, [q.id]: info }))
                        }
                    >
                        <Button icon={<UploadOutlined />}>Upload File</Button>
                    </Upload>
                </Form.Item>
            )

        // "heading" render (if a builder "heading" slipped through to questions)
        if ((q as any).type === 'heading') {
            return (
                <div key={q.id} style={{ margin: '24px 0' }}>
                    <Title level={4} style={{ marginBottom: 4 }}>
                        {q.questionText || 'Section'}
                    </Title>
                    <Divider style={{ margin: '12px 0 0' }} />
                </div>
            )
        }

        return null
    }

    // ─────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────
    if (loading) {
        return <LoadingOverlay tip='Loading questions' />
    }

    if (!sentSurvey && !template) {
        return (
            <MotionCard>
                <Alert
                    type='error'
                    message='Error'
                    description='Could not load the requested survey.'
                    showIcon
                />
            </MotionCard>
        )
    }

    if (submitted) {
        return (
            <MotionCard style={{ minHeight: '100vh' }}>
                <Result
                    status='success'
                    title='Response Submitted Successfully!'
                    subTitle={title}
                    extra={[
                        <Button
                            icon={<ArrowLeftOutlined />}
                            variant='filled'
                            color='primary'
                            key='back'
                            style={roundBtn}
                            onClick={() => navigate('/incubatee/documents/hub')}
                        >
                            Back to Surveys
                        </Button>
                    ]}
                />
            </MotionCard>
        )
    }

    return (
        <MotionCard style={{ minHeight: '100vh', padding: 24 }}>
            <Helmet><title>Response Page | Smart Incubation</title></Helmet>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 16
                }}
            >
                <Button
                    icon={<ArrowLeftOutlined />}
                    variant='filled'
                    color='primary'
                    style={roundBtn}
                    onClick={() => navigate('/incubatee/documents/hub')}
                >
                    Back to Surveys
                </Button>
                {participantName ? (
                    <Text type='secondary'>Responding as: {participantName}</Text>
                ) : null}
            </div>

            <Form form={form} layout='vertical' requiredMark>
                {currentQuestion ? (
                    <SurveyQuestionFrame
                        index={currentIndex}
                        total={answerable.length}
                        answeredCount={answeredCount}
                        field={{
                            id: currentQuestion.id,
                            type: currentQuestion.type,
                            label: currentQuestion.questionText,
                            required: currentQuestion.required
                        }}
                        sectionLabel={findSectionLabel(
                            frameFields,
                            currentQuestion.id
                        )}
                        header={
                            <>
                                <Title level={3} style={{ margin: 0 }}>
                                    {title}
                                </Title>
                                {description ? (
                                    <Paragraph
                                        type='secondary'
                                        style={{ margin: '4px 0 0' }}
                                    >
                                        {description}
                                    </Paragraph>
                                ) : null}
                            </>
                        }
                        footer={
                            <div
                                style={{
                                    display: 'flex',
                                    gap: 12,
                                    justifyContent: 'space-between',
                                    flexWrap: 'wrap'
                                }}
                            >
                                <Button
                                    icon={<SaveOutlined />}
                                    shape='round'
                                    size='large'
                                    onClick={saveDraft}
                                    loading={saving}
                                    disabled={submitting}
                                >
                                    Save Draft
                                </Button>

                                <Space>
                                    {!isFirst ? (
                                        <Button
                                            size='large'
                                            shape='round'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={goPrevious}
                                            disabled={submitting}
                                        >
                                            Previous
                                        </Button>
                                    ) : null}

                                    {isLast ? (
                                        <Button
                                            type='primary'
                                            size='large'
                                            shape='round'
                                            icon={<SendOutlined />}
                                            onClick={submit}
                                            loading={submitting}
                                        >
                                            Submit
                                        </Button>
                                    ) : (
                                        <Button
                                            type='primary'
                                            size='large'
                                            shape='round'
                                            onClick={goNext}
                                            disabled={submitting}
                                        >
                                            Next <ArrowRightOutlined />
                                        </Button>
                                    )}
                                </Space>
                            </div>
                        }
                    >
                        {renderField(currentQuestion)}
                    </SurveyQuestionFrame>
                ) : (
                    <Text type='secondary'>No questions available</Text>
                )}

            </Form>
        </MotionCard>
    )
}

export default RespondSurvey
