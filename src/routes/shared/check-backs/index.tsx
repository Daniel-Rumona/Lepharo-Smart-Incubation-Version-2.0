import React, { useEffect, useMemo, useState } from 'react'
import {
    Avatar,
    Button,
    Col,
    Empty,
    Input,
    message,
    Popconfirm,
    Row,
    Segmented,
    Skeleton,
    Space,
    Tag,
    Typography,
} from 'antd'
import {
    BellOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    EditOutlined,
    HourglassOutlined,
    MinusCircleOutlined,
    UserOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    query,
    updateDoc,
    where,
    type Query,
    type QuerySnapshot,
} from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard, useMetricPalette } from '@/components/dashboards/metrics/Header'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'

dayjs.extend(relativeTime)

const { Text, Title } = Typography

type FollowUp = {
    id: string
    assignedInterventionId: string
    participantId?: string
    participantEmail?: string
    participantName?: string
    interventionTitle?: string
    deliverableName?: string
    intendedOutcome?: string
    assigneeId?: string
    assigneeName?: string
    smeCheckIn?: boolean
    dueAt?: any
    answeredAt?: any
    answer?: 'not_yet' | 'partial' | 'achieved'
    answerNote?: string
    smeAnswer?: 'yes' | 'partly' | 'no'
}

type TabKey = 'due' | 'upcoming' | 'done'

const ANSWERS = [
    { value: 'achieved', label: 'Achieved', icon: <CheckCircleOutlined />, color: '#52c41a' },
    { value: 'partial', label: 'Partially', icon: <MinusCircleOutlined />, color: '#fa8c16' },
    { value: 'not_yet', label: 'Not yet', icon: <CloseCircleOutlined />, color: '#ff4d4f' },
] as const

const RESULT: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    achieved: { label: 'Achieved', color: '#52c41a', icon: <CheckCircleOutlined /> },
    partial: { label: 'Partially', color: '#fa8c16', icon: <MinusCircleOutlined /> },
    not_yet: { label: 'Not yet', color: '#ff4d4f', icon: <CloseCircleOutlined /> },
}
const SME_TEXT: Record<string, string> = {
    yes: 'still using it',
    partly: 'partly using it',
    no: 'no longer using it',
}

const clean = (value: unknown) => String(value ?? '').trim()
const norm = (value: unknown) => clean(value).toLowerCase()

/**
 * SME photos live on users/{uid}, matched by email. Follow-ups store the SME's
 * email; older ones without it fall back to the participant record. Photos are
 * a nice-to-have, so any failure just leaves the initials avatar.
 */
const useSmePhotos = (items: FollowUp[]) => {
    const [photos, setPhotos] = useState<Record<string, string>>({})
    const key = useMemo(
        () => Array.from(new Set(items.map((i) => `${clean(i.participantId)}|${norm(i.participantEmail)}`))).sort().join(','),
        [items]
    )

    useEffect(() => {
        let cancelled = false
        const pairs = key ? key.split(',').map((pair) => pair.split('|')) : []
        void (async () => {
            const emailByParticipant = new Map<string, string>()
            await Promise.all(pairs.map(async ([pid, email]) => {
                if (!pid) return
                if (email) { emailByParticipant.set(pid, email); return }
                try {
                    const data = (await getDoc(doc(db, 'participants', pid))).data() as any
                    const resolved = norm(data?.email || data?.participantEmail || data?.contactEmail || data?.contactInfo?.email)
                    if (resolved) emailByParticipant.set(pid, resolved)
                } catch {
                    // No photo for this SME.
                }
            }))

            const urlByEmail = new Map<string, string>()
            const emails = Array.from(new Set(emailByParticipant.values()))
            for (let i = 0; i < emails.length; i += 10) {
                try {
                    const snap = await getDocs(query(collection(db, 'users'), where('email', 'in', emails.slice(i, i + 10))))
                    snap.docs.forEach((d) => {
                        const data = d.data() as any
                        const url = clean(data.photoURL)
                        if (url && data.email) urlByEmail.set(norm(data.email), url)
                    })
                } catch (error) {
                    console.warn('Could not load SME photos', error)
                }
            }

            const next: Record<string, string> = {}
            emailByParticipant.forEach((email, pid) => {
                const url = urlByEmail.get(email)
                if (url) next[pid] = url
            })
            if (!cancelled) setPhotos(next)
        })()
        return () => { cancelled = true }
    }, [key])

    return photos
}

const dueMillis = (item: FollowUp) => item.dueAt?.toMillis?.() ?? 0
const initials = (name?: string) =>
    String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

/** One check-back. The accent bar and chip say at a glance whether it is overdue, coming up or done. */
const CheckBackCard: React.FC<{ item: FollowUp; uid: string; canAnswer: boolean; tab: TabKey; photoUrl?: string }> = ({ item, uid, canAnswer, tab, photoUrl }) => {
    const palette = useMetricPalette()
    const [note, setNote] = useState('')
    const [showNote, setShowNote] = useState(false)
    const [saving, setSaving] = useState<string | null>(null)

    const due = item.dueAt?.toDate ? dayjs(item.dueAt.toDate()) : null
    const overdueDays = due ? dayjs().startOf('day').diff(due.startOf('day'), 'day') : 0

    const accent = item.answer
        ? RESULT[item.answer]?.color
        : tab === 'upcoming'
            ? '#1677ff'
            : overdueDays > 7 ? '#ff4d4f' : '#fa8c16'

    const chip = item.answer ? (
        <Tag color="success" style={{ marginInlineEnd: 0, borderRadius: 999 }}>Answered</Tag>
    ) : tab === 'upcoming' ? (
        <Tag icon={<ClockCircleOutlined />} style={{ marginInlineEnd: 0, borderRadius: 999 }}>
            Opens {due ? due.format('D MMM') : 'soon'}
        </Tag>
    ) : (
        <Tag
            icon={<HourglassOutlined />}
            color={overdueDays > 7 ? 'error' : 'warning'}
            style={{ marginInlineEnd: 0, borderRadius: 999 }}
        >
            {overdueDays <= 0 ? 'Due today' : `Overdue ${overdueDays} day${overdueDays === 1 ? '' : 's'}`}
        </Tag>
    )

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

    return (
        <div
            style={{
                display: 'flex',
                background: palette.surface,
                border: `1px solid ${palette.chipBorder}`,
                borderRadius: 14,
                overflow: 'hidden',
                boxShadow: palette.isDark ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
            }}
        >
            <div style={{ width: 5, background: accent, flex: '0 0 5px' }} />
            <div style={{ flex: 1, minWidth: 0, padding: '10px 14px' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Avatar size={32} src={photoUrl || undefined} style={{ background: `${accent}22`, color: accent, flex: '0 0 auto' }}>
                        {item.participantName ? initials(item.participantName) : <UserOutlined />}
                    </Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text strong style={{ fontSize: 14, lineHeight: 1.35, minWidth: 0, maxWidth: '100%' }} ellipsis>
                                {item.interventionTitle || 'Intervention'}
                            </Text>
                            {chip}
                            {item.deliverableName ? <Tag color="blue" style={{ marginInlineEnd: 0, borderRadius: 999 }}>{item.deliverableName}</Tag> : null}
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                            {item.participantName || 'SME'}
                            {item.assigneeName && canAnswer === false ? ` · Facilitator: ${item.assigneeName}` : ''}
                        </Text>
                    </div>
                </div>

                {(item.smeCheckIn && !item.answer) || item.smeAnswer ? (
                    <Space size={6} wrap style={{ marginTop: 8 }}>
                        {item.smeCheckIn && !item.smeAnswer && !item.answer ? (
                            <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>Waiting for the SME too</Tag>
                        ) : null}
                        {item.smeAnswer ? (
                            <Tag color="processing" style={{ marginInlineEnd: 0, borderRadius: 999 }}>
                                SME says {SME_TEXT[item.smeAnswer]}
                            </Tag>
                        ) : null}
                    </Space>
                ) : null}

                {item.intendedOutcome ? (
                    <div
                        style={{
                            marginTop: 8,
                            padding: '6px 10px',
                            borderRadius: 8,
                            background: palette.filterBarBg,
                            border: `1px solid ${palette.filterBarBorder}`,
                            fontSize: 13,
                        }}
                    >
                        <Text type="secondary" style={{ fontSize: 13 }}>Intended outcome: </Text>
                        <Text style={{ fontSize: 13 }}>{item.intendedOutcome}</Text>
                    </div>
                ) : null}

                {item.answer ? (
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Tag
                            icon={RESULT[item.answer]?.icon}
                            style={{
                                marginInlineEnd: 0,
                                borderRadius: 999,
                                color: RESULT[item.answer]?.color,
                                borderColor: RESULT[item.answer]?.color,
                                background: 'transparent',
                                fontWeight: 600,
                            }}
                        >
                            {RESULT[item.answer]?.label}
                        </Tag>
                        {item.answeredAt?.toDate ? (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                {dayjs(item.answeredAt.toDate()).format('D MMM YYYY')}
                            </Text>
                        ) : null}
                        {item.answerNote ? <Text type="secondary">“{item.answerNote}”</Text> : null}
                    </div>
                ) : tab === 'due' && canAnswer ? (
                    <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <Text strong style={{ fontSize: 13 }}>How is it going?</Text>
                            <Row gutter={8} style={{ flex: '1 1 320px' }}>
                                {ANSWERS.map((answer) => (
                                    <Col span={8} key={answer.value}>
                                        <Popconfirm
                                            title={`Record as "${answer.label}"?`}
                                            description="This can't be changed afterwards."
                                            okText="Record"
                                            cancelText="Cancel"
                                            onConfirm={() => record(answer.value)}
                                        >
                                            <Button
                                                block
                                                shape="round"
                                                icon={answer.icon}
                                                loading={saving === answer.value}
                                                disabled={!!saving && saving !== answer.value}
                                                style={{ color: answer.color, borderColor: answer.color, fontWeight: 600 }}
                                            >
                                                {answer.label}
                                            </Button>
                                        </Popconfirm>
                                    </Col>
                                ))}
                            </Row>
                        </div>
                        {showNote ? (
                            <Input.TextArea
                                rows={2}
                                maxLength={1000}
                                value={note}
                                onChange={(event) => setNote(event.target.value)}
                                placeholder="What did you see? (optional, saved with your answer)"
                                style={{ marginTop: 8 }}
                            />
                        ) : (
                            <Button type="link" size="small" icon={<EditOutlined />} style={{ padding: 0, marginTop: 4, height: 'auto' }} onClick={() => setShowNote(true)}>
                                Add a note
                            </Button>
                        )}
                    </div>
                ) : tab === 'due' ? (
                    <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 13 }}>
                        Waiting for {item.assigneeName || 'the facilitator'} to answer.
                    </Text>
                ) : null}
            </div>
        </div>
    )
}

const CheckBacks: React.FC = () => {
    const { user } = useFullIdentity()
    const [byId, setById] = useState<Record<string, FollowUp>>({})
    const [loading, setLoading] = useState(true)
    const [tab, setTab] = useState<TabKey>('due')
    const [search, setSearch] = useState('')

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
        const text = search.trim().toLowerCase()
        const all = Object.values(byId).filter(
            (item) =>
                !text ||
                String(item.interventionTitle || '').toLowerCase().includes(text) ||
                String(item.participantName || '').toLowerCase().includes(text)
        )
        return {
            due: all.filter((i) => !i.answer && dueMillis(i) <= now).sort((a, b) => dueMillis(a) - dueMillis(b)),
            upcoming: all.filter((i) => !i.answer && dueMillis(i) > now).sort((a, b) => dueMillis(a) - dueMillis(b)),
            done: all.filter((i) => !!i.answer).sort((a, b) => dueMillis(b) - dueMillis(a)),
        }
    }, [byId, search])

    const allItems = useMemo(() => Object.values(byId), [byId])
    const photos = useSmePhotos(allItems)
    const achieved = done.filter((i) => i.answer === 'achieved').length
    const canAnswer = (item: FollowUp) => item.assigneeId === uid || isOversight

    const tabStyle = (key: TabKey): React.CSSProperties =>
        tab === key ? { outline: '2px solid rgba(22,119,255,0.45)', outlineOffset: 0, borderRadius: 14 } : {}

    const metrics: DashboardMetric[] = [
        {
            key: 'due',
            title: 'Due now',
            value: due.length,
            subtitle: due.length ? 'Waiting for an answer' : 'All caught up',
            icon: <HourglassOutlined />,
            tone: 'warning' as const,
            important: true,
            onClick: () => setTab('due'),
            wrapperStyle: tabStyle('due'),
        },
        {
            key: 'upcoming',
            title: 'Coming up',
            value: upcoming.length,
            subtitle: 'Not due yet',
            icon: <ClockCircleOutlined />,
            tone: 'info' as const,
            important: true,
            onClick: () => setTab('upcoming'),
            wrapperStyle: tabStyle('upcoming'),
        },
        {
            key: 'done',
            title: 'Answered',
            value: done.length,
            subtitle: 'Recorded so far',
            icon: <CheckCircleOutlined />,
            tone: 'success' as const,
            onClick: () => setTab('done'),
            wrapperStyle: tabStyle('done'),
        },
        {
            key: 'achieved',
            title: 'Change held',
            value: done.length ? `${achieved} of ${done.length}` : '0',
            subtitle: 'Answered "Achieved"',
            icon: <CheckCircleOutlined />,
            tone: 'info' as const,
        },
    ]

    const current = tab === 'due' ? due : tab === 'upcoming' ? upcoming : done
    const empty: Record<TabKey, { title: string; hint: string }> = {
        due: { title: 'Nothing is waiting for a check-back', hint: 'When an intervention you delivered is due for follow-up, it will appear here and you will be reminded.' },
        upcoming: { title: 'No check-backs scheduled', hint: 'They are scheduled once an SME confirms an intervention that asks for a check-back.' },
        done: { title: 'No answers recorded yet', hint: 'Answered check-backs and their results will be listed here.' },
    }

    return (
        <div style={{ minHeight: '100vh', padding: 24 }}>
            <Helmet>
                <title>Check-backs | Smart Incubation</title>
                <meta name="description" content="Confirm whether the change from a finished intervention is still in place." />
            </Helmet>

            <div style={{ marginBottom: 16 }}>
                <MetricsGrid metrics={metrics} />
            </div>

            <MotionCard
                filterBar={
                    <Row gutter={[12, 12]} align="middle" wrap>
                        <Col flex="auto" style={{ minWidth: 220 }}>
                            <Input.Search
                                allowClear
                                placeholder="Search intervention or SME"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                            />
                        </Col>
                        <Col flex="none" style={{ maxWidth: '100%', overflowX: 'auto' }}>
                            <Segmented
                                value={tab}
                                onChange={(value) => setTab(value as TabKey)}
                                options={[
                                    { value: 'due', icon: <BellOutlined />, label: `Due now (${due.length})` },
                                    { value: 'upcoming', icon: <CalendarOutlined />, label: `Coming up (${upcoming.length})` },
                                    { value: 'done', icon: <CheckCircleOutlined />, label: `Answered (${done.length})` },
                                ]}
                            />
                        </Col>
                    </Row>
                }
            >
                {loading ? (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        {[0, 1].map((i) => (
                            <div key={i} style={{ padding: 16, border: '1px solid rgba(128,128,128,0.2)', borderRadius: 14 }}>
                                <Skeleton active avatar paragraph={{ rows: 2 }} />
                            </div>
                        ))}
                    </Space>
                ) : current.length ? (
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        {current.map((item) => (
                            <CheckBackCard key={item.id} item={item} uid={uid} canAnswer={canAnswer(item)} tab={tab} photoUrl={photos[clean(item.participantId)]} />
                        ))}
                    </Space>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        style={{ padding: '32px 0' }}
                        description={
                            <Space direction="vertical" size={2}>
                                <Text strong>{search ? 'No matches' : empty[tab].title}</Text>
                                <Text type="secondary" style={{ maxWidth: 420, display: 'inline-block' }}>
                                    {search ? 'Try a different search.' : empty[tab].hint}
                                </Text>
                            </Space>
                        }
                    />
                )}
            </MotionCard>
        </div>
    )
}

export default CheckBacks
