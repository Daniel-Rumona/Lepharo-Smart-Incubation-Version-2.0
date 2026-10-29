import React, { useEffect, useState } from 'react'
import { Alert, Button, Card, Input, message, Modal, Radio, Space, Typography } from 'antd'
import { db } from '@/firebase'
import { closeSupport, type ClosureActor } from '@/services/interventionClosureService'
import { CLOSE_REASONS, validateClosure, type CloseReason } from '@/services/interventionClosureRules'

const { Text } = Typography

export type CloseSupportTarget = {
    participantId: string
    participantName?: string
    interventionId: string
    interventionTitle: string
    departmentId?: string | null
    programId?: string | null
}

type Props = {
    target: CloseSupportTarget | null
    user: ClosureActor
    onClose: () => void
    onDone: () => void
}

/** One close flow, used by the Developmental Plan and the Assignments page. */
export const CloseSupportModal: React.FC<Props> = ({ target, user, onClose, onDone }) => {
    const [reason, setReason] = useState<CloseReason | null>(null)
    const [note, setNote] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (target) { setReason(null); setNote('') }
    }, [target?.participantId, target?.interventionId])

    const problem = validateClosure({ reason, note })

    const confirm = async () => {
        if (!target || !reason || problem) return
        setSaving(true)
        try {
            const result = await closeSupport({ db, ...target, reason, note, user })
            message.success(
                result.cancelled
                    ? `Support closed. ${result.cancelled} undelivered assignment${result.cancelled === 1 ? '' : 's'} cancelled.`
                    : 'Support closed.'
            )
            onDone()
        } catch (error) {
            console.error('Failed to close support', error)
            message.error(error instanceof Error ? error.message : 'Could not close support.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
 wrapClassName="mobile-sheet"
            open={!!target}
            centered
            width={640}
            destroyOnClose
            onCancel={onClose}
            title="Close support"
            footer={[
                <Button key="cancel" shape="round" onClick={onClose}>Cancel</Button>,
                <Button key="close" danger type="primary" shape="round" loading={saving} disabled={!!problem} onClick={confirm}>
                    Close support
                </Button>
            ]}
        >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div>
                    <Text strong>{target?.interventionTitle}</Text>
                    {target?.participantName ? <Text type="secondary"> · {target.participantName}</Text> : null}
                </div>
                <Alert
                    type="info"
                    showIcon
                    message="No new cycles will be assigned and undelivered work is cancelled. Delivered work, or work awaiting SME confirmation, is kept. You can reopen it later."
                />
                <Text strong style={{ marginBottom: -4 }}>Why is it being closed?</Text>
                <Radio.Group value={reason} onChange={event => setReason(event.target.value)} style={{ width: '100%' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, width: '100%' }}>
                        {CLOSE_REASONS.map(option => (
                            <Card
                                key={option.value}
                                hoverable
                                size="small"
                                onClick={() => setReason(option.value)}
                                styles={{ body: { padding: '6px 10px' } }}
                                style={{
                                    gridColumn: option.value === 'other' ? '1 / -1' : undefined,
                                    cursor: 'pointer',
                                    borderColor: reason === option.value ? '#1677ff' : undefined,
                                    background: reason === option.value ? 'rgba(22,119,255,0.05)' : undefined
                                }}
                            >
                                <Radio value={option.value}>
                                    <Text strong>{option.label}</Text>
                                    <div><Text type="secondary" style={{ fontSize: 12 }}>{option.hint}</Text></div>
                                </Radio>
                            </Card>
                        ))}
                    </div>
                </Radio.Group>
                <div>
                    <Text>Note {reason === 'other' ? '(required)' : '(optional)'}</Text>
                    <Input.TextArea
                        rows={1}
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        maxLength={500}
                        value={note}
                        onChange={event => setNote(event.target.value)}
                        placeholder="Anything the next person should know"
                    />
                </div>
            </Space>
        </Modal>
    )
}

export default CloseSupportModal
