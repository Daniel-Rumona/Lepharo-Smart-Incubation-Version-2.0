import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Col,
    DatePicker,
    Empty,
    Form,
    Grid,
    Input,
    List,
    message,
    Modal,
    Pagination,
    Row,
    Segmented,
    Select,
    Skeleton,
    Space,
    Table,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    ArrowLeftOutlined,
    BankOutlined,
    CalendarOutlined,
    ClockCircleOutlined,
    ContactsOutlined,
    DeleteOutlined,
    EditOutlined,
    EyeOutlined,
    FileTextOutlined,
    FilterOutlined,
    MailOutlined,
    MessageOutlined,
    NotificationOutlined,
    PhoneOutlined,
    PlusOutlined,
    SearchOutlined,
    SlackOutlined,
    UserOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
    deleteDoc,
    doc
} from 'firebase/firestore'

import { db } from '@/firebase'
import { inquiryService } from '@/services/inquiryService'
import { branchService } from '@/services/branchService'
import {
    FollowUpMethod,
    Inquiry,
    InquiryPriority,
    InquiryStatus,
    InquiryType,
    ServiceOfInterest
} from '@/types/inquiry'
import { Branch } from '@/types/types'
import ApplicantInquirySubmission from '../submit-inquiry'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const { Text, Paragraph } = Typography
const { TextArea } = Input
const { RangePicker } = DatePicker
const { useBreakpoint } = Grid

const MOBILE_PAGE_SIZE = 5

type DetailSection =
    | 'overview'
    | 'responses'
    | 'history'

type EditSection =
    | 'details'
    | 'routing'
    | 'contact'
    | 'business'
    | 'followup'

const inquiryTypeOptions: InquiryType[] = [
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

const compactTagStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'fit-content',
    height: 22,
    lineHeight: '20px',
    paddingInline: 8,
    marginInlineEnd: 0,
    alignSelf: 'flex-start',
    borderRadius: 999
}

const metricIconBg = (hex: string) =>
    `${hex}1F`

const METRIC_ICON_STYLE: Record<
    string,
    React.CSSProperties
> = {
    '#1677ff': {
        color: '#1677ff',
        fontSize: 17
    },
    '#1890ff': {
        color: '#1890ff',
        fontSize: 17
    },
    '#faad14': {
        color: '#faad14',
        fontSize: 17
    },
    '#52c41a': {
        color: '#52c41a',
        fontSize: 17
    }
}

const ApplicantInquiries: React.FC = () => {
    const { token } = theme.useToken()
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const navigate = useNavigate()

    const [editForm] = Form.useForm()

    const [inquiries, setInquiries] =
        useState<Inquiry[]>([])

    const [filteredInquiries, setFilteredInquiries] =
        useState<Inquiry[]>([])

    const [branches, setBranches] =
        useState<Branch[]>([])

    const [loading, setLoading] =
        useState(true)

    const [
        selectedInquiry,
        setSelectedInquiry
    ] = useState<Inquiry | null>(null)

    const [
        detailModalVisible,
        setDetailModalVisible
    ] = useState(false)

    const [
        detailSection,
        setDetailSection
    ] = useState<DetailSection>(
        'overview'
    )

    const [submitOpen, setSubmitOpen] =
        useState(false)

    // On mobile the wizard is its own full page (more room than a Modal
    // allows); on desktop it stays the existing Modal flow.
    const openSubmitInquiry = () => {
        if (isMobile) {
            navigate('/applicant/submit-inquiry')
            return
        }

        setSubmitOpen(true)
    }

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'applicant-inquiries',
            pageTitle: 'My Inquiries',
            guides: [
                {
                    id: 'inquiries-walkthrough',
                    title: 'How to track and manage your inquiries',
                    description:
                        'Find inquiries you have submitted and follow up on them.',
                    kind: 'page',
                    steps: [
                        {
                            element: guideTarget('new-inquiry-btn'),
                            popover: {
                                title: 'Submit a new inquiry',
                                description:
                                    'Start a fresh inquiry to our team from here.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('inquiries-filters'),
                            popover: {
                                title: 'Search and filter',
                                description:
                                    'Narrow the list by keyword, status, priority, or inquiry type.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('inquiries-results'),
                            popover: {
                                title: 'Your inquiries',
                                description:
                                    'Open any inquiry to see its details and responses.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    const [statusFilter, setStatusFilter] =
        useState<
            InquiryStatus | 'all'
        >('all')

    const [
        priorityFilter,
        setPriorityFilter
    ] = useState<
        InquiryPriority | 'all'
    >('all')

    const [
        inquiryTypeFilter,
        setInquiryTypeFilter
    ] = useState('all')

    const [searchText, setSearchText] =
        useState('')

    const [dateRange, setDateRange] =
        useState<
            [
                dayjs.Dayjs,
                dayjs.Dayjs
            ] | null
        >(null)

    const [mobilePage, setMobilePage] =
        useState(1)

    const [editOpen, setEditOpen] =
        useState(false)

    const [
        editInquiry,
        setEditInquiry
    ] = useState<Inquiry | null>(null)

    const [
        editSection,
        setEditSection
    ] = useState<
        EditSection | null
    >(null)

    const [editSaving, setEditSaving] =
        useState(false)

    const {
        user,
        loading: identityLoading
    } = useFullIdentity()

    const selectedEditInquiryType =
        Form.useWatch(
            'inquiryType',
            editForm
        ) as InquiryType | undefined

    const selectedEditPriority =
        Form.useWatch(
            'priority',
            editForm
        ) as InquiryPriority | undefined

    const loadData = async (
        showLoader = true
    ) => {
        if (!user?.uid) return

        if (showLoader) {
            setLoading(true)
        }

        try {
            const userInquiries =
                await inquiryService.getInquiries({
                    submittedBy: user.uid,
                    limit: 100
                })

            setInquiries(
                userInquiries
            )

            const allBranches =
                await branchService.getAllBranches()

            setBranches(
                allBranches
            )
        } catch (error) {
            console.error(
                'Error loading inquiries:',
                error
            )

            message.error(
                'Failed to load inquiries'
            )
        } finally {
            if (showLoader) {
                setLoading(false)
            }
        }
    }

    useEffect(() => {
        if (
            !identityLoading &&
            user?.uid
        ) {
            loadData()
        }
    }, [
        identityLoading,
        user?.uid
    ])

    const inquiryTypes = useMemo(
        () =>
            Array.from(
                new Set(
                    inquiries
                        .map(
                            inquiry =>
                                inquiry
                                    .inquiryDetails
                                    .inquiryType
                        )
                        .filter(Boolean)
                )
            ).sort(),
        [inquiries]
    )

    useEffect(() => {
        let filtered = [
            ...inquiries
        ]

        if (
            statusFilter !== 'all'
        ) {
            filtered =
                filtered.filter(
                    inquiry =>
                        inquiry.status ===
                        statusFilter
                )
        }

        if (
            priorityFilter !== 'all'
        ) {
            filtered =
                filtered.filter(
                    inquiry =>
                        inquiry.priority ===
                        priorityFilter
                )
        }

        if (
            inquiryTypeFilter !==
            'all'
        ) {
            filtered =
                filtered.filter(
                    inquiry =>
                        inquiry
                            .inquiryDetails
                            .inquiryType ===
                        inquiryTypeFilter
                )
        }

        if (searchText.trim()) {
            const search =
                searchText
                    .trim()
                    .toLowerCase()

            filtered =
                filtered.filter(
                    inquiry =>
                        inquiry.contactInfo.firstName
                            .toLowerCase()
                            .includes(
                                search
                            ) ||
                        inquiry.contactInfo.lastName
                            .toLowerCase()
                            .includes(
                                search
                            ) ||
                        inquiry.contactInfo.email
                            ?.toLowerCase()
                            .includes(
                                search
                            ) ||
                        inquiry.contactInfo.company
                            ?.toLowerCase()
                            .includes(
                                search
                            ) ||
                        inquiry.inquiryDetails.description
                            .toLowerCase()
                            .includes(
                                search
                            ) ||
                        inquiry.inquiryDetails.inquiryType
                            ?.toLowerCase()
                            .includes(
                                search
                            )
                )
        }

        if (dateRange) {
            filtered =
                filtered.filter(
                    inquiry => {
                        const inquiryDate =
                            dayjs(
                                inquiry.submittedAt
                            )

                        return (
                            inquiryDate.isAfter(
                                dateRange[
                                    0
                                ].startOf(
                                    'day'
                                )
                            ) &&
                            inquiryDate.isBefore(
                                dateRange[
                                    1
                                ].endOf(
                                    'day'
                                )
                            )
                        )
                    }
                )
        }

        setFilteredInquiries(
            filtered
        )

        setMobilePage(1)
    }, [
        inquiries,
        statusFilter,
        priorityFilter,
        inquiryTypeFilter,
        searchText,
        dateRange
    ])

    const getBranchName = (
        branchId: string
    ) => {
        const branch =
            branches.find(
                item =>
                    item.id ===
                    branchId
            )

        return branch
            ? `${branch.name}`
            : branchId
    }

    const getStatusColor = (
        status: InquiryStatus
    ) => {
        const colors: Record<
            string,
            string
        > = {
            New: 'blue',
            'In Progress':
                'orange',
            Contacted: 'cyan',
            Converted: 'green',
            Closed: 'default',
            Lost: 'red'
        }

        return (
            colors[status] ||
            'default'
        )
    }

    const getPriorityColor = (
        priority: InquiryPriority
    ) => {
        const colors: Record<
            string,
            string
        > = {
            Low: 'green',
            Medium: 'blue',
            High: 'orange',
            Urgent: 'red'
        }

        return (
            colors[priority] ||
            'default'
        )
    }

    const getExternalCommunications = (
        inquiry?: Inquiry | null
    ) =>
        inquiry?.communications?.filter(
            communication =>
                !communication.isInternal
        ) || []

    const canModifyInquiry = (
        inquiry?: Inquiry | null
    ) => {
        if (
            !inquiry ||
            !user?.uid
        ) {
            return false
        }

        const ownerId =
            (inquiry as any)
                .submittedBy

        const isOwner =
            ownerId === user.uid

        const hasActivity =
            Boolean(
                inquiry.communications
                    ?.length
            )

        return (
            isOwner &&
            inquiry.status === 'New' &&
            !hasActivity
        )
    }

    const extractOtherInquiry = (
        inquiry: Inquiry
    ) => {
        const description =
            inquiry.inquiryDetails
                .description || ''

        if (
            inquiry.inquiryDetails
                .inquiryType !==
            'Other'
        ) {
            return {
                otherType: '',
                description
            }
        }

        const match =
            description.match(
                /^Inquiry type:\s*(.+?)\n\n([\s\S]*)$/i
            )

        if (!match) {
            return {
                otherType: '',
                description
            }
        }

        return {
            otherType:
                match[1].trim(),
            description:
                match[2].trim()
        }
    }

    const getInquiryTypeLabel = (
        inquiry: Inquiry
    ) => {
        if (
            inquiry.inquiryDetails
                .inquiryType !==
            'Other'
        ) {
            return inquiry
                .inquiryDetails
                .inquiryType
        }

        const parsed =
            extractOtherInquiry(
                inquiry
            )

        return (
            parsed.otherType ||
            'Other'
        )
    }

    const showInquiryDetail = (
        inquiry: Inquiry
    ) => {
        setSelectedInquiry(
            inquiry
        )
        setDetailSection(
            'overview'
        )
        setDetailModalVisible(
            true
        )
    }

    const clearFilters = () => {
        setStatusFilter('all')
        setPriorityFilter('all')
        setInquiryTypeFilter(
            'all'
        )
        setSearchText('')
        setDateRange(null)
    }

    const stats = useMemo(
        () => ({
            total: inquiries.length,

            new: inquiries.filter(
                inquiry =>
                    inquiry.status ===
                    'New'
            ).length,

            inProgress:
                inquiries.filter(
                    inquiry =>
                        inquiry.status ===
                        'In Progress'
                ).length,

            thisMonth:
                inquiries.filter(
                    inquiry =>
                        dayjs(
                            inquiry.submittedAt
                        ).isAfter(
                            dayjs().startOf(
                                'month'
                            )
                        )
                ).length
        }),
        [inquiries]
    )

    const metricCards = useMemo(() => {
        const totalMetric = {
            key: 'total',
            title:
                'Total Inquiries',
            value: stats.total,
            icon: (
                <FileTextOutlined
                    style={
                        METRIC_ICON_STYLE[
                        '#1677ff'
                        ]
                    }
                />
            ),
            iconBg:
                metricIconBg(
                    '#1677ff'
                )
        }

        const newMetric = {
            key: 'new',
            title: 'New',
            value: stats.new,
            icon: (
                <SlackOutlined
                    style={
                        METRIC_ICON_STYLE[
                        '#1890ff'
                        ]
                    }
                />
            ),
            iconBg:
                metricIconBg(
                    '#1890ff'
                )
        }

        const inProgressMetric = {
            key: 'progress',
            title:
                'In Progress',
            value:
                stats.inProgress,
            icon: (
                <ClockCircleOutlined
                    style={
                        METRIC_ICON_STYLE[
                        '#faad14'
                        ]
                    }
                />
            ),
            iconBg:
                metricIconBg(
                    '#faad14'
                )
        }

        const monthMetric = {
            key: 'month',
            title: 'This Month',
            value:
                stats.thisMonth,
            icon: (
                <CalendarOutlined
                    style={
                        METRIC_ICON_STYLE[
                        '#52c41a'
                        ]
                    }
                />
            ),
            iconBg:
                metricIconBg(
                    '#52c41a'
                )
        }

        if (isMobile) {
            return [
                totalMetric,
                inProgressMetric
            ]
        }

        return [
            totalMetric,
            newMetric,
            inProgressMetric,
            monthMetric
        ]
    }, [
        isMobile,
        stats
    ])

    const mobileInquiries =
        useMemo(() => {
            const start =
                (mobilePage - 1) *
                MOBILE_PAGE_SIZE

            return filteredInquiries.slice(
                start,
                start +
                MOBILE_PAGE_SIZE
            )
        }, [
            filteredInquiries,
            mobilePage
        ])

    const openEdit = (
        inquiry: Inquiry
    ) => {
        if (
            !canModifyInquiry(
                inquiry
            )
        ) {
            message.info(
                'This inquiry can no longer be edited because processing has already started.'
            )
            return
        }

        setDetailModalVisible(
            false
        )

        setEditInquiry(
            inquiry
        )

        setEditSection(null)
        editForm.resetFields()
        setEditOpen(true)
    }

    const openEditSection = (
        section: EditSection
    ) => {
        if (!editInquiry) {
            return
        }

        const inquiry =
            editInquiry

        const parsedOther =
            extractOtherInquiry(
                inquiry
            )

        const followUp =
            (inquiry as any)
                .followUp

        switch (section) {
            case 'details':
                editForm.setFieldsValue({
                    inquiryType:
                        inquiry
                            .inquiryDetails
                            .inquiryType,
                    otherInquiryType:
                        parsedOther.otherType,
                    description:
                        parsedOther.description
                })
                break

            case 'routing':
                editForm.setFieldsValue({
                    priority:
                        inquiry.priority,
                    branchId:
                        inquiry.branchId
                })
                break

            case 'contact':
                editForm.setFieldsValue({
                    firstName:
                        inquiry.contactInfo
                            .firstName,
                    lastName:
                        inquiry.contactInfo
                            .lastName,
                    email:
                        inquiry.contactInfo
                            .email,
                    phone:
                        inquiry.contactInfo
                            .phone
                })
                break

            case 'business':
                editForm.setFieldsValue({
                    company:
                        inquiry.contactInfo
                            .company,
                    position:
                        inquiry.contactInfo
                            .position
                })
                break

            case 'followup':
                editForm.setFieldsValue({
                    nextFollowUpDate:
                        followUp
                            ?.nextFollowUpDate
                            ? dayjs(
                                followUp.nextFollowUpDate
                            )
                            : null,
                    followUpMethod:
                        followUp
                            ?.followUpMethod
                })
                break
        }

        setEditSection(
            section
        )
    }

    const saveEditSection =
        async () => {
            if (
                !editInquiry ||
                !editSection
            ) {
                return
            }

            if (
                !canModifyInquiry(
                    editInquiry
                )
            ) {
                message.error(
                    'This inquiry can no longer be edited.'
                )

                return
            }

            try {
                const values =
                    await editForm.validateFields()

                setEditSaving(true)

                let patch: any = {}

                if (
                    editSection ===
                    'details'
                ) {
                    const type =
                        values.inquiryType as InquiryType

                    const mappedService =
                        serviceCompatibilityMap[
                        type
                        ]

                    const description =
                        type ===
                            'Other' &&
                            values.otherInquiryType?.trim()
                            ? `Inquiry type: ${values.otherInquiryType.trim()}\n\n${values.description.trim()}`
                            : values.description.trim()

                    patch = {
                        inquiryDetails: {
                            ...editInquiry.inquiryDetails,
                            inquiryType:
                                type,
                            description,
                            servicesOfInterest:
                                mappedService
                                    ? [
                                        mappedService
                                    ]
                                    : []
                        }
                    }
                }

                if (
                    editSection ===
                    'routing'
                ) {
                    patch = {
                        priority:
                            values.priority,
                        branchId:
                            values.branchId
                    }
                }

                if (
                    editSection ===
                    'contact'
                ) {
                    patch = {
                        contactInfo: {
                            ...editInquiry.contactInfo,
                            firstName:
                                values.firstName,
                            lastName:
                                values.lastName,
                            email:
                                values.email,
                            phone:
                                values.phone
                        }
                    }
                }

                if (
                    editSection ===
                    'business'
                ) {
                    patch = {
                        contactInfo: {
                            ...editInquiry.contactInfo,
                            company:
                                values.company ||
                                '',
                            position:
                                values.position ||
                                ''
                        }
                    }
                }

                if (
                    editSection ===
                    'followup'
                ) {
                    patch = {
                        followUp:
                            values.nextFollowUpDate
                                ? {
                                    nextFollowUpDate:
                                        values.nextFollowUpDate.toDate(),
                                    followUpMethod:
                                        values.followUpMethod ||
                                        'Email'
                                }
                                : null
                    }
                }

                await inquiryService.updateInquiry(
                    editInquiry.id,
                    patch
                )

                const updatedInquiry = {
                    ...editInquiry,
                    ...patch
                } as Inquiry

                setInquiries(
                    current =>
                        current.map(
                            item =>
                                item.id ===
                                    updatedInquiry.id
                                    ? updatedInquiry
                                    : item
                        )
                )

                setSelectedInquiry(
                    updatedInquiry
                )

                setEditInquiry(
                    updatedInquiry
                )

                setEditOpen(false)
                setEditSection(null)

                setDetailSection(
                    'overview'
                )

                setDetailModalVisible(
                    true
                )

                message.success(
                    'Inquiry updated successfully.'
                )

                await loadData(
                    false
                )
            } catch (error: any) {
                if (
                    error?.errorFields
                ) {
                    return
                }

                console.error(
                    'Error updating inquiry:',
                    error
                )

                message.error(
                    'Failed to update inquiry.'
                )
            } finally {
                setEditSaving(false)
            }
        }

    const deleteInquiry = (
        inquiry: Inquiry
    ) => {
        if (
            !canModifyInquiry(
                inquiry
            )
        ) {
            message.info(
                'This inquiry can no longer be deleted because processing has already started.'
            )
            return
        }

        Modal.confirm({
            centered: true,
            title:
                'Delete this inquiry?',
            content:
                'This inquiry has not been processed yet. Deleting it will permanently remove it.',
            okText: 'Delete',
            cancelText:
                'Keep Inquiry',
            okButtonProps: {
                danger: true,
                shape: 'round'
            },
            cancelButtonProps: {
                shape: 'round'
            },
            onOk: async () => {
                try {
                    await deleteDoc(
                        doc(
                            db,
                            'inquiries',
                            inquiry.id
                        )
                    )

                    setDetailModalVisible(
                        false
                    )

                    setSelectedInquiry(
                        null
                    )

                    setInquiries(
                        current =>
                            current.filter(
                                item =>
                                    item.id !==
                                    inquiry.id
                            )
                    )

                    message.success(
                        'Inquiry deleted.'
                    )

                    await loadData(
                        false
                    )
                } catch (error) {
                    console.error(
                        'Error deleting inquiry:',
                        error
                    )

                    message.error(
                        'Failed to delete inquiry.'
                    )

                    throw error
                }
            }
        })
    }

    const columns = [
        {
            title: 'Contact',
            key: 'contact',
            render: (
                _: unknown,
                record: Inquiry
            ) => {
                const hasRecentResponse =
                    getExternalCommunications(
                        record
                    ).some(
                        communication =>
                            dayjs(
                                communication.sentAt
                            ).isAfter(
                                dayjs().subtract(
                                    3,
                                    'days'
                                )
                            )
                    )

                return (
                    <div>
                        <Space size={6}>
                            <Text strong>
                                {
                                    record
                                        .contactInfo
                                        .firstName
                                }{' '}
                                {
                                    record
                                        .contactInfo
                                        .lastName
                                }
                            </Text>

                            {hasRecentResponse && (
                                <NotificationOutlined
                                    style={{
                                        color:
                                            token.colorSuccess
                                    }}
                                />
                            )}
                        </Space>

                        <div>
                            <Text
                                type="secondary"
                                style={{
                                    fontSize:
                                        12
                                }}
                            >
                                {record
                                    .contactInfo
                                    .company ||
                                    'No company'}
                            </Text>
                        </div>
                    </div>
                )
            }
        },
        {
            title: 'Type',
            key: 'type',
            width: 160,
            render: (
                _: unknown,
                record: Inquiry
            ) =>
                getInquiryTypeLabel(
                    record
                )
        },
        {
            title: 'Priority',
            dataIndex: 'priority',
            key: 'priority',
            width: 100,
            render: (
                priority: InquiryPriority
            ) => (
                <Tag
                    color={getPriorityColor(
                        priority
                    )}
                >
                    {priority}
                </Tag>
            )
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            width: 130,
            render: (
                status: InquiryStatus,
                record: Inquiry
            ) => {
                const responses =
                    getExternalCommunications(
                        record
                    ).length

                return (
                    <Space
                        direction="vertical"
                        size={2}
                    >
                        <Tag
                            color={getStatusColor(status)}
                            style={compactTagStyle}
                        >
                            {status}
                        </Tag>

                        {responses >
                            0 && (
                                <Text
                                    type="secondary"
                                    style={{
                                        fontSize:
                                            11
                                    }}
                                >
                                    {
                                        responses
                                    }{' '}
                                    {responses ===
                                        1
                                        ? 'response'
                                        : 'responses'}
                                </Text>
                            )}
                    </Space>
                )
            }
        },
        {
            title: 'Branch',
            dataIndex: 'branchId',
            key: 'branch',
            width: 190,
            render: (
                branchId: string
            ) => (
                <Text
                    style={{
                        fontSize: 12
                    }}
                >
                    <BankOutlined />{' '}
                    {getBranchName(
                        branchId
                    )}
                </Text>
            )
        },
        {
            title: 'Submitted',
            dataIndex: 'submittedAt',
            key: 'submittedAt',
            width: 120,
            render: (date: Date) =>
                dayjs(date).format(
                    'D MMM YYYY'
                )
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 120,
            render: (
                _: unknown,
                record: Inquiry
            ) => (
                <Button
                    type="link"
                    icon={
                        <EyeOutlined />
                    }
                    onClick={() =>
                        showInquiryDetail(
                            record
                        )
                    }
                >
                    View
                </Button>
            )
        }
    ]

    const renderMobileInquiry = (
        inquiry: Inquiry
    ) => {
        const responses =
            getExternalCommunications(
                inquiry
            )

        return (
            <List.Item
                key={inquiry.id}
                style={{
                    padding: 0,
                    border: 0,
                    marginBottom: 12
                }}
            >
                <Card
                    variant="outlined"
                    style={{
                        width: '100%',
                        borderRadius: 14
                    }}
                    styles={{
                        body: {
                            padding: 14
                        }
                    }}
                >
                    <Space
                        direction="vertical"
                        size={10}
                        style={{
                            width: '100%'
                        }}
                    >
                        <div
                            style={{
                                display:
                                    'flex',
                                justifyContent:
                                    'space-between',
                                gap: 10
                            }}
                        >
                            <div>
                                <Text strong>
                                    {getInquiryTypeLabel(
                                        inquiry
                                    )}
                                </Text>

                                <div>
                                    <Text
                                        type="secondary"
                                        style={{
                                            fontSize:
                                                12
                                        }}
                                    >
                                        {dayjs(
                                            inquiry.submittedAt
                                        ).format(
                                            'D MMM YYYY'
                                        )}
                                    </Text>
                                </div>
                            </div>

                            <Tag
                                color={getStatusColor(inquiry.status)}
                                style={compactTagStyle}
                            >
                                {inquiry.status}
                            </Tag>
                        </div>

                        <Paragraph
                            type="secondary"
                            ellipsis={{
                                rows: 2
                            }}
                            style={{
                                margin: 0
                            }}
                        >
                            {
                                extractOtherInquiry(
                                    inquiry
                                ).description
                            }
                        </Paragraph>

                        <Space wrap>
                            <Tag
                                color={getPriorityColor(
                                    inquiry.priority
                                )}
                            >
                                {
                                    inquiry.priority
                                }
                            </Tag>

                            {responses.length >
                                0 && (
                                    <Tag>
                                        {
                                            responses.length
                                        }{' '}
                                        {responses.length ===
                                            1
                                            ? 'response'
                                            : 'responses'}
                                    </Tag>
                                )}
                        </Space>

                        <Button
                            block
                            shape="round"
                            type="primary"
                            ghost
                            icon={
                                <EyeOutlined />
                            }
                            onClick={() =>
                                showInquiryDetail(
                                    inquiry
                                )
                            }
                        >
                            View Inquiry
                        </Button>
                    </Space>
                </Card>
            </List.Item>
        )
    }

    const mobileFilterBar = (
        <Space
            data-guide="inquiries-filters"
            direction="vertical"
            size={8}
            style={{
                width: '100%'
            }}
        >
            <Input
                size="large"
                placeholder="Search inquiries..."
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={event =>
                    setSearchText(event.target.value)
                }
                allowClear
            />

            <Select
                size="large"
                value={inquiryTypeFilter}
                onChange={setInquiryTypeFilter}
                style={{
                    width: '100%'
                }}
                options={[
                    {
                        value: 'all',
                        label: 'All Inquiry Types'
                    },
                    ...inquiryTypes.map(type => ({
                        value: type,
                        label: type
                    }))
                ]}
            />

            <div
                style={{
                    display: 'flex',
                    gap: 8,
                    width: '100%'
                }}
            >
                <Button
                    block
                    shape="round"
                    icon={<FilterOutlined />}
                    onClick={clearFilters}
                >
                    Clear
                </Button>

                <Button
                    data-guide="new-inquiry-btn"
                    block
                    type="primary"
                    shape="round"
                    icon={<PlusOutlined />}
                    onClick={openSubmitInquiry}
                >
                    New Inquiry
                </Button>
            </div>
        </Space>
    )

    const desktopFilterBar = (
        <Row
            data-guide="inquiries-filters"
            gutter={[12, 12]}
            align="middle"
        >
            <Col lg={5}>
                <Input
                    placeholder="Search inquiries..."
                    prefix={
                        <SearchOutlined />
                    }
                    value={
                        searchText
                    }
                    onChange={event =>
                        setSearchText(
                            event.target
                                .value
                        )
                    }
                    allowClear
                />
            </Col>

            <Col lg={3}>
                <Select
                    value={
                        statusFilter
                    }
                    onChange={
                        setStatusFilter
                    }
                    style={{
                        width: '100%'
                    }}
                    options={[
                        {
                            value: 'all',
                            label:
                                'All Status'
                        },
                        {
                            value: 'New',
                            label: 'New'
                        },
                        {
                            value:
                                'In Progress',
                            label:
                                'In Progress'
                        },
                        {
                            value:
                                'Contacted',
                            label:
                                'Contacted'
                        },
                        {
                            value:
                                'Converted',
                            label:
                                'Converted'
                        },
                        {
                            value:
                                'Closed',
                            label:
                                'Closed'
                        },
                        {
                            value:
                                'Lost',
                            label:
                                'Lost'
                        }
                    ]}
                />
            </Col>

            <Col lg={3}>
                <Select
                    value={
                        priorityFilter
                    }
                    onChange={
                        setPriorityFilter
                    }
                    style={{
                        width: '100%'
                    }}
                    options={[
                        {
                            value: 'all',
                            label:
                                'All Priority'
                        },
                        ...priorities.map(
                            priority => ({
                                value:
                                    priority,
                                label:
                                    priority
                            })
                        )
                    ]}
                />
            </Col>

            <Col lg={6}>
                <RangePicker
                    value={dateRange}
                    onChange={dates =>
                        setDateRange(
                            dates as [
                                dayjs.Dayjs,
                                dayjs.Dayjs
                            ] | null
                        )
                    }
                    style={{
                        width: '100%'
                    }}
                />
            </Col>

            <Col lg={7}>
                <div
                    style={{
                        display: 'flex',
                        gap: 8
                    }}
                >
                    <Button
                        block
                        shape="round"
                        icon={
                            <FilterOutlined />
                        }
                        onClick={
                            clearFilters
                        }
                    >
                        Clear
                    </Button>

                    <Button
                        data-guide="new-inquiry-btn"
                        block
                        type="primary"
                        shape="round"
                        icon={
                            <PlusOutlined />
                        }
                        onClick={openSubmitInquiry}
                    >
                        Submit New Inquiry
                    </Button>
                </div>
            </Col>
        </Row>
    )

    const renderOverview = () => {
        if (!selectedInquiry) {
            return null
        }

        const parsed =
            extractOtherInquiry(
                selectedInquiry
            )

        return (
            <Space
                direction="vertical"
                size={10}
                style={{
                    width: '100%'
                }}
            >
                <Row
                    gutter={[10, 10]}
                >
                    <Col
                        xs={24}
                        md={12}
                    >
                        <Card
                            size="small"
                            variant="outlined"
                            styles={{
                                body: {
                                    padding: 12
                                }
                            }}
                        >
                            <Space
                                direction="vertical"
                                size={4}
                                style={{
                                    width:
                                        '100%'
                                }}
                            >
                                <Text
                                    type="secondary"
                                    style={{
                                        fontSize:
                                            12
                                    }}
                                >
                                    Inquiry
                                </Text>

                                <Text strong>
                                    {getInquiryTypeLabel(
                                        selectedInquiry
                                    )}
                                </Text>

                                <Space wrap>
                                    <Tag
                                        color={getStatusColor(selectedInquiry.status)}
                                        style={compactTagStyle}
                                    >
                                        {selectedInquiry.status}
                                    </Tag>

                                    <Tag
                                        color={getPriorityColor(
                                            selectedInquiry.priority
                                        )}
                                    >
                                        {
                                            selectedInquiry.priority
                                        }
                                    </Tag>
                                </Space>
                            </Space>
                        </Card>
                    </Col>

                    <Col
                        xs={24}
                        md={12}
                    >
                        <Card
                            size="small"
                            variant="outlined"
                            styles={{
                                body: {
                                    padding: 12
                                }
                            }}
                        >
                            <Space
                                direction="vertical"
                                size={3}
                            >
                                <Text
                                    type="secondary"
                                    style={{
                                        fontSize:
                                            12
                                    }}
                                >
                                    Contact
                                </Text>

                                <Text strong>
                                    {
                                        selectedInquiry
                                            .contactInfo
                                            .firstName
                                    }{' '}
                                    {
                                        selectedInquiry
                                            .contactInfo
                                            .lastName
                                    }
                                </Text>

                                <Text>
                                    <MailOutlined />{' '}
                                    {
                                        selectedInquiry
                                            .contactInfo
                                            .email
                                    }
                                </Text>

                                <Text>
                                    <PhoneOutlined />{' '}
                                    {
                                        selectedInquiry
                                            .contactInfo
                                            .phone
                                    }
                                </Text>
                            </Space>
                        </Card>
                    </Col>
                </Row>

                <Card
                    size="small"
                    variant="outlined"
                    styles={{
                        body: {
                            padding: 12
                        }
                    }}
                >
                    <Row
                        gutter={[12, 8]}
                    >
                        <Col
                            xs={24}
                            sm={12}
                        >
                            <Text
                                type="secondary"
                                style={{
                                    fontSize:
                                        12
                                }}
                            >
                                Centre
                            </Text>

                            <div>
                                <Text strong>
                                    {getBranchName(
                                        selectedInquiry.branchId
                                    )}
                                </Text>
                            </div>
                        </Col>

                        <Col
                            xs={24}
                            sm={12}
                        >
                            <Text
                                type="secondary"
                                style={{
                                    fontSize:
                                        12
                                }}
                            >
                                Submitted
                            </Text>

                            <div>
                                <Text strong>
                                    {dayjs(
                                        selectedInquiry.submittedAt
                                    ).format(
                                        'D MMM YYYY, HH:mm'
                                    )}
                                </Text>
                            </div>
                        </Col>

                        {(selectedInquiry
                            .contactInfo
                            .company ||
                            selectedInquiry
                                .contactInfo
                                .position) && (
                                <>
                                    <Col
                                        xs={12}
                                    >
                                        <Text
                                            type="secondary"
                                            style={{
                                                fontSize:
                                                    12
                                            }}
                                        >
                                            Company
                                        </Text>

                                        <div>
                                            <Text>
                                                {selectedInquiry
                                                    .contactInfo
                                                    .company ||
                                                    'Not specified'}
                                            </Text>
                                        </div>
                                    </Col>

                                    <Col
                                        xs={12}
                                    >
                                        <Text
                                            type="secondary"
                                            style={{
                                                fontSize:
                                                    12
                                            }}
                                        >
                                            Position
                                        </Text>

                                        <div>
                                            <Text>
                                                {selectedInquiry
                                                    .contactInfo
                                                    .position ||
                                                    'Not specified'}
                                            </Text>
                                        </div>
                                    </Col>
                                </>
                            )}
                    </Row>
                </Card>

                <Card
                    size="small"
                    variant="outlined"
                    styles={{
                        body: {
                            padding: 12
                        }
                    }}
                >
                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            fontSize: 12,
                            marginBottom: 4
                        }}
                    >
                        Description
                    </Text>

                    <Paragraph
                        ellipsis={{
                            rows: 3,
                            expandable: true,
                            symbol: 'More'
                        }}
                        style={{
                            marginBottom: 0
                        }}
                    >
                        {
                            parsed.description
                        }
                    </Paragraph>
                </Card>
            </Space>
        )
    }

    const renderResponses = () => {
        const responses =
            getExternalCommunications(
                selectedInquiry
            )

        if (!responses.length) {
            return (
                <Empty
                    image={
                        Empty.PRESENTED_IMAGE_SIMPLE
                    }
                    description="No responses yet"
                />
            )
        }

        return (
            <List
                size="small"
                dataSource={[
                    ...responses
                ].sort(
                    (a, b) =>
                        dayjs(
                            b.sentAt
                        ).valueOf() -
                        dayjs(
                            a.sentAt
                        ).valueOf()
                )}
                pagination={
                    responses.length >
                        3
                        ? {
                            pageSize: 3,
                            showSizeChanger:
                                false
                        }
                        : false
                }
                renderItem={
                    communication => (
                        <List.Item>
                            <div
                                style={{
                                    width:
                                        '100%'
                                }}
                            >
                                <div
                                    style={{
                                        display:
                                            'flex',
                                        justifyContent:
                                            'space-between',
                                        gap: 8
                                    }}
                                >
                                    <Text strong>
                                        {
                                            communication.sentByName
                                        }
                                    </Text>

                                    <Text
                                        type="secondary"
                                        style={{
                                            fontSize:
                                                11
                                        }}
                                    >
                                        {dayjs(
                                            communication.sentAt
                                        ).format(
                                            'D MMM, HH:mm'
                                        )}
                                    </Text>
                                </div>

                                <Paragraph
                                    style={{
                                        margin:
                                            '5px 0 0'
                                    }}
                                    ellipsis={{
                                        rows: 3,
                                        expandable:
                                            true,
                                        symbol:
                                            'More'
                                    }}
                                >
                                    {
                                        communication.message
                                    }
                                </Paragraph>
                            </div>
                        </List.Item>
                    )
                }
            />
        )
    }

    const renderHistory = () => {
        const history =
            selectedInquiry
                ?.statusHistory || []

        if (!history.length) {
            return (
                <Empty
                    image={
                        Empty.PRESENTED_IMAGE_SIMPLE
                    }
                    description="No status history yet"
                />
            )
        }

        return (
            <List
                size="small"
                dataSource={[
                    ...history
                ].reverse()}
                pagination={
                    history.length > 4
                        ? {
                            pageSize: 4,
                            showSizeChanger:
                                false
                        }
                        : false
                }
                renderItem={entry => (
                    <List.Item>
                        <div
                            style={{
                                width: '100%',
                                display:
                                    'flex',
                                alignItems:
                                    'flex-start',
                                justifyContent:
                                    'space-between',
                                gap: 10
                            }}
                        >
                            <div>
                                <Tag
                                    color={getStatusColor(
                                        entry.status
                                    )}
                                >
                                    {
                                        entry.status
                                    }
                                </Tag>

                                {entry.notes && (
                                    <Text
                                        type="secondary"
                                        style={{
                                            fontSize:
                                                12
                                        }}
                                    >
                                        {
                                            entry.notes
                                        }
                                    </Text>
                                )}
                            </div>

                            <Text
                                type="secondary"
                                style={{
                                    fontSize:
                                        11,
                                    whiteSpace:
                                        'nowrap'
                                }}
                            >
                                {dayjs(
                                    entry.changedAt
                                ).format(
                                    'D MMM YYYY'
                                )}
                            </Text>
                        </div>
                    </List.Item>
                )}
            />
        )
    }

    const editSectionOptions: {
        key: EditSection
        title: string
        description: string
        icon: React.ReactNode
    }[] = [
            {
                key: 'details',
                title:
                    'Inquiry Details',
                description:
                    'Type and description',
                icon:
                    <FileTextOutlined />
            },
            {
                key: 'routing',
                title:
                    'Routing',
                description:
                    'Priority and centre',
                icon:
                    <BankOutlined />
            },
            {
                key: 'contact',
                title:
                    'Contact',
                description:
                    'Name, email and phone',
                icon:
                    <ContactsOutlined />
            },
            {
                key: 'business',
                title:
                    'Business',
                description:
                    'Company and position',
                icon:
                    <UserOutlined />
            },
            {
                key: 'followup',
                title:
                    'Follow-up',
                description:
                    'Date and contact method',
                icon:
                    <CalendarOutlined />
            }
        ]

    const renderEditSelector = () => (
        <div>
            <div
                style={{
                    textAlign: 'center',
                    marginBottom: 16
                }}
            >
                <Text strong>
                    What would you like
                    to edit?
                </Text>

                <div>
                    <Text
                        type="secondary"
                        style={{
                            fontSize: 12
                        }}
                    >
                        Choose one section.
                    </Text>
                </div>
            </div>

            <Row gutter={[10, 10]}>
                {editSectionOptions.map(
                    section => (
                        <Col
                            key={
                                section.key
                            }
                            span={24}
                        >
                            <Card
                                hoverable
                                size="small"
                                onClick={() =>
                                    openEditSection(
                                        section.key
                                    )
                                }
                                style={{
                                    cursor:
                                        'pointer',
                                    height:
                                        '100%'
                                }}
                                styles={{
                                    body: {
                                        padding:
                                            12
                                    }
                                }}
                            >
                                <Space
                                    size={10}
                                >
                                    <MotionCard.IconChip
                                        size={
                                            34
                                        }
                                        radius={
                                            10
                                        }
                                        icon={
                                            section.icon
                                        }
                                    />

                                    <div>
                                        <Text
                                            strong
                                        >
                                            {
                                                section.title
                                            }
                                        </Text>

                                        <div>
                                            <Text
                                                type="secondary"
                                                style={{
                                                    fontSize:
                                                        11
                                                }}
                                            >
                                                {
                                                    section.description
                                                }
                                            </Text>
                                        </div>
                                    </div>
                                </Space>
                            </Card>
                        </Col>
                    )
                )}
            </Row>
        </div>
    )

    const renderEditFields = () => {
        if (!editSection) {
            return null
        }

        if (
            editSection ===
            'details'
        ) {
            return (
                <>
                    <Form.Item
                        name="inquiryType"
                        label="Inquiry Type"
                        rules={[
                            {
                                required:
                                    true
                            }
                        ]}
                    >
                        <Select
                            options={inquiryTypeOptions.map(
                                type => ({
                                    value:
                                        type,
                                    label:
                                        type
                                })
                            )}
                        />
                    </Form.Item>

                    {selectedEditInquiryType ===
                        'Other' && (
                            <Form.Item
                                name="otherInquiryType"
                                label="Other Inquiry Type"
                                rules={[
                                    {
                                        required:
                                            true
                                    }
                                ]}
                            >
                                <Input />
                            </Form.Item>
                        )}

                    <Form.Item
                        name="description"
                        label="Description"
                        rules={[
                            {
                                required:
                                    true
                            }
                        ]}
                    >
                        <TextArea
                            rows={3}
                            maxLength={
                                1500
                            }
                            showCount
                        />
                    </Form.Item>
                </>
            )
        }

        if (
            editSection ===
            'routing'
        ) {
            return (
                <Row gutter={10}>
                    <Col span={24}>
                        <Form.Item
                            name="priority"
                            hidden
                            rules={[
                                {
                                    required:
                                        true
                                }
                            ]}
                        >
                            <Input />
                        </Form.Item>

                        <Form.Item
                            label="Priority"
                        >
                            <Row gutter={[8, 8]}>
                                {priorities.map(priority => {
                                    const selected =
                                        selectedEditPriority === priority

                                    return (
                                        <Col
                                            key={priority}
                                            xs={12}
                                            sm={6}
                                        >
                                            <Card
                                                hoverable
                                                size="small"
                                                onClick={() =>
                                                    editForm.setFieldsValue({
                                                        priority
                                                    })
                                                }
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
                    </Col>

                    <Col span={24}>
                        <Form.Item
                            name="branchId"
                            label="Centre"
                            rules={[
                                {
                                    required:
                                        true
                                }
                            ]}
                        >
                            <Select
                                options={branches
                                    .filter(
                                        branch =>
                                            branch.status ===
                                            'active' &&
                                            branch.isActive !==
                                            false
                                    )
                                    .map(
                                        branch => ({
                                            value:
                                                branch.id,
                                            label: `${branch.name} - ${branch.location.city}`
                                        })
                                    )}
                            />
                        </Form.Item>
                    </Col>
                </Row>
            )
        }

        if (
            editSection ===
            'contact'
        ) {
            return (
                <Row gutter={10}>
                    <Col span={12}>
                        <Form.Item
                            name="firstName"
                            label="First Name"
                            rules={[
                                {
                                    required:
                                        true
                                }
                            ]}
                        >
                            <Input />
                        </Form.Item>
                    </Col>

                    <Col span={12}>
                        <Form.Item
                            name="lastName"
                            label="Last Name"
                            rules={[
                                {
                                    required:
                                        true
                                }
                            ]}
                        >
                            <Input />
                        </Form.Item>
                    </Col>

                    <Col span={12}>
                        <Form.Item
                            name="email"
                            label="Email"
                            rules={[
                                {
                                    required:
                                        true
                                },
                                {
                                    type:
                                        'email'
                                }
                            ]}
                        >
                            <Input />
                        </Form.Item>
                    </Col>

                    <Col span={12}>
                        <Form.Item
                            name="phone"
                            label="Phone"
                            rules={[
                                {
                                    required:
                                        true
                                }
                            ]}
                        >
                            <Input />
                        </Form.Item>
                    </Col>
                </Row>
            )
        }

        if (
            editSection ===
            'business'
        ) {
            return (
                <Row gutter={10}>
                    <Col span={12}>
                        <Form.Item
                            name="company"
                            label="Company"
                        >
                            <Input />
                        </Form.Item>
                    </Col>

                    <Col span={12}>
                        <Form.Item
                            name="position"
                            label="Position"
                        >
                            <Input />
                        </Form.Item>
                    </Col>
                </Row>
            )
        }

        return (
            <Row gutter={10}>
                <Col span={12}>
                    <Form.Item
                        name="nextFollowUpDate"
                        label="Follow-up Date"
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

                <Col span={12}>
                    <Form.Item
                        name="followUpMethod"
                        label="Contact Method"
                    >
                        <Select
                            allowClear
                            options={followUpMethods.map(
                                method => ({
                                    value:
                                        method,
                                    label:
                                        method
                                })
                            )}
                        />
                    </Form.Item>
                </Col>
            </Row>
        )
    }

    return (
        <div
            style={{
                padding: isMobile
                    ? '8px 12px'
                    : '5px 24px'
            }}
        >
            <Helmet>
                <title>
                    My Inquiries | Smart Incubation Platform
                </title>
            </Helmet>

            <Row
                gutter={[12, 12]}
                wrap={false}
                style={{
                    marginBottom: 16
                }}
            >
                {metricCards.map(
                    metric => (
                        <Col
                            key={
                                metric.key
                            }
                            flex="1 1 0"
                            style={{
                                minWidth: 0
                            }}
                        >
                            {loading ? (
                                <Skeleton
                                    active
                                    title={
                                        false
                                    }
                                    paragraph={{
                                        rows: 2
                                    }}
                                />
                            ) : (
                                <MotionCard.Metric
                                    title={
                                        metric.title
                                    }
                                    value={
                                        metric.value
                                    }
                                    icon={
                                        metric.icon
                                    }
                                    iconBg={
                                        metric.iconBg
                                    }
                                />
                            )}
                        </Col>
                    )
                )}
            </Row>

            {isMobile ? (
                <div
                    style={{
                        width: '100%'
                    }}
                >
                    <div
                        style={{
                            marginBottom: 14
                        }}
                    >
                        {mobileFilterBar}
                    </div>

                    {loading ? (
                        <Space
                            direction="vertical"
                            size={10}
                            style={{
                                width: '100%'
                            }}
                        >
                            {[1, 2, 3].map(item => (
                                <Card
                                    key={item}
                                    variant="outlined"
                                    style={{
                                        borderRadius: 14
                                    }}
                                    styles={{
                                        body: {
                                            padding: 14
                                        }
                                    }}
                                >
                                    <Skeleton
                                        active
                                        title
                                        paragraph={{
                                            rows: 2
                                        }}
                                    />
                                </Card>
                            ))}
                        </Space>
                    ) : filteredInquiries.length === 0 ? (
                        <div
                            style={{
                                padding: '30px 0'
                            }}
                        >
                            <Empty
                                image={
                                    Empty.PRESENTED_IMAGE_SIMPLE
                                }
                                description="No inquiries found"
                            >
                                <Button
                                    type="primary"
                                    shape="round"
                                    icon={<PlusOutlined />}
                                    onClick={openSubmitInquiry}
                                >
                                    Submit Inquiry
                                </Button>
                            </Empty>
                        </div>
                    ) : (
                        <>
                            <div data-guide="inquiries-results">
                                <List
                                    split={false}
                                    dataSource={mobileInquiries}
                                    renderItem={renderMobileInquiry}
                                    style={{
                                        width: '100%'
                                    }}
                                />
                            </div>

                            {filteredInquiries.length >
                                MOBILE_PAGE_SIZE && (
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            marginTop: 16
                                        }}
                                    >
                                        <Pagination
                                            current={mobilePage}
                                            pageSize={
                                                MOBILE_PAGE_SIZE
                                            }
                                            total={
                                                filteredInquiries.length
                                            }
                                            showSizeChanger={false}
                                            onChange={
                                                setMobilePage
                                            }
                                        />
                                    </div>
                                )}
                        </>
                    )}
                </div>
            ) : (
                <MotionCard
                    filterBar={desktopFilterBar}
                >
                    <div data-guide="inquiries-results">
                        <Table
                            columns={columns}
                            dataSource={filteredInquiries}
                            rowKey="id"
                            loading={loading}
                            pagination={{
                                pageSize: 5,
                                showSizeChanger: false,
                                position: [
                                    'bottomCenter'
                                ]
                            }}
                        />
                    </div>
                </MotionCard>
            )}

            <Modal
                title="Inquiry Details"
                open={
                    detailModalVisible
                }
                onCancel={() =>
                    setDetailModalVisible(
                        false
                    )
                }
                centered
                width={
                    isMobile
                        ? 'calc(100vw - 24px)'
                        : 720
                }
                styles={{
                    body: {
                        paddingTop: 8
                    }
                }}
                footer={
                    selectedInquiry ? (
                        <div
                            style={{
                                display:
                                    'flex',
                                gap: 8
                            }}
                        >
                            {canModifyInquiry(
                                selectedInquiry
                            ) && (
                                    <>
                                        <Button
                                            block
                                            danger
                                            shape="round"
                                            icon={
                                                <DeleteOutlined />
                                            }
                                            onClick={() =>
                                                deleteInquiry(
                                                    selectedInquiry
                                                )
                                            }
                                        >
                                            Delete
                                        </Button>

                                        <Button
                                            block
                                            shape="round"
                                            icon={
                                                <EditOutlined />
                                            }
                                            onClick={() =>
                                                openEdit(
                                                    selectedInquiry
                                                )
                                            }
                                        >
                                            Edit
                                        </Button>
                                    </>
                                )}

                            <Button
                                block
                                type="primary"
                                shape="round"
                                onClick={() =>
                                    setDetailModalVisible(
                                        false
                                    )
                                }
                            >
                                Close
                            </Button>
                        </div>
                    ) : null
                }
            >
                {selectedInquiry && (
                    <>
                        <Segmented
                            block
                            value={
                                detailSection
                            }
                            onChange={
                                value =>
                                    setDetailSection(
                                        value as DetailSection
                                    )
                            }
                            options={[
                                {
                                    value:
                                        'overview',
                                    label:
                                        'Overview'
                                },
                                {
                                    value:
                                        'responses',
                                    label: `Responses (${getExternalCommunications(
                                        selectedInquiry
                                    ).length})`
                                },
                                {
                                    value:
                                        'history',
                                    label:
                                        'History'
                                }
                            ]}
                            style={{
                                marginBottom:
                                    14
                            }}
                        />

                        {detailSection ===
                            'overview' &&
                            renderOverview()}

                        {detailSection ===
                            'responses' &&
                            renderResponses()}

                        {detailSection ===
                            'history' &&
                            renderHistory()}
                    </>
                )}
            </Modal>

            {isMobile ? (
                editOpen && (
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            // Above HelpAssistant's own FloatButton (also
                            // z-index 1000) — equal z-index falls back to DOM
                            // order, and that FAB is a later sibling, so it
                            // was winning and showing through.
                            zIndex: 1100,
                            background: token.colorBgContainer,
                            display: 'flex',
                            justifyContent: 'center'
                        }}
                    >
                        <div
                            style={{
                                width: '100%',
                                maxWidth: 720,
                                minHeight: 0,
                                display: 'flex',
                                flexDirection: 'column'
                            }}
                        >
                            <div
                                style={{
                                    flex: '0 0 auto',
                                    padding: '10px 16px 14px',
                                    borderBottom: `1px solid ${token.colorBorderSecondary}`
                                }}
                            >
                                <div
                                    style={{
                                        position: 'relative',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        minHeight: 32
                                    }}
                                >
                                    <Button
                                        type="default"
                                        shape="circle"
                                        icon={<ArrowLeftOutlined />}
                                        onClick={() => {
                                            if (editSection) {
                                                setEditSection(null)
                                                return
                                            }

                                            setEditOpen(false)
                                        }}
                                        aria-label={
                                            editSection
                                                ? 'Back to sections'
                                                : 'Close'
                                        }
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
                                        {editSection
                                            ? 'Edit Inquiry'
                                            : 'Choose What to Edit'}
                                    </Text>
                                </div>
                            </div>

                            <div
                                style={{
                                    flex: '1 1 auto',
                                    minHeight: 0,
                                    overflowY: 'auto',
                                    padding: 16,
                                    // Short sections otherwise sit pinned to
                                    // the top with a lot of empty space below
                                    // — centre the block instead; it still
                                    // scrolls normally once content is taller
                                    // than the screen.
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center'
                                }}
                            >
                                {!editSection ? (
                                    renderEditSelector()
                                ) : (
                                    <Form
                                        form={editForm}
                                        layout="vertical"
                                        requiredMark={false}
                                    >
                                        {renderEditFields()}
                                    </Form>
                                )}
                            </div>

                            {editSection && (
                                <div
                                    style={{
                                        flex: '0 0 auto',
                                        display: 'flex',
                                        gap: 8,
                                        padding: 16,
                                        paddingBottom:
                                            'calc(16px + env(safe-area-inset-bottom))',
                                        borderTop: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <Button
                                        shape="round"
                                        onClick={() =>
                                            setEditSection(null)
                                        }
                                        style={{ flex: 1 }}
                                    >
                                        Back
                                    </Button>

                                    <Button
                                        type="primary"
                                        shape="round"
                                        loading={editSaving}
                                        onClick={saveEditSection}
                                        style={{ flex: 1 }}
                                    >
                                        Save Changes
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                )
            ) : (
                <Modal
                    title={
                        editSection
                            ? 'Edit Inquiry'
                            : 'Choose What to Edit'
                    }
                    open={editOpen}
                    onCancel={() => {
                        setEditOpen(
                            false
                        )
                        setEditSection(
                            null
                        )
                    }}
                    centered
                    width={620}
                    destroyOnHidden
                    footer={
                        editSection ? (
                            <div
                                style={{
                                    display:
                                        'flex',
                                    gap: 8
                                }}
                            >
                                <Button
                                    block
                                    shape="round"
                                    onClick={() =>
                                        setEditSection(
                                            null
                                        )
                                    }
                                >
                                    Back
                                </Button>

                                <Button
                                    block
                                    type="primary"
                                    shape="round"
                                    loading={
                                        editSaving
                                    }
                                    onClick={
                                        saveEditSection
                                    }
                                >
                                    Save Changes
                                </Button>
                            </div>
                        ) : (
                            <Button
                                block
                                shape="round"
                                onClick={() =>
                                    setEditOpen(
                                        false
                                    )
                                }
                            >
                                Cancel
                            </Button>
                        )
                    }
                >
                    {!editSection ? (
                        renderEditSelector()
                    ) : (
                        <Form
                            form={
                                editForm
                            }
                            layout="vertical"
                            requiredMark={
                                false
                            }
                            style={{
                                marginTop: 4
                            }}
                        >
                            {renderEditFields()}
                        </Form>
                    )}
                </Modal>
            )}

            <Modal
                title="Submit a New Inquiry"
                open={
                    submitOpen
                }
                onCancel={() =>
                    setSubmitOpen(
                        false
                    )
                }
                footer={null}
                destroyOnHidden
                centered
                width={680}
                maskClosable={
                    false
                }
                styles={{
                    header: {
                        textAlign:
                            'center',
                        marginBottom:
                            20
                    },
                    body: {
                        padding:
                            '8px 12px 4px'
                    },
                    content: {
                        borderRadius:
                            18
                    }
                }}
            >
                <ApplicantInquirySubmission
                    embedded
                    onClose={() =>
                        setSubmitOpen(
                            false
                        )
                    }
                    onSubmitted={() => {
                        setSubmitOpen(
                            false
                        )
                        loadData(
                            false
                        )
                    }}
                />
            </Modal>
        </div>
    )
}

export default ApplicantInquiries
