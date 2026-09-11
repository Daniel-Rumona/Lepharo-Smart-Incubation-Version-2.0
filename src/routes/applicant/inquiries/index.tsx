import React, { useEffect, useState } from 'react'
import {
    Card,
    Table,
    Tag,
    Button,
    Row,
    Col,
    Typography,
    Statistic,
    Select,
    Input,
    DatePicker,
    Space,
    Modal,
    Descriptions,
    Timeline,
    Empty,
    Spin,
    message
} from 'antd'
import {
    FileTextOutlined,
    EyeOutlined,
    PlusOutlined,
    SearchOutlined,
    CalendarOutlined,
    BankOutlined,
    PhoneOutlined,
    MailOutlined,
    FilterOutlined,
    MessageOutlined,
    NotificationOutlined,
    SlackOutlined,
    ClockCircleOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { inquiryService } from '@/services/inquiryService'
import { branchService } from '@/services/branchService'
import { Inquiry, InquiryStatus, InquiryPriority } from '@/types/inquiry'
import { Branch } from '@/types/types'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'
import ApplicantInquirySubmission from '../submit-inquiry'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Title, Text } = Typography
const { Option } = Select
const { RangePicker } = DatePicker

// Metric chips read as a light wash of the accent with the glyph carrying the
// colour, rather than a solid fill. Translucent so it holds up in dark mode.
const metricIconBg = (hex: string) => `${hex}1F` // ~12% alpha

const METRIC_ICON_STYLE: Record<string, React.CSSProperties> = {
    '#1677ff': { color: '#1677ff', fontSize: 17 },
    '#1890ff': { color: '#1890ff', fontSize: 17 },
    '#faad14': { color: '#faad14', fontSize: 17 },
    '#52c41a': { color: '#52c41a', fontSize: 17 }
}

const ApplicantInquiries: React.FC = () => {
    const [inquiries, setInquiries] = useState<Inquiry[]>([])
    const [filteredInquiries, setFilteredInquiries] = useState<Inquiry[]>([])
    const [branches, setBranches] = useState<Branch[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null)
    const [detailModalVisible, setDetailModalVisible] = useState(false)
    const [submitOpen, setSubmitOpen] = useState(false)

    // Filter states
    const [statusFilter, setStatusFilter] = useState<InquiryStatus | 'all'>('all')
    const [priorityFilter, setPriorityFilter] = useState<InquiryPriority | 'all'>(
        'all'
    )
    const [searchText, setSearchText] = useState('')
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(
        null
    )

    const navigate = useNavigate()
    // 1) read loading from the identity hook
    const { user, loading: identityLoading } = useFullIdentity()

    // 2) make loadData defensive
    const loadData = async () => {
        if (!user?.uid) return // <- guard
        setLoading(true)
        try {
            const userInquiries = await inquiryService.getInquiries({
                submittedBy: user.uid,
                limit: 100
            })
            setInquiries(userInquiries)

            const allBranches = await branchService.getAllBranches()
            setBranches(allBranches)
        } catch (error) {
            console.error('Error loading data:', error)
            message.error('Failed to load inquiries')
        } finally {
            setLoading(false)
        }
    }

    // 3) only call loadData once we KNOW we have a uid
    useEffect(() => {
        if (!identityLoading && user?.uid) {
            loadData()
        }
    }, [identityLoading, user?.uid])

    useEffect(() => {
        loadData()
    }, [user?.uid])

    // Apply filters
    useEffect(() => {
        let filtered = [...inquiries]

        // Status filter
        if (statusFilter !== 'all') {
            filtered = filtered.filter(inquiry => inquiry.status === statusFilter)
        }

        // Priority filter
        if (priorityFilter !== 'all') {
            filtered = filtered.filter(inquiry => inquiry.priority === priorityFilter)
        }

        // Search filter
        if (searchText) {
            filtered = filtered.filter(
                inquiry =>
                    inquiry.contactInfo.firstName
                        .toLowerCase()
                        .includes(searchText.toLowerCase()) ||
                    inquiry.contactInfo.lastName
                        .toLowerCase()
                        .includes(searchText.toLowerCase()) ||
                    inquiry.contactInfo.email
                        ?.toLowerCase()
                        .includes(searchText.toLowerCase()) ||
                    inquiry.contactInfo.company
                        ?.toLowerCase()
                        .includes(searchText.toLowerCase()) ||
                    inquiry.inquiryDetails.description
                        .toLowerCase()
                        .includes(searchText.toLowerCase())
            )
        }

        // Date range filter
        if (dateRange) {
            filtered = filtered.filter(inquiry => {
                const inquiryDate = dayjs(inquiry.submittedAt)
                return (
                    inquiryDate.isAfter(dateRange[0].startOf('day')) &&
                    inquiryDate.isBefore(dateRange[1].endOf('day'))
                )
            })
        }

        setFilteredInquiries(filtered)
    }, [inquiries, statusFilter, priorityFilter, searchText, dateRange])

    const getBranchName = (branchId: string) => {
        const branch = branches.find(b => b.id === branchId)
        return branch ? `${branch.name} - ${branch.location.city}` : branchId
    }

    const getStatusColor = (status: InquiryStatus) => {
        const colors: Record<string, string> = {
            New: 'blue',
            'In Progress': 'orange',
            Contacted: 'cyan',
            Converted: 'green',
            Closed: 'gray',
            Lost: 'red'
        }
        return colors[status] || 'default'
    }

    const getPriorityColor = (priority: InquiryPriority) => {
        const colors = {
            Low: 'green',
            Medium: 'blue',
            High: 'orange',
            Urgent: 'red'
        }
        return colors[priority] || 'default'
    }

    const showInquiryDetail = (inquiry: Inquiry) => {
        setSelectedInquiry(inquiry)
        setDetailModalVisible(true)
    }

    const clearFilters = () => {
        setStatusFilter('all')
        setPriorityFilter('all')
        setSearchText('')
        setDateRange(null)
    }

    // Statistics
    const stats = {
        total: inquiries.length,
        new: inquiries.filter(i => i.status === 'New').length,
        inProgress: inquiries.filter(i => i.status === 'In Progress').length,
        converted: inquiries.filter(i => i.status === 'Converted').length,
        thisMonth: inquiries.filter(i =>
            dayjs(i.submittedAt).isAfter(dayjs().startOf('month'))
        ).length
    }

    const columns = [
        {
            title: 'Contact',
            key: 'contact',
            render: (_: any, record: Inquiry) => {
                const hasRecentResponse = record.communications?.some(
                    comm =>
                        comm.sentByRole === 'Receptionist' &&
                        !comm.isInternal &&
                        dayjs(comm.sentAt).isAfter(dayjs().subtract(3, 'days'))
                )

                return (
                    <div>
                        <div
                            style={{
                                fontWeight: 'bold',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                        >
                            {record.contactInfo.firstName} {record.contactInfo.lastName}
                            {hasRecentResponse && (
                                <NotificationOutlined
                                    style={{
                                        color: '#52c41a',
                                        marginLeft: 8,
                                        fontSize: 12,
                                        animation: 'pulse 2s infinite'
                                    }}
                                    title='Recent response from receptionist'
                                />
                            )}
                        </div>
                        <div style={{ fontSize: 12, color: '#666' }}>
                            {record.contactInfo.company || 'No company'}
                        </div>
                    </div>
                )
            }
        },
        {
            title: 'Type',
            dataIndex: ['inquiryDetails', 'inquiryType'],
            key: 'type',
            width: 150
        },
        {
            title: 'Priority',
            dataIndex: 'priority',
            key: 'priority',
            width: 100,
            render: (priority: InquiryPriority) => (
                <Tag color={getPriorityColor(priority)}>{priority}</Tag>
            )
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            width: 120,
            render: (status: InquiryStatus, record: Inquiry) => (
                <div>
                    <Tag color={getStatusColor(status)}>{status}</Tag>
                    {record.communications &&
                        record.communications.filter(c => !c.isInternal).length > 0 && (
                            <div style={{ fontSize: 11, color: '#1890ff', marginTop: 2 }}>
                                {record.communications.filter(c => !c.isInternal).length}
                                response
                                {record.communications.filter(c => !c.isInternal).length > 1
                                    ? 's'
                                    : ''}
                            </div>
                        )}
                </div>
            )
        },
        {
            title: 'Branch',
            dataIndex: 'branchId',
            key: 'branch',
            width: 200,
            render: (branchId: string) => (
                <div style={{ fontSize: 12 }}>
                    <BankOutlined /> {getBranchName(branchId)}
                </div>
            )
        },
        {
            title: 'Submitted',
            dataIndex: 'submittedAt',
            key: 'submittedAt',
            width: 120,
            render: (date: Date) => dayjs(date).format('MMM DD, YYYY')
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 100,
            render: (_: any, record: Inquiry) => {
                const externalComms =
                    record.communications?.filter(c => !c.isInternal) || []
                return (
                    <Button
                        type='link'
                        icon={
                            externalComms.length > 0 ? <MessageOutlined /> : <EyeOutlined />
                        }
                        onClick={() => showInquiryDetail(record)}
                    >
                        {externalComms.length > 0 ? 'View & Responses' : 'View'}
                    </Button>
                )
            }
        }
    ]

    return (
        <div style={{ padding: '5px 24px' }}>
            <Helmet>
                <title>My Inquiries | Smart Incubation Platform</title>
            </Helmet>

            <style>
                {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}
            </style>

            {/* Statistics Cards */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={12} lg={6}>
                    <MotionCard.Metric
                        title='Total Inquiries'
                        value={stats.total}
                        icon={<FileTextOutlined style={METRIC_ICON_STYLE['#1677ff']} />}
                        iconBg={metricIconBg('#1677ff')}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <MotionCard.Metric
                        title='New'
                        value={stats.new}
                        icon={<SlackOutlined style={METRIC_ICON_STYLE['#1890ff']} />}
                        iconBg={metricIconBg('#1890ff')}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <MotionCard.Metric
                        title='In Progress'
                        value={stats.inProgress}
                        icon={<ClockCircleOutlined style={METRIC_ICON_STYLE['#faad14']} />}
                        iconBg={metricIconBg('#faad14')}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <MotionCard.Metric
                        title='This Month'
                        value={stats.thisMonth}
                        icon={<CalendarOutlined style={METRIC_ICON_STYLE['#52c41a']} />}
                        iconBg={metricIconBg('#52c41a')}
                    />
                </Col>
            </Row>

            {/* Inquiries Table */}
            <MotionCard
                filterBar={<Row gutter={[12, 12]} align='middle' wrap>
                    <Col xs={24} sm={12} lg={5}>
                        <Input
                            placeholder='Search inquiries...'
                            prefix={<SearchOutlined />}
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                            allowClear
                        />
                    </Col>
                    <Col xs={12} sm={6} lg={3}>
                        <Select
                            placeholder='Status'
                            value={statusFilter}
                            onChange={setStatusFilter}
                            style={{ width: '100%' }}
                        >
                            <Option value='all'>All Status</Option>
                            <Option value='New'>New</Option>
                            <Option value='In Progress'>In Progress</Option>
                            <Option value='Contacted'>Contacted</Option>
                            <Option value='Converted'>Converted</Option>
                            <Option value='Closed'>Closed</Option>
                            <Option value='Lost'>Lost</Option>
                        </Select>
                    </Col>
                    <Col xs={12} sm={6} lg={3}>
                        <Select
                            placeholder='Priority'
                            value={priorityFilter}
                            onChange={setPriorityFilter}
                            style={{ width: '100%' }}
                        >
                            <Option value='all'>All Priority</Option>
                            <Option value='Low'>Low</Option>
                            <Option value='Medium'>Medium</Option>
                            <Option value='High'>High</Option>
                            <Option value='Urgent'>Urgent</Option>
                        </Select>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <RangePicker
                            value={dateRange}
                            onChange={dates =>
                                setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)
                            }
                            placeholder={['Start Date', 'End Date']}
                            style={{ width: '100%' }}
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={7}>
                        <div
                            style={{
                                display: 'flex',
                                gap: 8,
                                width: '100%',
                                justifyContent: 'flex-end'
                            }}
                        >
                            <Button
                                icon={<FilterOutlined />}
                                onClick={clearFilters}
                                style={{ flex: '0 0 auto' }}
                            >
                                Clear
                            </Button>
                            <Button
                                type='primary'
                                icon={<PlusOutlined />}
                                onClick={() => setSubmitOpen(true)}
                                style={{ flex: '0 1 auto', minWidth: 0 }}
                            >
                                Submit New Inquiry
                            </Button>
                        </div>
                    </Col>
                </Row>}
            >
                <Table
                    columns={columns}
                    dataSource={filteredInquiries}
                    rowKey='id'
                    pagination={{
                        pageSize: 5,
                        showSizeChanger: false,
                        showQuickJumper: false,
                        position: ['bottomCenter']
                    }}
                    locale={{
                        emptyText: loading ? (
                            <Spin />
                        ) : (
                            <Empty
                                description='No inquiries found'
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                            >
                                <Button
                                    type='primary'
                                    onClick={() => navigate('/applicant/submit-inquiry')}
                                >
                                    Submit Your First Inquiry
                                </Button>
                            </Empty>
                        )
                    }}
                />
            </MotionCard>

            {/* Detail Modal */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span>{`Inquiry Details - ${selectedInquiry?.contactInfo.firstName} ${selectedInquiry?.contactInfo.lastName}`}</span>
                        {selectedInquiry?.communications &&
                            selectedInquiry.communications.filter(c => !c.isInternal).length >
                            0 && (
                                <Tag color='blue' style={{ marginLeft: 8 }}>
                                    {
                                        selectedInquiry.communications.filter(c => !c.isInternal)
                                            .length
                                    }
                                    Response
                                    {selectedInquiry.communications.filter(c => !c.isInternal)
                                        .length > 1
                                        ? 's'
                                        : ''}
                                </Tag>
                            )}
                    </div>
                }
                open={detailModalVisible}
                onCancel={() => setDetailModalVisible(false)}
                footer={[
                    <Button key='close' onClick={() => setDetailModalVisible(false)}>
                        Close
                    </Button>
                ]}
                width={800}
            >
                {selectedInquiry && (
                    <div>
                        <Descriptions bordered column={2} style={{ marginBottom: 16 }}>
                            <Descriptions.Item label='Contact Name' span={1}>
                                {selectedInquiry.contactInfo.firstName}
                                {selectedInquiry.contactInfo.lastName}
                            </Descriptions.Item>
                            <Descriptions.Item label='Company' span={1}>
                                {selectedInquiry.contactInfo.company || 'Not specified'}
                            </Descriptions.Item>
                            <Descriptions.Item label='Email' span={1}>
                                <MailOutlined /> {selectedInquiry.contactInfo.email}
                            </Descriptions.Item>
                            <Descriptions.Item label='Phone' span={1}>
                                <PhoneOutlined /> {selectedInquiry.contactInfo.phone}
                            </Descriptions.Item>
                            <Descriptions.Item label='Inquiry Type' span={1}>
                                {selectedInquiry.inquiryDetails.inquiryType}
                            </Descriptions.Item>
                            <Descriptions.Item label='Priority' span={1}>
                                <Tag color={getPriorityColor(selectedInquiry.priority)}>
                                    {selectedInquiry.priority}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label='Status' span={1}>
                                <Tag color={getStatusColor(selectedInquiry.status)}>
                                    {selectedInquiry.status}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label='Branch' span={1}>
                                <BankOutlined /> {getBranchName(selectedInquiry.branchId)}
                            </Descriptions.Item>
                            <Descriptions.Item label='Business Stage' span={1}>
                                {selectedInquiry.inquiryDetails.businessStage ||
                                    'Not specified'}
                            </Descriptions.Item>
                            <Descriptions.Item label='Industry' span={1}>
                                {selectedInquiry.inquiryDetails.industry || 'Not specified'}
                            </Descriptions.Item>
                            <Descriptions.Item label='Budget Range' span={1}>
                                {selectedInquiry.inquiryDetails.budget || 'Not specified'}
                            </Descriptions.Item>
                            <Descriptions.Item label='Timeline' span={1}>
                                {selectedInquiry.inquiryDetails.timeline || 'Not specified'}
                            </Descriptions.Item>
                            <Descriptions.Item label='Submitted' span={2}>
                                <CalendarOutlined />
                                {dayjs(selectedInquiry.submittedAt).format(
                                    'MMMM DD, YYYY [at] HH:mm'
                                )}
                            </Descriptions.Item>
                        </Descriptions>

                        <Card
                            title='Services of Interest'
                            size='small'
                            style={{ marginBottom: 16 }}
                        >
                            {selectedInquiry.inquiryDetails.servicesOfInterest?.length ? (
                                <Space wrap>
                                    {selectedInquiry.inquiryDetails.servicesOfInterest.map(
                                        service => (
                                            <Tag key={service} color='blue'>
                                                {service}
                                            </Tag>
                                        )
                                    )}
                                </Space>
                            ) : (
                                <Text type='secondary'>No services specified</Text>
                            )}
                        </Card>

                        <Card title='Description' size='small' style={{ marginBottom: 16 }}>
                            <Text>{selectedInquiry.inquiryDetails.description}</Text>
                        </Card>

                        {/* Communication History */}
                        {selectedInquiry.communications &&
                            selectedInquiry.communications.filter(c => !c.isInternal).length >
                            0 && (
                                <Card
                                    title={`Communication History (${selectedInquiry.communications.filter(c => !c.isInternal)
                                        .length
                                        })`}
                                    size='small'
                                    style={{ marginBottom: 16 }}
                                >
                                    <Timeline>
                                        {selectedInquiry.communications
                                            .filter(comm => !comm.isInternal) // Only show external communications to SMEs
                                            .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
                                            .map((comm, index) => (
                                                <Timeline.Item
                                                    key={index}
                                                    color={
                                                        comm.sentByRole === 'Receptionist'
                                                            ? 'blue'
                                                            : 'green'
                                                    }
                                                >
                                                    <div>
                                                        <div style={{ marginBottom: 8 }}>
                                                            <strong>{comm.sentByName}</strong>
                                                            <Tag
                                                                color={
                                                                    comm.sentByRole === 'Receptionist'
                                                                        ? 'blue'
                                                                        : 'green'
                                                                }
                                                                style={{ marginLeft: 8 }}
                                                            >
                                                                {comm.sentByRole}
                                                            </Tag>
                                                            <Tag style={{ marginLeft: 4 }}>{comm.type}</Tag>
                                                            {comm.isInternal && (
                                                                <Tag color='orange' style={{ marginLeft: 4 }}>
                                                                    Internal
                                                                </Tag>
                                                            )}
                                                        </div>
                                                        <div
                                                            style={{
                                                                fontSize: 12,
                                                                color: '#666',
                                                                marginBottom: 8
                                                            }}
                                                        >
                                                            {dayjs(comm.sentAt).format(
                                                                'MMM DD, YYYY [at] HH:mm'
                                                            )}
                                                        </div>
                                                        <div
                                                            style={{
                                                                whiteSpace: 'pre-wrap',
                                                                padding: '8px 12px',
                                                                background: '#f5f5f5',
                                                                borderRadius: 4,
                                                                marginBottom: 8
                                                            }}
                                                        >
                                                            {comm.message}
                                                        </div>
                                                    </div>
                                                </Timeline.Item>
                                            ))}
                                    </Timeline>
                                </Card>
                            )}

                        {selectedInquiry.statusHistory &&
                            selectedInquiry.statusHistory.length > 0 && (
                                <Card title='Status History' size='small'>
                                    <Timeline>
                                        {selectedInquiry.statusHistory.map((entry, index) => (
                                            <Timeline.Item
                                                key={index}
                                                color={getStatusColor(entry.status)}
                                            >
                                                <div>
                                                    <strong>{entry.status}</strong>
                                                    <div style={{ fontSize: 12, color: '#666' }}>
                                                        {dayjs(entry.changedAt).format(
                                                            'MMM DD, YYYY [at] HH:mm'
                                                        )}
                                                    </div>
                                                    {entry.notes && (
                                                        <div style={{ fontSize: 12, fontStyle: 'italic' }}>
                                                            {entry.notes}
                                                        </div>
                                                    )}
                                                </div>
                                            </Timeline.Item>
                                        ))}
                                    </Timeline>
                                </Card>
                            )}
                    </div>
                )}
            </Modal>

            {/* Submission Modal */}
            <Modal
                title='Submit a New Inquiry'
                open={submitOpen}
                onCancel={() => setSubmitOpen(false)}
                footer={null}
                destroyOnClose
                width={1200}
                // bodyStyle={{ padding: 0, maxHeight: '60vh', overflow: 'auto' }}
                maskClosable={false}
            >
                <div style={{ padding: 16 }}>
                    <ApplicantInquirySubmission
                        embedded
                        onClose={() => setSubmitOpen(false)}
                        onSubmitted={() => {
                            // refresh grid after successful submit
                            loadData()
                        }}
                    />
                </div>
            </Modal>
        </div>
    )
}

export default ApplicantInquiries
