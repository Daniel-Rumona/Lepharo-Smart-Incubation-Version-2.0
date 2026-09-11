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
  Typography,
  Alert,
  Tooltip
} from 'antd'
import {
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  PhoneOutlined,
  MailOutlined,
  HomeOutlined,
  EditOutlined,
  EyeOutlined,
  UserOutlined,
  CalendarOutlined
} from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import {
  followUpService,
  FollowUp,
  FollowUpQueryParams
} from '@/services/followUpService'
import { format, isAfter, isBefore, addDays } from 'date-fns'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { RangePicker } = DatePicker
const { Option } = Select
const { TextArea } = Input
const { Title } = Typography

const CenterCoordinatorFollowUps: React.FC = () => {
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

  // Filters
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'Pending' | 'Completed' | 'Overdue' | 'Cancelled'
  >('all')
  const [priorityFilter, setPriorityFilter] = useState<
    'all' | 'Low' | 'Medium' | 'High' | 'Urgent'
  >('all')
  const [assignedToFilter, setAssignedToFilter] = useState<string>('all')
  const [dateRange, setDateRange] = useState<any>([])

  // Modal states
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | null>(null)
  const [form] = Form.useForm()

  const navigate = useNavigate()
  const { user, loading: userLoading } = useAuth()

  const loadFollowUps = React.useCallback(async () => {
    if (!user?.assignedBranch) {
      console.error('CenterCoordinatorFollowUps: No branch assigned to user')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      console.log(
        'CenterCoordinatorFollowUps: Fetching follow-ups for branch:',
        user.assignedBranch
      )

      // Get all follow-ups for the branch (center coordinators can see all follow-ups)
      const data = await followUpService.getCenterCoordinatorFollowUps(
        user.assignedBranch
      )
      console.log(
        'CenterCoordinatorFollowUps: Retrieved',
        data.length,
        'follow-ups'
      )
      setFollowUps(data)
      setFilteredFollowUps(data)

      // Get statistics (exclude receptionist-assigned follow-ups for center coordinator)
      const branchStats =
        await followUpService.getCenterCoordinatorFollowUpStats(
          user.assignedBranch
        )
      setStats(branchStats)
    } catch (error) {
      console.error('Error loading follow-ups:', error)
      message.error('Failed to load follow-ups')
    } finally {
      setLoading(false)
    }
  }, [user?.assignedBranch])

  useEffect(() => {
    if (user && user.assignedBranch) {
      loadFollowUps()
    }
  }, [user?.assignedBranch, loadFollowUps])

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

    // Assigned to filter
    if (assignedToFilter !== 'all') {
      filtered = filtered.filter(
        followUp => followUp.assignedTo === assignedToFilter
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
  }, [followUps, statusFilter, priorityFilter, assignedToFilter, dateRange])

  const handleCompleteFollowUp = async (followUpId: string) => {
    try {
      console.log('Completing follow-up:', followUpId)

      await followUpService.updateFollowUpStatus(
        followUpId,
        'Completed',
        'Completed by center coordinator'
      )

      // Refresh data
      await loadFollowUps()
      message.success('Follow-up completed successfully')
    } catch (error) {
      console.error('Error completing follow-up:', error)
      message.error(
        `Failed to complete follow-up: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  const handleEditFollowUp = (followUp: FollowUp) => {
    setEditingFollowUp(followUp)
    form.setFieldsValue({
      notes: followUp.notes,
      priority: followUp.priority,
      scheduledDate: dayjs(followUp.scheduledDate),
      followUpType: followUp.followUpType,
      assignedTo: followUp.assignedTo
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
        scheduledDate: values.scheduledDate.toDate(),
        followUpType: values.followUpType,
        priority: values.priority,
        notes: values.notes,
        assignedTo: values.assignedTo,
        assignedToName: values.assignedTo // This should be resolved to actual name
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
        `Failed to update follow-up: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  const handleViewInquiry = (inquiryId: string) => {
    // Navigate to project admin inquiry detail view
    navigate(`/projectadmin/inquiries/${inquiryId}`)
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

  const getUniqueAssignedTo = () => {
    const assignedToSet = new Set(followUps.map(fu => fu.assignedTo))
    return Array.from(assignedToSet).sort()
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
      width: 200
    },
    {
      title: 'Assigned To',
      dataIndex: 'assignedToName',
      key: 'assignedToName',
      render: (name: string) => (
        <Space>
          <UserOutlined />
          {name}
        </Space>
      ),
      width: 150
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
      render: (date: Date) => (
        <Space>
          <CalendarOutlined />
          {format(date, 'MMM dd, yyyy')}
        </Space>
      ),
      sorter: (a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime(),
      width: 140
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
      width: 120
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Tooltip title='View Inquiry'>
            <Button
              type='text'
              icon={<EyeOutlined />}
              onClick={() => handleViewInquiry(record.inquiryId)}
              size='small'
            />
          </Tooltip>
          <Tooltip title='Edit Follow-up'>
            <Button
              type='text'
              icon={<EditOutlined />}
              onClick={() => handleEditFollowUp(record)}
              size='small'
            />
          </Tooltip>
          {record.status === 'Pending' && (
            <Tooltip title='Mark as Completed'>
              <Button
                type='text'
                icon={<CheckCircleOutlined />}
                onClick={() => handleCompleteFollowUp(record.id)}
                size='small'
                style={{ color: '#52c41a' }}
              />
            </Tooltip>
          )}
        </Space>
      ),
      width: 120
    }
  ]

  if (userLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh'
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

  return (
    <div style={{ padding: '24px', minHeight: '100vh' }}>
      <Alert
        message='Follow-up Management Notice'
        description='Monitor and manage follow-ups for your branch. As a center coordinator, you can view and manage follow-ups that are not assigned to receptionists. Receptionist-assigned follow-ups are managed separately by the receptionist team.'
        type='info'
        showIcon
        style={{ marginBottom: 24 }}
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
          <Col xs={24} sm={6}>
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
          <Col xs={24} sm={6}>
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
          <Col xs={24} sm={6}>
            <div>Assigned To:</div>
            <Select
              value={assignedToFilter}
              onChange={setAssignedToFilter}
              style={{ width: '100%' }}
              placeholder='Filter by assignee'
            >
              <Option value='all'>All Assignees</Option>
              {getUniqueAssignedTo().map(assignedTo => (
                <Option key={assignedTo} value={assignedTo}>
                  {assignedTo}
                </Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} sm={6}>
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
          scroll={{ x: 1200 }}
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
            <Col span={12}>
              <Form.Item
                label='Assigned To'
                name='assignedTo'
                rules={[{ required: true, message: 'Please select assignee' }]}
              >
                <Select placeholder='Select assignee'>
                  {getUniqueAssignedTo().map(assignedTo => (
                    <Option key={assignedTo} value={assignedTo}>
                      {assignedTo}
                    </Option>
                  ))}
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

export default CenterCoordinatorFollowUps
