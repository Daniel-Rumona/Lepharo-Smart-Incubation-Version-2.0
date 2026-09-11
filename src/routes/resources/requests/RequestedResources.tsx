import React, { useEffect, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Input,
  Tooltip,
  Typography,
  message,
  Popconfirm,
  Row,
  Col,
  Select,
  DatePicker,
  Alert,
  Descriptions,
  Modal
} from 'antd'
import {
  SearchOutlined,
  CheckOutlined,
  CloseOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons'
import { ResourceRequest } from '@/types/resources'
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  query,
  where
} from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Text } = Typography
const { Option } = Select
const { RangePicker } = DatePicker

const statusColors: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
  completed: 'blue'
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  completed: 'Completed'
}

const RequestedResources: React.FC = () => {
  const [requests, setRequests] = useState<ResourceRequest[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [searchText, setSearchText] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(
    null
  )
  const [viewModal, setViewModal] = useState(false)
  const [selectedRequest, setSelectedRequest] =
    useState<ResourceRequest | null>(null)

  const fetchRequests = async () => {
    setLoading(true)
    try {
      const q = query(
        collection(db, 'resourceRequests'),
        where('requestType', '==', 'external')
      )
      const snap = await getDocs(q)
      const data = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ResourceRequest[]
      setRequests(data)
    } catch (err) {
      console.error(err)
      message.error('❌ Failed to load resource requests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRequests()
  }, [])

  const handleSearch =
    ((value: string) => {
      setSearchText(value)
    },
    300)

  const updateRequestStatus = async (id: string, status: string) => {
    try {
      await updateDoc(doc(db, 'resourceRequests', id), { status })
      message.success(`Request marked as ${status}`)
      fetchRequests()
    } catch (err) {
      console.error(err)
      message.error('Failed to update request')
    }
  }

  const handleDecision = async (status: 'approved' | 'rejected') => {
    if (!selectedRequest) return
    try {
      await updateRequestStatus(selectedRequest.id, status)
      setViewModal(false)
    } catch (err) {
      message.error('Failed to update request')
    }
  }

  const filteredRequests = requests.filter(req => {
    const matchesSearch = [req.resourceName, req.requestedBy, req.purpose].some(
      field => field?.toLowerCase().includes(searchText.toLowerCase())
    )

    const matchesStatus = !statusFilter || req.status === statusFilter

    const created = req.createdAt?.toDate?.() || new Date(req.createdAt)
    const matchesDate =
      !dateRange ||
      (dayjs(created).isAfter(dateRange[0].startOf('day')) &&
        dayjs(created).isBefore(dateRange[1].endOf('day')))

    return matchesSearch && matchesStatus && matchesDate
  })

  const metrics = {
    total: filteredRequests.length,
    pending: filteredRequests.filter(r => r.status === 'pending').length,
    approved: filteredRequests.filter(r => r.status === 'approved').length,
    rejected: filteredRequests.filter(r => r.status === 'rejected').length
  }

  const columns = [
    {
      title: 'Resource',
      dataIndex: 'resourceName',
      key: 'resourceName'
    },
    {
      title: 'Requested By',
      dataIndex: 'requestedBy',
      key: 'requestedBy'
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      key: 'quantity',
      render: val => val || '-'
    },
    {
      title: 'Duration',
      key: 'durationDays',
      render: (_: any, record: ResourceRequest) =>
        `${record.durationDays || 0} days`
    },
    {
      title: 'Needed By',
      dataIndex: 'neededBy',
      key: 'neededBy',
      render: val => (val ? dayjs(val).format('YYYY-MM-DD') : '-')
    },
    {
      title: 'Purpose',
      dataIndex: 'purpose',
      key: 'purpose',
      ellipsis: true
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={statusColors[status] || 'default'}>
          {statusLabels[status] || status}
        </Tag>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: ResourceRequest) => (
        <Tooltip title='View'>
          <Button
            type='link'
            onClick={() => {
              setSelectedRequest(record)
              setViewModal(true)
            }}
          >
            View
          </Button>
        </Tooltip>
      )
    }
  ]

  return (
    <div style={{ minHeight: '100vh', padding: 24 }}>
      {/* ✅ Metrics */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <MotionCard>
            <Space>
              <FileTextOutlined style={{ fontSize: 24, color: '#2f54eb' }} />
              <div>
                <Text>Total</Text>
                <br />
                <Text strong>{metrics.total}</Text>
              </div>
            </Space>
          </MotionCard>
        </Col>
        <Col span={6}>
          <MotionCard>
            <Space>
              <ClockCircleOutlined style={{ fontSize: 24, color: '#faad14' }} />
              <div>
                <Text>Pending</Text>
                <br />
                <Text strong>{metrics.pending}</Text>
              </div>
            </Space>
          </MotionCard>
        </Col>
        <Col span={6}>
          <MotionCard>
            <Space>
              <CheckCircleOutlined style={{ fontSize: 24, color: '#52c41a' }} />
              <div>
                <Text>Approved</Text>
                <br />
                <Text strong>{metrics.approved}</Text>
              </div>
            </Space>
          </MotionCard>
        </Col>
        <Col span={6}>
          <MotionCard>
            <Space>
              <CloseCircleOutlined style={{ fontSize: 24, color: '#f5222d' }} />
              <div>
                <Text>Rejected</Text>
                <br />
                <Text strong>{metrics.rejected}</Text>
              </div>
            </Space>
          </MotionCard>
        </Col>
      </Row>

      {/* Filters + Table */}
      <MotionCard>
        <Row gutter={16} style={{ marginBottom: 10 }}>
          <Col>
            <Input
              placeholder='Search...'
              prefix={<SearchOutlined />}
              allowClear
              onChange={e => handleSearch(e.target.value)}
              style={{ width: 250 }}
            />
          </Col>
          <Col>
            <Select
              placeholder='Filter by status'
              allowClear
              onChange={val => setStatusFilter(val)}
              style={{ width: 180 }}
            >
              {Object.keys(statusLabels).map(key => (
                <Option key={key} value={key}>
                  {statusLabels[key]}
                </Option>
              ))}
            </Select>
          </Col>
          <Col>
            <RangePicker
              onChange={val =>
                setDateRange(val as [dayjs.Dayjs, dayjs.Dayjs] | null)
              }
            />
          </Col>
        </Row>
        <Table
          dataSource={filteredRequests}
          columns={columns}
          rowKey='id'
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </MotionCard>

      <Modal
        open={viewModal}
        title='📄 Resource Request Details'
        onCancel={() => setViewModal(false)}
        footer={
          selectedRequest?.status === 'pending' && (
            <Space style={{ justifyContent: 'end', width: '100%' }}>
              <Popconfirm
                title='Approve this request?'
                onConfirm={() => handleDecision('approved')}
                okText='Yes'
                cancelText='No'
              >
                <Button type='primary'>Approve</Button>
              </Popconfirm>

              <Popconfirm
                title='Reject this request?'
                onConfirm={() => handleDecision('rejected')}
                okText='Yes'
                cancelText='No'
              >
                <Button danger>Reject</Button>
              </Popconfirm>
            </Space>
          )
        }
      >
        {selectedRequest && (
          <>
            <Alert
              type='info'
              message='Request Overview'
              description={`This request is currently marked as ${
                statusLabels[selectedRequest.status] || selectedRequest.status
              }.`}
              showIcon
              style={{ marginBottom: 16 }}
            />

            <Descriptions bordered column={1} size='middle'>
              <Descriptions.Item label='Incubatee'>
                {selectedRequest.requestedBy}
              </Descriptions.Item>
              <Descriptions.Item label='Resource Name'>
                {selectedRequest.resourceName}
              </Descriptions.Item>
              <Descriptions.Item label='Quantity'>
                {selectedRequest.quantity || '-'}
              </Descriptions.Item>
              <Descriptions.Item label='Created At'>
                {selectedRequest.createdAt?.toDate
                  ? dayjs(selectedRequest.createdAt.toDate()).format(
                      'YYYY-MM-DD HH:mm'
                    )
                  : '-'}
              </Descriptions.Item>
            </Descriptions>

            <div style={{ marginTop: 24 }}>
              <Text strong>Purpose:</Text>
              <p>{selectedRequest.purpose}</p>

              <Row gutter={16}>
                <Col span={12}>
                  <Text strong>Needed By:</Text>
                  <p>
                    {selectedRequest.neededBy
                      ? dayjs(selectedRequest.neededBy).format('YYYY-MM-DD')
                      : '-'}
                  </p>
                </Col>
                <Col span={12}>
                  <Text strong>Duration:</Text>
                  <p>{selectedRequest.durationDays || 0} days</p>
                </Col>
              </Row>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

export default RequestedResources
