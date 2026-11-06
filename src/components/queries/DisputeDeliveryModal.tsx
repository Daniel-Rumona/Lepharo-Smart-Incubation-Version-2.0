import React, { useEffect, useState } from 'react'
import { Button, Input, Modal, message } from 'antd'
import { EditOutlined, MinusCircleOutlined, QuestionCircleOutlined, StopOutlined } from '@ant-design/icons'
import { DISPUTE_CATEGORIES, type DisputeCategory } from '@/services/deliveryDisputeService'
import { ChoiceCards } from './ChoiceCards'

const ICONS: Record<DisputeCategory, React.ReactNode> = {
    'not-delivered': <StopOutlined />,
    'partly-delivered': <MinusCircleOutlined />,
    'details-wrong': <EditOutlined />,
    other: <QuestionCircleOutlined />
}

const PROMPTS: Record<DisputeCategory, { label: string; placeholder: string }> = {
    'not-delivered': { label: 'What happened?', placeholder: 'e.g. The session on 12 Aug was cancelled and never rescheduled.' },
    'partly-delivered': { label: 'What’s missing?', placeholder: 'e.g. Only the first of three sessions took place; the cash-flow template was never shared.' },
    'details-wrong': { label: 'What’s wrong in the details?', placeholder: 'e.g. The session was on 5 Sep, not 3 Sep, and it was online, not in person.' },
    other: { label: 'Describe the problem', placeholder: 'Say what’s wrong with this completion.' }
}

/**
 * The SME tells the facilitator that a completion isn't right. Choosing what
 * kind of problem it is lets the facilitator respond properly (correct the
 * record, deliver what's missing, or stand by it and let the HOD decide).
 */
export const DisputeDeliveryModal: React.FC<{
    open: boolean
    interventionTitle?: string | null
    facilitatorName?: string | null
    onClose: () => void
    onSubmit: (category: DisputeCategory, reason: string) => Promise<void>
}> = ({ open, interventionTitle, facilitatorName, onClose, onSubmit }) => {
    const [category, setCategory] = useState<DisputeCategory>('not-delivered')
    const [reason, setReason] = useState('')
    const [sending, setSending] = useState(false)

    useEffect(() => {
        if (!open) return
        setCategory('not-delivered')
        setReason('')
    }, [open])

    const send = async () => {
        if (reason.trim().split(/\s+/).filter(Boolean).length < 4) {
            message.warning('Please explain a little more, so the facilitator knows what to fix.')
            return
        }
        setSending(true)
        try {
            await onSubmit(category, reason.trim())
            onClose()
        } catch (error) {
            console.error(error)
            message.error('That couldn’t be sent. Please try again.')
        } finally {
            setSending(false)
        }
    }

    const prompt = PROMPTS[category]
    const to = String(facilitatorName || '').trim() || 'the facilitator'

    return (
        <Modal
            open={open}
            onCancel={onClose}
            centered
            width={640}
            title='Report a problem with this completion'
            footer={
                <Button block danger type='primary' loading={sending} onClick={send}>
                    Send to {to}
                </Button>
            }
            destroyOnClose
        >
            {interventionTitle && <p className='qc-hint' style={{ marginTop: 0 }}>{interventionTitle}</p>}
            <h4 className='qc-section-title'>What’s wrong?</h4>
            <ChoiceCards
                label='What’s wrong?'
                columns={2}
                value={category}
                onChange={setCategory}
                options={DISPUTE_CATEGORIES.map(c => ({ ...c, icon: ICONS[c.value] }))}
            />
            <div className='qc-section'>
                <label className='qc-section-title' htmlFor='dispute-reason' style={{ display: 'block' }}>{prompt.label}</label>
                <Input.TextArea id='dispute-reason' rows={4} value={reason} onChange={e => setReason(e.target.value)} placeholder={prompt.placeholder} />
                <p className='qc-hint'>
                    {to.charAt(0).toUpperCase() + to.slice(1)} will correct it, deliver what’s missing, or explain. If you still disagree, the department’s HOD decides.
                </p>
            </div>
        </Modal>
    )
}
