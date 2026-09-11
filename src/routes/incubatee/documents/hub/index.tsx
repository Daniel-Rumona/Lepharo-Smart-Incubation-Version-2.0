import React, { useEffect, useMemo, useState } from 'react'
import {
    Table,
    Tag,
    Button,
    Modal,
    Form,
    Input,
    Radio,
    Checkbox,
    Rate,
    Select,
    Space,
    Typography,
    Card,
    Divider,
    message,
    List,
    Grid
} from 'antd'
import {
    EyeOutlined,
    FileTextOutlined,
    FormOutlined,
    SaveOutlined,
    SendOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { db } from '@/firebase'
import {
    collectionGroup,
    query,
    where,
    onSnapshot,
    getDoc,
    doc,
    updateDoc,
    Timestamp,
    collection,
    getDocs
} from 'firebase/firestore'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import MetricsGrid from '@/components/dashboards/metrics/MetricsGrid'
import '@/styles/incubatee-documents-hub.css'

const { Text } = Typography
const { TextArea } = Input
const { Option } = Select
const { useBreakpoint } = Grid

// ---- Types ----
type ResponseType = 'multiple' | 'scale' | 'short'

interface Question {
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
}

interface DepartmentFormTemplate {
    id: string
    title?: string
    description?: string
    type?: string
    department?: string
    questions?: Question[]
}

interface DocumentRow {
    id: string
    responseDocId: string
    title: string
    type: string
    description: string
    department?: string
    status: 'pending' | 'in_progress' | 'completed'
    dueDate?: string
    requestedBy?: string
    questions: Question[]
    draftData?: any
    answers?: Record<string, any>
    submittedAt?: any
    completed?: boolean
    templateId?: string
}

function normalizeQuestions(raw: any[] | undefined): Question[] {
    if (!Array.isArray(raw)) return []
    return raw.map((q, i) => {
        // accept several shapes
        const id = q.id ?? q.key ?? `q_${i}`
        const type = q.type ?? q.options?.type ?? 'short'
        const questionText =
            q.questionText ?? q.options?.question ?? q.question ?? `Question ${i + 1}`

        // normalize options for multiple-choice
        let opts: string[] | undefined = undefined
        if (type === 'multiple') {
            if (Array.isArray(q.options)) {
                opts = q.options
            } else if (Array.isArray(q.options?.options)) {
                opts = q.options.options
            } else if (q.options && typeof q.options === 'object') {
                // sometimes options might be {0:"Yes",1:"No",...}
                const vals = Object.values(q.options).filter(v => typeof v === 'string')
                opts = vals.length ? (vals as string[]) : undefined
            }
        }

        return {
            id,
            type,
            questionText,
            required: q.required ?? false,
            multipleMode:
                q.multipleMode ??
                (type === 'multiple' ? q.multipleMode ?? 'single' : undefined),
            min: q.min ?? q.options?.min,
            max: q.max ?? q.options?.max,
            step: q.step ?? q.options?.step,
            placeholder: q.placeholder,
            options: opts
        } as Question
    })
}

// Simple in-memory cache for departmentForms templates during the session
const templateCache = new Map<string, DepartmentFormTemplate | null>()

async function getTemplateById(
    templateId: string
): Promise<DepartmentFormTemplate | null> {
    if (!templateId) return null
    if (templateCache.has(templateId)) return templateCache.get(templateId)! // can be null

    try {
        const snap = await getDoc(doc(db, 'departmentForms', templateId))
        const tpl = snap.exists()
            ? ({ id: snap.id, ...snap.data() } as DepartmentFormTemplate)
            : null
        templateCache.set(templateId, tpl)
        return tpl
    } catch (e) {
        console.error('Failed to fetch departmentForms template:', e)
        templateCache.set(templateId, null)
        return null
    }
}

function stripUndefinedDeep<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
        return obj
            .map(stripUndefinedDeep)
            .filter(v => v !== undefined) as unknown as T
    }
    const out: any = {}
    for (const [k, v] of Object.entries(obj as any)) {
        const vv = stripUndefinedDeep(v as any)
        if (vv !== undefined) out[k] = vv
    }
    return out
}

const DocumentsHub: React.FC = () => {
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const [documents, setDocuments] = useState<DocumentRow[]>([])
    const [selectedDocument, setSelectedDocument] = useState<DocumentRow | null>(
        null
    )
    const [modalVisible, setModalVisible] = useState(false)
    const [form] = Form.useForm()

    const [participantId, setParticipantId] = useState<string | null>(null)
    const [participantName, setParticipantName] = useState<string>('')
    const [deptNameById, setDeptNameById] = useState<Map<string, string>>(new Map())

    useEffect(() => {
        let mounted = true

            ; (async () => {
                try {
                    const snap = await getDocs(collection(db, 'departments'))
                    if (!mounted) return

                    const m = new Map<string, string>()
                    snap.docs.forEach(d => {
                        const data = d.data() as any
                        const name =
                            data?.departmentName ||
                            data?.name ||
                            data?.title ||
                            data?.label ||
                            d.id
                        m.set(d.id, String(name))
                    })

                    setDeptNameById(m)
                } catch (e) {
                    console.error('Failed to load departments:', e)
                }
            })()

        return () => {
            mounted = false
        }
    }, [])


    // Resolve participant by email
    useEffect(() => {
        if (!user?.email) {
            setParticipantId(null)
            setParticipantName('')
            return
        }

        let isMounted = true
            ; (async () => {
                try {
                    const qry = query(
                        collection(db, 'participants'),
                        where('email', '==', user?.email)
                    )
                    const snap = await getDocs(qry)
                    if (!isMounted) return

                    if (!snap.empty) {
                        const d = snap.docs[0]
                        const data = d.data() as any
                        setParticipantId(d.id)
                        setParticipantName(
                            data.beneficiaryName || data.name || data.email || ''
                        )
                    } else {
                        setParticipantId(null)
                        setParticipantName('')
                    }
                } catch (err) {
                    console.error('Failed to load participant by email:', err)
                    if (isMounted) {
                        setParticipantId(null)
                        setParticipantName('')
                    }
                }
            })()

        return () => {
            isMounted = false
        }
    }, [user?.email])

    // Realtime load of assigned forms, then hydrate from departmentForms via templateId
    useEffect(() => {
        if (!participantId) return

        const q = query(
            collectionGroup(db, 'responses'),
            where('participantId', '==', participantId)
        )

        const unsub = onSnapshot(
            q,
            async snap => {
                // Build rows with template hydration
                const rows = await Promise.all(
                    snap.docs.map(async respSnap => {
                        const resp = respSnap.data() as any
                        const formRef = respSnap.ref.parent.parent! // /sentForms/{formId}
                        const formSnap = await getDoc(formRef)
                        const form = (formSnap.exists() ? formSnap.data() : {}) as any

                        // where can templateId exist?
                        // 1) responses doc (preferred), 2) sentForms doc, 3) none
                        const templateId: string | undefined =
                            resp?.templateId || form?.templateId || undefined

                        // load departmentForms/{templateId} if available
                        const tpl = templateId ? await getTemplateById(templateId) : null

                        // status based on response progress
                        const status: DocumentRow['status'] = resp.completed
                            ? 'completed'
                            : resp.answersDraft && Object.keys(resp.answersDraft || {}).length
                                ? 'in_progress'
                                : 'pending'

                        // Merge title/desc/type/department/questions with priority:
                        const mergedQuestionsRaw =
                            (tpl?.questions as any[] | undefined) ??
                            (Array.isArray(form.questions)
                                ? (form.questions as any[])
                                : undefined) ??
                            (Array.isArray(resp.questions)
                                ? (resp.questions as any[])
                                : undefined) ??
                            []

                        const merged: Partial<DocumentRow> = {
                            title: tpl?.title ?? form.title ?? 'Untitled Form',
                            description: tpl?.description ?? form.description ?? '',
                            type: tpl?.type ?? form.type ?? 'marketing',
                            department:
                                tpl?.department ?? form.department ?? form.requestedBy ?? '',
                            questions: normalizeQuestions(mergedQuestionsRaw)
                        }

                        return {
                            id: formRef.id,
                            responseDocId: respSnap.id, // usually participantId
                            status,
                            dueDate: form.dueDate || '',
                            requestedBy: form.requestedBy || form.department || '',
                            draftData: resp.answersDraft || undefined,
                            answers: resp.answers || undefined,
                            submittedAt: resp.submittedAt ?? null,
                            completed: !!resp.completed,
                            templateId,
                            ...merged
                        } as DocumentRow
                    })
                )

                setDocuments(rows)
            },
            err => console.error('responses listener error', err)
        )

        return () => unsub()
    }, [participantId])

    // Prefill form with draft or answers
    const handleViewDocument = (docRow: DocumentRow) => {
        setSelectedDocument(docRow)
        setModalVisible(true)
        form.resetFields()

        // Only preload draft (not submitted answers)
        if (docRow.status !== 'completed' && docRow.draftData) {
            form.setFieldsValue(docRow.draftData)
        }
    }

    const handleSaveDraft = async () => {
        if (!selectedDocument || !participantId) return
        try {
            const draftValuesRaw = form.getFieldsValue()
            const draftValues = stripUndefinedDeep(draftValuesRaw)

            await updateDoc(
                doc(db, 'sentForms', selectedDocument.id, 'responses', participantId),
                { answersDraft: draftValues, updatedAt: Timestamp.now() }
            )

            message.success('Draft saved!')
            // reflect locally
            setDocuments(prev =>
                prev.map(d =>
                    d.id === selectedDocument.id
                        ? { ...d, draftData: draftValues, status: 'in_progress' }
                        : d
                )
            )
        } catch (e) {
            console.error(e)
            message.error('Failed to save draft.')
        }
    }

    const handleSubmitForm = async () => {
        if (!selectedDocument || !participantId) return

        try {
            const submitValuesRaw = await form.validateFields()
            const submitValues = stripUndefinedDeep(submitValuesRaw)

            if (!submitValues || Object.keys(submitValues).length === 0) {
                message.error(
                    'No answers captured. Please answer the questions before submitting.'
                )
                return
            }

            await updateDoc(
                doc(db, 'sentForms', selectedDocument.id, 'responses', participantId),
                {
                    completed: true,
                    submittedAt: Timestamp.now(),
                    answers: submitValues,
                    answersDraft: {}
                }
            )

            message.success('Submitted!')
            setModalVisible(false)
            form.resetFields()
            setSelectedDocument(null)
        } catch (e: any) {
            if (e?.errorFields) {
                message.warning('Please answer all required questions.')
            } else {
                console.error(e)
                message.error('Submission failed.')
            }
        }
    }

    // ---- Metrics ----
    const totalDocuments = documents.length
    const pendingDocuments = documents.filter(d => d.status === 'pending').length
    const inProgressDocuments = documents.filter(
        d => d.status === 'in_progress'
    ).length
    const completedDocuments = documents.filter(
        d => d.status === 'completed'
    ).length
    const getStatusColor = (s: string) =>
        s === 'pending' ? 'orange' : s === 'in_progress' ? 'blue' : 'green'
    const getStatusLabel = (status: string) =>
        status.replace('_', ' ').toUpperCase()
    const getDepartmentName = (department?: string) => {
        const id = String(department || '').trim()
        return (id ? deptNameById.get(id) : undefined) || id || 'Unassigned'
    }
    const getDocumentActionLabel = (document: DocumentRow) =>
        document.status === 'completed'
            ? 'View Response'
            : document.status === 'in_progress'
                ? 'Continue'
                : 'Start'
    const handleDocumentAction = (document: DocumentRow) => {
        if (document.status === 'completed') {
            handleViewDocument(document)
            return
        }

        navigate(`/incubatee/surveys/respond/${document.id}`)
    }
    const getTypeIcon = (type: string) =>
        type === 'psychometric' ? (
            <FormOutlined />
        ) : type === 'customer_satisfaction' ? (
            <EyeOutlined />
        ) : (
            <FileTextOutlined />
        )
    const getTypeLabel = (t: string) =>
        t === 'psychometric'
            ? 'Psychometric'
            : t === 'customer_satisfaction'
                ? 'Customer Satisfaction'
                : t === 'marketing'
                    ? 'Marketing'
                    : t

    const columns: ColumnsType<DocumentRow> = [
        {
            title: 'Document',
            dataIndex: 'title',
            render: (_: any, r) => (
                <Space>
                    {getTypeIcon(r.type)}
                    <div>
                        <div style={{ fontWeight: 'bold' }}>{r.title}</div>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {r.description}
                        </Text>
                        {r.status === 'in_progress' && (
                            <div>
                                <Tag color='blue'>Draft Saved</Tag>
                            </div>
                        )}
                    </div>
                </Space>
            )
        },
        {
            title: 'Department',
            dataIndex: 'department',
            render: (deptId: any) => {
                const id = String(deptId || '').trim()
                const name = id ? deptNameById.get(id) : undefined
                return <Text>{name || id || '—'}</Text>
            }
        },
        {
            title: 'Status',
            dataIndex: 'status',
            render: s => (
                <Tag color={getStatusColor(s)}>{getStatusLabel(s)}</Tag>
            )
        },

        {
            title: 'Action',
            render: (_: any, r) => (
                <Button
                    variant='filled'
                    color='primary'
                    icon={
                        r.status === 'completed' ? (
                            <EyeOutlined />
                        ) : (
                            <FormOutlined />
                        )
                    }
                    onClick={() => handleDocumentAction(r)}
                >
                    {getDocumentActionLabel(r)}
                </Button>
            )
        }
    ]

    const renderQuestionInput = (q: Question) => {
        if (q.type === 'short') {
            return <Input placeholder={q.placeholder} />
        }

        if (q.type === 'scale') {
            const min = q.min ?? 1
            const max = q.max ?? 5
            const step = q.step ?? 1
            const useRate = min === 1 && step === 1 && max <= 10
            return useRate ? <Rate count={max} /> : <Rate count={max} />
            // If you prefer Slider later, swap here.
        }

        // multiple
        const mode = q.multipleMode ?? 'single'
        const opts = q.options || []

        return mode === 'single' ? (
            <Radio.Group>
                <Space direction='vertical'>
                    {opts.map((o, i) => (
                        <Radio key={i} value={o}>
                            {o}
                        </Radio>
                    ))}
                </Space>
            </Radio.Group>
        ) : (
            <Checkbox.Group>
                <Space direction='vertical'>
                    {opts.map((o, i) => (
                        <Checkbox key={i} value={o}>
                            {o}
                        </Checkbox>
                    ))}
                </Space>
            </Checkbox.Group>
        )
    }

    function renderAnswerPreviewValue(q: Question, val: any) {
        if (val == null) return <Text type='secondary'>—</Text>

        if (q.type === 'multiple') {
            if (Array.isArray(val)) {
                return (
                    <Space wrap>
                        {val.map((v: string) => (
                            <Tag key={v}>{v}</Tag>
                        ))}
                    </Space>
                )
            }
            return <Tag>{String(val)}</Tag>
        }

        if (q.type === 'scale') {
            // Simple star-ish readout; replace with <Rate disabled value={Number(val)} /> if you prefer stars
            return <Text strong>{Number(val)}</Text>
        }

        // short text
        return <Text>{String(val)}</Text>
    }

    return (
        <div style={{ padding: screens.md ? 24 : 12, minHeight: '100vh' }}>
            <div style={{ marginBottom: 12 }}>
                <MetricsGrid
                    metrics={[
                        {
                            key: 'total',
                            title: 'Total Documents',
                            mobileTitle: 'Total',
                            value: totalDocuments,
                            subtitle: 'All assigned documents',
                            mobileSubtitle: 'All assigned',
                            icon: <FileTextOutlined style={{ color: '#1677ff' }} />,
                            iconBg: '#e6f4ff'
                        },
                        {
                            key: 'pending',
                            title: 'Pending',
                            value: pendingDocuments,
                            subtitle: 'Documents awaiting action',
                            mobileSubtitle: 'Awaiting action',
                            icon: (
                                <ExclamationCircleOutlined
                                    style={{ color: '#d46b08' }}
                                />
                            ),
                            iconBg: '#fff7e6',
                            important: true
                        },
                        {
                            key: 'in-progress',
                            title: 'In Progress',
                            value: inProgressDocuments,
                            subtitle: 'Saved responses in progress',
                            mobileSubtitle: 'Saved drafts',
                            icon: (
                                <ClockCircleOutlined
                                    style={{ color: '#1677ff' }}
                                />
                            ),
                            iconBg: '#e6f4ff',
                            important: true
                        },
                        {
                            key: 'completed',
                            title: 'Completed',
                            value: completedDocuments,
                            subtitle: 'Submitted documents',
                            mobileSubtitle: 'Submitted',
                            icon: (
                                <CheckCircleOutlined
                                    style={{ color: '#389e0d' }}
                                />
                            ),
                            iconBg: '#f6ffed'
                        }
                    ]}
                    gutter={[12, 12]}
                    desktopSpan={6}
                />
            </div>

            <MotionCard>
                {screens.md ? (
                    <Table
                        columns={columns}
                        dataSource={documents}
                        rowKey={r => `${r.id}_${r.responseDocId}`}
                        pagination={{ pageSize: 10 }}
                    />
                ) : (
                    <List
                        className='documents-hub-mobile-list'
                        dataSource={documents}
                        pagination={{
                            pageSize: 10,
                            hideOnSinglePage: true,
                            size: 'small'
                        }}
                        renderItem={document => (
                            <List.Item>
                                <Card
                                    className='documents-hub-mobile-card'
                                    size='small'
                                >
                                    <div className='documents-hub-card-heading'>
                                        <Space size={8}>
                                            {getTypeIcon(document.type)}
                                            <Text strong>{document.title}</Text>
                                        </Space>
                                        <Tag color={getStatusColor(document.status)}>
                                            {getStatusLabel(document.status)}
                                        </Tag>
                                    </div>

                                    {document.description && (
                                        <Text
                                            className='documents-hub-card-description'
                                            type='secondary'
                                        >
                                            {document.description}
                                        </Text>
                                    )}

                                    <div className='documents-hub-card-meta'>
                                        <Text type='secondary'>Department</Text>
                                        <Text>
                                            {getDepartmentName(document.department)}
                                        </Text>
                                    </div>

                                    {document.status === 'in_progress' && (
                                        <Tag color='blue'>Draft Saved</Tag>
                                    )}

                                    <Button
                                        className='documents-hub-card-action'
                                        variant='filled'
                                        color='primary'
                                        icon={
                                            document.status === 'completed' ? (
                                                <EyeOutlined />
                                            ) : (
                                                <FormOutlined />
                                            )
                                        }
                                        onClick={() =>
                                            handleDocumentAction(document)
                                        }
                                    >
                                        {getDocumentActionLabel(document)}
                                    </Button>
                                </Card>
                            </List.Item>
                        )}
                    />
                )}
            </MotionCard>


            <Modal
                title={
                    <Space>
                        {selectedDocument && getTypeIcon(selectedDocument.type)}
                        <span>{selectedDocument?.title}</span>
                        {selectedDocument?.status === 'completed' && (
                            <Tag color='green'>Submitted</Tag>
                        )}
                        {selectedDocument?.status !== 'completed' &&
                            selectedDocument?.draftData && (
                                <Tag color='blue'>Draft available</Tag>
                            )}
                    </Space>
                }
                open={modalVisible}
                onCancel={() => {
                    setModalVisible(false)
                    form.resetFields()
                    setSelectedDocument(null)
                }}
                width={800}
                footer={null}
            >
                {selectedDocument && (
                    <>
                        <Card
                            size='small'
                            style={{ marginBottom: 16, background: '#f9f9f9' }}
                        >
                            <Text strong>Description: </Text>
                            <Text>{selectedDocument.description}</Text>
                            <br />
                            <Text strong>Department: </Text>
                            <Text>{selectedDocument.department || '—'}</Text>
                            {selectedDocument.status === 'completed' &&
                                selectedDocument.submittedAt && (
                                    <>
                                        <br />
                                        <Text strong>Submitted: </Text>
                                        <Text>
                                            {selectedDocument.submittedAt.toDate?.()
                                                ? selectedDocument.submittedAt.toDate().toLocaleString()
                                                : ''}
                                        </Text>
                                    </>
                                )}
                        </Card>

                        {selectedDocument.status === 'completed' ? (
                            // ---------- READ-ONLY SUBMISSION PREVIEW ----------
                            <Card type='inner' title='Your submission (read-only)'>
                                <Space direction='vertical' style={{ width: '100%' }}>
                                    {selectedDocument.questions.map((q, i) => {
                                        const ans = selectedDocument.answers?.[q.id]
                                        return (
                                            <div key={q.id}>
                                                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                                                    {q.questionText}
                                                </div>
                                                <div>{renderAnswerPreviewValue(q, ans)}</div>
                                                {i < selectedDocument.questions.length - 1 && (
                                                    <Divider />
                                                )}
                                            </div>
                                        )
                                    })}
                                </Space>
                                <div style={{ textAlign: 'right', marginTop: 16 }}>
                                    <Button
                                        onClick={() => {
                                            setModalVisible(false)
                                            form.resetFields()
                                            setSelectedDocument(null)
                                        }}
                                    >
                                        Close
                                    </Button>
                                </div>
                            </Card>
                        ) : (
                            // ---------- EDITABLE FORM (draft or new) ----------
                            <Form form={form} layout='vertical'>
                                {selectedDocument.questions.map((q, i) => (
                                    <div key={q.id}>
                                        <Form.Item
                                            label={
                                                <span>
                                                    {q.questionText}
                                                    {q.required && (
                                                        <span style={{ color: 'red' }}> *</span>
                                                    )}
                                                </span>
                                            }
                                            name={q.id}
                                            rules={[
                                                {
                                                    required: !!q.required,
                                                    message: `Please answer: ${q.questionText}`
                                                }
                                            ]}
                                        >
                                            {renderQuestionInput(q)}
                                        </Form.Item>
                                        {i < selectedDocument.questions.length - 1 && <Divider />}
                                    </div>
                                ))}

                                <div style={{ textAlign: 'right', marginTop: 24 }}>
                                    <Space>
                                        <Button
                                            onClick={() => {
                                                setModalVisible(false)
                                                form.resetFields()
                                                setSelectedDocument(null)
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button icon={<SaveOutlined />} onClick={handleSaveDraft}>
                                            Save Draft
                                        </Button>
                                        <Button
                                            type='primary'
                                            icon={<SendOutlined />}
                                            onClick={handleSubmitForm}
                                        >
                                            Submit
                                        </Button>
                                    </Space>
                                </div>
                            </Form>
                        )}
                    </>
                )}
            </Modal>
        </div>
    )
}

export default DocumentsHub
