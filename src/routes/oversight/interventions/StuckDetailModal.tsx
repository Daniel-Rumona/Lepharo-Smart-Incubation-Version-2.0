import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Avatar, Button, Input, Modal, Space, Steps, Tag, Typography, message, theme } from 'antd'
import { CarryOutOutlined, ClockCircleOutlined, FileProtectOutlined, SendOutlined } from '@ant-design/icons'
import { httpsCallable } from 'firebase/functions'
import dayjs from 'dayjs'
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore'
import { db, functions } from '@/firebase'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import type { StuckItem } from '@/services/interventionTower'
import { ACCENT, IconChip } from './cards'

const { Text } = Typography

const DAY_MS = 86_400_000

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value instanceof Date) return value
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000)
    return null
}

const fmt = (value: any) => {
    const date = toDate(value)
    return date ? dayjs(date).format('D MMM YYYY') : undefined
}

type StepSpec = { title: string; at?: string; extra?: string }

/** Where the MOV is in the six-step chain, with the date each step happened. */
function movSteps(item: StuckItem): { steps: StepSpec[]; current: number; error: boolean } {
    const mov = item.raw
    const pack = item.pack
    const approvals: any[] = Array.isArray(pack?.approvals) ? pack!.approvals : []
    const ccStep = [...approvals].reverse().find(a => String(a?.step || '') === 'final_confirmation')
    const steps: StepSpec[] = [
        { title: 'MOV generated', at: fmt(mov.createdAt) },
        { title: 'SME confirmed', at: fmt(mov.smmeSignedAt) },
        { title: 'HOD approved', at: fmt(mov.hodApprovedAt) },
        { title: 'In monthly pack', at: fmt(pack?.createdAt) },
        { title: 'CC confirmed', at: fmt(ccStep?.date), extra: pack?.ccConfirmationOnBehalf ? 'by M&E on behalf' : undefined },
        { title: 'M&E validated', at: fmt(mov.monitoringApprovedAt || mov.monitoringValidation?.validatedAt) }
    ]
    const current: Record<string, number> = {
        awaiting_smme: 1, awaiting_hod: 2, queried: 2, rejected: 2,
        hod_approved: 3, in_pack: 4, cc_confirmed: 5, me_validated: 6, invoice_redeemable: 6
    }
    const stage = item.position?.stage ?? 'awaiting_hod'
    return { steps, current: current[stage] ?? 2, error: stage === 'queried' || stage === 'rejected' }
}

function deliverySteps(item: StuckItem): { steps: StepSpec[]; current: number; error: boolean } {
    const row = item.raw
    const lifecycle = resolveAssignmentLifecycle(row)
    const steps: StepSpec[] = [
        { title: 'Assigned', at: fmt(row.assignedAtResolved || row.assignedAt || row.createdAt) },
        { title: 'Delivered', at: fmt(row.assigneeCompletedAt) },
        { title: 'SME confirmed', at: fmt(row.participantConfirmedAt) }
    ]
    const bad = ['needs-reassignment', 'participant-declined', 'participant-rejected'].includes(lifecycle.key)
    const current = lifecycle.key === 'completed' ? 3 : lifecycle.key === 'awaiting-participant-confirmation' ? 2 : 1
    return { steps, current, error: bad }
}

type Photos = { participant?: string; facilitator?: string }

const photoOf = (data: Record<string, any> | undefined) =>
    String(data?.photoURL || data?.photoUrl || data?.logoUrl || '').trim() || undefined

const photoByEmail = async (email: string): Promise<string | undefined> => {
    const clean = email.trim().toLowerCase()
    if (!clean) return undefined
    const snap = await getDocs(query(collection(db, 'users'), where('email', '==', clean), limit(1)))
    return snap.empty ? undefined : photoOf(snap.docs[0].data())
}

/**
 * Loads the SME's and facilitator's pictures when a row is opened. Photos live
 * on the user record (photoURL), found by id or, failing that, by
 * email. Anything missing just leaves the initials avatar in place.
 */
function usePhotos(item: StuckItem | null): Photos {
    const [photos, setPhotos] = useState<Photos>({})
    useEffect(() => {
        setPhotos({})
        if (!item) return
        let cancelled = false
        const raw = item.raw
        const participantId = String(raw.participantId || raw.beneficiaryId || raw.smmeId || '').trim()
        const facilitatorId = String(raw.facilitatorId || raw.assigneeId || '').trim()

        const loadParticipant = async () => {
            let email = String(raw.participantEmail || raw.smmeEmail || raw.beneficiaryEmail || raw.email || '').trim()
            if (participantId) {
                const snap = await getDoc(doc(db, 'participants', participantId))
                const data = snap.exists() ? snap.data() : undefined
                const direct = photoOf(data)
                if (direct) return direct
                email = email || String(data?.email || data?.contactEmail || '').trim()
            }
            return email ? photoByEmail(email) : undefined
        }
        const loadFacilitator = async () => {
            if (facilitatorId) {
                const snap = await getDoc(doc(db, 'users', facilitatorId))
                const direct = snap.exists() ? photoOf(snap.data()) : undefined
                if (direct) return direct
            }
            const email = String(raw.facilitatorEmail || raw.assigneeEmail || '').trim()
            return email ? photoByEmail(email) : undefined
        }

        Promise.allSettled([loadParticipant(), loadFacilitator()]).then(([p, f]) => {
            if (cancelled) return
            setPhotos({
                participant: p.status === 'fulfilled' ? p.value : undefined,
                facilitator: f.status === 'fulfilled' ? f.value : undefined
            })
        })
        return () => {
            cancelled = true
        }
    }, [item?.id])
    return photos
}

type Props = {
    item: StuckItem | null
    onClose: () => void
}

export const StuckDetailModal: React.FC<Props> = ({ item, onClose }) => {
    const { token } = theme.useToken()
    const [note, setNote] = useState('')
    const [sending, setSending] = useState(false)
    // Reminders sent in this session, so the button reflects it before the next refresh.
    const [justSent, setJustSent] = useState<{ owner: string; audience: string } | null>(null)

    useEffect(() => {
        setNote('')
        setJustSent(null)
    }, [item?.id])

    const photos = usePhotos(item)
    const timeline = useMemo(() => (item ? (item.kind === 'evidence' ? movSteps(item) : deliverySteps(item)) : null), [item])

    if (!item || !timeline) return null

    const target = item.reminderTarget
    const targetDoc = target?.collection === 'consolidatedMOVs' ? item.pack : item.raw
    const history: any[] = [...(targetDoc?.manualReminders || [])].sort((a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0))
    const last = toDate(targetDoc?.lastManualReminder?.at)
    const remindedToday = !!justSent || (!!last && Date.now() - last.getTime() < DAY_MS)

    const send = async () => {
        if (!target) return
        setSending(true)
        try {
            const result: any = await httpsCallable(functions, 'remindMovOwner')({ collection: target.collection, id: target.id, state: target.state, note })
            setJustSent({ owner: result.data?.owner, audience: result.data?.audience })
            message.success(`Reminder sent to ${result.data?.audience || 'the owner'}.`)
        } catch (error: any) {
            message.warning(error?.message || 'Could not send the reminder.')
        } finally {
            setSending(false)
        }
    }

    const kindAccent = item.kind === 'evidence' ? ACCENT.purple : ACCENT.orange
    const waitColor = item.severity >= 3 ? ACCENT.red.color : item.severity >= 1.5 ? ACCENT.orange.color : '#faad14'

    const sectionLabel = (text: string) => (
        <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            {text}
        </Text>
    )

    const panel: React.CSSProperties = {
        padding: 16,
        borderRadius: 16,
        background: token.colorFillQuaternary,
        border: `1px solid ${token.colorBorderSecondary}`
    }

    const fact = (label: string, value: React.ReactNode, avatar?: { src?: string; name: string; color: string }) => (
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            {avatar && (
                <Avatar size={40} src={avatar.src} style={{ background: `${avatar.color}22`, color: avatar.color, fontWeight: 600, flex: '0 0 auto' }}>
                    {String(avatar.name || '?').trim().charAt(0).toUpperCase()}
                </Avatar>
            )}
            <div style={{ minWidth: 0 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{label}</Text>
                <Text strong ellipsis style={{ display: 'block', fontSize: 14 }}>{value || '-'}</Text>
            </div>
        </div>
    )

    return (
        <Modal
            open
            onCancel={onClose}
            width={820}
            destroyOnClose
            footer={null}
            title={
                <Space size={12} align="center">
                    <IconChip color={kindAccent.color} bg={kindAccent.bg} size={40}>
                        {item.kind === 'evidence' ? <FileProtectOutlined /> : <CarryOutOutlined />}
                    </IconChip>
                    <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{item.reason}</div>
                        <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>{item.interventionTitle}</Text>
                    </div>
                </Space>
            }
        >
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {/* Hero: how long, and who has to act */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 16,
                        flexWrap: 'wrap',
                        padding: '14px 18px',
                        borderRadius: 16,
                        background: `linear-gradient(135deg, ${waitColor}1f, ${waitColor}08)`,
                        border: `1px solid ${waitColor}33`
                    }}
                >
                    <Space size={12} align="center">
                        <ClockCircleOutlined style={{ fontSize: 22, color: waitColor }} />
                        <div>
                            <span style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: waitColor }}>{item.days}</span>
                            <Text style={{ marginLeft: 6 }}>day{item.days === 1 ? '' : 's'} waiting</Text>
                            <div>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    since {item.enteredAt ? dayjs(item.enteredAt).format('D MMM YYYY') : 'an unknown date'}
                                </Text>
                            </div>
                        </div>
                    </Space>
                    <Space wrap>
                        <Tag bordered={false} style={{ margin: 0, borderRadius: 999, padding: '2px 12px', fontSize: 13 }}>
                            Next action: <b>{item.owner}</b>
                        </Tag>
                        {item.position?.ccConfirmedByMe && (
                            <Tag bordered={false} style={{ margin: 0, borderRadius: 999 }}>CC step done by M&amp;E</Tag>
                        )}
                    </Space>
                </div>

                {/* Facts */}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                        gap: '14px 20px',
                        padding: '2px 4px'
                    }}
                >
                    {fact('Participant', item.participantName, { src: photos.participant, name: item.participantName, color: ACCENT.blue.color })}
                    {fact('Department', item.departmentName)}
                    {fact('Facilitator', item.assigneeName, { src: photos.facilitator, name: item.assigneeName, color: ACCENT.purple.color })}
                    {item.kind === 'evidence' && item.pack && fact('Monthly pack', `${String(item.pack.month || '')}`)}
                </div>

                {/* Timeline */}
                <div style={panel}>
                    {sectionLabel(item.kind === 'evidence' ? 'Evidence chain' : 'Delivery progress')}
                    <Steps
                        size="small"
                        labelPlacement="vertical"
                        style={{ marginTop: 14 }}
                        current={timeline.current}
                        status={timeline.error ? 'error' : 'process'}
                        items={timeline.steps.map(step => ({
                            title: step.title,
                            description: step.at ? (
                                <span>
                                    {step.at}
                                    {step.extra && <><br />{step.extra}</>}
                                </span>
                            ) : undefined
                        }))}
                    />
                </div>

                {/* Reminder */}
                {target ? (
                    <div style={{ ...panel, background: token.colorBgContainer }}>
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            <Space size={10} align="center">
                                <IconChip color={ACCENT.blue.color} bg={ACCENT.blue.bg} size={32}><SendOutlined /></IconChip>
                                <div>
                                    <div style={{ fontWeight: 600, lineHeight: 1.3 }}>Send a reminder</div>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        To <b>{target.audience}</b> by email, and in-app where they have an account. One per item per day.
                                    </Text>
                                </div>
                            </Space>

                            <Input.TextArea
                                autoSize={{ minRows: 2, maxRows: 5 }}
                                maxLength={500}
                                placeholder="Add a note (optional)"
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                disabled={remindedToday}
                            />

                            <Button
                                block
                                size="large"
                                type="primary"
                                icon={<SendOutlined />}
                                loading={sending}
                                disabled={remindedToday}
                                onClick={send}
                            >
                                {remindedToday ? 'Reminded today' : `Remind ${target.audience}`}
                            </Button>
                            {justSent && <Text type="success">Sent to {justSent.audience}.</Text>}
                            {!justSent && remindedToday && last && (
                                <Text type="secondary" style={{ fontSize: 12 }}>Last sent {dayjs(last).format('D MMM HH:mm')}.</Text>
                            )}
                        </Space>
                    </div>
                ) : (
                    <Alert type="info" showIcon message="Nothing to chase yet - this MOV is still a draft." />
                )}

                {history.length > 0 && (
                    <div>
                        {sectionLabel('Reminder history')}
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {history.slice(0, 5).map((entry, index) => (
                                <div
                                    key={index}
                                    style={{ paddingLeft: 12, borderLeft: `3px solid ${token.colorPrimaryBorder}`, fontSize: 13 }}
                                >
                                    <Text strong>{entry.byName || 'Someone'}</Text>
                                    <Text type="secondary"> reminded {entry.owner} - {fmt(entry.at)}</Text>
                                    {entry.note && (
                                        <div>
                                            <Text type="secondary" italic>"{entry.note}"</Text>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Space>
        </Modal>
    )
}
