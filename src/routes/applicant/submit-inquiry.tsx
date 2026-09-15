import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Col,
    DatePicker,
    Form,
    Input,
    Progress,
    Row,
    Select,
    Space,
    Tag,
    Typography,
    message,
    theme
} from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    BankOutlined,
    CheckCircleOutlined,
    CheckOutlined,
    DollarOutlined,
    EllipsisOutlined,
    GlobalOutlined,
    HomeOutlined,
    InfoCircleOutlined,
    LinkOutlined,
    ReadOutlined,
    RocketOutlined,
    SendOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import {
    collection,
    getDocs,
    query,
    where
} from 'firebase/firestore'

import { useAuth } from '@/hooks/useAuth'
import { inquiryService } from '@/services/inquiryService'
import { branchService } from '@/services/branchService'
import {
    guideTarget,
    useGuide,
    type PageGuideRegistration
} from '@/components/guide-me'
import {
    FollowUpMethod,
    InquiryFormData,
    InquiryPriority,
    InquiryType,
    ServiceOfInterest
} from '@/types/inquiry'
import { Branch } from '@/types/types'
import { db } from '@/firebase'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

type SubmitProps = {
    embedded?: boolean
    onClose?: () => void
    onSubmitted?: (inquiryId: string) => void
}

type ConversationStep =
    | 'inquiry'
    | 'routing'
    | 'preferences'
    | 'review'

type ProfileContact = {
    firstName: string
    lastName: string
    email: string
    phone: string
    company: string
    position: string
}

const emptyProfileContact: ProfileContact = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    position: ''
}

type TypewriterTextProps = {
    text: string
    speed?: number
}

const TypewriterText: React.FC<TypewriterTextProps> = ({
    text,
    speed = 26
}) => {
    const [displayedText, setDisplayedText] = useState('')

    useEffect(() => {
        setDisplayedText('')

        let index = 0

        const timer = window.setInterval(() => {
            index += 1

            setDisplayedText(
                text.slice(0, index)
            )

            if (index >= text.length) {
                window.clearInterval(timer)
            }
        }, speed)

        return () => {
            window.clearInterval(timer)
        }
    }, [text, speed])

    return <>{displayedText}</>
}

const steps: ConversationStep[] = [
    'inquiry',
    'routing',
    'preferences',
    'review'
]

const inquiryTypeOptions: {
    value: InquiryType
    label: string
    icon: React.ReactNode
}[] = [
        {
            value: 'General Information',
            label: 'General Information',
            icon: <InfoCircleOutlined />
        },
        {
            value: 'Incubation Program',
            label: 'Incubation Program',
            icon: <RocketOutlined />
        },
        {
            value: 'Funding',
            label: 'Funding',
            icon: <DollarOutlined />
        },
        {
            value: 'Mentorship',
            label: 'Mentorship',
            icon: <TeamOutlined />
        },
        {
            value: 'Office Space',
            label: 'Office Space',
            icon: <HomeOutlined />
        },
        {
            value: 'Training',
            label: 'Training',
            icon: <ReadOutlined />
        },
        {
            value: 'Networking',
            label: 'Networking',
            icon: <GlobalOutlined />
        },
        {
            value: 'Partnership',
            label: 'Partnership',
            icon: <LinkOutlined />
        },
        {
            value: 'Other',
            label: 'Other',
            icon: <EllipsisOutlined />
        }
    ]

const priorities: InquiryPriority[] = [
    'Low',
    'Medium',
    'High',
    'Urgent'
]

const followUpMethods: FollowUpMethod[] = [
    'Phone',
    'Email',
    'In-person',
    'Video Call'
]

const serviceCompatibilityMap: Partial<
    Record<InquiryType, ServiceOfInterest>
> = {
    'Incubation Program': 'Business Incubation',
    Funding: 'Funding Support',
    Mentorship: 'Mentorship',
    'Office Space': 'Office Space',
    Training: 'Training Programs',
    Networking: 'Networking'
}

const ApplicantInquirySubmission: React.FC<SubmitProps> = ({
    embedded = false,
    onClose,
    onSubmitted
}) => {
    const { token } = theme.useToken()
    const [form] = Form.useForm()
    const navigate = useNavigate()
    const { user } = useAuth()

    const [currentStep, setCurrentStep] =
        useState<ConversationStep>('inquiry')

    // Set when a step is opened by tapping "Edit" from the review screen —
    // both Back and Continue on that step then return straight to review
    // instead of marching through the rest of the wizard again.
    const [reviewEditSection, setReviewEditSection] =
        useState<ConversationStep | null>(null)

    const [loading, setLoading] =
        useState(false)

    const [branches, setBranches] =
        useState<Branch[]>([])

    const [
        selectedBranch,
        setSelectedBranch
    ] = useState<Branch | null>(null)

    const [
        submissionComplete,
        setSubmissionComplete
    ] = useState(false)

    const [formData, setFormData] =
        useState<Record<string, any>>({})

    // Contact details come straight from the applicant's profile instead of
    // being re-typed here — see loadParticipant() below. Populated from
    // `participants` (business profile) falling back to the auth identity.
    const [profileContact, setProfileContact] =
        useState<ProfileContact>(emptyProfileContact)

    const [currentTime, setCurrentTime] =
        useState(() => dayjs())

    const selectedInquiryType =
        Form.useWatch(
            'inquiryType',
            form
        ) as InquiryType | undefined

    const selectedPriority =
        Form.useWatch(
            'priority',
            form
        ) as InquiryPriority | undefined

    const selectedFollowUpMethod =
        Form.useWatch(
            'followUpMethod',
            form
        ) as FollowUpMethod | undefined

    const currentStepIndex =
        steps.indexOf(currentStep)

    // Only register as its own guided page on the standalone route — when
    // embedded (e.g. inside the inquiries list's "new inquiry" modal), this
    // would otherwise steal the guide registration away from that page.
    const { registerPageGuides, unregisterPageGuides } = useGuide()

    useEffect(() => {
        if (embedded) return

        const registration: PageGuideRegistration = {
            pageId: 'applicant-submit-inquiry',
            pageTitle: 'Submit an Inquiry',
            guides: [
                {
                    id: 'submit-inquiry-walkthrough',
                    title: 'How to submit an inquiry',
                    description:
                        'Choose what you need help with and send an inquiry to our team.',
                    kind: 'task',
                    steps: [
                        {
                            element: guideTarget('inquiry-type-grid'),
                            popover: {
                                title: 'What do you need help with?',
                                description:
                                    'Pick the option that best matches your inquiry.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('inquiry-description'),
                            popover: {
                                title: 'Tell us more',
                                description:
                                    'Briefly describe what you need — this helps us route it to the right person.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('inquiry-continue-btn'),
                            popover: {
                                title: 'Continue',
                                description:
                                    'Move on to choose a centre and priority, then review and submit.',
                                side: 'top',
                                align: 'end'
                            }
                        }
                    ]
                }
            ]
        }

        registerPageGuides(registration)

        return () => unregisterPageGuides(registration.pageId)
    }, [embedded, registerPageGuides, unregisterPageGuides])

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentTime(dayjs())
        }, 60000)

        return () => {
            window.clearInterval(timer)
        }
    }, [])

    const greeting = useMemo(() => {
        const hour = currentTime.hour()

        if (hour < 12) {
            return 'Good morning'
        }

        if (hour < 17) {
            return 'Good afternoon'
        }

        return 'Good evening'
    }, [currentTime])

    const parseName = (
        full?: string
    ) => {
        if (!full) {
            return {
                first: '',
                last: ''
            }
        }

        const parts =
            full.trim().split(/\s+/)

        return {
            first:
                parts[0] || '',
            last:
                parts
                    .slice(1)
                    .join(' ') || ''
        }
    }

    useEffect(() => {
        if (
            !form.getFieldValue(
                'priority'
            )
        ) {
            form.setFieldsValue({
                priority: 'Medium'
            })
        }
    }, [])

    // Contact details come exclusively from the applicant's participants
    // profile doc — not the auth/user record — since that's what they
    // maintain on the Profile page. `user.email` is only used as the lookup
    // key to find that doc; nothing from the auth identity is used as a
    // fallback value.
    useEffect(() => {
        const loadParticipant =
            async () => {
                if (!user?.email) return

                const emailLower =
                    user.email.toLowerCase()

                let snapshot =
                    await getDocs(
                        query(
                            collection(
                                db,
                                'participants'
                            ),
                            where(
                                'emailLower',
                                '==',
                                emailLower
                            )
                        )
                    )

                if (snapshot.empty) {
                    snapshot =
                        await getDocs(
                            query(
                                collection(
                                    db,
                                    'participants'
                                ),
                                where(
                                    'email',
                                    '==',
                                    user.email
                                )
                            )
                        )
                }

                if (snapshot.empty) {
                    return
                }

                const data =
                    snapshot.docs[0].data() as any

                const { first, last } =
                    parseName(data.participantName)

                const phone =
                    data.phone ||
                    data.phoneNumber ||
                    data.contact?.phone ||
                    ''

                const company =
                    data.company ||
                    data.companyName ||
                    data.beneficiaryName ||
                    data.organisation ||
                    data.organization ||
                    data.org ||
                    ''

                const position =
                    data.position ||
                    data.jobTitle ||
                    ''

                setProfileContact(previous => ({
                    firstName: first || previous.firstName,
                    lastName: last || previous.lastName,
                    email: data.email || previous.email,
                    phone: phone || previous.phone,
                    company: company || previous.company,
                    position: position || previous.position
                }))

                // Company/position stay editable in the "preferences" step
                // (an inquiry can be about a different venture), so just
                // seed them as a starting point rather than locking them.
                if (company && !form.getFieldValue('company')) {
                    form.setFieldsValue({ company })
                }

                if (position && !form.getFieldValue('position')) {
                    form.setFieldsValue({ position })
                }
            }

        loadParticipant().catch(
            console.error
        )
    }, [user?.email])

    useEffect(() => {
        const loadBranches =
            async () => {
                try {
                    const allBranches =
                        await branchService.getAllBranches()

                    const activeBranches =
                        allBranches.filter(
                            branch =>
                                branch.status ===
                                'active' &&
                                branch.isActive !==
                                false
                        )

                    setBranches(
                        activeBranches
                    )
                } catch (error) {
                    console.error(
                        'Error loading branches:',
                        error
                    )

                    message.error(
                        'Failed to load available branches'
                    )
                }
            }

        loadBranches()
    }, [])

    useEffect(() => {
        const branchId =
            form.getFieldValue(
                'branchId'
            )

        if (
            !branchId ||
            branches.length === 0
        ) {
            return
        }

        const branch =
            branches.find(
                item =>
                    item.id ===
                    branchId
            )

        if (branch) {
            setSelectedBranch(
                branch
            )
        }
    }, [
        branches,
        currentStep
    ])

    const handleBranchChange = (
        branchId: string
    ) => {
        const branch =
            branches.find(
                item =>
                    item.id ===
                    branchId
            )

        setSelectedBranch(
            branch || null
        )

        form.setFieldsValue({
            branchId
        })
    }

    const saveCurrentValues = () => {
        const values =
            form.getFieldsValue()

        setFormData(previous => ({
            ...previous,
            ...values
        }))
    }

    const requiredFields: Record<
        ConversationStep,
        string[]
    > = {
        inquiry: [
            'inquiryType',
            'description'
        ],
        routing: [
            'priority',
            'branchId'
        ],
        preferences: [],
        review: []
    }

    const goNext = async () => {
        let fields = [
            ...requiredFields[
            currentStep
            ]
        ]

        if (
            currentStep ===
            'inquiry' &&
            selectedInquiryType ===
            'Other'
        ) {
            fields = [
                ...fields,
                'otherInquiryType'
            ]
        }

        try {
            if (
                fields.length >
                0
            ) {
                await form.validateFields(
                    fields
                )
            }

            if (
                currentStep ===
                'routing' &&
                !selectedBranch
            ) {
                message.error(
                    'Please choose a centre before continuing'
                )

                return
            }

            saveCurrentValues()

            if (reviewEditSection) {
                setReviewEditSection(null)
                setCurrentStep('review')
                return
            }

            const nextIndex =
                currentStepIndex +
                1

            if (
                nextIndex <
                steps.length
            ) {
                setCurrentStep(
                    steps[
                    nextIndex
                    ]
                )
            }
        } catch {
            message.error(
                'Please complete the required information'
            )
        }
    }

    const goBack = () => {
        saveCurrentValues()

        if (reviewEditSection) {
            setReviewEditSection(null)
            setCurrentStep('review')
            return
        }

        const previousIndex =
            currentStepIndex -
            1

        if (
            previousIndex >= 0
        ) {
            setCurrentStep(
                steps[
                previousIndex
                ]
            )
        }
    }

    const startReviewEdit = (
        step: ConversationStep
    ) => {
        setReviewEditSection(step)
        setCurrentStep(step)
    }

    const handleInquiryTypeSelect = (
        type: InquiryType
    ) => {
        form.setFieldsValue({
            inquiryType: type
        })

        if (type !== 'Other') {
            form.setFieldsValue({
                otherInquiryType:
                    undefined
            })
        }

        setFormData(previous => ({
            ...previous,
            inquiryType: type,
            otherInquiryType:
                type === 'Other'
                    ? previous.otherInquiryType
                    : undefined
        }))
    }

    const onFinish = async () => {
        if (
            !user ||
            !selectedBranch
        ) {
            message.error(
                'Missing required information'
            )

            return
        }

        if (
            !profileContact.firstName ||
            !profileContact.lastName ||
            !profileContact.email ||
            !profileContact.phone
        ) {
            message.error(
                'Your profile is missing contact details we need (name, email or phone). Please complete your profile first.'
            )

            return
        }

        try {
            const fieldsToValidate = [
                'inquiryType',
                'description',
                'priority',
                'branchId'
            ]

            if (
                form.getFieldValue(
                    'inquiryType'
                ) === 'Other'
            ) {
                fieldsToValidate.push(
                    'otherInquiryType'
                )
            }

            await form.validateFields(
                fieldsToValidate
            )

            setLoading(true)

            const currentValues =
                form.getFieldsValue()

            const completeFormData = {
                ...formData,
                ...currentValues
            }

            const mappedService =
                serviceCompatibilityMap[
                completeFormData.inquiryType as InquiryType
                ]

            const finalDescription =
                completeFormData.inquiryType ===
                    'Other' &&
                    completeFormData.otherInquiryType?.trim()
                    ? `Inquiry type: ${completeFormData.otherInquiryType.trim()}\n\n${completeFormData.description}`
                    : completeFormData.description

            const inquiryData: InquiryFormData = {
                contactInfo: {
                    firstName:
                        profileContact.firstName,
                    lastName:
                        profileContact.lastName,
                    email:
                        profileContact.email,
                    phone:
                        profileContact.phone,
                    company:
                        completeFormData.company ||
                        profileContact.company,
                    position:
                        completeFormData.position ||
                        profileContact.position
                },

                inquiryDetails: {
                    inquiryType:
                        completeFormData.inquiryType,

                    description:
                        finalDescription,

                    servicesOfInterest:
                        mappedService
                            ? [
                                mappedService
                            ]
                            : []
                },

                priority:
                    completeFormData.priority,

                source: 'system',

                followUp:
                    completeFormData.nextFollowUpDate
                        ? {
                            nextFollowUpDate:
                                completeFormData.nextFollowUpDate.toDate(),

                            followUpMethod:
                                completeFormData.followUpMethod
                        }
                        : undefined
            }

            const inquiryId =
                await inquiryService.createInquiry(
                    inquiryData,
                    selectedBranch.id,
                    user.uid
                )

            if (embedded) {
                message.success(
                    'Inquiry submitted successfully.'
                )

                onSubmitted?.(
                    inquiryId
                )

                onClose?.()

                return
            }

            setSubmissionComplete(
                true
            )

            message.success(
                'Inquiry submitted successfully.'
            )
        } catch (error) {
            console.error(
                'Error submitting inquiry:',
                error
            )

            message.error(
                'Failed to submit inquiry'
            )
        } finally {
            setLoading(false)
        }
    }

    const resetForm = () => {
        setSubmissionComplete(
            false
        )

        setCurrentStep(
            'inquiry'
        )

        setFormData({})

        setSelectedBranch(
            null
        )

        form.resetFields()

        form.setFieldsValue({
            priority: 'Medium'
        })
    }

    const renderPrompt = (
        title: string,
        subtitle?: string
    ) => (
        <div
            style={{
                textAlign:
                    'center',
                marginBottom: 22
            }}
        >
            <Title
                level={4}
                style={{
                    margin: 0,
                    minHeight: 30
                }}
            >
                <TypewriterText
                    text={title}
                    speed={24}
                />
            </Title>

            {subtitle && (
                <Text
                    type="secondary"
                    style={{
                        display:
                            'block',
                        marginTop: 6
                    }}
                >
                    {subtitle}
                </Text>
            )}
        </div>
    )

    const renderInquiryStep = () => (
        <>
            {renderPrompt(
                `${greeting}, what can we help you with today?`,
                'Choose the option that best describes what you need.'
            )}

            <Form.Item
                name="inquiryType"
                hidden
                rules={[
                    {
                        required: true,
                        message: 'Please choose an inquiry type'
                    }
                ]}
            >
                <Input />
            </Form.Item>

            <Row
                data-guide="inquiry-type-grid"
                gutter={[6, 6]}
                style={{
                    marginBottom: 14
                }}
            >
                {inquiryTypeOptions.map(option => {
                    const selected =
                        selectedInquiryType === option.value

                    const isOther =
                        option.value === 'Other'

                    return (
                        <Col
                            key={option.value}
                            xs={isOther ? 24 : 12}
                            sm={isOther ? 24 : 12}
                        >
                            <Button
                                block
                                type={
                                    selected
                                        ? 'primary'
                                        : 'default'
                                }
                                shape="round"
                                onClick={() =>
                                    handleInquiryTypeSelect(
                                        option.value
                                    )
                                }
                                style={{
                                    height: 40,
                                    paddingInline: 10,
                                    whiteSpace: 'normal'
                                }}
                            >
                                <Space
                                    size={6}
                                    align="center"
                                >
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            fontSize: 14
                                        }}
                                    >
                                        {option.icon}
                                    </span>

                                    <span
                                        style={{
                                            fontSize: 12
                                        }}
                                    >
                                        {option.label}
                                    </span>
                                </Space>
                            </Button>
                        </Col>
                    )
                })}
            </Row>

            {selectedInquiryType === 'Other' && (
                <Form.Item
                    name="otherInquiryType"
                    label="What would you like help with?"
                    rules={[
                        {
                            required: true,
                            message:
                                'Please tell us what your inquiry is about'
                        }
                    ]}
                >
                    <Input
                        placeholder="Enter the type of assistance you need"
                        maxLength={100}
                        autoFocus
                    />
                </Form.Item>
            )}

            <div data-guide="inquiry-description">
                <Form.Item
                    name="description"
                    label="Tell us a little more"
                    rules={[
                        {
                            required: true,
                            message:
                                'Please describe your inquiry'
                        }
                    ]}
                >
                    <TextArea
                        rows={3}
                        maxLength={1500}
                        showCount
                        placeholder="Briefly explain what you need assistance with..."
                    />
                </Form.Item>
            </div>
        </>
    )

    const renderRoutingStep = () => (
        <>
            {renderPrompt(
                'Who should handle your inquiry?',
                'Choose the centre and let us know how urgent the request is.'
            )}

            <Form.Item
                name="priority"
                hidden
                rules={[
                    {
                        required: true,
                        message: 'Please select priority'
                    }
                ]}
            >
                <Input />
            </Form.Item>

            <Form.Item
                label="Priority"
                style={{
                    marginBottom: 16
                }}
            >
                <Row gutter={[8, 8]}>
                    {priorities.map(priority => {
                        const selected =
                            selectedPriority === priority

                        return (
                            <Col
                                key={priority}
                                xs={12}
                                sm={6}
                            >
                                <Card
                                    hoverable
                                    size="small"
                                    onClick={() => {
                                        form.setFieldsValue({
                                            priority
                                        })

                                        setFormData(previous => ({
                                            ...previous,
                                            priority
                                        }))
                                    }}
                                    style={{
                                        cursor: 'pointer',
                                        textAlign: 'center',
                                        borderRadius: 12,
                                        borderColor: selected
                                            ? token.colorPrimary
                                            : token.colorBorderSecondary,
                                        background: selected
                                            ? token.colorPrimaryBg
                                            : token.colorBgContainer,
                                        boxShadow: selected
                                            ? `0 0 0 1px ${token.colorPrimary}`
                                            : 'none'
                                    }}
                                    styles={{
                                        body: {
                                            padding: '10px 6px'
                                        }
                                    }}
                                >
                                    <Text
                                        strong={selected}
                                        style={{
                                            color: selected
                                                ? token.colorPrimaryText
                                                : token.colorText,
                                            fontSize: 12
                                        }}
                                    >
                                        {priority}
                                    </Text>
                                </Card>
                            </Col>
                        )
                    })}
                </Row>
            </Form.Item>

            <Form.Item
                name="branchId"
                label="Centre"
                rules={[
                    {
                        required: true,
                        message:
                            'Please select a centre'
                    }
                ]}
            >
                <Select
                    placeholder="Select centre"
                    onChange={handleBranchChange}
                    options={branches.map(branch => ({
                        value: branch.id,
                        label: branch.name
                    }))}
                />
            </Form.Item>
        </>
    )

    const renderPreferencesStep =
        () => (
            <>
                {renderPrompt(
                    'Anything else we should know?',
                    'These details are optional.'
                )}

                <Row
                    gutter={[
                        12,
                        4
                    ]}
                >
                    <Col
                        xs={24}
                        sm={12}
                    >
                        <Form.Item
                            name="company"
                            label="Company"
                        >
                            <Input placeholder="Company name" />
                        </Form.Item>
                    </Col>

                    <Col
                        xs={24}
                        sm={12}
                    >
                        <Form.Item
                            name="position"
                            label="Position"
                        >
                            <Input placeholder="Your role" />
                        </Form.Item>
                    </Col>

                    <Col
                        xs={24}
                        sm={12}
                    >
                        <Form.Item
                            name="nextFollowUpDate"
                            label="Preferred Follow-up Date"
                        >
                            <DatePicker
                                style={{
                                    width:
                                        '100%'
                                }}
                                disabledDate={
                                    current =>
                                        Boolean(
                                            current &&
                                            current <
                                            dayjs().endOf(
                                                'day'
                                            )
                                        )
                                }
                            />
                        </Form.Item>
                    </Col>

                    <Col span={24}>
                        <Form.Item
                            name="followUpMethod"
                            hidden
                        >
                            <Input />
                        </Form.Item>

                        <Form.Item
                            label="Preferred Contact Method"
                            style={{
                                marginBottom: 0
                            }}
                        >
                            <Row gutter={[8, 8]}>
                                {followUpMethods.map(method => {
                                    const selected =
                                        selectedFollowUpMethod === method

                                    return (
                                        <Col
                                            key={method}
                                            xs={12}
                                            sm={6}
                                        >
                                            <Card
                                                hoverable
                                                size="small"
                                                onClick={() => {
                                                    const next = selected
                                                        ? undefined
                                                        : method

                                                    form.setFieldsValue({
                                                        followUpMethod: next
                                                    })

                                                    setFormData(previous => ({
                                                        ...previous,
                                                        followUpMethod: next
                                                    }))
                                                }}
                                                style={{
                                                    cursor: 'pointer',
                                                    textAlign: 'center',
                                                    borderRadius: 12,
                                                    borderColor: selected
                                                        ? token.colorPrimary
                                                        : token.colorBorderSecondary,
                                                    background: selected
                                                        ? token.colorPrimaryBg
                                                        : token.colorBgContainer,
                                                    boxShadow: selected
                                                        ? `0 0 0 1px ${token.colorPrimary}`
                                                        : 'none'
                                                }}
                                                styles={{
                                                    body: {
                                                        padding: '10px 6px'
                                                    }
                                                }}
                                            >
                                                <Text
                                                    strong={selected}
                                                    style={{
                                                        color: selected
                                                            ? token.colorPrimaryText
                                                            : token.colorText,
                                                        fontSize: 12
                                                    }}
                                                >
                                                    {method}
                                                </Text>
                                            </Card>
                                        </Col>
                                    )
                                })}
                            </Row>
                        </Form.Item>
                    </Col>
                </Row>
            </>
        )

    const renderReviewStep =
        () => {
            const data = {
                ...formData,
                ...form.getFieldsValue()
            }

            const displayInquiryType =
                data.inquiryType ===
                    'Other' &&
                    data.otherInquiryType
                    ? data.otherInquiryType
                    : data.inquiryType

            return (
                <>
                    {renderPrompt(
                        'Does everything look right?',
                        'Review your inquiry before sending it.'
                    )}

                    <Space
                        direction="vertical"
                        size={10}
                        style={{
                            width:
                                '100%'
                        }}
                    >
                        <div
                            style={{
                                padding:
                                    14,
                                borderRadius:
                                    token.borderRadiusLG,
                                background:
                                    token.colorFillQuaternary,
                                border: `1px solid ${token.colorBorderSecondary}`
                            }}
                        >
                            <Space
                                direction="vertical"
                                size={8}
                                style={{
                                    width:
                                        '100%'
                                }}
                            >
                                <Space
                                    style={{
                                        width:
                                            '100%',
                                        justifyContent:
                                            'space-between'
                                    }}
                                >
                                    <Text
                                        type="secondary"
                                    >
                                        Inquiry
                                    </Text>

                                    <Button
                                        type="link"
                                        size="small"
                                        style={{
                                            padding: 0,
                                            height: 'auto'
                                        }}
                                        onClick={() =>
                                            startReviewEdit(
                                                'inquiry'
                                            )
                                        }
                                    >
                                        Edit
                                    </Button>
                                </Space>

                                <Space
                                    wrap
                                    size={6}
                                >
                                    <Tag color="blue">
                                        {
                                            displayInquiryType
                                        }
                                    </Tag>

                                    <Tag
                                        color={
                                            data.priority ===
                                                'Urgent'
                                                ? 'red'
                                                : data.priority ===
                                                    'High'
                                                    ? 'orange'
                                                    : 'blue'
                                        }
                                    >
                                        {
                                            data.priority
                                        }
                                    </Tag>
                                </Space>

                                <Text>
                                    {
                                        data.description
                                    }
                                </Text>
                            </Space>
                        </div>

                        <Row
                            gutter={[
                                10,
                                10
                            ]}
                        >
                            <Col
                                xs={24}
                                sm={12}
                            >
                                <Card
                                    size="small"
                                    variant="outlined"
                                    style={{
                                        height:
                                            '100%'
                                    }}
                                >
                                    <Space
                                        direction="vertical"
                                        size={3}
                                        style={{
                                            width:
                                                '100%'
                                        }}
                                    >
                                        <Space
                                            style={{
                                                width:
                                                    '100%',
                                                justifyContent:
                                                    'space-between'
                                            }}
                                        >
                                            <Text
                                                type="secondary"
                                            >
                                                Contact
                                            </Text>

                                            <Button
                                                type="link"
                                                size="small"
                                                style={{
                                                    padding: 0,
                                                    height: 'auto'
                                                }}
                                                onClick={() =>
                                                    navigate(
                                                        '/applicant/profile'
                                                    )
                                                }
                                            >
                                                Edit profile
                                            </Button>
                                        </Space>

                                        <Text
                                            strong
                                        >
                                            {
                                                profileContact.firstName
                                            }{' '}
                                            {
                                                profileContact.lastName
                                            }
                                        </Text>

                                        <Text>
                                            {
                                                profileContact.email
                                            }
                                        </Text>

                                        <Text>
                                            {
                                                profileContact.phone
                                            }
                                        </Text>
                                    </Space>
                                </Card>
                            </Col>

                            <Col
                                xs={24}
                                sm={12}
                            >
                                <Card
                                    size="small"
                                    variant="outlined"
                                    style={{
                                        height:
                                            '100%'
                                    }}
                                >
                                    <Space
                                        direction="vertical"
                                        size={3}
                                        style={{
                                            width:
                                                '100%'
                                        }}
                                    >
                                        <Space
                                            style={{
                                                width:
                                                    '100%',
                                                justifyContent:
                                                    'space-between'
                                            }}
                                        >
                                            <Text
                                                type="secondary"
                                            >
                                                Centre
                                            </Text>

                                            <Button
                                                type="link"
                                                size="small"
                                                style={{
                                                    padding: 0,
                                                    height: 'auto'
                                                }}
                                                onClick={() =>
                                                    startReviewEdit(
                                                        'routing'
                                                    )
                                                }
                                            >
                                                Edit
                                            </Button>
                                        </Space>

                                        <Text
                                            strong
                                        >
                                            {
                                                selectedBranch?.name
                                            }
                                        </Text>

                                        <Text>
                                            {
                                                selectedBranch
                                                    ?.location
                                                    .city
                                            }
                                        </Text>
                                    </Space>
                                </Card>
                            </Col>
                        </Row>

                        <Card
                            size="small"
                            variant="outlined"
                        >
                            <Space
                                style={{
                                    width:
                                        '100%',
                                    justifyContent:
                                        'space-between',
                                    marginBottom: 8
                                }}
                            >
                                <Text
                                    type="secondary"
                                >
                                    Additional details
                                </Text>

                                <Button
                                    type="link"
                                    size="small"
                                    style={{
                                        padding: 0,
                                        height: 'auto'
                                    }}
                                    onClick={() =>
                                        startReviewEdit(
                                            'preferences'
                                        )
                                    }
                                >
                                    Edit
                                </Button>
                            </Space>

                            {data.company ||
                                data.position ||
                                data.nextFollowUpDate ||
                                data.followUpMethod ? (
                                    <Row
                                        gutter={[
                                            12,
                                            10
                                        ]}
                                    >
                                        {data.company && (
                                            <Col
                                                xs={
                                                    24
                                                }
                                                sm={
                                                    12
                                                }
                                            >
                                                <Text
                                                    type="secondary"
                                                >
                                                    Company
                                                </Text>

                                                <div>
                                                    <Text>
                                                        {
                                                            data.company
                                                        }
                                                    </Text>
                                                </div>
                                            </Col>
                                        )}

                                        {data.position && (
                                            <Col
                                                xs={
                                                    24
                                                }
                                                sm={
                                                    12
                                                }
                                            >
                                                <Text
                                                    type="secondary"
                                                >
                                                    Position
                                                </Text>

                                                <div>
                                                    <Text>
                                                        {
                                                            data.position
                                                        }
                                                    </Text>
                                                </div>
                                            </Col>
                                        )}

                                        {data.nextFollowUpDate && (
                                            <Col
                                                xs={
                                                    24
                                                }
                                                sm={
                                                    12
                                                }
                                            >
                                                <Text
                                                    type="secondary"
                                                >
                                                    Follow-up
                                                </Text>

                                                <div>
                                                    <Text>
                                                        {dayjs(
                                                            data.nextFollowUpDate
                                                        ).format(
                                                            'D MMM YYYY'
                                                        )}
                                                    </Text>
                                                </div>
                                            </Col>
                                        )}

                                        {data.followUpMethod && (
                                            <Col
                                                xs={
                                                    24
                                                }
                                                sm={
                                                    12
                                                }
                                            >
                                                <Text
                                                    type="secondary"
                                                >
                                                    Contact Method
                                                </Text>

                                                <div>
                                                    <Text>
                                                        {
                                                            data.followUpMethod
                                                        }
                                                    </Text>
                                                </div>
                                            </Col>
                                        )}
                                    </Row>
                                ) : (
                                    <Text type="secondary">
                                        None added — optional
                                    </Text>
                                )}
                        </Card>
                    </Space>
                </>
            )
        }

    const renderContent = () => {
        switch (currentStep) {
            case 'inquiry':
                return renderInquiryStep()

            case 'routing':
                return renderRoutingStep()

            case 'preferences':
                return renderPreferencesStep()

            case 'review':
                return renderReviewStep()

            default:
                return null
        }
    }

    if (
        submissionComplete &&
        !embedded
    ) {
        return (
            <div
                style={{
                    minHeight:
                        '100vh',
                    display:
                        'grid',
                    placeItems:
                        'center',
                    padding: 24,
                    background:
                        token.colorBgLayout
                }}
            >
                <Helmet>
                    <title>
                        Inquiry Submitted | SME Portal
                    </title>
                </Helmet>

                <Card
                    style={{
                        width:
                            '100%',
                        maxWidth:
                            560,
                        textAlign:
                            'center'
                    }}
                >
                    <CheckCircleOutlined
                        style={{
                            fontSize:
                                52,
                            color:
                                token.colorSuccess,
                            marginBottom:
                                16
                        }}
                    />

                    <Title
                        level={3}
                    >
                        Inquiry Submitted
                    </Title>

                    <Paragraph
                        type="secondary"
                    >
                        Your inquiry has
                        been sent to{' '}
                        <strong>
                            {
                                selectedBranch?.name
                            }
                        </strong>
                        .
                    </Paragraph>

                    <Row
                        gutter={[
                            8,
                            8
                        ]}
                    >
                        <Col
                            xs={24}
                            sm={12}
                        >
                            <Button
                                block
                                shape="round"
                                onClick={
                                    resetForm
                                }
                            >
                                Submit Another
                            </Button>
                        </Col>

                        <Col
                            xs={24}
                            sm={12}
                        >
                            <Button
                                block
                                type="primary"
                                shape="round"
                                onClick={() =>
                                    navigate(
                                        '/applicant'
                                    )
                                }
                            >
                                Dashboard
                            </Button>
                        </Col>
                    </Row>
                </Card>
            </div>
        )
    }

    // As a standalone route (not embedded in the desktop Modal), this fills
    // whatever height ApplicantLayout hands it and scrolls its own step
    // content, with a page header + progress bar up top and the action bar
    // pinned to the bottom — the "full page, not a modal" mobile flow.
    return (
        <div
            style={
                embedded
                    ? {
                        width: '100%',
                        maxWidth: 720,
                        margin: '0 auto'
                    }
                    : {
                        flex: '1 1 auto',
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        width: '100%',
                        maxWidth: 720,
                        margin: '0 auto'
                    }
            }
        >
            {!embedded && (
                <Helmet>
                    <title>
                        Submit Inquiry | Smart Incubation Platform
                    </title>
                </Helmet>
            )}

            {!embedded && (
                <div
                    style={{
                        flex: '0 0 auto',
                        padding: '10px 16px 14px'
                    }}
                >
                    <div
                        style={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minHeight: 32,
                            marginBottom: 10
                        }}
                    >
                        <Button
                            type="default"
                            shape="circle"
                            icon={<ArrowLeftOutlined />}
                            onClick={() =>
                                navigate('/applicant/inquiries')
                            }
                            aria-label="Back to inquiries"
                            style={{
                                position: 'absolute',
                                left: 0,
                                borderColor: token.colorBorderSecondary
                            }}
                        />

                        <Text
                            strong
                            style={{
                                fontSize: 15,
                                textAlign: 'center'
                            }}
                        >
                            New Inquiry
                        </Text>

                        <Text
                            type="secondary"
                            style={{
                                position: 'absolute',
                                right: 0,
                                fontSize: 12
                            }}
                        >
                            {reviewEditSection
                                ? 'Editing'
                                : `Step ${currentStepIndex + 1} of ${steps.length}`}
                        </Text>
                    </div>

                    <Progress
                        percent={
                            ((currentStepIndex + 1) / steps.length) * 100
                        }
                        showInfo={false}
                        size="small"
                        strokeColor={token.colorPrimary}
                        trailColor={token.colorBorderSecondary}
                    />
                </div>
            )}

            <Form
                form={form}
                layout="vertical"
                requiredMark={false}
                onFinish={
                    onFinish
                }
                onKeyDown={event => {
                    // Pressing Enter in any single-line input natively
                    // submits the <form>, which ran onFinish (and its
                    // "Failed to submit" catch-all) on whichever step the
                    // user happened to be typing on. Only the review step's
                    // button should be able to submit.
                    if (
                        event.key === 'Enter' &&
                        currentStep !== 'review'
                    ) {
                        event.preventDefault()
                    }
                }}
                initialValues={{
                    priority:
                        'Medium'
                }}
                style={
                    embedded
                        ? undefined
                        : {
                            flex: '1 1 auto',
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column'
                        }
                }
            >
                <div
                    style={
                        embedded
                            ? { minHeight: 350 }
                            : {
                                flex: '1 1 auto',
                                minHeight: 0,
                                overflowY: 'auto',
                                padding: '0 16px',
                                // Short steps (e.g. routing, preferences)
                                // otherwise sit pinned to the top with a lot
                                // of empty space below — centre the block
                                // instead, and it still scrolls normally
                                // once content is taller than the screen.
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center'
                            }
                    }
                >
                    {renderContent()}
                </div>

                <div
                    style={{
                        display:
                            'flex',
                        gap: 8,
                        paddingTop:
                            16,
                        marginTop:
                            8,
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                        flex: '0 0 auto',
                        ...(embedded
                            ? {}
                            : {
                                paddingInline: 16,
                                paddingBottom:
                                    'calc(10px + env(safe-area-inset-bottom))'
                            })
                    }}
                >
                    {(currentStepIndex > 0 || reviewEditSection) && (
                        <Button
                            shape="round"
                            icon={
                                <ArrowLeftOutlined />
                            }
                            onClick={
                                goBack
                            }
                            style={{
                                flex: 1
                            }}
                        >
                            {reviewEditSection
                                ? 'Back to review'
                                : 'Back'}
                        </Button>
                    )}

                    {/* One stable element for the primary action — swapping
                        in a fresh "submit" button here right after a click
                        risks a stray tap landing on it (mobile fires the
                        click slightly after touch, so the element under the
                        finger can change out from under it), which is what
                        was firing onFinish a step early. */}
                    <Button
                        data-guide={
                            currentStep !== 'review'
                                ? 'inquiry-continue-btn'
                                : undefined
                        }
                        type="primary"
                        shape="round"
                        htmlType={
                            currentStep === 'review'
                                ? 'submit'
                                : 'button'
                        }
                        loading={
                            currentStep === 'review' && loading
                        }
                        onClick={
                            currentStep === 'review'
                                ? undefined
                                : goNext
                        }
                        style={{
                            flex: 1
                        }}
                    >
                        {currentStep === 'review' ? (
                            <>
                                <SendOutlined /> Submit Inquiry
                            </>
                        ) : reviewEditSection ? (
                            <>
                                <CheckOutlined /> Save
                            </>
                        ) : (
                            <>
                                Continue <ArrowRightOutlined />
                            </>
                        )}
                    </Button>
                </div>
            </Form>
        </div>
    )
}

export default ApplicantInquirySubmission
