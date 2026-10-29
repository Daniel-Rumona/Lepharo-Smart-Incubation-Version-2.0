import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
    Descriptions,
    Grid,
    List,
    Avatar,
    Tooltip,
    Pagination,
    App,
    Drawer,
    Dropdown,
    Segmented
} from 'antd'
import {
    ProjectOutlined,
    CheckCircleOutlined,
    DollarOutlined,
    TeamOutlined,
    PlusOutlined,
    SearchOutlined,
    ApartmentOutlined,
    FormOutlined,
    ImportOutlined,
    PaperClipOutlined,
    QuestionCircleOutlined,
    MoreOutlined,
    EditOutlined,
    DeleteOutlined,
    PoweroffOutlined, PictureOutlined,
    DownloadOutlined,
    FileTextOutlined,
    UploadOutlined,
    RightOutlined,
    PauseCircleOutlined,
    FlagOutlined,
    ClockCircleOutlined,
    SendOutlined,
    EyeOutlined,
    SyncOutlined,
    CloseCircleOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
    query,
    where,
    limit,
    Timestamp,
    writeBatch,
    orderBy
} from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import { motion, AnimatePresence } from 'framer-motion'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import '@/components/workspace'
import { StatusPill } from '@/routes/operations/movs/movParts'
import '@/routes/operations/movs/movs.css'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DashboardLoader } from '@/components/layout/DashboardLoader'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import type { UploadProps } from 'antd'
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import {
    DEFAULT_PROGRAM_LIMIT,
    getProgramLimit
} from '@/services/systemSettingsService'
import {
    AgreementTemplate,
    canonicalAgreementId,
    listAgreementTemplates
} from '@/services/complianceResolver'
import { departmentService } from '@/services/departmentService'
import { SetupSegmented } from '@/components/shared/SetupSegmented'
import { ChoiceCards } from '@/components/queries/ChoiceCards'
import './programs.css'

const { Text } = Typography

const PROGRAM_STATUSES = ['Active', 'Upcoming', 'Completed', 'Inactive']

/**
 * How SMEs get into a programme:
 * - applications: they apply, then participants are selected;
 * - direct: a new programme whose SMEs are already chosen, added as participants (no applications);
 * - migrated: a programme that ran before the system; its participants are brought in mid-way.
 */
type ProgramIntakeMode = 'applications' | 'direct' | 'migrated'

const INTAKE_LABELS: Record<ProgramIntakeMode, string> = {
    applications: 'Applying',
    direct: 'Added directly (new programme)',
    migrated: 'Moved from before the system'
}

/** Upcoming before the start date, Completed after the end date, otherwise Active. */
const INTAKE_OPTIONS = (): { value: ProgramIntakeMode; label: string; detail: string; icon: React.ReactNode }[] => [
    { value: 'applications', label: 'They apply', detail: 'Open applications, then select participants', icon: <FormOutlined /> },
    { value: 'direct', label: 'We add the SMEs', detail: 'A new programme; the SMEs are already chosen, so no applications', icon: <TeamOutlined /> },
    { value: 'migrated', label: 'Moving an existing programme', detail: 'It ran before the system; bring its participants in where they are', icon: <ImportOutlined /> }
]

const programStatusForDates = (start: any, end: any): 'Upcoming' | 'Active' | 'Completed' => {
    const today = dayjs().startOf('day')
    const toDay = (v: any) => (v ? dayjs(v?.toDate ? v.toDate() : v).startOf('day') : null)
    const s = toDay(start)
    const e = toDay(end)
    if (s && today.isBefore(s)) return 'Upcoming'
    if (e && today.isAfter(e)) return 'Completed'
    return 'Active'
}

/**
 * Some programmes were saved with a lowercase status ("active"). Match it to the
 * canonical one so filters, counts and pills treat them the same; the next save
 * writes the canonical value back.
 */
const normalizeProgramStatus = (value: any): string => {
    const raw = String(value || '').trim()
    if (!raw) return 'Active'
    return PROGRAM_STATUSES.find(status => status.toLowerCase() === raw.toLowerCase()) || raw
}

/** A type from the list, matched case-insensitively; otherwise shown with a capital letter. */
const displayProgramType = (value: any): string => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    return PROGRAM_TYPES.find(type => type.toLowerCase() === raw.toLowerCase()) || raw.charAt(0).toUpperCase() + raw.slice(1)
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
    agreementId?: string
}

const inferDepartmentOwner = (title: string): string => {
    const t = title.toLowerCase()
    if (t.includes('moa') || t.includes('contract') || t.includes('nda'))
        return 'Legal'
    if (t.includes('tax') || t.includes('bank') || t.includes('financial'))
        return 'Finance'
    return 'Operations'
}

const requirementKey = (r: RequiredDoc) => r.key || toKeyBase(r.title || r.id || '')

const toTemplate = (r: RequiredDoc): RequiredDocTemplate => ({
    id: requirementKey(r),
    title: r.title,
    type: (r.kind ?? 'upload') === 'agreement' ? 'agreement' : 'compliance',
    isOnboarding: true,
    departmentOwner: inferDepartmentOwner(r.title),
    mandatory: !!r.requiredAtApplication,
    expiryRule: r.hasExpiry ? { months: r.expiryMonths ?? null } : null,
    ...((r.kind ?? 'upload') === 'agreement' && r.agreementId
        ? { agreementId: r.agreementId }
        : {})
})

// Adds the rewrite of the requiredDocs mirror to `batch`, so it commits in the
// same write as programs/{id}.programRequirements and the two cannot diverge.
const queueProgramRequiredDocs = async (
    batch: ReturnType<typeof writeBatch>,
    programId: string,
    docs: RequiredDoc[]
) => {
    const colRef = collection(db, 'programs', programId, 'requiredDocs')

    const existing = await getDocs(colRef)
    existing.forEach(d => batch.delete(d.ref))

    docs.map(toTemplate).forEach(t => {
        batch.set(doc(db, 'programs', programId, 'requiredDocs', t.id), t)
    })
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
            agreementId: t.type === 'agreement' ? t.agreementId || d.id.toLowerCase() : undefined
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

const MAX_VISIBLE_OPTIONS = 6

const normalizeQuestionOptions = (opts: any): string[] =>
    Array.isArray(opts)
        ? opts
        : typeof opts === 'string'
            ? opts
                .split(',')
                .map((o: string) => o.trim())
                .filter(Boolean)
            : []

const QuestionTable: React.FC<{
    questions: any[]
    onAdd: () => void
    onEdit: (q: any) => void
    onDelete: (id: string) => void
}> = ({ questions, onAdd, onEdit, onDelete }) => (
    <div>
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 16
            }}
        >
            <Space size={8}>
                <Text strong>Onboarding questions</Text>
                <Tag style={{ marginInlineEnd: 0 }}>{questions.length}</Tag>
            </Space>
            <Button type='primary' shape='round' icon={<PlusOutlined />} onClick={onAdd}>
                Add Question
            </Button>
        </div>

        {questions.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No onboarding questions yet' />
        ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {questions.map(record => {
                    const options = normalizeQuestionOptions(record.options)
                    const visible = options.slice(0, MAX_VISIBLE_OPTIONS)
                    const hidden = options.slice(MAX_VISIBLE_OPTIONS)
                    const isSystem = record.systemKey === 'nearestHub'

                    return (
                        <div
                            key={record.id}
                            style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 12,
                                padding: '14px 16px',
                                borderRadius: 12,
                                border: '1px solid rgba(128,128,128,.25)'
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                    <Text strong>{record.label}</Text>
                                    <Tag color={record.type === 'dropdown' ? 'blue' : 'default'} style={{ margin: 0 }}>
                                        {record.type === 'dropdown' ? 'Dropdown' : 'Text'}
                                    </Tag>
                                    {record.type === 'dropdown' && record.allowMultiple && (
                                        <Tag color='purple' style={{ margin: 0 }}>
                                            Multi-select
                                        </Tag>
                                    )}
                                    {isSystem && (
                                        <Tag color='geekblue' style={{ margin: 0 }}>
                                            Auto (Nearest Hub)
                                        </Tag>
                                    )}
                                </div>

                                {options.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                                        {visible.map(o => (
                                            <Tag key={o} color='processing' style={{ margin: 0 }}>
                                                {o}
                                            </Tag>
                                        ))}
                                        {hidden.length > 0 && (
                                            <Tooltip title={hidden.join(', ')}>
                                                <Tag style={{ margin: 0, cursor: 'default' }}>
                                                    +{hidden.length} more
                                                </Tag>
                                            </Tooltip>
                                        )}
                                    </div>
                                )}
                            </div>

                            <Space size={8} style={{ flexShrink: 0 }}>
                                <Button shape='circle' icon={<EditOutlined />} onClick={() => onEdit(record)} />
                                <Button
                                    shape='circle'
                                    danger
                                    icon={<DeleteOutlined />}
                                    disabled={isSystem}
                                    onClick={() => onDelete(record.id)}
                                />
                            </Space>
                        </div>
                    )
                })}
            </div>
        )}
    </div>
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

const REQUIRED_DOCS_PAGE_SIZE = 5

const RequiredDocumentsStep: React.FC<{
    value: RequiredDoc[]
    onChange: (v: RequiredDoc[]) => void
    onBack: () => void
    onNext: () => void
    backLabel?: string
    nextLabel?: string
    nextLoading?: boolean
    nextVisible?: boolean
}> = ({ value = [], onChange, onBack, onNext, backLabel = 'Back', nextLabel = 'Next', nextLoading = false, nextVisible = true }) => {
    // Normalised up front (not only in the effect below) so the first paint
    // already shows final values instead of correcting itself a frame later.
    const normalizeRows = (docs: RequiredDoc[]) =>
        (docs || []).map(r => ({
            ...r,
            isOnboarding: true as const,
            kind: r.kind ?? 'upload',
            // A missing flag means optional, as the compliance resolver reads it.
            // New rows still default to required in openAdd.
            requiredAtApplication: r.requiredAtApplication ?? false
        }))
    const [rows, setRows] = useState<RequiredDoc[]>(() => normalizeRows(value))
    const [page, setPage] = useState(1)
    const [docModalOpen, setDocModalOpen] = useState(false)
    const [editing, setEditing] = useState<RequiredDoc | null>(null)
    const [agreementTemplates, setAgreementTemplates] = useState<AgreementTemplate[]>([])
    const [form] = Form.useForm()

    const pageCount = Math.max(1, Math.ceil(rows.length / REQUIRED_DOCS_PAGE_SIZE))
    const currentPage = Math.min(page, pageCount)
    const pagedRows = rows.slice(
        (currentPage - 1) * REQUIRED_DOCS_PAGE_SIZE,
        currentPage * REQUIRED_DOCS_PAGE_SIZE
    )

    useEffect(() => {
        setRows(normalizeRows(value))
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
        setPage(Math.ceil(next.length / REQUIRED_DOCS_PAGE_SIZE))
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
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 16
                }}
            >
                <Space size={8}>
                    <Text strong>Required documents</Text>
                    <Tag style={{ marginInlineEnd: 0 }}>{rows.length}</Tag>
                </Space>
                <Button
                    data-guide='program-add-required-document'
                    type='primary'
                    shape='round'
                    icon={<PlusOutlined />}
                    onClick={openAdd}
                >
                    Add Document
                </Button>
            </div>

            <div data-guide='program-required-documents-table'>
                {rows.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No required documents yet' />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {pagedRows.map(r => (
                            <div
                                key={r.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 12,
                                    padding: '14px 16px',
                                    borderRadius: 12,
                                    border: '1px solid rgba(128,128,128,.25)'
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <Text strong>{r.title}</Text>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                                        <Tag color={r.kind === 'agreement' ? 'purple' : 'blue'} style={{ margin: 0 }}>
                                            {r.kind === 'agreement' ? 'Agreement' : 'Upload'}
                                        </Tag>
                                        <Tag color={r.requiredAtApplication ? 'green' : 'gold'} style={{ margin: 0 }}>
                                            {r.requiredAtApplication ? 'Required at application' : 'Optional at application'}
                                        </Tag>
                                        {r.hasExpiry && !r.expiryMonths ? (
                                            <Tooltip title='Edit this document and set how many months it stays valid.'>
                                                <Tag color='orange' style={{ margin: 0 }}>
                                                    Expiry period not set
                                                </Tag>
                                            </Tooltip>
                                        ) : r.hasExpiry ? (
                                            <Tag color='red' style={{ margin: 0 }}>
                                                Expires every {r.expiryMonths} mo
                                            </Tag>
                                        ) : (
                                            <Tag style={{ margin: 0 }}>No expiry</Tag>
                                        )}
                                    </div>
                                </div>

                                <Space size={8} style={{ flexShrink: 0 }}>
                                    <Button shape='circle' icon={<EditOutlined />} onClick={() => openEdit(r)} />
                                    <Popconfirm
                                        title='Remove this document?'
                                        description='SMEs will no longer be asked for it. Documents already uploaded are kept but stop counting towards compliance.'
                                        okText='Remove'
                                        okButtonProps={{ danger: true }}
                                        onConfirm={() => remove(r.id)}
                                    >
                                        <Button shape='circle' danger icon={<DeleteOutlined />} />
                                    </Popconfirm>
                                </Space>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                    <Pagination
                        size='small'
                        current={currentPage}
                        pageSize={REQUIRED_DOCS_PAGE_SIZE}
                        total={rows.length}
                        onChange={setPage}
                        showSizeChanger={false}
                        hideOnSinglePage
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <Button style={{ flex: 1 }} onClick={onBack}>{backLabel}</Button>
                <FadeInSlot show={nextVisible}>
                    <Button style={{ flex: 1 }} type='primary' loading={nextLoading} onClick={() => onNext()}>
                        {nextLabel}
                    </Button>
                </FadeInSlot>
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
                                    <InputNumber min={1} precision={0} style={{ width: '100%' }} />
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
    nextLoading = false,
    nextVisible = true,
    onDirty = () => { }
}) => {
    const [form] = Form.useForm()
    // Seeded from `value` so the cards render already ticked on the first paint
    // rather than popping in after the effect below runs.
    const [selectedCriteria, setSelectedCriteria] = useState<string[]>(() =>
        Object.keys(value || {})
    )

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
        // Hand the fresh result to the caller too -- `eligibility` state in the
        // parent won't have updated yet when a "save" handler runs right away.
        onNext(result)
    }

    const toggleCriterion = (key: string) => {
        const isSelected = selectedCriteria.includes(key)
        setSelectedCriteria(
            isSelected ? selectedCriteria.filter(c => c !== key) : [...selectedCriteria, key]
        )
        if (isSelected) form.resetFields([key])
        onDirty()
    }

    return (
        <Form
            layout='vertical'
            form={form}
            initialValues={value}
            style={{ marginTop: 8 }}
            onValuesChange={() => onDirty()}
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
                                    border: `1px solid ${isSelected ? 'var(--app-accent)' : 'var(--app-border)'}`,
                                    background: isSelected ? 'var(--app-accent-wash)' : 'var(--app-surface)',
                                    cursor: 'pointer',
                                    fontSize: 13,
                                    lineHeight: '18px',
                                    transition: 'all .15s ease',
                                    userSelect: 'none'
                                }}
                            >
                                <span
                                    style={{
                                        color: isSelected ? 'var(--app-accent)' : 'var(--app-text)',
                                        fontWeight: isSelected ? 500 : 400
                                    }}
                                >
                                    {opt.label}
                                </span>
                                <CheckCircleOutlined
                                    style={{ color: isSelected ? 'var(--app-accent)' : 'var(--app-border-strong)', fontSize: 14 }}
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
                <FadeInSlot show={nextVisible}>
                    <Button style={{ flex: 1 }} type='primary' loading={nextLoading} onClick={() => handleNext()}>
                        {nextLabel}
                    </Button>
                </FadeInSlot>
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

// Fades a flex child in/out; used for the edit wizard's Save button, which only
// appears once the user has actually changed something.
const FadeInSlot: React.FC<{ show: boolean; children: React.ReactNode }> = ({ show, children }) => (
    <AnimatePresence>
        {show && (
            <motion.div
                key='fade-slot'
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{ flex: 1, display: 'flex' }}
            >
                {children}
            </motion.div>
        )}
    </AnimatePresence>
)

const coverageCardStyle = (isSelected: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${isSelected ? 'var(--app-accent)' : 'var(--app-border)'}`,
    background: isSelected ? 'var(--app-accent-wash)' : 'var(--app-surface)',
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
        <span style={{ color: selected ? 'var(--app-accent)' : 'var(--app-text)', fontWeight: selected ? 500 : 400 }}>
            {label}
        </span>
        <CheckCircleOutlined style={{ color: selected ? 'var(--app-accent)' : 'var(--app-border-strong)', fontSize: 14 }} />
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
    nextVisible?: boolean
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
    nextLoading = false,
    nextVisible = true
}) => {
        const { isMultiBranch, supportedBranchIds, participatingDepartmentIds } = value

        const branchOptions = branches
            .filter(b => !userBranchId || b.id !== userBranchId)
            .map(b => ({ value: b.id, label: b.name || b.title || 'Branch' }))

        // Only departments that deliver interventions take part in a programme. One an older
        // programme already has stays listed (marked) so it can be removed, not just hidden.
        const departmentOptions = departments
            .filter(d => d.interventionsDepartment === true || participatingDepartmentIds.includes(d.id))
            .map(d => ({
                value: d.id,
                label: d.interventionsDepartment === true ? d.name : `${d.name} (doesn't deliver interventions)`
            }))

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
                    <FadeInSlot show={nextVisible}>
                        <Button style={{ flex: 1 }} type="primary" loading={nextLoading} onClick={handleNext}>
                            {nextLabel}
                        </Button>
                    </FadeInSlot>
                </div>
            </div>
        )
    }

/* ──────────────────────────────────────────────────────────────────
   EDIT: SECTION PICKER (jump straight to one part of the program
   instead of walking every step)
────────────────────────────────────────────────────────────────── */

const PROGRAM_EDIT_SECTIONS: { step: number; title: string; description: string; icon: React.ReactNode }[] = [
    { step: 0, title: 'Program details', description: 'Name, description, type, status, dates, funder and capacity', icon: <FileTextOutlined /> },
    { step: 1, title: 'Coverage', description: 'Branches and participating departments', icon: <ApartmentOutlined /> },
    { step: 2, title: 'Logo', description: 'Upload or replace the program logo', icon: <PictureOutlined /> },
    { step: 3, title: 'Eligibility', description: 'Who can apply to this program', icon: <CheckCircleOutlined /> },
    { step: 4, title: 'Required documents', description: 'Documents and agreements SMEs must provide', icon: <PaperClipOutlined /> },
    { step: 5, title: 'Onboarding questions', description: 'Questions asked when SMEs apply', icon: <QuestionCircleOutlined /> }
]

const SectionPickerStep: React.FC<{
    onSelect: (step: number) => void
    onSaveAndClose: () => void
    saving: boolean
    showSave: boolean
}> = ({ onSelect, onSaveAndClose, saving, showSave }) => (
    <div className='prg-sections'>
        <span className='prg-sections-title'>What would you like to edit?</span>
        <div className='prg-section-grid'>
            {PROGRAM_EDIT_SECTIONS.map(section => (
                <button key={section.step} type='button' className='prg-section' onClick={() => onSelect(section.step)}>
                    <span className='prg-section-icon' aria-hidden='true'>{section.icon}</span>
                    <span className='prg-section-text'>
                        <span className='prg-section-name'>{section.title}</span>
                        <span className='prg-section-desc'>{section.description}</span>
                    </span>
                    <RightOutlined className='prg-section-go' />
                </button>
            ))}
        </div>

        {showSave && (
            <Button block type='primary' shape='round' loading={saving} onClick={() => onSaveAndClose()} style={{ marginTop: 20 }}>
                Save changes
            </Button>
        )}
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
    nextVisible?: boolean
}> = ({ logoPreview, onPick, onBack, onNext, backLabel = 'Back', nextLabel = 'Next', nextLoading = false, nextVisible = true }) => {
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
                <FadeInSlot show={nextVisible}>
                    <Button style={{ flex: 1 }} type="primary" loading={nextLoading} onClick={handleNext}>
                        {nextLabel}
                    </Button>
                </FadeInSlot>
            </div>
        </div>
    )
}

const getProgramInitials = (name?: string) => {
    const words = (name || '').trim().split(/\s+/).filter(Boolean)
    if (!words.length) return '?'
    return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase()
}

// Logo when the program has one (and it loads), otherwise the name's initials.
const ProgramAvatar: React.FC<{ program: any; size?: number }> = ({ program, size = 40 }) => (
    <Avatar
        size={size}
        src={program?.logoUrl || undefined}
        style={{ background: '#e6efff', color: '#1d39c4', fontWeight: 600, flexShrink: 0 }}
    >
        {getProgramInitials(program?.name)}
    </Avatar>
)

type ProgramDetailsSection = 'overview' | 'coverage' | 'eligibility' | 'onboarding'

const PROGRAM_DETAIL_SECTIONS: { value: ProgramDetailsSection; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'coverage', label: 'Coverage' },
    { value: 'eligibility', label: 'Eligibility' },
    { value: 'onboarding', label: 'Onboarding' }
]

const formatProgramDate = (val: any) =>
    typeof val === 'string'
        ? val
        : val?.toDate
            ? dayjs(val.toDate()).format('YYYY-MM-DD')
            : 'N/A'

const ProgramDetailsBody: React.FC<{
    program: any
    section: ProgramDetailsSection
    branches: any[]
    departments: any[]
}> = ({ program, section, branches, departments }) => {
    if (section === 'overview') {
        return (
            <Descriptions bordered size='small' column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label='Description' span={2}>
                    {program.description || 'N/A'}
                </Descriptions.Item>
                <Descriptions.Item label='Type'>{displayProgramType(program.type) || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label='SMEs join by'>
                    {INTAKE_LABELS[program.intakeMode as ProgramIntakeMode] || 'Not set'}
                </Descriptions.Item>
                <Descriptions.Item label='Status'>
                    <Tag color={program.status === 'Active' ? 'green' : 'red'}>{program.status || 'N/A'}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label='Cohort Year'>{program.cohortYear ?? 'N/A'}</Descriptions.Item>
                <Descriptions.Item label='Max Capacity'>{program.maxCapacity || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label='Start Date'>{formatProgramDate(program.startDate)}</Descriptions.Item>
                <Descriptions.Item label='End Date'>{formatProgramDate(program.endDate)}</Descriptions.Item>
                <Descriptions.Item label='Funder'>{program.assignedFunder || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label='Registration Link'>
                    {program.registrationLink ? (
                        <Text copyable={{ text: window.location.origin + program.registrationLink }}>
                            Copy link
                        </Text>
                    ) : (
                        'N/A'
                    )}
                </Descriptions.Item>
            </Descriptions>
        )
    }

    if (section === 'coverage') {
        const branchNames: string[] = (program.supportedBranchIds || []).map(
            (id: string) => branches.find(b => b.id === id)?.name || id
        )
        const departmentNames: string[] = (program.participatingDepartmentIds || []).map(
            (id: string) => departments.find(d => d.id === id)?.name || id
        )
        return (
            <Descriptions bordered size='small' column={1}>
                <Descriptions.Item label='Scope'>
                    {program.isMultiBranch ? <Tag color='blue'>Multi-branch</Tag> : <Tag>Single branch</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label='Assigned Branch'>
                    {program.assignedBranch?.name ? (
                        <>
                            <b>{program.assignedBranch.name}</b>
                            {program.assignedBranch.email ? (
                                <div style={{ color: 'var(--app-text-muted)', fontSize: 13 }}>{program.assignedBranch.email}</div>
                            ) : null}
                        </>
                    ) : (
                        <Tag color='orange'>Not Assigned</Tag>
                    )}
                </Descriptions.Item>
                {program.isMultiBranch && (
                    <Descriptions.Item label='Supported Branches'>
                        {branchNames.length ? (
                            <Space size={[4, 4]} wrap>
                                {branchNames.map(n => (
                                    <Tag key={n}>{n}</Tag>
                                ))}
                            </Space>
                        ) : (
                            '—'
                        )}
                    </Descriptions.Item>
                )}
                <Descriptions.Item label='Participating Departments'>
                    {departmentNames.length ? (
                        <Space size={[4, 4]} wrap>
                            {departmentNames.map(n => (
                                <Tag key={n} color='geekblue'>
                                    {n}
                                </Tag>
                            ))}
                        </Space>
                    ) : (
                        'Not specified'
                    )}
                </Descriptions.Item>
            </Descriptions>
        )
    }

    if (section === 'eligibility') {
        const entries = Array.isArray(program.eligibilityCriteria)
            ? []
            : Object.entries(program.eligibilityCriteria || {})
        if (!entries.length) {
            return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No eligibility criteria set' />
        }
        return (
            <Descriptions bordered size='small' column={1}>
                {entries.map(([key, val]) => (
                    <Descriptions.Item key={key} label={CRITERIA_OPTIONS.find(o => o.value === key)?.label ?? key}>
                        {Array.isArray(val)
                            ? val.join(', ')
                            : OWNERSHIP_FIELDS.includes(key)
                                ? `${val}%`
                                : String(val)}
                    </Descriptions.Item>
                ))}
            </Descriptions>
        )
    }

    const docs: any[] = program.programRequirements || []
    const questions: any[] = program.onboardingQuestions || []
    const rowStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px solid rgba(128,128,128,.18)'
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
                <Text strong>Required documents</Text>
                {docs.length ? (
                    docs.map(d => (
                        <div key={d.id || d.key || d.title} style={rowStyle}>
                            <span>{d.title}</span>
                            <Space size={4} wrap style={{ justifyContent: 'flex-end' }}>
                                <Tag color={d.kind === 'agreement' ? 'purple' : 'blue'}>
                                    {d.kind === 'agreement' ? 'Agreement' : 'Upload'}
                                </Tag>
                                <Tag color={d.requiredAtApplication ? 'green' : 'gold'}>
                                    {d.requiredAtApplication ? 'Required' : 'Optional'}
                                </Tag>
                                {d.hasExpiry && d.expiryMonths ? <Tag>{d.expiryMonths} mo</Tag> : null}
                            </Space>
                        </div>
                    ))
                ) : (
                    <div style={{ marginTop: 8 }}>
                        <Text type='secondary'>No required documents.</Text>
                    </div>
                )}
            </div>
            <div>
                <Text strong>Onboarding questions</Text>
                {questions.length ? (
                    questions.map(q => (
                        <div key={q.id || q.label} style={rowStyle}>
                            <span>{q.label}</span>
                            <Tag color={q.type === 'dropdown' ? 'blue' : 'default'}>
                                {q.type === 'dropdown' ? 'Dropdown' : 'Text'}
                            </Tag>
                        </div>
                    ))
                ) : (
                    <div style={{ marginTop: 8 }}>
                        <Text type='secondary'>No onboarding questions.</Text>
                    </div>
                )}
            </div>
        </div>
    )
}

/* ──────────────────────────────────────────────────────────────────
   PROPOSAL DETAILS (opened by clicking a row / card)
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
    // Only the user/role lookup gates the page; branch and program data show skeletons.
    const dataLoading = branchesLoading || !initialProgramsLoaded
    const [logoFile, setLogoFile] = useState<File | null>(null)
    const [logoPreview, setLogoPreview] = useState<string | null>(null)


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
    // Edit wizard: true once the user changes anything, which reveals "Save Program".
    const [editDirty, setEditDirty] = useState(false)
    const markEditDirty = useCallback(() => setEditDirty(true), [])
    const handleEditRequiredDocsChange = useCallback((docs: RequiredDoc[]) => {
        setRequiredDocs(docs)
        setEditDirty(true)
    }, [])

    const [togglingProgramId, setTogglingProgramId] = useState<string | null>(
        null
    )
    const [saving, setSaving] = useState(false)
    const [searchText, setSearchText] = useState('')
    const [filteredStatus, setFilteredStatus] = useState<string>('Active')
    const [listPage, setListPage] = useState(1)
    const [editModalVisible, setEditModalVisible] = useState(false)
    const [selectedProgram, setSelectedProgram] = useState<any>(null)
    const [editForm] = Form.useForm()
    const [currentStep, setCurrentStep] = useState(0)
    const [basicDetails, setBasicDetails] = useState<any>({})
    const [questions, setQuestions] = useState<any[]>([])
    /** True while an opened programme's required documents are still loading; saving waits for it. */
    const [docsLoading, setDocsLoading] = useState(false)
    const editingIdRef = React.useRef<string | null>(null)
    const [questionModalOpen, setQuestionModalOpen] = useState(false)
    const [editingQuestion, setEditingQuestion] = useState<any>(null)
    const [branches, setBranches] = useState<any[]>([])
    const [userBranchId, setUserBranchId] = useState<string | null>(null)
    const { user } = useFullIdentity()
    const { modal } = App.useApp()
    const isMobile = !Grid.useBreakpoint().md
    const [detailsProgramId, setDetailsProgramId] = useState<string | null>(null)
    const [detailsSection, setDetailsSection] = useState<ProgramDetailsSection>('overview')

    const isProjectAdmin = user?.role === 'projectadmin'
    // Mirrors canManagePrograms() in firestore.rules; everyone else only reads.
    const canManagePrograms = ['projectadmin', 'operations', 'system_admin', 'superadmin'].includes(
        String(user?.role || '')
    )

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
            setPrograms(
                snap.docs.map(d => {
                    const data = d.data() as any
                    return { id: d.id, ...data, status: normalizeProgramStatus(data.status) }
                })
            )
        } catch {
            message.error('Failed to load programs')
        } finally {
            setProgramsLoading(false)
            setInitialProgramsLoaded(true)
        }
    }

    useEffect(() => {
        fetchPrograms()
        // The admin's limit (System settings); the default only until it loads.
        getProgramLimit()
            .then(setProgramLimit)
            .catch(() => setProgramLimit(DEFAULT_PROGRAM_LIMIT))
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

    const EMPTY_COVERAGE: ProgramCoverageValue = { isMultiBranch: false, supportedBranchIds: [], participatingDepartmentIds: [] }

    /** Everything the create/edit wizards hold, back to empty, so nothing leaks between programmes. */
    const resetWizard = () => {
        form.resetFields()
        editForm.resetFields()
        setBasicDetails({})
        setCurrentStep(0)
        setEligibility({})
        setRequiredDocs([])
        setQuestions([])
        setEditingQuestion(null)
        setCoverage(EMPTY_COVERAGE)
        setLogoFile(null)
        if (logoPreview && logoPreview.startsWith('blob:')) URL.revokeObjectURL(logoPreview)
        setLogoPreview(null)
        setEditDirty(false)
        setDocsLoading(false)
    }

    /** The programme's own branch: it is implied, so the coverage step only offers the others. */
    const homeBranchId = (): string | null =>
        (editModalVisible
            ? selectedProgram?.assignedBranch?.id || selectedProgram?.branchId
            : form.getFieldValue('branchId') || basicDetails?.branchId) || userBranchId || null

    const handleCoverageChange = (next: ProgramCoverageValue) => {
        setCoverage(next)
        setEditDirty(true)
        // The nearest-hub question lists the home hub too, not only the extra ones.
        const home = homeBranchId()
        const synced = upsertHubQuestion(
            questions,
            next.isMultiBranch ? Array.from(new Set([...(home ? [home] : []), ...next.supportedBranchIds])) : [],
            branches
        )
        setQuestions(synced)
    }

    const normalizeProgramRequirements = (docs: RequiredDoc[] = []) =>
        docs.map(d => ({
            id: d.id,
            key: requirementKey(d),
            // Older rows may be identified by a preset id; uploaded documents are
            // matched on it, so it must survive a save.
            ...(['presetId', 'preset', 'templateId'] as const).reduce<Record<string, string>>(
                (kept, field) => ((d as any)[field] ? { ...kept, [field]: (d as any)[field] } : kept),
                {}
            ),
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
                // A new programme's status comes from its dates: Upcoming until it starts.
                status: programStatusForDates(values.startDate, values.endDate),
                intakeMode: values.intakeMode || 'applications',
                // The layout hides programmes with isActive === false; Upcoming ones stay visible.
                isActive: true,
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
            const docRef = doc(collection(db, 'programs'))
            const batch = writeBatch(db)
            batch.set(docRef, {
                ...payload,
                id: docRef.id,
                registrationLink: `/registration?programId=${docRef.id}&role=sme`
            })
            await queueProgramRequiredDocs(batch, docRef.id, requiredDocs)
            await batch.commit()

            // upload logo AFTER we have a programId
            if (logoFile) {
                const uploaded = await uploadProgramLogo(docRef.id, logoFile, null)
                await updateDoc(docRef, uploaded)
            }

            message.success('Program added successfully')
            setModalVisible(false)
            resetWizard()
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
            if (!(values.participatingDepartmentIds || []).length) {
                message.error('Choose at least one participating department under Coverage.')
                setCurrentStep(1)
                return
            }
            if (docsLoading || editingIdRef.current !== selectedProgram.id) {
                message.info('Still loading this programme. Try again in a moment.')
                return
            }
            // Keep the existing branch if the form somehow has none (never null it).
            const assignedBranch = resolveAssignedBranch(values.branchId) || selectedProgram.assignedBranch || null
            const status = values.status || selectedProgram.status || 'Active'
            // The coverage step leaves out the home branch; keep it if the programme listed it.
            const home = selectedProgram.assignedBranch?.id || selectedProgram.branchId
            const supportedBranchIds =
                home && (selectedProgram.supportedBranchIds || []).includes(home) && Array.isArray(values.supportedBranchIds)
                    ? Array.from(new Set([home, ...values.supportedBranchIds]))
                    : values.supportedBranchIds
            const logoRemoved = !logoFile && !logoPreview && !!selectedProgram.logoUrl
            const rawPayload = {
                ...selectedProgram,
                ...values,
                status,
                isActive: status !== 'Inactive',
                supportedBranchIds,
                startDate: toTs(values.startDate) ?? selectedProgram.startDate ?? null,
                endDate: toTs(values.endDate) ?? selectedProgram.endDate ?? null,
                assignedBranch,
                eligibilityCriteria: values.eligibilityCriteria ?? eligibility,
                programRequirements: normalizeProgramRequirements(requiredDocs),
                ...(logoRemoved ? { logoUrl: null, logoPath: null } : {})
            }
            delete (rawPayload as any).branchId

            const payload = pruneUndefined(rawPayload)

            const batch = writeBatch(db)
            batch.update(doc(db, 'programs', selectedProgram.id), payload)
            await queueProgramRequiredDocs(batch, selectedProgram.id, requiredDocs)
            await batch.commit()

            if (logoRemoved && selectedProgram.logoPath) {
                try {
                    await deleteObject(ref(getStorage(), selectedProgram.logoPath))
                } catch {
                    // the file may already be gone
                }
            }

            if (logoFile) {
                const uploaded = await uploadProgramLogo(
                    selectedProgram.id,
                    logoFile,
                    selectedProgram.logoPath || null
                )
                await updateDoc(doc(db, 'programs', selectedProgram.id), uploaded)
            }

            message.success('Program updated successfully')
            setEditModalVisible(false)
            resetWizard()
            setCurrentStep(-1)
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
    const saveEditedProgram = async (overrides: Record<string, any> = {}) => {
        await handleUpdateProgram({
            ...editForm.getFieldsValue(true),
            ...coverage,
            onboardingQuestions: questions,
            eligibilityCriteria: eligibility,
            ...overrides
        })
    }

    const handleDeleteProgram = async (id: string) => {
        try {
            const linked = await getDocs(query(collection(db, 'applications'), where('programId', '==', id), limit(1)))
            if (!linked.empty) {
                message.warning('This program has applications or participants. Deactivate it instead of deleting it.')
                return
            }
            const program = programs.find(p => p.id === id)
            const docsSnap = await getDocs(collection(db, 'programs', id, 'requiredDocs'))
            await Promise.all(docsSnap.docs.map(d => deleteDoc(d.ref)))
            if (program?.logoPath) {
                try {
                    await deleteObject(ref(getStorage(), program.logoPath))
                } catch {
                    // the file may already be gone
                }
            }
            await deleteDoc(doc(db, 'programs', id))
            message.success('Program deleted successfully')
            fetchPrograms()
        } catch (err) {
            console.error(err)
            message.error('Failed to delete program')
        }
    }

    const openEditProgram = (record: any) => {
        resetWizard()
        editingIdRef.current = record.id
        setSelectedProgram(record)
        setLogoFile(null)
        setLogoPreview(record.logoUrl || null)

        editForm.setFieldsValue({
            ...record,
            branchId: record.assignedBranch?.id || record.branchId || null,
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
        // The coverage step only offers other branches; the home branch is added back on save.
        const home = record.assignedBranch?.id || record.branchId
        const recordSupportedBranchIds = (record.supportedBranchIds || []).filter(
            (id: string) => id !== home && (!userBranchId || id !== userBranchId)
        )
        setCoverage({
            isMultiBranch: !!record.isMultiBranch,
            supportedBranchIds: recordSupportedBranchIds,
            participatingDepartmentIds: record.participatingDepartmentIds || []
        })
        const syncedQuestions = upsertHubQuestion(
            record.onboardingQuestions || [],
            record.supportedBranchIds || [],
            branches
        )
        setQuestions(syncedQuestions)
        setEligibility(record.eligibilityCriteria || [])
        // Saving rewrites the requiredDocs subcollection from this list, so a save before it
        // arrives (or with another programme's list) would wipe or mix them. Guard both.
        const fallbackDocs = (record.programRequirements || []).map((r: any) => ({
            ...r,
            isOnboarding: true,
            kind: r.kind ?? 'upload'
        }))
        setRequiredDocs(fallbackDocs)
        // programRequirements is the source of truth. The requiredDocs mirror is
        // only read for older programmes that never had the array.
        setDocsLoading(!fallbackDocs.length)
        if (!fallbackDocs.length) fetchProgramRequiredDocs(record.id)
            .then(fromSub => {
                if (editingIdRef.current !== record.id) return
                if (fromSub.length) setRequiredDocs(fromSub)
            })
            .catch(err => console.error('Failed to load required documents', err))
            .finally(() => {
                if (editingIdRef.current === record.id) setDocsLoading(false)
            })
        setEditDirty(false)
        setEditModalVisible(true)
        setCurrentStep(-1)
    }

    /**
     * Deactivate (from Active / Upcoming / Completed) or reactivate (from Inactive).
     * isActive follows, because that's what the rest of the app filters on.
     */
    const toggleProgramStatus = (record: any) => {
        const deactivating = record.status !== 'Inactive'
        const newStatus = deactivating ? 'Inactive' : 'Active'
        setTogglingProgramId(record.id)
        updateDoc(doc(db, 'programs', record.id), { status: newStatus, isActive: !deactivating })
            .then(() => {
                message.success(deactivating ? 'Program deactivated' : 'Program reactivated')
                fetchPrograms()
            })
            .catch(err => {
                console.error(err)
                message.error(deactivating ? 'Could not deactivate the program' : 'Could not reactivate the program')
            })
            .finally(() => setTogglingProgramId(null))
    }

    const openProgramDetails = (record: any) => {
        setDetailsSection('overview')
        setDetailsProgramId(record.id)
    }

    const confirmDelete = (record: any) =>
        modal.confirm({
            title: `Delete ${record.name || 'this program'}?`,
            content: 'This cannot be undone. A program with applications or participants can only be deactivated.',
            okText: 'Delete',
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            centered: true,
            onOk: async () => {
                await handleDeleteProgram(record.id)
                setDetailsProgramId(current => (current === record.id ? null : current))
            }
        })

    /** Edit is the action; deactivating and deleting are rarer, so they sit in a menu. */
    const renderProgramActions = (record: any) => canManagePrograms && (
        <div className='prg-actions'>
            <Button type='primary' shape='round' icon={<EditOutlined />} onClick={() => openEditProgram(record)}>
                Edit
            </Button>
            <Dropdown
                trigger={['click']}
                menu={{
                    items: [
                        {
                            key: 'status',
                            icon: <PoweroffOutlined />,
                            label: record.status === 'Inactive' ? 'Reactivate' : 'Deactivate',
                            disabled: togglingProgramId === record.id
                        },
                        { type: 'divider' },
                        { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true }
                    ],
                    onClick: ({ key }) => (key === 'status' ? toggleProgramStatus(record) : confirmDelete(record))
                }}
            >
                <Button shape='circle' icon={<MoreOutlined />} aria-label='More actions' loading={togglingProgramId === record.id} />
            </Dropdown>
        </div>
    )

    const detailsProgram = programs.find(p => p.id === detailsProgramId) ?? null

    const STATUS_SEGMENTS = [
        { value: 'Active', label: 'Active', tone: 'success' },
        { value: 'Upcoming', label: 'Upcoming', tone: 'info' },
        { value: 'Completed', label: 'Completed', tone: 'neutral' },
        { value: 'Inactive', label: 'Inactive', tone: 'warning' },
        { value: 'all', label: 'All', tone: 'neutral' }
    ]
    const STATUS_PILL: Record<string, string> = { Active: 'success', Upcoming: 'info', Completed: 'neutral', Inactive: 'warning' }

    const searchedPrograms = scopedPrograms.filter(program =>
        `${program.name || ''} ${program.type || ''} ${program.assignedFunder || ''}`
            .toLowerCase()
            .includes(searchText.trim().toLowerCase())
    )
    const statusCounts = STATUS_SEGMENTS.reduce<Record<string, number>>((acc, segment) => {
        acc[segment.value] =
            segment.value === 'all'
                ? searchedPrograms.length
                : searchedPrograms.filter(p => (p.status || 'Active') === segment.value).length
        return acc
    }, {})
    const filteredPrograms = searchedPrograms
        .filter(p => filteredStatus === 'all' || (p.status || 'Active') === filteredStatus)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))

    const LIST_PAGE_SIZE = 12
    const pageRows = filteredPrograms.slice((listPage - 1) * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE)
    const atLimit = programs.length >= programLimit

    const selectProgram = (record: any) => {
        setDetailsSection('overview')
        setDetailsProgramId(record.id)
    }

    const programMeta = (p: any) =>
        [displayProgramType(p.type), p.assignedBranch?.name, `${formatProgramDate(p.startDate)} – ${formatProgramDate(p.endDate)}`]
            .filter(Boolean)
            .join(' · ')

    const renderDetailPanel = (p: any) => (
        <MotionCard>
            <div className='prg-detail'>
                <header className='prg-detail-head'>
                    <ProgramAvatar program={p} size={52} />
                    <div className='prg-detail-identity'>
                        <h2 className='prg-detail-name'>{p.name}</h2>
                        <div className='prg-detail-sub'>
                            <StatusPill tone={STATUS_PILL[p.status || 'Active'] || 'neutral'}>{p.status || 'Active'}</StatusPill>
                            {p.isMultiBranch && <StatusPill tone='info'>Multi-branch</StatusPill>}
                        </div>
                    </div>
                </header>
                {renderProgramActions(p)}
                {p.registrationLink && (
                    <div className='prg-link'>
                        <span className='prg-link-label'>Registration link</span>
                        <Text
                            className='prg-link-text'
                            ellipsis
                            copyable={{ text: window.location.origin + p.registrationLink, tooltips: ['Copy link', 'Copied'] }}
                        >
                            {window.location.origin + p.registrationLink}
                        </Text>
                    </div>
                )}
                <SetupSegmented<ProgramDetailsSection>
                    fullWidth
                    options={PROGRAM_DETAIL_SECTIONS}
                    value={detailsSection}
                    onChange={setDetailsSection}
                />
                <div className='prg-detail-body'>
                    <ProgramDetailsBody program={p} section={detailsSection} branches={branches} departments={departments} />
                </div>
            </div>
        </MotionCard>
    )

    return (
        <div className='ws-page'>
            <Helmet>
                <title>Incubation Programs | Smart Incubation Platform</title>
            </Helmet>

            {!userResolved ? (
                <DashboardLoader label='Getting your programs ready' />
            ) : (
                <>
                    <DashboardFilterBar>
                        <div className='ws-toolbar' data-guide='program-filters'>
                            <Segmented
                                data-guide='program-metrics'
                                className='ws-toolbar-status mv-status-strip'
                                block
                                value={filteredStatus}
                                onChange={value => {
                                    setFilteredStatus(String(value))
                                    setListPage(1)
                                }}
                                aria-label='Filter by status'
                                options={STATUS_SEGMENTS.map(segment => ({
                                    value: segment.value,
                                    label: (
                                        <span className='mv-seg'>
                                            {segment.label}
                                            {!dataLoading && (
                                                <span className={`mv-seg-count qtx-tone-${segment.tone}`}>{statusCounts[segment.value]}</span>
                                            )}
                                        </span>
                                    )
                                }))}
                            />
                            <Input
                                className='ws-toolbar-search'
                                allowClear
                                prefix={<SearchOutlined />}
                                placeholder='Search name, type or funder'
                                aria-label='Search programs'
                                value={searchText}
                                onChange={e => {
                                    setSearchText(e.target.value)
                                    setListPage(1)
                                }}
                            />
                            {canManagePrograms && <Tooltip
                                title={atLimit ? `Your organisation can have ${programLimit} program${programLimit === 1 ? '' : 's'}. Ask a system administrator to raise the limit.` : undefined}
                            >
                                <Button
                                    className='ws-toolbar-button'
                                    data-guide='add-program-action'
                                    type='primary'
                                    icon={<PlusOutlined />}
                                    disabled={atLimit}
                                    onClick={() => {
                                        resetWizard()
                                        setModalVisible(true)
                                    }}
                                >
                                    New program
                                </Button>
                            </Tooltip>}
                        </div>
                    </DashboardFilterBar>

                    <div className='ws-layout'>
                        <div data-guide='program-table'>
                            <MotionCard loading={dataLoading || programsLoading}>
                                {isProjectAdmin && scopedPrograms.length === 0 ? (
                                    <Empty
                                        className='ws-list-empty'
                                        description='No programs are set up for your branch yet. Ask head office or M&E to assign one.'
                                    />
                                ) : filteredPrograms.length === 0 ? (
                                    <Empty
                                        className='ws-list-empty'
                                        description={searchText ? 'No programs match.' : `No ${filteredStatus === 'all' ? '' : filteredStatus.toLowerCase() + ' '}programs.`}
                                    />
                                ) : (
                                    <>
                                        <div className='ws-rows' role='listbox' aria-label='Programs'>
                                            {pageRows.map(p => (
                                                <button
                                                    key={p.id}
                                                    type='button'
                                                    role='option'
                                                    aria-selected={p.id === detailsProgramId}
                                                    className={`ws-row${p.id === detailsProgramId ? ' is-selected' : ''}`}
                                                    onClick={() => selectProgram(p)}
                                                >
                                                    <ProgramAvatar program={p} size={36} />
                                                    <div className='ws-row-main'>
                                                        <div className='ws-row-name'>{p.name || 'Untitled program'}</div>
                                                        <div className='ws-row-meta'>{programMeta(p)}</div>
                                                    </div>
                                                    <div className='ws-row-side'>
                                                        <StatusPill tone={STATUS_PILL[p.status || 'Active'] || 'neutral'}>{p.status || 'Active'}</StatusPill>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                        {filteredPrograms.length > LIST_PAGE_SIZE && (
                                            <div className='ws-pagination'>
                                                <Pagination
                                                    size='small'
                                                    current={listPage}
                                                    pageSize={LIST_PAGE_SIZE}
                                                    total={filteredPrograms.length}
                                                    onChange={setListPage}
                                                    showSizeChanger={false}
                                                    showLessItems
                                                />
                                            </div>
                                        )}
                                    </>
                                )}
                            </MotionCard>
                        </div>
                        {!isMobile && (
                            <div className='ws-detail-sticky'>
                                {detailsProgram ? (
                                    renderDetailPanel(detailsProgram)
                                ) : (
                                    <MotionCard>
                                        <Empty className='ws-detail-empty' description='Select a program to see it here.' />
                                    </MotionCard>
                                )}
                            </div>
                        )}
                    </div>

                    {isMobile && (
                        <Drawer
                            className='ws-drawer ws-sheet'
                            open={!!detailsProgram}
                            onClose={() => setDetailsProgramId(null)}
                            placement='bottom'
                            height='92vh'
                            title={detailsProgram?.name || 'Program'}
                        >
                            {detailsProgram && renderDetailPanel(detailsProgram)}
                        </Drawer>
                    )}

                                {/* CREATE */}
                                <Modal
                                    className='guide-program-modal'
                                    centered
                                    open={modalVisible}
                                    title='Add New Program'
                                    onCancel={() => {
                                        setModalVisible(false)
                                        resetWizard()
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

                                    <>
                                        <motion.div
                                            key={currentStep}
                                            initial={{ y: 8 }}
                                            animate={{ y: 0 }}
                                            transition={{ duration: 0.2 }}
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
                                                                                words >= 100 ? '#ff4d4f' : 'var(--app-text-muted)'
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
                                                            {/* A new programme's status follows its dates (Upcoming before it starts). */}
                                                            <Form.Item noStyle shouldUpdate={(prev, next) => prev.startDate !== next.startDate || prev.endDate !== next.endDate}>
                                                                {({ getFieldValue }) => {
                                                                    const status = programStatusForDates(getFieldValue('startDate'), getFieldValue('endDate'))
                                                                    return (
                                                                        <Form.Item label='Status' tooltip='Set from the start and end dates. You can change it later.'>
                                                                            <div className='prg-status-auto'>
                                                                                <StatusPill tone={status === 'Upcoming' ? 'info' : status === 'Completed' ? 'neutral' : 'success'}>
                                                                                    {status}
                                                                                </StatusPill>
                                                                                <span>{status === 'Upcoming' ? 'until the start date' : 'from the dates'}</span>
                                                                            </div>
                                                                        </Form.Item>
                                                                    )
                                                                }}
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>

                                                    <Form.Item
                                                        name='intakeMode'
                                                        label='How will SMEs join?'
                                                        initialValue='applications'
                                                        rules={[{ required: true, message: 'Choose how SMEs join' }]}
                                                    >
                                                        <ChoiceCards<ProgramIntakeMode>
                                                            compact
                                                            label='How will SMEs join?'
                                                            columns={3}
                                                            options={INTAKE_OPTIONS()}
                                                        />
                                                    </Form.Item>

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
                                                                dependencies={['startDate']}
                                                                rules={[
                                                                    { required: true, message: 'Please select an end date' },
                                                                    ({ getFieldValue }) => ({
                                                                        validator: (_, value) => {
                                                                            const start = getFieldValue('startDate')
                                                                            return !value || !start || dayjs(value).isAfter(dayjs(start))
                                                                                ? Promise.resolve()
                                                                                : Promise.reject(new Error('The end date must be after the start date'))
                                                                        }
                                                                    })
                                                                ]}
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
                                    </>
                                </Modal>

                                {/* EDIT */}
                                <Modal
                                    className='guide-program-modal'
                                    centered
                                    open={editModalVisible}
                                    title='Edit Program'
                                    onCancel={() => {
                                        setEditModalVisible(false)
                                        editingIdRef.current = null
                                        resetWizard()
                                        setCurrentStep(-1)
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

                                    <>
                                        <motion.div
                                            key={currentStep}
                                            initial={{ y: 8 }}
                                            animate={{ y: 0 }}
                                            transition={{ duration: 0.2 }}
                                        >
                                            {currentStep === -1 && (
                                                <SectionPickerStep
                                                    onSelect={setCurrentStep}
                                                    onSaveAndClose={() => saveEditedProgram()}
                                                    saving={saving}
                                                    showSave={editDirty}
                                                />
                                            )}
                                            {currentStep === 0 && (
                                                <Form data-guide='program-basic-details'
                                                    layout='vertical'
                                                    form={editForm}
                                                    onValuesChange={() => setEditDirty(true)}
                                                    onFinish={() => saveEditedProgram()}
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
                                                                    const words = (value || '').trim().split(/\s+/).filter(Boolean).length
                                                                    return words < 100
                                                                        ? Promise.resolve()
                                                                        : Promise.reject(new Error(`Please keep it under 100 words (currently ${words}).`))
                                                                }
                                                            }
                                                        ]}
                                                    >
                                                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} />
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

                                                    <Form.Item name='intakeMode' label='How will SMEs join?'>
                                                        <ChoiceCards<ProgramIntakeMode>
                                                            compact
                                                            label='How will SMEs join?'
                                                            columns={3}
                                                            options={INTAKE_OPTIONS()}
                                                        />
                                                    </Form.Item>

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
                                                                dependencies={['startDate']}
                                                                rules={[
                                                                    { required: true, message: 'Please select an end date' },
                                                                    ({ getFieldValue }) => ({
                                                                        validator: (_, value) => {
                                                                            const start = getFieldValue('startDate')
                                                                            return !value || !start || dayjs(value).isAfter(dayjs(start))
                                                                                ? Promise.resolve()
                                                                                : Promise.reject(new Error('The end date must be after the start date'))
                                                                        }
                                                                    })
                                                                ]}
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
                                                                <InputNumber style={{ width: '100%' }} min={0} step={1} precision={0} />
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
                                                        <FadeInSlot show={editDirty}>
                                                            <Button
                                                                style={{ flex: 1 }}
                                                                type='primary'
                                                                htmlType='submit'
                                                                loading={saving}
                                                            >
                                                                Save Program
                                                            </Button>
                                                        </FadeInSlot>
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
                                                    onNext={() => saveEditedProgram()}
                                                    backLabel='Back to Sections'
                                                    nextLabel='Save Program'
                                                    nextLoading={saving}
                                                    nextVisible={editDirty}
                                                />
                                            )}

                                            {currentStep === 2 && (
                                                <ProgramLogoStep
                                                    logoPreview={logoPreview}
                                                    onPick={(file, preview) => {
                                                        if (logoPreview && logoPreview.startsWith('blob:')) URL.revokeObjectURL(logoPreview)
                                                        setLogoFile(file)
                                                        setLogoPreview(preview)
                                                        setEditDirty(true)
                                                    }}
                                                    onBack={() => setCurrentStep(-1)}
                                                    onNext={() => saveEditedProgram()}
                                                    backLabel='Back to Sections'
                                                    nextLabel='Save Program'
                                                    nextLoading={saving}
                                                    nextVisible={editDirty}
                                                />
                                            )}

                                            {currentStep === 3 && (
                                                <EligibilityCriteriaStep
                                                    value={eligibility}
                                                    onChange={setEligibility}
                                                    onBack={() => setCurrentStep(-1)}
                                                    onNext={(result: Record<string, any>) =>
                                                        saveEditedProgram({ eligibilityCriteria: result })
                                                    }
                                                    onDirty={markEditDirty}
                                                    backLabel='Back to Sections'
                                                    nextLabel='Save Program'
                                                    nextLoading={saving}
                                                    nextVisible={editDirty}
                                                />
                                            )}
                                            {currentStep === 4 && (
                                                <div data-guide='program-required-documents-step'>
                                                    <RequiredDocumentsStep
                                                        value={requiredDocs}
                                                        onChange={handleEditRequiredDocsChange}
                                                        onBack={() => setCurrentStep(-1)}
                                                        onNext={() => saveEditedProgram()}
                                                        backLabel='Back to Sections'
                                                        nextLabel='Save Program'
                                                        nextLoading={saving}
                                                        nextVisible={editDirty}
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
                                                        onDelete={(id: string) => {
                                                            setQuestions(
                                                                questions.filter(
                                                                    q => q.id !== id || q.systemKey === 'nearestHub'
                                                                )
                                                            )
                                                            setEditDirty(true)
                                                        }}
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
                                                            setEditDirty(true)
                                                        }}
                                                        onCancel={() => setQuestionModalOpen(false)}
                                                    />
                                                    <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
                                                        <Button style={{ flex: 1 }} onClick={() => setCurrentStep(-1)}>Back to Sections</Button>
                                                        <FadeInSlot show={editDirty}>
                                                            <Button
                                                                style={{ flex: 1 }}
                                                                type='primary'
                                                                loading={saving}
                                                                onClick={() => saveEditedProgram()}
                                                            >
                                                                Save Program
                                                            </Button>
                                                        </FadeInSlot>
                                                    </div>
                                                </>
                                            )}
                                        </motion.div>
                                    </>
                                </Modal>
                </>
            )}
        </div>
    )
}

export default ProgramManager
