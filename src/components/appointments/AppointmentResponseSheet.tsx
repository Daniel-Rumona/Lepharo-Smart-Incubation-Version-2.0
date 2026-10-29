import React, { useEffect, useState } from 'react'
import { Button, Descriptions, Divider, Drawer, Grid, Input, Modal, Select, Space, Typography, message } from 'antd'
import { CheckCircleOutlined, CloseOutlined, LinkOutlined } from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { requestOpenAccountSettings } from '@/lib/accountSettings'
import { SignatureStage, useSignaturePlayback } from '@/components/shared/SignatureAnimation'
import {
    formatAppointmentDate,
    formatAppointmentTime,
    formatDeliveryMethod,
    getAppointmentAssigneeName,
    getAppointmentTitle,
    isPastAppointment
} from '@/services/appointmentService'
import {
    APPOINTMENT_DECLINE_REASON_OPTIONS,
    type AppointmentDeclineReasonCode
} from '@/lib/appointmentDeclineReasons'
import AppointmentRescheduleProposalFields, {
    createAppointmentProposalDraft,
    type AppointmentProposalDraft
} from '@/components/appointments/AppointmentRescheduleProposalFields'
import {
    canProposeNewTime,
    confirmAppointmentAsSme,
    declineAppointmentAsSme
} from '@/services/smeAppointmentResponse'

const { Paragraph, Text } = Typography
const { useBreakpoint } = Grid

type AppointmentLike = Record<string, any> & { id: string }

type Props = {
    /** The appointment to answer; null keeps the sheet closed. */
    appointment: AppointmentLike | null
    onClose: () => void
    /** Called after the response is saved, with the fields to merge locally. */
    onResponded: (appointmentId: string, patch: Record<string, any>) => void
}

/**
 * Answer an appointment invite without leaving the page: a modal on desktop,
 * a bottom drawer on phones. Confirm and decline write through the same
 * service as the appointments page, so the effect is identical.
 */
export default function AppointmentResponseSheet({ appointment, onClose, onResponded }: Props) {
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const { user } = useFullIdentity()

    const [mode, setMode] = useState<'respond' | 'decline'>('respond')
    const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null)
    const [reasonCode, setReasonCode] = useState<AppointmentDeclineReasonCode | undefined>()
    const [reasonDetails, setReasonDetails] = useState('')
    const [proposals, setProposals] = useState<AppointmentProposalDraft[]>([createAppointmentProposalDraft()])
    // The signature placed by Confirm, animated before the sheet closes.
    const [signingURL, setSigningURL] = useState('')
    const signaturePlayback = useSignaturePlayback()

    // Each appointment starts on its summary with an empty decline form.
    useEffect(() => {
        setMode('respond')
        setBusy(null)
        setSigningURL('')
        setReasonCode(undefined)
        setReasonDetails('')
        setProposals([createAppointmentProposalDraft()])
    }, [appointment?.id])

    if (!appointment) return null

    const past = isPastAppointment(appointment as any)
    const link = appointment.deliveryMethod === 'virtual' && !past ? appointment.meetingLink : undefined
    const location = appointment.deliveryMethod === 'in_person' ? appointment.location : undefined
    const topics: string[] = (
        appointment.plannedCoverage || appointment.sessionCoverage?.plannedCoverage || []
    ).map((topic: any) => String(topic || '').trim()).filter(Boolean)

    const confirm = async () => {
        if (!user?.signatureURL) {
            Modal.confirm({
                title: 'Signature required',
                content: 'Please add your signature in Account Settings before confirming an appointment.',
                okText: 'Go to Account Settings',
                cancelText: 'Cancel',
                onOk: () => requestOpenAccountSettings()
            })
            return
        }
        setBusy('confirm')
        signaturePlayback.start()
        setSigningURL(user.signatureURL)
        try {
            await confirmAppointmentAsSme(appointment)
            await signaturePlayback.finished()
            message.success('Appointment confirmed.')
            onResponded(appointment.id, { userConfirmation: 'confirmed', smeConfirmation: 'confirmed' })
        } catch (error) {
            console.error('Failed to confirm appointment:', error)
            setSigningURL('')
            message.error('Failed to confirm appointment.')
        } finally {
            setBusy(null)
        }
    }

    const decline = async () => {
        setBusy('decline')
        try {
            const patch = await declineAppointmentAsSme(appointment, { reasonCode, reasonDetails, proposals })
            message.success('Appointment declined.')
            onResponded(appointment.id, patch)
        } catch (error: any) {
            console.error('Failed to decline appointment:', error)
            message.error(error?.message || 'Failed to decline appointment.')
        } finally {
            setBusy(null)
        }
    }

    const title = mode === 'decline' ? 'Decline appointment' : 'Respond to appointment'

    // Right-aligned on desktop; on phones the buttons share the row evenly.
    const actionRow: React.CSSProperties = isMobile
        ? { display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)', gap: 8 }
        : { display: 'flex', justifyContent: 'flex-end', gap: 8 }

    const body =
        mode === 'respond' ? (
            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <Text strong style={{ fontSize: 16 }}>{getAppointmentTitle(appointment as any)}</Text>
                <Descriptions size='small' column={1} bordered>
                    <Descriptions.Item label='When'>
                        {formatAppointmentDate(appointment as any)} · {formatAppointmentTime(appointment as any)}
                    </Descriptions.Item>
                    <Descriptions.Item label='How'>{formatDeliveryMethod(appointment as any)}</Descriptions.Item>
                    {location ? <Descriptions.Item label='Where'>{location}</Descriptions.Item> : null}
                    {link ? (
                        <Descriptions.Item label='Link'>
                            <a href={link} target='_blank' rel='noopener noreferrer'>
                                <LinkOutlined /> Join meeting
                            </a>
                        </Descriptions.Item>
                    ) : null}
                    <Descriptions.Item label='Facilitator'>
                        {getAppointmentAssigneeName(appointment as any) || 'To be confirmed'}
                    </Descriptions.Item>
                    {topics.length ? (
                        <Descriptions.Item label='Topics'>
                            {topics.map((topic, index) => (
                                <div key={topic + index}>{index + 1}. {topic}</div>
                            ))}
                        </Descriptions.Item>
                    ) : null}
                </Descriptions>
                <Text type='secondary'>
                    {past
                        ? 'This appointment has already passed.'
                        : 'Confirming also accepts this intervention. If you cannot make it, decline and tell the facilitator why.'}
                </Text>
                {signingURL ? (
                    <SignatureStage src={signingURL} animate onComplete={signaturePlayback.complete} />
                ) : null}
            </Space>
        ) : (
            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <Paragraph type='secondary' style={{ margin: 0 }}>
                    Please tell the facilitator why you cannot attend {getAppointmentTitle(appointment as any)}.
                </Paragraph>
                <Select
                    value={reasonCode}
                    onChange={value => {
                        setReasonCode(value)
                        if (value !== 'other') setReasonDetails('')
                    }}
                    placeholder='Select a reason'
                    style={{ width: '100%' }}
                    options={APPOINTMENT_DECLINE_REASON_OPTIONS.map(option => ({
                        value: option.value,
                        label: option.label
                    }))}
                />
                {reasonCode === 'other' ? (
                    <Input.TextArea
                        rows={4}
                        value={reasonDetails}
                        onChange={event => setReasonDetails(event.target.value)}
                        placeholder='Provide your reason in your own words'
                        maxLength={500}
                        showCount
                    />
                ) : null}
                {canProposeNewTime(appointment, reasonCode) ? (
                    <>
                        <Divider style={{ margin: '4px 0' }} />
                        <AppointmentRescheduleProposalFields value={proposals} onChange={setProposals} />
                    </>
                ) : null}
            </Space>
        )

    const footer =
        mode === 'respond' ? (
            <div style={actionRow}>
                {!past ? (
                    <>
                        <Button danger icon={<CloseOutlined />} onClick={() => setMode('decline')} disabled={!!busy}>
                            I can't make it
                        </Button>
                        <Button
                            type='primary'
                            icon={<CheckCircleOutlined />}
                            onClick={confirm}
                            loading={busy === 'confirm'}
                        >
                            Confirm
                        </Button>
                    </>
                ) : (
                    <Button onClick={onClose}>Close</Button>
                )}
            </div>
        ) : (
            <div style={actionRow}>
                <Button onClick={() => setMode('respond')} disabled={!!busy}>Back</Button>
                <Button danger type='primary' onClick={decline} loading={busy === 'decline'}>
                    Submit decline
                </Button>
            </div>
        )

    if (isMobile) {
        return (
            <Drawer
                open
                placement='bottom'
                height='auto'
                title={title}
                onClose={onClose}
                footer={footer}
                styles={{ body: { padding: 16, maxHeight: '70vh', overflowY: 'auto' } }}
            >
                {body}
            </Drawer>
        )
    }

    return (
        <Modal open title={title} onCancel={onClose} footer={footer} width={560} centered destroyOnClose>
            {body}
        </Modal>
    )
}
