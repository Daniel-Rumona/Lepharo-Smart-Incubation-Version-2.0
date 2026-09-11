import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
    Alert, Avatar, Badge, Button, Checkbox, Col, DatePicker, Descriptions, Divider,
    Drawer, Empty, Form, Input, InputNumber, List, Modal, Popconfirm, Progress,
    Row, Select, Space, Spin, Steps, Table, Tabs, Tag, Timeline,
    Typography, Upload, message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import {
    ArrowRightOutlined, CheckCircleFilled, ClockCircleOutlined, DeleteOutlined,
    DownloadOutlined, EditOutlined, EyeOutlined, FileAddOutlined,
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
    PROPOSAL_CATEGORIES, PROPOSAL_SCOPES, PROPOSAL_STATUSES
} from '@/types/proposal'
import type {
    Proposal, ProposalActor, ProposalContributor, ProposalDocument, ProposalHistoryEntry,
    ProposalInput, ProposalReference, ProposalStatus
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

export default function ProposalPipeline() {
    const { actor: signedInActor } = useFullIdentity()
    const actor = useMemo(() => actorFromIdentity(signedInActor), [signedInActor])
    const isIncubatee = actor?.role?.trim().toLowerCase() === 'incubatee'
    const [proposals, setProposals] = useState<Proposal[]>([])
    const [branches, setBranches] = useState<ProposalReference[]>([])
    const [departments, setDepartments] = useState<ProposalReference[]>([])
    const [people, setPeople] = useState<ProposalContributor[]>([])
    const [supportingFiles, setSupportingFiles] = useState<File[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [referenceWarning, setReferenceWarning] = useState('')
    const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null)
    const [documents, setDocuments] = useState<ProposalDocument[]>([])
    const [history, setHistory] = useState<ProposalHistoryEntry[]>([])
    const [detailsLoading, setDetailsLoading] = useState(false)
    const [detailsOpen, setDetailsOpen] = useState(false)
    const [proposalModalOpen, setProposalModalOpen] = useState(false)
    const [statusModalOpen, setStatusModalOpen] = useState(false)
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

    const supportingUploadFiles: UploadFile[] = supportingFiles.map((file, index) => ({
        uid: `${file.name}-${file.size}-${index}`,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'done',
        originFileObj: file as UploadFile['originFileObj']
    }))

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
        const definitions: Array<{ label: string; statuses: ProposalStatus[]; color: string }> = [
            { label: 'Draft', statuses: ['Draft', 'In preparation'], color: '#64748b' },
            { label: 'Submitted', statuses: ['Submitted'], color: '#2563eb' },
            { label: 'Under review', statuses: ['Under review'], color: '#7c3aed' },
            { label: 'Accepted', statuses: ['Accepted', 'SLA signed'], color: '#059669' },
            {
                label: 'Activation',
                statuses: ['Awaiting order number', 'Implementation planning', 'Ready for activation', 'Active'],
                color: '#d97706'
            }
        ]
        return definitions.map(definition => {
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
        setDetailsOpen(true)
        refreshDetails(proposal)
    }

    const openCreate = () => {
        setEditingProposal(null)
        setSupportingFiles([])
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
            ownerName: actor?.name
        })
        setProposalModalOpen(true)
    }

    const openEdit = (proposal: Proposal) => {
        setEditingProposal(proposal)
        setSupportingFiles([])
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
            ownerName: proposal.owner.name,
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

    const saveProposal = async () => {
        if (!actor) return
        const values = await form.validateFields()
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
            owner: { name: values.ownerName.trim(), role: 'Proposal owner' },
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
                for (const file of supportingFiles) {
                    try {
                        await uploadProposalDocument({ id: proposalId }, file, 'Supporting document', actor)
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
                message.warning(`${uploadFailures} supporting document${uploadFailures === 1 ? '' : 's'} could not be uploaded.`)
            }
            setProposalModalOpen(false)
            setSupportingFiles([])
            form.resetFields()
        } catch (error: any) {
            console.error('[ProposalPipeline] Save failed', error)
            message.error(error?.message || 'Could not save the proposal.')
        } finally {
            setSaving(false)
        }
    }

    const saveStatus = async () => {
        if (!actor || !selectedProposal) return
        const values = await statusForm.validateFields()
        setSaving(true)
        try {
            await changeProposalStatus(selectedProposal, values.status, values.note, actor)
            message.success(`Status updated to ${values.status}`)
            setStatusModalOpen(false)
            statusForm.resetFields()
            await refreshDetails({ ...selectedProposal, status: values.status })
        } catch (error: any) {
            message.error(error?.message || 'Could not update the proposal status.')
        } finally {
            setSaving(false)
        }
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
                    <Avatar shape='square' size={38}
                        style={{ background: '#eef2ff', color: '#4f46e5' }}
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
            title: 'Owner', dataIndex: 'owner', width: 150,
            render: value => value?.name || 'Not assigned'
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
            title: '', key: 'actions', fixed: 'right', width: 160,
            render: (_, proposal) => (
                <Space>
                    <Button icon={<EyeOutlined />} onClick={() => openDetails(proposal)}>View</Button>
                    <Button icon={<EditOutlined />} onClick={() => openEdit(proposal)} />
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

                <MotionCard className='proposal-pipeline-card' title='Proposal pipeline'>
                    <div className='proposal-stage-grid'>
                        {stageCards.map((stage, index) => (
                            <button type='button' className='proposal-stage' key={stage.label}
                                style={{ '--stage-color': stage.color } as React.CSSProperties}
                                onClick={() => setStatusFilter(stage.label)}>
                                <span className='proposal-stage-count'>{stage.count}</span>
                                <strong>{stage.label}</strong>
                                <small>{money(stage.value)}</small>
                                {index < stageCards.length - 1 &&
                                    <ArrowRightOutlined className='proposal-stage-arrow' />}
                            </button>
                        ))}
                    </div>
                </MotionCard>

                <MotionCard className='proposal-list-card' filterBar={
                    <div className='proposal-filter-bar'>
                        <Space wrap>
                            <Input allowClear prefix={<SearchOutlined />} placeholder='Search proposals'
                                value={search} onChange={event => setSearch(event.target.value)}
                                style={{ width: 220 }} />
                            <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 180 }}
                                options={['All', ...PROPOSAL_STATUSES].map(value => ({ label: value, value }))} />
                        </Space>
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
                    onCancel={() => setProposalModalOpen(false)} onOk={saveProposal}
                    okText={editingProposal ? 'Save changes' : 'Create proposal'}
                    confirmLoading={saving} width={860}>
                    <Form form={form} layout='vertical'>
                        <Form.Item name='allCentres' valuePropName='checked' hidden><Checkbox /></Form.Item>
                        <Form.Item name='allDepartments' valuePropName='checked' hidden><Checkbox /></Form.Item>
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
                            <Col xs={12} md={6}><Form.Item name='category' label='Category'
                                rules={[{ required: true }]}>
                                <Select options={PROPOSAL_CATEGORIES.map(value => ({ label: value, value }))} />
                            </Form.Item></Col>
                            <Col xs={12} md={6}><Form.Item name='scope' label='Scope'
                                rules={[{ required: true }]}>
                                <Select onChange={handleScopeChange}
                                    options={PROPOSAL_SCOPES.map(value => ({ label: value, value }))} />
                            </Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name='clientContact' label='Client contact'>
                                <Input />
                            </Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name='clientEmail' label='Client email'
                                rules={[{ type: 'email' }]}><Input /></Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name='originatorName'
                                label='Originated by' rules={[{ required: true }]}>
                                <Input prefix={<UserOutlined />} />
                            </Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name='ownerName'
                                label='Proposal owner' rules={[{ required: true }]}>
                                <Input prefix={<UserOutlined />} />
                            </Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name='proposedDate' label='Proposal date'>
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name='submissionDeadline'
                                label='Submission deadline'><DatePicker style={{ width: '100%' }} />
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
                            <Col span={24}><Form.Item name='description' label='Proposal summary'>
                                <Input.TextArea rows={3} />
                            </Form.Item></Col>
                            <Col span={24}><Form.Item name='contributorIds' label='Contributors'
                                extra='Search for and add existing system users by name or email.'>
                                <Select mode='multiple' showSearch allowClear optionFilterProp='label'
                                    placeholder='Search by name or email'
                                    maxTagCount='responsive' options={contributorOptions} />
                            </Form.Item></Col>
                            <Col span={24}><Form.Item label='Supporting documents'
                                extra='Attach proposal, financial, compliance, agreement, or supporting evidence files.'>
                                <Upload.Dragger multiple fileList={supportingUploadFiles}
                                    beforeUpload={file => {
                                        if (file.size > 25 * 1024 * 1024) {
                                            message.error(`${file.name} is larger than the 25 MB limit.`)
                                            return Upload.LIST_IGNORE
                                        }
                                        setSupportingFiles(current => current.some(item =>
                                            item.name === file.name && item.size === file.size
                                        ) ? current : [...current, file as File])
                                        return false
                                    }}
                                    onRemove={file => {
                                        setSupportingFiles(current => current.filter((_, index) =>
                                            `${file.name}-${file.size}-${index}` !== file.uid
                                        ))
                                        return true
                                    }}>
                                    <p className='ant-upload-drag-icon'><UploadOutlined /></p>
                                    <p className='ant-upload-text'>Click or drag supporting documents here</p>
                                    <p className='ant-upload-hint'>Files are uploaded when the proposal is saved.</p>
                                </Upload.Dragger>
                            </Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name='status' label='Current status'
                                rules={[{ required: true }]}>
                                <Select options={PROPOSAL_STATUSES.filter(value => value !== 'Archived')
                                    .map(value => ({ label: value, value }))} />
                            </Form.Item></Col>
                        </Row>
                    </Form>
                </Modal>

                <Drawer title={selectedProposal ? <div>
                    <Text type='secondary'>{selectedProposal.proposalNumber}</Text>
                    <Title level={4} style={{ margin: '2px 0 0' }}>{selectedProposal.title}</Title>
                </div> : 'Proposal details'} open={detailsOpen}
                    onClose={() => setDetailsOpen(false)} width={760}
                    extra={selectedProposal && <Space>
                        <Button icon={<EditOutlined />} onClick={() => openEdit(selectedProposal)}>Edit</Button>
                        <Button type='primary' onClick={() => {
                            setActivationOpen(true)
                            setDetailsOpen(false)
                        }}>Preview activation</Button>
                    </Space>}>
                    {selectedProposal && <Spin spinning={detailsLoading}>
                        <Tabs defaultActiveKey='overview' items={[
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
                                        <Descriptions.Item label='Owner'>{selectedProposal.owner.name}</Descriptions.Item>
                                        <Descriptions.Item label='Last updated' span={2}>{dateLabel(selectedProposal.updatedAt)}</Descriptions.Item>
                                    </Descriptions>
                                    <Divider orientation='left'>Delivery footprint</Divider>
                                    <Space wrap>{selectedProposal.centres.length
                                        ? selectedProposal.centres.map(item =>
                                            <Tag icon={<GlobalOutlined />} color='blue' key={item.id}>{item.name}</Tag>)
                                        : <Text type='secondary'>No centres assigned</Text>}</Space>
                                    <Divider orientation='left'>Participating departments</Divider>
                                    {selectedProposal.allDepartments && <Tag color='purple'
                                        style={{ marginBottom: 8 }}>All departments</Tag>}
                                    <Space wrap>{selectedProposal.departments.length
                                        ? selectedProposal.departments.map(item =>
                                            <Tag icon={<TeamOutlined />} color='purple' key={item.id}>{item.name}</Tag>)
                                        : <Text type='secondary'>No departments selected</Text>}</Space>
                                    <Divider orientation='left'>Contributors</Divider>
                                    <List size='small'
                                        dataSource={[selectedProposal.originator, selectedProposal.owner, ...selectedProposal.contributors]}
                                        renderItem={person => <List.Item><List.Item.Meta
                                            avatar={<Avatar icon={<UserOutlined />} />} title={person.name}
                                            description={person.email || undefined} /></List.Item>} />
                                    <Button block icon={<ClockCircleOutlined />} onClick={() => {
                                        statusForm.setFieldsValue({
                                            status: nextStatuses(selectedProposal.status)[0], note: ''
                                        })
                                        setStatusModalOpen(true)
                                    }}>Update pipeline status</Button>
                                </>
                            },
                            {
                                key: 'documents',
                                label: <Badge count={documents.length} size='small' offset={[8, -3]}>
                                    <span>Documents</span>
                                </Badge>,
                                children: <>
                                    <Space style={{ marginBottom: 16 }} wrap>
                                        {['Proposal', 'Financial', 'Compliance', 'Agreement', 'Evidence'].map(category =>
                                            <Upload key={category} showUploadList={false}
                                                beforeUpload={file => handleDocumentUpload(file as File, category)}>
                                                <Button size='small' icon={<UploadOutlined />}>{category}</Button>
                                            </Upload>)}
                                    </Space>
                                    <List dataSource={documents}
                                        locale={{ emptyText: 'No proposal documents uploaded yet.' }}
                                        renderItem={document => <List.Item actions={[
                                            <Button key='open' icon={<DownloadOutlined />}
                                                onClick={() => window.open(document.url, '_blank')}>Open</Button>,
                                            document.id !== 'legacy-proposal-document' &&
                                            <Popconfirm key='remove' title='Remove this document?'
                                                onConfirm={() => removeDocument(document)}>
                                                <Button danger icon={<DeleteOutlined />} />
                                            </Popconfirm>
                                        ].filter(Boolean)}>
                                            <List.Item.Meta avatar={<Avatar shape='square'
                                                icon={<FileTextOutlined />} />}
                                                title={document.name}
                                                description={`${document.category} · ${document.status || 'Current'} · ${dateLabel(document.uploadedAt)}`} />
                                        </List.Item>} />
                                </>
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
                        ]} />
                    </Spin>}
                </Drawer>

                <Modal title='Update proposal status' open={statusModalOpen}
                    onCancel={() => setStatusModalOpen(false)} onOk={saveStatus}
                    confirmLoading={saving} okText='Update status'>
                    <Form form={statusForm} layout='vertical'>
                        <Form.Item name='status' label='New status' rules={[{ required: true }]}>
                            <Select options={nextStatuses(selectedProposal?.status || 'Draft')
                                .map(value => ({ label: value, value }))} />
                        </Form.Item>
                        <Form.Item name='note' label='Progress note'
                            rules={[{ required: true, min: 5 }]}>
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
