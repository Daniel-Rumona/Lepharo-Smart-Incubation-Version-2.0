import { useEffect } from 'react'
import { Button, Col, DatePicker, Form, Input, Modal, Row, Select, Space, Tag, Typography } from 'antd'
import { CalendarOutlined, CheckCircleOutlined, CloseOutlined, ExclamationCircleOutlined, SaveOutlined, SyncOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { TextArea } = Input

export type CheckInOutcome = 'mitigated' | 'in_progress' | 'not_mitigated'

export type CheckInValues = {
    outcome: CheckInOutcome
    resolutionNote?: string
    reasonCategory?: string
    reason?: string
    supportNeeded?: string
    newDueDate?: any
}

type Props = {
    open: boolean
    saving: boolean
    challenge: { title?: string; dueDate?: any; mitigationSteps?: string[]; status?: string } | null
    onCancel: () => void
    onSubmit: (values: CheckInValues) => void
}

export const reasonCategories = [
    'Awaiting SME response',
    'Resource or budget constraint',
    'Dependency on another department',
    'Scope or priorities changed',
    'Capacity or time constraints',
    'Other'
]

const outcomes: Array<{ value: CheckInOutcome; title: string; description: string; icon: React.ReactNode; tone: string }> = [
    { value: 'mitigated', title: 'Yes, mitigated', description: 'The challenge has been dealt with.', icon: <CheckCircleOutlined />, tone: 'green' },
    { value: 'in_progress', title: 'Partly', description: 'Progress made, still work to do.', icon: <SyncOutlined />, tone: 'blue' },
    { value: 'not_mitigated', title: 'Not yet', description: 'No mitigation has taken place.', icon: <ExclamationCircleOutlined />, tone: 'gold' }
]

const OutcomeCards: React.FC<{ value?: CheckInOutcome; onChange?: (value: CheckInOutcome) => void }> = ({ value, onChange }) => (
    <div className='status-cards checkin-outcomes' role='radiogroup' aria-label='Has this been mitigated?'>
        {outcomes.map(item => (
            <button key={item.value} type='button' role='radio' aria-checked={value === item.value} onClick={() => onChange?.(item.value)} className={`status-card status-card-${item.tone}${value === item.value ? ' status-card-active' : ''}`}>
                <span className='status-card-icon'>{item.icon}</span>
                <span className='checkin-outcome-copy'>
                    <span className='status-card-label'>{item.title}</span>
                    <small>{item.description}</small>
                </span>
            </button>
        ))}
    </div>
)

/** Due-date check-in: has the challenge been mitigated, and if not why not and what is needed. */
const ChallengeCheckInModal: React.FC<Props> = ({ open, saving, challenge, onCancel, onSubmit }) => {
    const [form] = Form.useForm<CheckInValues>()
    const outcome = Form.useWatch('outcome', form)
    const dueDate = challenge?.dueDate?.toDate?.() ? dayjs(challenge.dueDate.toDate()) : null
    const overdue = !!dueDate && dueDate.isBefore(dayjs(), 'day')
    const unresolved = !!outcome && outcome !== 'mitigated'

    useEffect(() => {
        if (open) form.resetFields()
    }, [form, open, challenge])

    return (
        <Modal title='Due-date check-in' open={open} onCancel={onCancel} footer={null} width={760} forceRender className='challenge-form-modal'>
            <div className='challenge-form-body'>
                {challenge && (
                    <div className='challenge-review-card' style={{ marginBottom: 16 }}>
                        <Space wrap>
                            <Tag color={overdue ? 'red' : 'gold'} icon={<CalendarOutlined />}>
                                {dueDate ? `${overdue ? 'Was due' : 'Due'} ${dueDate.format('dddd, D MMMM YYYY')}` : 'No due date'}
                            </Tag>
                        </Space>
                        <Typography.Title level={4} style={{ margin: '8px 0 4px' }}>{challenge.title}</Typography.Title>
                        {!!challenge.mitigationSteps?.length && (
                            <ol style={{ margin: 0, paddingLeft: 18 }}>{challenge.mitigationSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
                        )}
                    </div>
                )}
                <Form form={form} layout='vertical' onFinish={onSubmit} requiredMark>
                    <Form.Item label='Has this challenge been mitigated?' name='outcome' rules={[{ required: true, message: 'Select an answer' }]}>
                        <OutcomeCards />
                    </Form.Item>

                    {outcome === 'mitigated' && (
                        <Form.Item label='What resolved it?' name='resolutionNote' rules={[{ required: true, whitespace: true, message: 'Briefly describe what resolved the challenge' }]}>
                            <TextArea rows={3} placeholder='E.g. SMEs confirmed attendance after a follow-up visit and the sessions were rescheduled.' />
                        </Form.Item>
                    )}

                    {unresolved && (
                        <>
                            <Row gutter={12}>
                                <Col xs={24} md={10}>
                                    <Form.Item label='Main reason' name='reasonCategory' rules={[{ required: true, message: 'Select the main reason' }]}>
                                        <Select placeholder='Select a reason' options={reasonCategories.map(item => ({ value: item, label: item }))} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={14}>
                                    <Form.Item label='New target date' name='newDueDate' rules={[{ required: true, message: 'Set a new target date' }]}>
                                        <DatePicker style={{ width: '100%' }} format='dddd, D MMMM YYYY' disabledDate={current => !!current && current.isBefore(dayjs(), 'day')} />
                                    </Form.Item>
                                </Col>
                            </Row>
                            <Form.Item label='Why has it not been mitigated?' name='reason' rules={[{ required: true, whitespace: true, message: 'Explain what has prevented the mitigation' }]}>
                                <TextArea rows={3} placeholder='Describe what has blocked or delayed the mitigation.' />
                            </Form.Item>
                            <Form.Item label='Support needed (optional)' name='supportNeeded'>
                                <TextArea rows={2} placeholder='What help, decision or resource would unblock this?' />
                            </Form.Item>
                        </>
                    )}

                    <Row gutter={12} style={{ marginTop: 12 }}>
                        <Col span={8}><Button block icon={<CloseOutlined />} onClick={onCancel}>Cancel</Button></Col>
                        <Col span={16}><Button block type='primary' htmlType='submit' loading={saving} icon={<SaveOutlined />} disabled={!outcome}>Save check-in</Button></Col>
                    </Row>
                </Form>
            </div>
        </Modal>
    )
}

export default ChallengeCheckInModal
