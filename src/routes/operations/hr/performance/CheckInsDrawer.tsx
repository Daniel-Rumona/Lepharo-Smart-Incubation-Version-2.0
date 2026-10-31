import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Checkbox,
    Col,
    DatePicker,
    Drawer,
    Empty,
    Input,
    Modal,
    Row,
    Segmented,
    Select,
    Space,
    Tag,
    Typography,
    message,
    theme
} from 'antd'
import { CommentOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { clean, newId } from './signature'
import {
    CHECK_IN_DUE_DAYS,
    GOAL_STATUSES,
    PERFORMANCE_GUIDANCE,
    checkInCadence,
    openActionItems,
    performanceBand,
    type ActionItem,
    type CheckIn,
    type CheckInKind,
    type CompactItem,
    type GoalStatus,
    type PerformanceCycle
} from './ipm'
import type { CompactEmployee, CompactMode } from './CompactDrawer'

const { Text, Paragraph } = Typography

type Draft = Omit<CheckIn, 'id' | 'employeeAuthUid'> & { id?: string }

const goalStatusMeta = (status: GoalStatus) => GOAL_STATUSES.find(s => s.value === status) || GOAL_STATUSES[0]

/**
 * Session 3: frequent, future-focused conversations the employee drives, with
 * coaching alongside. Each one records goal progress, roadblocks, updates,
 * career goals and action items, and open action items carry forward.
 */
export const CheckInsDrawer: React.FC<{
    open: boolean
    onClose: () => void
    mode: CompactMode
    employee: CompactEmployee | null
    lineManagerName?: string
    cycle: PerformanceCycle | null
    goals: CompactItem[]
    checkIns: CheckIn[]
    score?: number | null
    user: { id: string; name: string; role: string }
    onSaved: () => void
}> = ({ open, onClose, mode, employee, lineManagerName, cycle, goals, checkIns, score, user, onSaved }) => {
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const [draft, setDraft] = useState<Draft | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!open) setDraft(null)
    }, [open])

    const today = dayjs().format('YYYY-MM-DD')
    const sorted = useMemo(() => [...checkIns].sort((a, b) => b.date.localeCompare(a.date)), [checkIns])
    const cadence = checkInCadence(checkIns.map(c => c.date), today)
    const carried = useMemo(() => openActionItems(checkIns), [checkIns])
    const band = mode === 'manage' ? performanceBand(score) : null
    const isManage = mode === 'manage'
    // Goals worth tracking week to week: KPAs and milestones, not competencies.
    const trackedGoals = goals.filter(goal => goal.section !== 'competencies')

    const startNew = () =>
        setDraft({
            date: today,
            kind: 'check-in',
            goalUpdates: trackedGoals.map(goal => ({ itemId: goal.id, kpa: goal.kpa, status: 'on-track' as GoalStatus, note: '' })),
            roadblocks: '',
            updates: '',
            careerNotes: '',
            employeeNotes: '',
            managerFeedback: '',
            actionItems: []
        })

    const startEdit = (checkIn: CheckIn) => setDraft(clean(checkIn))

    const save = async () => {
        if (!draft || !employee) return
        const employeeUid = employee.authUid || employee.id
        const body: Record<string, unknown> = clean({
            date: draft.date,
            kind: draft.kind,
            goalUpdates: draft.goalUpdates,
            roadblocks: draft.roadblocks || '',
            updates: draft.updates || '',
            careerNotes: draft.careerNotes || '',
            employeeNotes: draft.employeeNotes || '',
            actionItems: draft.actionItems.filter(item => item.text.trim())
        })
        // Only the line manager (or HR) writes feedback; the rules hold the employee to that.
        if (isManage) body.managerFeedback = draft.managerFeedback || ''
        setSaving(true)
        try {
            if (draft.id) {
                await updateDoc(doc(db, 'performanceCheckIns', draft.id), { ...body, updatedAt: serverTimestamp() })
            } else {
                await addDoc(collection(db, 'performanceCheckIns'), {
                    ...body,
                    managerFeedback: isManage ? draft.managerFeedback || '' : '',
                    employeeAuthUid: employeeUid,
                    employeeId: employee.id,
                    employeeName: employee.name || '',
                    lineManagerId: employee.lineManagerId || null,
                    cycleId: cycle?.id || null,
                    createdBy: user.id,
                    createdByRole: isManage ? 'manager' : 'employee',
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                })
            }
            message.success('Check-in saved.')
            setDraft(null)
            onSaved()
        } catch (error) {
            console.error(error)
            message.error('Could not save the check-in.')
        } finally {
            setSaving(false)
        }
    }

    const toggleCarried = async (checkInId: string, itemId: string, done: boolean) => {
        const source = checkIns.find(c => c.id === checkInId)
        if (!source) return
        try {
            await updateDoc(doc(db, 'performanceCheckIns', checkInId), {
                actionItems: clean(source.actionItems.map(item => (item.id === itemId ? { ...item, done } : item))),
                updatedAt: serverTimestamp()
            })
            onSaved()
        } catch (error) {
            console.error(error)
            message.error('Could not update the action item.')
        }
    }

    const patchDraft = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d))
    const patchAction = (id: string, patch: Partial<ActionItem>) =>
        setDraft(d => (d ? { ...d, actionItems: d.actionItems.map(item => (item.id === id ? { ...item, ...patch } : item)) } : d))

    const cadenceTag = cadence.lastDate ? (
        <Tag color={cadence.due ? 'red' : 'green'} style={{ borderRadius: 999, margin: 0 }}>
            {cadence.due ? 'Check-in due' : 'Up to date'} · last {cadence.daysSince === 0 ? 'today' : `${cadence.daysSince}d ago`}
        </Tag>
    ) : (
        <Tag color='red' style={{ borderRadius: 999, margin: 0 }}>No check-ins yet</Tag>
    )

    const editor = draft ? (
        <Modal
            open
            onCancel={() => setDraft(null)}
            onOk={save}
            okText='Save check-in'
            confirmLoading={saving}
            width={isMobile ? '100%' : 860}
            destroyOnClose
            title={draft.id ? 'Edit check-in' : 'New check-in'}
        >
            <Space direction='vertical' size={14} style={{ width: '100%' }}>
                <Row gutter={[12, 12]}>
                    <Col xs={24} md={12}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Date</Text>
                        <DatePicker
                            style={{ width: '100%' }}
                            format='D MMM YYYY'
                            allowClear={false}
                            value={dayjs(draft.date)}
                            onChange={value => value && patchDraft({ date: value.format('YYYY-MM-DD') })}
                        />
                    </Col>
                    <Col xs={24} md={12}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Conversation</Text>
                        <Segmented
                            block
                            value={draft.kind}
                            onChange={value => patchDraft({ kind: value as CheckInKind })}
                            options={[
                                { value: 'check-in', label: 'Check-in' },
                                { value: 'coaching', label: 'Coaching' }
                            ]}
                        />
                    </Col>
                </Row>

                {draft.goalUpdates.length ? (
                    <div>
                        <Text strong>Status of goals</Text>
                        <Space direction='vertical' size={8} style={{ width: '100%', marginTop: 8 }}>
                            {draft.goalUpdates.map(update => (
                                <div
                                    key={update.itemId}
                                    style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 10, padding: 10 }}
                                >
                                    <Row gutter={[8, 8]} align='middle'>
                                        <Col xs={24} md={9}>
                                            <Text>{update.kpa}</Text>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Select
                                                style={{ width: '100%' }}
                                                value={update.status}
                                                options={GOAL_STATUSES.map(s => ({ value: s.value, label: s.label }))}
                                                onChange={status =>
                                                    patchDraft({
                                                        goalUpdates: draft.goalUpdates.map(g => (g.itemId === update.itemId ? { ...g, status } : g))
                                                    })
                                                }
                                            />
                                        </Col>
                                        <Col xs={24} md={9}>
                                            <Input
                                                placeholder='Progress note'
                                                value={update.note}
                                                onChange={e =>
                                                    patchDraft({
                                                        goalUpdates: draft.goalUpdates.map(g =>
                                                            g.itemId === update.itemId ? { ...g, note: e.target.value } : g
                                                        )
                                                    })
                                                }
                                            />
                                        </Col>
                                    </Row>
                                </div>
                            ))}
                        </Space>
                    </div>
                ) : (
                    <Alert type='info' showIcon message='No compact goals for this cycle yet, so there are no goals to update.' />
                )}

                <Row gutter={[12, 12]}>
                    <Col xs={24} md={12}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Roadblocks or distractions</Text>
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={draft.roadblocks} onChange={e => patchDraft({ roadblocks: e.target.value })} />
                    </Col>
                    <Col xs={24} md={12}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Centre or department updates</Text>
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={draft.updates} onChange={e => patchDraft({ updates: e.target.value })} />
                    </Col>
                    <Col xs={24} md={12}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Career goals</Text>
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={draft.careerNotes} onChange={e => patchDraft({ careerNotes: e.target.value })} />
                    </Col>
                    <Col xs={24} md={12}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Employee notes and achievements</Text>
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={draft.employeeNotes} onChange={e => patchDraft({ employeeNotes: e.target.value })} />
                    </Col>
                    <Col span={24}>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {isManage ? 'Feedback, recognition and coaching tips' : 'Line manager feedback'}
                        </Text>
                        <Input.TextArea
                            autoSize={{ minRows: 2, maxRows: 6 }}
                            disabled={!isManage}
                            placeholder={isManage ? '' : 'Your line manager adds this.'}
                            value={draft.managerFeedback}
                            onChange={e => patchDraft({ managerFeedback: e.target.value })}
                        />
                    </Col>
                </Row>

                <div>
                    <Text strong>Action items</Text>
                    <Space direction='vertical' size={8} style={{ width: '100%', marginTop: 8 }}>
                        {draft.actionItems.map(item => (
                            <Row gutter={[8, 8]} key={item.id} align='middle'>
                                <Col xs={24} md={11}>
                                    <Input placeholder='What will be done' value={item.text} onChange={e => patchAction(item.id, { text: e.target.value })} />
                                </Col>
                                <Col xs={12} md={5}>
                                    <Select
                                        style={{ width: '100%' }}
                                        value={item.owner}
                                        options={[
                                            { value: 'employee', label: 'Employee' },
                                            { value: 'manager', label: 'Manager' }
                                        ]}
                                        onChange={owner => patchAction(item.id, { owner })}
                                    />
                                </Col>
                                <Col xs={12} md={6}>
                                    <DatePicker
                                        style={{ width: '100%' }}
                                        format='D MMM'
                                        placeholder='Due'
                                        value={item.due ? dayjs(item.due) : null}
                                        onChange={value => patchAction(item.id, { due: value ? value.format('YYYY-MM-DD') : undefined })}
                                    />
                                </Col>
                                <Col xs={24} md={2} style={{ textAlign: 'right' }}>
                                    <Button
                                        type='text'
                                        danger
                                        icon={<DeleteOutlined />}
                                        aria-label='Remove action item'
                                        onClick={() => patchDraft({ actionItems: draft.actionItems.filter(a => a.id !== item.id) })}
                                    />
                                </Col>
                            </Row>
                        ))}
                        <Button
                            type='dashed'
                            block
                            icon={<PlusOutlined />}
                            onClick={() =>
                                patchDraft({ actionItems: [...draft.actionItems, { id: newId('action'), text: '', owner: 'employee' }] })
                            }
                        >
                            Add action item
                        </Button>
                    </Space>
                </div>
            </Space>
        </Modal>
    ) : null

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={isMobile ? '100%' : 760}
            destroyOnClose
            title={
                <Space direction='vertical' size={0}>
                    <Text strong>{mode === 'self' ? 'My check-ins' : `Check-ins · ${employee?.name || 'Employee'}`}</Text>
                    <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>
                        {[cycle?.label, lineManagerName ? `Line manager: ${lineManagerName}` : ''].filter(Boolean).join(' · ')}
                    </Text>
                </Space>
            }
            extra={
                <Button type='primary' icon={<PlusOutlined />} onClick={startNew}>
                    {isMobile ? 'New' : 'New check-in'}
                </Button>
            }
        >
            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                <Space wrap size={[8, 8]}>
                    {cadenceTag}
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        At least twice a month; {mode === 'self' ? 'you schedule them' : 'the employee schedules them'}.
                    </Text>
                </Space>

                {band ? (
                    <Alert
                        type={band === 'under' ? 'warning' : band === 'excelling' ? 'success' : 'info'}
                        showIcon
                        message={PERFORMANCE_GUIDANCE[band].title}
                        description={
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {PERFORMANCE_GUIDANCE[band].tips.map(tip => (
                                    <li key={tip}>{tip}</li>
                                ))}
                            </ul>
                        }
                    />
                ) : null}

                {carried.length ? (
                    <Card size='small' title={`Follow up (${carried.length} open)`}>
                        <Space direction='vertical' size={6} style={{ width: '100%' }}>
                            {carried.map(item => (
                                <Checkbox key={`${item.checkInId}_${item.id}`} checked={false} onChange={e => toggleCarried(item.checkInId, item.id, e.target.checked)}>
                                    <Text>{item.text}</Text>{' '}
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        {item.owner === 'manager' ? 'Manager' : 'Employee'} · from {dayjs(item.date).format('D MMM')}
                                        {item.due ? ` · due ${dayjs(item.due).format('D MMM')}` : ''}
                                    </Text>
                                </Checkbox>
                            ))}
                        </Space>
                    </Card>
                ) : null}

                {sorted.length ? (
                    sorted.map(checkIn => (
                        <Card
                            key={checkIn.id}
                            size='small'
                            title={
                                <Space size={8} wrap>
                                    <Text strong>{dayjs(checkIn.date).format('D MMM YYYY')}</Text>
                                    <Tag color={checkIn.kind === 'coaching' ? 'purple' : 'blue'} style={{ borderRadius: 999, margin: 0 }}>
                                        {checkIn.kind === 'coaching' ? 'Coaching' : 'Check-in'}
                                    </Tag>
                                </Space>
                            }
                            extra={<Button size='small' type='text' icon={<EditOutlined />} onClick={() => startEdit(checkIn)} aria-label='Edit check-in' />}
                        >
                            <Space direction='vertical' size={8} style={{ width: '100%' }}>
                                {checkIn.goalUpdates?.length ? (
                                    <Space wrap size={[6, 6]}>
                                        {checkIn.goalUpdates.map(update => (
                                            <Tag key={update.itemId} color={goalStatusMeta(update.status).color} style={{ margin: 0 }}>
                                                {update.kpa}: {goalStatusMeta(update.status).label}
                                            </Tag>
                                        ))}
                                    </Space>
                                ) : null}
                                {[
                                    ['Roadblocks', checkIn.roadblocks],
                                    ['Updates', checkIn.updates],
                                    ['Career goals', checkIn.careerNotes],
                                    ['Employee notes', checkIn.employeeNotes]
                                ]
                                    .filter(([, value]) => value)
                                    .map(([label, value]) => (
                                        <div key={label}>
                                            <Text type='secondary' style={{ fontSize: 12 }}>{label}</Text>
                                            <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{value}</Paragraph>
                                        </div>
                                    ))}
                                {checkIn.managerFeedback ? (
                                    <Alert type='success' icon={<CommentOutlined />} showIcon message='Manager feedback' description={checkIn.managerFeedback} />
                                ) : null}
                                {checkIn.actionItems?.length ? (
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        {checkIn.actionItems.filter(a => a.done).length} of {checkIn.actionItems.length} action items done
                                    </Text>
                                ) : null}
                            </Space>
                        </Card>
                    ))
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={`No check-ins yet. Aim for one at least every ${CHECK_IN_DUE_DAYS} days.`}
                    />
                )}
            </Space>
            {editor}
        </Drawer>
    )
}
