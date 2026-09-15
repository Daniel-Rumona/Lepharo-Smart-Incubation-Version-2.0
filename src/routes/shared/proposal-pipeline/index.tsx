import { Fragment, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
    Alert, AutoComplete, Avatar, Badge, Button, Checkbox, Col, DatePicker, Descriptions, Divider,
    Empty, Form, Input, InputNumber, List, Modal, Popconfirm, Progress,
    Row, Segmented, Select, Space, Spin, Steps, Table, Tag, Timeline, Tooltip,
    Typography, Upload, message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    ArrowLeftOutlined, ArrowRightOutlined, BankOutlined, CheckCircleFilled, ClockCircleOutlined,
    DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, FileAddOutlined,
    FileTextOutlined, GlobalOutlined, PlusOutlined, SafetyCertificateOutlined,
    SearchOutlined, TeamOutlined, UploadOutlined, UserOutlined, WarningFilled
} from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { branchService } from '@/services/branchService'
import { departmentService } from '@/services/departmentService'
import {
    changeProposalStatus, createProposal, deleteProposalDocument,
    listProposalContributors, listProposalDocuments, listProposalHistory, listenToProposals,
    updateProposal, uploadProposalDocument
} from '@/services/proposalService'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import {
    PROPOSAL_CATEGORIES, PROPOSAL_OWNER_TYPES, PROPOSAL_SCOPES, PROPOSAL_STAGE_GROUPS, PROPOSAL_STATUSES
} from '@/types/proposal'
import type {
    Proposal, ProposalActor, ProposalContributor, ProposalDocument, ProposalHistoryEntry,
    ProposalInput, ProposalOwner, ProposalOwnerType, ProposalReference, ProposalStatus
} from '@/types/proposal'
import './proposal-pipeline.css'

const { Title, Text } = Typography

const money = (value: number) =>
    new Intl.NumberFormat('en-ZA', {
        style: 'currency', currency: 'ZAR', maximumFractionDigits: 0
    }).format(Number(value || 0))

const dateLabel = (value: any) => {
    if (!value) return 'Not recorded'
    const date = value?.toDate?.() || value
    return dayjs(date).isValid() ? dayjs(date).format('DD MMM YYYY, HH:mm') : 'Not recorded'
}

const datePickerValue = (value: Proposal['proposedDate']) => {
    if (!value) return null
    const resolved = typeof (value as any)?.toDate === 'function'
        ? (value as any).toDate()
        : value
    return dayjs(resolved)
}

const statusColor: Record<ProposalStatus, string> = {
    Draft: 'default',
    'In preparation': 'cyan',
    Submitted: 'blue',
    'Under review': 'purple',
    Accepted: 'green',
    'SLA signed': 'green',
    'Awaiting order number': 'orange',
    'Implementation planning': 'gold',
    'Ready for activation': 'lime',
    Active: 'success',
    Rejected: 'red',
    Archived: 'default'
}

const actorFromIdentity = (identity: any): ProposalActor | null => {
    if (!identity?.id) return null
    const branch = identity.assignedBranch
    return {
        id: identity.id,
        name: identity.name || identity.fullName || identity.email || 'Smart Inc user',
        email: identity.email || null,
        role: identity.role || null,
        branchId: typeof branch === 'string'
            ? branch
            : branch?.id || identity.branchId || null
    }
}

const STATUS_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
    Draft: ['In preparation', 'Submitted', 'Archived'],
    'In preparation': ['Draft', 'Submitted', 'Archived'],
    Submitted: ['Under review', 'Accepted', 'Rejected', 'Archived'],
    'Under review': ['In preparation', 'Accepted', 'Rejected', 'Archived'],
    Accepted: ['SLA signed', 'Rejected', 'Archived'],
    'SLA signed': ['Awaiting order number', 'Implementation planning', 'Archived'],
    'Awaiting order number': ['Implementation planning', 'Archived'],
    'Implementation planning': ['Ready for activation', 'Archived'],
    'Ready for activation': ['Active', 'Implementation planning', 'Archived'],
    Active: ['Archived'],
    Rejected: ['In preparation', 'Archived'],
    Archived: ['Draft']
}

const nextStatuses = (current: ProposalStatus) => STATUS_TRANSITIONS[current]

// The forward move for the row "Advance" action. Each target is also an
// allowed transition above; Rejected proposals re-open into preparation.
const ADVANCE_TO: Partial<Record<ProposalStatus, ProposalStatus>> = {
    Draft: 'In preparation',
    'In preparation': 'Submitted',
    Submitted: 'Under review',
    'Under review': 'Accepted',
    Accepted: 'SLA signed',
    'SLA signed': 'Awaiting order number',
    'Awaiting order number': 'Implementation planning',
    'Implementation planning': 'Ready for activation',
    'Ready for activation': 'Active',
    Rejected: 'In preparation'
}

const ownerIcon = (type?: ProposalOwnerType) =>
    type === 'Department' ? <TeamOutlined /> : type === 'Centre' ? <BankOutlined /> : <UserOutlined />

const PROPOSAL_FORM_STEPS = [
    {
        title: 'Proposal and client',
        icon: <FileTextOutlined />,
        description: 'What is being proposed, to whom, and what it is worth.',
        fields: ['title', 'estimatedValue', 'clientName', 'category', 'clientContact', 'clientEmail']
    },
    {
        title: 'Ownership and timeline',
        icon: <UserOutlined />,
        description: 'Who leads the proposal and when it is due.',
        fields: [
            'originatorName', 'ownerType', 'ownerName', 'ownerDepartmentId', 'ownerCentreId',
            'proposedDate', 'submissionDeadline', 'status'
        ]
    },
    {
        title: 'Scope and footprint',
        icon: <GlobalOutlined />,
        description: 'Where the work will be delivered and which departments take part.',
        fields: ['scope', 'province', 'centres', 'departments']
    },
    {
        title: 'Summary and documents',
        icon: <UploadOutlined />,
        description: 'Add context, contributors and any supporting files.',
        fields: ['description', 'contributorIds']
    }
]

const PROPOSAL_DOCUMENT_CATEGORIES = [
    { key: 'Proposal', description: 'The proposal or bid document itself' },
    { key: 'Financial', description: 'Budgets, quotations and pricing schedules' },
    { key: 'Compliance', description: 'Registration, tax and regulatory certificates' },
    { key: 'Agreement', description: 'SLAs, contracts and signed agreements' },
    { key: 'Evidence', description: 'Any other supporting evidence' }
]

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

type PendingDocument = { category: string; file: File }

/**
 * Documents grouped by category, used both when creating/editing a proposal
 * (pending files, uploaded on save) and in the details view (uploaded now).
 * Documents saved under a category outside the list, such as older
 * "Supporting document" uploads, appear in an "Other" group.
 */
const DocumentCategoryRows = ({
    documents = [],
    pendingFiles = [],
    onAdd,
    onRemovePending,
    renderDocumentActions
}: {
    documents?: ProposalDocument[]
    pendingFiles?: PendingDocument[]
    onAdd: (category: string, file: File) => void
    onRemovePending?: (pending: PendingDocument) => void
    renderDocumentActions: (document: ProposalDocument) => React.ReactNode
}) => {
    const knownCategories = PROPOSAL_DOCUMENT_CATEGORIES.map(category => category.key)
    const otherDocuments = documents.filter(document => !knownCategories.includes(document.category))
    const rows = [
        ...PROPOSAL_DOCUMENT_CATEGORIES.map(category => ({
            ...category,
            canUpload: true,
            documents: documents.filter(document => document.category === category.key)
        })),
        ...(otherDocuments.length
            ? [{ key: 'Other', description: 'Earlier uploads without a category', canUpload: false, documents: otherDocuments }]
            : [])
    ]

    return <div className='proposal-document-rows'>
        {rows.map(row => {
            const pending = pendingFiles.filter(item => item.category === row.key)
            const count = row.documents.length + pending.length
            return <div className='proposal-document-row' key={row.key}>
                <div className='proposal-document-row-head'>
                    <span className='proposal-document-row-icon'><FileTextOutlined /></span>
                    <span className='proposal-document-row-copy'>
                        <strong>{row.key}{count > 0 && <Badge count={count} size='small' className='proposal-document-count' />}</strong>
                        <small>{row.description}</small>
                    </span>
                    {row.canUpload && <Upload multiple showUploadList={false}
                        beforeUpload={file => {
                            if (file.size > MAX_DOCUMENT_BYTES) {
                                message.error(`${file.name} is larger than the 25 MB limit.`)
                                return Upload.LIST_IGNORE
                            }
                            onAdd(row.key, file as File)
                            return false
                        }}>
                        <Button size='small' icon={<UploadOutlined />}>Add</Button>
                    </Upload>}
                </div>
                {count > 0 && <ul className='proposal-document-files'>
                    {row.documents.map(document => <li key={document.id}>
                        <span className='proposal-document-file-name' title={document.name}>{document.name}</span>
                        <span className='proposal-document-file-meta'>{dateLabel(document.uploadedAt)}</span>
                        <Space size={4}>{renderDocumentActions(document)}</Space>
                    </li>)}
                    {pending.map(item => <li key={`${item.file.name}-${item.file.size}`}>
                        <span className='proposal-document-file-name' title={item.file.name}>{item.file.name}</span>
                        <Tag color='gold'>Uploads on save</Tag>
                        {onRemovePending && <Button size='small' type='text' danger icon={<DeleteOutlined />}
                            aria-label={`Remove ${item.file.name}`} onClick={() => onRemovePending(item)} />}
                    </li>)}
                </ul>}
            </div>
        })}
    </div>
}

// Step index for the edit modal's opening section picker.
const EDIT_SECTION_PICKER = -1

const ProposalStepHeading = ({ index }: { index: number }) => (
    <div className='proposal-form-step-heading'>
        <strong>{PROPOSAL_FORM_STEPS[index].title}</strong>
        <span>{PROPOSAL_FORM_STEPS[index].description}</span>
    </div>
)

export default function ProposalPipeline() {
    const { actor: signedInActor } = useFullIdentity()
    const actor = useMemo(() => actorFromIdentity(signedInActor), [signedInActor])
    const isIncubatee = actor?.role?.trim().toLowerCase() === 'incubatee'
    const [proposals, setProposals] = useState<Proposal[]>([])
    const [branches, setBranches] = useState<ProposalReference[]>([])
    const [departments, setDepartments] = useState<ProposalReference[]>([])
    const [people, setPeople] = useState<ProposalContributor[]>([])
    const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([])
    const [editDocuments, setEditDocuments] = useState<ProposalDocument[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [referenceWarning, setReferenceWarning] = useState('')
    const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null)
    const [documents, setDocuments] = useState<ProposalDocument[]>([])
    const [history, setHistory] = useState<ProposalHistoryEntry[]>([])
    const [detailsLoading, setDetailsLoading] = useState(false)
    const [detailsOpen, setDetailsOpen] = useState(false)
    const [detailsSection, setDetailsSection] = useState('overview')
    const [proposalModalOpen, setProposalModalOpen] = useState(false)
    const [proposalStep, setProposalStep] = useState(0)
    const [statusProposal, setStatusProposal] = useState<Proposal | null>(null)
    const [activationOpen, setActivationOpen] = useState(false)
    const [editingProposal, setEditingProposal] = useState<Proposal | null>(null)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('All')
    const [form] = Form.useForm()
    const [statusForm] = Form.useForm()
    const selectedScope = Form.useWatch('scope', form)
    const selectedProvince = Form.useWatch('province', form)
    const allCentres = Form.useWatch('allCentres', form)
    const allDepartments = Form.useWatch('allDepartments', form)
    const ownerType: ProposalOwnerType = Form.useWatch('ownerType', form) || 'Individual'

    useEffect(() => {
        if (!actor || isIncubatee) {
            setProposals([])
            setLoading(false)
            return
        }
        setLoading(true)
        return listenToProposals(
            actor,
            records => {
                setProposals(records)
                setSelectedProposal(current =>
                    current ? records.find(record => record.id === current.id) || current : current
                )
                setLoading(false)
            },
            error => {
                console.error('[ProposalPipeline] Failed to load proposals', error)
                message.error('Could not load the proposal pipeline.')
                setLoading(false)
            }
        )
    }, [actor, isIncubatee])

    useEffect(() => {
        if (!actor || isIncubatee) return
        Promise.all([
            branchService.getAllBranches(),
            departmentService.getAllDepartments(),
            listProposalContributors()
        ]).then(([branchRecords, departmentRecords, contributorRecords]) => {
            setBranches(branchRecords.map(branch => ({
                id: branch.id,
                name: branch.name,
                province: branch.location?.province || null
            })))
            setDepartments(departmentRecords.map(department => ({
                id: department.id, name: department.name
            })))
            setPeople(contributorRecords)
        }).catch(error => {
            console.error('[ProposalPipeline] Reference data load failed', error)
            setReferenceWarning('Centres or departments could not be loaded. Existing proposals remain available.')
        })
    }, [actor, isIncubatee])

    const provinces = useMemo(() => Array.from(new Set(
        branches.map(branch => branch.province).filter(Boolean) as string[]
    )).sort(), [branches])

    const selectableCentres = useMemo(() => {
        if (selectedScope === 'Provincial') {
            return branches.filter(branch => branch.province === selectedProvince)
        }
        return branches
    }, [branches, selectedProvince, selectedScope])

    const contributorOptions = useMemo(() => people.map(person => ({
        value: person.id || person.email || person.name,
        label: `${person.name}${person.email ? ` · ${person.email}` : ''}`
    })), [people])

    const visibleProposals = useMemo(() => {
        const queryText = search.trim().toLowerCase()
        return proposals.filter(proposal => {
            const matchesQuery = !queryText ||
                `${proposal.proposalNumber} ${proposal.title} ${proposal.clientName} ${proposal.owner.name}`
                    .toLowerCase().includes(queryText)
            const stageMatches =
                statusFilter === 'Draft'
                    ? ['Draft', 'In preparation'].includes(proposal.status)
                    : statusFilter === 'Accepted'
                        ? ['Accepted', 'SLA signed'].includes(proposal.status)
                        : statusFilter === 'Activation'
                            ? ['Awaiting order number', 'Implementation planning', 'Ready for activation', 'Active']
                                .includes(proposal.status)
                            : proposal.status === statusFilter
            return matchesQuery && (statusFilter === 'All' || stageMatches)
        })
    }, [proposals, search, statusFilter])

    const metrics = useMemo(() => {
        const acceptedStatuses = [
            'Accepted', 'SLA signed', 'Awaiting order number',
            'Implementation planning', 'Ready for activation', 'Active'
        ]
        const value = proposals.reduce((total, item) => total + Number(item.estimatedValue || 0), 0)
        const accepted = proposals.filter(item => acceptedStatuses.includes(item.status)).length
        const submitted = proposals.filter(item =>
            !['Draft', 'In preparation', 'Rejected', 'Archived'].includes(item.status)
        ).length
        return {
            value,
            open: proposals.filter(item => !['Active', 'Rejected', 'Archived'].includes(item.status)).length,
            conversion: submitted ? Math.round((accepted / submitted) * 100) : 0,
            activation: proposals.filter(item =>
                acceptedStatuses.includes(item.status) && item.status !== 'Active'
            ).length
        }
    }, [proposals])

    const stageCards = useMemo(() => {
        return PROPOSAL_STAGE_GROUPS.map(definition => {
            const records = proposals.filter(item => definition.statuses.includes(item.status))
            return {
                ...definition,
                count: records.length,
                value: records.reduce((total, item) => total + Number(item.estimatedValue || 0), 0)
            }
        })
    }, [proposals])

    const refreshDetails = async (proposal: Proposal) => {
        setDetailsLoading(true)
        try {
            const [documentRecords, historyRecords] = await Promise.all([
                listProposalDocuments(proposal),
                listProposalHistory(proposal.id)
            ])
            setDocuments(documentRecords)
            setHistory(historyRecords)
        } catch (error) {
            console.error('[ProposalPipeline] Detail load failed', error)
            message.error('Some proposal details could not be loaded.')
        } finally {
            setDetailsLoading(false)
        }
    }

    const openDetails = (proposal: Proposal) => {
        setSelectedProposal(proposal)
        setDetailsSection('overview')
        setDetailsOpen(true)
        refreshDetails(proposal)
    }

    const openCreate = () => {
        setEditingProposal(null)
        setProposalStep(0)
        setPendingDocuments([])
        setEditDocuments([])
        form.resetFields()
        form.setFieldsValue({
            category: 'RFP',
            scope: 'Centre-specific',
            status: 'Draft',
            centres: actor?.branchId ? [actor.branchId] : [],
            province: null,
            allCentres: false,
            allDepartments: false,
            departments: [],
            contributorIds: [],
            proposedDate: dayjs(),
            originatorName: actor?.name,
            ownerType: 'Individual',
            ownerName: actor?.name
        })
        setProposalModalOpen(true)
    }

    const openEdit = (proposal: Proposal) => {
        setEditingProposal(proposal)
        setProposalStep(EDIT_SECTION_PICKER)
        setDetailsOpen(false)
        setPendingDocuments([])
        setEditDocuments([])
        listProposalDocuments(proposal).then(setEditDocuments).catch(error =>
            console.error('[ProposalPipeline] Could not load documents for editing', error))
        form.resetFields()
        const proposalProvince = proposal.province ||
            branches.find(branch => branch.id === proposal.centres[0]?.id)?.province || null
        const eligibleCentreCount = proposal.scope === 'National'
            ? branches.length
            : branches.filter(branch => branch.province === proposalProvince).length
        const selectsAllCentres = proposal.allCentres === true ||
            (['National', 'Provincial'].includes(proposal.scope) && eligibleCentreCount > 0 &&
                proposal.centres.length === eligibleCentreCount)
        const selectsAllDepartments = proposal.allDepartments === true ||
            (departments.length > 0 && proposal.departments.length === departments.length)
        form.setFieldsValue({
            title: proposal.title,
            clientName: proposal.clientName,
            clientContact: proposal.clientContact,
            clientEmail: proposal.clientEmail,
            category: proposal.category,
            scope: proposal.scope,
            province: proposalProvince,
            allCentres: selectsAllCentres,
            allDepartments: selectsAllDepartments,
            estimatedValue: proposal.estimatedValue,
            status: proposal.status,
            description: proposal.description,
            originatorName: proposal.originator.name,
            ownerType: proposal.owner.type || 'Individual',
            ownerName: proposal.owner.type === 'Individual' || !proposal.owner.type
                ? proposal.owner.name
                : undefined,
            ownerDepartmentId: proposal.owner.type === 'Department' ? proposal.owner.id : undefined,
            ownerCentreId: proposal.owner.type === 'Centre' ? proposal.owner.id : undefined,
            centres: proposal.centres.map(item => item.id),
            departments: proposal.departments.map(item => item.id),
            proposedDate: datePickerValue(proposal.proposedDate),
            submissionDeadline: datePickerValue(proposal.submissionDeadline),
            contributorIds: proposal.contributors.map(person =>
                person.id || people.find(candidate =>
                    candidate.email === person.email || candidate.name === person.name
                )?.id
            ).filter(Boolean)
        })
        setProposalModalOpen(true)
    }

    const handleScopeChange = (scope: Proposal['scope']) => {
        if (scope === 'National') {
            form.setFieldsValue({
                province: null,
                allCentres: true,
                centres: branches.map(branch => branch.id)
            })
            return
        }
        if (scope === 'Provincial') {
            form.setFieldsValue({ province: null, allCentres: true, centres: [] })
            return
        }
        form.setFieldsValue({
            province: null,
            allCentres: false,
            centres: actor?.branchId ? [actor.branchId] : []
        })
    }

    const handleProvinceChange = (province: string) => {
        const provinceCentres = branches.filter(branch => branch.province === province)
        form.setFieldsValue({
            province,
            allCentres: true,
            centres: provinceCentres.map(branch => branch.id)
        })
    }

    const handleAllCentresChange = (checked: boolean) => {
        form.setFieldValue('allCentres', checked)
        if (checked) {
            form.setFieldValue('centres', selectableCentres.map(branch => branch.id))
        }
    }

    const handleAllDepartmentsChange = (checked: boolean) => {
        form.setFieldValue('allDepartments', checked)
        if (checked) {
            form.setFieldValue('departments', departments.map(department => department.id))
        }
    }

    const referencesFromIds = (ids: string[] | undefined, options: ProposalReference[]) =>
        (ids || []).map(id => options.find(option => option.id === id) || { id, name: id })

    const isLastProposalStep = proposalStep === PROPOSAL_FORM_STEPS.length - 1

    const goToPreviousStep = () => {
        if (proposalStep === 0) {
            setProposalModalOpen(false)
            return
        }
        setProposalStep(step => step - 1)
    }

    const goToNextStep = async () => {
        if (isLastProposalStep) {
            await saveProposal()
            return
        }
        try {
            await form.validateFields(PROPOSAL_FORM_STEPS[proposalStep].fields)
            setProposalStep(step => step + 1)
        } catch {
            // Field errors are shown inline on the current step.
        }
    }

    const saveProposal = async () => {
        if (!actor) return
        let values: any
        try {
            values = await form.validateFields()
        } catch (error: any) {
            // Jump back to the first step that still has an invalid field.
            const firstError = error?.errorFields?.[0]?.name?.[0]
            const stepIndex = PROPOSAL_FORM_STEPS.findIndex(step => step.fields.includes(firstError))
            if (stepIndex >= 0) setProposalStep(stepIndex)
            return
        }
        const owner = ((): ProposalOwner => {
            if (values.ownerType === 'Department' || values.ownerType === 'Centre') {
                const options = values.ownerType === 'Department' ? departments : branches
                const id = values.ownerType === 'Department' ? values.ownerDepartmentId : values.ownerCentreId
                const reference = options.find(option => option.id === id)
                return {
                    type: values.ownerType,
                    id,
                    name: reference?.name || id,
                    email: null,
                    role: 'Proposal owner'
                }
            }
            const name = String(values.ownerName || '').trim()
            const person = people.find(candidate => candidate.name === name)
            return {
                type: 'Individual',
                id: person?.id || null,
                name,
                email: person?.email || null,
                role: 'Proposal owner'
            }
        })()
        const input: ProposalInput = {
            title: values.title.trim(),
            clientName: values.clientName.trim(),
            clientContact: values.clientContact?.trim() || null,
            clientEmail: values.clientEmail?.trim() || null,
            category: values.category,
            scope: values.scope,
            province: values.scope === 'Provincial' ? values.province : null,
            allCentres: Boolean(values.allCentres),
            allDepartments: Boolean(values.allDepartments),
            estimatedValue: Number(values.estimatedValue || 0),
            status: values.status,
            description: values.description?.trim() || null,
            originator: { name: values.originatorName.trim(), role: 'Originator' },
            owner,
            contributors: (values.contributorIds || []).map((id: string) =>
                people.find(person => (person.id || person.email || person.name) === id)
            ).filter(Boolean) as ProposalContributor[],
            centres: referencesFromIds(values.centres, branches),
            departments: referencesFromIds(values.departments, departments),
            proposedDate: values.proposedDate?.toDate?.() || new Date(),
            submissionDeadline: values.submissionDeadline?.toDate?.() || null,
            acceptedAt: editingProposal?.acceptedAt || null,
            isArchived: false
        }
        setSaving(true)
        try {
            let proposalId = editingProposal?.id
            if (editingProposal) {
                await updateProposal(editingProposal, input, actor)
            } else {
                proposalId = await createProposal(input, actor)
            }

            let uploadFailures = 0
            if (proposalId) {
                for (const { file, category } of pendingDocuments) {
                    try {
                        await uploadProposalDocument({ id: proposalId }, file, category, actor)
                    } catch (error) {
                        console.error('[ProposalPipeline] Supporting document upload failed', error)
                        uploadFailures += 1
                    }
                }
            }

            message.success(editingProposal
                ? `${editingProposal.proposalNumber} updated`
                : 'Proposal created and added to the live pipeline')
            if (uploadFailures) {
                message.warning(`${uploadFailures} document${uploadFailures === 1 ? '' : 's'} could not be uploaded.`)
            }
            setProposalModalOpen(false)
            setPendingDocuments([])
            form.resetFields()
        } catch (error: any) {
            console.error('[ProposalPipeline] Save failed', error)
            message.error(error?.message || 'Could not save the proposal.')
        } finally {
            setSaving(false)
        }
    }

    // Advance presets the next forward status; the full update picks the first allowed one.
    const openStatusModal = (proposal: Proposal) => {
        statusForm.setFieldsValue({
            status: ADVANCE_TO[proposal.status] || nextStatuses(proposal.status)[0],
            note: ''
        })
        setStatusProposal(proposal)
    }

    const saveStatus = async () => {
        if (!actor || !statusProposal) return
        const values = await statusForm.validateFields()
        const note = values.note?.trim() || `Status changed from ${statusProposal.status} to ${values.status}`
        setSaving(true)
        try {
            await changeProposalStatus(statusProposal, values.status, note, actor)
            message.success(`${statusProposal.proposalNumber} moved to ${values.status}`)
            if (detailsOpen && selectedProposal?.id === statusProposal.id) {
                await refreshDetails({ ...statusProposal, status: values.status })
            }
            setStatusProposal(null)
            statusForm.resetFields()
        } catch (error: any) {
            message.error(error?.message || 'Could not update the proposal status.')
        } finally {
            setSaving(false)
        }
    }

    const renderAdvanceButton = (proposal: Proposal, block = false) => {
        const target = ADVANCE_TO[proposal.status]
        if (!target) {
            return <Tooltip title='This proposal is at the end of the pipeline'>
                <Button block={block} icon={<CheckCircleFilled />} disabled>Complete</Button>
            </Tooltip>
        }
        return <Tooltip title={`Move to ${target}`}>
            <Button block={block} type='primary' ghost onClick={() => openStatusModal(proposal)}
                icon={<ArrowRightOutlined />} iconPosition='end'>
                {proposal.status === 'Rejected' ? 'Reopen' : 'Advance'}
            </Button>
        </Tooltip>
    }

    const handleDocumentUpload = async (file: File, category: string) => {
        if (!actor || !selectedProposal) return false
        setSaving(true)
        try {
            await uploadProposalDocument(selectedProposal, file, category, actor)
            message.success(`${file.name} uploaded`)
            await refreshDetails(selectedProposal)
        } catch (error: any) {
            message.error(error?.message || 'Document upload failed.')
        } finally {
            setSaving(false)
        }
        return false
    }

    const removeDocument = async (document: ProposalDocument) => {
        if (!actor || !selectedProposal) return
        setSaving(true)
        try {
            await deleteProposalDocument(selectedProposal, document, actor)
            message.success('Document removed')
            await refreshDetails(selectedProposal)
        } catch (error: any) {
            message.error(error?.message || 'Document could not be removed.')
        } finally {
            setSaving(false)
        }
    }

    const columns: ColumnsType<Proposal> = [
        {
            title: 'Proposal', key: 'proposal', width: 330,
            render: (_, proposal) => (
                <Space size={12}>
                    <Avatar shape='square' size={38} className='proposal-row-avatar'
                        icon={<FileTextOutlined />} />
                    <div>
                        <Button type='link' className='proposal-title-button'
                            onClick={() => openDetails(proposal)}>
                            {proposal.title}
                        </Button>
                        <div><Text type='secondary' style={{ fontSize: 12 }}>
                            {proposal.proposalNumber} · {proposal.clientName}
                        </Text></div>
                    </div>
                </Space>
            )
        },
        { title: 'Category', dataIndex: 'category', width: 105, render: value => <Tag>{value}</Tag> },
        {
            title: 'Scope', dataIndex: 'scope', width: 140,
            render: value => <Space size={5}><GlobalOutlined />{value}</Space>
        },
        {
            title: 'Owner', dataIndex: 'owner', width: 170,
            render: (value: ProposalOwner) => value?.name
                ? <Tooltip title={`${value.type || 'Individual'} owner`}>
                    <Space size={6} className='proposal-owner-cell'>
                        {ownerIcon(value.type)}<span>{value.name}</span>
                    </Space>
                </Tooltip>
                : 'Not assigned'
        },
        {
            title: 'Value', dataIndex: 'estimatedValue', width: 125, align: 'right',
            render: value => <Text strong>{money(value)}</Text>
        },
        {
            title: 'Status', dataIndex: 'status', width: 155,
            render: (value: ProposalStatus) => <Tag color={statusColor[value]}>{value}</Tag>
        },
        {
            title: '', key: 'actions', fixed: 'right', width: 230,
            render: (_, proposal) => (
                <Space size={6}>
                    {renderAdvanceButton(proposal)}
                    <Tooltip title='View'>
                        <Button icon={<EyeOutlined />} aria-label='View proposal'
                            onClick={() => openDetails(proposal)} />
                    </Tooltip>
                    <Tooltip title='Edit'>
                        <Button icon={<EditOutlined />} aria-label='Edit proposal'
                            onClick={() => openEdit(proposal)} />
                    </Tooltip>
                </Space>
            )
        }
    ]

    if (isIncubatee) {
        return <div className='proposal-page'><Alert type='error' showIcon
            message='Access restricted'
            description='The proposals pipeline is not available to the incubatee role.' /></div>
    }

    if (!actor) {
        return <div className='proposal-page'><Alert type='warning' showIcon
            message='Organisation profile required'
            description='Your user profile must be loaded before proposals can be loaded or created.' /></div>
    }

    return (
        <Spin spinning={loading || saving}>
            <div className='proposal-page'>
                {referenceWarning && <Alert closable type='warning' showIcon
                    message={referenceWarning} onClose={() => setReferenceWarning('')}
                    style={{ marginBottom: 16 }} />}

                <Row gutter={[16, 16]} className='proposal-stat-row'>
                    <Col xs={24} sm={12} xl={6}>
                        <MotionCard.Metric
                            title='Active pipeline' value={money(metrics.value)}
                            subtitle='All non-archived proposals' icon={<GlobalOutlined style={{ color: '#4f46e5' }} />}
                            iconBg='rgba(79,70,229,.12)' />
                    </Col>
                    <Col xs={24} sm={12} xl={6}>
                        <MotionCard.Metric
                            title='Open proposals' value={metrics.open}
                            subtitle='Requiring pipeline management' icon={<FileTextOutlined style={{ color: '#2563eb' }} />}
                            iconBg='rgba(37,99,235,.12)' />
                    </Col>
                    <Col xs={24} sm={12} xl={6}>
                        <MotionCard.Metric
                            title='Conversion rate' value={`${metrics.conversion}%`}
                            subtitle='Accepted versus submitted' icon={<CheckCircleFilled style={{ color: '#059669' }} />}
                            iconBg='rgba(5,150,105,.12)' /></Col>
                    <Col xs={24} sm={12} xl={6}>
                        <MotionCard.Metric
                            title='Awaiting activation' value={metrics.activation}
                            subtitle='Accepted but not yet active' icon={<ClockCircleOutlined style={{ color: '#d97706' }} />}
                            iconBg='rgba(217,119,6,.12)' /></Col>
                </Row>

                <div className='proposal-stage-grid'>
                    {stageCards.map((stage, index) => {
                        const isActive = statusFilter === stage.label
                        return (
                            <Fragment key={stage.label}>
                                <button type='button' aria-pressed={isActive}
                                    className={`proposal-stage${isActive ? ' proposal-stage-active' : ''}`}
                                    style={{ '--stage-color': stage.color } as React.CSSProperties}
                                    onClick={() => setStatusFilter(isActive ? 'All' : stage.label)}>
                                    <span className='proposal-stage-count'>{stage.count}</span>
                                    <span className='proposal-stage-copy'>
                                        <strong>{stage.label}</strong>
                                        <small>{money(stage.value)}</small>
                                    </span>
                                </button>
                                {index < stageCards.length - 1 &&
                                    <ArrowRightOutlined className='proposal-stage-arrow' aria-hidden />}
                            </Fragment>
                        )
                    })}
                </div>

                <MotionCard className='proposal-list-card' filterBar={
                    <div className='proposal-filter-bar'>
                        <Input allowClear prefix={<SearchOutlined />} placeholder='Search proposals'
                            value={search} onChange={event => setSearch(event.target.value)}
                            className='proposal-search' />
                        <Button type='primary' icon={<PlusOutlined />} onClick={openCreate}>Submit proposal</Button>
                    </div>}>
                    <Table rowKey='id' columns={columns} dataSource={visibleProposals}
                        pagination={{ pageSize: 10, hideOnSinglePage: true }}
                        scroll={{ x: 1100 }}
                        locale={{
                            emptyText: <Empty description='No proposals yet'>
                                <Button type='primary' onClick={openCreate}>Create the first proposal</Button>
                            </Empty>
                        }} />
                </MotionCard>

                <Modal title={<Space><FileAddOutlined />
                    {editingProposal ? `Edit ${editingProposal.proposalNumber}` : 'Create proposal'}
                </Space>} open={proposalModalOpen}
                    onCancel={() => setProposalModalOpen(false)}
                    width={760} className='proposal-form-modal'
                    footer={editingProposal
                        ? proposalStep === EDIT_SECTION_PICKER
                            ? <Button block onClick={() => setProposalModalOpen(false)}>Cancel</Button>
                            : <div className='proposal-step-footer'>
                                <Button block icon={<ArrowLeftOutlined />} disabled={saving}
                                    onClick={() => setProposalStep(EDIT_SECTION_PICKER)}>Sections</Button>
                                <Button block type='primary' loading={saving}
                                    onClick={saveProposal}>Save changes</Button>
                            </div>
                        : <div className='proposal-step-footer'>
                            <Button block icon={proposalStep > 0 ? <ArrowLeftOutlined /> : undefined}
                                disabled={saving} onClick={goToPreviousStep}>
                                {proposalStep > 0 ? 'Back' : 'Cancel'}
                            </Button>
                            <Button block type='primary' loading={saving} onClick={goToNextStep}
                                icon={isLastProposalStep ? undefined : <ArrowRightOutlined />} iconPosition='end'>
                                {isLastProposalStep ? 'Create proposal' : 'Next'}
                            </Button>
                        </div>}>
                    <Form form={form} layout='vertical'>
                        <Form.Item name='allCentres' valuePropName='checked' hidden><Checkbox /></Form.Item>
                        <Form.Item name='allDepartments' valuePropName='checked' hidden><Checkbox /></Form.Item>
                        {/* Editing opens on a section picker so any section is one click away. */}
                        {editingProposal && proposalStep === EDIT_SECTION_PICKER &&
                            <div className='proposal-form-step'>
                                <div className='proposal-form-step-heading'>
                                    <strong>What would you like to edit?</strong>
                                    <span>Choose a section to open it directly.</span>
                                </div>
                                <div className='proposal-section-picker'>
                                    {PROPOSAL_FORM_STEPS.map((step, index) => (
                                        <button type='button' key={step.title}
                                            className='proposal-section-option'
                                            onClick={() => setProposalStep(index)}>
                                            <span className='proposal-section-option-icon'>{step.icon}</span>
                                            <span className='proposal-section-option-copy'>
                                                <strong>{step.title}</strong>
                                                <small>{step.description}</small>
                                            </span>
                                            <ArrowRightOutlined className='proposal-section-option-arrow' />
                                        </button>
                                    ))}
                                </div>
                            </div>}
                        {/* Every step stays mounted so the whole form validates on save;
                            only the active one is shown, and it fades in when revealed. */}
                        <div className='proposal-form-step' hidden={proposalStep !== 0}>
                            <ProposalStepHeading index={0} />
                            <Row gutter={16}>
                                <Col xs={24} md={16}><Form.Item name='title' label='Proposal title'
                                    rules={[{ required: true }]}><Input /></Form.Item></Col>
                                <Col xs={24} md={8}><Form.Item name='estimatedValue'
                                    label='Estimated value' rules={[{ required: true }]}>
                                    <InputNumber min={0} prefix='R' style={{ width: '100%' }} />
                                </Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name='clientName'
                                    label='Client / prospective client' rules={[{ required: true }]}>
                                    <Input />
                                </Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name='category' label='Category'
                                    rules={[{ required: true }]}>
                                    <Select options={PROPOSAL_CATEGORIES.map(value => ({ label: value, value }))} />
                                </Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name='clientContact' label='Client contact'>
                                    <Input />
                                </Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name='clientEmail' label='Client email'
                                    rules={[{ type: 'email' }]}><Input /></Form.Item></Col>
                            </Row>
                        </div>

                        <div className='proposal-form-step' hidden={proposalStep !== 1}>
                            <ProposalStepHeading index={1} />
                            <Row gutter={16}>
                                <Col xs={24} md={12}><Form.Item name='originatorName'
                                    label='Originated by' rules={[{ required: true }]}>
                                    <Input prefix={<UserOutlined />} />
                                </Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name='ownerType' label='Owned by'
                                    rules={[{ required: true }]}>
                                    <Segmented block options={PROPOSAL_OWNER_TYPES.map(value => ({
                                        value, label: value, icon: ownerIcon(value)
                                    }))} />
                                </Form.Item></Col>
                                <Col span={24}>
                                    {ownerType === 'Individual' && <Form.Item name='ownerName'
                                        label='Proposal owner' rules={[{ required: true, whitespace: true }]}
                                        extra='Pick a system user or type a name.'>
                                        <AutoComplete options={people.map(person => ({ value: person.name }))}
                                            filterOption={(input, option) =>
                                                String(option?.value || '').toLowerCase().includes(input.toLowerCase())}>
                                            <Input prefix={<UserOutlined />} />
                                        </AutoComplete>
                                    </Form.Item>}
                                    {ownerType === 'Department' && <Form.Item name='ownerDepartmentId'
                                        label='Owning department'
                                        rules={[{ required: true, message: 'Select the owning department' }]}>
                                        <Select showSearch optionFilterProp='label' placeholder='Search departments'
                                            options={departments.map(item => ({ label: item.name, value: item.id }))} />
                                    </Form.Item>}
                                    {ownerType === 'Centre' && <Form.Item name='ownerCentreId'
                                        label='Owning centre'
                                        rules={[{ required: true, message: 'Select the owning centre' }]}>
                                        <Select showSearch optionFilterProp='label' placeholder='Search centres'
                                            options={branches.map(item => ({
                                                label: `${item.name}${item.province ? ` · ${item.province}` : ''}`,
                                                value: item.id
                                            }))} />
                                    </Form.Item>}
                                </Col>
                                <Col xs={24} md={12}><Form.Item name='proposedDate' label='Proposal date'>
                                    <DatePicker style={{ width: '100%' }} />
                                </Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name='submissionDeadline'
                                    label='Submission deadline'><DatePicker style={{ width: '100%' }} />
                                </Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name='status' label='Current status'
                                    rules={[{ required: true }]}>
                                    <Select options={PROPOSAL_STATUSES.filter(value => value !== 'Archived')
                                        .map(value => ({ label: value, value }))} />
                                </Form.Item></Col>
                            </Row>
                        </div>

                        <div className='proposal-form-step' hidden={proposalStep !== 2}>
                            <ProposalStepHeading index={2} />
                            <Row gutter={16}>
                                <Col xs={24} md={12}><Form.Item name='scope' label='Scope'
                                    rules={[{ required: true }]}>
                                    <Select onChange={handleScopeChange}
                                        options={PROPOSAL_SCOPES.map(value => ({ label: value, value }))} />
                                </Form.Item></Col>
                                {selectedScope === 'Provincial' && <Col xs={24} md={12}>
                                    <Form.Item name='province' label='Province' rules={[{ required: true }]}>
                                        <Select placeholder='Select a province' onChange={handleProvinceChange}
                                            options={provinces.map(value => ({ label: value, value }))} />
                                    </Form.Item>
                                </Col>}
                                {['National', 'Provincial'].includes(selectedScope) && <Col span={24}>
                                    <div className='proposal-select-all-control'>
                                        <Checkbox checked={Boolean(allCentres)}
                                            disabled={selectedScope === 'Provincial' && !selectedProvince}
                                            onChange={event => handleAllCentresChange(event.target.checked)}>
                                            {selectedScope === 'National'
                                                ? `All centres (${branches.length})`
                                                : `All centres in ${selectedProvince || 'selected province'} (${selectableCentres.length})`}
                                        </Checkbox>
                                        {allCentres && <Tag color='blue'>All centres selected</Tag>}
                                    </div>
                                </Col>}
                                <Col span={24}><Form.Item name='centres' label='Participating centres'
                                    rules={[{ required: true, message: 'Select at least one participating centre' }]}>
                                    <Select mode='multiple' showSearch optionFilterProp='label'
                                        disabled={Boolean(allCentres) || (selectedScope === 'Provincial' && !selectedProvince)}
                                        placeholder={allCentres ? 'All eligible centres selected' : 'Search and select centres'}
                                        maxTagCount='responsive'
                                        options={selectableCentres.map(item => ({
                                            label: `${item.name}${item.province ? ` · ${item.province}` : ''}`,
                                            value: item.id
                                        }))} />
                                </Form.Item></Col>
                                <Col span={24}>
                                    <div className='proposal-select-all-control'>
                                        <Checkbox checked={Boolean(allDepartments)}
                                            onChange={event => handleAllDepartmentsChange(event.target.checked)}>
                                            All departments ({departments.length})
                                        </Checkbox>
                                        {allDepartments && <Tag color='purple'>All departments selected</Tag>}
                                    </div>
                                </Col>
                                <Col span={24}><Form.Item name='departments' label='Intervention departments'>
                                    <Select mode='multiple' showSearch optionFilterProp='label'
                                        disabled={Boolean(allDepartments)} maxTagCount='responsive'
                                        placeholder={allDepartments ? 'All departments selected' : 'Search and select departments'}
                                        options={departments.map(item => ({ label: item.name, value: item.id }))} />
                                </Form.Item></Col>
                            </Row>
                        </div>

                        <div className='proposal-form-step' hidden={proposalStep !== 3}>
                            <ProposalStepHeading index={3} />
                            <Form.Item name='description' label='Proposal summary'>
                                <Input.TextArea rows={3} />
                            </Form.Item>
                            <Form.Item name='contributorIds' label='Contributors'
                                extra='Search for and add existing system users by name or email.'>
                                <Select mode='multiple' showSearch allowClear optionFilterProp='label'
                                    placeholder='Search by name or email'
                                    maxTagCount='responsive' options={contributorOptions} />
                            </Form.Item>
                            <Form.Item label='Documents'
                                extra='Files are uploaded to their category when the proposal is saved.'>
                                <DocumentCategoryRows
                                    documents={editDocuments}
                                    pendingFiles={pendingDocuments}
                                    onAdd={(category, file) => setPendingDocuments(current =>
                                        current.some(item => item.category === category &&
                                            item.file.name === file.name && item.file.size === file.size)
                                            ? current
                                            : [...current, { category, file }])}
                                    onRemovePending={pending => setPendingDocuments(current =>
                                        current.filter(item => item !== pending))}
                                    renderDocumentActions={document =>
                                        <Button size='small' icon={<DownloadOutlined />}
                                            onClick={() => window.open(document.url, '_blank')}>Open</Button>} />
                            </Form.Item>
                        </div>
                    </Form>
                </Modal>

                <Modal title={selectedProposal ? <div>
                    <Text type='secondary'>{selectedProposal.proposalNumber}</Text>
                    <Title level={4} style={{ margin: '2px 0 0' }}>{selectedProposal.title}</Title>
                </div> : 'Proposal details'} open={detailsOpen}
                    onCancel={() => setDetailsOpen(false)} width={760}
                    className='proposal-details-modal'
                    footer={selectedProposal && <div className='proposal-details-footer'>
                        <Button block icon={<EditOutlined />}
                            onClick={() => openEdit(selectedProposal)}>Edit</Button>
                        {renderAdvanceButton(selectedProposal, true)}
                        <Button block type='primary' icon={<SafetyCertificateOutlined />} onClick={() => {
                            setActivationOpen(true)
                            setDetailsOpen(false)
                        }}>Preview activation</Button>
                    </div>}>
                    {selectedProposal && <Spin spinning={detailsLoading}>
                        {(() => {
                            const sections = [
                            {
                                key: 'overview', label: 'Overview', children: <>
                                    <Descriptions bordered column={2} size='small'>
                                        <Descriptions.Item label='Client' span={2}>{selectedProposal.clientName}</Descriptions.Item>
                                        <Descriptions.Item label='Category'><Tag>{selectedProposal.category}</Tag></Descriptions.Item>
                                        <Descriptions.Item label='Status'><Tag color={statusColor[selectedProposal.status]}>{selectedProposal.status}</Tag></Descriptions.Item>
                                        <Descriptions.Item label='Estimated value'>{money(selectedProposal.estimatedValue)}</Descriptions.Item>
                                        <Descriptions.Item label='Scope'><Space wrap>
                                            <span>{selectedProposal.scope}</span>
                                            {selectedProposal.province && <Tag>{selectedProposal.province}</Tag>}
                                            {selectedProposal.allCentres && <Tag color='blue'>All centres</Tag>}
                                        </Space></Descriptions.Item>
                                        <Descriptions.Item label='Originator'>{selectedProposal.originator.name}</Descriptions.Item>
                                        <Descriptions.Item label='Owner'><Space size={6}>
                                            {ownerIcon(selectedProposal.owner.type)}
                                            <span>{selectedProposal.owner.name}</span>
                                            <Tag>{selectedProposal.owner.type || 'Individual'}</Tag>
                                        </Space></Descriptions.Item>
                                        <Descriptions.Item label='Last updated' span={2}>{dateLabel(selectedProposal.updatedAt)}</Descriptions.Item>
                                    </Descriptions>
                                    {/* "All" selections collapse to one tag rather than listing every record. */}
                                    <Divider orientation='left'>Delivery footprint</Divider>
                                    <Space wrap>{selectedProposal.allCentres
                                        ? <Tag icon={<GlobalOutlined />} color='blue'>
                                            {selectedProposal.province
                                                ? `All centres in ${selectedProposal.province}`
                                                : 'All centres'} ({selectedProposal.centres.length})
                                        </Tag>
                                        : selectedProposal.centres.length
                                            ? selectedProposal.centres.map(item =>
                                                <Tag icon={<GlobalOutlined />} color='blue' key={item.id}>{item.name}</Tag>)
                                            : <Text type='secondary'>No centres assigned</Text>}</Space>
                                    <Divider orientation='left'>Participating departments</Divider>
                                    <Space wrap>{selectedProposal.allDepartments
                                        ? <Tag icon={<TeamOutlined />} color='purple'>
                                            All departments ({selectedProposal.departments.length})
                                        </Tag>
                                        : selectedProposal.departments.length
                                            ? selectedProposal.departments.map(item =>
                                                <Tag icon={<TeamOutlined />} color='purple' key={item.id}>{item.name}</Tag>)
                                            : <Text type='secondary'>No departments selected</Text>}</Space>
                                    {/* Originator and owner are shown above; this lists only added contributors. */}
                                    <Divider orientation='left'>Contributors</Divider>
                                    <List size='small' dataSource={selectedProposal.contributors}
                                        locale={{ emptyText: 'No contributors added' }}
                                        renderItem={person => <List.Item><List.Item.Meta
                                            avatar={<Avatar icon={<UserOutlined />} />} title={person.name}
                                            description={person.email || undefined} /></List.Item>} />
                                    <Button block icon={<ClockCircleOutlined />}
                                        onClick={() => openStatusModal(selectedProposal)}>
                                        Update pipeline status
                                    </Button>
                                </>
                            },
                            {
                                key: 'documents',
                                label: <span className='proposal-segment-label'>
                                    Documents
                                    {documents.length > 0 && <Badge count={documents.length} size='small'
                                        className='proposal-document-count' />}
                                </span>,
                                children: <DocumentCategoryRows
                                    documents={documents}
                                    onAdd={(category, file) => { handleDocumentUpload(file, category) }}
                                    renderDocumentActions={document => <>
                                        <Button size='small' icon={<DownloadOutlined />}
                                            onClick={() => window.open(document.url, '_blank')}>Open</Button>
                                        {document.id !== 'legacy-proposal-document' &&
                                            <Popconfirm title='Remove this document?'
                                                onConfirm={() => removeDocument(document)}>
                                                <Button size='small' danger icon={<DeleteOutlined />}
                                                    aria-label={`Remove ${document.name}`} />
                                            </Popconfirm>}
                                    </>} />
                            },
                            {
                                key: 'history', label: 'History',
                                children: history.length ? <Timeline items={history.map(entry => ({
                                    color: entry.action === 'status_changed' ? 'blue' : 'green',
                                    children: <div><Text strong>{entry.note || entry.action}</Text>
                                        <div><Text type='secondary'>
                                            {entry.createdBy?.name || 'System'} · {dateLabel(entry.createdAt)}
                                        </Text></div></div>
                                }))} /> : <Empty description='No history entries yet' />
                            }
                            ]
                            const active = sections.find(section => section.key === detailsSection) || sections[0]
                            return <>
                                <Segmented block className='proposal-details-segmented'
                                    value={active.key} onChange={value => setDetailsSection(String(value))}
                                    options={sections.map(section => ({ value: section.key, label: section.label }))} />
                                {/* Keyed so each section fades in when selected. */}
                                <div className='proposal-form-step' key={active.key}>{active.children}</div>
                            </>
                        })()}
                    </Spin>}
                </Modal>

                {/* One status flow: Advance and "Update pipeline status" both open this modal. */}
                <Modal title={statusProposal
                    ? `Update status · ${statusProposal.proposalNumber}`
                    : 'Update proposal status'} open={Boolean(statusProposal)}
                    onCancel={() => setStatusProposal(null)}
                    footer={<div className='proposal-step-footer'>
                        <Button block disabled={saving} onClick={() => setStatusProposal(null)}>Cancel</Button>
                        <Button block type='primary' loading={saving} onClick={saveStatus}>Update status</Button>
                    </div>}>
                    <Form form={statusForm} layout='vertical'>
                        {statusProposal && <Form.Item label='Current status'>
                            <Tag color={statusColor[statusProposal.status]}>{statusProposal.status}</Tag>
                        </Form.Item>}
                        <Form.Item name='status' label='New status' rules={[{ required: true }]}>
                            <Select options={nextStatuses(statusProposal?.status || 'Draft')
                                .map(value => ({ label: value, value }))} />
                        </Form.Item>
                        <Form.Item name='note' label='Progress note'
                            extra='Optional. Recorded in the proposal history.'>
                            <Input.TextArea rows={3} placeholder='What changed, and what happens next?' />
                        </Form.Item>
                    </Form>
                </Modal>

                <Modal title={<Space><SafetyCertificateOutlined />Project activation preview</Space>}
                    open={activationOpen} onCancel={() => setActivationOpen(false)}
                    footer={null} width={900}>
                    {selectedProposal && <>
                        <Alert type='info' showIcon icon={<WarningFilled />}
                            message='Phase 2 activation controls'
                            description='Phase 1 now supplies the proposal, client, centres, departments, owner, value, documents and approval history that this module will consume.' />
                        <div className='activation-modal-summary'>
                            <div><Text type='secondary'>{selectedProposal.proposalNumber}</Text>
                                <Title level={4}>{selectedProposal.title}</Title>
                                <Text>{selectedProposal.clientName} · {money(selectedProposal.estimatedValue)}</Text>
                            </div>
                            <div className='activation-progress'>
                                <Progress type='circle'
                                    percent={selectedProposal.status === 'Ready for activation' ? 90 : 55}
                                    size={84} />
                            </div>
                        </div>
                        <Steps current={Math.max(0, PROPOSAL_STATUSES.indexOf(selectedProposal.status) - 4)}
                            items={[
                                { title: 'Accepted', description: 'Proposal decision and approval evidence' },
                                { title: 'SLA signed', description: 'Agreement and commercial terms' },
                                { title: 'Order number', description: 'Client procurement dependency' },
                                { title: 'Implementation plan', description: 'Activities, KPIs, MOVs and invoicing' },
                                { title: 'Activate departments', description: 'Generate service agreements' }
                            ]} />
                    </>}
                </Modal>
            </div>
        </Spin>
    )
}
