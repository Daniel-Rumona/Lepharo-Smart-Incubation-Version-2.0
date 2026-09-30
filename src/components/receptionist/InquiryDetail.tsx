import React, { useState, useEffect, useRef } from 'react'
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
  Grid,
  message,
  Modal,
  Spin,
  Tooltip
} from 'antd'
import {
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  EditOutlined,
  MessageOutlined,
  FileTextOutlined,
  EyeOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  SendOutlined
} from '@ant-design/icons'
import '@/styles/nav-segmented.css'
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
import {
  channelLabel,
  resolveInquiryAudience,
  resolveInquiryChannel
} from '@/utils/inquirySource'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input
const { Option } = Select

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Every email leaves the platform as this sender.
const SUPPORT_SENDER = 'Lepharo Smart Incubation Support'

// Response templates for Add Communication. "Custom" starts from a blank message.
const CUSTOM_RESPONSE = 'custom'
const RESPONSE_TEMPLATES = [
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
Lepharo Smart Incubation Support`
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
Lepharo Smart Incubation Support`
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
Lepharo Smart Incubation Support`
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
Lepharo Smart Incubation Support`
  },
  {
    id: 'referral',
    title: 'Referral to Specialist',
    subject: 'Connecting you with our specialist',
    content: `Dear {{firstName}},

Thank you for your inquiry about {{inquiryType}}.

Based on your specific requirements, I'm connecting you with our specialist who has extensive experience in this area. They will be able to provide you with detailed insights and tailored solutions.

{{specialistName}} ({{specialistEmail}}) will reach out to you within the next 24 hours to schedule a consultation.

If you have any immediate questions, please don't hesitate to contact me.

Best regards,
{{senderName}}
Lepharo Smart Incubation Support`
  }
]

/** The next step for an inquiry, so a page can show its button (e.g. in its own header). */
export type InquiryStatusAction = {
  status: InquiryStatus
  label: string
  loading: boolean
  run: () => void
}

const nextStatusFor = (status?: InquiryStatus): InquiryStatus | null => {
  switch (status) {
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
}

const statusActionLabel = (next: InquiryStatus) =>
  next === 'In Progress' ? 'Move to In Progress' : next === 'Resolved' ? 'Mark as Resolved' : 'Close Inquiry'

interface InquiryDetailProps {
  inquiryId: string
  onEdit?: () => void
  embedded?: boolean
  /**
   * When given, the page owns the status and edit buttons (in its header): the next status is
   * reported here and the buttons at the bottom of the details are not shown.
   */
  onStatusAction?: (action: InquiryStatusAction | null) => void
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
  embedded = false,
  onStatusAction
}) => {
  const [inquiry, setInquiry] = useState<Inquiry | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [showCommunicationModal, setShowCommunicationModal] = useState(false)
  const [communicationForm] = Form.useForm()
  const [composeView, setComposeView] = useState<'write' | 'preview'>('write')
  const isMobile = !Grid.useBreakpoint().md
  const watchedSubject: string = Form.useWatch('subject', communicationForm) || ''
  const watchedContent: string = Form.useWatch('content', communicationForm) || ''
  const watchedResponse: string = Form.useWatch('response', communicationForm) || 'custom'
  const specialistName: string = Form.useWatch('specialistName', communicationForm) || ''
  const specialistEmail: string = Form.useWatch('specialistEmail', communicationForm) || ''
  const isReferral = watchedResponse === 'referral'
  const updateStatusRef = useRef<(status: InquiryStatus) => void>(() => {})

  useEffect(() => {
    if (!onStatusAction) return
    const next = nextStatusFor(inquiry?.status)
    onStatusAction(
      next
        ? {
            status: next,
            label: statusActionLabel(next),
            loading: statusUpdating,
            run: () => updateStatusRef.current(next)
          }
        : null
    )
  }, [inquiry?.status, statusUpdating, onStatusAction])

  useEffect(() => () => onStatusAction?.(null), [onStatusAction])
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
  updateStatusRef.current = updateStatus

  // Replaces {{firstName}}, {{inquiryType}}, {{submittedDate}} and {{senderName}} in a response.
  const fillTemplate = (text: string) => {
    if (!inquiry) return text
    return text
      .replace(/\{\{firstName\}\}/g, inquiry.contactInfo.firstName)
      .replace(/\{\{inquiryType\}\}/g, inquiry.inquiryDetails.inquiryType)
      .replace(/\{\{submittedDate\}\}/g, format(inquiry.submittedAt, 'PPP'))
      .replace(/\{\{senderName\}\}/g, user?.name || user?.displayName || 'Team Member')
      .replace(/\{\{specialistName\}\}/g, specialistName.trim() || '{{specialistName}}')
      .replace(/\{\{specialistEmail\}\}/g, specialistEmail.trim() || '{{specialistEmail}}')
  }

  // {{variables}} nobody fills and [bracketed] prompts in a template are for the sender to complete.
  const PLACEHOLDER = /(\{\{[^}]+\}\}|\[[^\]\n]+\])/g
  const unresolvedIn = (text: string) => text.match(PLACEHOLDER) || []

  const renderWithHighlights = (text: string) =>
    text.split(PLACEHOLDER).map((part, index) =>
      index % 2 === 1 ? (
        <mark key={index} style={{ background: '#fff1b8', color: '#ad6800', padding: '0 3px', borderRadius: 3 }}>
          {part}
        </mark>
      ) : (
        <React.Fragment key={index}>{part}</React.Fragment>
      )
    )

  // What the specialist is emailed (the same text is previewed and sent).
  const specialistEmailContent = () => {
    if (!inquiry) return { subject: '', text: '' }
    const contact = inquiry.contactInfo
    const who = contact.company || `${contact.firstName} ${contact.lastName}`.trim()
    const sender = user?.name || user?.displayName || 'A colleague'
    return {
      subject: `Inquiry referred to you: ${inquiry.inquiryDetails.inquiryType} - ${who}`,
      text: [
        `Dear ${specialistName.trim() || '{{specialistName}}'},`,
        '',
        `${sender} has referred an inquiry to you and told the SME to expect your contact within 24 hours.`,
        '',
        `SME: ${who}`,
        `Contact: ${`${contact.firstName} ${contact.lastName}`.trim()}${contact.email ? ` - ${contact.email}` : ''}${contact.phone ? ` - ${contact.phone}` : ''}`,
        `Inquiry type: ${inquiry.inquiryDetails.inquiryType}`,
        `Submitted: ${format(inquiry.submittedAt, 'PPP')}`,
        inquiry.inquiryDetails.description ? `\nWhat they asked:\n${inquiry.inquiryDetails.description}` : '',
        '',
        'Please reach out to them and update the team on the outcome.',
        '',
        'Best regards,',
        SUPPORT_SENDER
      ].join('\n')
    }
  }

  const notifySpecialist = async () => {
    const { subject, text } = specialistEmailContent()
    const idToken = await auth.currentUser?.getIdToken()
    if (!idToken) throw new Error('You must be signed in to send email.')
    const response = await fetch(
      'https://us-central1-lph-smart-inc.cloudfunctions.net/notifyInquirySpecialist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          inquiryId,
          specialistName: specialistName.trim(),
          specialistEmail: specialistEmail.trim(),
          subject,
          text
        })
      }
    )
    if (!response.ok) throw new Error('The specialist could not be notified.')
    return (await response.json()) as { notified?: boolean }
  }

  const chooseResponse = (id: string) => {
    if (id === CUSTOM_RESPONSE) {
      communicationForm.setFieldsValue({ subject: '', content: '' })
      return
    }
    const template = RESPONSE_TEMPLATES.find(item => item.id === id)
    if (template) {
      communicationForm.setFieldsValue({ subject: template.subject, content: template.content })
    }
  }

  const addCommunication = async (values: any) => {
    if (!inquiry) return

    try {
      const content = fillTemplate(values.content)

      const pending = [
        ...unresolvedIn(values.subject || ''),
        ...unresolvedIn(content),
        ...(isReferral ? unresolvedIn(specialistEmailContent().text) : [])
      ]
      if (pending.length) {
        setComposeView('preview')
        message.error(`Fill in ${Array.from(new Set(pending)).join(', ')} before sending.`)
        return
      }

      await sendInquiryEmail(values.subject, content)

      const communicationEntry: Omit<CommunicationEntry, 'id'> = {
        type: 'response',
        message: `Subject: ${values.subject}\n\n${content}`,
        sentAt: new Date(),
        sentBy: user?.uid || 'system',
        sentByName: user?.displayName || 'System',
        sentByRole: 'receptionist',
        isInternal: false
      }

      await inquiryService.addCommunication(inquiryId, communicationEntry)

      let specialistNote = ''
      if (isReferral) {
        try {
          const result = await notifySpecialist()
          await inquiryService.addCommunication(inquiryId, {
            type: 'response',
            message: `Referred to ${specialistName.trim()} <${specialistEmail.trim()}>. They were emailed${result.notified ? ' and notified in the system' : ''}.`,
            sentBy: user?.uid || 'system',
            sentByName: user?.displayName || 'System',
            sentByRole: 'receptionist',
            isInternal: true
          })
          specialistNote = result.notified
            ? ` ${specialistName.trim()} was emailed and notified in the system.`
            : ` ${specialistName.trim()} was emailed (no system account found for that address, so no in-app notification).`
        } catch (referralError) {
          console.error('Specialist notification failed', referralError)
          message.warning('The SME was emailed, but the specialist could not be notified. Please contact them directly.')
        }
      }

      await loadInquiry() // Reload to show the new communication
      setShowCommunicationModal(false)
      setComposeView('write')
      communicationForm.resetFields()
      message.success(`Email sent and communication logged successfully.${specialistNote}`)
    } catch (error) {
      console.error('Error adding communication:', error)
      message.error('Failed to add communication')
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
      icon: <FileTextOutlined />,
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
                    {resolveInquiryAudience(inquiry as any) === 'Incubatee' && (
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
                  <Tag>{channelLabel(resolveInquiryChannel(inquiry.source))}</Tag>
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
      icon: <MessageOutlined />,
      label: `Communications ${
        inquiry.communications && Array.isArray(inquiry.communications)
          ? `(${inquiry.communications.length})`
          : '(0)'
      }`,
      children: (
        <div>
          <Button
            shape='round'
            block
            size='large'
            type='primary'
            icon={<PlusOutlined />}
            onClick={() => setShowCommunicationModal(true)}
            style={{ marginBottom: 16 }}
          >
            Add Communication
          </Button>

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
                          {comm.isInternal ? '' : `From: ${SUPPORT_SENDER} · `}
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

  const nextStatus = nextStatusFor(inquiry.status)

  return (
    <div style={{ padding: embedded ? 0 : '24px' }}>
      <Row
        justify='space-between'
        align='middle'
        gutter={[16, 12]}
        style={{ marginBottom: 20, paddingRight: embedded ? 36 : 0 }}
      >
        <Col flex='auto' style={{ textAlign: isMobile ? 'center' : 'left' }}>
          <Space direction='vertical' size='small' align={isMobile ? 'center' : 'start'} style={{ width: '100%' }}>
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
        <Col xs={24} md={{ flex: '0 0 400px' }}>
          <Segmented
            block
            className='nav-pill-segmented'
            value={activeSection}
            onChange={value => setActiveSection(String(value))}
            options={tabItems.map(item => ({
              label: item.label,
              value: item.key,
              icon: item.icon
            }))}
          />
        </Col>
      </Row>

      <div style={{ marginTop: 20 }}>
        {tabItems.find(item => item.key === activeSection)?.children}
      </div>

      {!onStatusAction && (nextStatus || onEdit) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${nextStatus && onEdit ? 2 : 1}, minmax(0, 1fr))`,
            gap: 12,
            marginTop: 20
          }}
        >
          {nextStatus && (
            <Button shape='round'
              block
              size='large'
              type='primary'
              loading={statusUpdating}
              onClick={() => updateStatus(nextStatus)}
            >
              {statusActionLabel(nextStatus)}
            </Button>
          )}
          {onEdit && (
            <Button shape='round'
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
        onCancel={() => {
          setShowCommunicationModal(false)
          setComposeView('write')
        }}
        footer={null}
        width={640}
      >
        <Form
          form={communicationForm}
          layout='vertical'
          onFinish={addCommunication}
          initialValues={{ response: CUSTOM_RESPONSE }}
        >
          <Form.Item label='Response' name='response'>
            <Select onChange={chooseResponse}>
              {RESPONSE_TEMPLATES.map(template => (
                <Option key={template.id} value={template.id}>
                  {template.title}
                </Option>
              ))}
              <Option value={CUSTOM_RESPONSE}>Custom</Option>
            </Select>
          </Form.Item>

          <Segmented
            block
            className='nav-pill-segmented'
            value={composeView}
            onChange={value => setComposeView(value as 'write' | 'preview')}
            options={[
              { label: 'Write', value: 'write', icon: <EditOutlined /> },
              { label: 'Preview', value: 'preview', icon: <EyeOutlined /> }
            ]}
            style={{ marginBottom: 16 }}
          />

          <div style={{ display: composeView === 'preview' ? 'block' : 'none' }}>
            {(() => {
              const previewContent = fillTemplate(watchedContent)
              const specialistMail = specialistEmailContent()
              const pending = Array.from(
                new Set([
                  ...unresolvedIn(watchedSubject),
                  ...unresolvedIn(previewContent),
                  ...(isReferral ? unresolvedIn(specialistMail.text) : [])
                ])
              )
              const mailCard = (to: string, subject: string, body: string) => (
                <div
                  style={{
                    border: '1px solid rgba(128,128,128,0.35)',
                    borderRadius: 10,
                    overflow: 'hidden',
                    marginBottom: 12
                  }}
                >
                  <div style={{ padding: '10px 14px', background: 'rgba(128,128,128,0.10)', fontSize: 13 }}>
                    <div><b>From:</b> {SUPPORT_SENDER}</div>
                    <div><b>To:</b> {to || 'No email address'}</div>
                    <div><b>Subject:</b> {subject ? renderWithHighlights(subject) : '—'}</div>
                  </div>
                  <div
                    style={{
                      padding: '14px',
                      fontFamily: 'Arial, sans-serif',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      minHeight: 100
                    }}
                  >
                    {body ? renderWithHighlights(body) : 'Nothing written yet.'}
                  </div>
                </div>
              )
              return (
                <>
                  {isReferral && <div style={{ fontWeight: 600, marginBottom: 6 }}>Email to the SME</div>}
                  {mailCard(inquiry?.contactInfo.email || '', watchedSubject, previewContent)}
                  {isReferral && (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>
                        Email to the specialist
                        <span style={{ fontWeight: 400, opacity: 0.65 }}>
                          {' '}
                          - they also get a notification in the system if they have an account
                        </span>
                      </div>
                      {mailCard(specialistEmail, specialistMail.subject, specialistMail.text)}
                    </>
                  )}
                  {pending.length > 0 && (
                    <div style={{ padding: '10px 12px', marginBottom: 16, borderRadius: 8, background: '#fff1b8', color: '#ad6800', fontSize: 12 }}>
                      Still to fill in before this can be sent: {pending.join(', ')}. Go back to Write and replace them.
                    </div>
                  )}
                </>
              )
            })()}
          </div>

          <div style={{ display: composeView === 'write' ? 'block' : 'none' }}>
          {isReferral && (
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label='Specialist name'
                  name='specialistName'
                  rules={[{ required: true, message: "Enter the specialist's name" }]}
                >
                  <Input placeholder='Who will reach out' />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label='Specialist email'
                  name='specialistEmail'
                  rules={[
                    { required: true, message: "Enter the specialist's email" },
                    { type: 'email', message: 'Enter a valid email address' }
                  ]}
                >
                  <Input placeholder='name@example.com' />
                </Form.Item>
              </Col>
            </Row>
          )}

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
              {
                required: true,
                message: 'Please enter the communication content'
              }
            ]}
          >
            <TextArea
              rows={8}
              placeholder='Enter your message here. {{firstName}}, {{inquiryType}}, {{submittedDate}} and {{senderName}} are filled in when it is sent.'
            />
          </Form.Item>

          <div
            style={{
              padding: '10px 12px',
              marginBottom: 16,
              borderRadius: 8,
              background: 'rgba(128, 128, 128, 0.12)',
              fontSize: 12
            }}
          >
            Emails are sent from {SUPPORT_SENDER}. For a referral, the specialist is also emailed and notified in the system. Filled in automatically: {'{{firstName}}'},{' '}
            {'{{inquiryType}}'} and {'{{submittedDate}}'} from this inquiry, and {'{{senderName}}'} from
            your profile. Anything in [square brackets] is for you to complete. Use Preview to check.
          </div>
          </div>

          <Form.Item style={{ marginBottom: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Button
                shape='round'
                block
                size='large'
                onClick={() => {
                  setShowCommunicationModal(false)
                  setComposeView('write')
                }}
              >
                Cancel
              </Button>
              <Button shape='round' block size='large' type='primary' htmlType='submit' icon={<SendOutlined />}>
                Send Communication
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default InquiryDetail
