import React, { useEffect, useState, useCallback } from 'react'
import {
    Form,
    Input,
    Select,
    DatePicker,
    Button,
    Card,
    Row,
    Col,
    Space,
    message,
    Switch,
    Steps
} from 'antd'
import {
    SaveOutlined,
    ClearOutlined,
    SearchOutlined,
    ArrowLeftOutlined,
    ArrowRightOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import {
    InquiryFormData,
    InquiryType,
    InquiryPriority,
    BusinessStage,
    BudgetRange,
    Timeline,
    FollowUpMethod,
    INQUIRY_VALIDATION
} from '@/types/inquiry'
import { inquiryService } from '@/services/inquiryService'
import { useAuth } from '@/hooks/useAuth'
import {
    collection,
    getDocs,
    query,
    where,
    limit,
    getDoc,
    doc
} from 'firebase/firestore'
import { db } from '@/firebase'

const { TextArea } = Input
const { Option } = Select

type SourceType = 'Incubatee' | 'Non-Incubatee'

interface InquiryFormProps {
    initialData?: Partial<InquiryFormData>
    inquiryId?: string
    onSuccess?: () => void
    embedded?: boolean
    stepped?: boolean
    forcedProgramId?: string
    forcedProgramName?: string
}

interface Program {
    id: string
    name: string
    isActive?: boolean
}

const ACCEPTED_VALUES = ['accepted', 'approved', 'Accepted', 'Approved', true]

const InquiryForm: React.FC<InquiryFormProps> = ({
    initialData,
    inquiryId,
    onSuccess,
    embedded = false,
    stepped = false,
    forcedProgramId,
    forcedProgramName
}) => {
    const [form] = Form.useForm()
    const [loading, setLoading] = useState(false)
    const [requiresFollowUp, setRequiresFollowUp] = useState(false)
    const [sourceType, setSourceType] = useState<SourceType>('Non-Incubatee')
    const [programs, setPrograms] = useState<Program[]>([])
    const [fetchingIncubatee, setFetchingIncubatee] = useState(false)
    const [contactLocked, setContactLocked] = useState(false)
    const [departmentOptions, setDepartmentOptions] = useState<string[]>([])
    const [currentStep, setCurrentStep] = useState(0)
    const navigate = useNavigate()
    const { user } = useAuth()

    useEffect(() => {
        if (forcedProgramId) {
            form.setFieldsValue({ programId: forcedProgramId })
        }
    }, [forcedProgramId, form])

    useEffect(() => {
        const values = initialData as any
        const initialSourceType = values?.sourceTypeInternal || values?.sourceType
        if (initialSourceType === 'Incubatee' || initialSourceType === 'Non-Incubatee') {
            setSourceType(initialSourceType)
        }
        setRequiresFollowUp(
            Boolean(values?.nextFollowUpDate || values?.followUpMethod || values?.followUpNotes)
        )
    }, [initialData])

    // Static options (unchanged lists)
    const inquiryTypes: InquiryType[] = [
        'General Information',
        'Incubation Program',
        'Funding',
        'Mentorship',
        'Office Space',
        'Training',
        'Networking',
        'Partnership',
        'Other'
    ]
    const priorities: InquiryPriority[] = ['Low', 'Medium', 'High', 'Urgent']
    const budgetRanges: BudgetRange[] = [
        'Under R10k',
        'R10k - R50k',
        'R50k - R100k',
        'R100k - R500k',
        'R500k - R1M',
        'Over R1M',
        'To be discussed'
    ]
    const timelines: Timeline[] = [
        'Immediate',
        'Within 1 month',
        '1-3 months',
        '3-6 months',
        '6-12 months',
        'Over 1 year',
        'Flexible'
    ]
    const followUpMethods: FollowUpMethod[] = [
        'Phone',
        'Email',
        'In-person',
        'Video Call'
    ]

    // Load programs from the canonical programs collection only.
    useEffect(() => {
        const loadPrograms = async () => {
            try {
                const snap = await getDocs(collection(db, 'programs'))
                const arr = snap.docs.map(d => {
                    const data = d.data() as any
                    return {
                        id: d.id,
                        name: data.name || data.title || 'Program',
                        isActive: data.isActive
                    } as Program
                })
                setPrograms(arr)
            } catch (e) {
                console.error('Failed to load programs', e)
                setPrograms([])
            }
        }

        loadPrograms()
    }, [])

    // Load departments enabled for interventions.
    useEffect(() => {
        const loadDepartments = async () => {
            try {
                const qRef = query(
                    collection(db, 'departments'),
                    where('interventionsDepartment', '==', true)
                )
                const snap = await getDocs(qRef)
                const depts = snap.docs
                    .map(d => {
                        const data = d.data() as any
                        return data?.name || data?.departmentName
                    })
                    .filter(Boolean) as string[]

                setDepartmentOptions(depts)
            } catch (e) {
                console.error('Failed to load departments', e)
                setDepartmentOptions([])
            }
        }

        loadDepartments()
    }, [])

    const normalizeEmail = (e: string) => (e || '').trim().toLowerCase()

    const splitName = (
        full?: string
    ): { firstName: string; lastName: string } => {
        const safe = (full || '').trim()
        if (!safe) return { firstName: '', lastName: '' }
        const parts = safe.split(/\s+/)
        if (parts.length === 1) return { firstName: parts[0], lastName: '' }
        const firstName = parts[0]
        const lastName = parts.slice(1).join(' ')
        return { firstName, lastName }
    }

    const fetchIncubatee = useCallback(async () => {
        const email: string = normalizeEmail(form.getFieldValue('email'))
        const programId: string = form.getFieldValue('programId')

        if (!email) {
            message.warning('Please enter the incubatee email.')
            return
        }
        if (!programId) {
            message.warning('Please select a program first.')
            return
        }
        setFetchingIncubatee(true)
        try {
            // 1) Find accepted application for this email+program
            const appsQ = query(
                collection(db, 'applications'),
                where('email', '==', email),
                where('programId', '==', programId),
                limit(5)
            )
            const appsSnap = await getDocs(appsQ)
            const acceptedApp = appsSnap.docs.find(d => {
                const data = d.data() as any
                const status = data?.status ?? data?.applicationStatus ?? data?.decision
                return ACCEPTED_VALUES.includes(status)
            })

            if (!acceptedApp) {
                message.error('No accepted application found for this email & program.')
                setContactLocked(false)
                return
            }
            const app = acceptedApp.data() as any
            const participantId = app?.participantId
            if (!participantId) {
                message.error('Application has no participantId link.')
                setContactLocked(false)
                return
            }

            // 2) Fetch participant by participantId
            const participantRef = doc(db, 'participants', participantId)
            const pSnap = await getDoc(participantRef)

            if (pSnap.exists()) {
                const participant = pSnap.data()

                // Autofill form
                const [firstName, ...lastNameParts] = (
                    participant.participantName || ''
                ).split(' ')

                form.setFieldsValue({
                    firstName,
                    lastName: lastNameParts.join(' '),
                    phone: participant.phone || '',
                    company: participant.beneficiaryName || '',
                    position: 'CEO',
                    businessStage: app.stage || '',
                    industry: participant.sector || ''
                })
            } else {
                message.error('Participant record not found.')
            }

            // Lock contact fields after autofill
            setContactLocked(true)
            message.success('Incubatee verified and details autofilled.')
        } catch (err) {
            console.error('Error fetching incubatee:', err)
            message.error('Failed to fetch incubatee details.')
            setContactLocked(false)
        } finally {
            setFetchingIncubatee(false)
        }
    }, [form])

    // Reset locks when toggling source type
    useEffect(() => {
        if (sourceType === 'Non-Incubatee') {
            setContactLocked(false)
            form.setFieldsValue({ programId: forcedProgramId || undefined })
        }
    }, [sourceType, form, forcedProgramId])

    const handleSubmit = async (values: any) => {
        if (!user?.assignedBranch) {
            message.error('No branch assigned. Please contact your administrator.')
            return
        }
        try {
            setLoading(true)
            // If Non-Incubatee, ensure no stray programId is set
            const programId =
                sourceType === 'Incubatee'
                    ? forcedProgramId || values.programId
                    : null

            const inquiryData: InquiryFormData = {
                contactInfo: {
                    firstName: values.firstName,
                    lastName: values.lastName,
                    email: values.email || '',
                    phone: values.phone || '',
                    company: values.company || '',
                    position: values.position || (sourceType === 'Incubatee' ? 'CEO' : '')
                },
                inquiryDetails: {
                    inquiryType: values.inquiryType,
                    businessStage: values.businessStage || '',
                    industry: values.industry || '',
                    department: values.department || '',
                    description: values.description,
                    budget: values.budget || '',
                    timeline: values.timeline || ''
                },
                priority: values.priority,
                // store the new meaning here
                source: 'Walk-in',
                classification: values.classification || 'General',
                tags: values.tags || [],
                ...(requiresFollowUp &&
                    (values.nextFollowUpDate ||
                        values.followUpMethod ||
                        values.followUpNotes) && {
                    followUp: {
                        ...(values.nextFollowUpDate && {
                            nextFollowUpDate: values.nextFollowUpDate.toDate()
                        }),
                        ...(values.followUpMethod && {
                            followUpMethod: values.followUpMethod
                        }),
                        assignedTo: values.assignedTo || user.uid,
                        ...(values.followUpNotes && { notes: values.followUpNotes })
                    }
                })
            }

            const selectedProgram = programs.find(p => p.id === programId)

            // Enrich with program only if incubatee
            const enriched: any = {
                ...inquiryData,
                ...(sourceType === 'Incubatee' && {
                    programId: programId,
                    programName: forcedProgramName || selectedProgram?.name || null
                }),
                sourceType
            }

            if (inquiryId) {
                await inquiryService.updateInquiry(inquiryId, enriched)
                message.success('Inquiry updated successfully!')
            } else {
                const newInquiryId = await inquiryService.createInquiry(
                    enriched,
                    user.assignedBranch,
                    user.uid
                )
                message.success('Inquiry created successfully!')
            }

            onSuccess?.()
            if (!embedded) navigate('/receptionist/inquiries')
        } catch (error) {
            console.error('Error saving inquiry:', error)
            message.error('Failed to save inquiry. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const handleClear = () => {
        form.resetFields()
        setRequiresFollowUp(false)
        setContactLocked(false)
        setSourceType('Non-Incubatee')
        setCurrentStep(0)
        if (forcedProgramId) {
            form.setFieldsValue({ programId: forcedProgramId })
        }
    }

    const handleNextStep = async () => {
        const fields =
            currentStep === 0
                ? ['sourceTypeInternal', 'firstName', 'lastName', 'email', 'phone']
                : ['inquiryType', 'department', 'description', 'priority', 'classification']

        try {
            await form.validateFields(fields)
            setCurrentStep(step => Math.min(step + 1, 2))
        } catch {
            // Ant Design displays the relevant field validation messages.
        }
    }

    // Guard: user without branch
    if (user && !user.assignedBranch) {
        return (
            <div style={{ padding: 24, textAlign: 'center' }}>
                <Card style={{ maxWidth: 500, margin: '0 auto' }}>
                    <div style={{ padding: '40px 20px' }}>
                        <h2>🏢 Branch Assignment Required</h2>
                        <p style={{ fontSize: 16, color: '#666', marginBottom: 24 }}>
                            You need to be assigned to a branch to create inquiries.
                        </p>
                        <p style={{ fontSize: 14, color: '#888' }}>
                            Please contact your <strong>Director</strong> to assign you to a
                            branch through the User Management system.
                        </p>
                        <p style={{ fontSize: 12, color: '#aaa', marginTop: 20 }}>
                            Directors can assign branches via:{' '}
                            <em>User Management → Edit User → Select Branch</em>
                        </p>
                    </div>
                </Card>
            </div>
        )
    }

    return (
        <div
            style={{
                padding: embedded ? 0 : 24,
                maxWidth: 1200,
                margin: '0 auto'
            }}
        >
            <Card
                bordered={!embedded}
                styles={{ body: { padding: embedded ? 0 : 24 } }}
                title={embedded ? undefined : inquiryId ? 'Edit Inquiry' : 'New Inquiry'}
                extra={
                    embedded || stepped ? null : <Space>
                        <Button
                            icon={<ClearOutlined />}
                            onClick={handleClear}
                            disabled={loading}
                        >
                            Clear
                        </Button>
                        <Button
                            type='primary'
                            icon={<SaveOutlined />}
                            loading={loading}
                            onClick={() => form.submit()}
                        >
                            {inquiryId ? 'Update' : 'Save'} Inquiry
                        </Button>
                    </Space>
                }
            >
                {stepped && (
                    <Steps
                        current={currentStep}
                        size='small'
                        style={{ marginBottom: 24 }}
                        items={[
                            { title: 'Contact' },
                            { title: 'Inquiry' },
                            { title: 'Follow-up' }
                        ]}
                    />
                )}
                <Form
                    form={form}
                    layout='vertical'
                    onFinish={handleSubmit}
                    initialValues={initialData}
                    size='large'
                >
                    <div style={{ display: !stepped || currentStep === 0 ? 'block' : 'none' }}>
                        {/* Program & Source */}
                        <Card
                            type='inner'
                            title='Contact Type'
                            style={{ marginBottom: 24 }}
                        >
                            {/* Source row reacts to sourceType:
                - Non-Incubatee: Source spans full width
                - Incubatee: Source + Email share the row, aligned */}
                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={sourceType === 'Incubatee' ? 12 : 24}>
                                    <Form.Item
                                        label='Contact Type'
                                        name='sourceTypeInternal'
                                        initialValue={sourceType}
                                        rules={[
                                            { required: true, message: 'Please select a source type' }
                                        ]}
                                    >
                                        <Select
                                            value={sourceType}
                                            onChange={(v: SourceType) => {
                                                setSourceType(v)
                                                if (v === 'Non-Incubatee') {
                                                    setContactLocked(false)
                                                    form.setFieldsValue({
                                                        programId: forcedProgramId || undefined
                                                    })
                                                }
                                            }}
                                        >
                                            <Option value='Incubatee'>Incubatee</Option>
                                            <Option value='Non-Incubatee'>Non-Incubatee</Option>
                                        </Select>
                                    </Form.Item>
                                </Col>

                                {sourceType === 'Incubatee' && (
                                    <Col xs={24} sm={12}>
                                        <Form.Item
                                            label='Incubatee Email'
                                            name='email'
                                            rules={[
                                                {
                                                    required: true,
                                                    message: 'Email is required for Incubatee'
                                                },
                                                {
                                                    type: 'email',
                                                    message: 'Please enter a valid email address'
                                                }
                                            ]}
                                        >
                                            <Input
                                                placeholder='Enter incubatee email'
                                                addonAfter={
                                                    <Button
                                                        size='small'
                                                        type='primary'
                                                        icon={<SearchOutlined />}
                                                        loading={fetchingIncubatee}
                                                        onClick={fetchIncubatee}
                                                    >
                                                        Verify & Autofill
                                                    </Button>
                                                }
                                            />
                                        </Form.Item>
                                    </Col>
                                )}
                            </Row>

                            {sourceType === 'Incubatee' && forcedProgramId && (
                                <Form.Item name='programId' hidden>
                                    <Input />
                                </Form.Item>
                            )}

                            {sourceType === 'Incubatee' && !forcedProgramId && (
                                <Row gutter={[16, 0]}>
                                    <Col xs={24} sm={12}>
                                        <Form.Item
                                            label='Program'
                                            name='programId'
                                            rules={[
                                                { required: true, message: 'Please select a program' }
                                            ]}
                                        >
                                            <Select
                                                placeholder='Select program'
                                                loading={!programs}
                                                showSearch
                                                optionFilterProp='children'
                                                filterOption={(input, option) =>
                                                    (option?.children as string)
                                                        ?.toLowerCase()
                                                        .includes(input.toLowerCase())
                                                }
                                            >
                                                {programs.map(p => (
                                                    <Option key={p.id} value={p.id}>
                                                        {p.name}
                                                    </Option>
                                                ))}
                                            </Select>
                                        </Form.Item>
                                    </Col>
                                </Row>
                            )}
                        </Card>

                        {/* Contact Information */}
                        <Card
                            type='inner'
                            title='Contact Information'
                            style={{ marginBottom: 24 }}
                        >
                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='First Name'
                                        name='firstName'
                                        rules={[
                                            { required: true, message: 'First name is required' },
                                            {
                                                max: 50,
                                                message: 'First name must be less than 50 characters'
                                            }
                                        ]}
                                    >
                                        <Input
                                            placeholder='Enter first name'
                                            disabled={contactLocked}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Last Name'
                                        name='lastName'
                                        rules={[
                                            { required: true, message: 'Last name is required' },
                                            {
                                                max: 50,
                                                message: 'Last name must be less than 50 characters'
                                            }
                                        ]}
                                    >
                                        <Input
                                            placeholder='Enter last name'
                                            disabled={contactLocked}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Email'
                                        name='email'
                                        rules={[
                                            ({ getFieldValue }) => ({
                                                validator(_, value) {
                                                    if (sourceType === 'Non-Incubatee' && !value) {
                                                        return Promise.reject(new Error('Email is required'))
                                                    }
                                                    if (value && !/^\S+@\S+\.\S+$/.test(value)) {
                                                        return Promise.reject(
                                                            new Error('Please enter a valid email address')
                                                        )
                                                    }
                                                    return Promise.resolve()
                                                }
                                            })
                                        ]}
                                    >
                                        <Input
                                            placeholder='Enter email address'
                                            disabled={contactLocked && sourceType === 'Incubatee'}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Phone'
                                        name='phone'
                                        rules={[
                                            {
                                                pattern: /^[\d\s\+\-\(\)]+$/,
                                                message: 'Please enter a valid phone number'
                                            }
                                        ]}
                                    >
                                        <Input
                                            placeholder='Enter phone number'
                                            disabled={contactLocked}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item label='Company' name='company'>
                                        <Input
                                            placeholder='Enter company name (optional)'
                                            disabled={contactLocked}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Position'
                                        name='position'
                                        initialValue={sourceType === 'Incubatee' ? 'CEO' : undefined}
                                    >
                                        <Input
                                            placeholder='Enter job position (optional)'
                                            disabled={contactLocked}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            {/* Require either email or phone overall */}
                            <Form.Item
                                dependencies={['email', 'phone']}
                                rules={[
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            const email = getFieldValue('email')
                                            const phone = getFieldValue('phone')
                                            if (!email && !phone) {
                                                return Promise.reject(
                                                    new Error('Either email or phone number is required')
                                                )
                                            }
                                            return Promise.resolve()
                                        }
                                    })
                                ]}
                            >
                                <div />
                            </Form.Item>
                        </Card>
                    </div>

                    <div style={{ display: !stepped || currentStep === 1 ? 'block' : 'none' }}>
                        {/* Inquiry Details */}
                        <Card
                            type='inner'
                            title='Inquiry Details'
                            style={{ marginBottom: 24 }}
                        >
                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item label='Industry' name='industry'>
                                        <Input placeholder='Enter industry (optional)' />
                                    </Form.Item>
                                </Col>

                                <Col xs={24} sm={12}>
                                    <Form.Item label='Business Stage' name='businessStage'>
                                        <Select placeholder='Select business stage (optional)'>
                                            {(
                                                [
                                                    'Idea Stage',
                                                    'Startup',
                                                    'Early Stage',
                                                    'Growth Stage',
                                                    'Established',
                                                    'Not Applicable'
                                                ] as BusinessStage[]
                                            ).map(stage => (
                                                <Option key={stage} value={stage}>
                                                    {stage}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Inquiry Type'
                                        name='inquiryType'
                                        rules={[
                                            { required: true, message: 'Please select an inquiry type' }
                                        ]}
                                    >
                                        <Select placeholder='Select inquiry type'>
                                            {inquiryTypes.map(type => (
                                                <Option key={type} value={type}>
                                                    {type}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Department'
                                        name='department'
                                        rules={[{ required: true, message: 'Please select a department' }]}
                                    >
                                        <Select
                                            placeholder='Select intervention department'
                                            showSearch
                                            optionFilterProp='children'
                                        >
                                            {departmentOptions.map(department => (
                                                <Option key={department} value={department}>
                                                    {department}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Form.Item
                                label='Description'
                                name='description'
                                rules={[
                                    { required: true, message: 'Description is required' },
                                    {
                                        max: INQUIRY_VALIDATION.MAX_DESCRIPTION_LENGTH,
                                        message: `Description must be less than ${INQUIRY_VALIDATION.MAX_DESCRIPTION_LENGTH} characters`
                                    }
                                ]}
                            >
                                <TextArea
                                    rows={4}
                                    placeholder='Enter detailed description of the inquiry'
                                    showCount
                                    maxLength={INQUIRY_VALIDATION.MAX_DESCRIPTION_LENGTH}
                                />
                            </Form.Item>
                        </Card>

                        {/* Inquiry Management */}
                        <Card
                            type='inner'
                            title='Inquiry Management'
                            style={{ marginBottom: 24 }}
                        >
                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Priority'
                                        name='priority'
                                        rules={[
                                            { required: true, message: 'Please select a priority' }
                                        ]}
                                    >
                                        <Select placeholder='Select priority'>
                                            {priorities.map(priority => (
                                                <Option key={priority} value={priority}>
                                                    {priority}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Classification'
                                        name='classification'
                                        initialValue='General'
                                        rules={[{ required: true, message: 'Please select a classification' }]}
                                    >
                                        <Select
                                            options={[
                                                { value: 'General', label: 'General' },
                                                { value: 'Potential', label: 'Potential' }
                                            ]}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Card>
                    </div>

                    <div style={{ display: !stepped || currentStep === 2 ? 'block' : 'none' }}>
                        {/* Follow-up */}
                        <Card
                            type='inner'
                            title={
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span>Follow-up</span>
                                    <Switch
                                        size='small'
                                        checked={requiresFollowUp}
                                        onChange={setRequiresFollowUp}
                                    />
                                </div>
                            }
                        >
                            {requiresFollowUp && (
                                <Row gutter={[16, 0]}>
                                    <Col xs={24} sm={12}>
                                        <Form.Item
                                            label='Next Follow-up Date'
                                            name='nextFollowUpDate'
                                            rules={
                                                requiresFollowUp
                                                    ? [
                                                        {
                                                            required: true,
                                                            message: 'Please select a follow-up date'
                                                        }
                                                    ]
                                                    : []
                                            }
                                        >
                                            <DatePicker
                                                style={{ width: '100%' }}
                                                placeholder='Select follow-up date'
                                                disabledDate={(current: any) =>
                                                    current && current < Date.now()
                                                }
                                            />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} sm={12}>
                                        <Form.Item
                                            label='Follow-up Method'
                                            name='followUpMethod'
                                            rules={
                                                requiresFollowUp
                                                    ? [
                                                        {
                                                            required: true,
                                                            message: 'Please select a follow-up method'
                                                        }
                                                    ]
                                                    : []
                                            }
                                        >
                                            <Select placeholder='Select follow-up method'>
                                                {followUpMethods.map(method => (
                                                    <Option key={method} value={method}>
                                                        {method}
                                                    </Option>
                                                ))}
                                            </Select>
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24}>
                                        <Form.Item
                                            label='Follow-up Notes'
                                            name='followUpNotes'
                                            rules={[
                                                {
                                                    max: INQUIRY_VALIDATION.MAX_FOLLOW_UP_NOTES_LENGTH,
                                                    message: `Notes must be less than ${INQUIRY_VALIDATION.MAX_FOLLOW_UP_NOTES_LENGTH} characters`
                                                }
                                            ]}
                                        >
                                            <TextArea
                                                rows={3}
                                                placeholder='Enter follow-up notes (optional)'
                                                showCount
                                                maxLength={INQUIRY_VALIDATION.MAX_FOLLOW_UP_NOTES_LENGTH}
                                            />
                                        </Form.Item>
                                    </Col>
                                </Row>
                            )}
                        </Card>
                    </div>

                    {stepped && (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: `repeat(${currentStep > 0 ? 3 : 2}, minmax(0, 1fr))`,
                                gap: 12,
                                marginTop: 20
                            }}
                        >
                            <Button
                                block
                                size='large'
                                icon={<ClearOutlined />}
                                onClick={handleClear}
                                disabled={loading}
                            >
                                Clear
                            </Button>
                            {currentStep > 0 && (
                                <Button
                                    block
                                    size='large'
                                    icon={<ArrowLeftOutlined />}
                                    onClick={() => setCurrentStep(step => Math.max(step - 1, 0))}
                                    disabled={loading}
                                >
                                    Previous
                                </Button>
                            )}
                            {currentStep < 2 ? (
                                <Button
                                    block
                                    size='large'
                                    type='primary'
                                    icon={<ArrowRightOutlined />}
                                    iconPosition='end'
                                    onClick={handleNextStep}
                                >
                                    Next
                                </Button>
                            ) : (
                                <Button
                                    block
                                    size='large'
                                    type='primary'
                                    icon={<SaveOutlined />}
                                    loading={loading}
                                    onClick={() => form.submit()}
                                >
                                    Save Inquiry
                                </Button>
                            )}
                        </div>
                    )}
                </Form>
            </Card>
        </div>
    )
}

export default InquiryForm
