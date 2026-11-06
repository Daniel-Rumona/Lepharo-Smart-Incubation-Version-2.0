import React, { useEffect, useState } from 'react'
import { Divider, Input, Modal, Select, Space, Typography, message } from 'antd'
import {
    APPOINTMENT_DECLINE_REASON_OPTIONS,
    appointmentDeclineReasonAllowsTimeProposal,
    buildAppointmentDeclineReason,
    type AppointmentDeclineReasonCode
} from '@/lib/appointmentDeclineReasons'
import AppointmentRescheduleProposalFields, {
    buildAppointmentRescheduleProposals,
    createAppointmentProposalDraft,
    type AppointmentProposalDraft
} from '@/components/appointments/AppointmentRescheduleProposalFields'
import { declineAppointmentResponse } from '@/services/appointmentResponses'

const { Text } = Typography

/**
 * An SME declining an appointment: a reason, and for one-to-one sessions where
 * the reason allows it, proposed new times. Used by the dashboard and the
 * "Waiting for you" prompt.
 */
const DeclineAppointmentModal: React.FC<{
    appointment: { id: string; assignedInterventionId?: string | null; isGroupAppointment?: boolean } | null
    onClose: () => void
    onDeclined?: () => void
}> = ({ appointment, onClose, onDeclined }) => {
    const [reasonCode, setReasonCode] = useState<AppointmentDeclineReasonCode | undefined>()
    const [reasonText, setReasonText] = useState('')
    const [proposals, setProposals] = useState<AppointmentProposalDraft[]>([createAppointmentProposalDraft()])
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (!appointment) return
        setReasonCode(undefined)
        setReasonText('')
        setProposals([createAppointmentProposalDraft()])
    }, [appointment?.id])

    const canProposeTime =
        !!appointment && !appointment.isGroupAppointment && appointmentDeclineReasonAllowsTimeProposal(reasonCode)

    const submit = async () => {
        if (!appointment) return
        let reason
        try {
            reason = buildAppointmentDeclineReason(reasonCode, reasonText)
        } catch (error: any) {
            message.warning(error?.message || 'Please provide a reason.')
            return
        }
        let rescheduleProposals: ReturnType<typeof buildAppointmentRescheduleProposals> = []
        try {
            rescheduleProposals = canProposeTime ? buildAppointmentRescheduleProposals(proposals) : []
        } catch (error: any) {
            message.warning(error?.message || 'Check the proposed appointment times.')
            return
        }
        setSubmitting(true)
        try {
            await declineAppointmentResponse(appointment, reason, rescheduleProposals)
            message.success('Appointment declined.')
            onDeclined?.()
            onClose()
        } catch (error) {
            console.error(error)
            message.error('Failed to decline appointment.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal
            title='Decline Appointment'
            open={!!appointment}
            onOk={submit}
            onCancel={onClose}
            okButtonProps={{ danger: true, loading: submitting }}
            okText='Decline'
            destroyOnClose
        >
            <Text type='secondary' style={{ display: 'block', marginBottom: 12 }}>
                Please tell the facilitator why you cannot attend.
            </Text>
            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <Select
                    value={reasonCode}
                    onChange={value => {
                        setReasonCode(value)
                        if (value !== 'other') setReasonText('')
                    }}
                    placeholder='Select a reason'
                    style={{ width: '100%' }}
                    options={APPOINTMENT_DECLINE_REASON_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
                />
                {reasonCode === 'other' ? (
                    <Input.TextArea
                        rows={4}
                        value={reasonText}
                        onChange={e => setReasonText(e.target.value)}
                        placeholder='Provide your reason in your own words'
                        maxLength={500}
                        showCount
                    />
                ) : null}
                {canProposeTime ? (
                    <>
                        <Divider style={{ margin: '4px 0' }} />
                        <AppointmentRescheduleProposalFields value={proposals} onChange={setProposals} />
                    </>
                ) : null}
            </Space>
        </Modal>
    )
}

export default DeclineAppointmentModal
