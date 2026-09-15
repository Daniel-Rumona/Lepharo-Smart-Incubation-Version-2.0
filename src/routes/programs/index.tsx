import React, { useEffect, useMemo, useState } from 'react'
import {
    Table,
    Button,
    Modal,
    Form,
    Input,
    DatePicker,
    InputNumber,
    message,
    Space,
    Typography,
    Tag,
    Row,
    Col,
    Select,
    Steps,
    Alert,
    Checkbox,
    Result,
    Popconfirm,
    Upload,
    Card,
    Empty,
    Spin,
    Segmented
} from 'antd'
import {
    ProjectOutlined,
    CheckCircleOutlined,
    DollarOutlined,
    TeamOutlined,
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    PoweroffOutlined, PictureOutlined,
    DownloadOutlined,
    FileTextOutlined,
    UploadOutlined,
    RightOutlined
} from '@ant-design/icons'
import CountUp from 'react-countup'
import {
    collection,
    getDocs,
    addDoc,
    doc,
    updateDoc,
    deleteDoc,
    query,
    where,
    Timestamp,
    writeBatch,
    orderBy,
    serverTimestamp
} from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import { motion, AnimatePresence } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import type { UploadProps } from 'antd'
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import {
    DEFAULT_PROGRAM_LIMIT
} from '@/services/systemSettingsService'
import {
    AgreementTemplate,
    canonicalAgreementId,
    listAgreementTemplates
} from '@/services/complianceResolver'
import { departmentService } from '@/services/departmentService'

const { Text } = Typography

type ProposalStatus =
    | 'Draft'
    | 'Submitted'
    | 'Under Review'
    | 'Approved'
    | 'In Progress'
    | 'Completed'
    | 'Rejected'

type ProjectProposal = {
    id: string

    branchId?: string | null
    assignedBranch?: { id: string; name: string } | null

    title: string
    about: string
    funder: string

    proposedDate: any // Timestamp
    startDate?: any | null // Timestamp | null
    cohortYear?: number | string

    status: ProposalStatus
    rejectionReason?: string | null

    proposalDocUrl?: string | null
    proposalDocPath?: string | null

    createdAt?: any
    updatedAt?: any
}

type ProposalUpdate = {
    id: string
    note: string
    status?: ProposalStatus | null
    docUrl?: string | null
    docPath?: string | null
    createdAt?: any
    createdBy?: { email?: string | null; name?: string | null } | null
}

const PROPOSAL_STATUSES: ProposalStatus[] = [
    'Draft',
    'Submitted',
    'Under Review',
    'Approved',
    'In Progress',
    'Completed',
    'Rejected'
]

const statusTag = (s: ProposalStatus) => {
    const map: Record<ProposalStatus, string> = {
        Draft: 'default',
        Submitted: 'blue',
        'Under Review': 'gold',
        Approved: 'green',
        'In Progress': 'processing',
        Completed: 'cyan',
        Rejected: 'red'
    }
    return <Tag color={map[s] || 'default'}>{s}</Tag>
}

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9.\-_]/g, '_')

const uploadProposalFile = async (
    proposalId: string,
    file: File,
    folder: 'proposal' | 'updates'
) => {
    const storage = getStorage()
    const path = `projectProposals/${proposalId}/${folder}/${Date.now()}_${safeFileName(
        file.name
    )}`
    const storageRef = ref(storage, path)
    const snap = await uploadBytes(storageRef, file, {
        contentType: file.type || 'application/octet-stream'
    })
    const url = await getDownloadURL(snap.ref)
    return { url, path }
}

const tryDeleteStoragePath = async (path?: string | null) => {
    if (!path) return
    try {
        const storage = getStorage()
        await deleteObject(ref(storage, path))
    } catch {
        // ignore (file might not exist / permissions)
    }
}

const parseAnyToDayjs = (val: any) => {
    if (!val) return null
    if (typeof val === 'string') return dayjs(val)
    if (val?.toDate) return dayjs(val.toDate())
    return null
}

const PROGRAM_TYPES = [
    'Pre-incubation',
    'Business Incubation',
    'Virtual Incubation',
    'Accelerator Program',
    'Technology Incubation',
    'Youth Incubation',
    'Women Empowerment Program',
    'Green Economy Incubation',
    'Agro-Processing Support'
]

const SECTORS = ['Agriculture', 'IT', 'Manufacturing', 'Tourism', 'Other']
const PROVINCES = [
    'Gauteng',
    'Western Cape',
    'KwaZulu-Natal',
    'Eastern Cape',
    'Limpopo',
    'Mpumalanga',
    'Northern Cape',
    'North West',
    'Free State'
]
const GENDERS = ['Male', 'Female', 'Other']
const BEE_LEVELS = [1, 2, 3, 4, '5+']
const OWNERSHIP_FIELDS = [
    'youthOwnedPercent',
    'femaleOwnedPercent',
    'blackOwnedPercent'
]

const CRITERIA_OPTIONS = [
    { value: 'minAge', label: 'Minimum Age' },
    { value: 'maxAge', label: 'Maximum Age' },
    { value: 'gender', label: 'Gender' },
    { value: 'sector', label: 'Sector' },
    { value: 'province', label: 'Province' },
    { value: 'minYearsOfTrading', label: 'Years of Trading' },
    { value: 'beeLevel', label: 'B-BBEE Level' },
    { value: 'youthOwnedPercent', label: 'Min Youth Ownership %' },
    { value: 'femaleOwnedPercent', label: 'Min Female Ownership %' },
    { value: 'blackOwnedPercent', label: 'Min Black Ownership %' }
]

// Helpers for docs
type DocType = 'compliance' | 'agreement'
type RequiredDocTemplate = {
    id: string // templateId
    title: string
    type: DocType
    isOnboarding: true
    departmentOwner: string
    mandatory: boolean
    expiryRule?: { months?: number | null } | null
}

const inferDepartmentOwner = (title: string): string => {
    const t = title.toLowerCase()
    if (t.includes('moa') || t.includes('contract') || t.includes('nda'))
        return 'Legal'
    if (t.includes('tax') || t.includes('bank') || t.includes('financial'))
        return 'Finance'
    return 'Operations'
}

const toTemplate = (r: RequiredDoc): RequiredDocTemplate => ({
    id: r.key,
    title: r.title,
    type: (r.kind ?? 'upload') === 'agreement' ? 'agreement' : 'compliance',
    isOnboarding: true,
    departmentOwner: inferDepartmentOwner(r.title),
    mandatory: !!r.requiredAtApplication,
    expiryRule: r.hasExpiry ? { months: r.expiryMonths ?? null } : null
})

const upsertProgramRequiredDocs = async (
    programId: string,
    docs: RequiredDoc[]
) => {
    const batch = writeBatch(db)
    const colRef = collection(db, 'programs', programId, 'requiredDocs')

    const existing = await getDocs(colRef)
    existing.forEach(d => batch.delete(d.ref))

    const templates = docs.map(toTemplate)
    templates.forEach(t => {
        const tRef = doc(db, 'programs', programId, 'requiredDocs', t.id)
        batch.set(tRef, t)
    })
    await batch.commit()
}

const fetchProgramRequiredDocs = async (
    programId: string
): Promise<RequiredDoc[]> => {
    const snap = await getDocs(
        collection(db, 'programs', programId, 'requiredDocs')
    )
    if (snap.empty) return []
    return snap.docs.map(d => {
        const t = d.data() as RequiredDocTemplate
        return {
            id: d.id,
            key: t.id,
            title: t.title,
            isOnboarding: true,
            hasExpiry: !!t.expiryRule,
            expiryMonths: t.expiryRule?.months ?? null,
            requiredAtApplication: !!t.mandatory,
            kind: t.type === 'agreement' ? 'agreement' : 'upload',
            agreementId: t.type === 'agreement' ? d.id.toLowerCase() : undefined
        } as RequiredDoc
    })
}

// TYPES
type RequiredDoc = {
    id: string
    key: string
    title: string
    isOnboarding: true
    preset?: string
    hasExpiry: boolean
    expiryMonths?: number | null
    requiredAtApplication: boolean
    kind?: 'upload' | 'agreement'
    agreementId?: string
}

// generic helpers
const formatter = (value: number) => <CountUp end={value} separator=',' />

const isPlainObject = (v: any) =>
    Object.prototype.toString.call(v) === '[object Object]'

const pruneUndefined = (val: any): any => {
    if (val === undefined) return undefined
    if (val === null) return null
    if (val instanceof Date) return val
    if (val instanceof Timestamp) return val

    if (Array.isArray(val)) {
        const arr = val.map(pruneUndefined).filter(v => v !== undefined)
        return arr
    }

    if (!isPlainObject(val)) return val

    const out: any = {}
    for (const [k, v] of Object.entries(val)) {
        const pv = pruneUndefined(v)
        if (pv !== undefined) out[k] = pv
    }
    return out
}

const toTs = (v: any) => {
    if (!v) return null
    if (v?.toDate && typeof v.toDate === 'function')
        return Timestamp.fromDate(v.toDate())
    if (v instanceof Date) return Timestamp.fromDate(v)
    if (v instanceof Timestamp) return v
    if (typeof v === 'string') return Timestamp.fromDate(new Date(v))
    return null
}

const toKeyBase = (title: string) =>
    title
        .trim()
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase() || `REQ_${Date.now()}`

const makeUniqueKey = (base: string, taken: Set<string>) => {
    if (!taken.has(base)) return base
    let i = 2
    while (taken.has(`${base}_${i}`)) i++
    return `${base}_${i}`
}

// presets
const SA_DOC_PRESETS: Record<
    string,
    { title: string; hasExpiry: boolean; expiryMonths?: number | null }
> = {
    BEE_CERT: {
        title: 'B-BBEE Certificate/Affidavit',
        hasExpiry: true,
        expiryMonths: 12
    },
    CERT_ID: { title: 'Certified ID Copy', hasExpiry: true, expiryMonths: 3 },
    PROOF_ADDR: { title: 'Proof of Address', hasExpiry: true, expiryMonths: 3 },
    SARS_TCS_PIN: {
        title: 'SARS Tax Compliance Status (TCS) PIN',
        hasExpiry: true,
        expiryMonths: 12
    },
    COIDA_LOGS: {
        title: 'COIDA Letter of Good Standing',
        hasExpiry: true,
        expiryMonths: 12
    },
    CSD_REG: {
        title: 'CSD Registration Summary',
        hasExpiry: true,
        expiryMonths: 6
    },
    CIPC_REG: {
        title: 'CIPC Registration Docs',
        hasExpiry: false,
        expiryMonths: null
    },
    VAT_CERT: {
        title: 'VAT Registration (if applicable)',
        hasExpiry: false,
        expiryMonths: null
    },
    BANK_LETTER: {
        title: 'Bank Confirmation Letter',
        hasExpiry: true,
        expiryMonths: 3
    },
    INSURANCE_PI: {
        title: 'Professional Indemnity / Insurance Proof',
        hasExpiry: true,
        expiryMonths: 12
    }
}

/* ──────────────────────────────────────────────────────────────────
   SYSTEM QUESTION: NEAREST HUB
────────────────────────────────────────────────────────────────── */

// Keep one system-managed question in onboardingQuestions
const upsertHubQuestion = (
    questions: any[],
    supportedBranchIds: string[],
    branches: any[]
) => {
    const ids = Array.isArray(supportedBranchIds) ? supportedBranchIds : []

    const options = branches
        .filter(b => ids.includes(b.id))
        .map(b => b.name || b.title || 'Hub')
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i)

    // strip old hub question
    const others = questions.filter((q: any) => q.systemKey !== 'nearestHub')

    // if no supported branches, remove the question entirely
    if (!options.length) return others

    const hubQuestion = {
        id: 'nearest-hub', // stable id
        label: 'Which hub is closest to you?',
        type: 'dropdown',
        options,
        allowMultiple: false,
        systemKey: 'nearestHub'
    }

    return [...others, hubQuestion]
}

/* ──────────────────────────────────────────────────────────────────
   QUESTIONS UI
────────────────────────────────────────────────────────────────── */

const QuestionTable = ({ questions, onAdd, onEdit, onDelete }) => (
    <>
        <Button type='primary' style={{ marginBottom: 16 }} onClick={onAdd}>
            Add New Question
        </Button>
        <Table
            dataSource={questions}
            rowKey='id'
            pagination={false}
            bordered
            columns={[
                {
                    title: 'Question',
                    dataIndex: 'label',
                    render: (t: string, record: any) => (
                        <span>
                            <b>{t}</b>{' '}
                            {record.systemKey === 'nearestHub' && (
                                <Tag color='geekblue'>Auto (Nearest Hub)</Tag>
                            )}
                        </span>
                    )
                },
                {
                    title: 'Type',
                    dataIndex: 'type',
                    render: (type: string) => (
                        <Tag color={type === 'dropdown' ? 'blue' : 'default'}>
                            {type?.charAt(0).toUpperCase() + type?.slice(1)}
                        </Tag>
                    )
                },
                {
                    title: 'Options',
                    dataIndex: 'options',
                    render: (opts: any, record: any) => {
                        const arr = Array.isArray(opts)
                            ? opts
                            : typeof opts === 'string'
                                ? opts
                                    .split(',')
                                    .map((o: string) => o.trim())
                                    .filter(Boolean)
                                : []
                        return arr.length ? (
                            <Space size='small' wrap>
                                {arr.map((o: string) => (
                                    <Tag key={o} color='processing'>
                                        {o}
                                    </Tag>
                                ))}
                                {record.type === 'dropdown' && record.allowMultiple && (
                                    <Tag color='purple'>Multi-select</Tag>
                                )}
                            </Space>
                        ) : (
                            <span style={{ color: '#aaa' }}>—</span>
                        )
                    }
                },
                {
                    title: 'Actions',
                    render: (_: any, record: any) => (
                        <Space>
                            <Button size='small' onClick={() => onEdit(record)}>
                                Edit
                            </Button>
                            <Button
                                size='small'
                                danger
                                onClick={() => onDelete(record.id)}
                                disabled={record.systemKey === 'nearestHub'}
                            >
                                Delete
                            </Button>
                        </Space>
                    )
                }
            ]}
        />
    </>
)

const QuestionModal = ({ visible, initialValues, onSave, onCancel }) => {
    const [form] = Form.useForm()
    const [type, setType] = useState(initialValues?.type || 'text')

    useEffect(() => {
        if (
            initialValues?.type === 'dropdown' &&
            Array.isArray(initialValues.options)
        ) {
            form.setFieldsValue({
                ...initialValues,
                options: initialValues.options.join(', ')
            })
        } else {
            form.setFieldsValue(
                initialValues || { type: 'text', options: [], allowMultiple: false }
            )
        }
        setType(initialValues?.type || 'text')
    }, [initialValues, form])

    // Prevent type change on system hub question
    const isSystemHub = initialValues?.systemKey === 'nearestHub'

    return (
        <Modal
            centered
            open={visible}
            title={initialValues ? 'Edit Question' : 'Add New Question'}
            onCancel={onCancel}
            onOk={() =>
                form.validateFields().then(values => {
                    onSave(values)
                    form.resetFields()
                })
            }
            okText={initialValues ? 'Save' : 'Add'}
        >
            <Form
                form={form}
                layout='vertical'
                initialValues={initialValues || { type: 'text', options: [] }}
            >
                <Form.Item
                    name='label'
                    label='Question'
                    rules={[{ required: true, message: 'Enter the question' }]}
                >
                    <Input disabled={isSystemHub} />
                </Form.Item>
                <Form.Item name='type' label='Type' initialValue='text'>
                    <Select
                        disabled={isSystemHub}
                        onChange={val => {
                            setType(val)
                            if (val === 'text') {
                                form.setFieldsValue({ options: [], allowMultiple: false })
                            }
                        }}
                    >
                        <Select.Option value='text'>Text</Select.Option>
                        <Select.Option value='dropdown'>Dropdown</Select.Option>
                    </Select>
                </Form.Item>
                {type === 'dropdown' && (
                    <>
                        <Form.Item
                            name='options'
                            label='Dropdown Options (comma separated)'
                            rules={[{ required: true, message: 'Provide options' }]}
                        >
                            <Input placeholder='e.g. Yes, No, Maybe' disabled={isSystemHub} />
                        </Form.Item>
                        <Form.Item
                            name='allowMultiple'
                            label='Allow multiple selections?'
                            valuePropName='checked'
                        >
                            <Checkbox disabled={isSystemHub}>
                                Incubatee can choose more than one answer
                            </Checkbox>
                        </Form.Item>
                    </>
                )}
            </Form>
        </Modal>
    )
}

/* ──────────────────────────────────────────────────────────────────
   REQUIRED DOCUMENTS STEP
────────────────────────────────────────────────────────────────── */

const RequiredDocumentsStep: React.FC<{
    value: RequiredDoc[]
    onChange: (v: RequiredDoc[]) => void
    onBack: () => void
    onNext: () => void
    backLabel?: string
    nextLabel?: string
    nextLoading?: boolean
}> = ({ value = [], onChange, onBack, onNext, backLabel = 'Back', nextLabel = 'Next', nextLoading = false }) => {
    const [rows, setRows] = useState<RequiredDoc[]>(value)
    const [docModalOpen, setDocModalOpen] = useState(false)
    const [editing, setEditing] = useState<RequiredDoc | null>(null)
    const [agreementTemplates, setAgreementTemplates] = useState<AgreementTemplate[]>([])
    const [form] = Form.useForm()

    useEffect(() => {
        const normalized = (value || []).map(r => ({
            ...r,
            isOnboarding: true as const,
            kind: r.kind ?? 'upload',
            requiredAtApplication: r.requiredAtApplication ?? true
        }))
        setRows(normalized)
    }, [value, onChange])

    useEffect(() => {
        listAgreementTemplates()
            .then(setAgreementTemplates)
            .catch(error => {
                console.error(error)
                message.error('Could not load agreement templates.')
            })
    }, [])

    const openAdd = () => {
        setEditing(null)
        form.resetFields()
        form.setFieldsValue({
            kind: 'upload',
            preset: 'CUSTOM',
            hasExpiry: false,
            requiredAtApplication: true
        })
        setDocModalOpen(true)
    }

    const openEdit = (r: RequiredDoc) => {
        setEditing(r)
        form.setFieldsValue({
            kind: r.kind ?? 'upload',
            agreementId: r.agreementId,
            preset: 'CUSTOM',
            title: r.title,
            key: r.key,
            hasExpiry: r.hasExpiry,
            expiryMonths: r.expiryMonths ?? undefined,
            requiredAtApplication: r.requiredAtApplication
        })
        setDocModalOpen(true)
    }

    const saveDoc = async () => {
        const v = await form.validateFields()
        const hasExpiry = !!v.hasExpiry
        const expiryMonths = hasExpiry ? v.expiryMonths ?? null : null
        const kind: 'upload' | 'agreement' = v.kind ?? 'upload'

        if (editing) {
            const item: RequiredDoc = {
                ...editing,
                isOnboarding: true,
                title: v.title,
                requiredAtApplication: !!v.requiredAtApplication,
                hasExpiry,
                expiryMonths,
                kind,
                agreementId: kind === 'agreement' ? v.agreementId : undefined
            }
            const next = rows.map(r => (r.id === editing.id ? item : r))
            setRows(next)
            onChange(next)
            setDocModalOpen(false)
            return
        }

        const existingKeys = new Set(rows.map(r => r.key))
        const key =
            kind === 'upload'
                ? makeUniqueKey(toKeyBase(v.title), existingKeys)
                : makeUniqueKey(toKeyBase(v.agreementId || v.title), existingKeys)

        const item: RequiredDoc = {
            id: String(Date.now()),
            key,
            title: v.title,
            isOnboarding: true,
            hasExpiry,
            expiryMonths,
            requiredAtApplication: !!v.requiredAtApplication,
            kind,
            agreementId: kind === 'agreement' ? v.agreementId : undefined
        }

        const next = [...rows, item]
        setRows(next)
        onChange(next)
        setDocModalOpen(false)
    }

    const remove = (id: string) => {
        const next = rows.filter(r => r.id !== id)
        setRows(next)
        onChange(next)
    }

    return (
        <>
            <div style={{ marginBottom: 12 }}>
                <Button data-guide='program-add-required-document' type='primary' onClick={openAdd}>
                    Add Required Document
                </Button>
            </div>

            <div data-guide='program-required-documents-table'>
                <Table
                    dataSource={rows}
                    rowKey='id'
                    pagination={false}
                    bordered
                    columns={[
                        {
                            title: 'Type',
                            dataIndex: 'kind',
                            render: (k: 'upload' | 'agreement' | undefined) => (
                                <Tag color={k === 'agreement' ? 'purple' : 'blue'}>
                                    {k === 'agreement' ? 'Agreement' : 'Upload'}
                                </Tag>
                            )
                        },
                        { title: 'Title', dataIndex: 'title' },
                        {
                            title: 'Required at application',
                            dataIndex: 'requiredAtApplication',
                            render: (b: boolean) =>
                                b ? <Tag color='green'>Yes</Tag> : <Tag color='gold'>No</Tag>
                        },
                        {
                            title: 'Expires',
                            dataIndex: 'hasExpiry',
                            render: (b: boolean) =>
                                b ? <Tag color='red'>Yes</Tag> : <Tag>No</Tag>
                        },
                        {
                            title: 'Months',
                            dataIndex: 'expiryMonths',
                            render: (m: number | null | undefined) =>
                                m ?? <span style={{ color: '#999' }}>—</span>
                        },
                        {
                            title: 'Actions',
                            render: (_: any, r: RequiredDoc) => (
                                <Space>
                                    <Button size='small' onClick={() => openEdit(r)}>
                                        Edit
                                    </Button>
                                    <Button size='small' danger onClick={() => remove(r.id)}>
                                        Delete
                                    </Button>
                                </Space>
                            )
                        }
                    ]}
                />
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <Button style={{ flex: 1 }} onClick={onBack}>{backLabel}</Button>
                <Button style={{ flex: 1 }} type='primary' loading={nextLoading} onClick={onNext}>
                    {nextLabel}
                </Button>
            </div>

            <Modal
                className='guide-required-document-modal'
                centered
                open={docModalOpen}
                title={editing ? 'Edit Required Document' : 'Add Required Document'}
                onCancel={() => setDocModalOpen(false)}
                onOk={saveDoc}
                okText={editing ? 'Save' : 'Add'}
                okButtonProps={{ className: 'guide-required-document-submit' }}
            >
                <Form data-guide='required-document-form' form={form} layout='vertical'>
                    <Form.Item
                        name='kind'
                        label='Source'
                        initialValue={editing?.kind ?? 'upload'}
                    >
                        <Select
                            onChange={val => {
                                if (val === 'agreement') {
                                    form.setFieldsValue({ preset: 'CUSTOM' })
                                } else {
                                    form.setFieldsValue({ agreementId: undefined })
                                }
                            }}
                            options={[
                                { label: 'Upload', value: 'upload' },
                                { label: 'Agreement (to be signed)', value: 'agreement' }
                            ]}
                        />
                    </Form.Item>

                    <Form.Item noStyle shouldUpdate>
                        {({ getFieldValue }) => {
                            const kind = getFieldValue('kind') ?? 'upload'
                            if (kind === 'upload') {
                                return (
                                    <Form.Item
                                        name='preset'
                                        label='Document Preset'
                                        initialValue='CUSTOM'
                                    >
                                        <Select
                                            onChange={k => {
                                                if (!k || k === 'CUSTOM') return
                                                const p = SA_DOC_PRESETS[k]
                                                form.setFieldsValue({
                                                    title: p.title,
                                                    hasExpiry: p.hasExpiry,
                                                    expiryMonths: p.hasExpiry
                                                        ? p.expiryMonths ?? undefined
                                                        : undefined
                                                })
                                            }}
                                        >
                                            <Select.Option value='CUSTOM'>Custom</Select.Option>
                                            {Object.keys(SA_DOC_PRESETS).map(k => (
                                                <Select.Option key={k} value={k}>
                                                    {SA_DOC_PRESETS[k].title}
                                                </Select.Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                )
                            }
                            return (
                                <Form.Item
                                    name='agreementId'
                                    label='Agreement'
                                    rules={[{ required: true, message: 'Select an agreement' }]}
                                >
                                    <Select
                                        placeholder='Choose agreement to be signed'
                                        options={agreementTemplates.map(c => ({
                                            label: c.title,
                                            value: c.agreementId
                                        }))}
                                        onChange={slug => {
                                            const agreementId = canonicalAgreementId(slug)
                                            const c = agreementTemplates.find(x => x.agreementId === agreementId)
                                            form.setFieldsValue({
                                                title: c?.title || '',
                                                agreementId,
                                                hasExpiry: false,
                                                expiryMonths: undefined
                                            })
                                        }}
                                    />
                                </Form.Item>
                            )
                        }}
                    </Form.Item>

                    <Form.Item
                        name='title'
                        label='Document Title'
                        rules={[{ required: true, message: 'Enter document title' }]}
                    >
                        <Input placeholder='e.g., Certified ID Copy / MOA' />
                    </Form.Item>

                    <Form.Item
                        name='requiredAtApplication'
                        valuePropName='checked'
                        label='Required at application?'
                    >
                        <Checkbox />
                    </Form.Item>

                    <Form.Item
                        name='hasExpiry'
                        valuePropName='checked'
                        label='Has Expiry?'
                    >
                        <Checkbox />
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(p, c) => p.hasExpiry !== c.hasExpiry}
                    >
                        {({ getFieldValue }) =>
                            getFieldValue('hasExpiry') ? (
                                <Form.Item
                                    name='expiryMonths'
                                    label='Validity Period (months)'
                                    rules={[
                                        { required: true, message: 'Set months (e.g., 3, 6, 12)' }
                                    ]}
                                >
                                    <InputNumber min={1} style={{ width: '100%' }} />
                                </Form.Item>
                            ) : null
                        }
                    </Form.Item>
                </Form>
            </Modal>
        </>
    )
}

/* ──────────────────────────────────────────────────────────────────
   ELIGIBILITY STEP
────────────────────────────────────────────────────────────────── */

const EligibilityCriteriaStep = ({
    value = {},
    onChange,
    onBack,
    onNext,
    backLabel = 'Back',
    nextLabel = 'Next',
    nextLoading = false
}) => {
    const [form] = Form.useForm()
    const [selectedCriteria, setSelectedCriteria] = useState<string[]>([])

    useEffect(() => {
        if (value) {
            const selected = Object.keys(value)
            setSelectedCriteria(selected)
            form.setFieldsValue(value)
        }
    }, [value])

    const handleNext = async () => {
        const allValues = await form.validateFields()
        const result: Record<string, any> = {}
        selectedCriteria.forEach(key => {
            if (
                allValues[key] !== undefined &&
                allValues[key] !== null &&
                allValues[key] !== ''
            ) {
                result[key] = allValues[key]
            }
        })
        onChange(result)
        onNext()
    }

    const toggleCriterion = (key: string) => {
        const isSelected = selectedCriteria.includes(key)
        setSelectedCriteria(
            isSelected ? selectedCriteria.filter(c => c !== key) : [...selectedCriteria, key]
        )
        if (isSelected) form.resetFields([key])
    }

    return (
        <Form
            layout='vertical'
            form={form}
            initialValues={value}
            style={{ marginTop: 8 }}
        >
            <Form.Item label='Select eligibility criteria for this program'>
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 12
                    }}
                >
                    {CRITERIA_OPTIONS.map((opt, idx) => {
                        const isSelected = selectedCriteria.includes(opt.value)
                        const isLast = idx === CRITERIA_OPTIONS.length - 1
                        return (
                            <div
                                key={opt.value}
                                onClick={() => toggleCriterion(opt.value)}
                                style={{
                                    gridColumn: isLast ? '1 / -1' : undefined,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    border: `1px solid ${isSelected ? '#1677ff' : '#e6e6e6'}`,
                                    background: isSelected ? 'rgba(22,119,255,.06)' : '#fff',
                                    cursor: 'pointer',
                                    fontSize: 13,
                                    lineHeight: '18px',
                                    transition: 'all .15s ease',
                                    userSelect: 'none'
                                }}
                            >
                                <span
                                    style={{
                                        color: isSelected ? '#1677ff' : 'rgba(0,0,0,.85)',
                                        fontWeight: isSelected ? 500 : 400
                                    }}
                                >
                                    {opt.label}
                                </span>
                                <CheckCircleOutlined
                                    style={{ color: isSelected ? '#1677ff' : '#d9d9d9', fontSize: 14 }}
                                />
                            </div>
                        )
                    })}
                </div>
            </Form.Item>

            {selectedCriteria.some(c => OWNERSHIP_FIELDS.includes(c)) && (
                <Row gutter={16}>
                    {OWNERSHIP_FIELDS.map(
                        field =>
                            selectedCriteria.includes(field) && (
                                <Col key={field} span={8}>
                                    <Form.Item
                                        name={field}
                                        label={
                                            field === 'youthOwnedPercent'
                                                ? 'Min Youth Ownership %'
                                                : field === 'femaleOwnedPercent'
                                                    ? 'Min Female Ownership %'
                                                    : 'Min Black Ownership %'
                                        }
                                        rules={[
                                            {
                                                type: 'number',
                                                min: 0,
                                                max: 100,
                                                message: '0–100 only'
                                            }
                                        ]}
                                    >
                                        <InputNumber
                                            min={0}
                                            max={100}
                                            style={{ width: '100%' }}
                                            addonAfter='%'
                                        />
                                    </Form.Item>
                                </Col>
                            )
                    )}
                </Row>
            )}

            <Row gutter={16}>
                <Col span={12}>
                    {selectedCriteria.includes('minAge') && (
                        <Form.Item name='minAge' label='Minimum Age'>
                            <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                    )}
                </Col>
                <Col span={12}>
                    {selectedCriteria.includes('maxAge') && (
                        <Form.Item name='maxAge' label='Maximum Age'>
                            <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                    )}
                </Col>
            </Row>

            {selectedCriteria.includes('gender') && (
                <Form.Item name='gender' label='Allowed Gender(s)'>
                    <Select
                        mode='multiple'
                        allowClear
                        options={GENDERS.map(g => ({ value: g }))}
                    />
                </Form.Item>
            )}
            {selectedCriteria.includes('sector') && (
                <Form.Item name='sector' label='Allowed Sectors'>
                    <Select
                        mode='multiple'
                        allowClear
                        options={SECTORS.map(s => ({ value: s }))}
                    />
                </Form.Item>
            )}
            {selectedCriteria.includes('province') && (
                <Form.Item name='province' label='Allowed Provinces'>
                    <Select
                        mode='multiple'
                        allowClear
                        options={PROVINCES.map(p => ({ value: p }))}
                    />
                </Form.Item>
            )}
            {selectedCriteria.includes('minYearsOfTrading') && (
                <Form.Item name='minYearsOfTrading' label='Minimum Years of Trading'>
                    <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
            )}
            {selectedCriteria.includes('beeLevel') && (
                <Form.Item name='beeLevel' label='Allowed B-BBEE Levels'>
                    <Select
                        mode='multiple'
                        allowClear
                        options={BEE_LEVELS.map(l => ({ value: l }))}
                    />
                </Form.Item>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <Button style={{ flex: 1 }} onClick={onBack}>{backLabel}</Button>
                <Button style={{ flex: 1 }} type='primary' loading={nextLoading} onClick={handleNext}>
                    {nextLabel}
                </Button>
            </div>
        </Form>
    )
}

/* ──────────────────────────────────────────────────────────────────
   COVERAGE STEP (scope + participating departments)
────────────────────────────────────────────────────────────────── */

type ProgramCoverageValue = {
    isMultiBranch: boolean
    supportedBranchIds: string[]
    participatingDepartmentIds: string[]
}

const coverageCardStyle = (isSelected: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${isSelected ? '#1677ff' : '#e6e6e6'}`,
    background: isSelected ? 'rgba(22,119,255,.06)' : '#fff',
    cursor: 'pointer',
    fontSize: 13,
    lineHeight: '18px',
    transition: 'all .15s ease',
    userSelect: 'none'
})

const CoverageCard: React.FC<{
    label: string
    selected: boolean
    onClick: () => void
    fullWidth?: boolean
}> = ({ label, selected, onClick, fullWidth }) => (
    <div
        onClick={onClick}
        style={{
            ...coverageCardStyle(selected),
            gridColumn: fullWidth ? '1 / -1' : undefined
        }}
    >
        <span style={{ color: selected ? '#1677ff' : 'rgba(0,0,0,.85)', fontWeight: selected ? 500 : 400 }}>
            {label}
        </span>
        <CheckCircleOutlined style={{ color: selected ? '#1677ff' : '#d9d9d9', fontSize: 14 }} />
    </div>
)

const TickableCardGrid: React.FC<{
    options: { value: string; label: string }[]
    selected: string[]
    onChange: (next: string[]) => void
    columns?: number
    showAllOption?: boolean
    emptyText?: string
}> = ({ options, selected, onChange, columns = 3, showAllOption = true, emptyText = 'Nothing to select yet.' }) => {
    if (!options.length) {
        return <Text type="secondary">{emptyText}</Text>
    }

    const allSelected = selected.length === options.length

    return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 12 }}>
            {showAllOption && (
                <CoverageCard
                    label="All"
                    selected={allSelected}
                    fullWidth
                    onClick={() => onChange(allSelected ? [] : options.map(o => o.value))}
                />
            )}
            {options.map(opt => (
                <CoverageCard
                    key={opt.value}
                    label={opt.label}
                    selected={selected.includes(opt.value)}
                    onClick={() =>
                        onChange(
                            selected.includes(opt.value)
                                ? selected.filter(v => v !== opt.value)
                                : [...selected, opt.value]
                        )
                    }
                />
            ))}
        </div>
    )
}

const CoverageStep: React.FC<{
    value: ProgramCoverageValue
    onChange: (v: ProgramCoverageValue) => void
    branches: any[]
    departments: any[]
    userBranchId: string | null
    onBack: () => void
    onNext: () => void
    backLabel?: string
    nextLabel?: string
    nextLoading?: boolean
}> = ({
    value,
    onChange,
    branches,
    departments,
    userBranchId,
    onBack,
    onNext,
    backLabel = 'Back',
    nextLabel = 'Next',
    nextLoading = false
}) => {
        const { isMultiBranch, supportedBranchIds, participatingDepartmentIds } = value

        const branchOptions = branches
            .filter(b => !userBranchId || b.id !== userBranchId)
            .map(b => ({ value: b.id, label: b.name || b.title || 'Branch' }))

        const departmentOptions = departments.map(d => ({ value: d.id, label: d.name }))

        const handleNext = () => {
            if (!participatingDepartmentIds.length) {
                message.error('Please select at least one participating department')
                return
            }
            onNext()
        }

        return (
            <div style={{ marginTop: 8 }}>
                <Text strong>Program Scope</Text>
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: 12,
                        marginTop: 8,
                        marginBottom: 24
                    }}
                >
                    <CoverageCard
                        label="Single branch"
                        selected={!isMultiBranch}
                        onClick={() =>
                            onChange({ isMultiBranch: false, supportedBranchIds: [], participatingDepartmentIds })
                        }
                    />
                    <CoverageCard
                        label="Multi-branch (participants from multiple hubs)"
                        selected={isMultiBranch}
                        onClick={() =>
                            onChange({ isMultiBranch: true, supportedBranchIds, participatingDepartmentIds })
                        }
                    />
                </div>

                {isMultiBranch && (
                    <div style={{ marginBottom: 24 }}>
                        <Text strong>Supported branches / hubs</Text>
                        <div style={{ marginTop: 8 }}>
                            <TickableCardGrid
                                options={branchOptions}
                                selected={supportedBranchIds}
                                onChange={ids =>
                                    onChange({ isMultiBranch, supportedBranchIds: ids, participatingDepartmentIds })
                                }
                                emptyText="No other branches to select."
                            />
                        </div>
                    </div>
                )}

                <Text strong>
                    Participating departments <Text type="danger">*</Text>
                </Text>
                <div style={{ marginTop: 8 }}>
                    <TickableCardGrid
                        options={departmentOptions}
                        selected={participatingDepartmentIds}
                        onChange={ids =>
                            onChange({ isMultiBranch, supportedBranchIds, participatingDepartmentIds: ids })
                        }
                        emptyText="No departments configured yet."
                    />
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                    <Button style={{ flex: 1 }} onClick={onBack}>{backLabel}</Button>
                    <Button style={{ flex: 1 }} type="primary" loading={nextLoading} onClick={handleNext}>
                        {nextLabel}
                    </Button>
                </div>
            </div>
        )
    }

/* ──────────────────────────────────────────────────────────────────
   EDIT: SECTION PICKER (jump straight to one part of the program
   instead of walking every step)
────────────────────────────────────────────────────────────────── */

const PROGRAM_EDIT_SECTIONS: { step: number; title: string; description: string }[] = [
    { step: 0, title: 'Program Details', description: 'Name, description, type, status, cohort, dates, funder & capacity' },
    { step: 1, title: 'Coverage', description: 'Branch scope and participating departments' },
    { step: 2, title: 'Program Logo', description: 'Upload or replace the program logo' },
    { step: 3, title: 'Eligibility Criteria', description: 'Who can apply to this program' },
    { step: 4, title: 'Required Documents', description: 'Documents and agreements SMEs must provide' },
    { step: 5, title: 'Onboarding Questions', description: 'Custom questions asked during application' }
]

const SectionPickerStep: React.FC<{
    onSelect: (step: number) => void
    onSaveAndClose: () => void
    saving: boolean
}> = ({ onSelect, onSaveAndClose, saving }) => (
    <div style={{ marginTop: 8 }}>
        <Text strong>What would you like to edit?</Text>
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 12,
                marginTop: 12
            }}
        >
            {PROGRAM_EDIT_SECTIONS.map(section => (
                <div
                    key={section.step}
                    onClick={() => onSelect(section.step)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '14px 16px',
                        borderRadius: 10,
                        border: '1px solid #e6e6e6',
                        background: '#fff',
                        cursor: 'pointer',
                        transition: 'all .15s ease'
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 500 }}>{section.title}</span>
                        <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
                            {section.description}
                        </span>
                    </div>
                    <RightOutlined style={{ color: 'rgba(0,0,0,.35)', fontSize: 14, flexShrink: 0 }} />
                </div>
            ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <Button
                style={{ flex: 1 }}
                type="primary"
                loading={saving}
                onClick={onSaveAndClose}
            >
                Save Program
            </Button>
        </div>
    </div>
)

const LOGO_PREVIEW_SIZE = 220
const MIN_LOGO_DIMENSION = 300

const readImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
    new Promise((resolve, reject) => {
        const img = new window.Image()
        const url = URL.createObjectURL(file)
        img.onload = () => {
            const { naturalWidth: width, naturalHeight: height } = img
            URL.revokeObjectURL(url)
            resolve({ width, height })
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('Could not read image dimensions'))
        }
        img.src = url
    })

const ProgramLogoStep: React.FC<{
    logoPreview: string | null
    onPick: (file: File | null, previewUrl: string | null) => void
    onBack: () => void
    onNext: () => void
    backLabel?: string
    nextLabel?: string
    nextLoading?: boolean
}> = ({ logoPreview, onPick, onBack, onNext, backLabel = 'Back', nextLabel = 'Next', nextLoading = false }) => {
    const beforeUpload: UploadProps['beforeUpload'] = async file => {
        const isImage =
            file.type === 'image/png' ||
            file.type === 'image/jpeg' ||
            file.type === 'image/jpg' ||
            file.type === 'image/webp'

        if (!isImage) {
            message.error('Logo must be PNG, JPG, or WEBP')
            return Upload.LIST_IGNORE
        }

        const isLt2mb = file.size / 1024 / 1024 < 2
        if (!isLt2mb) {
            message.error('Logo must be smaller than 2MB')
            return Upload.LIST_IGNORE
        }

        try {
            const { width, height } = await readImageDimensions(file as File)
            if (width < MIN_LOGO_DIMENSION || height < MIN_LOGO_DIMENSION) {
                message.error(
                    `Logo is too small (${width}x${height}px). Please upload an image at least ${MIN_LOGO_DIMENSION}x${MIN_LOGO_DIMENSION}px.`
                )
                return Upload.LIST_IGNORE
            }
        } catch {
            message.error('Could not read that image. Please try a different file.')
            return Upload.LIST_IGNORE
        }

        const previewUrl = URL.createObjectURL(file)
        onPick(file as File, previewUrl)
        return false // prevent auto-upload
    }

    const handleNext = () => {
        if (!logoPreview) {
            message.error('Please upload a program logo before continuing')
            return
        }
        onNext()
    }

    return (
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 20 }}
                message="Upload a project logo"
                description={`A clear, high-resolution logo makes dashboards, documents, and program cards look their best. PNG, JPG, or WEBP, at least ${MIN_LOGO_DIMENSION}x${MIN_LOGO_DIMENSION}px, up to 2MB.`}
            />

            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 16,
                    padding: '8px 0 24px'
                }}
            >
                <div
                    style={{
                        width: LOGO_PREVIEW_SIZE,
                        height: LOGO_PREVIEW_SIZE,
                        borderRadius: 20,
                        border: logoPreview ? '1px solid #e6efff' : '1px dashed #adc6ff',
                        background: '#fafcff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden'
                    }}
                >
                    {logoPreview ? (
                        <img
                            src={logoPreview}
                            alt="Program logo preview"
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                    ) : (
                        <PictureOutlined style={{ fontSize: 56, color: '#adc6ff' }} />
                    )}
                </div>

                <Space>
                    <Upload
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        maxCount={1}
                        showUploadList={false}
                        beforeUpload={beforeUpload}
                    >
                        <Button type={logoPreview ? 'default' : 'primary'} icon={<PictureOutlined />}>
                            {logoPreview ? 'Change Logo' : 'Choose Logo'}
                        </Button>
                    </Upload>

                    {logoPreview && (
                        <Button danger onClick={() => onPick(null, null)}>
                            Remove
                        </Button>
                    )}
                </Space>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <Button style={{ flex: 1 }} onClick={onBack}>{backLabel}</Button>
                <Button style={{ flex: 1 }} type="primary" loading={nextLoading} onClick={handleNext}>
                    {nextLabel}
                </Button>
            </div>
        </div>
    )
}

type ProgramManagerViewMode = 'programs' | 'proposals'

const ProgramViewToggle: React.FC<{
    value: ProgramManagerViewMode
    onChange: (v: ProgramManagerViewMode) => void
}> = ({ value, onChange }) => (
    <Segmented
        value={value}
        onChange={v => onChange(v as ProgramManagerViewMode)}
        options={[
            {
                label: (
                    <Space>
                        <ProjectOutlined />
                        Programs
                    </Space>
                ),
                value: 'programs'
            },
            {
                label: (
                    <Space>
                        <FileTextOutlined />
                        Proposals
                    </Space>
                ),
                value: 'proposals'
            }
        ]}
    />
)

const ProjectProposalsManager: React.FC<{

    branches: any[]
    userBranchId: string | null
    isProjectAdmin: boolean
    resolveAssignedBranch: (branchId?: string) => { id: string; name: string } | null
    viewMode: ProgramManagerViewMode
    onViewModeChange: (v: ProgramManagerViewMode) => void
}> = ({ branches, userBranchId, isProjectAdmin, resolveAssignedBranch, viewMode, onViewModeChange }) => {
    const { user } = useFullIdentity()
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)

    const [proposals, setProposals] = useState<ProjectProposal[]>([])
    const [searchText, setSearchText] = useState('')
    const [statusFilter, setStatusFilter] = useState<ProposalStatus | null>(null)

    // create/edit
    const [modalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState<ProjectProposal | null>(null)
    const [form] = Form.useForm()

    // proposal document file
    const [proposalFile, setProposalFile] = useState<File | null>(null)

    // progress updates modal
    const [updatesOpen, setUpdatesOpen] = useState(false)
    const [updatesLoading, setUpdatesLoading] = useState(false)
    const [selectedProposal, setSelectedProposal] = useState<ProjectProposal | null>(null)
    const [updates, setUpdates] = useState<ProposalUpdate[]>([])
    const [updateForm] = Form.useForm()
    const [updateFile, setUpdateFile] = useState<File | null>(null)

    const scoped = useMemo(() => {
        if (!isProjectAdmin || !userBranchId) return proposals
        return proposals.filter(p => {
            const bid = p.assignedBranch?.id || p.branchId || null
            return bid === userBranchId
        })
    }, [proposals, isProjectAdmin, userBranchId])

    const filtered = useMemo(() => {
        const q = searchText.trim().toLowerCase()
        return scoped.filter(p => {
            const m1 = (p.title || '').toLowerCase().includes(q)
            const m2 = (p.funder || '').toLowerCase().includes(q)
            const ms = statusFilter ? p.status === statusFilter : true
            return (m1 || m2) && ms
        })
    }, [scoped, searchText, statusFilter])

    const fetchProposals = async () => {
        setLoading(true)
        try {
            const snap = await getDocs(
                query(collection(db, 'projectProposals'))
            )
            setProposals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
        } catch (e) {
            message.error('Failed to load project proposals')
            console.log(e.message || e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchProposals()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const resetCreateState = () => {
        form.resetFields()
        setProposalFile(null)
        setEditing(null)
    }

    const openCreate = () => {
        resetCreateState()
        form.setFieldsValue({
            branchId: userBranchId && branches.some(b => b.id === userBranchId) ? userBranchId : undefined,
            status: 'Draft',
            cohortYear: dayjs().year(),
            proposedDate: dayjs()
        })
        setModalOpen(true)
    }

    const openEdit = (p: ProjectProposal) => {
        setEditing(p)
        setProposalFile(null)

        form.setFieldsValue({
            ...p,
            branchId: p.assignedBranch?.id || p.branchId || null,
            proposedDate: parseAnyToDayjs(p.proposedDate),
            startDate: parseAnyToDayjs(p.startDate),
            cohortYear: p.cohortYear ?? dayjs().year()
        })
        setModalOpen(true)
    }

    const beforeUploadProposal: UploadProps['beforeUpload'] = file => {
        setProposalFile(file as File)
        return false
    }

    const beforeUploadUpdate: UploadProps['beforeUpload'] = file => {
        setUpdateFile(file as File)
        return false
    }

    const saveProposal = async (values: any) => {
        setSaving(true)
        try {
            const assignedBranch = resolveAssignedBranch(values.branchId)
            const payloadBase: any = pruneUndefined({
                branchId: values.branchId || null,
                assignedBranch: assignedBranch || null,
                title: values.title,
                about: values.about,
                funder: values.funder,
                proposedDate: toTs(values.proposedDate) || Timestamp.fromDate(new Date()),
                startDate: toTs(values.startDate),
                cohortYear: values.cohortYear ?? dayjs().year(),
                status: (values.status || 'Draft') as ProposalStatus,
                rejectionReason:
                    (values.status as ProposalStatus) === 'Rejected' ? values.rejectionReason || null : null,
                updatedAt: serverTimestamp()
            })

            if (!editing) {
                payloadBase.createdAt = serverTimestamp()
                const docRef = await addDoc(collection(db, 'projectProposals'), payloadBase)
                await updateDoc(docRef, { id: docRef.id })

                // proposal doc optional
                if (proposalFile) {
                    const uploaded = await uploadProposalFile(docRef.id, proposalFile, 'proposal')
                    await updateDoc(docRef, { proposalDocUrl: uploaded.url, proposalDocPath: uploaded.path })
                }

                message.success('Proposal created')
            } else {
                const refDoc = doc(db, 'projectProposals', editing.id)

                // replace proposal doc if provided
                if (proposalFile) {
                    const uploaded = await uploadProposalFile(editing.id, proposalFile, 'proposal')
                    await updateDoc(refDoc, {
                        ...payloadBase,
                        proposalDocUrl: uploaded.url,
                        proposalDocPath: uploaded.path
                    })
                    // cleanup old
                    await tryDeleteStoragePath(editing.proposalDocPath || null)
                } else {
                    await updateDoc(refDoc, payloadBase)
                }

                message.success('Proposal updated')
            }

            setModalOpen(false)
            resetCreateState()
            fetchProposals()
        } catch (e: any) {
            message.error(`Failed to save proposal: ${e?.message || e}`)
        } finally {
            setSaving(false)
        }
    }

    const deleteProposal = async (p: ProjectProposal) => {
        setLoading(true)
        try {
            // delete proposal doc
            await tryDeleteStoragePath(p.proposalDocPath || null)

            // delete updates docs (best-effort) + docs
            try {
                const updSnap = await getDocs(collection(db, 'projectProposals', p.id, 'updates'))
                for (const d of updSnap.docs) {
                    const data = d.data() as any
                    await tryDeleteStoragePath(data?.docPath || null)
                    await deleteDoc(d.ref)
                }
            } catch {
                // ignore
            }

            await deleteDoc(doc(db, 'projectProposals', p.id))
            message.success('Proposal deleted')
            fetchProposals()
        } catch {
            message.error('Failed to delete proposal')
        } finally {
            setLoading(false)
        }
    }

    const openUpdates = async (p: ProjectProposal) => {
        setSelectedProposal(p)
        setUpdates([])
        setUpdateFile(null)
        updateForm.resetFields()
        setUpdatesOpen(true)
        setUpdatesLoading(true)

        try {
            const snap = await getDocs(
                query(collection(db, 'projectProposals', p.id, 'updates'), orderBy('createdAt', 'desc'))
            )
            setUpdates(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
        } catch {
            message.error('Failed to load updates')
        } finally {
            setUpdatesLoading(false)
        }
    }

    const addUpdate = async () => {
        if (!selectedProposal) return
        const v = await updateForm.validateFields()
        setSaving(true)
        try {
            const updatesCol = collection(db, 'projectProposals', selectedProposal.id, 'updates')

            let docUrl: string | null = null
            let docPath: string | null = null

            if (updateFile) {
                const uploaded = await uploadProposalFile(
                    selectedProposal.id,
                    updateFile,
                    'updates'
                )
                docUrl = uploaded.url
                docPath = uploaded.path
            }

            const createdBy = {
                email: user?.email || null,
                name: (user as any)?.fullName || (user as any)?.name || null
            }

            await addDoc(
                updatesCol,
                pruneUndefined({
                    note: v.note,
                    status: v.status || null,
                    docUrl,
                    docPath,
                    createdBy,
                    createdAt: serverTimestamp()
                })
            )

            // optionally update main proposal status / rejection reason
            if (v.status) {
                const patch: any = { status: v.status, updatedAt: serverTimestamp() }
                if ((v.status as ProposalStatus) === 'Rejected') {
                    patch.rejectionReason = v.rejectionReason || null
                } else {
                    patch.rejectionReason = null
                }
                await updateDoc(doc(db, 'projectProposals', selectedProposal.id), patch)
            }

            message.success('Update added')
            setUpdateFile(null)
            updateForm.resetFields()

            // refresh both proposal list + updates
            await fetchProposals()
            await openUpdates({ ...selectedProposal } as any)
        } catch (e: any) {
            message.error(`Failed to add update: ${e?.message || e}`)
        } finally {
            setSaving(false)
        }
    }

    // metrics
    const metrics = useMemo(() => {
        const total = scoped.length
        const by = (s: ProposalStatus) => scoped.filter(p => p.status === s).length
        return {
            total,
            active: by('Under Review') + by('Submitted') + by('In Progress'),
            approved: by('Approved'),
            rejected: by('Rejected')
        }
    }, [scoped])

    return (
        <>
            {/* Metrics row */}
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} md={6}>
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                        <MotionCard.Metric
                            title='Total Proposals'
                            value={formatter(metrics.total)}
                            icon={<ProjectOutlined style={{ fontSize: 18, color: '#1677ff' }} />}
                            iconBg='rgba(22,119,255,.12)'
                        />
                    </motion.div>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }}>
                        <MotionCard.Metric
                            title='Active Pipeline'
                            value={
                                <span style={{ color: '#52c41a' }}>
                                    {formatter(metrics.active)}
                                </span>
                            }
                            icon={<CheckCircleOutlined style={{ fontSize: 18, color: '#52c41a' }} />}
                            iconBg='rgba(82,196,26,.12)'
                        />
                    </motion.div>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.1 }}>
                        <MotionCard.Metric
                            title='Approved'
                            value={
                                <span style={{ color: '#faad14' }}>
                                    {formatter(metrics.approved)}
                                </span>
                            }
                            icon={<DollarOutlined style={{ fontSize: 18, color: '#faad14' }} />}
                            iconBg='rgba(250,173,20,.14)'
                        />
                    </motion.div>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}>
                        <MotionCard.Metric
                            title='Rejected'
                            value={
                                <span style={{ color: '#ff4d4f' }}>
                                    {formatter(metrics.rejected)}
                                </span>
                            }
                            icon={<PoweroffOutlined style={{ fontSize: 18, color: '#ff4d4f' }} />}
                            iconBg='rgba(255,77,79,.12)'
                        />
                    </motion.div>
                </Col>
            </Row>

            <MotionCard
                loading={loading}
                filterBarProps={{ marginBottom: 0 }}
                filterBar={
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, width: '100%' }}>
                        <div style={{ flex: '0 1 220px' }}>
                            <ProgramViewToggle value={viewMode} onChange={onViewModeChange} />
                        </div>
                        <div style={{ flex: '1 1 220px' }}>
                            <Input
                                allowClear
                                placeholder="Search title / funder"
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                            />
                        </div>
                        <div style={{ flex: '1 1 220px' }}>
                            <Select
                                allowClear
                                style={{ width: '100%' }}
                                placeholder="Filter by status"
                                value={statusFilter}
                                onChange={v => setStatusFilter(v as any)}
                                options={PROPOSAL_STATUSES.map(s => ({ label: s, value: s }))}
                            />
                        </div>
                        <div style={{ flex: '0 1 180px', display: 'flex', justifyContent: 'flex-end' }}>
                            <Button shape="round" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                                Add Proposal
                            </Button>
                        </div>
                    </div>
                }
            />

            <MotionCard style={{ marginTop: 15 }} loading={loading}>
                <Table
                    dataSource={filtered}
                    rowKey="id"
                    pagination={{ pageSize: 8, showSizeChanger: false, position: ['bottomCenter'] }}
                    scroll={{ x: 1100 }}
                >
                    <Table.Column title="Title" dataIndex="title" key="title" />
                    <Table.Column title="Funder" dataIndex="funder" key="funder" />
                    <Table.Column
                        title="Proposed"
                        dataIndex="proposedDate"
                        render={(val: any) => (parseAnyToDayjs(val) ? parseAnyToDayjs(val)!.format('YYYY-MM-DD') : '—')}
                    />
                    <Table.Column
                        title="Start"
                        dataIndex="startDate"
                        render={(val: any) => (parseAnyToDayjs(val) ? parseAnyToDayjs(val)!.format('YYYY-MM-DD') : '—')}
                    />
                    <Table.Column title="Cohort" dataIndex="cohortYear" render={(v: any) => v ?? '—'} />
                    <Table.Column
                        title="Status"
                        dataIndex="status"
                        render={(s: ProposalStatus) => statusTag(s)}
                    />
                    <Table.Column
                        title="Proposal Doc"
                        render={(_: any, r: ProjectProposal) =>
                            r.proposalDocUrl ? (
                                <Button
                                    size="small"
                                    icon={<DownloadOutlined />}
                                    onClick={() => window.open(r.proposalDocUrl as string, '_blank')}
                                >
                                    View
                                </Button>
                            ) : (
                                <Text type="secondary">—</Text>
                            )
                        }
                    />
                    <Table.Column
                        title="Actions"
                        render={(_: any, r: ProjectProposal) => (
                            <Space>
                                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                                <Button
                                    size="small"
                                    icon={<FileTextOutlined />}
                                    onClick={() => openUpdates(r)}
                                >
                                    Progress
                                </Button>
                                <Popconfirm
                                    title="Delete this proposal?"
                                    description="This will also delete its progress updates."
                                    okText="Yes, delete"
                                    cancelText="Cancel"
                                    okType="danger"
                                    onConfirm={() => deleteProposal(r)}
                                >
                                    <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                            </Space>
                        )}
                    />
                </Table>
            </MotionCard>

            {/* Create/Edit modal */}
            <Modal
                centered
                open={modalOpen}
                title={editing ? 'Edit Project Proposal' : 'Add Project Proposal'}
                onCancel={() => {
                    setModalOpen(false)
                    resetCreateState()
                }}
                onOk={() => form.submit()}
                okText={editing ? 'Save' : 'Create'}
                confirmLoading={saving}
                width={900}
            >
                <Form form={form} layout="vertical" onFinish={saveProposal}>
                    <Row gutter={16}>
                        <Col xs={24} md={12}>
                            <Form.Item name="branchId" label="Branch" rules={[{ required: true }]}>
                                <Select
                                    disabled={!!userBranchId}
                                    placeholder="Select branch"
                                    options={branches.map(b => ({ value: b.id, label: b.name || b.title || 'Branch' }))}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="status" label="Status" rules={[{ required: true }]}>
                                <Select options={PROPOSAL_STATUSES.map(s => ({ value: s, label: s }))} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item name="title" label="Proposal Title" rules={[{ required: true }]}>
                        <Input placeholder="e.g., Tharisa SMME Cohort Expansion 2026" />
                    </Form.Item>

                    <Form.Item name="about" label="What the program will be about" rules={[{ required: true }]}>
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 7 }} placeholder="Short description of the proposed programme." />
                    </Form.Item>

                    <Row gutter={16}>
                        <Col xs={24} md={12}>
                            <Form.Item name="funder" label="Funder" rules={[{ required: true }]}>
                                <Input placeholder="e.g., Tharisa / SEDA / Corporate CSI" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item name="cohortYear" label="Cohort Year">
                                <InputNumber style={{ width: '100%' }} min={2000} max={2100} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item name="proposedDate" label="Date Proposed" rules={[{ required: true }]}>
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={16}>
                        <Col xs={24} md={12}>
                            <Form.Item name="startDate" label="Optional Start Date">
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item label="Optional Proposal Document">
                                <Upload
                                    beforeUpload={beforeUploadProposal}
                                    maxCount={1}
                                    showUploadList
                                >
                                    <Button icon={<UploadOutlined />}>Choose File</Button>
                                </Upload>
                                <Text type="secondary">
                                    {editing?.proposalDocUrl ? 'Existing document will remain unless you upload a new one.' : ''}
                                </Text>
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item noStyle shouldUpdate>
                        {({ getFieldValue }) => {
                            const s = getFieldValue('status') as ProposalStatus
                            if (s !== 'Rejected') return null
                            return (
                                <Form.Item name="rejectionReason" label="Optional Rejection Reason">
                                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
                                </Form.Item>
                            )
                        }}
                    </Form.Item>
                </Form>
            </Modal>

            {/* Progress updates modal */}
            <Modal
                centered
                open={updatesOpen}
                title={
                    selectedProposal ? (
                        <span>
                            Progress Updates: <b>{selectedProposal.title}</b>
                        </span>
                    ) : (
                        'Progress Updates'
                    )
                }
                onCancel={() => {
                    setUpdatesOpen(false)
                    setSelectedProposal(null)
                    setUpdates([])
                    setUpdateFile(null)
                    updateForm.resetFields()
                }}
                footer={null}
                width={1000}
            >
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Add mini progress notes and optionally attach a document. You can also move the proposal status forward here."
                />

                <Row gutter={16}>
                    <Col xs={24} md={10}>
                        <Form form={updateForm} layout="vertical">
                            <Form.Item name="note" label="Progress note" rules={[{ required: true, message: 'Add a note' }]}>
                                <Input.TextArea autoSize={{ minRows: 3, maxRows: 7 }} />
                            </Form.Item>

                            <Form.Item name="status" label="Optional status update">
                                <Select
                                    allowClear
                                    options={PROPOSAL_STATUSES.map(s => ({ value: s, label: s }))}
                                    placeholder="Keep current status"
                                />
                            </Form.Item>

                            <Form.Item noStyle shouldUpdate>
                                {({ getFieldValue }) => {
                                    const s = getFieldValue('status') as ProposalStatus
                                    if (s !== 'Rejected') return null
                                    return (
                                        <Form.Item name="rejectionReason" label="Optional rejection reason">
                                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
                                        </Form.Item>
                                    )
                                }}
                            </Form.Item>

                            <Form.Item label="Optional document">
                                <Upload beforeUpload={beforeUploadUpdate} maxCount={1} showUploadList>
                                    <Button icon={<UploadOutlined />}>Attach File</Button>
                                </Upload>
                            </Form.Item>

                            <Button type="primary" icon={<PlusOutlined />} loading={saving} onClick={addUpdate} block>
                                Add Update
                            </Button>
                        </Form>
                    </Col>

                    <Col xs={24} md={14}>
                        <Card
                            title="Update History"
                            bordered
                            style={{ borderRadius: 12 }}
                            bodyStyle={{ maxHeight: 520, overflow: 'auto' }}
                        >
                            {updatesLoading ? (
                                <Spin />
                            ) : updates.length === 0 ? (
                                <Empty description="No updates yet" />
                            ) : (
                                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                                    {updates.map(u => (
                                        <Card key={u.id} size="small" bordered style={{ borderRadius: 12 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ marginBottom: 6 }}>
                                                        <Text strong>
                                                            {u.createdAt?.toDate
                                                                ? dayjs(u.createdAt.toDate()).format('YYYY-MM-DD HH:mm')
                                                                : '—'}
                                                        </Text>
                                                        {u.status ? <span style={{ marginLeft: 8 }}>{statusTag(u.status as any)}</span> : null}
                                                    </div>
                                                    <Text>{u.note}</Text>
                                                    {u.createdBy?.email ? (
                                                        <div style={{ marginTop: 8 }}>
                                                            <Text type="secondary">By: {u.createdBy?.name || u.createdBy?.email}</Text>
                                                        </div>
                                                    ) : null}
                                                </div>
                                                <div>
                                                    {u.docUrl ? (
                                                        <Button
                                                            size="small"
                                                            icon={<DownloadOutlined />}
                                                            onClick={() => window.open(u.docUrl as string, '_blank')}
                                                        >
                                                            View Doc
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                </Space>
                            )}
                        </Card>
                    </Col>
                </Row>
            </Modal>
        </>
    )
}

/* ──────────────────────────────────────────────────────────────────
   MAIN PROGRAM MANAGER
────────────────────────────────────────────────────────────────── */

const ProgramManager: React.FC = () => {
    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'program-manager',
            pageTitle: 'Incubation Programs Repository',
            guides: [
                {
                    id: 'program-manager-overview',
                    title: 'Quick tour',
                    description: 'Understand the programme repository, programme metrics and the tools used to manage programme setup.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('program-manager-header'),
                            popover: {
                                title: 'Programs and proposals',
                                description: 'Switch between live incubation programmes and the proposal pipeline from this control.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('program-metrics'),
                            popover: {
                                title: 'Programme overview',
                                description: 'These metrics summarise programmes in your scope, including active programmes and total capacity.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('program-filters'),
                            popover: {
                                title: 'Find or add a programme',
                                description: 'Search programmes, filter by status or create a new programme when capacity is available.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('program-table'),
                            popover: {
                                title: 'Programme repository',
                                description: 'Review programme scope, dates, registration links and management actions here.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'create-program',
                    title: 'Create a program',
                    description: 'Walk through the programme setup wizard.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: guideTarget('add-program-action'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Add Program',
                                description: 'Open the programme setup wizard.',
                                side: 'bottom',
                                align: 'end',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-program-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Programme setup wizard',
                                description: 'Complete programme details, coverage, logo, eligibility, onboarding documents and onboarding questions.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('program-basic-details'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Programme details',
                                description: 'Capture the programme branch, name, scope, dates, funder and capacity before continuing.',
                                side: 'right',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'configure-program-onboarding-documents',
                    title: 'Configure onboarding documents',
                    description: 'Add the documents and agreements used during programme onboarding.',
                    kind: 'task',
                    order: 3,
                    steps: [
                        {
                            element: guideTarget('program-required-documents-step'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Required Documents',
                                description: 'Every requirement created in this step is stored with isOnboarding set to true.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('program-add-required-document'),
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: 'Add a requirement',
                                description: 'Add an upload requirement or agreement for onboarding.',
                                side: 'bottom',
                                align: 'start',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-required-document-modal',
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Document requirement',
                                description: 'Choose the document type, title and expiry rules. The onboarding flag is applied automatically.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('required-document-form'),
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Configure the requirement',
                                description: 'Upload requirements can use a preset or custom title. Agreements come from active agreement templates.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-required-document-submit',
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Save the requirement',
                                description: 'Save the document. It is persisted as an onboarding requirement in both supported programme requirement stores.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    const [programs, setPrograms] = useState<any[]>([])
    const [programLimit, setProgramLimit] = useState(DEFAULT_PROGRAM_LIMIT)

    const [branchesLoading, setBranchesLoading] = useState(true)
    const [programsLoading, setProgramsLoading] = useState(true)
    const [initialProgramsLoaded, setInitialProgramsLoaded] = useState(false)
    const [userResolved, setUserResolved] = useState(false)
    // programsLoading toggles again on every refresh (e.g. after save/delete) — only the
    // first load should trigger the full-page overlay; later refreshes use the filter
    // bar / table skeletons instead so the whole page doesn't flash.
    const booting = !userResolved || branchesLoading || !initialProgramsLoaded
    const [logoFile, setLogoFile] = useState<File | null>(null)
    const [logoPreview, setLogoPreview] = useState<string | null>(null)

    const [viewMode, setViewMode] = useState<'programs' | 'proposals'>('programs')

    const [modalVisible, setModalVisible] = useState(false)
    const [form] = Form.useForm()
    const [eligibility, setEligibility] = useState({})
    const [requiredDocs, setRequiredDocs] = useState<RequiredDoc[]>([])
    const [coverage, setCoverage] = useState<ProgramCoverageValue>({
        isMultiBranch: false,
        supportedBranchIds: [],
        participatingDepartmentIds: []
    })
    const [departments, setDepartments] = useState<any[]>([])

    const [togglingProgramId, setTogglingProgramId] = useState<string | null>(
        null
    )
    const [saving, setSaving] = useState(false)
    const [searchText, setSearchText] = useState('')
    const [filteredStatus, setFilteredStatus] = useState<string | null>(null)
    const [editModalVisible, setEditModalVisible] = useState(false)
    const [selectedProgram, setSelectedProgram] = useState<any>(null)
    const [editForm] = Form.useForm()
    const [currentStep, setCurrentStep] = useState(0)
    const [basicDetails, setBasicDetails] = useState<any>({})
    const [questions, setQuestions] = useState<any[]>([])
    const [questionModalOpen, setQuestionModalOpen] = useState(false)
    const [editingQuestion, setEditingQuestion] = useState<any>(null)
    const [branches, setBranches] = useState<any[]>([])
    const [userBranchId, setUserBranchId] = useState<string | null>(null)
    const { user } = useFullIdentity()

    const isProjectAdmin = user?.role === 'projectadmin'

    const scopedPrograms =
        isProjectAdmin && userBranchId
            ? programs.filter(p => {
                const branchId = p.assignedBranch?.id || p.branchId || null
                return branchId === userBranchId
            })
            : programs

    const resolveAssignedBranch = (branchId?: string) => {
        const b = branches.find(x => x.id === branchId)
        if (!b) return null
        return {
            id: b.id,
            name: b.name || b.title || 'Branch'
        }
    }

    useEffect(() => {
        if (!user) return
        setUserBranchId(user.assignedBranch || null)
        setUserResolved(true)
    }, [user])

    useEffect(() => {
        const fetchBranches = async () => {
            setBranchesLoading(true)
            try {
                const snap = await getDocs(
                    query(
                        collection(db, 'branches'),

                    )
                )
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                setBranches(list)
            } finally {
                setBranchesLoading(false)
            }
        }
        fetchBranches()
    }, [])

    useEffect(() => {
        departmentService
            .getAllDepartments()
            .then(setDepartments)
            .catch(err => {
                console.error('Failed to load departments', err)
                setDepartments([])
            })
    }, [])

    // prefill branch on create modal
    useEffect(() => {
        if (!modalVisible) return
        const current = form.getFieldValue('branchId')
        if (current) return

        const hasUserBranch =
            userBranchId && branches.some(b => b.id === userBranchId)
        const prefId = hasUserBranch
            ? userBranchId
            : branches.length === 1
                ? branches[0].id
                : undefined

        if (prefId) form.setFieldsValue({ branchId: prefId })
    }, [modalVisible, userBranchId, branches, form])

    const fetchPrograms = async () => {
        setProgramsLoading(true)
        try {
            const snap = await getDocs(
                query(
                    collection(db, 'programs'),

                )
            )
            setPrograms(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        } catch {
            message.error('Failed to load programs')
        } finally {
            setProgramsLoading(false)
            setInitialProgramsLoaded(true)
        }
    }

    useEffect(() => {
        fetchPrograms()
    }, [])

    useEffect(() => {
        if (!modalVisible || booting) return
        const current = form.getFieldValue('branchId')
        if (current) return

        const hasUserBranch =
            userBranchId && branches.some(b => b.id === userBranchId)
        const prefId = hasUserBranch
            ? userBranchId
            : branches.length === 1
                ? branches[0].id
                : undefined

        if (prefId) form.setFieldsValue({ branchId: prefId })
    }, [modalVisible, userBranchId, branches, form, booting])

    const handleCoverageChange = (next: ProgramCoverageValue) => {
        setCoverage(next)
        const synced = upsertHubQuestion(
            questions,
            next.isMultiBranch ? next.supportedBranchIds : [],
            branches
        )
        setQuestions(synced)
    }

    const normalizeProgramRequirements = (docs: RequiredDoc[] = []) =>
        docs.map(d => ({
            id: d.id,
            key: d.key,
            title: d.title,
            isOnboarding: true,
            hasExpiry: !!d.hasExpiry,
            expiryMonths: d.hasExpiry ? d.expiryMonths ?? null : null,
            requiredAtApplication: !!d.requiredAtApplication,
            kind: d.kind ?? 'upload',
            ...((d.kind ?? 'upload') === 'agreement'
                ? { agreementId: d.agreementId }
                : {})
        }))

    const uploadProgramLogo = async (programId: string, file: File, oldPath?: string | null) => {
        const storage = getStorage()
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
        const path = `programLogos/${programId}/${Date.now()}_${safeName}`
        const storageRef = ref(storage, path)

        const snap = await uploadBytes(storageRef, file, {
            contentType: file.type || 'image/png'
        })
        const url = await getDownloadURL(snap.ref)

        // Optional cleanup of old logo
        if (oldPath && oldPath !== path) {
            try {
                await deleteObject(ref(storage, oldPath))
            } catch {
                // ignore (file may not exist / permissions)
            }
        }

        return { logoUrl: url, logoPath: path }
    }

    const handleAddProgram = async (values: any) => {
        setSaving(true)
        try {
            if (programs.length >= programLimit) {
                message.warning(
                    `Your organization has reached its limit of ${programLimit} program${programLimit === 1 ? '' : 's'}.`
                )
                return
            }
            const assignedBranch = resolveAssignedBranch(values.branchId)
            const rawPayload = {
                ...values,
                isActive: true,
                status: values.status || 'Active',
                startDate: toTs(values.startDate),
                endDate: toTs(values.endDate),
                assignedBranch,
                cohortYear:
                    values.cohortYear ||
                    (values.startDate ? dayjs(values.startDate).year() : dayjs().year()),
                description: values.description || '',
                eligibilityCriteria: eligibility,
                programRequirements: normalizeProgramRequirements(requiredDocs)
            }
            delete (rawPayload as any).branchId

            const payload = pruneUndefined(rawPayload)
            const docRef = await addDoc(collection(db, 'programs'), payload)
            await updateDoc(docRef, {
                id: docRef.id,
                registrationLink: `/registration?programId=${docRef.id}&role=sme`
            })

            // upload logo AFTER we have a programId
            if (logoFile) {
                const uploaded = await uploadProgramLogo(docRef.id, logoFile, null)
                await updateDoc(docRef, uploaded)
            }

            await upsertProgramRequiredDocs(docRef.id, requiredDocs)

            message.success('Program added successfully')
            setModalVisible(false)
            setLogoFile(null)
            if (logoPreview && logoPreview.startsWith('blob:')) URL.revokeObjectURL(logoPreview)
            setLogoPreview(null)

            form.resetFields()
            setRequiredDocs([])
            setQuestions([])
            setCoverage({ isMultiBranch: false, supportedBranchIds: [], participatingDepartmentIds: [] })
            fetchPrograms()
        } catch (err: any) {
            message.error('Failed to add program: ' + (err.message || err))
        } finally {
            setSaving(false)
        }
    }

    const handleUpdateProgram = async (values: any) => {
        setSaving(true)
        try {
            if (!selectedProgram) {
                message.error('No program selected')
                return
            }
            const assignedBranch = resolveAssignedBranch(values.branchId)
            const rawPayload = {
                ...selectedProgram,
                ...values,
                startDate: toTs(values.startDate),
                endDate: toTs(values.endDate),
                assignedBranch,
                eligibilityCriteria: eligibility,
                programRequirements: normalizeProgramRequirements(requiredDocs)
            }
            delete (rawPayload as any).branchId

            const payload = pruneUndefined(rawPayload)

            await updateDoc(doc(db, 'programs', selectedProgram.id), payload)

            if (logoFile) {
                const uploaded = await uploadProgramLogo(
                    selectedProgram.id,
                    logoFile,
                    selectedProgram.logoPath || null
                )
                await updateDoc(doc(db, 'programs', selectedProgram.id), uploaded)
            }

            await upsertProgramRequiredDocs(selectedProgram.id, requiredDocs)

            message.success('Program updated successfully')
            setEditModalVisible(false)
            setQuestions([])
            setCoverage({ isMultiBranch: false, supportedBranchIds: [], participatingDepartmentIds: [] })
            fetchPrograms()
        } catch (err: any) {
            message.error('Failed to update program')
            console.error(err)
        } finally {
            setSaving(false)
        }
    }

    // Every section of the edit wizard is fully prefilled the moment "Edit" is
    // clicked (editForm, coverage, eligibility, requiredDocs, questions, logo all
    // load from the record right away), so any single section can save the whole
    // program on its own -- the user never has to walk through the rest.
    const saveEditedProgram = async () => {
        await handleUpdateProgram({
            ...basicDetails,
            ...editForm.getFieldsValue(),
            ...coverage,
            onboardingQuestions: questions,
            eligibilityCriteria: eligibility
        })
    }

    const handleDeleteProgram = async (id: string) => {
        try {
            await deleteDoc(doc(db, 'programs', id))
            message.success('Program deleted successfully')
            fetchPrograms()
        } catch (err) {
            console.error(err)
            message.error('Failed to delete program')
        }
    }

    const filteredPrograms = scopedPrograms.filter(program => {
        const matchesSearch = (program.name || '')
            .toLowerCase()
            .includes(searchText.toLowerCase())
        const matchesStatus = filteredStatus
            ? program.status === filteredStatus
            : true
        return matchesSearch && matchesStatus
    })

    const totalPrograms = scopedPrograms.length
    const activePrograms = scopedPrograms.filter(
        p => p.status === 'Active'
    ).length
    // const totalBudget = scopedPrograms.reduce(
    //     (sum, p) => sum + (p.budget || 0),
    //     0
    // )
    const totalCapacity = scopedPrograms.reduce(
        (sum, p) => sum + (p.maxCapacity || 0),
        0
    )

    return (
        <>
            <Helmet>
                <title>Incubation Programs | Smart Incubation Platform</title>
            </Helmet>

            <div style={{ padding: 24, height: '100vh' }}>
                {booting ? (
                    <LoadingOverlay tip='Getting your programs ready…' />
                ) : (
                    <>
                        {viewMode === 'programs' ? (
                            <>
                                {/* metrics */}
                                <Row data-guide='program-metrics' gutter={[16, 16]} style={{ marginBottom: 24 }}>
                                    <Col xs={24} sm={12} md={8}>
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.4 }}
                                        >
                                            <MotionCard.Metric
                                                title='Total Programs'
                                                value={formatter(totalPrograms)}
                                                icon={
                                                    <ProjectOutlined
                                                        style={{ fontSize: 18, color: '#1d39c4' }}
                                                    />
                                                }
                                                iconBg='rgba(29,57,196,.12)'
                                            />
                                        </motion.div>
                                    </Col>

                                    <Col xs={24} sm={12} md={8}>
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.4, delay: 0.1 }}
                                        >
                                            <MotionCard.Metric
                                                title='Active Programs'
                                                value={
                                                    <span style={{ color: '#52c41a' }}>
                                                        {formatter(activePrograms)}
                                                    </span>
                                                }
                                                icon={
                                                    <CheckCircleOutlined
                                                        style={{ fontSize: 18, color: '#52c41a' }}
                                                    />
                                                }
                                                iconBg='rgba(82,196,26,.12)'
                                            />
                                        </motion.div>
                                    </Col>

                                    {/* <Col xs={24} sm={12} md={6}>
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.4, delay: 0.2 }}
                                        >
                                            <MotionCard.Metric
                                                title='Total Budget'
                                                value={
                                                    <span style={{ color: '#1890ff' }}>
                                                        {formatter(totalBudget)}
                                                    </span>
                                                }
                                                icon={
                                                    <DollarOutlined
                                                        style={{ fontSize: 18, color: '#1890ff' }}
                                                    />
                                                }
                                                iconBg='rgba(24,144,255,.12)'
                                            />
                                        </motion.div>
                                    </Col> */}

                                    <Col xs={24} sm={12} md={8}>
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.4, delay: 0.3 }}
                                        >
                                            <MotionCard.Metric
                                                title='Total Capacity'
                                                value={formatter(totalCapacity)}
                                                icon={
                                                    <TeamOutlined
                                                        style={{ fontSize: 18, color: '#eb2f96' }}
                                                    />
                                                }
                                                iconBg='rgba(235,47,150,.12)'
                                            />
                                        </motion.div>
                                    </Col>
                                </Row>

                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4 }}
                                >
                                    <MotionCard
                                        loading={programsLoading}
                                        filterBarProps={{ marginBottom: 0 }}
                                        filterBar={
                                            <div
                                                data-guide='program-filters'
                                                style={{ display: 'flex', flexWrap: 'wrap', gap: 16, width: '100%' }}
                                            >
                                                <div data-guide='program-manager-header' style={{ flex: '0 1 220px' }}>
                                                    <ProgramViewToggle value={viewMode} onChange={setViewMode} />
                                                </div>
                                                <div style={{ flex: '1 1 220px' }}>
                                                    <Input
                                                        placeholder='Search Program Name'
                                                        value={searchText}
                                                        onChange={e => setSearchText(e.target.value)}
                                                        allowClear
                                                    />
                                                </div>
                                                <div style={{ flex: '1 1 220px' }}>
                                                    <Select
                                                        placeholder='Filter by Status'
                                                        onChange={value => setFilteredStatus(value)}
                                                        value={filteredStatus}
                                                        allowClear
                                                        style={{ width: '100%' }}
                                                    >
                                                        <Select.Option value='Active'>Active</Select.Option>
                                                        <Select.Option value='Inactive'>Inactive</Select.Option>
                                                        <Select.Option value='Completed'>Completed</Select.Option>
                                                        <Select.Option value='Upcoming'>Upcoming</Select.Option>
                                                    </Select>
                                                </div>
                                                {programs.length < programLimit && (
                                                    <div style={{ flex: '0 1 180px', display: 'flex', justifyContent: 'flex-end' }}>
                                                        <Button
                                                            shape='round'
                                                            data-guide='add-program-action'
                                                            type='primary'
                                                            icon={<PlusOutlined />}
                                                            onClick={() => {
                                                                if (programs.length >= programLimit) {
                                                                    message.warning(
                                                                        `Only ${programLimit} program${programLimit === 1 ? ' is' : 's are'} allowed. Contact the system administrator to add more.`
                                                                    )
                                                                } else {
                                                                    setCoverage({
                                                                        isMultiBranch: false,
                                                                        supportedBranchIds: [],
                                                                        participatingDepartmentIds: []
                                                                    })
                                                                    setModalVisible(true)
                                                                }
                                                            }}
                                                        >
                                                            Add Program
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        }
                                    />
                                </motion.div>

                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4 }}
                                >
                                    <MotionCard style={{ marginTop: 15 }}>
                                        {isProjectAdmin && scopedPrograms.length === 0 ? (
                                            <Result
                                                status='500'
                                                title='No programs set up yet'
                                                subTitle='There are no incubation programs configured for your branch yet. Please contact head office or M&E to assign a program to your branch.'
                                            />
                                        ) : (
                                            <div data-guide='program-table'>
                                                <Table
                                                    loading={programsLoading}
                                                    dataSource={filteredPrograms}
                                                    rowKey='id'
                                                    pagination={{ pageSize: 6, showSizeChanger: false, position: ['bottomCenter'] }}
                                                    expandable={{
                                                        expandedRowRender: record => (
                                                            <div>
                                                                <p>
                                                                    <strong>Description:</strong>
                                                                    {record.description || 'N/A'}
                                                                </p>
                                                                {/* <p>
                                                                <strong>Budget:</strong> R
                                                                {record.budget?.toLocaleString() || 0}
                                                            </p> */}
                                                                <p>
                                                                    <strong>Max Capacity:</strong>
                                                                    {record.maxCapacity || 'N/A'}
                                                                </p>
                                                            </div>
                                                        )
                                                    }}
                                                >
                                                    <Table.Column
                                                        title='Program Name'
                                                        dataIndex='name'
                                                        key='name'
                                                    />
                                                    <Table.Column
                                                        title='Assigned Branch'
                                                        key='assignedBranch'
                                                        render={(record: any) =>
                                                            record.assignedBranch ? (
                                                                <span>
                                                                    <b>{record.assignedBranch.name}</b>
                                                                    <br />
                                                                    {record.assignedBranch.email ? (
                                                                        <span style={{ color: '#888', fontSize: 13 }}>
                                                                            {record.assignedBranch.email}
                                                                        </span>
                                                                    ) : null}
                                                                </span>
                                                            ) : (
                                                                <Tag color='orange'>Not Assigned</Tag>
                                                            )
                                                        }
                                                    />
                                                    <Table.Column
                                                        title='Scope'
                                                        dataIndex='isMultiBranch'
                                                        render={(val: boolean | undefined) =>
                                                            val ? (
                                                                <Tag color='blue'>Multi-branch</Tag>
                                                            ) : (
                                                                <Tag>Single branch</Tag>
                                                            )
                                                        }
                                                    />
                                                    <Table.Column title='Type' dataIndex='type' />
                                                    <Table.Column
                                                        title='Status'
                                                        dataIndex='status'
                                                        render={(s: string) => (
                                                            <Tag color={s === 'Active' ? 'green' : 'red'}>{s}</Tag>
                                                        )}
                                                    />
                                                    <Table.Column
                                                        title='Start Date'
                                                        dataIndex='startDate'
                                                        render={(val: any) =>
                                                            typeof val === 'string'
                                                                ? val
                                                                : val?.toDate
                                                                    ? dayjs(val.toDate()).format('YYYY-MM-DD')
                                                                    : 'N/A'
                                                        }
                                                    />
                                                    <Table.Column
                                                        title='End Date'
                                                        dataIndex='endDate'
                                                        render={(val: any) =>
                                                            typeof val === 'string'
                                                                ? val
                                                                : val?.toDate
                                                                    ? dayjs(val.toDate()).format('YYYY-MM-DD')
                                                                    : 'N/A'
                                                        }
                                                    />
                                                    <Table.Column
                                                        title='Registration Link'
                                                        dataIndex='registrationLink'
                                                        render={(link: string) => (
                                                            <Text
                                                                copyable={{
                                                                    text: window.location.origin + link,
                                                                    tooltips: ['Copy link', 'Copied!']
                                                                }}
                                                            />
                                                        )}
                                                    />
                                                    <Table.Column
                                                        title='Actions'
                                                        key='actions'
                                                        render={(_: any, record: any) => (
                                                            <Space size='middle'>
                                                                <Button
                                                                    icon={<EditOutlined />}
                                                                    size='small'
                                                                    style={{ border: 'none' }}
                                                                    onClick={() => {
                                                                        setSelectedProgram(record)
                                                                        setLogoFile(null)
                                                                        setLogoPreview(record.logoUrl || null)

                                                                        editForm.setFieldsValue({
                                                                            ...record,
                                                                            branchId:
                                                                                record.assignedBranch?.id ||
                                                                                record.branchId ||
                                                                                null,
                                                                            startDate: record.startDate
                                                                                ? typeof record.startDate === 'string'
                                                                                    ? dayjs(record.startDate)
                                                                                    : record.startDate?.toDate
                                                                                        ? dayjs(record.startDate.toDate())
                                                                                        : null
                                                                                : null,
                                                                            endDate: record.endDate
                                                                                ? typeof record.endDate === 'string'
                                                                                    ? dayjs(record.endDate)
                                                                                    : record.endDate?.toDate
                                                                                        ? dayjs(record.endDate.toDate())
                                                                                        : null
                                                                                : null
                                                                        })
                                                                        const recordSupportedBranchIds = (
                                                                            record.supportedBranchIds || []
                                                                        ).filter(
                                                                            (id: string) =>
                                                                                !userBranchId || id !== userBranchId // strip my own branch
                                                                        )
                                                                        setCoverage({
                                                                            isMultiBranch: !!record.isMultiBranch,
                                                                            supportedBranchIds: recordSupportedBranchIds,
                                                                            participatingDepartmentIds:
                                                                                record.participatingDepartmentIds || []
                                                                        })
                                                                        const baseQuestions =
                                                                            record.onboardingQuestions || []
                                                                        const syncedQuestions = upsertHubQuestion(
                                                                            baseQuestions,
                                                                            record.supportedBranchIds || [],
                                                                            branches
                                                                        )
                                                                        setQuestions(syncedQuestions)
                                                                        setEligibility(record.eligibilityCriteria || [])
                                                                            ; (async () => {
                                                                                const fromSub = await fetchProgramRequiredDocs(
                                                                                    record.id
                                                                                )
                                                                                if (fromSub.length) {
                                                                                    setRequiredDocs(fromSub)
                                                                                } else {
                                                                                    setRequiredDocs(
                                                                                        (record.programRequirements || []).map(
                                                                                            (r: any) => ({
                                                                                                ...r,
                                                                                                isOnboarding: true,
                                                                                                kind: r.kind ?? 'upload'
                                                                                            })
                                                                                        )
                                                                                    )
                                                                                }
                                                                            })()
                                                                        setEditModalVisible(true)
                                                                        setCurrentStep(-1)
                                                                    }}
                                                                />

                                                                {/* ✅ Confirmation before delete */}
                                                                <Popconfirm
                                                                    title='Delete this program?'
                                                                    description='This action cannot be undone.'
                                                                    okText='Yes, delete'
                                                                    cancelText='Cancel'
                                                                    okType='danger'
                                                                    onConfirm={() => handleDeleteProgram(record.id)}
                                                                >
                                                                    <Button
                                                                        icon={<DeleteOutlined />}
                                                                        size='small'
                                                                        danger
                                                                    />
                                                                </Popconfirm>

                                                                <Button
                                                                    size='small'
                                                                    icon={<PoweroffOutlined />}
                                                                    onClick={() => {
                                                                        const newStatus =
                                                                            record.status === 'Active'
                                                                                ? 'Inactive'
                                                                                : 'Active'
                                                                        setTogglingProgramId(record.id)
                                                                        updateDoc(doc(db, 'programs', record.id), {
                                                                            status: newStatus
                                                                        })
                                                                            .then(() => {
                                                                                message.success(
                                                                                    `Program ${newStatus.toLowerCase()}d`
                                                                                )
                                                                                fetchPrograms()
                                                                            })
                                                                            .finally(() => setTogglingProgramId(null))
                                                                    }}
                                                                    loading={togglingProgramId === record.id}
                                                                >
                                                                    {record.status === 'Active'
                                                                        ? 'Deactivate'
                                                                        : 'Activate'}
                                                                </Button>
                                                            </Space>
                                                        )}
                                                    />
                                                </Table>
                                            </div>
                                        )}
                                    </MotionCard>
                                </motion.div>

                                {/* CREATE */}
                                <Modal
                                    className='guide-program-modal'
                                    centered
                                    open={modalVisible}
                                    title='Add New Program'
                                    onCancel={() => {
                                        setModalVisible(false)
                                        setQuestions([])
                                        setEditingQuestion(null)
                                        setCurrentStep(0)
                                        setEligibility({})
                                        setRequiredDocs([])
                                        setCoverage({
                                            isMultiBranch: false,
                                            supportedBranchIds: [],
                                            participatingDepartmentIds: []
                                        })
                                    }}
                                    footer={null}
                                    confirmLoading={saving}
                                    width={1200}
                                >
                                    <div data-guide='program-wizard-steps' hidden>
                                        <Steps current={currentStep} style={{ marginBottom: 24 }}>
                                            <Steps.Step title="Program Details" />
                                            <Steps.Step title="Coverage" />
                                            <Steps.Step title="Program Logo" />
                                            <Steps.Step title="Eligibility Criteria" />
                                            <Steps.Step title="Required Documents" />
                                            <Steps.Step title="Onboarding Questions" />
                                        </Steps>
                                    </div>

                                    <AnimatePresence mode='wait'>
                                        <motion.div
                                            key={currentStep}
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.25 }}
                                        >
                                            {currentStep === 0 && (
                                                <Form data-guide='program-basic-details'
                                                    layout='vertical'
                                                    form={form}
                                                    onFinish={values => {
                                                        setBasicDetails(values)
                                                        setCurrentStep(1)
                                                    }}
                                                >
                                                    <Form.Item
                                                        name='branchId'
                                                        label='Branch'
                                                        hidden
                                                    >
                                                        <Select
                                                            disabled={!!userBranchId}
                                                            placeholder='Select branch'
                                                        >
                                                            {branches.map(branch => (
                                                                <Select.Option key={branch.id} value={branch.id}>
                                                                    {branch.name}
                                                                </Select.Option>
                                                            ))}
                                                        </Select>
                                                    </Form.Item>
                                                    <Form.Item
                                                        name='name'
                                                        label='Program Name'
                                                        rules={[{ required: true }]}
                                                    >
                                                        <Input />
                                                    </Form.Item>
                                                    <Form.Item
                                                        name='description'
                                                        label='Program Description'
                                                        rules={[
                                                            { required: true, message: 'Please enter a description' },
                                                            {
                                                                validator: (_, value) => {
                                                                    const words = (value || '')
                                                                        .trim()
                                                                        .split(/\s+/)
                                                                        .filter(Boolean).length
                                                                    return words < 100
                                                                        ? Promise.resolve()
                                                                        : Promise.reject(
                                                                            new Error(
                                                                                `Please keep it under 100 words (currently ${words}).`
                                                                            )
                                                                        )
                                                                }
                                                            }
                                                        ]}
                                                    >
                                                        <Input.TextArea
                                                            autoSize={{ minRows: 3, maxRows: 6 }}
                                                            placeholder='Briefly describe the program (under 100 words)'
                                                        />
                                                    </Form.Item>

                                                    <Form.Item noStyle shouldUpdate>
                                                        {({ getFieldValue }) => {
                                                            const v = getFieldValue('description') || ''
                                                            const words = v.trim() ? v.trim().split(/\s+/).length : 0
                                                            return (
                                                                <div
                                                                    style={{
                                                                        textAlign: 'right',
                                                                        marginTop: -8,
                                                                        marginBottom: 12
                                                                    }}
                                                                >
                                                                    <span
                                                                        style={{
                                                                            color:
                                                                                words >= 100 ? '#ff4d4f' : 'rgba(0,0,0,.45)'
                                                                        }}
                                                                    >
                                                                        {words}/99 words
                                                                    </span>
                                                                </div>
                                                            )
                                                        }}
                                                    </Form.Item>

                                                    <Row gutter={16}>
                                                        <Col span={12}>
                                                            <Form.Item
                                                                name='type'
                                                                label='Type'
                                                                rules={[{ required: true }]}
                                                            >
                                                                <Select placeholder='Select program type'>
                                                                    {PROGRAM_TYPES.map(t => (
                                                                        <Select.Option key={t} value={t}>
                                                                            {t}
                                                                        </Select.Option>
                                                                    ))}
                                                                </Select>
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={12}>
                                                            <Form.Item name='status' label='Status'>
                                                                <Select>
                                                                    <Select.Option value='Active'>Active</Select.Option>
                                                                    <Select.Option value='Inactive'>
                                                                        Inactive
                                                                    </Select.Option>
                                                                    <Select.Option value='Completed'>
                                                                        Completed
                                                                    </Select.Option>
                                                                    <Select.Option value='Upcoming'>
                                                                        Upcoming
                                                                    </Select.Option>
                                                                </Select>
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>

                                                    <Row gutter={16}>
                                                        <Col span={8}>
                                                            <Form.Item
                                                                name='cohortYear'
                                                                label='Cohort Year'
                                                                rules={[{ required: true }]}
                                                            >
                                                                <Input placeholder='e.g., 2025' />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={8}>
                                                            <Form.Item
                                                                name='startDate'
                                                                label='Start Date'
                                                                rules={[{ required: true, message: 'Please select a start date' }]}
                                                            >
                                                                <DatePicker style={{ width: '100%' }} />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={8}>
                                                            <Form.Item
                                                                name='endDate'
                                                                label='End Date'
                                                                rules={[{ required: true, message: 'Please select an end date' }]}
                                                            >
                                                                <DatePicker style={{ width: '100%' }} />
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>
                                                    <Row gutter={16}>
                                                        <Col span={12}>
                                                            <Form.Item
                                                                name='assignedFunder'
                                                                label='Assign Project Funder'
                                                                rules={[{ required: true, message: 'Please assign a project funder' }]}
                                                            >
                                                                <Input placeholder='e.g., Quantilytix' />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={12}>
                                                            <Form.Item name='maxCapacity' label='Max Capacity'>
                                                                <InputNumber
                                                                    style={{ width: '100%' }}
                                                                    min={0}
                                                                    step={1}
                                                                    precision={0}
                                                                    parser={v => (v ? v.replace(/[^\d]/g, '') : '')}
                                                                    inputMode='numeric'
                                                                />
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>
                                                    <Form.Item>
                                                        <Button type='primary' htmlType='submit' block>
                                                            Next
                                                        </Button>
                                                    </Form.Item>
                                                </Form>
                                            )}

                                            {currentStep === 1 && (
                                                <CoverageStep
                                                    value={coverage}
                                                    onChange={handleCoverageChange}
                                                    branches={branches}
                                                    departments={departments}
                                                    userBranchId={userBranchId}
                                                    onBack={() => setCurrentStep(0)}
                                                    onNext={() => setCurrentStep(2)}
                                                />
                                            )}

                                            {currentStep === 2 && (
                                                <ProgramLogoStep
                                                    logoPreview={logoPreview}
                                                    onPick={(file, preview) => {
                                                        // cleanup old preview url to avoid memory leak
                                                        if (logoPreview && logoPreview.startsWith('blob:')) URL.revokeObjectURL(logoPreview)
                                                        setLogoFile(file)
                                                        setLogoPreview(preview)
                                                    }}
                                                    onBack={() => setCurrentStep(1)}
                                                    onNext={() => setCurrentStep(3)}
                                                />
                                            )}

                                            {currentStep === 3 && (
                                                <EligibilityCriteriaStep
                                                    value={eligibility}
                                                    onChange={setEligibility}
                                                    onBack={() => setCurrentStep(2)}
                                                    onNext={() => setCurrentStep(4)}
                                                />
                                            )}

                                            {currentStep === 4 && (
                                                <div data-guide='program-required-documents-step'>
                                                    <RequiredDocumentsStep
                                                        value={requiredDocs}
                                                        onChange={setRequiredDocs}
                                                        onBack={() => setCurrentStep(3)}
                                                        onNext={() => setCurrentStep(5)}
                                                    />
                                                </div>
                                            )}

                                            {currentStep === 5 && (
                                                <>
                                                    <QuestionTable
                                                        questions={questions}
                                                        onAdd={() => {
                                                            setEditingQuestion(null)
                                                            setQuestionModalOpen(true)
                                                        }}
                                                        onEdit={(q: any) => {
                                                            setEditingQuestion(q)
                                                            setQuestionModalOpen(true)
                                                        }}
                                                        onDelete={(id: string) =>
                                                            setQuestions(
                                                                questions.filter(q => q.id !== id || q.systemKey)
                                                            )
                                                        }
                                                    />
                                                    <QuestionModal
                                                        visible={questionModalOpen}
                                                        initialValues={editingQuestion}
                                                        onSave={(values: any) => {
                                                            let opts = values.options
                                                            if (
                                                                values.type === 'dropdown' &&
                                                                typeof opts === 'string'
                                                            ) {
                                                                opts = opts
                                                                    .split(',')
                                                                    .map((o: string) => o.trim())
                                                                    .filter(Boolean)
                                                            }
                                                            if (editingQuestion) {
                                                                setQuestions(
                                                                    questions.map(q =>
                                                                        q.id === editingQuestion.id
                                                                            ? {
                                                                                ...editingQuestion,
                                                                                ...values,
                                                                                options: opts
                                                                            }
                                                                            : q
                                                                    )
                                                                )
                                                                message.success('Question updated')
                                                            } else {
                                                                setQuestions([
                                                                    ...questions,
                                                                    {
                                                                        ...values,
                                                                        id: Date.now().toString(),
                                                                        options: opts
                                                                    }
                                                                ])
                                                                message.success('Question added')
                                                            }
                                                            setQuestionModalOpen(false)
                                                        }}
                                                        onCancel={() => setQuestionModalOpen(false)}
                                                    />
                                                    <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
                                                        <Button style={{ flex: 1 }} onClick={() => setCurrentStep(4)}>Back</Button>
                                                        <Button
                                                            style={{ flex: 1 }}
                                                            type='primary'
                                                            loading={saving}
                                                            onClick={async () => {
                                                                await handleAddProgram({
                                                                    ...basicDetails,
                                                                    ...coverage,
                                                                    onboardingQuestions: questions,
                                                                    eligibilityCriteria: eligibility
                                                                })
                                                            }}
                                                        >
                                                            Save Program
                                                        </Button>
                                                    </div>
                                                </>
                                            )}
                                        </motion.div>
                                    </AnimatePresence>
                                </Modal>

                                {/* EDIT */}
                                <Modal
                                    className='guide-program-modal'
                                    centered
                                    open={editModalVisible}
                                    title='Edit Program'
                                    onCancel={() => {
                                        setEditModalVisible(false)
                                        setQuestions([])
                                        setEditingQuestion(null)
                                        setRequiredDocs([])
                                        setCurrentStep(-1)
                                        setEligibility({})
                                        setCoverage({
                                            isMultiBranch: false,
                                            supportedBranchIds: [],
                                            participatingDepartmentIds: []
                                        })
                                    }}
                                    footer={null}
                                    confirmLoading={saving}
                                    width={1200}
                                >
                                    <div data-guide='program-wizard-steps' hidden>
                                        <Steps current={currentStep} style={{ marginBottom: 24 }}>
                                            <Steps.Step title="Program Details" />
                                            <Steps.Step title="Coverage" />
                                            <Steps.Step title="Program Logo" />
                                            <Steps.Step title="Eligibility Criteria" />
                                            <Steps.Step title="Required Documents" />
                                            <Steps.Step title="Onboarding Questions" />
                                        </Steps>
                                    </div>

                                    <AnimatePresence mode='wait'>
                                        <motion.div
                                            key={currentStep}
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.25 }}
                                        >
                                            {currentStep === -1 && (
                                                <SectionPickerStep
                                                    onSelect={setCurrentStep}
                                                    onSaveAndClose={saveEditedProgram}
                                                    saving={saving}
                                                />
                                            )}
                                            {currentStep === 0 && (
                                                <Form data-guide='program-basic-details'
                                                    layout='vertical'
                                                    form={editForm}
                                                    onFinish={values => {
                                                        setBasicDetails(values)
                                                        saveEditedProgram()
                                                    }}
                                                >
                                                    <Form.Item
                                                        name='branchId'
                                                        label='Branch'
                                                        hidden
                                                    >
                                                        <Select
                                                            disabled={!!userBranchId}
                                                            placeholder='Select branch'
                                                        >
                                                            {branches.map(branch => (
                                                                <Select.Option key={branch.id} value={branch.id}>
                                                                    {branch.name}
                                                                </Select.Option>
                                                            ))}
                                                        </Select>
                                                    </Form.Item>

                                                    <Form.Item
                                                        name='name'
                                                        label='Program Name'
                                                        rules={[{ required: true }]}
                                                    >
                                                        <Input />
                                                    </Form.Item>
                                                    <Form.Item
                                                        name='description'
                                                        label='Program Description'
                                                        rules={[{ required: true }]}
                                                    >
                                                        <Input />
                                                    </Form.Item>
                                                    <Row gutter={16}>
                                                        <Col span={12}>
                                                            <Form.Item name='type' label='Type'>
                                                                <Select placeholder='Select program type'>
                                                                    {PROGRAM_TYPES.map(t => (
                                                                        <Select.Option key={t} value={t}>
                                                                            {t}
                                                                        </Select.Option>
                                                                    ))}
                                                                </Select>
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={12}>
                                                            <Form.Item name='status' label='Status'>
                                                                <Select>
                                                                    <Select.Option value='Active'>Active</Select.Option>
                                                                    <Select.Option value='Inactive'>Inactive</Select.Option>
                                                                    <Select.Option value='Completed'>Completed</Select.Option>
                                                                    <Select.Option value='Upcoming'>Upcoming</Select.Option>
                                                                </Select>
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>

                                                    <Row gutter={16}>
                                                        <Col span={8}>
                                                            <Form.Item
                                                                name='cohortYear'
                                                                label='Cohort Year'
                                                                rules={[
                                                                    {
                                                                        required: true,
                                                                        message: 'Please input the cohort year'
                                                                    }
                                                                ]}
                                                            >
                                                                <Input placeholder='e.g., 2025' />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={8}>
                                                            <Form.Item
                                                                name='startDate'
                                                                label='Start Date'
                                                                rules={[{ required: true, message: 'Please select a start date' }]}
                                                            >
                                                                <DatePicker style={{ width: '100%' }} />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={8}>
                                                            <Form.Item
                                                                name='endDate'
                                                                label='End Date'
                                                                rules={[{ required: true, message: 'Please select an end date' }]}
                                                            >
                                                                <DatePicker style={{ width: '100%' }} />
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>
                                                    <Row gutter={16}>
                                                        <Col span={12}>
                                                            <Form.Item
                                                                name='assignedFunder'
                                                                label='Assign Project Funder'
                                                                rules={[{ required: true, message: 'Please assign a project funder' }]}
                                                            >
                                                                <Input placeholder='e.g., Quantiltyix' />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={12}>
                                                            <Form.Item name='maxCapacity' label='Max Capacity'>
                                                                <InputNumber style={{ width: '100%' }} min={1} />
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>

                                                    <div style={{ display: 'flex', gap: 12 }}>
                                                        <Button
                                                            style={{ flex: 1 }}
                                                            htmlType='button'
                                                            onClick={() => setCurrentStep(-1)}
                                                        >
                                                            Back to Sections
                                                        </Button>
                                                        <Button
                                                            style={{ flex: 1 }}
                                                            type='primary'
                                                            htmlType='submit'
                                                            loading={saving}
                                                        >
                                                            Save Program
                                                        </Button>
                                                    </div>
                                                </Form>
                                            )}
                                            {currentStep === 1 && (
                                                <CoverageStep
                                                    value={coverage}
                                                    onChange={handleCoverageChange}
                                                    branches={branches}
                                                    departments={departments}
                                                    userBranchId={userBranchId}
                                                    onBack={() => setCurrentStep(-1)}
                                                    onNext={saveEditedProgram}
                                                    backLabel='Back to Sections'
                                                    nextLabel='Save Program'
                                                    nextLoading={saving}
                                                />
                                            )}

                                            {currentStep === 2 && (
                                                <ProgramLogoStep
                                                    logoPreview={logoPreview}
                                                    onPick={(file, preview) => {
                                                        if (logoPreview && logoPreview.startsWith('blob:')) URL.revokeObjectURL(logoPreview)
                                                        setLogoFile(file)
                                                        setLogoPreview(preview)
                                                    }}
                                                    onBack={() => setCurrentStep(-1)}
                                                    onNext={saveEditedProgram}
                                                    backLabel='Back to Sections'
                                                    nextLabel='Save Program'
                                                    nextLoading={saving}
                                                />
                                            )}

                                            {currentStep === 3 && (
                                                <EligibilityCriteriaStep
                                                    value={eligibility}
                                                    onChange={setEligibility}
                                                    onBack={() => setCurrentStep(-1)}
                                                    onNext={saveEditedProgram}
                                                    backLabel='Back to Sections'
                                                    nextLabel='Save Program'
                                                    nextLoading={saving}
                                                />
                                            )}
                                            {currentStep === 4 && (
                                                <div data-guide='program-required-documents-step'>
                                                    <RequiredDocumentsStep
                                                        value={requiredDocs}
                                                        onChange={setRequiredDocs}
                                                        onBack={() => setCurrentStep(-1)}
                                                        onNext={saveEditedProgram}
                                                        backLabel='Back to Sections'
                                                        nextLabel='Save Program'
                                                        nextLoading={saving}
                                                    />
                                                </div>
                                            )}
                                            {currentStep === 5 && (
                                                <>
                                                    <QuestionTable
                                                        questions={questions}
                                                        onAdd={() => {
                                                            setEditingQuestion(null)
                                                            setQuestionModalOpen(true)
                                                        }}
                                                        onEdit={(q: any) => {
                                                            setEditingQuestion(q)
                                                            setQuestionModalOpen(true)
                                                        }}
                                                        onDelete={(id: string) =>
                                                            setQuestions(
                                                                questions.filter(
                                                                    q => q.id !== id || q.systemKey === 'nearestHub'
                                                                )
                                                            )
                                                        }
                                                    />
                                                    <QuestionModal
                                                        visible={questionModalOpen}
                                                        initialValues={editingQuestion}
                                                        onSave={(values: any) => {
                                                            let opts = values.options
                                                            if (
                                                                values.type === 'dropdown' &&
                                                                typeof opts === 'string'
                                                            ) {
                                                                opts = opts
                                                                    .split(',')
                                                                    .map((o: string) => o.trim())
                                                                    .filter(Boolean)
                                                            }
                                                            if (editingQuestion) {
                                                                setQuestions(
                                                                    questions.map(q =>
                                                                        q.id === editingQuestion.id
                                                                            ? {
                                                                                ...editingQuestion,
                                                                                ...values,
                                                                                options: opts
                                                                            }
                                                                            : q
                                                                    )
                                                                )
                                                                message.success('Question updated')
                                                            } else {
                                                                setQuestions([
                                                                    ...questions,
                                                                    {
                                                                        ...values,
                                                                        id: Date.now().toString(),
                                                                        options: opts
                                                                    }
                                                                ])
                                                                message.success('Question added')
                                                            }
                                                            setQuestionModalOpen(false)
                                                        }}
                                                        onCancel={() => setQuestionModalOpen(false)}
                                                    />
                                                    <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
                                                        <Button style={{ flex: 1 }} onClick={() => setCurrentStep(-1)}>Back to Sections</Button>
                                                        <Button
                                                            style={{ flex: 1 }}
                                                            type='primary'
                                                            loading={saving}
                                                            onClick={saveEditedProgram}
                                                        >
                                                            Save Program
                                                        </Button>
                                                    </div>
                                                </>
                                            )}
                                        </motion.div>
                                    </AnimatePresence>
                                </Modal>
                            </>
                        ) : (
                            <ProjectProposalsManager
                                branches={branches}
                                userBranchId={userBranchId}
                                isProjectAdmin={isProjectAdmin}
                                resolveAssignedBranch={resolveAssignedBranch}
                                viewMode={viewMode}
                                onViewModeChange={setViewMode}
                            />
                        )}
                    </>
                )}
            </div>
        </>
    )
}

export default ProgramManager
