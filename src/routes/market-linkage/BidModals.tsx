import React, { useEffect, useState } from 'react'
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Radio, Space, message } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import {
    LOST_REASONS,
    awardBid,
    formatRand,
    moveBid,
    newMilestoneId,
    type ContractMilestone,
    type LostReasonKey,
    type Opportunity,
    type OpportunityInterest
} from '@/services/marketLinkage'

/** Records why a bid was lost. The SME is told the reason and the support that would help next time. */
export const LostBidModal: React.FC<{
    interest: OpportunityInterest | null
    uid: string
    onClose: () => void
    onSaved: () => void
}> = ({ interest, uid, onClose, onSaved }) => {
    const [reason, setReason] = useState<LostReasonKey>()
    const [note, setNote] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        setReason(undefined)
        setNote('')
    }, [interest?.id])

    const save = async () => {
        if (!interest || !reason) return
        setSaving(true)
        try {
            await moveBid(interest.id, 'lost', uid, { reason, note })
            message.success('Marked as lost. The SME has been told why.')
            onSaved()
        } catch (e) {
            console.error('[market-linkage] lost failed', e)
            message.error('Could not save. Please try again.')
        } finally {
            setSaving(false)
        }
    }

    const support = LOST_REASONS.find(r => r.key === reason)?.support
    return (
        <Modal
            open={!!interest}
            onCancel={onClose}
            centered
            wrapClassName='mobile-sheet'
            title={`Why did ${interest?.participantName || 'this SME'} lose the bid?`}
            okText='Mark as lost'
            okButtonProps={{ danger: true, disabled: !reason, loading: saving }}
            onOk={save}
            destroyOnClose
        >
            <Radio.Group value={reason} onChange={e => setReason(e.target.value)} style={{ width: '100%' }}>
                <Space direction='vertical' style={{ width: '100%' }}>
                    {LOST_REASONS.map(r => <Radio key={r.key} value={r.key}>{r.label}</Radio>)}
                </Space>
            </Radio.Group>
            <Input.TextArea
                style={{ marginTop: 12 }}
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={500}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="The buyer's feedback, e.g. came in 18% above the winning price (optional)"
            />
            {support && <Alert style={{ marginTop: 12 }} type='info' showIcon message={`Suggested support: ${support}`} />}
        </Modal>
    )
}

type MilestoneRow = { id: string; title: string; dueDate: Dayjs | null; amount: number | null }

/** Awards the bid and opens its supply contract with milestones and payment amounts. */
export const AwardBidModal: React.FC<{
    interest: OpportunityInterest | null
    opportunity: Opportunity
    uid: string
    onClose: () => void
    onSaved: () => void
}> = ({ interest, opportunity, uid, onClose, onSaved }) => {
    const [form] = Form.useForm()
    const [rows, setRows] = useState<MilestoneRow[]>([])
    const [saving, setSaving] = useState(false)
    const value = Form.useWatch('value', form) as number | undefined

    useEffect(() => {
        if (!interest) return
        form.resetFields()
        setRows([{ id: newMilestoneId(), title: 'First delivery', dueDate: null, amount: null }])
    }, [interest?.id, form])

    const scheduled = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
    const patchRow = (id: string, patch: Partial<MilestoneRow>) => setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))

    const save = async () => {
        if (!interest) return
        let v: any
        try {
            v = await form.validateFields()
        } catch {
            return
        }
        const milestones: ContractMilestone[] = rows
            .filter(r => r.title.trim())
            .map(r => ({ id: r.id, title: r.title.trim(), dueDate: r.dueDate ? r.dueDate.toDate() : null, amount: Number(r.amount) || 0, status: 'pending' }))
        if (scheduled > Number(v.value)) {
            message.error('The milestones add up to more than the contract value.')
            return
        }
        setSaving(true)
        try {
            await awardBid(interest, opportunity, {
                value: Number(v.value),
                startDate: v.period?.[0]?.toDate() || null,
                endDate: v.period?.[1]?.toDate() || null,
                milestones
            }, uid)
            message.success('Awarded. The contract is open and the SME has been told.')
            onSaved()
        } catch (e) {
            console.error('[market-linkage] award failed', e)
            message.error('Could not award the bid. Please try again.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open={!!interest}
            onCancel={onClose}
            centered
            width='min(680px, 96vw)'
            wrapClassName='mobile-sheet'
            title={`Award "${opportunity.title}" to ${interest?.participantName || 'this SME'}`}
            okText='Award and open contract'
            okButtonProps={{ loading: saving }}
            onOk={save}
            destroyOnClose
            styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        >
            <Form form={form} layout='vertical' requiredMark={false}>
                <Space wrap size={12} style={{ width: '100%' }}>
                    <Form.Item name='value' label='Contract value' rules={[{ required: true, message: 'Enter the contract value' }]}>
                        <InputNumber min={1} prefix='R' style={{ width: 200 }} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} />
                    </Form.Item>
                    <Form.Item name='period' label='Contract period'>
                        <DatePicker.RangePicker format='D MMM YYYY' />
                    </Form.Item>
                </Space>
            </Form>

            <div className='mlx-milestones-head'>
                <strong>Milestones</strong>
                <span className='ws-muted'>
                    {formatRand(scheduled)} scheduled{value ? ` of ${formatRand(value)}` : ''}
                </span>
            </div>
            <div className='mlx-milestone-rows'>
                {rows.map(r => (
                    <div key={r.id} className='mlx-milestone-row'>
                        <Input value={r.title} placeholder='What is delivered' onChange={e => patchRow(r.id, { title: e.target.value })} />
                        <DatePicker value={r.dueDate} format='D MMM YYYY' placeholder='Due' onChange={d => patchRow(r.id, { dueDate: d })} />
                        <InputNumber value={r.amount} min={0} prefix='R' placeholder='Amount' onChange={n => patchRow(r.id, { amount: n })} />
                        <Button type='text' icon={<DeleteOutlined />} aria-label='Remove milestone' onClick={() => setRows(prev => prev.filter(x => x.id !== r.id))} />
                    </div>
                ))}
            </div>
            <Button
                type='dashed'
                icon={<PlusOutlined />}
                block
                style={{ marginTop: 8 }}
                onClick={() => setRows(prev => [...prev, { id: newMilestoneId(), title: '', dueDate: prev.length ? (prev[prev.length - 1].dueDate?.add(1, 'month') ?? null) : dayjs().add(1, 'month'), amount: null }])}
            >
                Add milestone
            </Button>
            {value && scheduled > value && <Alert style={{ marginTop: 12 }} type='error' showIcon message='The milestones add up to more than the contract value.' />}
        </Modal>
    )
}
