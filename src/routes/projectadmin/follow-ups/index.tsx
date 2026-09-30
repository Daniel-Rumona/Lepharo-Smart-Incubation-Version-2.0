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
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { RangePicker } = DatePicker
const { Option } = Select
const { TextArea } = Input
const { Title } = Typography

// Portal-created inquiries default a follow-up's assignee to whoever submitted them, i.e. the
// SME's own account, and store that id as the "name". Only a stored real name counts as staff.
const UNASSIGNED = '__unassigned'
const looksLikeId = (value?: string) => !value || /^[A-Za-z0-9]{20,}$/.test(value.trim())

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
  const [branchStaff, setBranchStaff] = useState<{ id: string; name: string; email: string }[]>([])
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

  // Users can only read their own profile, so names come from the follow-up itself.
  const staffNameFor = (followUp: Pick<FollowUp, 'assignedTo' | 'assignedToName'>) => {
    if (user?.uid && followUp.assignedTo === user.uid) return user.name || user.email || ''
    const stored = String(followUp.assignedToName || '').trim()
    return !looksLikeId(stored) && stored !== followUp.assignedTo ? stored : ''
  }

  // Project admins and receptionists of this branch, so a follow-up can go to any of them.
  useEffect(() => {
    if (!user?.assignedBranch) return
    let cancelled = false

    getDocs(
      query(
        collection(db, 'users'),
        where('assignedBranch', '==', user.assignedBranch),
        where('role', 'in', ['projectadmin', 'receptionist'])
      )
    )
      .then(snap => {
        if (cancelled) return
        setBranchStaff(
          snap.docs.map(item => {
            const data = item.data() as any
            return {
              id: item.id,
              name: String(data.name || data.fullName || data.displayName || data.email || '').trim(),
              email: String(data.email || '').trim()
            }
          })
        )
      })
      .catch(error => console.warn('Could not load branch staff', error))

    return () => {
      cancelled = true
    }
  }, [user?.assignedBranch])

  const staffOptions = React.useMemo(() => {
    const byId = new Map<string, { label: string; email: string }>()
    followUps.forEach(followUp => {
      const name = staffNameFor(followUp)
      if (name && followUp.assignedTo) {
        byId.set(followUp.assignedTo, { label: name, email: followUp.assignedToEmail || '' })
      }
    })
    branchStaff.forEach(person => {
      if (person.name) byId.set(person.id, { label: person.name, email: person.email })
    })
    if (user?.uid) byId.set(user.uid, { label: user.name || user.email || 'Me', email: user.email || '' })
    return Array.from(byId, ([value, info]) => ({ value, label: info.label, email: info.email })).sort((a, b) =>
      a.label.localeCompare(b.label)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followUps, branchStaff, user?.uid, user?.name, user?.email])

  const assigneeLabelById = (id: string) => staffOptions.find(option => option.value === id)?.label || 'Unassigned'

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
    if (assignedToFilter === UNASSIGNED) {
      filtered = filtered.filter(followUp => !staffNameFor(followUp))
    } else if (assignedToFilter !== 'all') {
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
  }, [followUps, user?.uid, statusFilter, priorityFilter, assignedToFilter, dateRange])

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
      assignedTo: staffNameFor(followUp) ? followUp.assignedTo : undefined
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
        assignedToName: assigneeLabelById(values.assignedTo),
        assignedToEmail: staffOptions.find(option => option.value === values.assignedTo)?.email || ''
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

  const columns: ColumnsType<FollowUp> = [
    {
      title: 'SME',
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
      render: (_: string, record) => (
        <Space>
          <UserOutlined />
          {staffNameFor(record) || <span style={{ opacity: 0.55 }}>Unassigned</span>}
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

  const metricProps = (filter: 'all' | 'Pending' | 'Overdue' | 'Completed') => {
    const active = statusFilter === filter
    return {
      clickable: true,
      onClick: () => setStatusFilter(active ? 'all' : filter),
      wrapperStyle: active
        ? { border: '1px solid #1677ff', boxShadow: '0 0 0 2px rgba(22,119,255,0.18)' }
        : undefined
    }
  }

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
      <Select
        value={statusFilter}
        onChange={setStatusFilter}
        style={{ minWidth: 150, flex: '1 1 150px' }}
        options={[
          { value: 'all', label: 'All statuses' },
          { value: 'Pending', label: 'Pending' },
          { value: 'Overdue', label: 'Overdue' },
          { value: 'Completed', label: 'Completed' },
          { value: 'Cancelled', label: 'Cancelled' }
        ]}
      />
      <Select
        value={priorityFilter}
        onChange={setPriorityFilter}
        style={{ minWidth: 150, flex: '1 1 150px' }}
        options={[
          { value: 'all', label: 'All priorities' },
          { value: 'Urgent', label: 'Urgent' },
          { value: 'High', label: 'High' },
          { value: 'Medium', label: 'Medium' },
          { value: 'Low', label: 'Low' }
        ]}
      />
      <Select
        value={assignedToFilter}
        onChange={setAssignedToFilter}
        style={{ minWidth: 170, flex: '1 1 170px' }}
        options={[
          { value: 'all', label: 'All assignees' },
          { value: UNASSIGNED, label: 'Unassigned' },
          ...staffOptions
        ]}
      />
      <RangePicker
        value={dateRange}
        onChange={setDateRange}
        style={{ minWidth: 250, flex: '1.3 1 250px' }}
        placeholder={['Start date', 'End date']}
      />
    </div>
  )

  return (
    <div style={{ padding: '24px', minHeight: '100vh' }}>
      {/* Statistics */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}>
          <MotionCard.Metric
            {...metricProps('all')}
            loading={loading}
            icon={<ClockCircleOutlined style={{ color: '#1677ff' }} />}
            iconBg='rgba(22,119,255,0.12)'
            title='Total Follow-ups'
            value={stats.total}
            subtitle='Click to show all'
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MotionCard.Metric
            {...metricProps('Pending')}
            loading={loading}
            icon={<ClockCircleOutlined style={{ color: '#fa8c16' }} />}
            iconBg='rgba(250,140,22,0.14)'
            title='Pending'
            value={stats.pending}
            subtitle='Waiting to be actioned'
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MotionCard.Metric
            {...metricProps('Overdue')}
            loading={loading}
            icon={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}
            iconBg='rgba(255,77,79,0.12)'
            title='Overdue'
            value={stats.overdue}
            subtitle='Past their scheduled date'
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MotionCard.Metric
            {...metricProps('Completed')}
            loading={loading}
            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            iconBg='rgba(82,196,26,0.12)'
            title='Completed'
            value={stats.completed}
            subtitle='Done and closed'
          />
        </Col>
      </Row>

      {/* Follow-ups Table */}
      <MotionCard filterBar={filterBar}>
        <Table
          columns={columns}
          dataSource={filteredFollowUps}
          loading={loading}
          rowKey='id'
          pagination={{
            pageSize: 10,
            position: ['bottomCenter'],
            showSizeChanger: false,
            showQuickJumper: false
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
                <Select placeholder='Select assignee' options={staffOptions} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label='Notes' name='notes'>
            <TextArea
              rows={4}
              placeholder='Add notes about this follow-up...'
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Button
                block
                size='large'
                onClick={() => {
                  setIsModalVisible(false)
                  setEditingFollowUp(null)
                  form.resetFields()
                }}
              >
                Cancel
              </Button>
              <Button block size='large' type='primary' htmlType='submit'>
                Update Follow-up
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default CenterCoordinatorFollowUps
