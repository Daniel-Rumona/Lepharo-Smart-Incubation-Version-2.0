import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Col,
    Empty,
    Input,
    message,
    Popconfirm,
    Row,
    Skeleton,
    Space,
    Tabs,
    Tag,
    Typography,
} from 'antd'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
    collection,
    doc,
    limit,
    onSnapshot,
    query,
    updateDoc,
    where,
    type Query,
    type QuerySnapshot,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'

dayjs.extend(relativeTime)

const { Text, Title } = Typography

type FollowUp = {
    id: string
    assignedInterventionId: string
    participantName?: string
    interventionTitle?: string
    deliverableName?: string
    intendedOutcome?: string
    assigneeId?: string
    assigneeName?: string
    smeCheckIn?: boolean
    dueAt?: any
    answer?: 'not_yet' | 'partial' | 'achieved'
    answerNote?: string
    smeAnswer?: 'yes' | 'partly' | 'no'
}

const ANSWERS = [
    { value: 'achieved', label: 'Achieved', type: 'primary' as const, danger: false },
    { value: 'partial', label: 'Partially', type: 'default' as const, danger: false },
    { value: 'not_yet', label: 'Not yet', type: 'default' as const, danger: true },
]

const ANSWER_TEXT: Record<string, { label: string; color: string }> = {
    achieved: { label: 'Achieved', color: 'green' },
    partial: { label: 'Partially', color: 'orange' },
    not_yet: { label: 'Not yet', color: 'red' },
}
const SME_TEXT: Record<string, string> = {
    yes: 'still using it',
    partly: 'partly using it',
    no: 'no longer using it',
}

const dueMillis = (item: FollowUp) => item.dueAt?.toMillis?.() ?? 0

const CheckBackCard: React.FC<{
    item: FollowUp
    uid: string
    canAnswer: boolean
}> = ({ item, uid, canAnswer }) => {
    const [note, setNote] = useState('')
    const [showNote, setShowNote] = useState(false)
    const [saving, setSaving] = useState<string | null>(null)

    const record = async (answer: string) => {
        setSaving(answer)
        try {
            await updateDoc(doc(db, 'outcomeFollowUps', item.id), {
                answer,
                answeredVia: 'app',
                answeredBy: uid,
                ...(note.trim() ? { answerNote: note.trim().slice(0, 1000) } : {}),
            })
            message.success('Recorded. Thank you.')
        } catch (error) {
            console.error('Failed to record check-back', error)
            message.error('Could not record that. It may already have been answered.')
        } finally {
            setSaving(null)
        }
    }

    const due = item.dueAt?.toDate ? dayjs(item.dueAt.toDate()) : null

    return (
        <Card size="small" style={{ border: '1px solid #d9d9d9' }}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <div>
                    <Text strong>{item.interventionTitle || 'Intervention'}</Text>
                    {item.participantName ? <Text type="secondary"> · {item.participantName}</Text> : null}
                </div>
                {item.deliverableName ? <Tag>{item.deliverableName}</Tag> : null}
                {item.intendedOutcome ? (
                    <Text>
                        <Text type="secondary">What we wanted to see: </Text>
                        {item.intendedOutcome}
                    </Text>
                ) : null}
                {due ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {due.isBefore(dayjs()) ? `Due ${due.fromNow()}` : `Due ${due.format('D MMM YYYY')}`}
                        {item.assigneeName ? ` · Facilitator: ${item.assigneeName}` : ''}
                    </Text>
                ) : null}

                {item.answer ? (
                    <Space wrap>
                        <Tag color={ANSWER_TEXT[item.answer]?.color}>{ANSWER_TEXT[item.answer]?.label}</Tag>
                        {item.smeAnswer ? <Tag>SME says {SME_TEXT[item.smeAnswer]}</Tag> : null}
                        {item.answerNote ? <Text type="secondary">{item.answerNote}</Text> : null}
                    </Space>
                ) : (
                    <>
                        {item.smeAnswer ? <Tag>SME says {SME_TEXT[item.smeAnswer]}</Tag> : null}
                        {canAnswer ? (
                            <>
                                {showNote ? (
                                    <Input.TextArea
                                        rows={2}
                                        maxLength={1000}
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="What did you see? (optional)"
                                    />
                                ) : (
                                    <Button type="link" size="small" style={{ padding: 0, width: 'fit-content' }} onClick={() => setShowNote(true)}>
                                        Add a note
                                    </Button>
                                )}
                                <Row gutter={8}>
                                    {ANSWERS.map((a) => (
                                        <Col span={8} key={a.value}>
                                            <Popconfirm
                                                title={`Record as "${a.label}"?`}
                                                description="This can't be changed afterwards."
                                                okText="Record"
                                                cancelText="Cancel"
                                                onConfirm={() => record(a.value)}
                                            >
                                                <Button
                                                    block
                                                    shape="round"
                                                    type={a.type}
                                                    danger={a.danger}
                                                    loading={saving === a.value}
                                                    disabled={!!saving && saving !== a.value}
                                                >
                                                    {a.label}
                                                </Button>
                                            </Popconfirm>
                                        </Col>
                                    ))}
                                </Row>
                            </>
                        ) : (
                            <Text type="secondary">Waiting for the facilitator.</Text>
                        )}
                    </>
                )}
            </Space>
        </Card>
    )
}

const CheckBacks: React.FC = () => {
    const { user } = useFullIdentity()
    const [byId, setById] = useState<Record<string, FollowUp>>({})
    const [loading, setLoading] = useState(true)

    const uid = user?.uid || ''
    const role = String(user?.role || '')
    const departmentId = String(user?.departmentId || '')
    const isOversight = ['operations', 'admin', 'system_admin'].includes(role)

    useEffect(() => {
        if (!uid) return
        setLoading(true)
        setById({})
        const unsubscribers: Array<() => void> = []
        let pending = 0

        const listen = (q: Query) => {
            pending += 1
            let first = true
            unsubscribers.push(
                onSnapshot(
                    q,
                    (snap: QuerySnapshot) => {
                        setById((prev) => {
                            const next = { ...prev }
                            snap.docs.forEach((d) => { next[d.id] = { id: d.id, ...d.data() } as FollowUp })
                            snap.docChanges().forEach((c) => { if (c.type === 'removed') delete next[c.doc.id] })
                            return next
                        })
                        if (first) { first = false; pending -= 1; if (pending <= 0) setLoading(false) }
                    },
                    (error) => {
                        console.error('Check-backs listener failed', error)
                        if (first) { first = false; pending -= 1; if (pending <= 0) setLoading(false) }
                    }
                )
            )
        }

        const base = collection(db, 'outcomeFollowUps')
        listen(query(base, where('assigneeId', '==', uid), limit(200)))
        if (isOversight && departmentId) listen(query(base, where('departmentId', '==', departmentId), limit(200)))
        if (['admin', 'system_admin'].includes(role)) listen(query(base, limit(200)))

        return () => unsubscribers.forEach((fn) => fn())
    }, [uid, role, departmentId, isOversight])

    const { due, upcoming, done } = useMemo(() => {
        const now = Date.now()
        const all = Object.values(byId)
        return {
            due: all.filter((i) => !i.answer && dueMillis(i) <= now).sort((a, b) => dueMillis(a) - dueMillis(b)),
            upcoming: all.filter((i) => !i.answer && dueMillis(i) > now).sort((a, b) => dueMillis(a) - dueMillis(b)),
            done: all.filter((i) => !!i.answer).sort((a, b) => dueMillis(b) - dueMillis(a)),
        }
    }, [byId])

    const canAnswer = (item: FollowUp) => item.assigneeId === uid || isOversight

    const list = (items: FollowUp[], empty: string) =>
        loading ? <Skeleton active /> : items.length ? (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {items.map((item) => (
                    <CheckBackCard key={item.id} item={item} uid={uid} canAnswer={canAnswer(item)} />
                ))}
            </Space>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />

    return (
        <div style={{ padding: 16, maxWidth: 820, margin: '0 auto' }}>
            <Title level={4} style={{ marginTop: 0 }}>Check-backs</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                A short while after an intervention is finished, confirm whether the change is still in place.
            </Text>
            <Tabs
                defaultActiveKey="due"
                items={[
                    { key: 'due', label: `Due now (${due.length})`, children: list(due, 'Nothing is waiting for a check-back.') },
                    { key: 'upcoming', label: `Coming up (${upcoming.length})`, children: list(upcoming, 'No check-backs are scheduled yet.') },
                    { key: 'done', label: `Done (${done.length})`, children: list(done, 'No check-backs have been recorded yet.') },
                ]}
            />
        </div>
    )
}

export default CheckBacks
