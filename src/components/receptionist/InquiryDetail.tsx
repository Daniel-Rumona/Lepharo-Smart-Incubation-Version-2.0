import React, { useState, useEffect } from 'react'
import {
  Card,
  Descriptions,
  Tag,
  Space,
  Button,
  Timeline,
  Divider,
  Typography,
  Row,
  Col,
  Badge,
  Segmented,
  List,
  Input,
  Select,
  DatePicker,
  Form,
  message,
  Modal,
  Spin,
  Tooltip,
  Checkbox
} from 'antd'
import {
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  EditOutlined,
  MessageOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  SendOutlined
} from '@ant-design/icons'
import { format } from 'date-fns'
import { inquiryService } from '@/services/inquiryService'
import type {
  Inquiry,
  InquiryStatus,
  InquiryPriority,
  CommunicationEntry
} from '@/types/inquiry'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { auth } from '@/firebase'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input
const { Option } = Select

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Quick response templates
const QUICK_RESPONSE_TEMPLATES = [
  {
    id: 'initial_response',
    title: 'Initial Response',
    subject: 'Thank you for your inquiry',
    content: `Dear {{firstName}},

Thank you for reaching out to us regarding {{inquiryType}}. We have received your inquiry and appreciate your interest in our services.

Our team will review your requirements and get back to you within 24-48 hours with more information.

In the meantime, if you have any urgent questions, please don't hesitate to contact us directly.

Best regards,
{{senderName}}
Incubation Platform Team`
  },
  {
    id: 'information_request',
    title: 'Information Request',
    subject: 'Additional Information Required',
    content: `Dear {{firstName}},

Thank you for your inquiry about {{inquiryType}}.

To better assist you, we would appreciate some additional information:

• [Please specify what information you need]
• [Add specific questions here]
• [Include any relevant details]

This will help us provide you with the most accurate and helpful response tailored to your needs.

Looking forward to hearing from you.

Best regards,
{{senderName}}
Incubation Platform Team`
  },
  {
    id: 'schedule_meeting',
    title: 'Schedule Meeting',
    subject: "Let's schedule a meeting to discuss your requirements",
    content: `Dear {{firstName}},

Thank you for your interest in our {{inquiryType}} services.

I'd love to schedule a brief meeting to discuss your requirements in detail and explore how we can best support your business goals.

Please let me know your availability for a 30-minute call this week or next. I'm flexible with timing and can accommodate your schedule.

Alternatively, you can book a time directly using this link: [Calendar Link]

Looking forward to our conversation.

Best regards,
{{senderName}}
Incubation Platform Team`
  },
  {
    id: 'follow_up',
    title: 'Follow-up Required',
    subject: 'Following up on your inquiry',
    content: `Dear {{firstName}},

I hope this message finds you well.

I wanted to follow up on your inquiry about {{inquiryType}} that we received on {{submittedDate}}.

We're committed to providing you with the support you need and would love to continue our conversation about how we can help with your business goals.

Please let me know if you're still interested or if you have any questions. I'm here to help.

Best regards,
{{senderName}}
Incubation Platform Team`
  },
  {
    id: 'referral',
    title: 'Referral to Specialist',
    subject: 'Connecting you with our specialist',
    content: `Dear {{firstName}},

Thank you for your inquiry about {{inquiryType}}.

Based on your specific requirements, I'm connecting you with our specialist who has extensive experience in this area. They will be able to provide you with detailed insights and tailored solutions.

{{specialistName}} will reach out to you within the next 24 hours to schedule a consultation.

If you have any immediate questions, please don't hesitate to contact me.

Best regards,
{{senderName}}
Incubation Platform Team`
  }
]

interface InquiryDetailProps {
  inquiryId: string
  onEdit?: () => void
  embedded?: boolean
}

// Firestore Timestamp | Date | number | ISO string -> Date | null
const asDate = (v: any): Date | null => {
  if (!v) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'string') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  if (v?.toDate && typeof v.toDate === 'function') {
    const d = v.toDate()
    return isNaN(d.getTime()) ? null : d
  }
  if (v?.seconds) {
    const d = new Date(v.seconds * 1000)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

const InquiryDetail: React.FC<InquiryDetailProps> = ({
  inquiryId,
  onEdit,
  embedded = false
}) => {
  const [inquiry, setInquiry] = useState<Inquiry | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [showCommunicationModal, setShowCommunicationModal] = useState(false)
  const [showQuickResponseModal, setShowQuickResponseModal] = useState(false)
  const [communicationForm] = Form.useForm()
  const [quickResponseForm] = Form.useForm()
  const [activeSection, setActiveSection] = useState('details')
  const { user } = useFullIdentity()

  const sendInquiryEmail = async (subject: string, content: string) => {
    const to = inquiry?.contactInfo.email?.trim()
    if (!to) {
      throw new Error('This inquiry does not have a contact email address.')
    }
    const idToken = await auth.currentUser?.getIdToken()
    if (!idToken) throw new Error('You must be signed in to send email.')
    const response = await fetch(
      'https://us-central1-lph-smart-inc.cloudfunctions.net/sendEmail',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          to,
          subject,
          text: content,
          html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.6">${escapeHtml(content)}</div>`
        })
      }
    )
    if (!response.ok) {
      throw new Error('The email could not be delivered.')
    }
  }

  useEffect(() => {
    loadInquiry()
  }, [inquiryId])

  const loadInquiry = async () => {
    try {
      setLoading(true)

      if (!inquiryId) {
        console.error('No inquiry ID provided')
        message.error('No inquiry provided. Please retry action.')
        return
      }

      const data = await inquiryService.getInquiryById(inquiryId)
      const normalized = {
        ...data,
        submittedAt: asDate(data.submittedAt),
        followUp: data.followUp
          ? {
              ...data.followUp,
              nextFollowUpDate: asDate(data.followUp.nextFollowUpDate)
            }
          : undefined,
        communications: (data.communications || []).map((c: any) => ({
          ...c,
          sentAt: asDate(c.sentAt)
        }))
      }
      setInquiry(normalized as Inquiry)

      // Opening an SME-submitted inquiry counts as acknowledging it (clears
      // the "new inquiry" sidebar badge). Best-effort - never blocks the view.
      if (data.source === 'SME' && !data.acknowledgedAt) {
        inquiryService.acknowledgeInquiry(inquiryId, user?.uid || 'system').catch(() => {})
      }
    } catch (error) {
      console.error('=== LOADING INQUIRY ERROR ===')
      console.error('Error loading inquiry:', error)
      console.error('Error type:', typeof error)
      console.error(
        'Error message:',
        error instanceof Error ? error.message : 'Unknown error'
      )
      console.error(
        'Error stack:',
        error instanceof Error ? error.stack : 'No stack'
      )
      message.error(
        `Failed to load inquiry details: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (newStatus: InquiryStatus) => {
    if (!inquiry) {
      console.log('No inquiry found, cannot update status')
      return
    }

    try {
      setStatusUpdating(true)

      // Add a small delay to ensure UI update shows
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await inquiryService.updateInquiryStatus(
        inquiryId,
        newStatus,
        user?.uid || 'system'
      )

      // Force a complete reload with fresh data
      const refreshedInquiry = await inquiryService.getInquiryById(inquiryId)

      if (refreshedInquiry) {
        setInquiry(refreshedInquiry)
      }

      message.success(`Status updated to ${newStatus} successfully`)
    } catch (error) {
      console.error('Full error object:', error)
      message.error('Failed to update status')
    } finally {
      setStatusUpdating(false)
      console.log('=== STATUS UPDATE COMPLETE ===')
    }
  }

  const addCommunication = async (values: any) => {
    if (!inquiry) return

    try {
      if (!values.isInternal) {
        await sendInquiryEmail(values.subject, values.content)
      }
      const communicationEntry: Omit<CommunicationEntry, 'id'> = {
        type: 'response',
        message: `Subject: ${values.subject}\n\n${values.content}`,
        sentAt: new Date(),
        sentBy: user?.uid || 'system',
        sentByName: user?.displayName || 'System',
        sentByRole: 'receptionist',
        isInternal: values.isInternal || false
      }

      await inquiryService.addCommunication(inquiryId, communicationEntry)
      await loadInquiry() // Reload to show the new communication
      setShowCommunicationModal(false)
      communicationForm.resetFields()
      message.success(
        values.isInternal
          ? 'Internal communication added successfully'
          : 'Email sent and communication logged successfully'
      )
    } catch (error) {
      console.error('Error adding communication:', error)
      message.error('Failed to add communication')
    }
  }

  const handleQuickResponse = async (values: any) => {
    if (!inquiry) return

    try {
      // Replace template variables
      let content = values.content
      content = content.replace(
        /\{\{firstName\}\}/g,
        inquiry.contactInfo.firstName
      )
      content = content.replace(
        /\{\{inquiryType\}\}/g,
        inquiry.inquiryDetails.inquiryType
      )
      content = content.replace(
        /\{\{submittedDate\}\}/g,
        format(inquiry.submittedAt, 'PPP')
      )
      content = content.replace(
        /\{\{senderName\}\}/g,
        user?.displayName || 'Team Member'
      )

      await sendInquiryEmail(values.subject, content)

      const communicationEntry: Omit<CommunicationEntry, 'id'> = {
        type: 'response',
        message: `Subject: ${values.subject}\n\n${content}`,
        sentAt: new Date(),
        sentBy: user?.uid || 'system',
        sentByName: user?.displayName || 'System',
        sentByRole: 'receptionist',
        isInternal: false // Quick responses are always external
      }

      await inquiryService.addCommunication(inquiryId, communicationEntry)
      await loadInquiry()
      setShowQuickResponseModal(false)
      quickResponseForm.resetFields()
      message.success('Quick response sent successfully')
    } catch (error) {
      console.error('Error sending quick response:', error)
      message.error('Failed to send quick response')
    }
  }

  const getStatusColor = (status: InquiryStatus): string => {
    const colors = {
      New: 'blue',
      'In Progress': 'orange',
      Contacted: 'cyan',
      Converted: 'green',
      Pending: 'gold',
      Resolved: 'green',
      Closed: 'gray',
      Lost: 'red'
    }
    return colors[status] || 'default'
  }

  const getPriorityColor = (priority: InquiryPriority): string => {
    const colors = {
      Low: 'green',
      Medium: 'orange',
      High: 'red',
      Urgent: 'purple'
    }
    return colors[priority] || 'default'
  }

  const getStatusIcon = (status: InquiryStatus) => {
    const icons = {
      New: <ExclamationCircleOutlined />,
      'In Progress': <ClockCircleOutlined />,
      Contacted: <MessageOutlined />,
      Converted: <CheckCircleOutlined />,
      Pending: <ClockCircleOutlined />,
      Resolved: <CheckCircleOutlined />,
      Closed: <CheckCircleOutlined />,
      Lost: <ExclamationCircleOutlined />
    }
    return icons[status] || <ClockCircleOutlined />
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size='large' />
        <div style={{ marginTop: '16px' }}>Loading inquiry details...</div>
      </div>
    )
  }

  if (!inquiry) {
    return (
      <Card>
        <Text type='secondary'>Inquiry not found</Text>
      </Card>
    )
  }

  // Add safety checks for rendering
  if (!inquiry.contactInfo || !inquiry.inquiryDetails) {
    console.error('Critical fields missing in inquiry:', inquiry)
    return (
      <Card>
        <Text type='danger'>Invalid inquiry data structure</Text>
        <div style={{ marginTop: '16px' }}>
          <Text type='secondary'>
            Missing: {!inquiry.contactInfo ? 'contactInfo ' : ''}
            {!inquiry.inquiryDetails ? 'inquiryDetails' : ''}
          </Text>
        </div>
      </Card>
    )
  }

  const nextFollow = asDate(inquiry.followUp?.nextFollowUpDate)

  // Safe date calculation
  const submittedAt = asDate(inquiry.submittedAt)
  const tabItems = [
    {
      key: 'details',
      label: 'Details',
      children: (
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={12}>
            <Card title='Contact Information' size='small'>
              <Descriptions column={1} size='small'>
                <Descriptions.Item label='Name'>
                  <Space>
                    {inquiry.contactInfo?.firstName || 'N/A'}{' '}
                    {inquiry.contactInfo?.lastName || 'N/A'}
                    {inquiry.source === 'SME' && (
                      <Badge
                        count={<UserOutlined style={{ color: '#1890ff' }} />}
                        size='small'
                      />
                    )}
                  </Space>
                </Descriptions.Item>
                {inquiry.contactInfo.email && (
                  <Descriptions.Item label='Email'>
                    <Space>
                      <MailOutlined />
                      <a href={`mailto:${inquiry.contactInfo.email}`}>
                        {inquiry.contactInfo.email}
                      </a>
                    </Space>
                  </Descriptions.Item>
                )}
                {inquiry.contactInfo.phone && (
                  <Descriptions.Item label='Phone'>
                    <Space>
                      <PhoneOutlined />
                      <a href={`tel:${inquiry.contactInfo.phone}`}>
                        {inquiry.contactInfo.phone}
                      </a>
                    </Space>
                  </Descriptions.Item>
                )}
                {inquiry.contactInfo.company && (
                  <Descriptions.Item label='Company'>
                    {inquiry.contactInfo.company}
                  </Descriptions.Item>
                )}
                {inquiry.contactInfo.position && (
                  <Descriptions.Item label='Position'>
                    {inquiry.contactInfo.position}
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>

            <Card
              title='Inquiry Management'
              size='small'
              style={{ marginTop: '16px' }}
            >
              <Descriptions column={1} size='small'>
                <Descriptions.Item label='Status'>
                  <Tag
                    icon={getStatusIcon(inquiry.status)}
                    color={getStatusColor(inquiry.status)}
                  >
                    {inquiry.status}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label='Priority'>
                  <Tag color={getPriorityColor(inquiry.priority)}>
                    {inquiry.priority}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label='Source'>
                  <Tag>{inquiry.source}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label='Classification'>
                  <Tag color={inquiry.classification === 'Potential' ? 'gold' : 'blue'}>
                    {inquiry.classification || 'General'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label='Submitted'>
                  {submittedAt ? format(submittedAt, 'PPPp') : 'Invalid date'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title='Inquiry Details' size='small'>
              <Descriptions column={1} size='small'>
                <Descriptions.Item label='Type'>
                  {inquiry.inquiryDetails?.inquiryType || 'N/A'}
                </Descriptions.Item>
                {inquiry.inquiryDetails.businessStage && (
                  <Descriptions.Item label='Business Stage'>
                    {inquiry.inquiryDetails.businessStage}
                  </Descriptions.Item>
                )}
                {inquiry.inquiryDetails.industry && (
                  <Descriptions.Item label='Industry'>
                    {inquiry.inquiryDetails.industry}
                  </Descriptions.Item>
                )}
                {inquiry.inquiryDetails.department && (
                  <Descriptions.Item label='Department'>
                    {inquiry.inquiryDetails.department}
                  </Descriptions.Item>
                )}
              </Descriptions>

              {inquiry.inquiryDetails.description && (
                <>
                  <Divider />
                  <div>
                    <Text strong>Description:</Text>
                    <Paragraph style={{ marginTop: '8px' }}>
                      {inquiry.inquiryDetails.description}
                    </Paragraph>
                  </div>
                </>
              )}
            </Card>

            {inquiry.followUp && (
              <Card
                title='Follow-up Information'
                size='small'
                style={{ marginTop: '16px' }}
              >
                <Descriptions column={1} size='small'>
                  {nextFollow && (
                    <Descriptions.Item label='Next Follow-up'>
                      {format(nextFollow, 'PPPp')}
                    </Descriptions.Item>
                  )}
                  {inquiry.followUp.followUpMethod && (
                    <Descriptions.Item label='Method'>
                      <Tag>{inquiry.followUp.followUpMethod}</Tag>
                    </Descriptions.Item>
                  )}
                  {inquiry.followUp.assignedTo && (
                    <Descriptions.Item label='Assigned To'>
                      {inquiry.followUp.assignedTo}
                    </Descriptions.Item>
                  )}
                  {inquiry.followUp.notes && (
                    <Descriptions.Item label='Notes'>
                      {inquiry.followUp.notes}
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </Card>
            )}
          </Col>
        </Row>
      )
    },
    {
      key: 'communications',
      label: `Communications ${
        inquiry.communications && Array.isArray(inquiry.communications)
          ? `(${inquiry.communications.length})`
          : '(0)'
      }`,
      children: (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 16
            }}
          >
            <Button
              block
              size='large'
              type='primary'
              icon={<PlusOutlined />}
              onClick={() => setShowCommunicationModal(true)}
            >
              Add Communication
            </Button>
            <Button
              block
              size='large'
              type='default'
              icon={<SendOutlined />}
              onClick={() => setShowQuickResponseModal(true)}
            >
              Quick Response
            </Button>
          </div>

          {(() => {
            const comms = (
              Array.isArray(inquiry.communications)
                ? inquiry.communications
                : []
            )
              .map(c => ({ ...c, _sentAt: asDate(c.sentAt) })) // normalize
              .filter(c => !!c._sentAt) // drop bad dates
              .sort((a, b) => b._sentAt!.getTime() - a._sentAt!.getTime())

            return comms.length ? (
              <Timeline>
                {comms.map((comm, index) => {
                  const messageParts = (comm.message || '').split('\n\n')
                  const subject =
                    messageParts[0]?.replace(/^Subject:\s*/i, '') ||
                    'No Subject'
                  const content =
                    messageParts.slice(1).join('\n\n') || comm.message

                  return (
                    <Timeline.Item
                      key={index}
                      dot={<MessageOutlined />}
                      color={comm.isInternal ? 'orange' : 'green'}
                    >
                      <Card size='small' style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 8
                          }}
                        >
                          <Space>
                            <Tag color={comm.isInternal ? 'orange' : 'green'}>
                              {(comm.type || 'response').toUpperCase()}
                            </Tag>
                            <Text strong>{subject}</Text>
                            {comm.isInternal && (
                              <Tag color='orange'>Internal</Tag>
                            )}
                          </Space>
                          <Text type='secondary' style={{ marginLeft: 8 }}>
                            {comm._sentAt
                              ? format(comm._sentAt, 'PPPp')
                              : 'Invalid date'}
                          </Text>
                        </div>
                        <Paragraph>{content}</Paragraph>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                          By: {comm.sentByName} ({comm.sentByRole})
                        </Text>
                      </Card>
                    </Timeline.Item>
                  )
                })}
              </Timeline>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                <MessageOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                <div>No communications yet</div>
                <div style={{ fontSize: 14 }}>
                  Start a conversation with the client
                </div>
              </div>
            )
          })()}
        </div>
      )
    }
  ]

  const nextStatus: InquiryStatus | null = (() => {
    switch (inquiry.status) {
      case 'New':
        return 'In Progress'
      case 'In Progress':
      case 'Contacted':
        return 'Resolved'
      case 'Resolved':
      case 'Converted':
        return 'Closed'
      default:
        return null
    }
  })()

  return (
    <div style={{ padding: embedded ? 0 : '24px' }}>
      {!embedded && (
      <Row
        justify='space-between'
        align='middle'
        style={{ marginBottom: 24 }}
      >
        <Col>
          <Space direction='vertical' size='small'>
            <Title level={3} style={{ margin: 0 }}>
              Inquiry Details
              {inquiry.priority === 'Urgent' && (
                <Tag color='red' style={{ marginLeft: '8px' }}>
                  URGENT
                </Tag>
              )}
            </Title>
            <Text type='secondary'>
              Made By | {inquiry.contactInfo?.firstName || 'N/A'}{' '}
              {inquiry.contactInfo?.lastName || 'N/A'}
            </Text>
          </Space>
        </Col>
      </Row>
      )}

      <Segmented
        block
        value={activeSection}
        onChange={value => setActiveSection(String(value))}
        options={tabItems.map(item => ({ label: item.label, value: item.key }))}
      />
      <div style={{ marginTop: 20 }}>
        {tabItems.find(item => item.key === activeSection)?.children}
      </div>

      {(nextStatus || onEdit) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${nextStatus && onEdit ? 2 : 1}, minmax(0, 1fr))`,
            gap: 12,
            marginTop: 20
          }}
        >
          {nextStatus && (
            <Button
              block
              size='large'
              type='primary'
              loading={statusUpdating}
              onClick={() => updateStatus(nextStatus)}
            >
              {nextStatus === 'In Progress'
                ? 'Move to In Progress'
                : nextStatus === 'Resolved'
                  ? 'Mark as Resolved'
                  : 'Close Inquiry'}
            </Button>
          )}
          {onEdit && (
            <Button
              block
              size='large'
              type='default'
              icon={<EditOutlined />}
              onClick={onEdit}
            >
              Edit
            </Button>
          )}
        </div>
      )}

      {/* Communication Modal */}
      <Modal
        title='Add Communication'
        open={showCommunicationModal}
        onCancel={() => setShowCommunicationModal(false)}
        footer={null}
        width={600}
      >
        <Form
          form={communicationForm}
          layout='vertical'
          onFinish={addCommunication}
        >
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                label='Subject'
                name='subject'
                rules={[{ required: true, message: 'Please enter a subject' }]}
              >
                <Input placeholder='Email subject' />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label='Internal Communication'
                name='isInternal'
                valuePropName='checked'
              >
                <Checkbox>Mark as internal note (not visible to SMEs)</Checkbox>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label='Content'
            name='content'
            rules={[
              {
                required: true,
                message: 'Please enter the communication content'
              }
            ]}
          >
            <TextArea rows={6} placeholder='Enter your message here...' />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Button block size='large' onClick={() => setShowCommunicationModal(false)}>
                Cancel
              </Button>
              <Button block size='large' type='primary' htmlType='submit' icon={<SendOutlined />}>
                Send Communication
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>

      {/* Quick Response Modal */}
      <Modal
        title='Quick Response'
        open={showQuickResponseModal}
        onCancel={() => setShowQuickResponseModal(false)}
        footer={null}
        width={700}
      >
        <Form
          form={quickResponseForm}
          layout='vertical'
          onFinish={handleQuickResponse}
        >
          <Form.Item label='Template' name='template'>
            <Select
              placeholder='Choose a template or write custom message'
              onChange={value => {
                const template = QUICK_RESPONSE_TEMPLATES.find(
                  t => t.id === value
                )
                if (template) {
                  quickResponseForm.setFieldsValue({
                    subject: template.subject,
                    content: template.content
                  })
                }
              }}
            >
              {QUICK_RESPONSE_TEMPLATES.map(template => (
                <Option key={template.id} value={template.id}>
                  {template.title}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label='Subject'
            name='subject'
            rules={[{ required: true, message: 'Please enter a subject' }]}
          >
            <Input placeholder='Email subject' />
          </Form.Item>

          <Form.Item
            label='Content'
            name='content'
            rules={[
              { required: true, message: 'Please enter the message content' }
            ]}
          >
            <TextArea
              rows={8}
              placeholder='Your message will automatically replace template variables like {{firstName}}, {{inquiryType}}, etc.'
            />
          </Form.Item>

          <div
            style={{
              padding: '10px 12px',
              marginBottom: 16,
              borderRadius: 8,
              background: '#f5f5f5',
              color: '#595959'
            }}
          >
            Available variables: {'{{firstName}}'}, {'{{inquiryType}}'},{' '}
            {'{{submittedDate}}'}, {'{{senderName}}'}
          </div>

          <Form.Item style={{ marginBottom: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Button block size='large' onClick={() => setShowQuickResponseModal(false)}>
                Cancel
              </Button>
              <Button block size='large' type='primary' htmlType='submit' icon={<SendOutlined />}>
                Send Quick Response
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default InquiryDetail
