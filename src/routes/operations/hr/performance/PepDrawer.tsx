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
    Select,
    Space,
    Switch,
    Tag,
    Tooltip,
    Typography,
    message
} from 'antd'
import { CheckCircleFilled, DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { EditableRows } from './EditableRows'
import { clean, newId, signatureFor } from './signature'
import {
    PEP_OUTCOMES,
    PEP_STATUSES,
    pepProblems,
    type EnhancementPlan,
    type PepAction,
    type PepDeficiency,
    type PepReview,
    type PerformanceCycle
} from './ipm'
import type { CompactEmployee, CompactMode } from './CompactDrawer'

const { Text, Paragraph } = Typography
const { RangePicker } = DatePicker

type Draft = Omit<EnhancementPlan, 'id' | 'employeeAuthUid'> & { id?: string }

const statusTag = (status: EnhancementPlan['status']) => {
    const meta = PEP_STATUSES.find(s => s.value === status) || PEP_STATUSES[0]
    return (
        <Tag color={meta.color} style={{ borderRadius: 999, margin: 0 }}>
            {meta.label}
        </Tag>
    )
}

const blankPlan = (cycleId?: string | null): Draft => ({
    status: 'draft',
    cycleId: cycleId || null,
    startDate: dayjs().format('YYYY-MM-DD'),
    endDate: dayjs().add(3, 'month').format('YYYY-MM-DD'),
    deficiencies: [{ id: newId('def'), area: '', expected: '', actual: '' }],
    actions: [{ id: newId('act'), action: '', support: '', owner: 'employee' }],
    reviews: [],
    outcome: null,
    outcomeNotes: '',
    signoff: {}
})

/**
 * Performance Enhancement Plan: where deficiencies are found, what good looks
 * like, the actions and support to close the gap, regular reviews, and the
 * outcome (improved, extended, training, counselling or disciplinary).
 */
export const PepDrawer: React.FC<{
    open: boolean
    onClose: () => void
    mode: CompactMode
    employee: CompactEmployee | null
    cycle: PerformanceCycle | null
    plans: EnhancementPlan[]
    user: { id: string; name: string; role: string }
    onSaved: () => void
}> = ({ open, onClose, mode, employee, cycle, plans, user, onSaved }) => {
    const isMobile = useIsMobile()
    const [draft, setDraft] = useState<Draft | null>(null)
    const [comment, setComment] = useState('')
    const [saving, setSaving] = useState(false)
    const isManage = mode === 'manage'

    const sorted = useMemo(() => [...plans].sort((a, b) => b.startDate.localeCompare(a.startDate)), [plans])

    // Open on the live plan (or the newest), as a working copy.
    useEffect(() => {
        if (!open) return
        const current = sorted.find(p => p.status === 'active') || sorted[0]
        setDraft(current ? clean(current) : isManage ? blankPlan(cycle?.id) : null)
        setComment(current?.employeeComment || '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, plans])

    const problems = draft && draft.status !== 'draft' ? pepProblems(draft) : []

    const patch = (value: Partial<Draft>) => setDraft(d => (d ? { ...d, ...value } : d))
    const patchRow = <K extends 'deficiencies' | 'actions' | 'reviews'>(key: K, id: string, value: Partial<Draft[K][number]>) =>
        setDraft(d => (d ? { ...d, [key]: (d[key] as any[]).map(row => (row.id === id ? { ...row, ...value } : row)) } : d))
    const removeRow = (key: 'deficiencies' | 'actions' | 'reviews', id: string) =>
        setDraft(d => (d ? { ...d, [key]: (d[key] as any[]).filter(row => row.id !== id) } : d))

    const save = async () => {
        if (!draft || !employee) return
        if (problems.length) {
            message.warning(problems[0])
            return
        }
        const employeeUid = employee.authUid || employee.id
        const record = clean({
            employeeAuthUid: employeeUid,
            employeeId: employee.id,
            employeeName: employee.name || '',
            lineManagerId: employee.lineManagerId || null,
            cycleId: draft.cycleId || cycle?.id || null,
            status: draft.status,
            startDate: draft.startDate,
            endDate: draft.endDate,
            deficiencies: draft.deficiencies.filter(d => d.area.trim()),
            actions: draft.actions.filter(a => a.action.trim()),
            reviews: draft.reviews.filter(r => r.progress.trim()),
            outcome: draft.outcome || null,
            outcomeNotes: draft.outcomeNotes || '',
            employeeComment: draft.employeeComment || '',
            signoff: draft.signoff || {},
            updatedBy: user.id
        })
        setSaving(true)
        try {
            if (draft.id) {
                await setDoc(doc(db, 'performanceEnhancementPlans', draft.id), { ...record, updatedAt: serverTimestamp() }, { merge: true })
            } else {
                await addDoc(collection(db, 'performanceEnhancementPlans'), {
                    ...record,
                    createdBy: user.id,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                })
            }
            message.success('Enhancement plan saved.')
            onSaved()
        } catch (error) {
            console.error(error)
            message.error('Could not save the plan.')
        } finally {
            setSaving(false)
        }
    }

    /** Employee: comment, and optionally acknowledge, the plan. */
    const respond = async (acknowledge: boolean) => {
        if (!draft?.id) return
        setSaving(true)
        try {
            await updateDoc(doc(db, 'performanceEnhancementPlans', draft.id), {
                employeeComment: comment,
                ...(acknowledge ? { 'signoff.employee': clean(await signatureFor(user)) } : {}),
                updatedAt: serverTimestamp()
            })
            message.success(acknowledge ? 'Plan acknowledged.' : 'Comment saved.')
            onSaved()
        } catch (error) {
            console.error(error)
            message.error('Could not save your response.')
        } finally {
            setSaving(false)
        }
    }

    const confirmAcknowledge = () =>
        Modal.confirm({
            title: 'Acknowledge this plan?',
            content: 'You confirm you have discussed the plan with your line manager and understand what is expected.',
            okText: 'Acknowledge',
            onOk: () => respond(true)
        })

    const readOnly = !isManage
    const acknowledged = draft?.signoff?.employee

    const body = draft ? (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
            {problems.length ? (
                <Alert
                    type='warning'
                    showIcon
                    message='Complete the plan before it goes live'
                    description={
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {problems.map(p => (
                                <li key={p}>{p}</li>
                            ))}
                        </ul>
                    }
                />
            ) : null}

            <Card size='small'>
                <Row gutter={[12, 12]}>
                    <Col xs={24} md={8}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Status</Text>
                        {readOnly ? (
                            <div>{statusTag(draft.status)}</div>
                        ) : (
                            <Select
                                style={{ width: '100%' }}
                                value={draft.status}
                                options={PEP_STATUSES.map(s => ({ value: s.value, label: s.label }))}
                                onChange={status => patch({ status })}
                            />
                        )}
                    </Col>
                    <Col xs={24} md={16}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Plan period</Text>
                        <RangePicker
                            style={{ width: '100%' }}
                            format='D MMM YYYY'
                            disabled={readOnly}
                            allowClear={false}
                            value={[dayjs(draft.startDate), dayjs(draft.endDate)]}
                            onChange={range =>
                                range?.[0] && range?.[1] && patch({ startDate: range[0].format('YYYY-MM-DD'), endDate: range[1].format('YYYY-MM-DD') })
                            }
                        />
                    </Col>
                </Row>
            </Card>

            <Card size='small' title='Performance deficiencies'>
                <EditableRows<PepDeficiency>
                    rows={draft.deficiencies}
                    isMobile={isMobile}
                    emptyText='No deficiencies recorded'
                    columns={[
                        {
                            title: 'Area',
                            key: 'area',
                            width: 200,
                            render: (_: unknown, row: PepDeficiency) => (
                                <Input disabled={readOnly} value={row.area} placeholder='e.g. Report deadlines' onChange={e => patchRow('deficiencies', row.id, { area: e.target.value })} />
                            )
                        },
                        {
                            title: 'Expected standard',
                            key: 'expected',
                            render: (_: unknown, row: PepDeficiency) => (
                                <Input.TextArea disabled={readOnly} autoSize={{ minRows: 1, maxRows: 4 }} value={row.expected} onChange={e => patchRow('deficiencies', row.id, { expected: e.target.value })} />
                            )
                        },
                        {
                            title: 'Current performance',
                            key: 'actual',
                            render: (_: unknown, row: PepDeficiency) => (
                                <Input.TextArea disabled={readOnly} autoSize={{ minRows: 1, maxRows: 4 }} value={row.actual} onChange={e => patchRow('deficiencies', row.id, { actual: e.target.value })} />
                            )
                        },
                        {
                            title: '',
                            key: 'remove',
                            width: 48,
                            render: (_: unknown, row: PepDeficiency) =>
                                readOnly ? null : (
                                    <Tooltip title='Remove'>
                                        <Button type='text' danger icon={<DeleteOutlined />} onClick={() => removeRow('deficiencies', row.id)} />
                                    </Tooltip>
                                )
                        }
                    ]}
                />
                {readOnly ? null : (
                    <Button type='link' icon={<PlusOutlined />} style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => patch({ deficiencies: [...draft.deficiencies, { id: newId('def'), area: '', expected: '', actual: '' }] })}>
                        Add deficiency
                    </Button>
                )}
            </Card>

            <Card size='small' title='Improvement actions and support'>
                <EditableRows<PepAction>
                    rows={draft.actions}
                    isMobile={isMobile}
                    emptyText='No actions yet'
                    scrollX={800}
                    columns={[
                        {
                            title: 'Action',
                            key: 'action',
                            width: 240,
                            render: (_: unknown, row: PepAction) => (
                                <Input.TextArea disabled={readOnly} autoSize={{ minRows: 1, maxRows: 4 }} value={row.action} placeholder='What will be done' onChange={e => patchRow('actions', row.id, { action: e.target.value })} />
                            )
                        },
                        {
                            title: 'Support',
                            key: 'support',
                            render: (_: unknown, row: PepAction) => (
                                <Input.TextArea disabled={readOnly} autoSize={{ minRows: 1, maxRows: 4 }} value={row.support} placeholder='Coaching, training, resources' onChange={e => patchRow('actions', row.id, { support: e.target.value })} />
                            )
                        },
                        {
                            title: 'Owner',
                            key: 'owner',
                            width: 130,
                            render: (_: unknown, row: PepAction) => (
                                <Select
                                    style={{ width: '100%' }}
                                    disabled={readOnly}
                                    value={row.owner}
                                    options={[
                                        { value: 'employee', label: 'Employee' },
                                        { value: 'manager', label: 'Manager' }
                                    ]}
                                    onChange={owner => patchRow('actions', row.id, { owner })}
                                />
                            )
                        },
                        {
                            title: 'Due',
                            key: 'due',
                            width: 140,
                            render: (_: unknown, row: PepAction) => (
                                <DatePicker
                                    style={{ width: '100%' }}
                                    disabled={readOnly}
                                    format='D MMM YYYY'
                                    value={row.due ? dayjs(row.due) : null}
                                    onChange={value => patchRow('actions', row.id, { due: value ? value.format('YYYY-MM-DD') : undefined })}
                                />
                            )
                        },
                        {
                            title: 'Done',
                            key: 'done',
                            width: 70,
                            render: (_: unknown, row: PepAction) => (
                                <Checkbox disabled={readOnly} checked={!!row.done} onChange={e => patchRow('actions', row.id, { done: e.target.checked })} />
                            )
                        },
                        {
                            title: '',
                            key: 'remove',
                            width: 48,
                            render: (_: unknown, row: PepAction) =>
                                readOnly ? null : (
                                    <Tooltip title='Remove'>
                                        <Button type='text' danger icon={<DeleteOutlined />} onClick={() => removeRow('actions', row.id)} />
                                    </Tooltip>
                                )
                        }
                    ]}
                />
                {readOnly ? null : (
                    <Button type='link' icon={<PlusOutlined />} style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => patch({ actions: [...draft.actions, { id: newId('act'), action: '', support: '', owner: 'employee' }] })}>
                        Add action
                    </Button>
                )}
            </Card>

            <Card size='small' title='Progress reviews'>
                <EditableRows<PepReview>
                    rows={draft.reviews}
                    isMobile={isMobile}
                    emptyText='No reviews yet'
                    columns={[
                        {
                            title: 'Date',
                            key: 'date',
                            width: 150,
                            render: (_: unknown, row: PepReview) => (
                                <DatePicker
                                    style={{ width: '100%' }}
                                    disabled={readOnly}
                                    format='D MMM YYYY'
                                    allowClear={false}
                                    value={dayjs(row.date)}
                                    onChange={value => value && patchRow('reviews', row.id, { date: value.format('YYYY-MM-DD') })}
                                />
                            )
                        },
                        {
                            title: 'Progress',
                            key: 'progress',
                            render: (_: unknown, row: PepReview) => (
                                <Input.TextArea disabled={readOnly} autoSize={{ minRows: 1, maxRows: 4 }} value={row.progress} onChange={e => patchRow('reviews', row.id, { progress: e.target.value })} />
                            )
                        },
                        {
                            title: 'On track',
                            key: 'onTrack',
                            width: 90,
                            render: (_: unknown, row: PepReview) => (
                                <Switch disabled={readOnly} checked={row.onTrack} onChange={onTrack => patchRow('reviews', row.id, { onTrack })} />
                            )
                        },
                        {
                            title: '',
                            key: 'remove',
                            width: 48,
                            render: (_: unknown, row: PepReview) =>
                                readOnly ? null : (
                                    <Tooltip title='Remove'>
                                        <Button type='text' danger icon={<DeleteOutlined />} onClick={() => removeRow('reviews', row.id)} />
                                    </Tooltip>
                                )
                        }
                    ]}
                />
                {readOnly ? null : (
                    <Button type='link' icon={<PlusOutlined />} style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => patch({ reviews: [...draft.reviews, { id: newId('rev'), date: dayjs().format('YYYY-MM-DD'), progress: '', onTrack: true }] })}>
                        Add review
                    </Button>
                )}
            </Card>

            <Card size='small' title='Outcome'>
                <Row gutter={[12, 12]}>
                    <Col xs={24} md={8}>
                        {readOnly ? (
                            <Text>{PEP_OUTCOMES.find(o => o.value === draft.outcome)?.label || 'Not decided yet'}</Text>
                        ) : (
                            <Select
                                allowClear
                                placeholder='Not decided yet'
                                style={{ width: '100%' }}
                                value={draft.outcome || undefined}
                                options={PEP_OUTCOMES}
                                onChange={outcome => patch({ outcome: outcome || null })}
                            />
                        )}
                    </Col>
                    <Col xs={24} md={16}>
                        {readOnly ? (
                            draft.outcomeNotes ? <Paragraph style={{ margin: 0 }}>{draft.outcomeNotes}</Paragraph> : null
                        ) : (
                            <Input.TextArea placeholder='Notes on the outcome' autoSize={{ minRows: 1, maxRows: 4 }} value={draft.outcomeNotes} onChange={e => patch({ outcomeNotes: e.target.value })} />
                        )}
                    </Col>
                </Row>
            </Card>

            <Card size='small' title='Employee response'>
                <Space direction='vertical' size={8} style={{ width: '100%' }}>
                    {acknowledged ? (
                        <Space size={6}>
                            <CheckCircleFilled style={{ color: '#52c41a' }} />
                            <Text>
                                Acknowledged by {acknowledged.name} on {dayjs(acknowledged.at).format('D MMM YYYY')}
                            </Text>
                        </Space>
                    ) : (
                        <Text type='secondary'>Not acknowledged yet.</Text>
                    )}
                    {isManage ? (
                        draft.employeeComment ? <Paragraph style={{ margin: 0 }}>{draft.employeeComment}</Paragraph> : <Text type='secondary'>No comment from the employee.</Text>
                    ) : (
                        <>
                            <Input.TextArea placeholder='Your comment on the plan' autoSize={{ minRows: 2, maxRows: 6 }} value={comment} onChange={e => setComment(e.target.value)} />
                            <Space wrap>
                                <Button onClick={() => respond(false)} loading={saving} disabled={!draft.id}>
                                    Save comment
                                </Button>
                                {acknowledged ? null : (
                                    <Button type='primary' onClick={confirmAcknowledge} loading={saving} disabled={!draft.id}>
                                        Acknowledge plan
                                    </Button>
                                )}
                            </Space>
                        </>
                    )}
                </Space>
            </Card>
        </Space>
    ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No enhancement plan.' />
    )

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={isMobile ? '100%' : 980}
            destroyOnClose
            title={
                <Space direction='vertical' size={0}>
                    <Text strong>{isManage ? `Enhancement plan · ${employee?.name || 'Employee'}` : 'My enhancement plan'}</Text>
                    {draft ? (
                        <Space size={6}>
                            {statusTag(draft.status)}
                            <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>
                                {dayjs(draft.startDate).format('D MMM YYYY')} – {dayjs(draft.endDate).format('D MMM YYYY')}
                            </Text>
                        </Space>
                    ) : null}
                </Space>
            }
            extra={
                isManage ? (
                    <Space>
                        {sorted.length > 1 || (draft?.id && sorted.length) ? (
                            <Select
                                style={{ width: isMobile ? 120 : 200 }}
                                value={draft?.id || 'new'}
                                onChange={id => {
                                    const plan = sorted.find(p => p.id === id)
                                    setDraft(plan ? clean(plan) : blankPlan(cycle?.id))
                                }}
                                options={[
                                    ...sorted.map(p => ({ value: p.id, label: `${dayjs(p.startDate).format('MMM YYYY')} · ${PEP_STATUSES.find(s => s.value === p.status)?.label}` })),
                                    { value: 'new', label: 'New plan' }
                                ]}
                            />
                        ) : null}
                        <Button type='primary' icon={<SaveOutlined />} loading={saving} onClick={save}>
                            Save
                        </Button>
                    </Space>
                ) : null
            }
        >
            {body}
        </Drawer>
    )
}
