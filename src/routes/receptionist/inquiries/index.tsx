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
    Modal,
    Progress
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
    BarChartOutlined,
    FilterOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { format } from 'date-fns'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import {
    Inquiry,
    InquiryPriority,
    InquiryStatus,
} from '@/types/inquiry'
import { inquiryService } from '@/services/inquiryService'
import {
    ALL_CHANNELS,
    AUDIENCE_LABEL,
    channelLabel,
    resolveInquiryAudience,
    resolveInquiryChannel,
    type InquiryAudience,
    type InquiryChannel
} from '@/utils/inquirySource'
import { useAuth } from '@/hooks/useAuth'
import {
    MotionCard
} from '@/components/dashboards/metrics/Header'
import InquiryForm from '@/components/receptionist/InquiryForm'
import InquiryEditModal from '@/components/receptionist/InquiryEditModal'
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

type StatusFilter = InquiryStatus | 'all' | 'group:progress' | 'group:resolved'

// The metric cards count these groups, so clicking a card filters to the same set.
const STATUS_GROUPS: Record<'group:progress' | 'group:resolved', string[]> = {
    'group:progress': ['In Progress', 'Follow-up Required'],
    'group:resolved': ['Resolved', 'Converted', 'Closed']
}

const matchesStatusFilter = (status: string, filter: StatusFilter) =>
    filter === 'all' ||
    (filter in STATUS_GROUPS ? STATUS_GROUPS[filter as keyof typeof STATUS_GROUPS].includes(status) : status === filter)

const InquiriesList: React.FC = () => {
    const [inquiries, setInquiries] = useState<Inquiry[]>([])
    const [loading, setLoading] = useState(true)

    const [searchText, setSearchText] = useState('')
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [page, setPage] = useState(1)
    const [priorityFilter, setPriorityFilter] = useState<InquiryPriority | 'all'>(
        'all'
    )
    const [sourceFilter, setSourceFilter] = useState<InquiryChannel | 'all'>('all')
    const [audienceFilter, setAudienceFilter] = useState<InquiryAudience | 'all'>('all')
    const [dateRange, setDateRange] = useState<RangeValue>(null)
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [analyticsOpen, setAnalyticsOpen] = useState(false)
    const [draftStatus, setDraftStatus] = useState<StatusFilter>('all')
    const [draftAudience, setDraftAudience] = useState<InquiryAudience | 'all'>('all')
    const [draftRange, setDraftRange] = useState<RangeValue>(null)
    const [newInquiryOpen, setNewInquiryOpen] = useState(false)
    const [viewInquiryId, setViewInquiryId] = useState<string | null>(null)
    const [editInquiryId, setEditInquiryId] = useState<string | null>(null)

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

    const openEditInquiry = (inquiryId: string) => setEditInquiryId(inquiryId)

    const normalizeDate = (value: any): Date | null => {
        if (!value) return null

        if (value instanceof Date) return value

        if (typeof value?.toDate === 'function') {
            return value.toDate()
        }

        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }

    const baseFilteredInquiries = useMemo(() => {
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

            const matchesPriority =
                priorityFilter === 'all' || inquiry.priority === priorityFilter

            const matchesSource =
                (sourceFilter === 'all' || resolveInquiryChannel(inquiry.source) === sourceFilter) &&
                (audienceFilter === 'all' || resolveInquiryAudience(inquiry) === audienceFilter)

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
                matchesPriority &&
                matchesSource &&
                matchesDateRange
            )
        })
    }, [inquiries, searchText, priorityFilter, sourceFilter, audienceFilter, dateRange])

    const filteredInquiries = useMemo(
        () => baseFilteredInquiries.filter(inquiry => matchesStatusFilter(inquiry.status, statusFilter)),
        [baseFilteredInquiries, statusFilter]
    )

    // Back to the first page whenever the visible set changes.
    useEffect(() => {
        setPage(1)
    }, [statusFilter, searchText, priorityFilter, sourceFilter, audienceFilter, dateRange])

    const metrics = useMemo(() => {
        const total = baseFilteredInquiries.length
        const newCount = baseFilteredInquiries.filter(item => item.status === 'New').length
        const inProgressCount = baseFilteredInquiries.filter(item =>
            matchesStatusFilter(item.status, 'group:progress')
        ).length
        const resolvedCount = baseFilteredInquiries.filter(item =>
            matchesStatusFilter(item.status, 'group:resolved')
        ).length

        return { total, newCount, inProgressCount, resolvedCount }
    }, [baseFilteredInquiries])

    const metricProps = (filter: StatusFilter) => {
        const active = statusFilter === filter
        return {
            clickable: true,
            onClick: () => setStatusFilter(active ? 'all' : filter),
            wrapperStyle: active
                ? { border: '1px solid #1677ff', boxShadow: '0 0 0 2px rgba(22,119,255,0.18)' }
                : undefined
        }
    }

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
                        {record.isRepresentative ? <Tag color="purple">Representative</Tag> : null}
                        {resolveInquiryAudience(record) === 'Incubatee' ? (
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
                        <Tag>{channelLabel(resolveInquiryChannel(record.source))}</Tag>
                        <Tag color={resolveInquiryAudience(record) === 'Incubatee' ? 'green' : 'default'}>
                            {AUDIENCE_LABEL[resolveInquiryAudience(record)]}
                        </Tag>
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

    const activeFilterCount =
        (statusFilter !== 'all' ? 1 : 0) +
        (audienceFilter !== 'all' ? 1 : 0) +
        (dateRange?.[0] && dateRange?.[1] ? 1 : 0)

    const openFilters = () => {
        setDraftStatus(statusFilter)
        setDraftAudience(audienceFilter)
        setDraftRange(dateRange)
        setFiltersOpen(true)
    }

    const applyFilters = () => {
        setStatusFilter(draftStatus)
        setAudienceFilter(draftAudience)
        setDateRange(draftRange)
        setFiltersOpen(false)
    }

    const resetFilters = () => {
        setDraftStatus('all')
        setDraftAudience('all')
        setDraftRange(null)
    }

    const sourceBreakdown = useMemo(() => {
        const counts = new Map<InquiryChannel, number>()
        filteredInquiries.forEach(item => {
            const channel = resolveInquiryChannel(item.source)
            counts.set(channel, (counts.get(channel) || 0) + 1)
        })
        const total = filteredInquiries.length

        return ALL_CHANNELS
            .map(option => {
                const count = counts.get(option.value) || 0
                return {
                    channel: option.value,
                    count,
                    percent: total ? Math.round((count / total) * 100) : 0
                }
            })
            .filter(row => row.count > 0)
            .sort((a, b) => b.count - a.count)
    }, [filteredInquiries])

    const audienceBreakdown = useMemo(() => {
        const total = filteredInquiries.length
        const counts: Record<InquiryAudience, number> = { Incubatee: 0, 'Non-Incubatee': 0 }
        filteredInquiries.forEach(item => {
            counts[resolveInquiryAudience(item)] += 1
        })

        return (Object.keys(counts) as InquiryAudience[])
            .map(audience => ({
                audience,
                count: counts[audience],
                percent: total ? Math.round((counts[audience] / total) * 100) : 0
            }))
            .sort((a, b) => b.count - a.count)
    }, [filteredInquiries])

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
                    ...ALL_CHANNELS.map(option => ({
                        value: option.value,
                        label: channelLabel(option.value)
                    }))
                ]}
            />
            <Badge count={activeFilterCount} size="small" offset={[-6, 4]}>
                <Button shape="round" icon={<FilterOutlined />} onClick={openFilters}>
                    Filters
                </Button>
            </Badge>
            <Button
                shape="round"
                icon={<BarChartOutlined />}
                onClick={() => setAnalyticsOpen(true)}
            >
                Analytics
            </Button>
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
                    <MotionCard.Metric
                        {...metricProps('all')}
                        icon={<MessageOutlined style={{ color: '#1677ff' }} />}
                        iconBg="rgba(22,119,255,0.12)"
                        title="Total Inquiries"
                        value={metrics.total}
                        subtitle="Click to show all"
                    />
                </Col>

                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        {...metricProps('New')}
                        icon={<ExclamationCircleOutlined style={{ color: '#faad14' }} />}
                        iconBg="rgba(250,173,20,0.14)"
                        title="New"
                        value={metrics.newCount}
                        subtitle="Awaiting first action"
                    />
                </Col>

                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        {...metricProps('group:progress')}
                        icon={<ClockCircleOutlined style={{ color: '#722ed1' }} />}
                        iconBg="rgba(114,46,209,0.12)"
                        title="In Progress"
                        value={metrics.inProgressCount}
                        subtitle="Being handled or followed up"
                    />
                </Col>

                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        {...metricProps('group:resolved')}
                        icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                        iconBg="rgba(82,196,26,0.12)"
                        title="Resolved / Closed"
                        value={metrics.resolvedCount}
                        subtitle="Completed outcomes"
                    />
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
                                current: page,
                                onChange: setPage,
                                total: filteredInquiries.length,
                                pageSize: 10,
                                position: ['bottomCenter'],
                                showSizeChanger: false,
                                showQuickJumper: false
                            }}
                        />
                    </MotionCard>
                </Col>
            </Row>

            <Modal
                title="Filters"
                open={filtersOpen}
                onCancel={() => setFiltersOpen(false)}
                width={440}
                centered
                destroyOnClose
                styles={{ body: { padding: '20px 24px 4px' } }}
                footer={
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Button block size="large" onClick={resetFilters}>
                            Reset
                        </Button>
                        <Button block size="large" type="primary" onClick={applyFilters}>
                            Apply filters
                        </Button>
                    </div>
                }
            >
                <Space direction="vertical" size={18} style={{ width: '100%' }}>
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 8 }}>Status</Text>
                        <Select
                            size="large"
                            value={draftStatus}
                            onChange={setDraftStatus}
                            style={{ width: '100%' }}
                            options={[
                                { value: 'all', label: 'All statuses' },
                                { value: 'New', label: 'New' },
                                { value: 'group:progress', label: 'In progress (incl. follow-up required)' },
                                { value: 'In Progress', label: 'In Progress only' },
                                { value: 'Follow-up Required', label: 'Follow-up Required' },
                                { value: 'Contacted', label: 'Contacted' },
                                { value: 'group:resolved', label: 'Resolved / closed (incl. converted)' },
                                { value: 'Resolved', label: 'Resolved' },
                                { value: 'Converted', label: 'Converted' },
                                { value: 'Closed', label: 'Closed' }
                            ]}
                        />
                    </div>

                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 8 }}>Contact type</Text>
                        <Select
                            size="large"
                            value={draftAudience}
                            onChange={setDraftAudience}
                            style={{ width: '100%' }}
                            options={[
                                { value: 'all', label: 'All contacts' },
                                { value: 'Incubatee', label: AUDIENCE_LABEL.Incubatee },
                                { value: 'Non-Incubatee', label: AUDIENCE_LABEL['Non-Incubatee'] }
                            ]}
                        />
                    </div>

                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 8 }}>Date received</Text>
                        <RangePicker
                            size="large"
                            value={draftRange}
                            onChange={value => setDraftRange(value as RangeValue)}
                            style={{ width: '100%' }}
                            presets={[
                                { label: 'This week', value: [dayjs().startOf('week'), dayjs().endOf('week')] },
                                { label: 'This month', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
                                { label: 'Last 30 days', value: [dayjs().subtract(29, 'day'), dayjs()] }
                            ]}
                        />
                    </div>
                </Space>
            </Modal>

            <Modal
                title="Inquiry analytics"
                open={analyticsOpen}
                onCancel={() => setAnalyticsOpen(false)}
                footer={null}
                width={1040}
                style={{ maxWidth: 'calc(100vw - 24px)' }}
                centered
                destroyOnClose
                styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '20px 24px' } }}
            >
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                    Based on the {filteredInquiries.length} inquiries matching your current filters.
                </Text>
                <Row gutter={[16, 16]}>
                    <Col xs={24} lg={14}>
                        <MotionCard
                            style={{ height: '100%' }}
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

                    <Col xs={24} lg={10}>
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <MotionCard
                            title="Sources"
                            extra={<Tag>{sourceBreakdown.length} channels</Tag>}
                        >
                            {sourceBreakdown.length ? (
                                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                    {sourceBreakdown.map(row => (
                                        <div key={row.channel}>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'baseline',
                                                    gap: 8,
                                                    marginBottom: 4
                                                }}
                                            >
                                                <Text strong>{channelLabel(row.channel)}</Text>
                                                <Text type="secondary">
                                                    {row.count} · {row.percent}%
                                                </Text>
                                            </div>
                                            <Progress
                                                percent={row.percent}
                                                showInfo={false}
                                                size={{ height: 10 }}
                                                strokeLinecap="round"
                                            />
                                        </div>
                                    ))}
                                </Space>
                            ) : (
                                <Empty description="No source data available" />
                            )}
                        </MotionCard>
                        <MotionCard title="Contact type">
                            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                {audienceBreakdown.map(row => (
                                    <div key={row.audience}>
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'baseline',
                                                gap: 8,
                                                marginBottom: 4
                                            }}
                                        >
                                            <Text strong>{AUDIENCE_LABEL[row.audience]}</Text>
                                            <Text type="secondary">
                                                {row.count} · {row.percent}%
                                            </Text>
                                        </div>
                                        <Progress
                                            percent={row.percent}
                                            showInfo={false}
                                            size={{ height: 10 }}
                                            strokeLinecap="round"
                                            strokeColor={row.audience === 'Incubatee' ? '#52c41a' : undefined}
                                        />
                                    </div>
                                ))}
                            </Space>
                        </MotionCard>
                        </Space>
                    </Col>
                </Row>
            </Modal>

            <Modal
                title="New inquiry"
                open={newInquiryOpen}
                onCancel={() => setNewInquiryOpen(false)}
                footer={null}
                width={860}
                centered
                destroyOnClose
                styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '24px 36px 0' } }}
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

            <InquiryEditModal
                inquiryId={editInquiryId}
                onClose={() => setEditInquiryId(null)}
                onSaved={() => {
                    setEditInquiryId(null)
                    loadInquiries()
                }}
            />
        </div>
    )
}

export default InquiriesList
