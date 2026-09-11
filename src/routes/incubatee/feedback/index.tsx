import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Col,
    Divider,
    Empty,
    Form,
    Grid,
    Image,
    Input,
    List,
    Modal,
    Progress,
    Row,
    Segmented,
    Select,
    Space,
    Steps,
    Table,
    Tag,
    Typography,
    Upload,
    message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CheckCircleOutlined,
    ClearOutlined,
    ExclamationCircleOutlined,
    FileSearchOutlined,
    LikeOutlined,
    PictureOutlined,
    PlusOutlined,
    SearchOutlined,
    UploadOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import { db, storage } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import {
    addDoc,
    collection,
    doc,
    getDocs,
    query,
    Timestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'

const { useBreakpoint } = Grid

const { Text, Paragraph } = Typography
const { TextArea } = Input

type SegmentKey = 'feedback' | 'inquiries'
type FeedbackType = 'complaint' | 'praise' | 'success_story'
type ComplaintTarget = 'department' | 'consultant'

type AssignedIntervention = {
    id: string
    interventionId?: string
    interventionTitle: string
    departmentId?: string
    departmentName?: string
    assigneeId?: string
    assigneeName?: string
    assigneeEmail?: string
    assignmentStatus?: string
    assigneeCompletionStatus?: string
    participantCompletionStatus?: string
    completionStatus?: string
}

type FeedbackRecord = {
    id: string
    type: FeedbackType
    title: string
    message: string
    storyKind?: 'SMME' | 'Event'
    background?: string
    lepharoJourney?: string
    achievement?: string
    lepharoRole?: string
    eventBackground?: string
    attendees?: string
    attendeeCount?: number
    eventBenefits?: string
    attachments?: Attachment[]
    coverImageUrl?: string
    status?: string
    interventionTitle?: string
    targetType?: ComplaintTarget
    departmentName?: string
    consultantName?: string
    createdAt?: any
}

type Attachment = {
    name: string
    url: string
    path: string
    type: string
    size: number
}

type InquiryCommunication = {
    id: string
    type: 'response' | 'note' | 'follow-up'
    message: string
    sentBy: string
    sentByName: string
    sentByRole: string
    sentAt?: any
    isInternal?: boolean
}

type InquiryRecord = {
    id: string
    status?: string
    submittedAt?: any
    createdAt?: any
    inquiryDetails?: {
        inquiryType?: string
        servicesOfInterest?: string[]
        message?: string
    }
    contactInfo?: any
    communications?: InquiryCommunication[]
}

const feedbackLabels: Record<FeedbackType, string> = {
    complaint: 'Complaint',
    praise: 'Praise',
    success_story: 'Success Story'
}

const feedbackColors: Record<FeedbackType, string> = {
    complaint: 'red',
    praise: 'green',
    success_story: 'blue'
}

const inquiryTypes = ['Request', 'Complaint', 'Follow-Up', 'Other']
const serviceAreas = [
    'Finance',
    'Marketing',
    'Operations',
    'Compliance',
    'Legal',
    'Wellness',
    'Training',
    'General Support'
]

const sunkenPanelStyle: React.CSSProperties = {
    background: '#f5f7fb',
    border: '1px solid #d9e2f0',
    borderRadius: 16,
    padding: 14,
    boxShadow: 'inset 0 2px 8px rgba(15, 23, 42, 0.06)'
}

const mobileCardStyle: React.CSSProperties = {
    width: '100%',
    border: '1px solid #e6e9f0',
    borderRadius: 12,
    padding: 14,
    background: '#fff'
}

const clean = (value: any) => String(value || '').trim()
const norm = (value: any) => clean(value).toLowerCase().replace(/\s+/g, ' ')
const isCompletedIntervention = (row: AssignedIntervention) =>
    norm(row.participantCompletionStatus) === 'confirmed'

const formatDate = (value: any) => {
    const date = value?.toDate?.() ? value.toDate() : value
    return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'
}

const uploadFiles = async (files: any[], folder: string): Promise<Attachment[]> => {
    const list = files.map(item => item?.originFileObj || item).filter(Boolean) as File[]
    return Promise.all(list.map(async file => {
        const safeName = file.name.replace(/[^\w.\-]+/g, '_')
        const path = `${folder}/${Date.now()}_${safeName}`
        const storageRef = ref(storage, path)
        await uploadBytes(storageRef, file)
        return {
            name: file.name,
            url: await getDownloadURL(storageRef),
            path,
            type: file.type || 'application/octet-stream',
            size: file.size || 0
        }
    }))
}

const parseCommunicationMessage = (raw: string) => {
    const parts = (raw || '').split('\n\n')
    const subject = parts[0]?.replace(/^Subject:\s*/i, '') || ''
    const body = parts.slice(1).join('\n\n') || raw
    return { subject, body }
}

const getInquiryDate = (record: InquiryRecord) => record.submittedAt || record.createdAt

const SmeFeedbackPage: React.FC = () => {
    const { user } = useFullIdentity()
    const screens = useBreakpoint()
    const [feedbackForm] = Form.useForm()
    const [inquiryForm] = Form.useForm()

    const [segment, setSegment] = useState<SegmentKey>('feedback')
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [applicationId, setApplicationId] = useState<string | null>(null)
    const [companyName, setCompanyName] = useState('')
    const [participantProfile, setParticipantProfile] = useState<any>(null)
    const [applicationProfile, setApplicationProfile] = useState<any>(null)
    const [interventions, setInterventions] = useState<AssignedIntervention[]>([])
    const [feedbackRecords, setFeedbackRecords] = useState<FeedbackRecord[]>([])
    const [inquiries, setInquiries] = useState<InquiryRecord[]>([])
    const [loading, setLoading] = useState(false)
    const [savingFeedback, setSavingFeedback] = useState(false)
    const [savingInquiry, setSavingInquiry] = useState(false)
    const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
    const [feedbackStep, setFeedbackStep] = useState(0)
    const [inquiryModalOpen, setInquiryModalOpen] = useState(false)
    const [viewInquiry, setViewInquiry] = useState<InquiryRecord | null>(null)
    const [selectedType, setSelectedType] = useState<FeedbackType>('complaint')
    const storyKind = Form.useWatch('storyKind', feedbackForm) as 'SMME' | 'Event' | undefined
    const feedbackFormValues = Form.useWatch([], feedbackForm) || {}
    const [selectedTarget, setSelectedTarget] = useState<ComplaintTarget>('department')
    const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>()
    const [searchText, setSearchText] = useState('')
    const [feedbackTypeFilter, setFeedbackTypeFilter] = useState<FeedbackType | 'all'>('all')
    const [inquiryStatusFilter, setInquiryStatusFilter] = useState<string>('all')

    useEffect(() => {
        const run = async () => {
            if (!user?.email) return
            setLoading(true)
            try {
                const appSnap = await getDocs(query(collection(db, 'applications'), where('email', '==', user.email)))
                const appDoc = appSnap.docs[0]
                if (!appDoc) {
                    setLoading(false)
                    return
                }

                const app = { id: appDoc.id, ...(appDoc.data() as any) }
                setApplicationProfile(app)
                const resolvedParticipantId = clean(app.participantId || app.id)
                setApplicationId(app.id)
                setParticipantId(resolvedParticipantId)
                setCompanyName(clean(app.companyName || app.registeredName || app.businessName || app.beneficiaryName))

                const participantSnap = await getDocs(query(collection(db, 'participants'), where('email', '==', user.email)))
                const participant = participantSnap.docs[0]?.data() || {}
                setParticipantProfile(participant)

                const interventionSnap = await getDocs(
                    query(collection(db, 'assignedInterventions'), where('participantId', '==', resolvedParticipantId))
                )
                setInterventions(
                    interventionSnap.docs
                        .map(d => ({ id: d.id, ...(d.data() as any) }))
                        .map(row => ({
                            ...row,
                            interventionTitle: clean(row.interventionTitle || row.title || row.name || 'Untitled intervention'),
                            departmentName: clean(row.departmentName || row.department || row.areaOfSupport || 'Unassigned department'),
                            departmentId: clean(row.departmentId || row.departmentName || row.department || row.areaOfSupport || 'unassigned'),
                            consultantName: clean(row.assigneeName || 'Unassigned coordinator')
                        }))
                        .sort((a, b) => a.interventionTitle.localeCompare(b.interventionTitle))
                )

                const feedbackSnap = await getDocs(
                    query(collection(db, 'smeFeedback'), where('participantId', '==', resolvedParticipantId))
                )
                const feedbackRows = feedbackSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as FeedbackRecord[]
                feedbackRows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
                setFeedbackRecords(feedbackRows)

                const inquiryQueries = await Promise.all([
                    getDocs(query(collection(db, 'inquiries'), where('submittedBy', '==', user.id))),
                    getDocs(query(collection(db, 'inquiries'), where('participantId', '==', resolvedParticipantId)))
                ])
                const byId = new Map<string, InquiryRecord>()
                inquiryQueries.forEach(snap => {
                    snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...(d.data() as any) } as InquiryRecord))
                })
                const inquiryRows = Array.from(byId.values()).sort(
                    (a, b) => (getInquiryDate(b)?.seconds || 0) - (getInquiryDate(a)?.seconds || 0)
                )
                setInquiries(inquiryRows)
            } catch (error) {
                console.error(error)
                message.error('Failed to load SME feedback.')
            } finally {
                setLoading(false)
            }
        }
        run()
    }, [user?.email, user?.id])

    const departmentOptions = useMemo(() => {
        const map = new Map<string, string>()
        interventions.forEach(item => {
            const id = clean(item.departmentId || item.departmentName || 'unassigned')
            if (!map.has(id)) map.set(id, item.departmentName || id)
        })
        return Array.from(map.entries()).map(([value, label]) => ({ value, label }))
    }, [interventions])

    const consultantOptions = useMemo(
        () =>
            interventions
                .filter(item => !selectedDepartmentId || item.departmentId === selectedDepartmentId)
                .map(item => ({
                    value: item.assigneeId || item.assigneeEmail || item.assigneeName || item.id,
                    label: `${item.assigneeName || 'Unassigned coordinator'} - ${item.interventionTitle}`
                })),
        [interventions, selectedDepartmentId]
    )

    const completedInterventions = useMemo(
        () => interventions.filter(isCompletedIntervention),
        [interventions]
    )

    useEffect(() => {
        if (selectedType !== 'success_story' || storyKind === 'Event' || !companyName) return
        const current = feedbackForm.getFieldsValue(['background', 'lepharoJourney'])
        if (clean(current.background) && clean(current.lepharoJourney)) return

        const sector = clean(participantProfile?.sector || applicationProfile?.sector || applicationProfile?.businessSector || applicationProfile?.industry)
        const description = clean(
            participantProfile?.businessDescription || participantProfile?.companyDescription || participantProfile?.businessOverview ||
            applicationProfile?.businessDescription || applicationProfile?.companyDescription || applicationProfile?.businessOverview ||
            applicationProfile?.natureOfBusiness || applicationProfile?.productsServices || applicationProfile?.description
        )
        const founded = clean(
            participantProfile?.yearEstablished || participantProfile?.yearFounded ||
            applicationProfile?.yearEstablished || applicationProfile?.yearFounded || applicationProfile?.registrationDate
        )
        const location = [
            clean(participantProfile?.town || participantProfile?.city || applicationProfile?.town || applicationProfile?.city),
            clean(participantProfile?.province || applicationProfile?.province || applicationProfile?.region)
        ].filter(Boolean).join(', ')
        const onboardedRaw = applicationProfile?.signedAgreements?.['pre-incubation-contract']?.acceptedAt || applicationProfile?.onboardedAt || applicationProfile?.acceptedAt || applicationProfile?.updatedAt
        const onboarded = onboardedRaw?.toDate?.() ? dayjs(onboardedRaw.toDate()) : dayjs(onboardedRaw)
        const titles = Array.from(new Set(completedInterventions.map(item => clean(item.interventionTitle)).filter(Boolean)))
        const departments = Array.from(new Set(completedInterventions.map(item => clean(item.departmentName)).filter(Boolean)))

        const background = [
            `${companyName} is${sector ? ` an SMME operating in the ${sector} sector` : ' an SMME'}.`,
            description ? description.replace(/([^.!?])$/, '$1.') : '',
            founded ? `The business was established or registered in ${dayjs(founded).isValid() ? dayjs(founded).format('YYYY') : founded}.` : '',
            location ? `It operates from ${location}.` : ''
        ].filter(Boolean).join(' ')
        const journey = [
            onboarded.isValid() ? `${companyName} joined the Lepharo incubation programme in ${onboarded.format('MMMM YYYY')}.` : `${companyName} is participating in the Lepharo incubation programme.`,
            titles.length ? `The business has completed ${titles.join(', ')}${departments.length ? ` with support from ${departments.join(', ')}` : ''}.` : ''
        ].filter(Boolean).join(' ')

        feedbackForm.setFieldsValue({
            background: current.background || background,
            lepharoJourney: current.lepharoJourney || journey
        })
    }, [applicationProfile, companyName, completedInterventions, feedbackForm, participantProfile, selectedType, storyKind])

    const metrics = useMemo(
        () => ({
            complaints: feedbackRecords.filter(item => item.type === 'complaint').length,
            praise: feedbackRecords.filter(item => item.type === 'praise').length,
            success: feedbackRecords.filter(item => item.type === 'success_story').length,
            inquiries: inquiries.length
        }),
        [feedbackRecords, inquiries]
    )

    const topMetrics: DashboardMetric[] = useMemo(() => [
        {
            key: 'complaints',
            important: true,
            icon: <ExclamationCircleOutlined style={{ color: '#f5222d' }} />,
            iconBg: 'rgba(245,34,45,0.12)',
            title: 'Complaints',
            value: metrics.complaints
        },
        {
            key: 'inquiries',
            important: true,
            icon: <FileSearchOutlined style={{ color: '#722ed1' }} />,
            iconBg: 'rgba(114,46,209,0.12)',
            title: 'Inquiries',
            value: metrics.inquiries
        },
        {
            key: 'praise',
            important: false,
            icon: <LikeOutlined style={{ color: '#52c41a' }} />,
            iconBg: 'rgba(82,196,26,0.14)',
            title: 'Praises',
            value: metrics.praise
        },
        {
            key: 'success',
            important: false,
            icon: <CheckCircleOutlined style={{ color: '#1677ff' }} />,
            iconBg: 'rgba(22,119,255,0.12)',
            title: 'Success Stories',
            mobileTitle: 'Success',
            value: metrics.success
        }
    ], [metrics])

    const filteredFeedback = useMemo(() => {
        const q = norm(searchText)
        return feedbackRecords.filter(row => {
            if (feedbackTypeFilter !== 'all' && row.type !== feedbackTypeFilter) return false
            if (!q) return true
            return (
                norm(row.title).includes(q) ||
                norm(row.message).includes(q) ||
                norm(row.interventionTitle).includes(q) ||
                norm(row.departmentName).includes(q) ||
                norm(row.assigneeName).includes(q)
            )
        })
    }, [feedbackRecords, feedbackTypeFilter, searchText])

    const filteredInquiries = useMemo(() => {
        const q = norm(searchText)
        return inquiries.filter(row => {
            const status = clean(row.status || 'New')
            if (inquiryStatusFilter !== 'all' && status !== inquiryStatusFilter) return false
            const type = row.inquiryDetails?.inquiryType || ''
            const services = row.inquiryDetails?.servicesOfInterest?.join(' ') || ''
            const body = row.inquiryDetails?.message || ''
            if (!q) return true
            return norm(`${type} ${services} ${body} ${status}`).includes(q)
        })
    }, [inquiries, inquiryStatusFilter, searchText])

    const resetFilters = () => {
        setSearchText('')
        setFeedbackTypeFilter('all')
        setInquiryStatusFilter('all')
    }

    const closeFeedbackModal = () => {
        setFeedbackModalOpen(false)
        setFeedbackStep(0)
        feedbackForm.resetFields()
        feedbackForm.setFieldsValue({ type: 'complaint', targetType: 'department', storyKind: 'SMME' })
        setSelectedType('complaint')
        setSelectedTarget('department')
        setSelectedDepartmentId(undefined)
    }

    const handleFeedbackSubmit = async (values: any) => {
        if (!participantId || !user?.email) {
            message.warning('Your SME profile could not be resolved.')
            return
        }

        setSavingFeedback(true)
        try {
            const intervention = interventions.find(item => item.id === values.interventionId)
            const department =
                departmentOptions.find(item => item.value === values.departmentId)?.label ||
                intervention?.departmentName ||
                null
            const consultant =
                consultantOptions.find(item => item.value === values.consultantId)?.label ||
                intervention?.assigneeName ||
                null

            const isSuccessStory = values.type === 'success_story'
            const payload = {
                applicationId,
                participantId,
                smeName: companyName || user.name || user.email,
                smeEmail: user.email,
                type: values.type as FeedbackType,
                title: values.title,
                message: isSuccessStory
                    ? (values.storyKind === 'Event' ? values.eventBenefits : values.achievement)
                    : values.message,
                storyKind: isSuccessStory ? values.storyKind || 'SMME' : null,
                source: isSuccessStory ? 'SME' : null,
                background: isSuccessStory ? values.background || '' : '',
                lepharoJourney: isSuccessStory ? values.lepharoJourney || '' : '',
                achievement: isSuccessStory ? values.achievement || '' : '',
                lepharoRole: isSuccessStory ? values.lepharoRole || '' : '',
                eventBackground: isSuccessStory ? values.eventBackground || '' : '',
                attendees: isSuccessStory ? values.attendees || '' : '',
                attendeeCount: isSuccessStory && values.attendeeCount ? Number(values.attendeeCount) : null,
                eventBenefits: isSuccessStory ? values.eventBenefits || '' : '',
                attachments: [],
                interventionAssignmentId: values.interventionId || null,
                interventionId: intervention?.interventionId || null,
                interventionTitle: intervention?.interventionTitle || null,
                targetType: values.type === 'complaint' ? values.targetType : null,
                departmentId: values.type === 'complaint' ? values.departmentId || intervention?.departmentId || null : intervention?.departmentId || null,
                departmentName: values.type === 'complaint' ? department : intervention?.departmentName || null,
                consultantId: values.type === 'complaint' && values.targetType === 'consultant' ? values.consultantId || null : intervention?.assigneeId || null,
                consultantName: values.type === 'complaint' && values.targetType === 'consultant' ? consultant : intervention?.assigneeName || null,
                status: 'New',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            }

            const docRef = await addDoc(collection(db, 'smeFeedback'), payload)
            const coverAttachments = isSuccessStory
                ? await uploadFiles(values.coverImage || [], `success-stories/sme-${docRef.id}/cover`)
                : []
            const evidenceAttachments = isSuccessStory
                ? await uploadFiles(values.documents || [], `success-stories/sme-${docRef.id}/evidence`)
                : []
            const attachments = [...coverAttachments, ...evidenceAttachments]
            const coverImageUrl = coverAttachments[0]?.url || ''
            if (attachments.length) {
                await updateDoc(doc(db, 'smeFeedback', docRef.id), { attachments, coverImageUrl, updatedAt: Timestamp.now() })
            }
            setFeedbackRecords(prev => [{ id: docRef.id, ...payload, attachments, coverImageUrl }, ...prev])
            closeFeedbackModal()
            message.success(isSuccessStory ? 'Success story submitted.' : 'Feedback submitted.')
        } catch (error) {
            console.error(error)
            message.error('Failed to submit feedback.')
        } finally {
            setSavingFeedback(false)
        }
    }

    const handleInquirySubmit = async (values: any) => {
        if (!user?.email || !user?.id) {
            message.warning('Your SME profile could not be resolved.')
            return
        }

        setSavingInquiry(true)
        try {
            const contactInfo = {
                name: participantProfile?.ownerName || user.name || companyName || '',
                email: participantProfile?.email || user.email || '',
                phone: participantProfile?.phone || ''
            }

            const payload = {
                participantId,
                applicationId,
                branchId: participantProfile?.branchId || 'unknown',
                submittedBy: user.id,
                submittedAt: Timestamp.now(),
                status: 'New',
                priority: 'Medium',
                classification: 'General',
                source: 'SME',
                sourceType: 'Incubatee',
                contactInfo,
                inquiryDetails: {
                    inquiryType: values.type,
                    servicesOfInterest: [values.serviceArea],
                    message: values.message
                },
                followUp: null,
                statusHistory: [
                    {
                        status: 'New',
                        changedAt: new Date(),
                        changedBy: user.id,
                        notes: 'Created by incubatee'
                    }
                ],
                tags: [],
                updatedAt: Timestamp.now(),
                isActive: true
            }

            const docRef = await addDoc(collection(db, 'inquiries'), payload)
            setInquiries(prev => [{ id: docRef.id, ...payload }, ...prev])
            inquiryForm.resetFields()
            setInquiryModalOpen(false)
            message.success('Inquiry submitted.')
        } catch (error) {
            console.error(error)
            message.error('Failed to submit inquiry.')
        } finally {
            setSavingInquiry(false)
        }
    }

    const feedbackColumns: ColumnsType<FeedbackRecord> = [
        {
            title: 'Type',
            dataIndex: 'type',
            render: (value: FeedbackType) => <Tag color={feedbackColors[value]}>{feedbackLabels[value] || value}</Tag>
        },
        { title: 'Title', dataIndex: 'title' },
        { title: 'Intervention', dataIndex: 'interventionTitle' },
        {
            title: 'Grouped By',
            render: (_, record) => {
                if (record.type !== 'complaint') return <Tag>Intervention</Tag>
                if (record.targetType === 'consultant') return <Tag color='purple'>{record.departmentName} / {record.consultantName}</Tag>
                return <Tag color='orange'>{record.departmentName || 'Department'}</Tag>
            }
        },
        { title: 'Status', dataIndex: 'status', render: (value: string) => <Tag>{value || 'New'}</Tag> },
        { title: 'Date', dataIndex: 'createdAt', render: formatDate }
    ]

    const successStoryDetails = (record: FeedbackRecord) => {
        if (record.type !== 'success_story') return <Paragraph style={{ marginBottom: 0 }}>{record.message}</Paragraph>
        const sections = record.storyKind === 'Event'
            ? [
                ['Event background', record.eventBackground || record.background],
                ['Who attended', record.attendees],
                ['Attendance', record.attendeeCount ? `${record.attendeeCount} attendees` : ''],
                ['Benefits and long-term outcomes', record.eventBenefits || record.message]
            ]
            : [
                ['SMME background', record.background],
                ['Journey with Lepharo', record.lepharoJourney],
                ['Achievement', record.achievement || record.message],
                ["Lepharo's contribution", record.lepharoRole]
            ]
        return (
            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                {sections.filter(([, value]) => clean(value)).map(([label, value]) => (
                    <div key={label}>
                        <Text strong>{label}</Text>
                        <Paragraph style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{value}</Paragraph>
                    </div>
                ))}
                {!!record.attachments?.length && (
                    <div>
                        <Text strong>Pictures and evidence</Text>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                            {record.attachments.map(file => file.type?.startsWith('image/') ? (
                                <Image key={file.url} src={file.url} alt={file.name} width={112} height={84} style={{ objectFit: 'cover', borderRadius: 8 }} />
                            ) : (
                                <Button key={file.url} href={file.url} target='_blank'>{file.name}</Button>
                            ))}
                        </div>
                    </div>
                )}
            </Space>
        )
    }

    const inquiryColumns: ColumnsType<InquiryRecord> = [
        { title: 'Type', render: (_, record) => record.inquiryDetails?.inquiryType || '-' },
        { title: 'Service Area', render: (_, record) => record.inquiryDetails?.servicesOfInterest?.join(', ') || '-' },
        { title: 'Message', render: (_, record) => <Paragraph ellipsis={{ rows: 2 }}>{record.inquiryDetails?.message || '-'}</Paragraph> },
        { title: 'Status', dataIndex: 'status', render: (value: string) => <Tag color={norm(value) === 'responded' ? 'green' : 'orange'}>{value || 'New'}</Tag> },
        { title: 'Date', render: (_, record) => formatDate(getInquiryDate(record)) },
        {
            title: 'Action',
            render: (_, record) => (
                <Button size='small' onClick={() => setViewInquiry(record)}>
                    View
                </Button>
            )
        }
    ]

    const requiredSuccessFields = storyKind === 'Event'
        ? ['storyKind', 'title', 'eventBackground', 'attendees', 'attendeeCount', 'eventBenefits', 'coverImage']
        : ['storyKind', 'title', 'interventionId', 'background', 'lepharoJourney', 'achievement', 'lepharoRole', 'coverImage']
    const completedSuccessFields = requiredSuccessFields.filter(field => {
        const value = feedbackFormValues[field]
        return Array.isArray(value) ? value.length > 0 : !!clean(value)
    }).length
    const successCompletionPercent = Math.round((completedSuccessFields / requiredSuccessFields.length) * 100)
    const successStepFields = () => {
        if (feedbackStep === 0) return storyKind === 'Event' ? ['type', 'storyKind', 'title'] : ['type', 'storyKind', 'title', 'interventionId']
        if (feedbackStep === 1) return storyKind === 'Event'
            ? ['eventBackground', 'attendees', 'attendeeCount', 'eventBenefits']
            : ['background', 'lepharoJourney', 'achievement', 'lepharoRole']
        return ['coverImage']
    }
    const goToNextFeedbackStep = async () => {
        try {
            await feedbackForm.validateFields(successStepFields())
            setFeedbackStep(current => Math.min(2, current + 1))
        } catch {
            message.warning('Complete the required fields before continuing.')
        }
    }

    const filterPanel = (
        <div style={{ ...sunkenPanelStyle, marginBottom: 16 }}>
            <Row gutter={[12, 12]} align='middle'>
                <Col xs={24} lg={6}>
                    <Segmented<SegmentKey>
                        block
                        value={segment}
                        onChange={value => {
                            setSegment(value as SegmentKey)
                            resetFilters()
                        }}
                        options={[
                            { label: 'Feedback', value: 'feedback' },
                            { label: 'Inquiries', value: 'inquiries' }
                        ]}
                    />
                </Col>

                <Col xs={24} lg={7}>
                    <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        value={searchText}
                        placeholder={
                            segment === 'feedback'
                                ? 'Search feedback...'
                                : 'Search inquiries...'
                        }
                        onChange={event => setSearchText(event.target.value)}
                    />
                </Col>

                <Col xs={24} lg={5}>
                    {segment === 'feedback' ? (
                        <Select
                            value={feedbackTypeFilter}
                            style={{ width: '100%' }}
                            onChange={value => setFeedbackTypeFilter(value)}
                            options={[
                                { value: 'all', label: 'All feedback' },
                                { value: 'complaint', label: 'Complaints' },
                                { value: 'praise', label: 'Praises' },
                                {
                                    value: 'success_story',
                                    label: 'Success Stories'
                                }
                            ]}
                        />
                    ) : (
                        <Select
                            value={inquiryStatusFilter}
                            style={{ width: '100%' }}
                            onChange={value => setInquiryStatusFilter(value)}
                            options={[
                                { value: 'all', label: 'All statuses' },
                                { value: 'New', label: 'New' },
                                { value: 'pending', label: 'Pending' },
                                { value: 'responded', label: 'Responded' },
                                { value: 'closed', label: 'Closed' }
                            ]}
                        />
                    )}
                </Col>

                <Col xs={24} lg={6}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: 8,
                            width: '100%',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        <Button
                            icon={<ClearOutlined />}
                            onClick={resetFilters}
                        >
                            Reset
                        </Button>

                        <Button
                            type='primary'
                            icon={<PlusOutlined />}
                            disabled={!participantId}
                            onClick={() => {
                                if (segment === 'feedback') {
                                    setFeedbackModalOpen(true)
                                } else {
                                    setInquiryModalOpen(true)
                                }
                            }}
                        >
                            {segment === 'feedback'
                                ? 'Add Feedback'
                                : 'New Inquiry'}
                        </Button>
                    </div>
                </Col>
            </Row>
        </div>
    )

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>SME Feedback & Inquiries</title>
            </Helmet>

            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                {!loading && !participantId && (
                    <Alert type='warning' showIcon message='No accepted SME application was found for this account.' />
                )}

                <MetricsGrid metrics={topMetrics} />

                <MotionCard>
                    {filterPanel}
                </MotionCard>

                <MotionCard title={segment === 'feedback' ? 'My Feedback' : 'My Inquiries'}>
                    {segment === 'feedback' ? (
                        feedbackRecords.length ? (
                            screens.md ? (
                                <Table
                                    rowKey='id'
                                    columns={feedbackColumns}
                                    dataSource={filteredFeedback}
                                    loading={loading}
                                    expandable={{ expandedRowRender: successStoryDetails }}
                                    pagination={{ pageSize: 8, position: ['bottomCenter'] }}
                                />
                            ) : (
                                <List
                                    className='centered-pagination-list'
                                    split={false}
                                    rowKey='id'
                                    dataSource={filteredFeedback}
                                    loading={loading}
                                    pagination={{ pageSize: 6 }}
                                    renderItem={record => (
                                        <List.Item style={{ padding: 0, marginBottom: 12 }}>
                                            <div style={mobileCardStyle}>
                                                <List.Item.Meta
                                                    title={
                                                        <Space wrap>
                                                            <Tag color={feedbackColors[record.type]}>{feedbackLabels[record.type] || record.type}</Tag>
                                                            <Text strong>{record.title}</Text>
                                                        </Space>
                                                    }
                                                    description={
                                                        <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                                            <Text type='secondary' style={{ fontSize: 12 }}>{record.interventionTitle || '-'}</Text>
                                                            <Space wrap>
                                                                {record.type !== 'complaint' ? (
                                                                    <Tag>Intervention</Tag>
                                                                ) : record.targetType === 'consultant' ? (
                                                                    <Tag color='purple'>{record.departmentName} / {record.consultantName}</Tag>
                                                                ) : (
                                                                    <Tag color='orange'>{record.departmentName || 'Department'}</Tag>
                                                                )}
                                                                <Tag>{record.status || 'New'}</Tag>
                                                            </Space>
                                                            <Text type='secondary' style={{ fontSize: 12 }}>{formatDate(record.createdAt)}</Text>
                                                            {record.type === 'success_story' && successStoryDetails(record)}
                                                        </Space>
                                                    }
                                                />
                                            </div>
                                        </List.Item>
                                    )}
                                />
                            )
                        ) : (
                            <Empty description='No feedback submitted yet' />
                        )
                    ) : inquiries.length ? (
                        screens.md ? (
                            <Table
                                rowKey='id'
                                columns={inquiryColumns}
                                dataSource={filteredInquiries}
                                loading={loading}
                                pagination={{ pageSize: 8, position: ['bottomCenter'] }}
                            />
                        ) : (
                            <List
                                className='centered-pagination-list'
                                split={false}
                                rowKey='id'
                                dataSource={filteredInquiries}
                                loading={loading}
                                pagination={{ pageSize: 6 }}
                                renderItem={record => {
                                    const status = record.status || 'New'
                                    return (
                                        <List.Item style={{ padding: 0, marginBottom: 12 }}>
                                            <div style={mobileCardStyle}>
                                                <List.Item.Meta
                                                    title={
                                                        <Space wrap>
                                                            <Text strong>{record.inquiryDetails?.inquiryType || 'Inquiry'}</Text>
                                                            <Tag>{record.inquiryDetails?.servicesOfInterest?.join(', ') || '-'}</Tag>
                                                        </Space>
                                                    }
                                                    description={
                                                        <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                                            <Paragraph
                                                                ellipsis={{ rows: 2 }}
                                                                style={{ marginBottom: 0 }}
                                                            >
                                                                {record.inquiryDetails?.message || '-'}
                                                            </Paragraph>
                                                            <Space wrap>
                                                                <Tag color={norm(status) === 'responded' ? 'green' : 'orange'}>{status}</Tag>
                                                                <Text type='secondary' style={{ fontSize: 12 }}>{formatDate(getInquiryDate(record))}</Text>
                                                            </Space>
                                                        </Space>
                                                    }
                                                />
                                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                                    <Button style={{ flex: 1 }} onClick={() => setViewInquiry(record)}>
                                                        View
                                                    </Button>
                                                </div>
                                            </div>
                                        </List.Item>
                                    )
                                }}
                            />
                        )
                    ) : (
                        <Empty description='No inquiries submitted yet' />
                    )}
                </MotionCard>
            </Space>

            <style>{`
                .centered-pagination-list .ant-list-pagination {
                    text-align: center;
                }
                .centered-pagination-list .ant-list-pagination .ant-pagination {
                    display: flex;
                    justify-content: center;
                }
            `}</style>

            <Modal title='Submit Feedback' open={feedbackModalOpen} onCancel={closeFeedbackModal} footer={null} width={760} destroyOnClose>
                <Form form={feedbackForm} layout='vertical' onFinish={handleFeedbackSubmit} initialValues={{ type: 'complaint', targetType: 'department', storyKind: 'SMME' }}>
                    {selectedType === 'success_story' && <>
                        <Steps current={feedbackStep} responsive items={[{ title: 'Story subject' }, { title: 'Case study' }, { title: 'Evidence & review' }]} style={{ marginBottom: 16 }} />
                        <div style={{ background: '#f5f7fb', borderRadius: 12, padding: '10px 14px', marginBottom: 16 }}>
                            <Space direction='vertical' size={4} style={{ width: '100%' }}>
                                <Space style={{ width: '100%', justifyContent: 'space-between' }}><Text strong>Story completeness</Text><Text>{completedSuccessFields} of {requiredSuccessFields.length} required sections</Text></Space>
                                <Progress percent={successCompletionPercent} size='small' status={successCompletionPercent === 100 ? 'success' : 'active'} />
                            </Space>
                        </div>
                    </>}
                    {(selectedType !== 'success_story' || feedbackStep === 0) && <>
                        <Form.Item label='Feedback Type' name='type' rules={[{ required: true }]}>
                            <Select
                                onChange={(value: FeedbackType) => {
                                    setSelectedType(value)
                                    feedbackForm.setFieldValue('targetType', value === 'complaint' ? 'department' : undefined)
                                    feedbackForm.setFieldValue('interventionId', undefined)
                                }}
                                options={[
                                    { value: 'complaint', label: 'Complaint' },
                                    { value: 'praise', label: 'Praise' },
                                    { value: 'success_story', label: 'Success Story' }
                                ]}
                            />
                        </Form.Item>
                    </>}
                    {selectedType === 'success_story' && (
                        <Alert
                            showIcon
                            type='info'
                            style={{ marginBottom: 16 }}
                            message='Your background and Lepharo journey are prefilled from your existing records.'
                            description='Review and edit the draft, then add the achievement and supporting pictures.'
                        />
                    )}
                    {(selectedType !== 'success_story' || (feedbackStep === 0 && storyKind !== 'Event')) && <Form.Item label={selectedType === 'success_story' ? 'SME-confirmed intervention' : 'Intervention Received'} name='interventionId' rules={[{ required: true, message: 'Select an intervention' }]}>
                        <Select
                            loading={loading}
                            showSearch
                            placeholder='Select intervention'
                            optionFilterProp='label'
                            options={(selectedType === 'success_story' ? completedInterventions : interventions).map(item => ({
                                value: item.id,
                                label: `${item.interventionTitle} - ${item.departmentName}`
                            }))}
                            notFoundContent={selectedType === 'success_story' ? 'No completed interventions were found for your SME.' : 'No interventions found.'}
                        />
                    </Form.Item>}

                    {selectedType === 'complaint' && (
                        <>
                            <Form.Item label='Complaint About' name='targetType' rules={[{ required: true }]}>
                                <Select
                                    onChange={(value: ComplaintTarget) => setSelectedTarget(value)}
                                    options={[
                                        { value: 'department', label: 'Department' },
                                        { value: 'consultant', label: 'Facilitator' }
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item label='Department' name='departmentId' rules={[{ required: true, message: 'Select a department' }]}>
                                <Select
                                    showSearch
                                    placeholder='Select department'
                                    optionFilterProp='label'
                                    onChange={value => {
                                        setSelectedDepartmentId(value)
                                        feedbackForm.setFieldValue('consultantId', undefined)
                                    }}
                                    options={departmentOptions}
                                />
                            </Form.Item>
                            {selectedTarget === 'consultant' && (
                                <Form.Item label='Facilitator' name='consultantId' rules={[{ required: true, message: 'Select a facilitator' }]}>
                                    <Select showSearch placeholder='Select consultant' optionFilterProp='label' options={consultantOptions} />
                                </Form.Item>
                            )}
                        </>
                    )}

                    {selectedType === 'success_story' ? <>
                        {feedbackStep === 0 && <>
                            <Form.Item label='Success story type' name='storyKind' rules={[{ required: true }]}>
                                <Segmented block options={['SMME', 'Event']} />
                            </Form.Item>
                            <Form.Item label='Story title' name='title' rules={[{ required: true, whitespace: true, message: 'Add a clear story title' }]}>
                                <Input placeholder={storyKind === 'Event' ? 'E.g. Market access event opens new opportunities' : 'E.g. Our first major contract after joining Lepharo'} />
                            </Form.Item>
                        </>}
                        {feedbackStep === 1 && (storyKind !== 'Event' ? <>
                            <Divider orientation='left'>SMME case study</Divider>
                            <Form.Item label={<span>Background on your business <Tag color='blue'>From your records</Tag></span>} name='background' rules={[{ required: true, whitespace: true }]}>
                                <TextArea rows={3} placeholder='What you do, how long you have operated, your sector and relevant background.' />
                            </Form.Item>
                            <Form.Item label={<span>Your journey with Lepharo <Tag color='blue'>From programme records</Tag></span>} name='lepharoJourney' rules={[{ required: true, whitespace: true }]}>
                                <TextArea rows={4} placeholder='When you joined, where the business started, support received and where it is now.' />
                            </Form.Item>
                            <Form.Item label='Detailed achievement' name='achievement' rules={[{ required: true, whitespace: true }]}>
                                <TextArea rows={4} placeholder='Describe the award, contract, funding, growth, jobs or other result. Include dates and values where possible.' />
                            </Form.Item>
                            <Form.Item label="Lepharo's contribution" name='lepharoRole' rules={[{ required: true, whitespace: true }]}>
                                <TextArea rows={3} placeholder='Which interventions or support helped you achieve this outcome? If not directly linked, say so.' />
                            </Form.Item>
                        </> : <>
                            <Divider orientation='left'>Event success story</Divider>
                            <Form.Item label='Event background' name='eventBackground' rules={[{ required: true, whitespace: true }]}>
                                <TextArea rows={4} placeholder='When it happened, why it was hosted or attended, intended beneficiaries and immediate outcomes.' />
                            </Form.Item>
                            <Row gutter={12}>
                                <Col xs={24} md={16}><Form.Item label='Who attended' name='attendees' rules={[{ required: true, whitespace: true }]}><TextArea rows={3} placeholder='Stakeholders and beneficiary types.' /></Form.Item></Col>
                                <Col xs={24} md={8}><Form.Item label='Number of attendees' name='attendeeCount' rules={[{ required: true, message: 'Add attendance' }]}><Input type='number' min={1} /></Form.Item></Col>
                            </Row>
                            <Form.Item label='Benefits and long-term outcomes' name='eventBenefits' rules={[{ required: true, whitespace: true }]}>
                                <TextArea rows={4} placeholder='Benefits, follow-on opportunities and expected long-term outcomes.' />
                            </Form.Item>
                        </>)}
                        {feedbackStep === 2 && <>
                            <Alert showIcon type='info' style={{ marginBottom: 16 }} message='Choose a strong cover photograph. It will lead your story in the Success Story Library.' />
                            <Form.Item label='Primary cover image' name='coverImage' valuePropName='fileList' getValueFromEvent={e => e?.fileList || []} rules={[{ required: true, message: 'Add a primary cover image' }]}>
                                <Upload beforeUpload={() => false} maxCount={1} accept='image/*' listType='picture'>
                                    <Button icon={<PictureOutlined />}>Choose cover image</Button>
                                </Upload>
                            </Form.Item>
                            <Form.Item label='Additional pictures and supporting evidence (optional)' name='documents' valuePropName='fileList' getValueFromEvent={e => e?.fileList || []}>
                                <Upload beforeUpload={() => false} multiple accept='image/*,.pdf'>
                                    <Button icon={<UploadOutlined />}>Add pictures or PDFs</Button>
                                </Upload>
                            </Form.Item>
                            <div style={{ padding: 14, border: '1px solid #e6e9f0', borderRadius: 12, background: '#fafafa', marginBottom: 16 }}><Text strong>{feedbackFormValues.title || 'Untitled story'}</Text><Paragraph ellipsis={{ rows: 3 }} style={{ margin: '6px 0 0' }}>{storyKind === 'Event' ? feedbackFormValues.eventBenefits : feedbackFormValues.achievement}</Paragraph></div>
                        </>}
                    </> : <>
                        <Form.Item label='Title' name='title' rules={[{ required: true, message: 'Add a title' }]}>
                            <Input placeholder='Short summary' />
                        </Form.Item>
                        <Form.Item label='Details' name='message' rules={[{ required: true, message: 'Add the details' }]}>
                            <TextArea rows={6} placeholder='Tell us what happened and what outcome you would like.' />
                        </Form.Item>
                    </>}
                    <Row gutter={12}>
                        {selectedType === 'success_story' ? <>
                            <Col span={8}><Button block onClick={feedbackStep === 0 ? closeFeedbackModal : () => setFeedbackStep(current => current - 1)}>{feedbackStep === 0 ? 'Cancel' : 'Back'}</Button></Col>
                            <Col span={16}>{feedbackStep < 2 ? <Button block type='primary' onClick={goToNextFeedbackStep}>Continue</Button> : <Button block type='primary' loading={savingFeedback} icon={<PlusOutlined />} onClick={() => feedbackForm.submit()}>Submit Success Story</Button>}</Col>
                        </> : <>
                            <Col span={12}><Button block onClick={closeFeedbackModal}>Cancel</Button></Col>
                            <Col span={12}><Button block type='primary' htmlType='submit' loading={savingFeedback} icon={<PlusOutlined />}>Save</Button></Col>
                        </>}
                    </Row>
                </Form>
            </Modal>

            <Modal title='Submit New Inquiry' open={inquiryModalOpen} onCancel={() => setInquiryModalOpen(false)} footer={null} width={680} destroyOnClose>
                <Form layout='vertical' form={inquiryForm} onFinish={handleInquirySubmit}>
                    <Form.Item name='type' label='Inquiry Type' rules={[{ required: true }]}>
                        <Select placeholder='Select inquiry type' options={inquiryTypes.map(value => ({ value, label: value }))} />
                    </Form.Item>
                    <Form.Item name='serviceArea' label='Service Area' rules={[{ required: true }]}>
                        <Select placeholder='Select related service area' options={serviceAreas.map(value => ({ value, label: value }))} />
                    </Form.Item>
                    <Form.Item name='message' label='Message' rules={[{ required: true }]}>
                        <TextArea rows={5} placeholder='Describe your issue or request...' />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Button block onClick={() => setInquiryModalOpen(false)}>Cancel</Button>
                        </Col>
                        <Col span={12}>
                            <Button block type='primary' htmlType='submit' loading={savingInquiry} icon={<PlusOutlined />}>Submit</Button>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal title='Inquiry Details' open={!!viewInquiry} onCancel={() => setViewInquiry(null)} footer={<Button onClick={() => setViewInquiry(null)}>Close</Button>}>
                {viewInquiry && (
                    <Space direction='vertical' style={{ width: '100%' }}>
                        <Text><Text strong>Type:</Text> {viewInquiry.inquiryDetails?.inquiryType || '-'}</Text>
                        <Text><Text strong>Service Area:</Text> {viewInquiry.inquiryDetails?.servicesOfInterest?.join(', ') || '-'}</Text>
                        <div>
                            <Text strong>Message:</Text>
                            <Paragraph>{viewInquiry.inquiryDetails?.message || '-'}</Paragraph>
                        </div>
                        <Divider />
                        <div>
                            <Text strong>Responses:</Text>
                            {(() => {
                                const thread = (viewInquiry.communications || [])
                                    .filter(c => !c.isInternal)
                                    .slice()
                                    .sort((a, b) => (a.sentAt?.seconds || 0) - (b.sentAt?.seconds || 0))

                                if (!thread.length) {
                                    return <Paragraph><Text type='secondary'>No response yet.</Text></Paragraph>
                                }

                                return (
                                    <Space direction='vertical' size={10} style={{ width: '100%', marginTop: 8 }}>
                                        {thread.map(comm => {
                                            const { subject, body } = parseCommunicationMessage(comm.message)
                                            return (
                                                <div key={comm.id} style={sunkenPanelStyle}>
                                                    <Space direction='vertical' size={4} style={{ width: '100%' }}>
                                                        <Space wrap>
                                                            <Text strong>{subject || 'Response'}</Text>
                                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                                {comm.sentByName} ({comm.sentByRole})
                                                            </Text>
                                                        </Space>
                                                        <Paragraph style={{ marginBottom: 0 }}>{body}</Paragraph>
                                                        <Text type='secondary' style={{ fontSize: 12 }}>{formatDate(comm.sentAt)}</Text>
                                                    </Space>
                                                </div>
                                            )
                                        })}
                                    </Space>
                                )
                            })()}
                        </div>
                    </Space>
                )}
            </Modal>
        </div>
    )
}

export default SmeFeedbackPage
