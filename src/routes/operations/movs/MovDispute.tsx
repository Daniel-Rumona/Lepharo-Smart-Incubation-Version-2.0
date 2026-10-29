import React, { useState } from 'react'
import { App, Button, Input, Modal } from 'antd'
import { CheckCircleOutlined, PaperClipOutlined, UndoOutlined } from '@ant-design/icons'
import { disputeCategoryLabel, disputeOutcomeLabel } from '@/services/deliveryDisputeService'
import { fmtDate } from './movData'
import '@/components/queries/choice-cards.css'

type Decision = 'sme' | 'facilitator'

const DECISIONS: Record<Decision, { title: string; button: string; explain: string; placeholder: string }> = {
    sme: {
        title: 'The SME is right',
        button: 'Send back to the facilitator',
        explain: 'It goes back to the facilitator to correct or deliver; the SME confirms afterwards as usual.',
        placeholder: 'e.g. The attendance register doesn’t show the second session.'
    },
    facilitator: {
        title: 'The facilitator is right',
        button: 'Confirm the delivery',
        explain: 'The MOV counts as confirmed by your decision, in place of the SME’s signature, and comes to To review. Both are notified.',
        placeholder: 'e.g. The signed register and photos show both sessions took place.'
    }
}

/** An SME delivery dispute the facilitator escalated: both sides, and the HOD's decision. */
export const DisputePanel: React.FC<{
    dispute: any
    smeName: string
    facilitatorName: string
    /** Evidence on the MOV itself (uploaded at completion or since). */
    movEvidence: { label?: string; link: string }[]
    canDecide: boolean
    onDecide: (decision: Decision, notes: string) => Promise<void>
}> = ({ dispute, smeName, facilitatorName, movEvidence, canDecide, onDecide }) => {
    const { message } = App.useApp()
    const [deciding, setDeciding] = useState<Decision | null>(null)
    const [notes, setNotes] = useState('')
    const [saving, setSaving] = useState(false)

    const category = disputeCategoryLabel(dispute?.context?.disputeCategory)
    const response = dispute?.response || {}
    const files: string[] = response.attachmentUrls || (response.attachmentUrl ? [response.attachmentUrl] : [])
    const added = new Set(files)
    const onFile = movEvidence.filter(r => r.link && !added.has(r.link))
    const pointedTo = (dispute?.escalation?.existingEvidenceUrls || []).length > 0
    const rounds = Number(dispute?.sentBackCount || 0)

    const submit = async () => {
        if (!deciding) return
        if (notes.trim().split(/\s+/).filter(Boolean).length < 4) {
            message.warning('Give the reason for your decision; both sides will see it.')
            return
        }
        setSaving(true)
        try {
            await onDecide(deciding, notes.trim())
            setDeciding(null)
            setNotes('')
        } finally {
            setSaving(false)
        }
    }

    return (
        <section>
            <h3 className='ws-section-title'>Delivery dispute · your decision</h3>
            <div className='qc-quote'>
                <div className='qc-quote-head'>
                    <span className='qc-quote-who'>{dispute?.raisedBy?.name || smeName} (SME)</span>
                    <span className='mv-muted'>{[category, fmtDate(dispute?.createdAt)].filter(v => v && v !== '—').join(' · ')}</span>
                </div>
                {/* The message starts with the category (for screens that don't show it separately). */}
                <div className='qc-quote-text'>{String(dispute?.message || '—').replace(category ? `${category}: ` : /^$/, '')}</div>
                {rounds > 0 && <div className='mv-muted'>Sent back {rounds} {rounds === 1 ? 'time' : 'times'} before this.</div>}
            </div>
            <div className='qc-quote' style={{ marginTop: 8 }}>
                <div className='qc-quote-head'>
                    <span className='qc-quote-who'>{dispute?.resolver?.name || facilitatorName} (Facilitator)</span>
                    <span className='mv-muted'>{[disputeOutcomeLabel(response.outcome), fmtDate(response.respondedAt || dispute?.escalation?.at)].filter(v => v && v !== '—').join(' · ')}</span>
                </div>
                <div className='qc-quote-text'>{response.message || '—'}</div>
                {pointedTo && <div className='mv-muted'>Says the evidence already on the MOV shows it was delivered.</div>}
            </div>

            <div className='mv-proof'>
                <div className='mv-proof-group'>
                    <span className='mv-proof-title'>Added for this dispute</span>
                    {files.length ? files.map((url, i) => (
                        <Button key={url} size='small' icon={<PaperClipOutlined />} onClick={() => window.open(url, '_blank', 'noopener')}>
                            Proof {i + 1}
                        </Button>
                    )) : <span className='mv-muted'>Nothing new</span>}
                </div>
                <div className='mv-proof-group'>
                    <span className='mv-proof-title'>On the MOV</span>
                    {onFile.length ? onFile.map((r, i) => (
                        <Button key={r.link} size='small' icon={<PaperClipOutlined />} onClick={() => window.open(r.link, '_blank', 'noopener')}>
                            {r.label || `Evidence ${i + 1}`}
                        </Button>
                    )) : <span className='mv-muted'>None</span>}
                </div>
            </div>

            {canDecide ? (
                <div className='mv-actions' style={{ marginTop: 12 }}>
                    <Button icon={<UndoOutlined />} onClick={() => setDeciding('sme')}>The SME is right</Button>
                    <Button type='primary' icon={<CheckCircleOutlined />} onClick={() => setDeciding('facilitator')}>The facilitator is right</Button>
                </div>
            ) : (
                <p className='mv-muted' style={{ marginTop: 8 }}>Waiting for the department’s HOD to decide.</p>
            )}

            <Modal
                open={!!deciding}
                onCancel={() => setDeciding(null)}
                centered
                width={520}
                title={deciding ? DECISIONS[deciding].title : ''}
                footer={deciding && (
                    <Button block type='primary' danger={deciding === 'sme'} loading={saving} onClick={submit}>
                        {DECISIONS[deciding].button}
                    </Button>
                )}
                destroyOnClose
            >
                {deciding && (
                    <>
                        <p className='mv-muted'>{DECISIONS[deciding].explain}</p>
                        <label className='ws-filter-label' htmlFor='mv-dispute-reason'>Reason (shown to both)</label>
                        <Input.TextArea id='mv-dispute-reason' autoSize={{ minRows: 3, maxRows: 6 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder={DECISIONS[deciding].placeholder} />
                    </>
                )}
            </Modal>
        </section>
    )
}
