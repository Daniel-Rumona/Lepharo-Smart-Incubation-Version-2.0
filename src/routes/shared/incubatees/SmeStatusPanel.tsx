import React, { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Typography, message } from 'antd'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase'
import { SME_STATUSES } from '@/lib/smeIncubation'
import type { SmeRow } from './participantsData'

const STATUS_COLORS: Record<string, string> = { Active: 'green', Inactive: 'default', Dormant: 'gold', 'Potential Exit': 'orange', Exited: 'red' }
export const smeStatusColor = (status?: string) => STATUS_COLORS[status || 'Active']
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-ZA') : 'Unknown'

export const SmeStatusPanel: React.FC<{ row: SmeRow; canManage: boolean; onSaved: () => Promise<void> }> = ({ row, canManage, onSaved }) => {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form] = Form.useForm()
    useEffect(() => { setOpen(false); form.resetFields() }, [row.appId, form])
    const save = async () => {
        const values = await form.validateFields().catch(() => null)
        if (!values) return
        setSaving(true)
        try {
            await httpsCallable(functions, 'setSmeIncubationStatus')({ applicationId: row.appId, ...values })
            message.success('SME status updated.')
            setOpen(false)
            await onSaved()
        } catch (error: any) {
            message.error(error?.message || 'Unable to change SME status.')
        } finally { setSaving(false) }
    }
    return (
        <>
            {canManage && row.incubationStatus !== 'Exited' && <Button onClick={() => {
                form.resetFields()
                setOpen(true)
            }}>Change status</Button>}
            <Modal title={`Change status: ${row.companyName}`} open={open} onCancel={() => { if (!saving) setOpen(false) }} onOk={() => void save()} confirmLoading={saving} okText='Save status' cancelButtonProps={{ disabled: saving }} maskClosable={!saving} closable={!saving}>
                <p>Active: participating. Inactive: temporarily not participating. Dormant: a longer-term pause. Potential Exit: requires exit review.</p>
                <p>Attended sessions and completed interventions determine the last participation date. At 80 days without participation, the SME moves to Potential Exit; at 90 days it qualifies for exit review. Changing status does not reset the countdown.</p>
                <Form form={form} layout='vertical'>
                    <Form.Item name='status' label='Status' rules={[{ required: true }]}>
                        <Select placeholder='Choose a new status' disabled={saving} options={SME_STATUSES.filter(status => status !== (row.incubationStatus || 'Active')).map(status => ({ label: status, value: status, disabled: (row.inactiveDays ?? 0) >= 80 && status !== 'Potential Exit' }))} />
                    </Form.Item>
                    <Form.Item name='reason' label='Reason for this change' rules={[{ required: true, whitespace: true, message: 'Provide a reason for the status change.' }, { max: 1000 }]}>
                        <Input.TextArea rows={3} maxLength={1000} showCount disabled={saving} />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    )
}

export const SmeStatusSummary: React.FC<{ row: SmeRow }> = ({ row }) => (
    <div className='ptx-status-summary'>
        <div style={{ marginTop: 8 }}>
            <Typography.Text type='secondary'>
                {row.inactivityBaselineSource === 'participation'
                    ? `Last participation: ${dateLabel(row.lastParticipationAt)}`
                    : row.inactivityBaselineSource === 'onboarding'
                        ? `No participation recorded. Counting from onboarding: ${dateLabel(row.inactivityBaselineAt)}`
                        : 'No activity or onboarding date available; automatic exit qualification is paused.'}
                {row.inactiveDays != null && ` · ${row.inactiveDays} days without participation`}
            </Typography.Text>
        </div>
        {row.incubationStatusReason && <div><Typography.Text type='secondary'>Latest status reason: {row.incubationStatusReason}</Typography.Text></div>}
        {row.incubationStatus === 'Potential Exit' && <Alert style={{ marginTop: 8 }} type={row.exitQualified ? 'warning' : 'info'} showIcon
            message={row.exitQualified ? '90-day threshold reached. Review the SME for exit; it has not been automatically exited.' : 'Approaching the 90-day exit qualification threshold.'} />}
    </div>
)
