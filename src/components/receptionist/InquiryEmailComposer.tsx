import React, { useState } from 'react'
import { Button, Col, Form, Input, Modal, Row, Segmented, Select, message } from 'antd'
import { EditOutlined, EyeOutlined, SendOutlined } from '@ant-design/icons'
import { format } from 'date-fns'
import { inquiryService } from '@/services/inquiryService'
import type { Inquiry, CommunicationEntry } from '@/types/inquiry'
import { auth } from '@/firebase'
import { functionsBaseUrl } from '@/firebaseConfig'

/*
 * Email the SME about an inquiry: response templates, a preview that shows
 * exactly what is sent, and a referral that also emails (and notifies) a
 * specialist. Moved out of InquiryDetail unchanged in behaviour; the sender's
 * real name and role are now recorded on the communication.
 */

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

export type ComposerSender = { uid: string; name: string; role: string }

const InquiryEmailComposer: React.FC<{
  inquiry: Inquiry
  inquiryId: string
  open: boolean
  sender: ComposerSender
  onClose: () => void
  onSent: () => void
}> = ({ inquiry, inquiryId, open, sender, onClose, onSent }) => {
  const [communicationForm] = Form.useForm()
  const [composeView, setComposeView] = useState<'write' | 'preview'>('write')
  const [sending, setSending] = useState(false)
  const watchedSubject: string = Form.useWatch('subject', communicationForm) || ''
  const watchedContent: string = Form.useWatch('content', communicationForm) || ''
  const watchedResponse: string = Form.useWatch('response', communicationForm) || 'custom'
  const specialistName: string = Form.useWatch('specialistName', communicationForm) || ''
  const specialistEmail: string = Form.useWatch('specialistEmail', communicationForm) || ''
  const isReferral = watchedResponse === 'referral'
  const user = { uid: sender.uid, name: sender.name, displayName: sender.name }
  const setShowCommunicationModal = (value: boolean) => { if (!value) onClose() }
  const loadInquiry = async () => onSent()

  const sendInquiryEmail = async (subject: string, content: string) => {
    const to = inquiry?.contactInfo.email?.trim()
    if (!to) {
      throw new Error('This inquiry does not have a contact email address.')
    }
    const idToken = await auth.currentUser?.getIdToken()
    if (!idToken) throw new Error('You must be signed in to send email.')
    const response = await fetch(
      `${functionsBaseUrl}/sendEmail`,
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
      `${functionsBaseUrl}/notifyInquirySpecialist`,
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

    setSending(true)
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
        sentByName: sender.name,
        sentByRole: sender.role,
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
            sentByName: sender.name,
            sentByRole: sender.role,
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
      message.error(error instanceof Error && error.message.includes('email') ? error.message : 'Could not send the email.')
    } finally {
      setSending(false)
    }
  }

  return (
      <Modal
        title='Email the SME'
        open={open}
        destroyOnClose
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
              <Button shape='round' block size='large' type='primary' htmlType='submit' icon={<SendOutlined />} loading={sending}>
                Send email
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
  )
}

export default InquiryEmailComposer
