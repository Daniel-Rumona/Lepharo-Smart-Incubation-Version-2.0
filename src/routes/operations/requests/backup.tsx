// src/routes/legal/InquiriesAndInterventions.tsx
import React, { useEffect, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Modal,
  Input,
  Select,
  Row,
  Col,
  Tabs,
  Typography,
  Space,
  message
} from 'antd'
import {
  SendOutlined,
  UserAddOutlined,
  PlusOutlined,
  ReloadOutlined,
  CloseOutlined,
  CheckOutlined,
  EyeOutlined
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

const { Title } = Typography
const { Option } = Select
const { TabPane } = Tabs

const DUMMY_INQUIRIES = [
  {
    id: 'inq1',
    type: 'Inquiry',
    company: 'Mkhulu Manufacturing',
    contactName: 'Lindiwe Ndlovu',
    inquiryType: 'Contract Query',
    status: 'pending',
    submittedAt: '2024-07-01',
    details: 'Need help with contract review.',
    branch: 'Gauteng'
  },
  {
    id: 'inq2',
    type: 'Inquiry',
    company: 'GreenTech SME',
    contactName: 'John Dube',
    inquiryType: 'Intellectual Property',
    status: 'open',
    submittedAt: '2024-07-02',
    details: 'Advice needed for patent registration.',
    branch: 'Eastern Cape'
  }
]

const DUMMY_INTERVENTIONS = [
  {
    id: 'int1',
    type: 'Intervention',
    beneficiaryName: 'Sipho Moyo',
    company: 'Moyo Holdings',
    areaOfSupport: 'Legal Advisory Services',
    interventionTitle: 'Debt Collection Advisory',
    status: 'pending',
    submittedAt: '2024-07-03',
    assignedConsultant: null
  },
  {
    id: 'int2',
    type: 'Intervention',
    beneficiaryName: 'Nomsa Nkosi',
    company: 'Nkosi Tech',
    areaOfSupport: 'Legal Advisory Services',
    interventionTitle: 'Commercial Law Advisory',
    status: 'pending',
    submittedAt: '2024-07-04',
    assignedConsultant: 'adv_jones'
  }
]

// Dummy consultant list for assignment
const DUMMY_CONSULTANTS = [
  { id: 'adv_jones', name: 'Adv. T. Jones' },
  { id: 'lawyer_khumalo', name: 'L. Khumalo' }
]

const InquiriesAndInterventions: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [selectedInquiry, setSelectedInquiry] = useState<any>(null)
  const [inquiries, setInquiries] = useState<any[]>([])
  const [interventions, setInterventions] = useState<any[]>([])
  const [consultants, setConsultants] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState('inquiries')
  const [filterStatus, setFilterStatus] = useState<string | undefined>()
  const [filterArea, setFilterArea] = useState<string | undefined>()
  const [searchText, setSearchText] = useState<string>('')
  const [replyModal, setReplyModal] = useState<{
    visible: boolean
    item?: any
  }>({ visible: false })
  const [replyText, setReplyText] = useState('')
  const [rejectionModal, setRejectionModal] = useState<{
    visible: boolean
    item?: any
  }>({ visible: false })
  const [rejectionReason, setRejectionReason] = useState('')
  const [viewModal, setViewModal] = useState(false)
  const [userDepartment, setUserDepartment] = useState<string>('')

  useEffect(() => {
    const fetchUser = async () => {
      const currentUser = auth.currentUser
      if (!currentUser) return

      const snap = await getDoc(doc(db, 'users', currentUser.uid))
      if (snap.exists()) {
        setUserDepartment(snap.data()?.departmentName || '')
      }
    }

    fetchUser()
  }, [])

  // --- LOAD DATA ---
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        // 1. Load Participants into a map
        const participantSnap = await getDocs(collection(db, 'participants'))
        const participantMap: Record<string, string> = {}
        participantSnap.forEach(doc => {
          const data = doc.data()
          participantMap[doc.id] = data.beneficiaryName || '—'
        })

        // 2. Load Inquiries
        const inquirySnap = await getDocs(collection(db, 'inquiries'))
        const inquiries = inquirySnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          type: 'Inquiry',
          company: doc.data()?.contactInfo?.company || '—',
          contactName: `${doc.data()?.contactInfo?.firstName || ''} ${
            doc.data()?.contactInfo?.lastName || ''
          }`.trim(),
          inquiryType:
            doc.data()?.inquiryDetails?.inquiryType ||
            doc.data()?.inquiryType ||
            '—',
          status: doc.data()?.status || 'pending',
          submittedAt: doc.data()?.submittedAt
            ? (typeof doc.data().submittedAt === 'object' &&
              doc.data().submittedAt.seconds
                ? new Date(doc.data().submittedAt.seconds * 1000)
                : new Date(doc.data().submittedAt)
              )
                .toISOString()
                .substring(0, 10)
            : '',
          details:
            doc.data()?.inquiryDetails?.description ||
            doc.data()?.description ||
            '',
          branch: doc.data()?.location?.city || '—'
        }))
        setInquiries(inquiries.length ? inquiries : DUMMY_INQUIRIES)

        // 3. Load Intervention Requests and inject beneficiaryName from participantId
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
              status: data.status || 'pending',
              assignedConsultant: data.assignedConsultant || null,
              submittedAt
            }
          })
          .filter(item => item.areaOfSupport === userDepartment)
        setInterventions(
          interventions.length ? interventions : DUMMY_INTERVENTIONS
        )
      } catch (err) {
        console.error('❌ Error loading data:', err)
        setInquiries(DUMMY_INQUIRIES)
        setInterventions(DUMMY_INTERVENTIONS)
      }
      setLoading(false)
    }
    fetchData()
  }, [])

  // Generate dummy data into state (for demo, does NOT write to Firestore)
  const handleGenerateData = () => {
    setInquiries(DUMMY_INQUIRIES)
    setInterventions(DUMMY_INTERVENTIONS)
    message.info('Dummy data loaded.')
  }

  // Reply to Inquiry
  const handleReply = async () => {
    if (!replyText.trim() || !replyModal.item) {
      message.warning('Type your reply.')
      return
    }
    try {
      // Firestore update (if not dummy)
      if (!replyModal.item.id.startsWith('inq')) {
        await addDoc(collection(db, 'inquiryReplies'), {
          inquiryId: replyModal.item.id,
          reply: replyText,
          createdAt: new Date()
        })
        message.success('Reply sent.')
      } else {
        // Just show message (dummy)
        message.success('Reply "sent" (demo mode).')
      }
      setReplyModal({ visible: false, item: undefined })
      setReplyText('')
    } catch (err) {
      message.error('Failed to send reply.')
    }
  }

  const handleAccept = async (item: any) => {
    await updateDoc(doc(db, 'interventionRequests', item.id), {
      status: 'accepted',
      rejectionReason: ''
    })
    message.success('Intervention accepted.')
  }

  const handleReject = async () => {
    if (!rejectionModal.item || !rejectionReason.trim()) return
    await updateDoc(doc(db, 'interventionRequests', rejectionModal.item.id), {
      status: 'rejected',
      rejectionReason
    })
    message.success('Intervention rejected.')
    setRejectionModal({ visible: false })
    setRejectionReason('')
  }

  const handleRevert = async (item: any) => {
    await updateDoc(doc(db, 'interventionRequests', item.id), {
      status: 'pending',
      rejectionReason: ''
    })
    message.success('Status reverted to pending.')
  }

  // Filters
  const filteredInquiries = inquiries.filter(item => {
    const matchesStatus = filterStatus ? item.status === filterStatus : true
    const matchesSearch = searchText
      ? (item.company?.toLowerCase() || '').includes(
          searchText.toLowerCase()
        ) ||
        (item.contactName?.toLowerCase() || '').includes(
          searchText.toLowerCase()
        )
      : true
    return matchesStatus && matchesSearch
  })

  const filteredInterventions = interventions.filter(item => {
    const matchesStatus = filterStatus ? item.status === filterStatus : true
    const matchesArea = filterArea ? item.areaOfSupport === filterArea : true
    const matchesSearch = searchText
      ? (item.company?.toLowerCase() || '').includes(
          searchText.toLowerCase()
        ) ||
        (item.beneficiaryName?.toLowerCase() || '').includes(
          searchText.toLowerCase()
        )
      : true
    return matchesStatus && matchesArea && matchesSearch
  })

  // Table columns
  const inquiryColumns = [
    { title: 'Company', dataIndex: 'company', key: 'company' },
    { title: 'Contact', dataIndex: 'contactName', key: 'contactName' },
    { title: 'Type', dataIndex: 'inquiryType', key: 'inquiryType' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) =>
        status === 'pending' ? (
          <Tag color='gold'>Pending</Tag>
        ) : status === 'open' ? (
          <Tag color='blue'>Open</Tag>
        ) : status === 'closed' ? (
          <Tag color='green'>Closed</Tag>
        ) : (
          <Tag>{status}</Tag>
        )
    },
    { title: 'Date', dataIndex: 'submittedAt', key: 'submittedAt' },
    {
      title: 'Actions',
      render: (_, record) => (
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
            icon={<SendOutlined />}
            onClick={() => {
              setSelectedInquiry(record)
              setReplyModal(true)
            }}
          >
            Reply
          </Button>
        </Space>
      )
    }
  ]

  const statusLabels: Record<string, string> = {
    pending: 'Pending',
    pending: 'Requested',
    accepted: 'Accepted',
    rejected: 'Rejected'
  }

  const interventionColumns = [
    { title: 'SME', dataIndex: 'beneficiaryName', key: 'beneficiaryName' },
    { title: 'Area', dataIndex: 'areaOfSupport', key: 'areaOfSupport' },
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
        if (['pending', 'pending'].includes(record.status)) {
          return (
            <Space>
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
            <Button
              type='primary'
              color='danger'
              variant='filled'
              onClick={() => handleRevert(record)}
            >
              Revert
            </Button>
          )
        }
      }
    }
  ]

  // All area options from interventions for filter dropdown
  const allAreas = Array.from(
    new Set([...interventions.map(i => i.areaOfSupport).filter(Boolean)])
  )

  return (
    <div style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
      <Title level={3} style={{ marginBottom: 16 }}>
        Inquiries & Interventions
      </Title>
      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder='Search SME, Company...'
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <Select
            allowClear
            style={{ width: 140 }}
            placeholder='Status'
            value={filterStatus}
            onChange={setFilterStatus}
          >
            <Option value='pending'>Pending</Option>
            <Option value='rejected'>Rejected</Option>
            <Option value='accepted'>Accepted</Option>
          </Select>
          {/* {activeTab === 'interventions' && (
            <Select
              allowClear
              style={{ width: 180 }}
              placeholder='Area of Support'
              value={filterArea}
              onChange={setFilterArea}
            >
              {allAreas.map(area => (
                <Option key={area} value={area}>
                  {area}
                </Option>
              ))}
            </Select>
          )} */}
          <Button
            icon={<ReloadOutlined />}
            onClick={handleGenerateData}
            type='default'
          >
            Generate Data
          </Button>
        </Space>

        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab='Inquiries' key='inquiries'>
            <Table
              columns={inquiryColumns}
              dataSource={filteredInquiries}
              rowKey='id'
              loading={loading}
              bordered
              pagination={{ pageSize: 8 }}
            />
          </TabPane>
          <TabPane tab='Interventions' key='interventions'>
            <Table
              columns={interventionColumns}
              dataSource={filteredInterventions}
              rowKey='id'
              loading={loading}
              bordered
              pagination={{ pageSize: 8 }}
            />
          </TabPane>
        </Tabs>
      </Card>

      {/* View Inquiry Modal */}
      <Modal
        open={viewModal}
        title={`Inquiry from ${selectedInquiry?.company || ''}`}
        onCancel={() => setViewModal(false)}
        footer={<Button onClick={() => setViewModal(false)}>Close</Button>}
      >
        <p>
          <b>Type:</b> {selectedInquiry?.inquiryType}
        </p>
        <p>
          <b>Contact:</b> {selectedInquiry?.contactName}
        </p>
        <p>
          <b>Branch:</b> {selectedInquiry?.branch}
        </p>
        <p>
          <b>Details:</b>
          <br />
          {selectedInquiry?.details}
        </p>
      </Modal>

      {/* Reply Modal */}
      <Modal
        open={replyModal.visible}
        title={`Reply to ${replyModal.item?.company || 'Inquiry'}`}
        onCancel={() => setReplyModal({ visible: false, item: undefined })}
        onOk={handleReply}
        okText='Send Reply'
      >
        <Input.TextArea
          value={replyText}
          onChange={e => setReplyText(e.target.value)}
          placeholder='Type your reply...'
          rows={4}
        />
      </Modal>

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
    </div>
  )
}

export default InquiriesAndInterventions
