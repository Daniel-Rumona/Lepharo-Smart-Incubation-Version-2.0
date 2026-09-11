// src/components/modals/EmailTemplateModal.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Form,
  Select,
  Input,
  Alert,
  Space,
  Button,
  message,
  Typography,
  Popover,
  Tag
} from 'antd'
import { SendOutlined, EyeOutlined, MailOutlined } from '@ant-design/icons'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

import { QUICK_RESPONSE_TEMPLATES } from '@/utils/templates'
import { compileTemplate, Template } from '@/utils/emailService'
import { Links } from '@/utils/linkHelpers'

const { Option } = Select
const { TextArea } = Input
const { Text } = Typography

export type AllowedVars = {
  firstName?: string
  programName?: string
  cohortName?: string
  startDate?: string
  nextSteps?: string
  dueDate?: string
  assignedBy?: string
  // Lists (used to render bullets in templates):
  documents?: string[]
  requested?: string[]
}

type Props = {
  open: boolean
  onClose: () => void
  toEmail: string | string[]
  templateId?: string
  allowedTemplateIds?: string[]
  getIdToken: () => Promise<string>
  sendEndpoint?: string
  defaultVars?: Partial<AllowedVars>
}

export default function EmailTemplateModal ({
  open,
  onClose,
  toEmail,
  templateId,
  allowedTemplateIds,
  getIdToken,
  sendEndpoint = 'https://oauth.lepharosmartinc.co.za/sendEmail',
  defaultVars = {}
}: Props) {
  const [form] = Form.useForm()
  const [preview, setPreview] = useState(false)
  const [sending, setSending] = useState(false)

  const watchedTemplateId = Form.useWatch('template', form)

  const availableTemplates = useMemo(() => {
    if (!allowedTemplateIds?.length) return QUICK_RESPONSE_TEMPLATES
    const allowed = new Set(allowedTemplateIds)
    return QUICK_RESPONSE_TEMPLATES.filter(template => allowed.has(template.id))
  }, [allowedTemplateIds])

  // Use the passed templateId if provided; else fall back to the form-selected value
  const activeTemplateId = templateId ?? watchedTemplateId

  const template = useMemo<Template | undefined>(() => {
    return availableTemplates.find(t => t.id === activeTemplateId)
  }, [activeTemplateId, availableTemplates])

  // Friendly labels for variables shown in the "Insert variable" dropdown
  const FRIENDLY_VAR_LABELS: Record<string, string> = {
    firstName: 'First Name',
    programName: 'Program Name',
    cohortName: 'Cohort Name',
    startDate: 'Start Date',
    nextSteps: 'Next Steps',
    dueDate: 'Due Date',
    assignedBy: 'Assigned By',
    bulletList: 'Documents List',
    requestedList: 'Requested Evidence List'
  }

  // Friendly link chips (these map to your helper Links.*())
  const FRIENDLY_LINKS = [
    { key: 'incubatee', label: 'Incubatee Home', path: '/incubatee' },
    {
      key: 'signedDocs',
      label: 'Signed Documents',
      path: '/incubatee/documents/compliance'
    },
    {
      key: 'docsHub',
      label: 'Compliance Hub',
      path: '/incubatee/documents/hub'
    },
    {
      key: 'interventions',
      label: 'Interventions',
      path: '/consultant/allocated'
    }
  ] as const

  // Build runtime variables including deep links and derived lists
  const runtimeVars = useMemo(() => {
    const bulletList = (defaultVars.documents || []).length
      ? (defaultVars.documents || []).map(d => `- ${d}`).join('\n')
      : '- —'

    const requestedList = (defaultVars.requested || []).length
      ? (defaultVars.requested || []).map(x => `- ${x}`).join('\n')
      : '- —'

    return {
      ...defaultVars,
      bulletList,
      requestedList,
      links: {
        incubatee: Links.incubatee(),
        signedDocs: Links.signedDocs(),
        docsHub: Links.docsHub(),
        interventions: Links.interventions()
      }
    }
  }, [defaultVars])

  const onTemplateChange = (id?: string) => {
    const t = availableTemplates.find(x => x.id === id)
    if (!t) return
    form.setFieldsValue({
      subject: t.subject,
      content: t.md
    })
  }

  // When a template is passed in props (or changes), prefill form and lock the picker
  useEffect(() => {
    if (!open) return
    if (templateId) {
      const t = availableTemplates.find(x => x.id === templateId)
      if (t) {
        form.setFieldsValue({
          template: t.id,
          subject: t.subject,
          content: t.md
        })
      }
    }
  }, [open, templateId, form, availableTemplates])

  const handleSend = async (values: {
    template?: string
    subject: string
    content: string
  }) => {
    try {
      // Prefer prop templateId; else use the form-selected template
      const chosenId = templateId ?? values.template
      const t = availableTemplates.find(x => x.id === chosenId)
      if (!t) throw new Error('Choose a template')

      // Compile using current editor content (user can tweak before sending)
      const tmp: Template = {
        ...t,
        subject: values.subject,
        md: values.content,
        vars: t.vars
      }
      const { subject, html, text } = compileTemplate(tmp, runtimeVars)

      setSending(true)

      const idToken = await getIdToken()
      const res = await fetch(sendEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ to: toEmail, subject, html, text })
      })

      if (!res.ok) {
        let detail = 'send_failed'
        try {
          const data = await res.json()
          detail = data?.error || data?.detail || detail
        } catch {
          try {
            detail = await res.text()
          } catch {}
        }
        throw new Error(detail)
      }

      message.success(
        Array.isArray(toEmail)
          ? `Email sent to ${toEmail.length} recipient(s).`
          : `Email sent to ${toEmail}.`
      )
      form.resetFields()
      setPreview(false)
      onClose()
    } catch (err: any) {
      message.error(`Failed to send: ${err?.message || 'Unknown error'}`)
    } finally {
      setSending(false)
    }
  }

  const renderPreview = () => {
    const content: string = form.getFieldValue('content') || ''
    const md = content.replace(/\r/g, '')
    const html = marked.parse(md) as string
    return (
      <div
        style={{
          border: '1px solid #eee',
          padding: 12,
          borderRadius: 6,
          maxHeight: 360,
          overflow: 'auto'
        }}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      />
    )
  }

  // helper to normalize recipients into an array for display
  const asArray = (v: string | string[]) => (Array.isArray(v) ? v : [v])

  const RecipientsPopoverContent: React.FC<{ items: string[] }> = ({
    items
  }) => (
    <div style={{ maxHeight: 220, overflow: 'auto', minWidth: 300 }}>
      {items.map(e => (
        <div key={e} style={{ marginBottom: 6 }}>
          <Tag style={{ marginRight: 0 }}>{e}</Tag>
        </div>
      ))}
    </div>
  )

  const recipientCount = Array.isArray(toEmail) ? toEmail.length : 1
  const recipientArray = asArray(toEmail)

  const modalTitle = (
    <Space wrap>
      <MailOutlined />
      <span>Send Email</span>
      <Text type='secondary'>
        • To: <Text strong>{recipientCount}</Text> recipient
        {recipientCount > 1 ? 's' : ''}
      </Text>
      <Popover
        placement='bottomLeft'
        title={`${recipientCount} recipient${recipientCount > 1 ? 's' : ''}`}
        content={<RecipientsPopoverContent items={recipientArray} />}
        trigger='click'
      >
        <Button size='small' type='link'>
          View recipients
        </Button>
      </Popover>
    </Space>
  )

  const variableOptions = (template?.vars || []).map(v => ({
    label: `${FRIENDLY_VAR_LABELS[v] || v} ({{${v}}})`,
    value: v
  }))

  const linkOptions = FRIENDLY_LINKS.map(l => ({
    label: `${l.label} (${l.path})`,
    value: l.key
  }))

  const showPicker = !templateId || !template // only show if not locked or invalid id

  return (
    <Modal
      title={modalTitle}
      open={open}
      onCancel={() => {
        if (!sending) onClose()
      }}
      footer={null}
      width={780}
      destroyOnClose
    >
      <Form
        form={form}
        layout='vertical'
        onFinish={handleSend}
        disabled={sending}
      >
        <Form.Item
          label='Template'
          name='template'
          rules={
            showPicker ? [{ required: true, message: 'Pick a template' }] : []
          }
        >
          <Select
            placeholder='Choose a template'
            onChange={onTemplateChange}
            allowClear={showPicker}
            showSearch
            optionFilterProp='label'
            disabled={!showPicker}
          >
            {availableTemplates.map(t => (
              <Option key={t.id} value={t.id} label={t.title}>
                {t.title}
              </Option>
            ))}
          </Select>
        </Form.Item>

        {!showPicker && template && (
          <Alert
            type='info'
            message={`Using locked template: ${template.title}`}
            showIcon
            style={{ marginBottom: 12 }}
          />
        )}

        <Form.Item
          label='Subject'
          name='subject'
          rules={[{ required: true, message: 'Please enter a subject' }]}
        >
          <Input placeholder='Email subject (you can keep {{variables}} here)' />
        </Form.Item>

        <Form.Item
          label='Message (Markdown)'
          name='content'
          rules={[
            { required: true, message: 'Please enter the message content' }
          ]}
        >
          <TextArea
            rows={10}
            placeholder='Type your message. Use the friendly “Insert variable” and “Insert link” to add placeholders.'
          />
        </Form.Item>

        {/* Insert helpers */}
        <Space style={{ marginBottom: 8 }} wrap>
          <Select
            style={{ width: 300 }}
            placeholder='Insert variable (e.g., First Name)'
            onChange={v => {
              const cur = form.getFieldValue('content') || ''
              form.setFieldsValue({
                content: cur + (cur.endsWith(' ') ? '' : ' ') + `{{${v}}}`
              })
            }}
            disabled={!template}
            options={variableOptions}
            showSearch
            optionFilterProp='label'
          />
          <Select
            style={{ width: 360 }}
            placeholder='Insert link (deep link to the system)'
            onChange={v => {
              const cur = form.getFieldValue('content') || ''
              const friendly = FRIENDLY_LINKS.find(x => x.key === v)
              const label = friendly ? friendly.label : v
              form.setFieldsValue({
                content:
                  cur +
                  (cur.endsWith('\n') ? '' : '\n') +
                  `[Open ${label}]({{links.${v}}})`
              })
            }}
            options={linkOptions}
            showSearch
            optionFilterProp='label'
          />
          <Button icon={<EyeOutlined />} onClick={() => setPreview(p => !p)}>
            {preview ? 'Hide Preview' : 'Preview'}
          </Button>
        </Space>

        {preview && renderPreview()}

        <Alert
          type='info'
          showIcon
          style={{ margin: '12px 0 16px' }}
          message='Template variables'
          description={
            template
              ? `Available: ${template.vars
                  .map(v => `${FRIENDLY_VAR_LABELS[v] || v} ({{${v}}})`)
                  .join(', ')}`
              : 'Pick a template to see supported variables.'
          }
        />

        <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 16 }}>
            <Button danger block style={{ flex: 1 }} onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button
              type='primary'
              block
              style={{ flex: 1 }}
              htmlType='submit'
              icon={<SendOutlined />}
              loading={sending}
              disabled={sending}
            >
              {sending ? 'Sending…' : 'Send'}
            </Button>
        </div>
      </Form>
    </Modal>
  )
}
