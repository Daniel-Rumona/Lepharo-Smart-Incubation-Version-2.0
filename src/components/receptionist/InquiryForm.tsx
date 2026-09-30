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
    Checkbox,
    Typography,
    Steps,
    theme
} from 'antd'
import {
    SaveOutlined,
    ClearOutlined,
    ArrowLeftOutlined,
    ArrowRightOutlined,
    UserOutlined,
    IdcardOutlined,
    MessageOutlined,
    FlagOutlined,
    BellOutlined,
    RightOutlined,
    TeamOutlined,
    ArrowDownOutlined,
    ArrowUpOutlined,
    MinusOutlined,
    FireOutlined,
    InfoCircleOutlined,
    StarOutlined,
    PhoneOutlined,
    MailOutlined,
    EnvironmentOutlined,
    VideoCameraOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
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
import { useActiveProgramId } from '@/lib/useActiveProgramId'
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
import {
    AUDIENCE_LABEL,
    MANUAL_CHANNELS,
    channelLabel,
    resolveInquiryChannel
} from '@/utils/inquirySource'

const { TextArea } = Input
const { Text } = Typography
const { Option } = Select

type SourceType = 'Incubatee' | 'Non-Incubatee'

interface InquiryFormProps {
    initialData?: Partial<InquiryFormData>
    inquiryId?: string
    onSuccess?: () => void
    embedded?: boolean
    stepped?: boolean
    /** Edit mode: open on cards for each section, edit one section at a time. */
    sectioned?: boolean
    /** Show the Contact / Inquiry / Follow-up indicator above a stepped form. */
    showSteps?: boolean
    forcedProgramId?: string
    forcedProgramName?: string
}

interface Program {
    id: string
    name: string
    isActive?: boolean
}

const ACCEPTED_VALUES = ['accepted', 'approved', 'Accepted', 'Approved', true]

type SectionKey = 'who' | 'contact' | 'inquiry' | 'management' | 'followup'

const SECTION_STEP: Record<SectionKey, number> = { who: 0, contact: 0, inquiry: 1, management: 1, followup: 2 }

const SECTION_FIELDS: Record<SectionKey, string[]> = {
    who: ['sourceTypeInternal', 'source', 'smeParticipantId'],
    // Who it is from and the contact details depend on each other, so editing shares one section.
    contact: ['sourceTypeInternal', 'source', 'smeParticipantId', 'firstName', 'lastName', 'email', 'phone'],
    inquiry: ['inquiryType', 'department', 'description'],
    management: ['priority', 'classification'],
    followup: ['nextFollowUpDate', 'followUpMethod', 'followUpNotes']
}

const SECTION_CARDS: { key: SectionKey; title: string; hint: string; icon: React.ReactNode }[] = [
    { key: 'contact', title: 'Contact', hint: 'Who it is from, how they reached us and their details', icon: <IdcardOutlined /> },
    { key: 'inquiry', title: 'Inquiry', hint: 'What they are asking for', icon: <MessageOutlined /> },
    { key: 'management', title: 'Priority & classification', hint: 'How urgent and what kind', icon: <FlagOutlined /> },
    { key: 'followup', title: 'Follow-up', hint: 'Next touchpoint', icon: <BellOutlined /> }
]

type CardOption = { value: string; label: string; icon: React.ReactNode; color?: string }

const AUDIENCE_CARDS: CardOption[] = [
    { value: 'Incubatee', label: AUDIENCE_LABEL.Incubatee, icon: <TeamOutlined /> },
    { value: 'Non-Incubatee', label: AUDIENCE_LABEL['Non-Incubatee'], icon: <UserOutlined /> }
]

const PRIORITY_CARDS: CardOption[] = [
    { value: 'Low', label: 'Low', icon: <ArrowDownOutlined />, color: '#8c8c8c' },
    { value: 'Medium', label: 'Medium', icon: <MinusOutlined />, color: '#1677ff' },
    { value: 'High', label: 'High', icon: <ArrowUpOutlined />, color: '#fa8c16' },
    { value: 'Urgent', label: 'Urgent', icon: <FireOutlined />, color: '#ff4d4f' }
]

const CLASSIFICATION_CARDS: CardOption[] = [
    { value: 'General', label: 'General', icon: <InfoCircleOutlined /> },
    { value: 'Potential', label: 'Potential', icon: <StarOutlined />, color: '#faad14' }
]

const FOLLOW_UP_METHOD_CARDS: CardOption[] = [
    { value: 'Phone', label: 'Phone', icon: <PhoneOutlined /> },
    { value: 'Email', label: 'Email', icon: <MailOutlined /> },
    { value: 'In-person', label: 'In-person', icon: <EnvironmentOutlined /> },
    { value: 'Video Call', label: 'Video call', icon: <VideoCameraOutlined /> }
]

/** A short list of choices as one row of cards. Works as a Form.Item control. */
const CardSelect: React.FC<{
    value?: string
    onChange?: (value: string) => void
    options: CardOption[]
}> = ({ value, onChange, options }) => {
    const { token } = theme.useToken()

    return (
        <div
            role='radiogroup'
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
                gap: 10
            }}
        >
            {options.map(option => {
                const active = value === option.value
                const accent = option.color || token.colorPrimary

                return (
                    <button
                        key={option.value}
                        type='button'
                        role='radio'
                        aria-checked={active}
                        onClick={() => onChange?.(option.value)}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            minWidth: 0,
                            padding: '12px 6px',
                            borderRadius: 12,
                            cursor: 'pointer',
                            font: 'inherit',
                            color: active ? accent : token.colorText,
                            border: `1px solid ${active ? accent : token.colorBorderSecondary}`,
                            background: active
                                ? `color-mix(in srgb, ${accent} 12%, transparent)`
                                : token.colorBgContainer,
                            boxShadow: active ? `0 0 0 1px ${accent}` : 'none',
                            transition: 'border-color .15s, background .15s, box-shadow .15s'
                        }}
                    >
                        <span style={{ fontSize: 20, lineHeight: 1 }}>{option.icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, textAlign: 'center' }}>
                            {option.label}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

type SmeOption = {
    value: string
    label: string
    company: string
    email: string
    owner: string
}

type FormSectionProps = {
    icon: React.ReactNode
    title: string
    hint?: string
    extra?: React.ReactNode
    children?: React.ReactNode
}

const FormSection: React.FC<FormSectionProps> = ({ icon, title, hint, extra, children }) => {
    const { token } = theme.useToken()

    return (
        <section style={{ marginBottom: 12 }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 20,
                    paddingBottom: 12,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`
                }}
            >
                <span
                    style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        flex: '0 0 auto',
                        color: token.colorPrimary,
                        background: token.colorPrimaryBg,
                        fontSize: 16
                    }}
                >
                    {icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 15, display: 'block', lineHeight: 1.25 }}>
                        {title}
                    </Text>
                    {hint ? (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {hint}
                        </Text>
                    ) : null}
                </div>
                {extra}
            </div>
            {children}
        </section>
    )
}

const InquiryForm: React.FC<InquiryFormProps> = ({
    initialData,
    inquiryId,
    onSuccess,
    embedded = false,
    stepped = false,
    sectioned = false,
    showSteps = false,
    forcedProgramId: forcedProgramIdProp,
    forcedProgramName
}) => {
    const [form] = Form.useForm()
    // The programme comes from the top bar; there is no separate selector.
    const { activeProgramId } = useActiveProgramId()
    const forcedProgramId = forcedProgramIdProp || activeProgramId || undefined
    const [loading, setLoading] = useState(false)
    const [requiresFollowUp, setRequiresFollowUp] = useState(false)
    const [sourceType, setSourceType] = useState<SourceType>('Non-Incubatee')
    const [programs, setPrograms] = useState<Program[]>([])
    const [smeOptions, setSmeOptions] = useState<SmeOption[]>([])
    const [smeLoading, setSmeLoading] = useState(false)
    const [representative, setRepresentative] = useState(false)
    const watchedProgramId = Form.useWatch('programId', form)
    const selectedSmeId = Form.useWatch('smeParticipantId', form)
    const smeProgramId = forcedProgramId || watchedProgramId
    const [contactLocked, setContactLocked] = useState(false)
    const [departmentOptions, setDepartmentOptions] = useState<string[]>([])
    const { token } = theme.useToken()
    const [currentStep, setCurrentStep] = useState(0)
    const [activeSection, setActiveSection] = useState<SectionKey | null>(null)
    const navigate = useNavigate()
    const { user } = useAuth()

    // Inquiries an SME sent from their portal keep the source they arrived with;
    // it is not a channel staff can pick.
    const portalOrigin = resolveInquiryChannel((initialData as any)?.source) === 'System'

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
        setRepresentative(Boolean(values?.representative))
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

    // Accepted SMEs of the selected programme, so a walk-in can be linked to the
    // company even when the person at the desk is not the owner on file.
    useEffect(() => {
        if (sourceType !== 'Incubatee' || !smeProgramId) {
            setSmeOptions([])
            return
        }

        let cancelled = false
        setSmeLoading(true)

        getDocs(query(collection(db, 'applications'), where('programId', '==', smeProgramId)))
            .then(snap => {
                if (cancelled) return
                const seen = new Set<string>()
                const rows: SmeOption[] = []

                snap.docs.forEach(d => {
                    const app = d.data() as any
                    const status = app?.status ?? app?.applicationStatus ?? app?.decision
                    const participantId = String(app?.participantId || '').trim()
                    if (!ACCEPTED_VALUES.includes(status) || !participantId || seen.has(participantId)) return
                    seen.add(participantId)

                    const company = String(app?.beneficiaryName || app?.companyName || '').trim()
                    const owner = String(app?.participantName || app?.applicantName || app?.directorName || '').trim()
                    const email = String(app?.email || '').trim()
                    rows.push({
                        value: participantId,
                        company,
                        owner,
                        email,
                        label: [company || 'Unnamed company', owner, email].filter(Boolean).join(' · ')
                    })
                })

                rows.sort((x, y) => x.label.localeCompare(y.label, undefined, { sensitivity: 'base' }))
                setSmeOptions(rows)
            })
            .catch(err => {
                console.error('Failed to load SMEs', err)
                if (!cancelled) setSmeOptions([])
            })
            .finally(() => {
                if (!cancelled) setSmeLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [sourceType, smeProgramId])

    // Fill the form from the chosen SME. A representative keeps their own contact
    // details; only the company is taken from the SME.
    const applySme = useCallback(
        async (participantId: string, asRepresentative: boolean) => {
            const option = smeOptions.find(item => item.value === participantId)
            form.setFieldsValue({ company: option?.company || '' })

            if (asRepresentative) {
                setContactLocked(false)
                return
            }

            try {
                const pSnap = await getDoc(doc(db, 'participants', participantId))
                const participant = pSnap.exists() ? (pSnap.data() as any) : null
                const [firstName, ...lastNameParts] = String(
                    participant?.participantName || option?.owner || ''
                )
                    .trim()
                    .split(/\s+/)

                form.setFieldsValue({
                    firstName: firstName || '',
                    lastName: lastNameParts.join(' '),
                    email: option?.email || participant?.email || '',
                    phone: participant?.phone || '',
                    company: participant?.beneficiaryName || option?.company || '',
                    position: 'CEO',
                    industry: participant?.sector || ''
                })
                setContactLocked(true)
            } catch (err) {
                console.error('Error loading SME details', err)
                message.error('Could not load the SME details. Enter the contact manually.')
                setContactLocked(false)
            }
        },
        [form, smeOptions]
    )

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

            const linkedSmeId = sourceType === 'Incubatee' ? values.smeParticipantId || null : null

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
                source: portalOrigin
                    ? (initialData as any).source
                    : values.source || 'Walk-in',
                classification: values.classification || 'General',
                participantId: linkedSmeId,
                isRepresentative: Boolean(linkedSmeId) && representative,
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
                        assignedToName: user.name || user.email || '',
                        assignedToEmail: user.email || '',
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
        setRepresentative(false)
        setSourceType('Non-Incubatee')
        setCurrentStep(0)
        if (forcedProgramId) {
            form.setFieldsValue({ programId: forcedProgramId })
        }
    }

    const handleNextStep = async () => {
        const fields =
            currentStep === 0
                ? ['sourceTypeInternal', 'source', 'smeParticipantId', 'firstName', 'lastName', 'email', 'phone']
                : ['inquiryType', 'department', 'description', 'priority', 'classification']

        try {
            await form.validateFields(fields)
            setCurrentStep(step => Math.min(step + 1, 2))
        } catch {
            // Ant Design displays the relevant field validation messages.
        }
    }

    const sectionStyle = (key: SectionKey): React.CSSProperties => ({
        display: sectioned
            ? activeSection === (key === 'who' ? 'contact' : key) ? 'block' : 'none'
            : !stepped || currentStep === SECTION_STEP[key] ? 'block' : 'none'
    })

    const sectionSummary = (key: SectionKey): string => {
        const values = form.getFieldsValue(true) as any
        switch (key) {
            case 'who':
            case 'contact':
                return [
                    AUDIENCE_LABEL[sourceType],
                    channelLabel(resolveInquiryChannel(values.source)),
                    `${values.firstName || ''} ${values.lastName || ''}`.trim(),
                    values.company
                ].filter(Boolean).join(' · ')
            case 'inquiry':
                return [values.inquiryType, values.department].filter(Boolean).join(' · ') || 'Not set'
            case 'management':
                return [values.priority && `${values.priority} priority`, values.classification]
                    .filter(Boolean).join(' · ') || 'Not set'
            case 'followup':
                return requiresFollowUp && values.nextFollowUpDate
                    ? [dayjs(values.nextFollowUpDate).format('DD MMM YYYY'), values.followUpMethod]
                        .filter(Boolean).join(' · ')
                    : 'No follow-up scheduled'
        }
    }

    // Only the open section is validated; the others stay mounted (hidden) so their values are saved as they are.
    const handleSectionUpdate = async () => {
        if (!activeSection) return
        const fields = activeSection === 'followup' && !requiresFollowUp ? [] : SECTION_FIELDS[activeSection]

        try {
            await form.validateFields(fields)
        } catch {
            return
        }
        await handleSubmit(form.getFieldsValue(true))
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
                style={embedded ? { background: 'transparent', boxShadow: 'none' } : undefined}
                styles={{ body: { padding: embedded ? 0 : 24 } }}
                title={embedded ? undefined : inquiryId ? 'Edit Inquiry' : 'New Inquiry'}
                extra={
                    embedded || stepped || sectioned ? null : <Space>
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
                {stepped && showSteps && (
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
                    size={embedded ? 'middle' : 'large'}
                    requiredMark='optional'
                >
                    {sectioned && !activeSection && (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                                gap: 12,
                                marginBottom: 12
                            }}
                        >
                            {SECTION_CARDS.map(card => (
                                <div
                                    key={card.key}
                                    role='button'
                                    tabIndex={0}
                                    onClick={() => setActiveSection(card.key)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ') setActiveSection(card.key)
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 14,
                                        padding: '16px 18px',
                                        borderRadius: 14,
                                        cursor: 'pointer',
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorBgContainer
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: 12,
                                            display: 'grid',
                                            placeItems: 'center',
                                            flex: '0 0 auto',
                                            fontSize: 18,
                                            color: token.colorPrimary,
                                            background: token.colorPrimaryBg
                                        }}
                                    >
                                        {card.icon}
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <Text strong style={{ display: 'block' }}>
                                            {card.title}
                                        </Text>
                                        <Text
                                            type='secondary'
                                            ellipsis
                                            style={{ display: 'block', fontSize: 12 }}
                                        >
                                            {sectionSummary(card.key)}
                                        </Text>
                                    </div>
                                    <RightOutlined style={{ opacity: 0.45, fontSize: 12 }} />
                                </div>
                            ))}
                        </div>
                    )}

                    <div>
                        {/* Program & Source */}
                        <div style={sectionStyle('who')}>
                        <FormSection
                            icon={<IdcardOutlined />}
                            title='Who is this from?'
                            hint='Contact type and how they reached us'
                        >
                            {/* Source row reacts to sourceType:
                - Non-Incubatee: Source spans full width
                - Incubatee: Source + Email share the row, aligned */}
                            <Row gutter={[16, 0]}>
                                <Col xs={24}>
                                    <Form.Item
                                        label='Contact Type'
                                        name='sourceTypeInternal'
                                        initialValue={sourceType}
                                        rules={[
                                            { required: true, message: 'Please select a source type' }
                                        ]}
                                    >
                                        <CardSelect
                                            options={AUDIENCE_CARDS}
                                            onChange={(v: string) => {
                                                setSourceType(v as SourceType)
                                                if (v === 'Non-Incubatee') {
                                                    setContactLocked(false)
                                                    form.setFieldsValue({
                                                        programId: forcedProgramId || undefined
                                                    })
                                                }
                                            }}
                                        />
                                    </Form.Item>
                                </Col>

                                <Col xs={24}>
                                    <Form.Item
                                        label='How did they reach us?'
                                        name='source'
                                        initialValue={portalOrigin ? 'System' : 'Walk-in'}
                                        rules={[{ required: true, message: 'Please select how they reached us' }]}
                                    >
                                        <Select disabled={portalOrigin}>
                                            {portalOrigin ? (
                                                <Option value='System'>{channelLabel('System')}</Option>
                                            ) : (
                                                MANUAL_CHANNELS.map(option => (
                                                    <Option key={option.value} value={option.value}>
                                                        {channelLabel(option.value)}
                                                    </Option>
                                                ))
                                            )}
                                        </Select>
                                    </Form.Item>
                                </Col>

                                {sourceType === 'Incubatee' && (
                                    <>
                                        <Col xs={24}>
                                            <Form.Item
                                                label='Which SME is this about?'
                                                name='smeParticipantId'
                                                extra='Search by company, owner or email. If the person at the desk is not the owner, tick the box below.'
                                                rules={[
                                                    {
                                                        required: !inquiryId,
                                                        message: 'Please choose the SME'
                                                    }
                                                ]}
                                            >
                                                <Select
                                                    showSearch
                                                    allowClear
                                                    loading={smeLoading}
                                                    placeholder={
                                                        smeProgramId
                                                            ? 'Search company, owner or email'
                                                            : 'Choose a program in the top bar first'
                                                    }
                                                    disabled={!smeProgramId}
                                                    options={smeOptions}
                                                    optionFilterProp='label'
                                                    notFoundContent={
                                                        smeLoading ? 'Loading SMEs...' : 'No accepted SME found'
                                                    }
                                                    onChange={(value?: string) => {
                                                        if (value) applySme(value, representative)
                                                        else {
                                                            setContactLocked(false)
                                                            form.setFieldsValue({ company: '' })
                                                        }
                                                    }}
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24}>
                                            <Form.Item>
                                                <Checkbox
                                                    checked={representative}
                                                    onChange={event => {
                                                        const checked = event.target.checked
                                                        setRepresentative(checked)
                                                        if (checked) {
                                                            setContactLocked(false)
                                                            form.setFieldsValue({
                                                                firstName: '',
                                                                lastName: '',
                                                                email: '',
                                                                phone: '',
                                                                position: ''
                                                            })
                                                        } else if (selectedSmeId) {
                                                            applySme(selectedSmeId, false)
                                                        }
                                                    }}
                                                >
                                                    Someone is attending on the SME&apos;s behalf (a representative)
                                                </Checkbox>
                                            </Form.Item>
                                        </Col>
                                    </>
                                )}
                            </Row>

                            {sourceType === 'Incubatee' && forcedProgramId && (
                                <Form.Item name='programId' hidden>
                                    <Input />
                                </Form.Item>
                            )}
                        </FormSection>
                        </div>

                        {/* Contact Information */}
                        <div style={sectionStyle('contact')}>
                        <FormSection
                            icon={<UserOutlined />}
                            title='Contact details'
                            hint='Email or phone is required'
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
                                            disabled={contactLocked || (sourceType === 'Incubatee' && Boolean(selectedSmeId))}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label={representative ? 'Position at the SME' : 'Position'}
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
                        </FormSection>
                        </div>
                    </div>

                    <div>
                        {/* Inquiry Details */}
                        <div style={sectionStyle('inquiry')}>
                        <FormSection
                            icon={<MessageOutlined />}
                            title='Inquiry'
                            hint='What they are asking for'
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
                        </FormSection>
                        </div>

                        {/* Inquiry Management */}
                        <div style={sectionStyle('management')}>
                        <FormSection
                            icon={<FlagOutlined />}
                            title='Priority & classification'
                        >
                            <Row gutter={[16, 0]}>
                                <Col xs={24}>
                                    <Form.Item
                                        label='Priority'
                                        name='priority'
                                        rules={[
                                            { required: true, message: 'Please select a priority' }
                                        ]}
                                    >
                                        <CardSelect options={PRIORITY_CARDS} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24}>
                                    <Form.Item
                                        label='Classification'
                                        name='classification'
                                        initialValue='General'
                                        rules={[{ required: true, message: 'Please select a classification' }]}
                                    >
                                        <CardSelect options={CLASSIFICATION_CARDS} />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </FormSection>
                        </div>
                    </div>

                    <div>
                        {/* Follow-up */}
                        <div style={sectionStyle('followup')}>
                        <FormSection
                            icon={<BellOutlined />}
                            title='Follow-up'
                            hint={requiresFollowUp ? 'Schedule the next touchpoint' : 'Optional'}
                            extra={
                                <Switch
                                    checked={requiresFollowUp}
                                    onChange={setRequiresFollowUp}
                                    checkedChildren='On'
                                    unCheckedChildren='Off'
                                />
                            }
                        >
                            {requiresFollowUp && (
                                <Row gutter={[16, 0]}>
                                    <Col xs={24}>
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
                                    <Col xs={24}>
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
                                            <CardSelect options={FOLLOW_UP_METHOD_CARDS} />
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
                        </FormSection>
                        </div>
                    </div>

                    {sectioned && activeSection && (
                        <div
                            style={{
                                position: 'sticky',
                                bottom: 0,
                                zIndex: 2,
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                gap: 12,
                                margin: '4px -36px 0',
                                padding: '14px 36px 18px',
                                background: token.colorBgElevated,
                                borderTop: `1px solid ${token.colorBorderSecondary}`
                            }}
                        >
                            <Button
                                block
                                shape='round'
                                size='large'
                                icon={<ArrowLeftOutlined />}
                                onClick={() => setActiveSection(null)}
                                disabled={loading}
                            >
                                Back
                            </Button>
                            <Button
                                block
                                shape='round'
                                size='large'
                                type='primary'
                                icon={<SaveOutlined />}
                                loading={loading}
                                onClick={handleSectionUpdate}
                            >
                                Update
                            </Button>
                        </div>
                    )}
                    {stepped && (
                        <div
                            style={{
                                position: 'sticky',
                                bottom: 0,
                                zIndex: 2,
                                display: 'grid',
                                gridTemplateColumns: `repeat(${currentStep > 0 ? 3 : 2}, minmax(0, 1fr))`,
                                gap: 12,
                                margin: '4px -36px 0',
                                padding: '14px 36px 18px',
                                background: token.colorBgElevated,
                                borderTop: `1px solid ${token.colorBorderSecondary}`
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
                                    {inquiryId ? 'Update' : 'Save'} Inquiry
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
