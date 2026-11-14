import { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Progress, Select, Space, Steps, Tag, Typography, message } from 'antd'
import { SafetyCertificateOutlined } from '@ant-design/icons'
import { changeProposalStatus } from '@/services/proposalService'
import type { Proposal, ProposalActor } from '@/types/proposal'
import {
    ACTIVATION_STEP_COUNT, ADVANCE_TO, activationStep, money, nextStatuses, statusColor
} from './proposalUi'

const { Title, Text } = Typography

/**
 * The one status flow: every Advance, Reopen, Restore and Update status
 * button opens this, preset to the next forward status.
 */
export function ProposalStatusModal({
    proposal,
    actor,
    onClose
}: {
    proposal: Proposal | null
    actor: ProposalActor
    onClose: () => void
}) {
    const [form] = Form.useForm()
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!proposal) return
        form.setFieldsValue({
            status: ADVANCE_TO[proposal.status] || nextStatuses(proposal.status)[0],
            note: ''
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proposal?.id, proposal?.status])

    const save = async () => {
        if (!proposal) return
        const values = await form.validateFields()
        const note = values.note?.trim() || `Status changed from ${proposal.status} to ${values.status}`
        setSaving(true)
        try {
            await changeProposalStatus(proposal, values.status, note, actor)
            message.success(`${proposal.proposalNumber} moved to ${values.status}`)
            onClose()
        } catch (error: any) {
            message.error(error?.message || 'Could not update the proposal status.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal title={proposal ? `Update status · ${proposal.proposalNumber}` : 'Update proposal status'}
            open={Boolean(proposal)} onCancel={onClose}
            footer={<div className='proposal-step-footer'>
                <Button block disabled={saving} onClick={onClose}>Cancel</Button>
                <Button block type='primary' loading={saving} onClick={save}>Update status</Button>
            </div>}>
            <Form form={form} layout='vertical'>
                {proposal && <Form.Item label='Current status'>
                    <Tag color={statusColor[proposal.status]}>{proposal.status}</Tag>
                </Form.Item>}
                <Form.Item name='status' label='New status' rules={[{ required: true }]}>
                    <Select options={nextStatuses(proposal?.status || 'Draft')
                        .map(value => ({ label: value, value }))} />
                </Form.Item>
                <Form.Item name='note' label='Progress note'
                    extra='Optional. Recorded in the proposal history and sent with the notification.'>
                    <Input.TextArea rows={3} placeholder='What changed, and what happens next?' />
                </Form.Item>
            </Form>
        </Modal>
    )
}

/** Where an accepted proposal is on the way to delivery. */
export function ProposalActivationModal({
    proposal,
    open,
    onClose
}: {
    proposal: Proposal | null
    open: boolean
    onClose: () => void
}) {
    const step = proposal ? activationStep(proposal.status) : 0
    return (
        <Modal title={<Space><SafetyCertificateOutlined />Activation progress</Space>}
            open={open && Boolean(proposal)} footer={null} width={900} onCancel={onClose}>
            {proposal && <>
                <Alert type='info' showIcon style={{ marginBottom: 16 }}
                    message='Preview'
                    description='This shows where the proposal is on the way to delivery. Controls for each step, such as generating service agreements, come in a later release.' />
                <div className='activation-modal-summary'>
                    <div><Text type='secondary'>{proposal.proposalNumber}</Text>
                        <Title level={4}>{proposal.title}</Title>
                        <Text>{proposal.clientName} · {money(proposal.estimatedValue)}</Text>
                    </div>
                    <div className='activation-progress'>
                        <Progress type='circle' size={84}
                            percent={Math.round((step / ACTIVATION_STEP_COUNT) * 100)} />
                    </div>
                </div>
                <Steps current={step}
                    items={[
                        { title: 'Accepted', description: 'Proposal decision and approval evidence' },
                        { title: 'SLA signed', description: 'Agreement and commercial terms' },
                        { title: 'Order number', description: 'Client procurement dependency' },
                        { title: 'Implementation plan', description: 'Activities, KPIs, MOVs and invoicing' },
                        { title: 'Activate departments', description: 'Generate service agreements' }
                    ]} />
            </>}
        </Modal>
    )
}
