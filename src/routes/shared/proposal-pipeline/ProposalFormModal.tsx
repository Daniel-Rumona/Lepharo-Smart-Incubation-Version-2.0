import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
    AutoComplete, Button, Checkbox, Col, DatePicker, Form, Input, InputNumber, Modal,
    Row, Segmented, Select, Space, Steps, Tag, message
} from 'antd'
import {
    ArrowLeftOutlined, ArrowRightOutlined, DownloadOutlined, EditOutlined, FileAddOutlined,
    FileTextOutlined, GlobalOutlined, UploadOutlined, UserOutlined
} from '@ant-design/icons'
import {
    createProposal, listProposalDocuments, updateProposal, uploadProposalDocument
} from '@/services/proposalService'
import { PROPOSAL_CATEGORIES, PROPOSAL_OWNER_TYPES, PROPOSAL_SCOPES } from '@/types/proposal'
import type {
    Proposal, ProposalActor, ProposalContributor, ProposalDocument, ProposalInput, ProposalOwner,
    ProposalOwnerType, ProposalReference
} from '@/types/proposal'
import {
    DocumentCategoryRows, contributorKey, datePickerValue, formStatuses, ownerIcon, type PendingDocument
} from './proposalUi'

const PROPOSAL_FORM_STEPS = [
    {
        title: 'Proposal and client',
        short: 'Proposal',
        icon: <FileTextOutlined />,
        description: 'What is being proposed, to whom, and what it is worth.',
        fields: ['title', 'estimatedValue', 'clientName', 'category', 'clientContact', 'clientEmail']
    },
    {
        title: 'Ownership and timeline',
        short: 'Ownership',
        icon: <UserOutlined />,
        description: 'Who leads the proposal and when it is due.',
        fields: [
            'originatorName', 'ownerType', 'ownerName', 'ownerDepartmentId', 'ownerCentreId',
            'proposedDate', 'submissionDeadline', 'status'
        ]
    },
    {
        title: 'Scope and footprint',
        short: 'Scope',
        icon: <GlobalOutlined />,
        description: 'Where the work will be delivered and which departments take part.',
        fields: ['scope', 'province', 'centres', 'departments']
    },
    {
        title: 'Summary and documents',
        short: 'Documents',
        icon: <UploadOutlined />,
        description: 'Add context, contributors and any supporting files.',
        fields: ['description', 'contributorIds']
    }
]

// Step index for the edit modal's opening section picker.
const EDIT_SECTION_PICKER = -1

const ProposalStepHeading = ({ index }: { index: number }) => (
    <div className='proposal-form-step-heading'>
        <strong>{PROPOSAL_FORM_STEPS[index].title}</strong>
        <span>{PROPOSAL_FORM_STEPS[index].description}</span>
    </div>
)

// Falls back to the names already saved on the proposal, so a failed
// reference load never overwrites centre or department names with ids.
const referencesFromIds = (
    ids: string[] | undefined,
    options: ProposalReference[],
    saved: ProposalReference[] = []
) => (ids || []).map(id =>
    options.find(option => option.id === id) || saved.find(item => item.id === id) || { id, name: id })

/**
 * The stepped create wizard, and the edit form that opens on a section
 * picker. `proposal` is null when creating.
 */
export function ProposalFormModal({
    open,
    proposal,
    actor,
    branches,
    departments,
    people,
    onClose,
    onSaved
}: {
    open: boolean
    proposal: Proposal | null
    actor: ProposalActor
    branches: ProposalReference[]
    departments: ProposalReference[]
    people: ProposalContributor[]
    onClose: () => void
    /** Called with the proposal's id once it is created or updated. */
    onSaved?: (proposalId: string) => void
}) {
    const [form] = Form.useForm()
    const [step, setStep] = useState(0)
    const [saving, setSaving] = useState(false)
    const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([])
    const [editDocuments, setEditDocuments] = useState<ProposalDocument[]>([])
    const selectedScope = Form.useWatch('scope', form)
    const selectedProvince = Form.useWatch('province', form)
    const allCentres = Form.useWatch('allCentres', form)
    const allDepartments = Form.useWatch('allDepartments', form)
    const ownerType: ProposalOwnerType = Form.useWatch('ownerType', form) || 'Individual'

    const provinces = useMemo(() => Array.from(new Set(
        branches.map(branch => branch.province).filter(Boolean) as string[]
    )).sort(), [branches])

    const selectableCentres = useMemo(() => {
        if (selectedScope === 'Provincial') {
            return branches.filter(branch => branch.province === selectedProvince)
        }
        return branches
    }, [branches, selectedProvince, selectedScope])

    // Contributors already on the proposal stay selectable even when they are no
    // longer in the staff list, so editing never drops them.
    const contributorChoices = useMemo(() => {
        const known = new Set(people.map(contributorKey))
        const kept = (proposal?.contributors || []).filter(person => !known.has(contributorKey(person)))
        return [...people, ...kept]
    }, [people, proposal])

    const contributorOptions = useMemo(() => contributorChoices.map(person => ({
        value: contributorKey(person),
        label: `${person.name}${person.email ? ` · ${person.email}` : ''}`
    })), [contributorChoices])

    // Fill the form each time it opens, from the proposal being edited or with
    // the signed-in person's defaults for a new one.
    useEffect(() => {
        if (!open) return
        setPendingDocuments([])
        setEditDocuments([])
        form.resetFields()
        if (!proposal) {
            setStep(0)
            form.setFieldsValue({
                category: 'RFP',
                scope: 'Centre-specific',
                status: 'Draft',
                centres: actor.branchId ? [actor.branchId] : [],
                province: null,
                allCentres: false,
                allDepartments: false,
                departments: [],
                contributorIds: [],
                proposedDate: dayjs(),
                originatorName: actor.name,
                ownerType: 'Individual',
                ownerName: actor.name,
                ownerUserId: actor.id
            })
            return
        }

        setStep(EDIT_SECTION_PICKER)
        listProposalDocuments(proposal).then(setEditDocuments).catch(error =>
            console.error('[ProposalPipeline] Could not load documents for editing', error))
        const proposalProvince = proposal.province ||
            branches.find(branch => branch.id === proposal.centres[0]?.id)?.province || null
        const eligibleCentreIds = (proposal.scope === 'National'
            ? branches
            : branches.filter(branch => branch.province === proposalProvince)).map(branch => branch.id)
        const selectsAllCentres = proposal.allCentres === true ||
            (['National', 'Provincial'].includes(proposal.scope) && eligibleCentreIds.length > 0 &&
                proposal.centres.length === eligibleCentreIds.length)
        const selectsAllDepartments = proposal.allDepartments === true ||
            (departments.length > 0 && proposal.departments.length === departments.length)
        const isIndividual = proposal.owner.type === 'Individual' || !proposal.owner.type
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
            ownerName: isIndividual ? proposal.owner.name : undefined,
            ownerUserId: isIndividual ? proposal.owner.id || undefined : undefined,
            ownerDepartmentId: proposal.owner.type === 'Department' ? proposal.owner.id : undefined,
            ownerCentreId: proposal.owner.type === 'Centre' ? proposal.owner.id : undefined,
            // "All" selections pick up centres and departments added since the last save.
            centres: selectsAllCentres && eligibleCentreIds.length
                ? eligibleCentreIds
                : proposal.centres.map(item => item.id),
            departments: selectsAllDepartments && departments.length
                ? departments.map(item => item.id)
                : proposal.departments.map(item => item.id),
            proposedDate: datePickerValue(proposal.proposedDate),
            submissionDeadline: datePickerValue(proposal.submissionDeadline),
            // Older contributors without an id are matched to a staff record by
            // email; otherwise they keep their own key and stay on the proposal.
            contributorIds: proposal.contributors.map(person => {
                if (person.id) return person.id
                const match = person.email
                    ? people.find(candidate => candidate.email === person.email)
                    : undefined
                return match ? contributorKey(match) : contributorKey(person)
            })
        })
        // Only on opening: later reference changes must not reset what is being typed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, proposal?.id])

    const handleScopeChange = (scope: Proposal['scope']) => {
        if (scope === 'National') {
            form.setFieldsValue({ province: null, allCentres: true, centres: branches.map(branch => branch.id) })
            return
        }
        if (scope === 'Provincial') {
            form.setFieldsValue({ province: null, allCentres: true, centres: [] })
            return
        }
        form.setFieldsValue({ province: null, allCentres: false, centres: actor.branchId ? [actor.branchId] : [] })
    }

    const handleProvinceChange = (province: string) => {
        const provinceCentres = branches.filter(branch => branch.province === province)
        form.setFieldsValue({ province, allCentres: true, centres: provinceCentres.map(branch => branch.id) })
    }

    const handleAllCentresChange = (checked: boolean) => {
        form.setFieldValue('allCentres', checked)
        if (checked) form.setFieldValue('centres', selectableCentres.map(branch => branch.id))
    }

    const handleAllDepartmentsChange = (checked: boolean) => {
        form.setFieldValue('allDepartments', checked)
        if (checked) form.setFieldValue('departments', departments.map(department => department.id))
    }

    const isLastStep = step === PROPOSAL_FORM_STEPS.length - 1

    const goToPreviousStep = () => {
        if (step === 0) {
            onClose()
            return
        }
        setStep(current => current - 1)
    }

    const goToNextStep = async () => {
        if (isLastStep) {
            await save()
            return
        }
        try {
            await form.validateFields(PROPOSAL_FORM_STEPS[step].fields)
            setStep(current => current + 1)
        } catch {
            // Field errors are shown inline on the current step.
        }
    }

    const save = async () => {
        let values: any
        try {
            values = await form.validateFields()
        } catch (error: any) {
            // Jump back to the first step that still has an invalid field.
            const firstError = error?.errorFields?.[0]?.name?.[0]
            const stepIndex = PROPOSAL_FORM_STEPS.findIndex(item => item.fields.includes(firstError))
            if (stepIndex >= 0) setStep(stepIndex)
            return
        }
        const owner = ((): ProposalOwner => {
            if (values.ownerType === 'Department' || values.ownerType === 'Centre') {
                const options = values.ownerType === 'Department' ? departments : branches
                const id = values.ownerType === 'Department' ? values.ownerDepartmentId : values.ownerCentreId
                const reference = options.find(option => option.id === id)
                const previous = proposal?.owner
                return {
                    type: values.ownerType,
                    id,
                    name: reference?.name ||
                        (previous && previous.type === values.ownerType && previous.id === id ? previous.name : id),
                    email: null,
                    role: 'Proposal owner'
                }
            }
            const name = String(values.ownerName || '').trim()
            // Prefer the person picked from the list; then the owner already on the
            // proposal if the name is unchanged; then a name that matches only one person.
            const picked = people.find(candidate => candidate.id === values.ownerUserId)
            const previous = proposal?.owner
            const namesakes = people.filter(candidate => candidate.name === name)
            const person = picked?.name === name
                ? picked
                : previous && (previous.type || 'Individual') === 'Individual' && previous.name === name
                    ? previous
                    : namesakes.length === 1 ? namesakes[0] : undefined
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
                contributorChoices.find(person => contributorKey(person) === id)
            ).filter(Boolean) as ProposalContributor[],
            centres: referencesFromIds(values.centres, branches, proposal?.centres),
            departments: referencesFromIds(values.departments, departments, proposal?.departments),
            proposedDate: values.proposedDate?.toDate?.() || new Date(),
            submissionDeadline: values.submissionDeadline?.toDate?.() || null,
            acceptedAt: proposal?.acceptedAt || null,
            isArchived: values.status === 'Archived'
        }
        setSaving(true)
        try {
            let proposalId = proposal?.id
            if (proposal) {
                await updateProposal(proposal, input, actor)
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

            message.success(proposal
                ? `${proposal.proposalNumber} updated`
                : 'Proposal created and added to the live pipeline')
            if (uploadFailures) {
                message.warning(`${uploadFailures} document${uploadFailures === 1 ? '' : 's'} could not be uploaded.`)
            }
            if (proposalId) onSaved?.(proposalId)
            onClose()
        } catch (error: any) {
            console.error('[ProposalPipeline] Save failed', error)
            message.error(error?.message || 'Could not save the proposal.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal title={<Space>{proposal ? <EditOutlined /> : <FileAddOutlined />}
            {proposal ? `Edit ${proposal.proposalNumber}` : 'Create proposal'}
        </Space>} open={open}
            onCancel={onClose}
            width={760} className='proposal-form-modal'
            footer={proposal
                ? step === EDIT_SECTION_PICKER
                    ? <Button block onClick={onClose}>Cancel</Button>
                    : <div className='proposal-step-footer'>
                        <Button block icon={<ArrowLeftOutlined />} disabled={saving}
                            onClick={() => setStep(EDIT_SECTION_PICKER)}>Sections</Button>
                        <Button block type='primary' loading={saving} onClick={save}>Save changes</Button>
                    </div>
                : <div className='proposal-step-footer'>
                    <Button block icon={step > 0 ? <ArrowLeftOutlined /> : undefined}
                        disabled={saving} onClick={goToPreviousStep}>
                        {step > 0 ? 'Back' : 'Cancel'}
                    </Button>
                    <Button block type='primary' loading={saving} onClick={goToNextStep}
                        icon={isLastStep ? undefined : <ArrowRightOutlined />} iconPosition='end'>
                        {isLastStep ? 'Create proposal' : 'Next'}
                    </Button>
                </div>}>
            <Form form={form} layout='vertical'>
                <Form.Item name='allCentres' valuePropName='checked' hidden><Checkbox /></Form.Item>
                <Form.Item name='allDepartments' valuePropName='checked' hidden><Checkbox /></Form.Item>
                <Form.Item name='ownerUserId' hidden><Input /></Form.Item>
                {!proposal && <Steps size='small' current={step}
                    className='proposal-form-steps' responsive={false}
                    items={PROPOSAL_FORM_STEPS.map(item => ({ title: item.short }))} />}
                {/* Editing opens on a section picker so any section is one click away. */}
                {proposal && step === EDIT_SECTION_PICKER &&
                    <div className='proposal-form-step'>
                        <div className='proposal-form-step-heading'>
                            <strong>What would you like to edit?</strong>
                            <span>Choose a section to open it directly.</span>
                        </div>
                        <div className='proposal-section-picker'>
                            {PROPOSAL_FORM_STEPS.map((item, index) => (
                                <button type='button' key={item.title}
                                    className='proposal-section-option'
                                    onClick={() => setStep(index)}>
                                    <span className='proposal-section-option-icon'>{item.icon}</span>
                                    <span className='proposal-section-option-copy'>
                                        <strong>{item.title}</strong>
                                        <small>{item.description}</small>
                                    </span>
                                    <ArrowRightOutlined className='proposal-section-option-arrow' />
                                </button>
                            ))}
                        </div>
                    </div>}
                {/* Every step stays mounted so the whole form validates on save;
                    only the active one is shown, and it fades in when revealed. */}
                <div className='proposal-form-step' hidden={step !== 0}>
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

                <div className='proposal-form-step' hidden={step !== 1}>
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
                                <AutoComplete
                                    options={people.map(person => ({
                                        key: person.id || person.name,
                                        value: person.name,
                                        label: `${person.name}${person.email ? ` · ${person.email}` : ''}`,
                                        personId: person.id
                                    }))}
                                    onSelect={(_, option: any) => form.setFieldValue('ownerUserId', option?.personId)}
                                    filterOption={(input, option) =>
                                        String(option?.label || '').toLowerCase().includes(input.toLowerCase())}>
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
                            <Select options={formStatuses(proposal?.status)
                                .map(value => ({ label: value, value }))} />
                        </Form.Item></Col>
                    </Row>
                </div>

                <div className='proposal-form-step' hidden={step !== 2}>
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

                <div className='proposal-form-step' hidden={step !== 3}>
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
    )
}
