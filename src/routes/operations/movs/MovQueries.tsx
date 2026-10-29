import React, { useState } from 'react'
import { Alert, Button, Form, Input, Modal, Upload, message } from 'antd'
import { ArrowRightOutlined, CheckOutlined, EditOutlined, FileSearchOutlined, MessageOutlined, PaperClipOutlined, SendOutlined, UploadOutlined } from '@ant-design/icons'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { fmtDate } from './movData'
import { StatusPill } from './movParts'

/**
 * The issue types a HOD can raise. Each has its own prompt for the details
 * and a few common reasons that fill them in, so "Details" reads as part of
 * every choice rather than only "Something else".
 */
const QUERY_TYPES = [
    {
        value: 'poe-request',
        label: 'Evidence (POE)',
        detail: 'Missing, unreadable or the wrong document',
        icon: <FileSearchOutlined />,
        prompt: 'What’s wrong with the evidence?',
        placeholder: 'e.g. The attendance register photo is blank — please re-upload a clear copy.',
        reasons: ['The attendance register is missing.', 'The evidence is unreadable or blank.', 'The wrong document was attached.', 'Signatures are missing from the evidence.']
    },
    {
        value: 'mov-issue',
        label: 'Session details',
        detail: 'Dates, sessions or coverage are incorrect',
        icon: <EditOutlined />,
        prompt: 'Which details are wrong?',
        placeholder: 'e.g. The second session is dated 3 Aug but the register shows 10 Aug.',
        reasons: ['A session date is incorrect.', 'A session is missing from the MOV.', 'The delivery method is wrong.', 'The intervention described doesn’t match what was delivered.']
    },
    {
        value: 'general-query',
        label: 'Something else',
        detail: 'Any other issue with this MOV',
        icon: <MessageOutlined />,
        prompt: 'Describe the issue',
        placeholder: 'Say exactly what the facilitator needs to correct.',
        reasons: [] as string[]
    }
]

/** How a query's type and the people on it are named in the thread. */
const TYPE_LABELS: Record<string, string> = {
    'poe-request': 'Evidence (POE)',
    'mov-issue': 'Session details',
    'general-query': 'Other',
    'delivery-query': 'Delivery dispute',
    'completion-rejected': 'Delivery dispute',
    'cc-poe-query': 'Center Coordinator query',
    'cc-pack-query': 'Pack query',
    'me-query': 'M&E query'
}
const ROLE_LABELS: Record<string, string> = {
    incubatee: 'SME',
    coordinator: 'Facilitator',
    consultant: 'Facilitator',
    operations: 'HOD',
    projectadmin: 'Center Coordinator',
    director: 'Director',
    admin: 'Admin',
    system_admin: 'Admin'
}
const roleLabel = (role?: string | null, isMonitoring = false) => {
    const r = String(role || '').toLowerCase().replace(/\s+/g, '')
    // An operations user in M&E is M&E, not a department HOD.
    if (r === 'operations' && isMonitoring) return 'M&E'
    return ROLE_LABELS[r] || (r ? r.charAt(0).toUpperCase() + r.slice(1) : '')
}
const person = (name?: string | null, role?: string | null, isMonitoring = false) => {
    const label = roleLabel(role, isMonitoring)
    return { name: String(name || '').trim() || label || 'Someone', role: label }
}

/** The query types as selectable cards: every option visible, one click to choose. */
const IssueCards: React.FC<{ value?: string; onChange?: (value: string) => void }> = ({ value, onChange }) => (
    <div className='mv-issue-cards' role='radiogroup' aria-label='What’s the issue?'>
        {QUERY_TYPES.map(t => (
            <button
                key={t.value}
                type='button'
                role='radio'
                aria-checked={value === t.value}
                className={`mv-issue-card${value === t.value ? ' is-selected' : ''}`}
                onClick={() => onChange?.(t.value)}
            >
                <span className='mv-issue-icon' aria-hidden='true'>{t.icon}</span>
                <span className='mv-issue-label'>{t.label}</span>
                <span className='mv-issue-detail'>{t.detail}</span>
            </button>
        ))}
    </div>
)

const isResolved = (q: any) => String(q?.status || 'open').toLowerCase() === 'resolved'

/**
 * Queries on an MOV or pack as a thread: who raised each one and for whom,
 * what it's about, the facilitator's reply and how it was resolved. The
 * person who raised an MOV query can resolve it here; pack queries are read-only.
 */
export const QueryThread: React.FC<{
    queries: any[]
    currentUid?: string
    readOnly?: boolean
    onResolve?: (query: any, notes: string, file: File | null) => Promise<void>
    /** The facilitator answered a query you raised: accept it, or send it back with what's still needed. */
    onAccept?: (query: any) => Promise<void>
    onSendBack?: (query: any, notes: string) => Promise<void>
    /** A query sent to you (the facilitator) that's waiting for your answer. */
    onAnswer?: (query: any) => void
}> = ({ queries, currentUid, readOnly, onResolve, onAccept, onSendBack, onAnswer }) => {
    const [resolvingId, setResolvingId] = useState<string | null>(null)
    const [sendingBackId, setSendingBackId] = useState<string | null>(null)
    const [sendBackNotes, setSendBackNotes] = useState('')
    const [busyId, setBusyId] = useState<string | null>(null)
    const [notes, setNotes] = useState('')
    const [file, setFile] = useState<File | null>(null)
    const [saving, setSaving] = useState(false)

    const { hasRole } = useDepartmentRoles()

    if (!queries.length) return null

    const submit = async (q: any) => {
        if (!notes.trim()) {
            message.warning('Add a note on how it was resolved.')
            return
        }
        setSaving(true)
        try {
            await onResolve?.(q, notes.trim(), file)
            setResolvingId(null)
            setNotes('')
            setFile(null)
        } finally {
            setSaving(false)
        }
    }

    return (
        <ul className='mv-thread'>
            {queries.map(q => {
                const resolved = isResolved(q)
                const answered = String(q.status || '').toLowerCase() === 'answered'
                const files: string[] = Array.isArray(q.attachmentUrls) && q.attachmentUrls.length ? q.attachmentUrls : q.uploadedFileUrl ? [q.uploadedFileUrl] : []
                const mine = String(q.raisedByUser || '') === String(currentUid || '')
                const from = person(mine ? 'You' : q.raisedByName, q.raisedByRole, hasRole(q.raisedBy?.departmentId, 'monitoring'))
                const to = person(q.receivedByName, q.receivedByRole)
                const reply = String(q.consultantResponse || '').trim()
                // resolutionNotes falls back to the reply; don't show the same text twice.
                const resolution = String(q.resolutionNotes || '').trim()
                const resolutionNote = resolution && resolution !== reply ? resolution : ''
                const type = TYPE_LABELS[String(q.queryType || q.type || '')]
                return (
                    <li key={q.id} className={`mv-thread-item${resolved ? ' is-resolved' : ''}`}>
                        <div className='mv-thread-head'>
                            <span className='mv-thread-route'>
                                <span className='mv-thread-who'>{from.name}</span>
                                {from.role && from.name !== from.role && <span className='mv-thread-role'>{from.role}</span>}
                                <ArrowRightOutlined className='mv-thread-arrow' aria-label='to' />
                                <span className='mv-thread-who'>{to.name}</span>
                                {to.role && to.name !== to.role && <span className='mv-thread-role'>{to.role}</span>}
                            </span>
                            <StatusPill tone={resolved ? 'success' : answered ? 'info' : 'warning'}>{resolved ? 'Resolved' : answered ? 'Answered' : 'Open'}</StatusPill>
                        </div>
                        <div className='mv-thread-meta'>
                            {[type, fmtDate(q.createdAt || q.updatedAt)].filter(Boolean).join(' · ')}
                        </div>
                        <p className='mv-thread-text'>{q.queryMessage || q.message || '—'}</p>
                        {reply && (
                            <div className='mv-thread-reply'>
                                <span className='mv-thread-reply-who'>{person(q.repliedByName || q.receivedByName, q.repliedByRole || q.receivedByRole).name} replied</span>
                                {q.noNewEvidence && <span className='mv-thread-role'>No new evidence</span>}
                                <span>{reply}</span>
                                {files.map((url, i) => (
                                    <Button key={url} size='small' type='link' icon={<PaperClipOutlined />} onClick={() => window.open(url, '_blank', 'noopener')}>
                                        {files.length > 1 ? `Evidence ${i + 1}` : 'Evidence'}
                                    </Button>
                                ))}
                            </div>
                        )}
                        {q.sentBackNotes && !resolved && (
                            <div className='mv-thread-reply'>
                                <span className='mv-thread-reply-who'>Sent back</span>
                                <span>{q.sentBackNotes}</span>
                            </div>
                        )}
                        {resolutionNote && (
                            <div className='mv-thread-reply'>
                                <span className='mv-thread-reply-who'>Resolved</span>
                                <span>{resolutionNote}</span>
                            </div>
                        )}
                        {/* Sent to you and waiting for your answer. */}
                        {onAnswer && !resolved && !answered && String(q.resolverId || '') === String(currentUid || '') && (
                            <div className='mv-thread-decide'>
                                <Button size='small' type='primary' icon={<SendOutlined />} onClick={() => onAnswer(q)}>
                                    Answer
                                </Button>
                            </div>
                        )}
                        {/* The facilitator answered your query: you decide. */}
                        {!readOnly && answered && mine && onAccept && onSendBack && (
                            sendingBackId === q.id ? (
                                <div className='mv-thread-resolve'>
                                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} value={sendBackNotes} onChange={e => setSendBackNotes(e.target.value)} placeholder='What is still needed?' />
                                    <div className='mv-thread-resolve-actions'>
                                        <Button onClick={() => setSendingBackId(null)} disabled={busyId === q.id}>Cancel</Button>
                                        <Button
                                            danger
                                            loading={busyId === q.id}
                                            onClick={async () => {
                                                if (!sendBackNotes.trim()) return message.warning('Say what is still needed.')
                                                setBusyId(q.id)
                                                try {
                                                    await onSendBack(q, sendBackNotes.trim())
                                                    setSendingBackId(null)
                                                    setSendBackNotes('')
                                                } finally {
                                                    setBusyId(null)
                                                }
                                            }}
                                        >
                                            Send back
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className='mv-thread-decide'>
                                    <Button
                                        size='small'
                                        type='primary'
                                        icon={<CheckOutlined />}
                                        loading={busyId === q.id}
                                        onClick={async () => {
                                            setBusyId(q.id)
                                            try {
                                                await onAccept(q)
                                            } finally {
                                                setBusyId(null)
                                            }
                                        }}
                                    >
                                        Accept answer
                                    </Button>
                                    <Button size='small' onClick={() => { setSendingBackId(q.id); setSendBackNotes('') }}>
                                        Send back
                                    </Button>
                                </div>
                            )
                        )}
                        {!readOnly && !resolved && !answered && mine && (
                            resolvingId === q.id ? (
                                <div className='mv-thread-resolve'>
                                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder='What was fixed, and what evidence was provided?' />
                                    <div className='mv-thread-resolve-actions'>
                                        <Upload maxCount={1} showUploadList={false} beforeUpload={f => { setFile(f); return Upload.LIST_IGNORE }}>
                                            <Button icon={<UploadOutlined />}>{file ? file.name : 'Attach evidence'}</Button>
                                        </Upload>
                                        <Button onClick={() => setResolvingId(null)} disabled={saving}>Cancel</Button>
                                        <Button type='primary' icon={<CheckOutlined />} loading={saving} onClick={() => submit(q)}>Resolve</Button>
                                    </div>
                                </div>
                            ) : (
                                <Button size='small' onClick={() => { setResolvingId(q.id); setNotes(resolutionNote); setFile(null) }}>
                                    Resolve
                                </Button>
                            )
                        )}
                    </li>
                )
            })}
        </ul>
    )
}

/** Send an MOV back to its facilitator with a specific issue. */
export const RaiseQueryModal: React.FC<{
    open: boolean
    inPack: boolean
    facilitatorName?: string | null
    onCancel: () => void
    onSend: (values: { queryType: string; message: string }) => Promise<void>
    /** For pack queries (CC / M&E): the title, who it goes to and what happens. */
    title?: string
    recipientName?: string | null
    note?: string
}> = ({ open, inPack, facilitatorName, onCancel, onSend, title, recipientName, note }) => {
    const [form] = Form.useForm()
    const [sending, setSending] = useState(false)
    const typeValue = Form.useWatch('queryType', form) || 'poe-request'
    const type = QUERY_TYPES.find(t => t.value === typeValue) || QUERY_TYPES[0]

    const send = async () => {
        let values: { queryType: string; message: string }
        try {
            values = await form.validateFields()
        } catch {
            return
        }
        setSending(true)
        try {
            await onSend(values)
            form.resetFields()
        } finally {
            setSending(false)
        }
    }

    /** Adds a common reason to the details (once), ready to be expanded on. */
    const addReason = (reason: string) => {
        const current = String(form.getFieldValue('message') || '').trim()
        if (current.includes(reason)) return
        form.setFieldValue('message', current ? `${current} ${reason}` : reason)
        form.validateFields(['message']).catch(() => undefined)
    }

    const to = String(recipientName || facilitatorName || '').trim() || 'the facilitator'

    return (
        <Modal
            className='guide-raise-query-modal'
            centered
            open={open}
            onCancel={onCancel}
            footer={
                <Button block danger type='primary' icon={<SendOutlined />} loading={sending} onClick={send} className='guide-raise-query-submit'>
                    Send query to {to}
                </Button>
            }
            title={title || 'Query this MOV'}
            width={620}
            destroyOnClose
        >
            <Alert
                type='warning'
                showIcon
                style={{ marginBottom: 12 }}
                message={note || (inPack
                    ? `This MOV is already in a monthly pack. Querying sends it back to ${to}; the pack keeps its current copy until it’s refreshed.`
                    : `This sends the MOV back to ${to} for changes.`)}
            />
            <Form data-guide='mov-query-form' form={form} layout='vertical' initialValues={{ queryType: 'poe-request' }} preserve={false}>
                <Form.Item label='What’s the issue?' name='queryType' rules={[{ required: true }]}>
                    <IssueCards />
                </Form.Item>
                <Form.Item
                    label={type.prompt}
                    name='message'
                    extra={type.reasons.length ? (
                        <div className='mv-reasons' aria-label='Common reasons'>
                            {type.reasons.map(r => (
                                <button key={r} type='button' className='mv-reason' onClick={() => addReason(r)}>+ {r.replace(/\.$/, '')}</button>
                            ))}
                        </div>
                    ) : undefined}
                    rules={[
                        { required: true, whitespace: true, message: 'Say what needs to be fixed.' },
                        { validator: (_, v) => (String(v || '').trim().split(/\s+/).filter(Boolean).length >= 5 ? Promise.resolve() : Promise.reject(new Error('Add a little more detail (at least 5 words).'))) }
                    ]}
                >
                    <Input.TextArea rows={4} placeholder={type.placeholder} />
                </Form.Item>
            </Form>
        </Modal>
    )
}
