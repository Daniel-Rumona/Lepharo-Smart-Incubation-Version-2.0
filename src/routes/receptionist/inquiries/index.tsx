import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Table,
    Space,
    Button,
    Tag,
    Input,
    Select,
    DatePicker,
    Row,
    Col,
    Typography,
    Badge,
    Tooltip,
    message,
    Statistic,
    Empty,
    Modal
} from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import {
    PlusOutlined,
    SearchOutlined,
    EyeOutlined,
    EditOutlined,
    UserOutlined,
    ReloadOutlined,
    MessageOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    BarChartOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { format } from 'date-fns'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import {
    Inquiry,
    InquiryFormFields,
    InquiryPriority,
    InquiryStatus,
    InquirySource
} from '@/types/inquiry'
import { inquiryService } from '@/services/inquiryService'
import { useAuth } from '@/hooks/useAuth'
import {
    MotionCard
} from '@/components/dashboards/metrics/Header'
import InquiryForm from '@/components/receptionist/InquiryForm'
import InquiryDetail from '@/components/receptionist/InquiryDetail'
import { useActiveProgramId } from '@/lib/useActiveProgramId'

const { Search } = Input
const { Option } = Select
const { RangePicker } = DatePicker
const { Title, Text } = Typography

type RangeValue = [Dayjs | null, Dayjs | null] | null

const statusOrder: InquiryStatus[] = [
    'New',
    'In Progress',
    'Follow-up Required',
    'Contacted',
    'Resolved',
    'Converted',
    'Closed'
]

const InquiriesList: React.FC = () => {
    const [inquiries, setInquiries] = useState<Inquiry[]>([])
    const [loading, setLoading] = useState(true)

    const [searchText, setSearchText] = useState('')
    const [statusFilter, setStatusFilter] = useState<InquiryStatus | 'all'>('all')
    const [priorityFilter, setPriorityFilter] = useState<InquiryPriority | 'all'>(
        'all'
    )
    const [sourceFilter, setSourceFilter] = useState<InquirySource | 'all'>('all')
    const [dateRange, setDateRange] = useState<RangeValue>(null)
    const [newInquiryOpen, setNewInquiryOpen] = useState(false)
    const [viewInquiryId, setViewInquiryId] = useState<string | null>(null)
    const [editInquiryId, setEditInquiryId] = useState<string | null>(null)
    const [editInitialData, setEditInitialData] = useState<
        (Partial<InquiryFormFields> & Record<string, any>) | null
    >(null)
    const [editLoading, setEditLoading] = useState(false)

    const { user, loading: userLoading } = useAuth()
    const { activeProgramId } = useActiveProgramId()

    const loadInquiries = useCallback(async () => {
        if (!user?.assignedBranch) {
            setLoading(false)
            return
        }

        try {
            setLoading(true)
            const data = await inquiryService.getInquiriesByBranch(user.assignedBranch)
            const rows = Array.isArray(data) ? data : []
            setInquiries(
                activeProgramId
                    ? rows.filter(
                        inquiry =>
                            !inquiry.programId || inquiry.programId === activeProgramId
                    )
                    : rows
            )
        } catch (error) {
            console.error('Error loading inquiries:', error)
            message.error('Failed to load inquiries')
        } finally {
            setLoading(false)
        }
    }, [user?.assignedBranch, activeProgramId])

    useEffect(() => {
        if (user && user.assignedBranch) {
            loadInquiries()
        } else if (user && !user.assignedBranch) {
            setLoading(false)
        } else if (!user && !userLoading) {
            setLoading(false)
        }
    }, [user, userLoading, loadInquiries])

    const getStatusColor = (status: InquiryStatus): string => {
        const colors: Record<string, string> = {
            New: 'blue',
            'In Progress': 'orange',
            'Follow-up Required': 'gold',
            Resolved: 'green',
            Closed: 'default',
            Contacted: 'purple',
            Converted: 'green'
        }
        return colors[status] || 'default'
    }

    const getPriorityColor = (priority: InquiryPriority): string => {
        const colors: Record<string, string> = {
            Low: 'default',
            Medium: 'blue',
            High: 'orange',
            Urgent: 'red'
        }
        return colors[priority] || 'default'
    }

    const openEditInquiry = async (inquiryId: string) => {
        try {
            setEditInquiryId(inquiryId)
            setEditInitialData(null)
            setEditLoading(true)
            const inquiry = await inquiryService.getInquiryById(inquiryId)
            if (!inquiry) {
                message.error('Inquiry not found')
                setEditInquiryId(null)
                return
            }

            setEditInitialData({
                firstName: inquiry.contactInfo.firstName,
                lastName: inquiry.contactInfo.lastName,
                email: inquiry.contactInfo.email,
                phone: inquiry.contactInfo.phone,
                company: inquiry.contactInfo.company,
                position: inquiry.contactInfo.position,
                inquiryType: inquiry.inquiryDetails.inquiryType,
                businessStage: inquiry.inquiryDetails.businessStage,
                industry: inquiry.inquiryDetails.industry,
                department:
                    inquiry.inquiryDetails.department ||
                    inquiry.inquiryDetails.servicesOfInterest?.[0],
                description: inquiry.inquiryDetails.description,
                budget: inquiry.inquiryDetails.budget,
                timeline: inquiry.inquiryDetails.timeline,
                priority: inquiry.priority,
                classification: inquiry.classification || 'General',
                sourceTypeInternal:
                    inquiry.sourceType ||
                    (inquiry.programId ? 'Incubatee' : 'Non-Incubatee'),
                sourceType:
                    inquiry.sourceType ||
                    (inquiry.programId ? 'Incubatee' : 'Non-Incubatee'),
                programId: inquiry.programId || undefined,
                tags: inquiry.tags,
                nextFollowUpDate: inquiry.followUp?.nextFollowUpDate
                    ? dayjs(inquiry.followUp.nextFollowUpDate)
                    : undefined,
                followUpMethod: inquiry.followUp?.followUpMethod,
                followUpNotes: inquiry.followUp?.notes
            })
        } catch (error) {
            console.error('Error loading inquiry for editing:', error)
            message.error('Failed to load inquiry for editing')
            setEditInquiryId(null)
        } finally {
            setEditLoading(false)
        }
    }

    const normalizeDate = (value: any): Date | null => {
        if (!value) return null

        if (value instanceof Date) return value

        if (typeof value?.toDate === 'function') {
            return value.toDate()
        }

        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }

    const filteredInquiries = useMemo(() => {
        return inquiries.filter(inquiry => {
            const firstName = inquiry.contactInfo?.firstName?.toLowerCase?.() || ''
            const lastName = inquiry.contactInfo?.lastName?.toLowerCase?.() || ''
            const email = inquiry.contactInfo?.email?.toLowerCase?.() || ''
            const phone = inquiry.contactInfo?.phone || ''
            const company = inquiry.contactInfo?.company?.toLowerCase?.() || ''
            const description =
                inquiry.inquiryDetails?.description?.toLowerCase?.() || ''
            const inquiryType =
                inquiry.inquiryDetails?.inquiryType?.toLowerCase?.() || ''

            const search = searchText.trim().toLowerCase()

            const matchesSearch =
                !search ||
                firstName.includes(search) ||
                lastName.includes(search) ||
                email.includes(search) ||
                phone.includes(searchText.trim()) ||
                company.includes(search) ||
                description.includes(search) ||
                inquiryType.includes(search)

            const matchesStatus =
                statusFilter === 'all' || inquiry.status === statusFilter

            const matchesPriority =
                priorityFilter === 'all' || inquiry.priority === priorityFilter

            const matchesSource =
                sourceFilter === 'all' || inquiry.source === sourceFilter

            const submittedDate = normalizeDate(inquiry.submittedAt)

            const matchesDateRange =
                !dateRange ||
                !dateRange[0] ||
                !dateRange[1] ||
                (!!submittedDate &&
                    submittedDate >= dateRange[0].startOf('day').toDate() &&
                    submittedDate <= dateRange[1].endOf('day').toDate())

            return (
                matchesSearch &&
                matchesStatus &&
                matchesPriority &&
                matchesSource &&
                matchesDateRange
            )
        })
    }, [inquiries, searchText, statusFilter, priorityFilter, sourceFilter, dateRange])

    const metrics = useMemo(() => {
        const total = filteredInquiries.length
        const newCount = filteredInquiries.filter(item => item.status === 'New').length
        const inProgressCount = filteredInquiries.filter(
            item => item.status === 'In Progress' || item.status === 'Follow-up Required'
        ).length
        const resolvedCount = filteredInquiries.filter(item =>
            ['Resolved', 'Converted', 'Closed'].includes(item.status)
        ).length
        const urgentCount = filteredInquiries.filter(
            item => item.priority === 'Urgent' || item.priority === 'High'
        ).length

        return {
            total,
            newCount,
            inProgressCount,
            resolvedCount,
            urgentCount
        }
    }, [filteredInquiries])

    const inquiryTypeFrequency = useMemo(() => {
        const map = new Map<string, number>()

        filteredInquiries.forEach(item => {
            const type = item.inquiryDetails?.inquiryType?.trim() || 'Unspecified'
            map.set(type, (map.get(type) || 0) + 1)
        })

        return Array.from(map.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
    }, [filteredInquiries])

    const inquiryTypeChartOptions: Highcharts.Options = useMemo(() => {
        return {
            chart: {
                type: 'bar',
                height: Math.max(360, inquiryTypeFrequency.length * 48)
            },
            title: {
                text: undefined
            },
            credits: {
                enabled: false
            },
            legend: {
                enabled: false
            },
            xAxis: {
                categories: inquiryTypeFrequency.map(([type]) => type),
                title: {
                    text: undefined
                }
            },
            yAxis: {
                min: 0,
                allowDecimals: false,
                title: {
                    text: 'Frequency'
                }
            },
            tooltip: {
                pointFormat: '<b>{point.y}</b> inquiries'
            },
            plotOptions: {
                series: {
                    borderRadius: 6,
                    dataLabels: {
                        enabled: true
                    }
                }
            },
            series: [
                {
                    type: 'bar',
                    name: 'Inquiries',
                    data: inquiryTypeFrequency.map(([, count]) => count)
                }
            ]
        }
    }, [inquiryTypeFrequency])

    const columns: ColumnsType<Inquiry> = [
        {
            title: 'Contact',
            key: 'contact',
            width: 240,
            render: (_, record) => (
                <div>
                    <Space size={6} wrap>
                        <Text strong>
                            {record.contactInfo?.firstName} {record.contactInfo?.lastName}
                        </Text>
                        {record.source === 'SME' ? (
                            <Badge
                                count={<UserOutlined style={{ color: '#1677ff' }} />}
                                size="small"
                            />
                        ) : null}
                    </Space>

                    <div style={{ color: 'rgba(0,0,0,.45)', fontSize: 12, marginTop: 4 }}>
                        {record.contactInfo?.email || record.contactInfo?.phone || '—'}
                    </div>

                    {record.contactInfo?.company ? (
                        <div style={{ color: 'rgba(0,0,0,.45)', fontSize: 12 }}>
                            {record.contactInfo.company}
                        </div>
                    ) : null}
                </div>
            )
        },
        {
            title: 'Inquiry Type',
            key: 'inquiryType',
            width: 220,
            render: (_, record) => (
                <div>
                    <Text strong>{record.inquiryDetails?.inquiryType || '—'}</Text>
                    <div style={{ marginTop: 6 }}>
                        <Tag color={record.classification === 'Potential' ? 'gold' : 'blue'}>
                            {record.classification || 'General'}
                        </Tag>
                        <Tag>{record.source || '—'}</Tag>
                    </div>
                    {record.inquiryDetails?.department ? (
                        <div style={{ color: 'rgba(0,0,0,.45)', fontSize: 12, marginTop: 4 }}>
                            {record.inquiryDetails.department}
                        </div>
                    ) : null}
                </div>
            )
        },
        {
            title: 'Description',
            key: 'description',
            ellipsis: true,
            width: 320,
            render: (_, record) => {
                const description = record.inquiryDetails?.description || '—'
                const short =
                    description.length > 90 ? `${description.slice(0, 90)}...` : description

                return (
                    <Tooltip title={description}>
                        <span>{short}</span>
                    </Tooltip>
                )
            }
        },
        {
            title: 'Priority',
            dataIndex: 'priority',
            key: 'priority',
            width: 120,
            render: (priority: InquiryPriority) => (
                <Tag color={getPriorityColor(priority)}>{priority}</Tag>
            )
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            width: 160,
            render: (status: InquiryStatus) => (
                <Tag color={getStatusColor(status)}>{status}</Tag>
            ),
            filters: statusOrder.map(status => ({ text: status, value: status })),
            onFilter: (value, record) => record.status === value
        },
        {
            title: 'Submitted',
            dataIndex: 'submittedAt',
            key: 'submittedAt',
            width: 140,
            render: (value: any) => {
                const date = normalizeDate(value)
                return date ? format(date, 'MMM dd, yyyy') : '—'
            },
            sorter: (a, b) => {
                const left = normalizeDate(a.submittedAt)?.getTime() || 0
                const right = normalizeDate(b.submittedAt)?.getTime() || 0
                return left - right
            },
            defaultSortOrder: 'descend'
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 120,
            fixed: 'right',
            render: (_, record) => (
                <Space size="small">
                    <Tooltip title="View Details">
                        <Button
                            type="default"
                            shape="round"
                            icon={<EyeOutlined />}
                            onClick={() => setViewInquiryId(record.id)}
                        />
                    </Tooltip>

                    <Tooltip title="Edit">
                        <Button
                            type="default"
                            shape="round"
                            icon={<EditOutlined />}
                            onClick={() => openEditInquiry(record.id)}
                        />
                    </Tooltip>
                </Space>
            )
        }
    ]

    const filterBar = (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                overflowX: 'auto',
                paddingBottom: 2
            }}
        >
            <Search
                allowClear
                placeholder="Search name, email, phone, company, type..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                prefix={<SearchOutlined />}
                style={{ minWidth: 260, flex: '1 1 320px' }}
            />
            <Select
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ minWidth: 155 }}
                options={[
                    { value: 'all', label: 'All statuses' },
                    { value: 'New', label: 'New' },
                    { value: 'In Progress', label: 'In Progress' },
                    { value: 'Follow-up Required', label: 'Follow-up Required' },
                    { value: 'Contacted', label: 'Contacted' },
                    { value: 'Resolved', label: 'Resolved' },
                    { value: 'Converted', label: 'Converted' },
                    { value: 'Closed', label: 'Closed' }
                ]}
            />
            <Select
                value={priorityFilter}
                onChange={setPriorityFilter}
                style={{ minWidth: 140 }}
                options={[
                    { value: 'all', label: 'All priorities' },
                    { value: 'Low', label: 'Low' },
                    { value: 'Medium', label: 'Medium' },
                    { value: 'High', label: 'High' },
                    { value: 'Urgent', label: 'Urgent' }
                ]}
            />
            <Select
                value={sourceFilter}
                onChange={setSourceFilter}
                style={{ minWidth: 145 }}
                options={[
                    { value: 'all', label: 'All sources' },
                    { value: 'Walk-in', label: 'Walk-in' },
                    { value: 'Phone', label: 'Phone' },
                    { value: 'Email', label: 'Email' },
                    { value: 'Website', label: 'Website' },
                    { value: 'Referral', label: 'Referral' },
                    { value: 'Social Media', label: 'Social Media' },
                    { value: 'Event', label: 'Event' },
                    { value: 'SME', label: 'SME' },
                    { value: 'Incubatee', label: 'Incubatee' },
                    { value: 'Non-Incubatee', label: 'Non-Incubatee' },
                    { value: 'Other', label: 'Other' }
                ]}
            />
            <RangePicker
                value={dateRange}
                onChange={value => setDateRange(value as RangeValue)}
                style={{ minWidth: 250 }}
            />
            <Button
                shape="round"
                icon={<ReloadOutlined />}
                onClick={loadInquiries}
            >
                Refresh
            </Button>
            <Button
                type="primary"
                shape="round"
                icon={<PlusOutlined />}
                onClick={() => {
                    if (!activeProgramId) {
                        message.warning('Select a program before creating an inquiry.')
                        return
                    }
                    setNewInquiryOpen(true)
                }}
            >
                New Inquiry
            </Button>
        </div>
    )

    if (userLoading) {
        return (
            <div style={{ padding: 24, minHeight: '100vh' }}>
                <MotionCard>
                    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                        <Title level={4} style={{ marginBottom: 0 }}>
                            Loading user data...
                        </Title>
                    </div>
                </MotionCard>
            </div>
        )
    }

    if (user && !user.assignedBranch) {
        return (
            <div style={{ padding: 24, minHeight: '100vh' }}>
                <MotionCard style={{ maxWidth: 640, margin: '0 auto' }}>
                    <div style={{ padding: '28px 16px', textAlign: 'center' }}>
                        <Title level={3}>Branch Assignment Required</Title>
                        <Text type="secondary">
                            You need to be assigned to a branch to access the inquiries system.
                        </Text>
                    </div>
                </MotionCard>
            </div>
        )
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<MessageOutlined style={{ color: '#1677ff' }} />}
                            iconBg="rgba(22,119,255,0.12)"
                            title="Total Inquiries"
                            value={metrics.total}
                            subtitle="All inquiries in current view"
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} xl={6}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<ExclamationCircleOutlined style={{ color: '#faad14' }} />}
                            iconBg="rgba(250,173,20,0.14)"
                            title="New"
                            value={metrics.newCount}
                            subtitle="Awaiting first action"
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} xl={6}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<ClockCircleOutlined style={{ color: '#722ed1' }} />}
                            iconBg="rgba(114,46,209,0.12)"
                            title="In Progress"
                            value={metrics.inProgressCount}
                            subtitle="Being handled or followed up"
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} xl={6}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                            iconBg="rgba(82,196,26,0.12)"
                            title="Resolved / Closed"
                            value={metrics.resolvedCount}
                            subtitle="Completed outcomes"
                        />
                    </MotionCard>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24}>
                    <MotionCard
                        filterBar={filterBar}
                        filterBarProps={{
                            background: '#f8fbff',
                            borderColor: '#d9e8ff',
                            borderRadius: 14,
                            padding: 16,
                            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)'
                        }}
                    >
                        <Table
                            rowKey="id"
                            columns={columns}
                            dataSource={filteredInquiries}
                            loading={loading}
                            scroll={{ x: 1300 }}
                            locale={{
                                emptyText: <Empty description="No inquiries found" />
                            }}
                            pagination={{
                                total: filteredInquiries.length,
                                pageSize: 10,
                                showSizeChanger: false,
                                showQuickJumper: false,
                                showTotal: (total, range) =>
                                    `${range[0]}-${range[1]} of ${total} inquiries`
                            }}
                        />
                    </MotionCard>
                </Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24}>
                    <MotionCard
                        title="Inquiry Type Frequency"
                        extra={
                            <Tag icon={<BarChartOutlined />}>
                                {inquiryTypeFrequency.length} types
                            </Tag>
                        }
                    >
                        {inquiryTypeFrequency.length ? (
                            <HighchartsReact highcharts={Highcharts} options={inquiryTypeChartOptions} />
                        ) : (
                            <Empty description="No inquiry type data available" />
                        )}
                    </MotionCard>
                </Col>
            </Row>

            <Modal
                title="New Inquiry"
                open={newInquiryOpen}
                onCancel={() => setNewInquiryOpen(false)}
                footer={null}
                width={920}
                centered
                destroyOnClose
                styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
            >
                {activeProgramId && (
                    <InquiryForm
                        embedded
                        stepped
                        forcedProgramId={activeProgramId}
                        onSuccess={() => {
                            setNewInquiryOpen(false)
                            loadInquiries()
                        }}
                    />
                )}
            </Modal>

            <Modal
                open={Boolean(viewInquiryId)}
                onCancel={() => setViewInquiryId(null)}
                footer={null}
                width={1240}
                style={{ maxWidth: 'calc(100vw - 24px)' }}
                centered
                destroyOnClose
                styles={{
                    body: {
                        maxHeight: '78vh',
                        overflowY: 'auto',
                        overflowX: 'hidden'
                    }
                }}
            >
                {viewInquiryId && (
                    <InquiryDetail
                        inquiryId={viewInquiryId}
                        embedded
                        onEdit={() => {
                            const inquiryId = viewInquiryId
                            setViewInquiryId(null)
                            openEditInquiry(inquiryId)
                        }}
                    />
                )}
            </Modal>

            <Modal
                title="Edit Inquiry"
                open={Boolean(editInquiryId)}
                onCancel={() => {
                    setEditInquiryId(null)
                    setEditInitialData(null)
                }}
                footer={null}
                width={920}
                centered
                destroyOnClose
                confirmLoading={editLoading}
                styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
            >
                {editLoading && (
                    <div style={{ padding: 32, textAlign: 'center' }}>Loading inquiry...</div>
                )}
                {!editLoading && editInquiryId && editInitialData && (
                    <InquiryForm
                        embedded
                        stepped
                        inquiryId={editInquiryId}
                        initialData={editInitialData as any}
                        forcedProgramId={editInitialData.programId || undefined}
                        onSuccess={() => {
                            setEditInquiryId(null)
                            setEditInitialData(null)
                            loadInquiries()
                        }}
                    />
                )}
            </Modal>
        </div>
    )
}

export default InquiriesList
