import { useEffect, useMemo, useState } from 'react'
import { Button, Col, DatePicker, Form, Input, Modal, Progress, Row, Select, Space, Tag, Typography } from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    CheckOutlined,
    CloseOutlined,
    DeleteOutlined,
    EditOutlined,
    ExclamationCircleOutlined,
    EyeOutlined,
    LockOutlined,
    PlusOutlined,
    SaveOutlined,
    SyncOutlined,
    TeamOutlined,
    WarningOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'

const { TextArea } = Input

export type ChallengeFormType = 'General' | 'Unresponsive SMEs'

type Props = {
    open: boolean
    editing: boolean
    saving: boolean
    initialValues: Record<string, any>
    smes: Array<{ participantId: string; companyName: string }>
    statuses: string[]
    channels: string[]
    items: string[]
    onCancel: () => void
    onSubmit: (values: any) => void
}

type StepKey = 'type' | 'details' | 'contact' | 'plan' | 'review'

const typeCards: Array<{ kind: ChallengeFormType; title: string; description: string; icon: React.ReactNode }> = [
    { kind: 'General', title: 'An operational challenge', description: 'Something slowing delivery, such as attendance, logistics or capacity.', icon: <WarningOutlined /> },
    { kind: 'Unresponsive SMEs', title: 'Unresponsive SMEs', description: 'SMEs who are not replying, with the contact attempts made.', icon: <TeamOutlined /> }
]

const statusMeta: Record<string, { icon: React.ReactNode; tone: string }> = {
    Open: { icon: <ExclamationCircleOutlined />, tone: 'gold' },
    'In Progress': { icon: <SyncOutlined />, tone: 'blue' },
    Resolved: { icon: <CheckCircleOutlined />, tone: 'green' },
    Closed: { icon: <LockOutlined />, tone: 'grey' }
}

/** Status picker rendered as selectable cards, all in one row. */
const StatusCards: React.FC<{ value?: string; onChange?: (value: string) => void; statuses: string[] }> = ({ value, onChange, statuses }) => (
    <div className='status-cards' role='radiogroup' aria-label='Status'>
        {statuses.map(status => {
            const meta = statusMeta[status] || statusMeta.Open
            const active = (value || 'Open') === status
            return (
                <button key={status} type='button' role='radio' aria-checked={active} onClick={() => onChange?.(status)} className={`status-card status-card-${meta.tone}${active ? ' status-card-active' : ''}`}>
                    <span className='status-card-icon'>{meta.icon}</span>
                    <span className='status-card-label'>{status}</span>
                </button>
            )
        })}
    </div>
)

const StepText: React.FC<{ value?: string }> = ({ value }) => <span className='mitigation-text'>{value}</span>

/** One text field with a circular add button; steps appear below as cards with edit and delete. */
const MitigationEditor: React.FC = () => {
    const [draft, setDraft] = useState('')
    const [editing, setEditing] = useState<number | null>(null)
    return (
        <Form.List name='mitigationSteps'>
            {(fields, { add, remove }) => {
                const commit = () => {
                    const text = draft.trim()
                    if (!text) return
                    add({ text })
                    setDraft('')
                }
                return (
                    <div className='mitigation'>
                        <div className='mitigation-add'>
                            <Input value={draft} onChange={event => setDraft(event.target.value)} onPressEnter={event => { event.preventDefault(); commit() }} placeholder='Describe a mitigation step and press Enter' />
                            <Button type='primary' shape='circle' icon={<PlusOutlined />} disabled={!draft.trim()} onClick={commit} aria-label='Add step' />
                        </div>
                        <div className='mitigation-list'>
                            {fields.map((field, index) => (
                                <div key={field.key} className='mitigation-card'>
                                    <span className='challenge-step-number'>{index + 1}</span>
                                    <div className='mitigation-body'>
                                        {editing === field.name
                                            ? <Form.Item name={[field.name, 'text']} noStyle><Input autoFocus onPressEnter={event => { event.preventDefault(); setEditing(null) }} /></Form.Item>
                                            : <Form.Item name={[field.name, 'text']} noStyle><StepText /></Form.Item>}
                                    </div>
                                    <Button shape='circle' icon={editing === field.name ? <CheckOutlined /> : <EditOutlined />} onClick={() => setEditing(editing === field.name ? null : field.name)} aria-label={editing === field.name ? 'Save step' : 'Edit step'} />
                                    <Button danger shape='circle' icon={<DeleteOutlined />} onClick={() => { setEditing(null); remove(field.name) }} aria-label='Delete step' />
                                </div>
                            ))}
                            {!fields.length && <div className='mitigation-empty'>No steps added yet.</div>}
                        </div>
                    </div>
                )
            }}
        </Form.List>
    )
}

const ChallengeFormModal: React.FC<Props> = ({ open, editing, saving, initialValues: rawInitialValues, smes, statuses, channels, items, onCancel, onSubmit }) => {
    // Never start with a blank mitigation step; steps only exist once the user adds them.
    const initialValues = useMemo(() => ({
        ...rawInitialValues,
        mitigationSteps: (rawInitialValues.mitigationSteps || []).filter((step: any) => String(step?.text || '').trim())
    }), [rawInitialValues])
    const [form] = Form.useForm()
    const values = Form.useWatch([], { form, preserve: true }) || {}
    const [step, setStep] = useState<StepKey>('type')
    const type = (values.challengeType || 'General') as ChallengeFormType
    const unresponsive = type === 'Unresponsive SMEs'

    const steps = useMemo<StepKey[]>(
        () => (unresponsive ? ['details', 'contact', 'plan', 'review'] : ['details', 'plan', 'review']),
        [unresponsive]
    )
    const stepIndex = steps.indexOf(step)

    useEffect(() => {
        if (!open) return
        form.resetFields()
        form.setFieldsValue(initialValues)
        form.setFieldValue('mitigationSteps', initialValues.mitigationSteps)
        setStep(editing ? 'details' : 'type')
    }, [editing, form, initialValues, open])

    const requiredFields = unresponsive ? ['smeIds', 'details', 'communicationAttempts'] : ['title', 'details']
    const completed = requiredFields.filter(field => {
        const value = values[field]
        if (field === 'communicationAttempts') {
            return Array.isArray(value) && value.length > 0 && value.every((a: any) => a?.channel && a?.attemptedAt && a?.items?.length && String(a?.notes || '').trim())
        }
        return Array.isArray(value) ? value.length > 0 : !!String(value || '').trim()
    }).length
    const percent = Math.round((completed / requiredFields.length) * 100)

    const stepFields = (key: StepKey): any[] => {
        if (key === 'details') return unresponsive ? ['smeIds', 'details'] : ['title', 'details']
        if (key === 'contact') return ['communicationAttempts']
        return []
    }

    const next = async () => {
        try {
            await form.validateFields(stepFields(step))
            setStep(steps[Math.min(steps.length - 1, stepIndex + 1)])
        } catch {
            // field errors are shown inline
        }
    }

    const back = () => {
        if (stepIndex <= 0) {
            if (editing) onCancel()
            else setStep('type')
            return
        }
        setStep(steps[stepIndex - 1])
    }

    const choose = (kind: ChallengeFormType) => {
        form.setFieldValue('challengeType', kind)
        setStep('details')
    }

    const mitigation = (values.mitigationSteps || []).map((item: any) => String(item?.text || '').trim()).filter(Boolean)
    const selectedSmes = smes.filter(sme => (values.smeIds || []).includes(sme.participantId))

    const reviewRows: Array<[string, React.ReactNode]> = [
        ...(unresponsive ? [['SMEs', selectedSmes.map(sme => sme.companyName).join(', ') || '-'] as [string, React.ReactNode]] : []),
        ['Details', values.details],
        ...(unresponsive ? [[
            'Communication attempts',
            (values.communicationAttempts || []).map((attempt: any, index: number) => (
                <div key={index} style={{ marginBottom: 6 }}>
                    <strong>{attempt?.channel}</strong>
                    {attempt?.attemptedAt ? ` · ${dayjs(attempt.attemptedAt).format('YYYY-MM-DD HH:mm')}` : ''}
                    {attempt?.items?.length ? ` · ${attempt.items.join(', ')}` : ''}
                    <div>{attempt?.notes}</div>
                </div>
            ))
        ] as [string, React.ReactNode]] : []),
        ['Proposed mitigation', mitigation.length ? <ol style={{ margin: 0, paddingLeft: 18 }}>{mitigation.map((item: string, i: number) => <li key={i}>{item}</li>)}</ol> : 'None added'],
        ['Due date', values.dueDate ? dayjs(values.dueDate).format('YYYY-MM-DD') : 'Not set'],
        ['Status', values.status || 'Open']
    ]

    return (
        <Modal
            title={editing ? 'Update Challenge' : 'Log Challenge'}
            open={open}
            onCancel={onCancel}
            footer={null}
            width={900}
            forceRender
            className='challenge-form-modal'
        >
            <div className='challenge-form-body'>
                {step !== 'type' && (
                    <div className='challenge-progress'>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Typography.Text strong>Challenge completeness</Typography.Text>
                            <Typography.Text>{completed} of {requiredFields.length} required sections</Typography.Text>
                        </Space>
                        <Progress percent={percent} size='small' status={percent === 100 ? 'success' : 'active'} />
                    </div>
                )}
                <Form form={form} layout='vertical' onFinish={() => onSubmit(form.getFieldsValue(true))} initialValues={initialValues} requiredMark>
                    <Form.Item name='challengeType' hidden><Input /></Form.Item>

                    {step === 'type' && (
                        <div style={{ padding: '8px 0' }}>
                            <Typography.Title level={3} style={{ marginTop: 8 }}>What kind of challenge are you logging?</Typography.Title>
                            <Typography.Paragraph type='secondary'>Choose the type that best describes it.</Typography.Paragraph>
                            <Row gutter={[16, 16]}>
                                {typeCards.map(card => (
                                    <Col xs={24} sm={12} key={card.kind}>
                                        <Button block className='story-type-card' onClick={() => choose(card.kind)}>
                                            <span className='story-type-card-icon'>{card.icon}</span>
                                            <span className='story-type-card-copy'>
                                                <Typography.Text strong>{card.title}</Typography.Text>
                                                <Typography.Text type='secondary'>{card.description}</Typography.Text>
                                            </span>
                                            <ArrowRightOutlined className='story-type-card-arrow' />
                                        </Button>
                                    </Col>
                                ))}
                            </Row>
                        </div>
                    )}

                    {step === 'details' && (
                        <>
                            <Space wrap style={{ marginBottom: 8 }}>
                                <Typography.Title level={4} style={{ margin: 0 }}>Tell us about the challenge.</Typography.Title>
                                <Tag color={unresponsive ? 'volcano' : 'gold'}>{type}</Tag>
                            </Space>
                            {!unresponsive && (
                                <Form.Item label='Challenge' name='title' rules={[{ required: true, whitespace: true, message: 'Add a challenge title' }]}>
                                    <Input placeholder='E.g. Low attendance for finance sessions' />
                                </Form.Item>
                            )}
                            {unresponsive && (
                                <Form.Item label='Unresponsive SME(s)' name='smeIds' rules={[{ required: true, message: 'Select at least one SME' }]}>
                                    <Select mode='multiple' showSearch optionFilterProp='label' placeholder='Select one or more SMEs' options={smes.map(sme => ({ value: sme.participantId, label: sme.companyName }))} />
                                </Form.Item>
                            )}
                            <Form.Item label='Details' name='details' rules={[{ required: true, whitespace: true, message: 'Describe the challenge' }]}>
                                <TextArea rows={5} placeholder={unresponsive ? 'Describe the lack of response and the impact on delivery.' : 'What happened, who is affected, and what is the impact?'} />
                            </Form.Item>
                        </>
                    )}

                    {step === 'contact' && (
                        <>
                            <Typography.Title level={4}>How have you tried to reach them?</Typography.Title>
                            <Form.List name='communicationAttempts'>
                                {(fields, { add, remove }) => (
                                    <Space direction='vertical' size={12} style={{ width: '100%' }}>
                                        {fields.map((field, index) => (
                                            <div key={field.key} className='challenge-attempt'>
                                                <div className='challenge-attempt-head'>
                                                    <Typography.Text strong>Attempt {index + 1}</Typography.Text>
                                                    {fields.length > 1 && <Button size='small' danger type='text' icon={<DeleteOutlined />} onClick={() => remove(field.name)}>Remove</Button>}
                                                </div>
                                                <Row gutter={12}>
                                                    <Col xs={24} md={8}>
                                                        <Form.Item {...field} label='Contact method' name={[field.name, 'channel']} rules={[{ required: true, message: 'Select a contact method' }]}>
                                                            <Select options={channels.map(channel => ({ value: channel, label: channel }))} />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col xs={24} md={8}>
                                                        <Form.Item {...field} label='Attempt date and time' name={[field.name, 'attemptedAt']} rules={[{ required: true, message: 'Select when contact was attempted' }]}>
                                                            <DatePicker showTime style={{ width: '100%' }} disabledDate={current => !!current && current.isAfter(dayjs(), 'day')} />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col xs={24} md={8}>
                                                        <Form.Item {...field} label='Item(s) awaiting response' name={[field.name, 'items']} rules={[{ required: true, message: 'Select the item(s)' }]}>
                                                            <Select mode='multiple' popupMatchSelectWidth={420} options={items.map(item => ({ value: item, label: <span title={item}>{item}</span> }))} />
                                                        </Form.Item>
                                                    </Col>
                                                </Row>
                                                <Form.Item {...field} label='Attempt notes' name={[field.name, 'notes']} rules={[{ required: true, whitespace: true, message: 'Describe where/how contact was attempted and the outcome' }]} style={{ marginBottom: 0 }}>
                                                    <TextArea rows={2} placeholder='E.g. Emailed the owner and followed up on WhatsApp; messages were delivered but no response was received.' />
                                                </Form.Item>
                                            </div>
                                        ))}
                                        <Button type='dashed' block icon={<PlusOutlined />} onClick={() => add({ attemptedAt: dayjs(), items: [] })}>Add communication attempt</Button>
                                    </Space>
                                )}
                            </Form.List>
                        </>
                    )}

                    {step === 'plan' && (
                        <>
                            <Typography.Title level={4}>What will you do about it?</Typography.Title>
                            <Typography.Text strong>Proposed mitigation</Typography.Text>
                            <div style={{ marginTop: 8 }}><MitigationEditor /></div>
                            <div className='due-date-row'>
                                <Form.Item label='Due date' name='dueDate' style={{ marginBottom: 0 }}><DatePicker style={{ width: '100%' }} disabledDate={current => !!current && current.isBefore(dayjs(), 'day')} /></Form.Item>
                                <div className='due-date-full' aria-live='polite'>
                                    <span className='due-date-icon'><CalendarOutlined /></span>
                                    <span>{values.dueDate ? dayjs(values.dueDate).format('dddd, D MMMM YYYY') : 'No due date set'}</span>
                                </div>
                            </div>
                            <Form.Item label='Status' name='status'><StatusCards statuses={statuses} /></Form.Item>
                        </>
                    )}

                    {step === 'review' && (
                        <div className='story-review'>
                            <Typography.Title level={4}>Ready to save this challenge?</Typography.Title>
                            <Typography.Paragraph type='secondary'>Review the details below. Use Back to make changes.</Typography.Paragraph>
                            <div className='challenge-review-card'>
                                <Space wrap><Tag color={unresponsive ? 'volcano' : 'gold'}>{type}</Tag></Space>
                                <Typography.Title level={3} style={{ marginTop: 8 }}>{unresponsive ? 'Unresponsive SMEs' : values.title}</Typography.Title>
                                {reviewRows.map(([label, content]) => (
                                    <section key={label} style={{ marginBottom: 16 }}>
                                        <Typography.Text strong>{label}</Typography.Text>
                                        <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{content}</div>
                                    </section>
                                ))}
                            </div>
                        </div>
                    )}

                    <Row gutter={12} style={{ marginTop: 20 }}>
                        <Col span={step === 'type' ? 24 : 8}>
                            <Button block icon={step === 'type' ? <CloseOutlined /> : <ArrowLeftOutlined />} onClick={step === 'type' ? onCancel : back}>{step === 'type' ? 'Cancel' : 'Back'}</Button>
                        </Col>
                        {step !== 'type' && (
                            <Col span={16}>
                                {step === 'review'
                                    ? <Button block type='primary' loading={saving} icon={<SaveOutlined />} onClick={() => form.submit()}>{editing ? 'Save changes' : 'Save challenge'}</Button>
                                    : <Button block type='primary' icon={steps[stepIndex + 1] === 'review' ? <EyeOutlined /> : <ArrowRightOutlined />} iconPosition='end' onClick={next}>{steps[stepIndex + 1] === 'review' ? 'Review challenge' : 'Continue'}</Button>}
                            </Col>
                        )}
                    </Row>
                </Form>
            </div>
        </Modal>
    )
}

export default ChallengeFormModal
