// src/routes/legal/InterventionsRequests.tsx
import React, { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Tag,
  Modal,
  Input,
  Select,
  Row,
  Col,
  Typography,
  Space,
  message,
  Descriptions,
  DatePicker
} from 'antd'
import { Helmet } from 'react-helmet'
import {
  SendOutlined,
  UserAddOutlined,
  PlusOutlined,
  ReloadOutlined,
  CloseOutlined,
  CheckOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  InboxOutlined
} from '@ant-design/icons'
import { auth, db } from '@/firebase'
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  getDoc
} from 'firebase/firestore'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Title, Text } = Typography
const { Option } = Select

const sunkenPanel: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: '#f7f8fc',
  border: '1px solid #e7e9f2',
  boxShadow: 'inset 0 2px 8px rgba(15,23,42,.06)'
}

const InterventionsRequests: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [selectedInquiry, setSelectedInquiry] = useState<any>(null)
  const [interventions, setInterventions] = useState<any[]>([])
  const [filterStatus, setFilterStatus] = useState<string | undefined>()
  const [dateRange, setDateRange] = useState<[string, string] | null>(null)
  const [searchText, setSearchText] = useState<string>('')
  const [rejectionModal, setRejectionModal] = useState<{
    visible: boolean
    item?: any
  }>({ visible: false })
  const [rejectionReason, setRejectionReason] = useState('')
  const [viewModal, setViewModal] = useState(false)
  const [userDepartment, setUserDepartment] = useState<string>('')
  const [userDepartmentId, setUserDepartmentId] = useState<string>('')

  useEffect(() => {
    const fetchUser = async () => {
      const currentUser = auth.currentUser
      if (!currentUser) return

      const snap = await getDoc(doc(db, 'users', currentUser.uid))
      if (snap.exists()) {
        const profile = snap.data()
        const departmentName = String(profile?.departmentName || '')
        setUserDepartment(departmentName)
        if (profile?.departmentId) {
          setUserDepartmentId(String(profile.departmentId))
        } else if (departmentName) {
          const departmentSnap = await getDocs(
            query(collection(db, 'departments'), where('name', '==', departmentName))
          )
          setUserDepartmentId(departmentSnap.docs[0]?.id || '')
        }
      }
    }

    fetchUser()
  }, [])

  // --- LOAD DATA ---
  const fetchData = async () => {
    setLoading(true)
    try {
      // fetch participants...
      const participantSnap = await getDocs(collection(db, 'participants'))
      const participantMap: Record<string, string> = {}
      participantSnap.forEach(doc => {
        const data = doc.data()
        participantMap[doc.id] = data.beneficiaryName || '—'
      })

      const intSnap = await getDocs(collection(db, 'interventionRequests'))
      const interventions = intSnap.docs
        .map(doc => {
          const data = doc.data()
          const submittedAt = data.createdAt
            ? (typeof data.createdAt === 'object' && data.createdAt.seconds
                ? new Date(data.createdAt.seconds * 1000)
                : new Date(data.createdAt)
              )
                .toISOString()
                .substring(0, 10)
            : ''

          return {
            id: doc.id,
            ...data,
            type: 'Intervention',
            beneficiaryName: participantMap[data.participantId] || '—',
            company: data.companyName || '—',
            areaOfSupport: data.areaOfSupport || '—',
            interventionTitle: data.interventionTitle || '—',
            reaon: data.reason || '—',
            status: data.status || 'pending',
            assignedConsultant: data.assignedConsultant || null,
            submittedAt
          }
        })
        .filter(item => item.areaOfSupport === userDepartment)

      setInterventions(interventions)
    } catch (err) {
      console.error('❌ Error loading data:', err)
    }
    setLoading(false)
  }
  useEffect(() => {
    if (!userDepartment) return // Wait until department is set

    fetchData()
  }, [userDepartment]) // 🔥 React will re-run this effect when department is set

  const handleAccept = async (item: any) => {
    try {
      const snap = await getDocs(query(
        collection(db, 'applications'),
        where('participantId', '==', item.participantId)
      ))
      if (snap.empty) {
        message.error('No application document found for this participant.')
        return
      }

      const appDoc = item.programId
        ? snap.docs.find(d => d.data()?.programId === item.programId) || snap.docs[0]
        : snap.docs[0]
      const appData = appDoc.data()
      const existingRequired = appData.interventions?.required || []
      const departmentId = String(item.departmentId || userDepartmentId || '')
      if (!departmentId) {
        message.error('Your department could not be identified. The request was not accepted.')
        return
      }

      const requiredItem = {
        id: item.interventionId || item.id,
        requestId: item.id,
        title: item.interventionTitle || 'Untitled',
        area: item.areaOfSupport || userDepartment || 'General',
        departmentId,
        departmentName: item.areaOfSupport || userDepartment
      }
      const existingIndex = existingRequired.findIndex(
        (i: any) => i.requestId === item.id || i.id === requiredItem.id
      )
      const updatedRequired = [...existingRequired]
      if (existingIndex >= 0) {
        updatedRequired[existingIndex] = { ...updatedRequired[existingIndex], ...requiredItem }
      } else {
        updatedRequired.push(requiredItem)
      }

      await updateDoc(doc(db, 'applications', appDoc.id), {
        'interventions.required': updatedRequired
      })
      await updateDoc(doc(db, 'interventionRequests', item.id), {
        status: 'accepted',
        rejectionReason: '',
        departmentId,
        applicationId: appDoc.id
      })
      await fetchData()
      message.success('Intervention accepted and added to the Developmental Plan.')
    } catch (error) {
      console.error('Error accepting intervention request:', error)
      message.error('Failed to accept the intervention request.')
    }
  }

  const handleReject = async () => {
    if (!rejectionModal.item || !rejectionReason.trim()) return
    await updateDoc(doc(db, 'interventionRequests', rejectionModal.item.id), {
      status: 'rejected',
      rejectionReason
    })
    await fetchData()
    message.success('Intervention rejected.')
    setRejectionModal({ visible: false })
    setRejectionReason('')
  }

  const handleRevert = async (item: any) => {
    await updateDoc(doc(db, 'interventionRequests', item.id), {
      status: 'pending',
      rejectionReason: ''
    })
    await fetchData()
    message.success('Status reverted to pending.')
  }

  // Filters
  const filteredInterventions = interventions.filter(item => {
    const matchesStatus = filterStatus ? item.status === filterStatus : true
    const matchesDate = dateRange && item.submittedAt
      ? item.submittedAt >= dateRange[0] && item.submittedAt <= dateRange[1]
      : !dateRange
    const matchesSearch = searchText
      ? (item.company?.toLowerCase() || '').includes(
          searchText.toLowerCase()
        ) ||
        (item.beneficiaryName?.toLowerCase() || '').includes(
          searchText.toLowerCase()
        )
      : true
    return matchesStatus && matchesDate && matchesSearch
  })

  const interventionColumns = [
    { title: 'SME', dataIndex: 'beneficiaryName', key: 'beneficiaryName' },
    {
      title: 'Intervention',
      dataIndex: 'interventionTitle',
      key: 'interventionTitle'
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) =>
        status === 'pending' ? (
          <Tag color='gold'>Pending</Tag>
        ) : status === 'rejected' ? (
          <Tag color='red'>Rejected</Tag>
        ) : status === 'accepted' ? (
          <Tag color='blue'>Accepted</Tag>
        ) : (
          <Tag>{status}</Tag>
        )
    },
    { title: 'Date', dataIndex: 'submittedAt', key: 'submittedAt' },
    {
      title: 'Actions',
      render: (_, record) => {
        if (['requested', 'pending'].includes(record.status)) {
          return (
            <Space>
              <Button
                icon={<EyeOutlined />}
                onClick={() => {
                  setSelectedInquiry(record)
                  setViewModal(true)
                }}
              >
                View
              </Button>
              <Button
                icon={<CheckOutlined />}
                onClick={() => handleAccept(record)}
              >
                Accept
              </Button>
              <Button
                icon={<CloseOutlined />}
                onClick={() =>
                  setRejectionModal({ visible: true, item: record })
                }
              >
                Reject
              </Button>
            </Space>
          )
        } else {
          return (
            <Space>
              <Button icon={<EyeOutlined />} onClick={() => {
                setSelectedInquiry(record)
                setViewModal(true)
              }}>View</Button>
              <Button type='primary' danger onClick={() => handleRevert(record)}>
                Revert
              </Button>
            </Space>
          )
        }
      }
    }
  ]

  return (
    <div style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
      <Helmet>
        <title>Intervention Requests | Legal Department</title>
      </Helmet>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <MotionCard><MotionCard.Metric title='Total Requests' value={interventions.length} icon={<InboxOutlined style={{ color: '#1890ff' }} />} iconBg='#e6f7ff' /></MotionCard>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <MotionCard><MotionCard.Metric title='Pending' value={interventions.filter(item => item.status === 'pending').length} icon={<ClockCircleOutlined style={{ color: '#faad14' }} />} iconBg='#fff7e6' /></MotionCard>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <MotionCard><MotionCard.Metric title='Accepted' value={interventions.filter(item => item.status === 'accepted').length} icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />} iconBg='#f6ffed' /></MotionCard>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <MotionCard><MotionCard.Metric title='Rejected' value={interventions.filter(item => item.status === 'rejected').length} icon={<CloseCircleOutlined style={{ color: '#ff4d4f' }} />} iconBg='#fff2f0' /></MotionCard>
        </Col>
      </Row>
      <MotionCard
        filterBar={
          <Row gutter={[12, 12]} style={{ width: '100%' }}>
            <Col xs={24} md={8}>
              <Input.Search
                placeholder='Search SME, Company...'
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                allowClear
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} md={8}>
              <Select
                allowClear
                style={{ width: '100%' }}
                placeholder='Status'
                value={filterStatus}
                onChange={setFilterStatus}
              >
                <Option value='pending'>Pending</Option>
                <Option value='rejected'>Rejected</Option>
                <Option value='accepted'>Accepted</Option>
              </Select>
            </Col>
            <Col xs={24} md={8}>
              <DatePicker.RangePicker
                style={{ width: '100%' }}
                format='YYYY-MM-DD'
                onChange={dates => setDateRange(
                  dates ? [dates[0]!.format('YYYY-MM-DD'), dates[1]!.format('YYYY-MM-DD')] : null
                )}
              />
            </Col>
          </Row>
        }
        filterBarProps={{
          style: sunkenPanel,
          padding: 0,
          background: 'transparent',
          borderColor: 'transparent',
          boxShadow: 'none'
        }}
      >
          <Table
            columns={interventionColumns}
            dataSource={filteredInterventions}
            rowKey='id'
            loading={loading}
            bordered
            pagination={{ pageSize: 8 }}
          />
      </MotionCard>

      <Modal
        open={rejectionModal.visible}
        title='Reject Intervention'
        onCancel={() => setRejectionModal({ visible: false })}
        onOk={handleReject}
      >
        <Input.TextArea
          rows={3}
          placeholder='Provide reason for rejection (this will be visible to the SME)'
          value={rejectionReason}
          onChange={e => setRejectionReason(e.target.value)}
        />
      </Modal>

      <Modal
        open={viewModal}
        title='Intervention Request Details'
        footer={null}
        onCancel={() => setViewModal(false)}
      >
        {selectedInquiry && (
          <Descriptions
            bordered
            column={1}
            size='small'
            style={{ marginTop: 12 }}
          >
            <Descriptions.Item label='SME'>
              {selectedInquiry.beneficiaryName}
            </Descriptions.Item>
            <Descriptions.Item label='Area of Support'>
              {selectedInquiry.areaOfSupport}
            </Descriptions.Item>
            <Descriptions.Item label='Intervention'>
              {selectedInquiry.interventionTitle}
            </Descriptions.Item>
            <Descriptions.Item label='Status'>
              <Tag>{selectedInquiry.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label='Motivation'>
              {selectedInquiry.reason || '—'}
            </Descriptions.Item>
            {selectedInquiry.status === 'rejected' && (
              <Descriptions.Item label='Rejection reason'>
                {selectedInquiry.rejectionReason || '—'}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  )
}

export default InterventionsRequests
