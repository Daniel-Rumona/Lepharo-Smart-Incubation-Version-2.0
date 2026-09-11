import React, { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Input,
  Space,
  Tag,
  message,
  Row,
  Col,
  Statistic
} from 'antd'
import {
  SearchOutlined,
  PhoneOutlined,
  MailOutlined,
  UserOutlined,
  HomeOutlined,
  FilterOutlined,
  ExportOutlined
} from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { inquiryService } from '@/services/inquiryService'
import { format } from 'date-fns'
import type { ColumnsType } from 'antd/es/table'
import {
  DashboardHeaderCard,
  MotionCard
} from '@/components/dashboards/metrics/Header'

const { Search } = Input

interface Contact {
  id: string
  name: string
  email: string
  phone: string
  company?: string
  lastInquiryDate: Date
  totalInquiries: number
  status: 'Active' | 'Inactive'
  source: string
  lastInteraction: string
}

const ContactsList: React.FC = () => {
  const navigate = useNavigate()
  const { user, loading: userLoading } = useAuth()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  const loadContacts = React.useCallback(async () => {
    if (!user?.assignedBranch) {
      console.error('ContactsList: No branch assigned to user')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      console.log(
        'ContactsList: Fetching inquiries for branch:',
        user.assignedBranch
      )

      // Get all inquiries for the branch
      const inquiries = await inquiryService.getInquiriesByBranch(
        user.assignedBranch
      )

      // Extract unique contacts from inquiries
      const contactMap = new Map<string, Contact>()

      inquiries.forEach(inquiry => {
        const email = inquiry.contactInfo.email
        if (!email) return // Skip inquiries without email

        const contactKey = email.toLowerCase()

        if (contactMap.has(contactKey)) {
          const existingContact = contactMap.get(contactKey)!
          existingContact.totalInquiries += 1

          // Update last inquiry date if this one is more recent
          if (new Date(inquiry.submittedAt) > existingContact.lastInquiryDate) {
            existingContact.lastInquiryDate = new Date(inquiry.submittedAt)
            existingContact.lastInteraction = inquiry.status
          }
        } else {
          contactMap.set(contactKey, {
            id: inquiry.id,
            name: `${inquiry.contactInfo.firstName} ${inquiry.contactInfo.lastName}`,
            email: email,
            phone: inquiry.contactInfo.phone || '',
            company: inquiry.contactInfo.company,
            lastInquiryDate: new Date(inquiry.submittedAt),
            totalInquiries: 1,
            status: 'Active',
            source: inquiry.source,
            lastInteraction: inquiry.status
          })
        }
      })

      const contactsList = Array.from(contactMap.values()).sort(
        (a, b) => b.lastInquiryDate.getTime() - a.lastInquiryDate.getTime()
      )

      console.log(
        'ContactsList: Processed',
        contactsList.length,
        'unique contacts'
      )
      setContacts(contactsList)
      setFilteredContacts(contactsList)
    } catch (error) {
      console.error('Error loading contacts:', error)
      message.error('Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [user?.assignedBranch])

  useEffect(() => {
    if (user && user.assignedBranch) {
      loadContacts()
    }
  }, [user?.assignedBranch, loadContacts])

  // Filter contacts based on search term
  useEffect(() => {
    if (!searchTerm) {
      setFilteredContacts(contacts)
    } else {
      const filtered = contacts.filter(
        contact =>
          contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          contact.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          contact.phone.includes(searchTerm) ||
          (contact.company &&
            contact.company.toLowerCase().includes(searchTerm.toLowerCase()))
      )
      setFilteredContacts(filtered)
    }
  }, [searchTerm, contacts])

  const handleSearch = (value: string) => {
    setSearchTerm(value)
  }

  const handleViewInquiries = (contact: Contact) => {
    navigate(
      `/receptionist/inquiries?contact=${encodeURIComponent(contact.email)}`
    )
  }

  const handleCall = (phone: string) => {
    window.open(`tel:${phone}`)
  }

  const handleEmail = (email: string) => {
    window.open(`mailto:${email}`)
  }

  const columns: ColumnsType<Contact> = [
    {
      title: 'Contact',
      key: 'contact',
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: '14px' }}>{record.name}</div>
          <div style={{ color: '#666', fontSize: '12px' }}>
            {record.company || 'Individual'}
          </div>
        </div>
      ),
      width: 200
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (email: string) => (
        <Button
          type='link'
          icon={<MailOutlined />}
          onClick={() => handleEmail(email)}
          style={{ padding: 0 }}
        >
          {email}
        </Button>
      ),
      width: 250
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone: string) => (
        <Button
          type='link'
          icon={<PhoneOutlined />}
          onClick={() => handleCall(phone)}
          style={{ padding: 0 }}
        >
          {phone}
        </Button>
      ),
      width: 150
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      render: (source: string) => <Tag color='blue'>{source}</Tag>,
      width: 100
    },
    {
      title: 'Inquiries',
      dataIndex: 'totalInquiries',
      key: 'totalInquiries',
      sorter: (a, b) => a.totalInquiries - b.totalInquiries,
      width: 100
    },
    {
      title: 'Last Contact',
      dataIndex: 'lastInquiryDate',
      key: 'lastInquiryDate',
      render: (date: Date) => format(date, 'MMM dd, yyyy'),
      sorter: (a, b) =>
        a.lastInquiryDate.getTime() - b.lastInquiryDate.getTime(),
      width: 120
    },
    {
      title: 'Status',
      dataIndex: 'lastInteraction',
      key: 'lastInteraction',
      render: (status: string) => {
        const color =
          status === 'Completed'
            ? 'green'
            : status === 'In Progress'
            ? 'orange'
            : 'default'
        return <Tag color={color}>{status}</Tag>
      },
      width: 120
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button
            type='text'
            icon={<UserOutlined />}
            onClick={() => handleViewInquiries(record)}
            title='View All Inquiries'
          >
            View Inquiries
          </Button>
        </Space>
      ),
      width: 150,
      fixed: 'right'
    }
  ]

  // Show loading while user data is being fetched
  if (userLoading) {
    return (
      <div style={{ padding: '24px', minHeight: '100vh', textAlign: 'center' }}>
        <MotionCard>
          <div style={{ padding: '40px 20px' }}>
            <h3>Loading user data...</h3>
          </div>
        </MotionCard>
      </div>
    )
  }

  // Show proper message if user has no assigned branch
  if (user && !user.assignedBranch) {
    return (
      <div style={{ padding: '24px', minHeight: '100vh', textAlign: 'center' }}>
        <MotionCard style={{ maxWidth: 500, margin: '0 auto' }}>
          <div style={{ padding: '40px 20px' }}>
            <h2>🏢 Branch Assignment Required</h2>
            <p
              style={{ fontSize: '16px', color: '#666', marginBottom: '24px' }}
            >
              You need to be assigned to a branch to access contacts.
            </p>
            <p style={{ fontSize: '14px', color: '#888' }}>
              Please contact your <strong>Director</strong> to assign you to a
              branch through the User Management system.
            </p>
            <p style={{ fontSize: '12px', color: '#aaa', marginTop: '20px' }}>
              Directors can assign branches via:{' '}
              <em>User Management → Edit User → Select Branch</em>
            </p>
          </div>
        </MotionCard>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', minHeight: '100vh' }}>
      {/* Header */}
      <DashboardHeaderCard
        title='Contact Directory'
        subtitle=' Manage contacts from inquiries for your branch'
      />

      {/* Summary Statistics */}
      <Row gutter={16} style={{ marginBottom: '24px' }}>
        <Col xs={24} sm={8}>
          <MotionCard>
            <Statistic
              title='Total Contacts'
              value={contacts.length}
              prefix={<UserOutlined />}
            />
          </MotionCard>
        </Col>
        <Col xs={24} sm={8}>
          <MotionCard>
            <Statistic
              title='Active This Month'
              value={
                contacts.filter(
                  c =>
                    new Date(c.lastInquiryDate).getMonth() ===
                    new Date().getMonth()
                ).length
              }
              prefix={<PhoneOutlined />}
            />
          </MotionCard>
        </Col>
        <Col xs={24} sm={8}>
          <MotionCard>
            <Statistic
              title='Repeat Contacts'
              value={contacts.filter(c => c.totalInquiries > 1).length}
              prefix={<FilterOutlined />}
            />
          </MotionCard>
        </Col>
      </Row>

      {/* Search and Filters */}
      <MotionCard style={{ marginBottom: '16px' }}>
        <Row gutter={16} align='middle'>
          <Col xs={24} sm={16}>
            <Search
              placeholder='Search by name, email, phone, or company...'
              allowClear
              enterButton={<SearchOutlined />}
              size='large'
              onSearch={handleSearch}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Space>
              <Button icon={<ExportOutlined />}>Export Contacts</Button>
            </Space>
          </Col>
        </Row>
      </MotionCard>

      {/* Contacts Table */}
      <MotionCard>
        <Table
          columns={columns}
          dataSource={filteredContacts}
          rowKey='id'
          loading={loading}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) =>
              `${range[0]}-${range[1]} of ${total} contacts`
          }}
          scroll={{ x: 1200 }}
        />
      </MotionCard>
    </div>
  )
}

export default ContactsList
