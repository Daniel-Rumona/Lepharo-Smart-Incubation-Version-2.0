import React, { useEffect, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Input,
  Tooltip,
  Progress,
  Typography,
  Modal,
  Form,
  Select,
  InputNumber,
  message,
  notification,
  Statistic,
  Row,
  Col
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  DashboardOutlined,
  TeamOutlined
} from '@ant-design/icons'
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc
} from 'firebase/firestore'
import { db } from '@/firebase'
import { ResourceItem } from '@/types/resources'
import { motion } from 'framer-motion'

const { Text } = Typography

const Resources: React.FC = () => {
  const [resources, setResources] = useState<ResourceItem[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [searchText, setSearchText] = useState<string>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [editingResource, setEditingResource] = useState<ResourceItem | null>(
    null
  )

  const resourceTypes = [
    { value: 'room', label: 'Room' },
    { value: 'equipment', label: 'Equipment' },
    { value: 'vehicle', label: 'Vehicle' }
  ]

  const resourceStatuses = [
    { value: 'available', label: 'Available', color: 'green' },
    { value: 'maintenance', label: 'Maintenance', color: 'orange' },
    { value: 'unavailable', label: 'Unavailable', color: 'red' }
  ]

  useEffect(() => {
    fetchResources()
  }, [])

  const fetchResources = async () => {
    setLoading(true)
    try {
      const snapshot = await getDocs(collection(db, 'resources'))
      const data = snapshot.docs.map(
        doc => ({ id: doc.id, ...doc.data() } as ResourceItem)
      )
      setResources(data)
    } catch (error) {
      console.error('Failed to load resources:', error)
      message.error('Failed to fetch resources')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (value: string) => {
    setSearchText(value)
  }

  const getFilteredResources = () => {
    if (!searchText) return resources
    return resources.filter(
      resource =>
        resource.name.toLowerCase().includes(searchText.toLowerCase()) ||
        resource.description.toLowerCase().includes(searchText.toLowerCase()) ||
        resource.type.toLowerCase().includes(searchText.toLowerCase())
    )
  }

  const showResourceModal = (record?: ResourceItem) => {
    setEditingResource(record || null)
    form.resetFields()
    if (record) {
      form.setFieldsValue(record)
    }
    setModalOpen(true)
  }

  const handleDeleteResource = async (record: ResourceItem) => {
    try {
      await deleteDoc(doc(db, 'resources', record.id))
      message.success('Resource deleted')
      fetchResources()
    } catch (error) {
      console.error('Delete failed:', error)
      message.error('Delete failed')
    }
  }

  const handleModalSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingResource) {
        await updateDoc(doc(db, 'resources', editingResource.id), values)
        message.success('Resource updated')
      } else {
        await addDoc(collection(db, 'resources'), {
          ...values,
          available: values.capacity
        })
        message.success('Resource created')
      }
      setModalOpen(false)
      fetchResources()
    } catch (err) {
      console.error(err)
    }
  }

  const getTotalCapacity = () =>
    resources.reduce((acc, r) => acc + r.capacity, 0)
  const getTotalAvailable = () =>
    resources.reduce((acc, r) => acc + r.available, 0)
  const getUtilizationRate = () => {
    const total = getTotalCapacity()
    const used = total - getTotalAvailable()
    return total > 0 ? Math.round((used / total) * 100) : 0
  }

  const resourceColumns = [
    {
      title: 'Resource Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: ResourceItem) => (
        <Space direction='vertical' size={0}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong>{text}</Text>
            {record.status === 'maintenance' && (
              <Tag color='orange' style={{ fontSize: '10px' }}>
                🛠 Maintenance
              </Tag>
            )}
          </div>
          <Text type='secondary' style={{ fontSize: '12px' }}>
            {resourceTypes.find(type => type.value === record.type)?.label}
          </Text>
        </Space>
      )
    },
    {
      title: 'Capacity',
      dataIndex: 'capacity',
      key: 'capacity'
    },
    {
      title: 'Availability',
      key: 'availability',
      render: (_: any, record: ResourceItem) => (
        <Space direction='vertical' style={{ width: '100%' }}>
          <Progress
            percent={Math.round((record.available / record.capacity) * 100)}
            size='small'
            status={
              record.available / record.capacity < 0.2 ? 'exception' : 'normal'
            }
            format={() => `${record.available}/${record.capacity}`}
          />
        </Space>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const statusInfo = resourceStatuses.find(s => s.value === status)
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
      render: (_: any, record: ResourceItem) => (
        <Space size='small'>
          <Tooltip title='Edit Resource'>
            <Button
              type='text'
              icon={<EditOutlined />}
              onClick={() => showResourceModal(record)}
            />
          </Tooltip>
          <Tooltip title='Delete'>
            <Button
              type='text'
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteResource(record)}
            />
          </Tooltip>
        </Space>
      )
    }
  ]

  return (
    <div style={{ minHeight: '100vh', padding: 24 }}>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={8}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card
              style={{
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                transition: 'all 0.3s ease',
                borderRadius: 12,
                border: '1px solid #d6e4ff'
              }}
            >
              <Statistic
                title='Total Resources'
                value={resources.length}
                prefix={<DashboardOutlined />}
              />
            </Card>
          </motion.div>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card
              style={{
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                transition: 'all 0.3s ease',
                borderRadius: 12,
                border: '1px solid #d6e4ff'
              }}
            >
              <Statistic
                title='Total Capacity'
                value={getTotalCapacity()}
                prefix={<TeamOutlined />}
              />
            </Card>
          </motion.div>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card
              style={{
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                transition: 'all 0.3s ease',
                borderRadius: 12,
                border: '1px solid #d6e4ff'
              }}
            >
              <Statistic
                title='Utilization Rate'
                value={getUtilizationRate()}
                suffix='%'
              />
            </Card>
          </motion.div>
        </Col>
      </Row>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {' '}
        <Card
          style={{
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            transition: 'all 0.3s ease',
            borderRadius: 12,
            border: '1px solid #d6e4ff'
          }}
        >
          <Space
            style={{
              marginBottom: 16,
              display: 'flex',
              justifyContent: 'space-between',
              width: '100%'
            }}
          >
            <Input
              placeholder='Search resources...'
              prefix={<SearchOutlined />}
              allowClear
              onChange={e => handleSearch(e.target.value)}
              style={{ width: 250 }}
            />
            <Button
              type='primary'
              icon={<PlusOutlined />}
              onClick={() => showResourceModal()}
            >
              Add Resource
            </Button>
          </Space>

          <Table
            dataSource={getFilteredResources()}
            columns={resourceColumns}
            rowKey='id'
            loading={loading}
            pagination={{ pageSize: 10 }}
            expandable={{
              expandedRowRender: record => (
                <p style={{ margin: 0 }}>
                  <strong>Description:</strong> {record.description}
                  {record.location && (
                    <>
                      <br />
                      <strong>Location:</strong> {record.location}
                    </>
                  )}
                  {record.maintainer && (
                    <>
                      <br />
                      <strong>Maintainer:</strong> {record.maintainer}
                    </>
                  )}
                </p>
              )
            }}
          />
        </Card>
      </motion.div>

      <Modal
        title={editingResource ? 'Edit Resource' : 'Add Resource'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleModalSubmit}
        destroyOnClose
      >
        <Form form={form} layout='vertical'>
          <Form.Item
            name='name'
            label='Resource Name'
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name='type' label='Type' rules={[{ required: true }]}>
            <Select options={resourceTypes} placeholder='Select type' />
          </Form.Item>
          <Form.Item
            name='capacity'
            label='Capacity'
            rules={[{ required: true }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name='status' label='Status' rules={[{ required: true }]}>
            <Select options={resourceStatuses} placeholder='Select status' />
          </Form.Item>
          <Form.Item name='description' label='Description'>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name='location' label='Location'>
            <Input />
          </Form.Item>
          <Form.Item name='maintainer' label='Maintainer'>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Resources
