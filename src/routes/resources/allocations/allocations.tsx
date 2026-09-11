import React, { useEffect, useMemo, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Tag,
  Input,
  Tooltip,
  Card,
  Typography,
  Modal,
  Form,
  Select,
  DatePicker,
  InputNumber,
  message,
  notification,
  Statistic,
  Row,
  Col,
  Tabs,
  Calendar,
  Badge
} from 'antd'
import {
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  PlusOutlined,
  CalendarOutlined,
  DashboardOutlined,
  TeamOutlined
} from '@ant-design/icons'
import { Allocation, ResourceItem } from '@/types/resources'
import { db } from '@/firebase'
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  doc
} from 'firebase/firestore'
import dayjs from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Text } = Typography
const { RangePicker } = DatePicker
const { TabPane } = Tabs

const Allocations: React.FC = () => {
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [resources, setResources] = useState<ResourceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [editingAllocation, setEditingAllocation] = useState<Allocation | null>(
    null
  )
  const [activeTab, setActiveTab] = useState('table')

  const allocationStatuses = [
    { value: 'scheduled', label: 'Scheduled', color: 'blue' },
    { value: 'active', label: 'Active', color: 'green' },
    { value: 'completed', label: 'Completed', color: 'grey' },
    { value: 'cancelled', label: 'Cancelled', color: 'red' }
  ]

  // Helpers to tolerate Firestore Timestamp or JS Date
  const toDayjs = (ts: any) => {
    if (!ts) return dayjs.invalid()
    if (ts?.seconds) return dayjs(ts.seconds * 1000)
    if (typeof ts?.toDate === 'function') return dayjs(ts.toDate())
    return dayjs(ts)
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const [allocSnap, resourceSnap] = await Promise.all([
        getDocs(collection(db, 'resourceAllocations')),
        getDocs(collection(db, 'resources'))
      ])
      const fetchedAllocations = allocSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Allocation[]
      const fetchedResources = resourceSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ResourceItem[]
      setAllocations(fetchedAllocations)
      setResources(fetchedResources)
      sendUpcomingReminders(fetchedAllocations)
    } catch (err) {
      console.error(err)
      message.error('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const sendUpcomingReminders = (allocations: Allocation[]) => {
    const now = dayjs()
    const tomorrow = now.add(1, 'day')
    allocations.forEach(allocation => {
      const startDate = toDayjs(allocation.startTime)
      if (
        startDate.isAfter(now) &&
        startDate.isSameOrBefore(tomorrow) &&
        allocation.status === 'scheduled'
      ) {
        notification.info({
          message: 'Upcoming Allocation',
          description: `Resource ${allocation.allocatedTo} scheduled tomorrow!`
        })
      }
    })
  }

  const handleSearch = (value: string) => setSearchText(value)

  const showAllocationModal = (
    resourceId?: string,
    allocation?: Allocation
  ) => {
    setEditingAllocation(allocation || null)
    form.resetFields()
    if (allocation) {
      form.setFieldsValue({
        ...allocation,
        timeRange: [toDayjs(allocation.startTime), toDayjs(allocation.endTime)]
      })
    } else {
      form.setFieldsValue({ resourceId })
    }
    setModalOpen(true)
  }

  const handleDeleteAllocation = async (record: Allocation) => {
    try {
      await deleteDoc(doc(db, 'resourceAllocations', record.id))
      message.success('Allocation deleted')
      fetchData()
    } catch (err) {
      console.error(err)
      message.error('Delete failed')
    }
  }

  const handleModalSubmit = async () => {
    try {
      const values = await form.validateFields()
      const [start, end] = values.timeRange
      const payload = {
        ...values,
        startTime: start.toDate(),
        endTime: end.toDate(),
        status: values.status || 'scheduled'
      }
      if (editingAllocation) {
        await updateDoc(
          doc(db, 'resourceAllocations', editingAllocation.id),
          payload
        )
        message.success('Allocation updated')
      } else {
        await addDoc(collection(db, 'resourceAllocations'), payload)
        message.success('Allocation created')
      }
      setModalOpen(false)
      fetchData()
    } catch (err) {
      console.error(err)
    }
  }

  const getFilteredAllocations = () => {
    if (!searchText) return allocations
    return allocations.filter(allocation => {
      const resourceName =
        resources.find(r => r.id === allocation.resourceId)?.name || ''
      return (
        allocation.allocatedTo
          .toLowerCase()
          .includes(searchText.toLowerCase()) ||
        allocation.purpose.toLowerCase().includes(searchText.toLowerCase()) ||
        resourceName.toLowerCase().includes(searchText.toLowerCase())
      )
    })
  }

  const allocationColumns = [
    {
      title: 'Resource',
      key: 'resource',
      render: (_: any, record: Allocation) => {
        const resource = resources.find(r => r.id === record.resourceId)
        return resource ? resource.name : 'Unknown'
      }
    },
    {
      title: 'Allocated To',
      dataIndex: 'allocatedTo',
      key: 'allocatedTo'
    },
    {
      title: 'Purpose',
      dataIndex: 'purpose',
      key: 'purpose',
      ellipsis: true
    },
    {
      title: 'Date/Time',
      key: 'datetime',
      render: (_: any, record: Allocation) => {
        const startDate = toDayjs(record.startTime).toDate()
        const endDate = toDayjs(record.endTime).toDate()
        const formatDate = (date: Date) =>
          `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })}`
        return (
          <Space direction='vertical' size={0}>
            <Text>Start: {formatDate(startDate)}</Text>
            <Text>End: {formatDate(endDate)}</Text>
          </Space>
        )
      }
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      key: 'quantity'
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const statusInfo = allocationStatuses.find(s => s.value === status)
        return (
          <Tag color={statusInfo?.color || 'default'}>
            {statusInfo?.label || status}
          </Tag>
        )
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: Allocation) => (
        <Space size='small'>
          <Tooltip title='Edit Allocation'>
            <Button
              type='text'
              icon={<EditOutlined />}
              onClick={() => showAllocationModal(undefined, record)}
            />
          </Tooltip>
          <Tooltip title='Delete'>
            <Button
              type='text'
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteAllocation(record)}
            />
          </Tooltip>
        </Space>
      )
    }
  ]

  // ---------- AntD Calendar plumbing ----------
  const statusToBadge = (status?: string) => {
    switch (status) {
      case 'scheduled':
        return 'processing' as const
      case 'active':
        return 'success' as const
      case 'cancelled':
        return 'error' as const
      case 'completed':
      default:
        return 'default' as const
    }
  }

  // Build a date → events map (handles multi-day spans)
  const eventsByDate = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        id: string
        title: string
        status?: string
      }>
    >()

    allocations.forEach(alloc => {
      const start = toDayjs(alloc.startTime)
      const end = toDayjs(alloc.endTime)
      if (!start.isValid() || !end.isValid()) return

      const resourceName =
        resources.find(r => r.id === alloc.resourceId)?.name || 'Unknown'
      const title = `${resourceName} → ${alloc.allocatedTo}`

      // iterate each day in the allocation range (inclusive)
      let cursor = start.startOf('day')
      const last = end.startOf('day')
      while (cursor.isBefore(last) || cursor.isSame(last)) {
        const key = cursor.format('YYYY-MM-DD')
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push({ id: alloc.id, title, status: alloc.status })
        cursor = cursor.add(1, 'day')
      }
    })

    return map
  }, [allocations, resources])

  const calendarCellRender = (date: dayjs.Dayjs, info: any) => {
    if (info.type !== 'date') return info.originNode
    const key = date.format('YYYY-MM-DD')
    const list = eventsByDate.get(key) || []
    if (!list.length) return info.originNode

    return (
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {list.slice(0, 3).map(ev => (
          <li
            key={ev.id}
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.2
            }}
          >
            <Badge status={statusToBadge(ev.status)} text={ev.title} />
          </li>
        ))}
        {list.length > 3 && (
          <li style={{ fontSize: 12 }}>+{list.length - 3} more</li>
        )}
      </ul>
    )
  }

  return (
    <div style={{ minHeight: '100vh', padding: 24 }}>
      <Tabs centered activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab='Allocations Table' key='table'>
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} md={8}>
              <MotionCard>
                <Statistic
                  title='Total Allocations'
                  value={allocations.length}
                  prefix={<DashboardOutlined />}
                />
              </MotionCard>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <MotionCard>
                <Statistic
                  title='Active Allocations'
                  value={allocations.filter(a => a.status === 'active').length}
                  prefix={<TeamOutlined />}
                />
              </MotionCard>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <MotionCard>
                <Statistic
                  title='Scheduled Tomorrow'
                  value={
                    allocations.filter(a => {
                      const start = toDayjs(a.startTime)
                      const now = dayjs()
                      const tomorrow = now.add(1, 'day')
                      return (
                        start.isAfter(now) &&
                        start.isSameOrBefore(tomorrow) &&
                        a.status === 'scheduled'
                      )
                    }).length
                  }
                  prefix={<CalendarOutlined />}
                />
              </MotionCard>
            </Col>
          </Row>

          <MotionCard>
            <Space
              style={{
                marginBottom: 16,
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%'
              }}
            >
              <Input
                placeholder='Search allocations...'
                prefix={<SearchOutlined />}
                allowClear
                onChange={e => handleSearch(e.target.value)}
                style={{ width: 250 }}
              />
              <Button
                type='primary'
                icon={<PlusOutlined />}
                onClick={() => showAllocationModal()}
              >
                Create Allocation
              </Button>
            </Space>

            <Table
              dataSource={getFilteredAllocations()}
              columns={allocationColumns}
              rowKey='id'
              loading={loading}
              pagination={{ pageSize: 10 }}
            />
          </MotionCard>
        </TabPane>

        <TabPane tab='Calendar View' key='calendar'>
          <Card>
            {/* Ant Design Calendar replacing FullCalendar */}
            <Calendar cellRender={calendarCellRender} />
          </Card>
        </TabPane>
      </Tabs>

      <Modal
        title={editingAllocation ? 'Edit Allocation' : 'New Allocation'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleModalSubmit}
        destroyOnClose
      >
        <Form layout='vertical' form={form} preserve={false}>
          <Form.Item
            name='resourceId'
            label='Resource'
            rules={[{ required: true }]}
          >
            <Select
              options={resources.map(r => ({ label: r.name, value: r.id }))}
              placeholder='Select a resource'
            />
          </Form.Item>
          <Form.Item
            name='allocatedTo'
            label='Allocated To'
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name='purpose'
            label='Purpose'
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name='quantity'
            label='Quantity'
            rules={[{ required: true }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name='timeRange'
            label='Time Range'
            rules={[{ required: true }]}
          >
            <RangePicker
              showTime
              format='YYYY-MM-DD HH:mm'
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item name='status' label='Status'>
            <Select options={allocationStatuses} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Allocations
