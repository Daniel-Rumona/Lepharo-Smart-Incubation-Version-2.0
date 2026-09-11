import React, { useEffect, useState } from 'react'
import {
    Card,
    Form,
    Input,
    Select,
    Button,
    Row,
    Col,
    Typography,
    message,
    Steps,
    Divider,
    Alert,
    Space,
    DatePicker,
    Tag
} from 'antd'
import {
    UserOutlined,
    PhoneOutlined,
    MailOutlined,
    BankOutlined,
    SendOutlined,
    CheckCircleOutlined,
    InfoCircleOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { useAuth } from '@/hooks/useAuth'
import { inquiryService } from '@/services/inquiryService'
import { branchService } from '@/services/branchService'
import {
    InquiryFormData,
    InquiryType,
    InquiryPriority,
    ServiceOfInterest,
    FollowUpMethod
} from '@/types/inquiry'
import { Branch } from '@/types/types'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input
const { Option } = Select
const { Step } = Steps

type SubmitProps = {
    embedded?: boolean
    onClose?: () => void
    onSubmitted?: (inquiryId: string) => void
}

const ApplicantInquirySubmission: React.FC<SubmitProps> = ({
    embedded,
    onClose,
    onSubmitted
}) => {
    const [form] = Form.useForm()
    const [currentStep, setCurrentStep] = useState(0)
    const [loading, setLoading] = useState(false)
    const [branches, setBranches] = useState<Branch[]>([])
    const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
    const [submissionComplete, setSubmissionComplete] = useState(false)
    const [formData, setFormData] = useState<any>({}) // Store form data across steps
    const navigate = useNavigate()
    const { user } = useAuth()

    const parseName = (full?: string) => {
        if (!full) return { first: '', last: '' }
        const parts = full.trim().split(/\s+/)
        return { first: parts[0] || '', last: parts.slice(1).join(' ') || '' }
    }

    // only set a field if it's empty and we have a value
    const setIfEmpty = (field: string, value?: any) => {
        if (value == null || value === '') return
        const current = form.getFieldValue(field)
        if (current == null || current === '') {
            form.setFieldsValue({ [field]: value })
        }
    }

    // Initialize form with user data if available
    useEffect(() => {
        if (!user) return

        const nameSource = (user as any).name || (user as any).displayName || ''
        const { first, last } = parseName(nameSource)

        // Seed from identity (don’t clobber user input if already present)
        setIfEmpty('firstName', first)
        setIfEmpty('lastName', last)
        if (user.email) setIfEmpty('email', user.email)

        // Default priority just once
        if (!form.getFieldValue('priority')) {
            form.setFieldsValue({ priority: 'Medium' })
        }
    }, [user?.name, user?.email]) // important: run when identity arrives

    useEffect(() => {
        const loadFromParticipants = async () => {
            if (!user?.email) return
            const emailLower = user.email.toLowerCase()

            // try emailLower field first (recommended pattern)
            let snap = await getDocs(
                query(
                    collection(db, 'participants'),
                    where('emailLower', '==', emailLower)
                )
            )
            if (snap.empty) {
                // fallback to raw email
                snap = await getDocs(
                    query(
                        collection(db, 'participants'),
                        where('email', '==', user.email)
                    )
                )
            }
            if (snap.empty) return

            const data = snap.docs[0].data() as any
            // Be tolerant to schema differences
            const phone = data.phone || data.phoneNumber || data.contact?.phone || ''
            const company =
                data.company ||
                data.companyName ||
                data.organisation ||
                data.organization ||
                data.org ||
                ''
            const position = data.position || data.jobTitle || ''

            // Only fill if the fields are blank
            setIfEmpty('phone', phone)
            setIfEmpty('company', company)
            setIfEmpty('position', position)
        }

        loadFromParticipants().catch(console.error)
    }, [user?.email])

    // Load available branches
    useEffect(() => {
        const loadBranches = async () => {
            try {
                const allBranches = await branchService.getAllBranches()
                // Filter to show only active branches
                const activeBranches = allBranches.filter(
                    branch => branch.status === 'active' && branch.isActive !== false
                )
                setBranches(activeBranches)
            } catch (error) {
                console.error('Error loading branches:', error)
                message.error('Failed to load available branches')
            }
        }

        loadBranches()
    }, [])

    // Restore selected branch when form branchId changes or when entering review step
    useEffect(() => {
        const branchId = form.getFieldValue('branchId')
        if (branchId && branches.length > 0) {
            const branch = branches.find(b => b.id === branchId)
            if (branch && (!selectedBranch || selectedBranch.id !== branchId)) {
                setSelectedBranch(branch)
                console.log('Restored selected branch:', branch.name)
            }
        }
    }, [branches, currentStep]) // Added currentStep dependency

    // Additional effect to ensure branch selection when stepping to review
    useEffect(() => {
        if (currentStep === 3) {
            // Review step
            const branchId = form.getFieldValue('branchId')
            if (branchId && branches.length > 0 && !selectedBranch) {
                const branch = branches.find(b => b.id === branchId)
                if (branch) {
                    setSelectedBranch(branch)
                    console.log('Set selected branch for review:', branch.name)
                }
            }
        }
    }, [currentStep, branches, selectedBranch, form])

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

    const servicesOfInterest: ServiceOfInterest[] = [
        'Business Incubation',
        'Funding Support',
        'Mentorship',
        'Office Space',
        'Legal Support',
        'Marketing Support',
        'Technical Support',
        'Networking',
        'Training Programs'
    ]

    const priorities: InquiryPriority[] = ['Low', 'Medium', 'High', 'Urgent']

    const followUpMethods: FollowUpMethod[] = [
        'Phone',
        'Email',
        'In-person',
        'Video Call'
    ]

    const handleBranchChange = (branchId: string) => {
        const branch = branches.find(b => b.id === branchId)
        setSelectedBranch(branch || null)
        // Ensure form field is updated
        form.setFieldsValue({ branchId })
    }

    const onFinish = async (values: any) => {
        if (!user || !selectedBranch) {
            message.error('Missing required information')
            return
        }

        setLoading(true)
        try {
            // Combine stored form data with current form values
            const currentValues = form.getFieldsValue()
            const completeFormData = { ...formData, ...currentValues }

            // Transform combined form values to InquiryFormData format
            const inquiryData: InquiryFormData = {
                contactInfo: {
                    firstName: completeFormData.firstName,
                    lastName: completeFormData.lastName,
                    email: completeFormData.email,
                    phone: completeFormData.phone,
                    company: completeFormData.company,
                    position: completeFormData.position
                },
                inquiryDetails: {
                    inquiryType: completeFormData.inquiryType,
                    servicesOfInterest: completeFormData.servicesOfInterest,
                    description: completeFormData.description
                },
                priority: completeFormData.priority,
                source: 'system',
                followUp: completeFormData.nextFollowUpDate
                    ? {
                        nextFollowUpDate: completeFormData.nextFollowUpDate.toDate(),
                        followUpMethod: completeFormData.followUpMethod
                    }
                    : undefined
            }

            const inquiryId = await inquiryService.createInquiry(
                inquiryData,
                selectedBranch.id,
                user.uid,
            )

            if (embedded) {
                message.success('Inquiry submitted successfully.')
                onSubmitted?.(inquiryId)
                onClose?.()
                return
            }

            setSubmissionComplete(true)
            message.success(
                'Inquiry submitted successfully! The branch team will contact you soon.'
            )

            // Reset form after successful submission
            form.resetFields()
            setFormData({})
            setCurrentStep(0)
            setSelectedBranch(null)
        } catch (error) {
            console.error('Error submitting inquiry:', error)
            message.error('Failed to submit inquiry')
        } finally {
            setLoading(false)
        }
    }

    const next = () => {
        // Define step-specific required fields
        const stepRequiredFields = {
            0: ['firstName', 'lastName', 'email', 'phone'], // Contact info step
            1: ['inquiryType', 'priority', 'description'], // Inquiry details step
            2: ['branchId'] // Branch selection step
        }

        const currentStepFields =
            stepRequiredFields[currentStep as keyof typeof stepRequiredFields] || []

        if (currentStepFields.length === 0) {
            // Save current form data before moving to next step
            const currentValues = form.getFieldsValue()
            setFormData((prev: any) => ({ ...prev, ...currentValues }))
            setCurrentStep(currentStep + 1)
            return
        }

        form
            .validateFields(currentStepFields)
            .then(() => {
                // Save current form data before moving to next step
                const currentValues = form.getFieldsValue()
                setFormData((prev: any) => ({ ...prev, ...currentValues }))

                // Additional validation for branch selection
                if (currentStep === 2 && !selectedBranch) {
                    message.error('Please select a branch before proceeding')
                    return
                }
                setCurrentStep(currentStep + 1)
            })
            .catch(() => {
                message.error('Please complete all required fields before proceeding')
            })
    }

    const prev = () => {
        // Save current form data before moving to previous step
        const currentValues = form.getFieldsValue()
        setFormData((prev: any) => ({ ...prev, ...currentValues }))
        setCurrentStep(currentStep - 1)
    }

    const submitAnother = () => {
        setSubmissionComplete(false)
        setCurrentStep(0)
        form.resetFields()
        setFormData({})
        setSelectedBranch(null)
    }

    const steps = [
        {
            title: '',
            icon: <UserOutlined />
        },
        {
            title: '',
            icon: <InfoCircleOutlined />
        },
        {
            title: '',
            icon: <BankOutlined />
        },
        {
            title: '',
            icon: <CheckCircleOutlined />
        }
    ]

    if (submissionComplete && !embedded) {
        return (
            <div style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
                <Helmet>
                    <title>Inquiry Submitted | SME Portal</title>
                </Helmet>

                <Card style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <CheckCircleOutlined
                        style={{ fontSize: 64, color: '#52c41a', marginBottom: 16 }}
                    />
                    <Title level={2}>Inquiry Submitted Successfully!</Title>
                    <Paragraph style={{ fontSize: 16, marginBottom: 24 }}>
                        Your inquiry has been sent to{' '}
                        <strong>{selectedBranch?.name}</strong>. The branch team will review
                        your request and contact you within 1-2 business days.
                    </Paragraph>

                    <Space>
                        <Button type='primary' onClick={submitAnother}>
                            Submit Another Inquiry
                        </Button>
                        <Button onClick={() => navigate('/applicant')}>
                            Back to Dashboard
                        </Button>
                    </Space>
                </Card>
            </div>
        )
    }

    const renderStepContent = () => {
        switch (currentStep) {
            case 0:
                return (
                    <Row gutter={[16, 16]}>
                        <Col span={24} style={{ textAlign: 'center' }}>
                            <Title
                                level={4}
                                style={{
                                    marginBottom: 4,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 8
                                }}
                            >
                                <UserOutlined />
                                <span>Contact Information</span>
                            </Title>
                            <br />
                            <Text type='secondary'>
                                Please provide your contact details for the inquiry
                            </Text>
                        </Col>

                        <Col xs={24} sm={12}>
                            <Form.Item
                                name='firstName'
                                label='First Name'
                                rules={[{ required: true, message: 'First name is required' }]}
                            >
                                <Input placeholder='Enter your first name' />
                            </Form.Item>
                        </Col>

                        <Col xs={24} sm={12}>
                            <Form.Item
                                name='lastName'
                                label='Last Name'
                                rules={[{ required: true, message: 'Last name is required' }]}
                            >
                                <Input placeholder='Enter your last name' />
                            </Form.Item>
                        </Col>

                        <Col xs={24} sm={12}>
                            <Form.Item
                                name='email'
                                label='Email Address'
                                rules={[
                                    { type: 'email', message: 'Please enter a valid email' },
                                    { required: true, message: 'Email is required' }
                                ]}
                            >
                                <Input
                                    prefix={<MailOutlined />}
                                    placeholder='your.email@example.com'
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} sm={12}>
                            <Form.Item
                                name='phone'
                                label='Phone Number'
                                rules={[
                                    { required: true, message: 'Phone number is required' }
                                ]}
                            >
                                <Input
                                    prefix={<PhoneOutlined />}
                                    placeholder='+27 XX XXX XXXX'
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} sm={12}>
                            <Form.Item name='company' label='Company/Organization'>
                                <Input placeholder='Enter company name' />
                            </Form.Item>
                        </Col>

                        <Col xs={24} sm={12}>
                            <Form.Item name='position' label='Position/Role'>
                                <Input placeholder='Enter your position' />
                            </Form.Item>
                        </Col>
                    </Row>
                )

            case 1:
                return (
                    <Row gutter={[16, 16]}>
                        <Col span={24} style={{ textAlign: 'center' }}>
                            <Title level={4}>
                                <InfoCircleOutlined /> Inquiry Details
                            </Title>
                            <Text type='secondary'>
                                Tell us about your inquiry and requirements
                            </Text>
                        </Col>

                        <Col xs={24} sm={12}>
                            <Form.Item
                                name='inquiryType'
                                label='Inquiry Type'
                                rules={[
                                    { required: true, message: 'Please select inquiry type' }
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
                                name='priority'
                                label='Priority Level'
                                rules={[{ required: true, message: 'Please select priority' }]}
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

                        <Col span={24}>
                            <Form.Item
                                name='servicesOfInterest'
                                label='Services of Interest (Max 5)'
                            >
                                <Select
                                    mode='multiple'
                                    placeholder="Select services you're interested in"
                                    maxTagCount={5}
                                    maxTagTextLength={20}
                                >
                                    {servicesOfInterest.map(service => (
                                        <Option key={service} value={service}>
                                            {service}
                                        </Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>

                        <Col span={24}>
                            <Form.Item
                                name='description'
                                label='Detailed Description'
                                rules={[
                                    { required: true, message: 'Please provide a description' }
                                ]}
                            >
                                <TextArea
                                    rows={4}
                                    placeholder='Please describe your inquiry, requirements, and any specific needs...'
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                )

            case 2:
                return (
                    <Row gutter={[16, 16]}>
                        <Col span={24} style={{ textAlign: 'center' }}>
                            <Title level={4}>
                                <BankOutlined /> Branch Selection & Follow-up
                            </Title>
                            <Text type='secondary'>
                                Choose which branch should handle your inquiry and set follow-up
                                preferences
                            </Text>
                        </Col>

                        <Col span={24}>
                            <Form.Item
                                name='branchId'
                                label='Target Branch'
                                rules={[{ required: true, message: 'Please select a branch' }]}
                            >
                                <Select
                                    placeholder='Select the branch that should handle your inquiry'
                                    onChange={handleBranchChange}
                                    optionLabelProp='label'
                                >
                                    {branches.map(branch => (
                                        <Option
                                            key={branch.id}
                                            value={branch.id}
                                            label={`${branch.name} - ${branch.location.city}`}
                                        >
                                            <div>
                                                <strong>{branch.name}</strong>
                                                <br />
                                                <Text type='secondary'>
                                                    {branch.location.address}, {branch.location.city}
                                                </Text>
                                                <br />
                                                <Text type='secondary'>
                                                    📞 {branch.contact.phone} | ✉️ {branch.contact.email}
                                                </Text>
                                            </div>
                                        </Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>

                        {selectedBranch && (
                            <Col span={24}>
                                <Alert
                                    message={`Selected Branch: ${selectedBranch.name}`}
                                    description={
                                        <div>
                                            <strong>Location:</strong>{' '}
                                            {selectedBranch.location.address},{' '}
                                            {selectedBranch.location.city}
                                            <br />
                                            <strong>Contact:</strong> {selectedBranch.contact.phone} |{' '}
                                            {selectedBranch.contact.email}
                                        </div>
                                    }
                                    type='info'
                                    showIcon
                                />
                            </Col>
                        )}

                        <Col span={24}>
                            <Divider>Follow-up Preferences (Optional)</Divider>
                        </Col>

                        <Col xs={24} sm={12}>
                            <Form.Item
                                name='nextFollowUpDate'
                                label='Preferred Follow-up Date'
                            >
                                <DatePicker
                                    style={{ width: '100%' }}
                                    disabledDate={current =>
                                        current && current < dayjs().endOf('day')
                                    }
                                    placeholder='Select preferred date'
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} sm={12}>
                            <Form.Item name='followUpMethod' label='Preferred Contact Method'>
                                <Select placeholder='Select contact method'>
                                    {followUpMethods.map(method => (
                                        <Option key={method} value={method}>
                                            {method}
                                        </Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>
                    </Row>
                )

            case 3:
                // Combine current form values with stored form data
                const currentValues = form.getFieldsValue()
                const combinedFormData = { ...formData, ...currentValues }

                // Check for missing required fields
                const missingFields = []
                if (!combinedFormData.firstName?.trim())
                    missingFields.push('First Name')
                if (!combinedFormData.lastName?.trim()) missingFields.push('Last Name')
                if (!combinedFormData.email?.trim()) missingFields.push('Email')
                if (!combinedFormData.phone?.trim()) missingFields.push('Phone')
                if (!combinedFormData.inquiryType) missingFields.push('Inquiry Type')
                if (!combinedFormData.priority) missingFields.push('Priority')
                if (!combinedFormData.description?.trim())
                    missingFields.push('Description')
                if (!selectedBranch || !combinedFormData.branchId)
                    missingFields.push('Branch Selection')

                return (
                    <Row gutter={[16, 16]}>
                        <Col span={24} style={{ textAlign: 'center' }}>
                            <Title level={4}>
                                <CheckCircleOutlined /> Review & Submit
                            </Title>
                            <Text type='secondary'>
                                Please review your inquiry details before submitting
                            </Text>
                        </Col>

                        <Col span={24}>
                            <Card title='Contact Information' size='small'>
                                <Row gutter={[8, 8]}>
                                    <Col span={12}>
                                        <strong>Name:</strong>{' '}
                                        {combinedFormData.firstName || 'Not provided'}{' '}
                                        {combinedFormData.lastName || ''}
                                    </Col>
                                    <Col span={12}>
                                        <strong>Email:</strong>{' '}
                                        {combinedFormData.email || 'Not provided'}
                                    </Col>
                                    <Col span={12}>
                                        <strong>Phone:</strong>{' '}
                                        {combinedFormData.phone || 'Not provided'}
                                    </Col>
                                    <Col span={12}>
                                        <strong>Company:</strong>{' '}
                                        {combinedFormData.company || 'Not specified'}
                                    </Col>
                                    <Col span={12}>
                                        <strong>Position:</strong>{' '}
                                        {combinedFormData.position || 'Not specified'}
                                    </Col>
                                </Row>
                            </Card>
                        </Col>

                        <Col span={24}>
                            <Card title='Inquiry Details' size='small'>
                                <Row gutter={[8, 8]}>
                                    <Col span={12}>
                                        <strong>Type:</strong>{' '}
                                        {combinedFormData.inquiryType || 'Not specified'}
                                    </Col>
                                    <Col span={12}>
                                        <strong>Priority:</strong>
                                        {combinedFormData.priority ? (
                                            <Tag
                                                color={
                                                    combinedFormData.priority === 'Urgent'
                                                        ? 'red'
                                                        : combinedFormData.priority === 'High'
                                                            ? 'orange'
                                                            : 'blue'
                                                }
                                                style={{ marginLeft: 10 }}
                                            >
                                                {combinedFormData.priority}
                                            </Tag>
                                        ) : (
                                            'Not specified'
                                        )}
                                    </Col>

                                    <Col span={24}>
                                        <strong>Services of Interest:</strong>{' '}
                                        {combinedFormData.servicesOfInterest?.join(', ') ||
                                            'None selected'}
                                    </Col>
                                    <Col span={24}>
                                        <strong>Description:</strong> <br />
                                        {combinedFormData.description || 'No description provided'}
                                    </Col>
                                </Row>
                            </Card>
                        </Col>

                        <Col span={24}>
                            <Card title='Branch & Follow-up' size='small'>
                                <Row gutter={[8, 8]}>
                                    <Col span={24}>
                                        <strong>Target Branch:</strong>{' '}
                                        {selectedBranch?.name
                                            ? `${selectedBranch.name} - ${selectedBranch.location.city}`
                                            : 'Not selected'}
                                    </Col>
                                    {combinedFormData.nextFollowUpDate && (
                                        <Col span={12}>
                                            <strong>Follow-up Date:</strong>{' '}
                                            {dayjs(combinedFormData.nextFollowUpDate).format(
                                                'YYYY-MM-DD'
                                            )}
                                        </Col>
                                    )}
                                    {combinedFormData.followUpMethod && (
                                        <Col span={12}>
                                            <strong>Contact Method:</strong>{' '}
                                            {combinedFormData.followUpMethod}
                                        </Col>
                                    )}
                                </Row>
                            </Card>
                        </Col>

                        {/* Warning if missing critical data */}
                        {missingFields.length > 0 && (
                            <Col span={24}>
                                <Alert
                                    message='Missing Required Information'
                                    description={
                                        <div>
                                            The following required fields are missing:{' '}
                                            <strong>{missingFields.join(', ')}</strong>
                                            <br />
                                            Please go back and complete these fields before
                                            submitting.
                                        </div>
                                    }
                                    type='warning'
                                    showIcon
                                />
                            </Col>
                        )}
                    </Row>
                )

            default:
                return null
        }
    }

    return (
        <div style={{ background: '#fff' }}>
            <Card style={{ maxWidth: 1200, margin: '0 auto' }}>
                <Steps
                    current={currentStep}
                    items={steps}
                    style={{ marginBottom: 32 }}
                />

                <Form
                    form={form}
                    layout='vertical'
                    onFinish={onFinish}
                    requiredMark={false}
                >
                    {renderStepContent()}

                    <Divider />

                    <div style={{ textAlign: 'center' }}>
                        {currentStep > 0 && (
                            <Button style={{ marginRight: 8 }} onClick={prev}>
                                Previous
                            </Button>
                        )}

                        {currentStep < steps.length - 1 && (
                            <Button type='primary' onClick={next}>
                                Next
                            </Button>
                        )}

                        {currentStep === steps.length - 1 && (
                            <Button
                                type='primary'
                                htmlType='submit'
                                loading={loading}
                                size='large'
                                icon={<SendOutlined />}
                                disabled={(() => {
                                    const currentValues = form.getFieldsValue()
                                    const combinedData = { ...formData, ...currentValues }
                                    const missingFields = []
                                    if (!combinedData.firstName?.trim())
                                        missingFields.push('First Name')
                                    if (!combinedData.lastName?.trim())
                                        missingFields.push('Last Name')
                                    if (!combinedData.email?.trim()) missingFields.push('Email')
                                    if (!combinedData.phone?.trim()) missingFields.push('Phone')
                                    if (!combinedData.inquiryType)
                                        missingFields.push('Inquiry Type')
                                    if (!combinedData.priority) missingFields.push('Priority')
                                    if (!combinedData.description?.trim())
                                        missingFields.push('Description')
                                    if (!selectedBranch || !combinedData.branchId)
                                        missingFields.push('Branch Selection')
                                    return missingFields.length > 0
                                })()}
                            >
                                Submit Inquiry
                            </Button>
                        )}
                    </div>
                </Form>
            </Card>
        </div>
    )
}

export default ApplicantInquirySubmission
