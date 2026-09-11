import React, { useState, useEffect } from 'react'
import {
    Card,
    Table,
    Button,
    Space,
    Tag,
    message,
    Breadcrumb,
    Row,
    Col,
    Statistic,
    DatePicker,
    Select,
    Modal,
    Input,
    Form,
    Alert
} from 'antd'
import {
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    CheckCircleOutlined,
    PhoneOutlined,
    MailOutlined,
    HomeOutlined,
    EditOutlined
} from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { followUpService, FollowUp } from '@/services/followUpService'
import { format, isAfter, isBefore, addDays } from 'date-fns'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { db } from '@/firebase'
import { getDocs, query, collection, where } from 'firebase/firestore'
import {
    DashboardHeaderCard,
    MotionCard
} from '@/components/dashboards/metrics/Header'

const { RangePicker } = DatePicker
const { Option } = Select
const { TextArea } = Input

const FollowUpsList: React.FC = () => {
    const [followUps, setFollowUps] = useState<FollowUp[]>([])
    const [filteredFollowUps, setFilteredFollowUps] = useState<FollowUp[]>([])
    const [loading, setLoading] = useState(true)
    const [stats, setStats] = useState({
        total: 0,
        pending: 0,
        overdue: 0,
        completed: 0,
        cancelled: 0
    })
    const [branchMap, setBranchMap] = useState<Record<string, string>>({})

    // Filters
    const [statusFilter, setStatusFilter] = useState<
        'all' | 'Pending' | 'Completed' | 'Overdue' | 'Cancelled'
    >('all')
    const [priorityFilter, setPriorityFilter] = useState<
        'all' | 'Low' | 'Medium' | 'High' | 'Urgent'
    >('all')
    const [dateRange, setDateRange] = useState<any>([])

    // Modal states
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | null>(null)
    const [form] = Form.useForm()

    const navigate = useNavigate()
    const { user, loading: userLoading } = useAuth()

    const loadFollowUps = React.useCallback(async () => {
        if (!user?.assignedBranch) {
            console.error('FollowUpsList: No branch assigned to user')
            setLoading(false)
            return
        }

        try {
            setLoading(true)
            console.log(
                'FollowUpsList: Fetching follow-ups for branch:',
                user.assignedBranch
            )

            // Get follow-ups assigned to this receptionist
            const data = await followUpService.getReceptionistFollowUps(
                user.assignedBranch,
                user.uid
            )
            console.log('FollowUpsList: Retrieved', data.length, 'follow-ups')
            setFollowUps(data)
            setFilteredFollowUps(data)

            // Get statistics for this receptionist
            const receptionistStats = await followUpService.getFollowUpStats(
                user.assignedBranch,
                user.uid
            )
            setStats(receptionistStats)
        } catch (error) {
            console.error('Error loading follow-ups:', error)
            message.error('Failed to load follow-ups')
        } finally {
            setLoading(false)
        }
    }, [user?.assignedBranch, user?.uid])

    useEffect(() => {
        if (user && user.assignedBranch) {
            loadFollowUps()
        }
    }, [user?.assignedBranch, loadFollowUps])

    useEffect(() => {
        const run = async () => {
            const snap = await getDocs(
                query(
                    collection(db, 'branches')
                )
            )
            const m: Record<string, string> = {}
            snap.docs.forEach(d => {
                const b = d.data() as any
                m[d.id] = b.name || b.branchName || '—'
            })
            setBranchMap(m)
        }

        run()
    }, [])

    // Apply filters
    useEffect(() => {
        let filtered = [...followUps]

        // Status filter
        if (statusFilter !== 'all') {
            filtered = filtered.filter(followUp => followUp.status === statusFilter)
        }

        // Priority filter
        if (priorityFilter !== 'all') {
            filtered = filtered.filter(
                followUp => followUp.priority === priorityFilter
            )
        }

        // Date range filter
        if (dateRange && dateRange[0] && dateRange[1]) {
            const startDate = dateRange[0].toDate()
            const endDate = dateRange[1].toDate()
            filtered = filtered.filter(
                followUp =>
                    isAfter(followUp.scheduledDate, startDate) &&
                    isBefore(followUp.scheduledDate, endDate)
            )
        }

        setFilteredFollowUps(filtered)
    }, [followUps, statusFilter, priorityFilter, dateRange])

    const handleCompleteFollowUp = async (followUpId: string) => {
        try {
            console.log('Completing follow-up:', followUpId)

            await followUpService.updateFollowUpStatus(
                followUpId,
                'Completed',
                'Completed by receptionist'
            )

            // Refresh data
            await loadFollowUps()
            message.success('Follow-up completed successfully')
        } catch (error) {
            console.error('Error completing follow-up:', error)
            message.error(
                `Failed to complete follow-up: ${error instanceof Error ? error.message : 'Unknown error'
                }`
            )
        }
    }

    const handleEditFollowUp = (followUp: FollowUp) => {
        setEditingFollowUp(followUp)
        form.setFieldsValue({
            notes: followUp.notes,
            priority: followUp.priority,
            scheduledDate: followUp.scheduledDate,
            followUpType: followUp.followUpType
        })
        setIsModalVisible(true)
    }

    const handleUpdateFollowUp = async (values: any) => {
        if (!editingFollowUp) return

        try {
            console.log(
                'Updating follow-up:',
                editingFollowUp.id,
                'with values:',
                values
            )

            await followUpService.updateFollowUp(editingFollowUp.id, {
                scheduledDate: new Date(values.scheduledDate),
                followUpType: values.followUpType,
                priority: values.priority,
                notes: values.notes,
                assignedTo: user?.uid || '',
                assignedToName: user?.name || user?.email || ''
            })

            // Refresh data
            await loadFollowUps()
            setIsModalVisible(false)
            setEditingFollowUp(null)
            form.resetFields()
            message.success('Follow-up updated successfully')
        } catch (error) {
            console.error('Error updating follow-up:', error)
            message.error(
                `Failed to update follow-up: ${error instanceof Error ? error.message : 'Unknown error'
                }`
            )
        }
    }

    const handleViewInquiry = (inquiryId: string) => {
        navigate(`/receptionist/inquiries/${inquiryId}`)
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Completed':
                return 'green'
            case 'Overdue':
                return 'red'
            case 'Pending':
                return 'orange'
            case 'Cancelled':
                return 'default'
            default:
                return 'default'
        }
    }

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'Urgent':
                return 'red'
            case 'High':
                return 'orange'
            case 'Medium':
                return 'blue'
            case 'Low':
                return 'default'
            default:
                return 'default'
        }
    }

    const columns: ColumnsType<FollowUp> = [
        {
            title: 'Customer',
            key: 'customer',
            render: (_, record) => (
                <div>
                    <div style={{ fontWeight: 500, fontSize: '14px' }}>
                        {record.customerName}
                    </div>
                    <div style={{ color: '#666', fontSize: '12px' }}>
                        {record.customerEmail}
                    </div>
                </div>
            ),
            width: 200
        },
        {
            title: 'Inquiry',
            dataIndex: 'inquirySubject',
            key: 'inquirySubject',
            render: (subject: string, record) => (
                <Button
                    type='link'
                    onClick={() => handleViewInquiry(record.inquiryId)}
                    style={{ padding: 0, textAlign: 'left' }}
                >
                    {subject}
                </Button>
            ),
            width: 250
        },
        {
            title: 'Type',
            dataIndex: 'followUpType',
            key: 'followUpType',
            render: (type: string) => {
                const icon =
                    type === 'Phone' ? (
                        <PhoneOutlined />
                    ) : type === 'Email' ? (
                        <MailOutlined />
                    ) : (
                        <ClockCircleOutlined />
                    )
                return (
                    <Space>
                        {icon}
                        {type}
                    </Space>
                )
            },
            width: 120
        },
        {
            title: 'Scheduled',
            dataIndex: 'scheduledDate',
            key: 'scheduledDate',
            render: (date: Date) => format(date, 'MMM dd, yyyy'),
            sorter: (a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime(),
            width: 120
        },
        {
            title: 'Priority',
            dataIndex: 'priority',
            key: 'priority',
            render: (priority: string) => (
                <Tag color={getPriorityColor(priority)}>{priority}</Tag>
            ),
            filters: [
                { text: 'Urgent', value: 'Urgent' },
                { text: 'High', value: 'High' },
                { text: 'Medium', value: 'Medium' },
                { text: 'Low', value: 'Low' }
            ],
            width: 100
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (status: string) => (
                <Tag color={getStatusColor(status)}>
                    {status === 'Overdue' && (
                        <ExclamationCircleOutlined style={{ marginRight: 4 }} />
                    )}
                    {status}
                </Tag>
            ),
            filters: [
                { text: 'Pending', value: 'Pending' },
                { text: 'Overdue', value: 'Overdue' },
                { text: 'Completed', value: 'Completed' },
                { text: 'Cancelled', value: 'Cancelled' }
            ],
            width: 100
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_, record) => (
                <Space>
                    <Button
                        type='text'
                        icon={<EditOutlined />}
                        onClick={() => handleEditFollowUp(record)}
                        size='small'
                    >
                        Edit
                    </Button>
                    {record.status === 'Pending' && (
                        <Button
                            type='text'
                            icon={<CheckCircleOutlined />}
                            onClick={() => handleCompleteFollowUp(record.id)}
                            size='small'
                            style={{ color: '#52c41a' }}
                        >
                            Complete
                        </Button>
                    )}
                </Space>
            ),
            width: 150
        }
    ]

    if (userLoading) {
        return (
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minHeight: '400px'
                }}
            >
                <div>Loading...</div>
            </div>
        )
    }

    if (!user?.assignedBranch) {
        return (
            <div style={{ margin: '20px' }}>
                <Alert
                    message='Branch Assignment Required'
                    description='You need to be assigned to a branch to access follow-up management.'
                    type='warning'
                    showIcon
                />
            </div>
        )
    }

    const headerBranchName = user?.assignedBranch
        ? branchMap[user?.assignedBranch] || 'Unknown Branch'
        : 'Not Assigned'

    return (
        <div style={{ padding: '24px', minHeight: '100vh' }}>
            <DashboardHeaderCard
                title='Inquiries Followup'
                subtitle={`Manage your assigned follow-ups for branch: ${headerBranchName}`}
            />

            {/* Statistics Cards */}
            <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
                <Col xs={12} sm={6}>
                    <MotionCard>
                        <Statistic
                            title='Total Follow-ups'
                            value={stats.total}
                            prefix={<ClockCircleOutlined />}
                        />
                    </MotionCard>
                </Col>
                <Col xs={12} sm={6}>
                    <MotionCard>
                        <Statistic
                            title='Pending'
                            value={stats.pending}
                            valueStyle={{ color: '#fa8c16' }}
                            prefix={<ClockCircleOutlined />}
                        />
                    </MotionCard>
                </Col>
                <Col xs={12} sm={6}>
                    <MotionCard>
                        <Statistic
                            title='Overdue'
                            value={stats.overdue}
                            valueStyle={{ color: '#ff4d4f' }}
                            prefix={<ExclamationCircleOutlined />}
                        />
                    </MotionCard>
                </Col>
                <Col xs={12} sm={6}>
                    <MotionCard>
                        <Statistic
                            title='Completed'
                            value={stats.completed}
                            valueStyle={{ color: '#52c41a' }}
                            prefix={<CheckCircleOutlined />}
                        />
                    </MotionCard>
                </Col>
            </Row>

            {/* Filters */}
            <MotionCard style={{ marginBottom: '16px' }}>
                <Row gutter={[16, 16]} align='middle'>
                    <Col xs={24} sm={8}>
                        <div>Status:</div>
                        <Select
                            value={statusFilter}
                            onChange={setStatusFilter}
                            style={{ width: '100%' }}
                            placeholder='Filter by status'
                        >
                            <Option value='all'>All Status</Option>
                            <Option value='Pending'>Pending</Option>
                            <Option value='Overdue'>Overdue</Option>
                            <Option value='Completed'>Completed</Option>
                            <Option value='Cancelled'>Cancelled</Option>
                        </Select>
                    </Col>
                    <Col xs={24} sm={8}>
                        <div>Priority:</div>
                        <Select
                            value={priorityFilter}
                            onChange={setPriorityFilter}
                            style={{ width: '100%' }}
                            placeholder='Filter by priority'
                        >
                            <Option value='all'>All Priorities</Option>
                            <Option value='Urgent'>Urgent</Option>
                            <Option value='High'>High</Option>
                            <Option value='Medium'>Medium</Option>
                            <Option value='Low'>Low</Option>
                        </Select>
                    </Col>
                    <Col xs={24} sm={8}>
                        <div>Date Range:</div>
                        <RangePicker
                            value={dateRange}
                            onChange={setDateRange}
                            style={{ width: '100%' }}
                            placeholder={['Start Date', 'End Date']}
                        />
                    </Col>
                </Row>
            </MotionCard>

            {/* Follow-ups Table */}
            <MotionCard>
                <Table
                    columns={columns}
                    dataSource={filteredFollowUps}
                    loading={loading}
                    rowKey='id'
                    pagination={{
                        pageSize: 10,
                        showSizeChanger: true,
                        showQuickJumper: true,
                        showTotal: (total, range) =>
                            `${range[0]}-${range[1]} of ${total} follow-ups`
                    }}
                    scroll={{ x: 1000 }}
                />
            </MotionCard>

            {/* Edit Follow-up Modal */}
            <Modal
                title='Edit Follow-up'
                open={isModalVisible}
                onCancel={() => {
                    setIsModalVisible(false)
                    setEditingFollowUp(null)
                    form.resetFields()
                }}
                footer={null}
                width={600}
            >
                <Form form={form} layout='vertical' onFinish={handleUpdateFollowUp}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item
                                label='Scheduled Date'
                                name='scheduledDate'
                                rules={[{ required: true, message: 'Please select a date' }]}
                            >
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                label='Follow-up Type'
                                name='followUpType'
                                rules={[{ required: true, message: 'Please select a type' }]}
                            >
                                <Select placeholder='Select type'>
                                    <Option value='Phone'>Phone</Option>
                                    <Option value='Email'>Email</Option>
                                    <Option value='In-person'>In-person</Option>
                                    <Option value='Video Call'>Video Call</Option>
                                </Select>
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item
                                label='Priority'
                                name='priority'
                                rules={[{ required: true, message: 'Please select priority' }]}
                            >
                                <Select placeholder='Select priority'>
                                    <Option value='Low'>Low</Option>
                                    <Option value='Medium'>Medium</Option>
                                    <Option value='High'>High</Option>
                                    <Option value='Urgent'>Urgent</Option>
                                </Select>
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item label='Notes' name='notes'>
                        <TextArea
                            rows={4}
                            placeholder='Add notes about this follow-up...'
                        />
                    </Form.Item>

                    <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                        <Space>
                            <Button
                                onClick={() => {
                                    setIsModalVisible(false)
                                    setEditingFollowUp(null)
                                    form.resetFields()
                                }}
                            >
                                Cancel
                            </Button>
                            <Button type='primary' htmlType='submit'>
                                Update Follow-up
                            </Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    )
}

export default FollowUpsList
