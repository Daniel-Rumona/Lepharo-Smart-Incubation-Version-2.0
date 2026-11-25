import React, { useEffect, useState } from 'react'
import { Alert, Form, Input, Modal, Segmented, Tag, Typography, message } from 'antd'
import { EditOutlined, EyeOutlined, SendOutlined } from '@ant-design/icons'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase'

/*
 * Email one or more SMEs from the system. Recipients are passed by participantId;
 * the server (functions/src/userMessages.ts) checks the sender's role may email
 * each one, looks up the address and sends with replies going to the sender.
 */

export type MessageRecipient = { participantId: string; name: string }

type SkipReason = 'not_permitted' | 'no_email' | 'failed'
type SendResult = { sent: number; skipped: { participantId: string; name: string; reason: SkipReason }[] }

const SKIP_LABEL: Record<SkipReason, string> = {
    not_permitted: 'not one of your SMEs',
    no_email: 'no email address on record',
    failed: 'the email could not be sent'
}

// Roles that may email SMEs; the server enforces which SMEs each may reach.
export const MESSAGE_SENDER_ROLES = ['system_admin', 'director', 'projectadmin', 'coordinator', 'operations']
export const canSendMessages = (role: unknown) =>
    MESSAGE_SENDER_ROLES.includes(String(role || '').trim().toLowerCase().replace(/\s+/g, '_'))

const SHOWN_RECIPIENTS = 12

type Props = {
    open: boolean
    recipients: MessageRecipient[]
    senderName?: string
    onClose: () => void
}

export const MessageComposer: React.FC<Props> = ({ open, recipients, senderName, onClose }) => {
    const [form] = Form.useForm<{ subject: string; body: string }>()
    const [view, setView] = useState<'write' | 'preview'>('write')
    const [sending, setSending] = useState(false)
    const [result, setResult] = useState<SendResult | null>(null)
    const subject = Form.useWatch('subject', form)
    const body = Form.useWatch('body', form)

    useEffect(() => {
        if (!open) return
        form.resetFields()
        setView('write')
        setResult(null)
    }, [open, form])

    const send = async () => {
        const values = await form.validateFields().catch(() => null)
        if (!values) {
            setView('write')
            return
        }
        setSending(true)
        try {
            const call = httpsCallable<unknown, SendResult>(functions, 'sendUserMessage')
            const { data } = await call({
                participantIds: recipients.map(r => r.participantId),
                subject: values.subject,
                body: values.body
            })
            if (!data.skipped.length) {
                message.success(data.sent === 1 ? 'Message sent.' : `Message sent to ${data.sent} SMEs.`)
                onClose()
                return
            }
            setResult(data)
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'Could not send the message.')
        } finally {
            setSending(false)
        }
    }

    const firstName = recipients.length === 1 ? recipients[0].name : '<SME name>'
    const shown = recipients.slice(0, SHOWN_RECIPIENTS)

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={recipients.length === 1 ? `Message ${recipients[0].name}` : `Message ${recipients.length} SMEs`}
            okText={result ? 'Done' : 'Send'}
            okButtonProps={{ icon: result ? undefined : <SendOutlined />, loading: sending, disabled: !recipients.length }}
            onOk={result ? onClose : send}
            cancelButtonProps={{ style: result ? { display: 'none' } : undefined }}
            width={640}
            destroyOnClose
        >
            {result ? (
                <Alert
                    type={result.sent ? 'warning' : 'error'}
                    showIcon
                    message={`Sent to ${result.sent} of ${recipients.length}.`}
                    description={
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {result.skipped.map(s => <li key={s.participantId}>{s.name}: {SKIP_LABEL[s.reason]}</li>)}
                        </ul>
                    }
                />
            ) : (
                <>
                    <div style={{ marginBottom: 12 }}>
                        <Typography.Text type='secondary'>To: </Typography.Text>
                        {shown.map(r => <Tag key={r.participantId}>{r.name}</Tag>)}
                        {recipients.length > shown.length && <Tag>+{recipients.length - shown.length} more</Tag>}
                    </div>
                    <Segmented
                        value={view}
                        onChange={v => setView(v as 'write' | 'preview')}
                        options={[
                            { label: 'Write', value: 'write', icon: <EditOutlined /> },
                            { label: 'Preview', value: 'preview', icon: <EyeOutlined /> }
                        ]}
                        style={{ marginBottom: 12 }}
                    />
                    <Form form={form} layout='vertical' style={{ display: view === 'write' ? undefined : 'none' }}>
                        <Form.Item name='subject' label='Subject' rules={[{ required: true, whitespace: true, message: 'Add a subject' }, { max: 200 }]}>
                            <Input maxLength={200} />
                        </Form.Item>
                        <Form.Item name='body' label='Message' rules={[{ required: true, whitespace: true, message: 'Write a message' }, { max: 10000 }]}
                            extra='"Dear <name>," and your name and role are added for you. Replies come to your email.'>
                            <Input.TextArea rows={8} maxLength={10000} showCount />
                        </Form.Item>
                    </Form>
                    {view === 'preview' && (
                        <div style={{ border: '1px solid var(--ant-color-border, #e5e7eb)', borderRadius: 8, padding: 16, whiteSpace: 'pre-wrap' }}>
                            <Typography.Text strong>{subject || '(no subject)'}</Typography.Text>
                            <p style={{ marginTop: 12 }}>Dear {firstName},</p>
                            <div>{body || '(no message)'}</div>
                            <p style={{ marginTop: 16 }}>Kind regards,<br />{senderName || 'You'}</p>
                        </div>
                    )}
                </>
            )}
        </Modal>
    )
}

export default MessageComposer
