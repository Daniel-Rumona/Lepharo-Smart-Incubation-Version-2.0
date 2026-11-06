import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, List, Space, Tag, Tooltip, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, OpenAIOutlined, WarningOutlined } from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { auth, db } from '@/firebase'
import { useChatSession } from '@/routes/chat/ChatSessionContext'

const { Text } = Typography

type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical'

type Snapshot = {
    id: string
    participantName: string
    programId: string | null
    score: number
    level: RiskLevel
    trend: 'new' | 'up' | 'down' | 'same'
    previousScore: number | null
    reasons: { label: string; points: number }[]
    suggestion: { text: string; departmentRole: string | null } | null
    computedAt: Date | null
}

const LEVEL_COLOR: Record<RiskLevel, string> = {
    Critical: '#820014',
    High: '#cf1322',
    Medium: 'gold',
    Low: 'green'
}

type Props = {
    /** 'mine' shows only SMEs the signed-in user supports; 'all' shows every SME the rules allow. */
    scope: 'mine' | 'all'
    /** Limits the list to one programme; 'all' or empty shows every programme. */
    programId?: string | null
    limit?: number
}

/**
 * SMEs the nightly early-warning job (functions/src/smeRiskScoring.ts) rates High or
 * Critical, rising ones first, each with its reasons and a suggested next step the
 * assistant can turn into a change to confirm.
 */
export default function EarlyWarningPanel({ scope, programId, limit = 8 }: Props) {
    const navigate = useNavigate()
    const { startMessage } = useChatSession()
    const [rows, setRows] = useState<Snapshot[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const uid = auth.currentUser?.uid
        if (!uid) return
        let cancelled = false
        setLoading(true)
        // One filter per query keeps this off composite indexes; the rest is filtered here.
        const source = scope === 'mine'
            ? query(collection(db, 'smeRiskSnapshots'), where('ownerIds', 'array-contains', uid))
            : query(collection(db, 'smeRiskSnapshots'), where('level', 'in', ['High', 'Critical']))
        getDocs(source)
            .then(snapshot => {
                if (cancelled) return
                setRows(snapshot.docs.map(doc => {
                    const data = doc.data() as any
                    return {
                        id: doc.id,
                        participantName: String(data.participantName || 'SME'),
                        programId: data.programId || null,
                        score: Number(data.score || 0),
                        level: (data.level || 'Low') as RiskLevel,
                        trend: data.trend || 'same',
                        previousScore: typeof data.previousScore === 'number' ? data.previousScore : null,
                        reasons: Array.isArray(data.reasons) ? data.reasons : [],
                        suggestion: data.suggestion || null,
                        computedAt: data.computedAt?.toDate ? data.computedAt.toDate() : null
                    }
                }))
            })
            .catch(error => {
                console.error('Could not load early warnings', error)
                if (!cancelled) setRows([])
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [scope])

    const visible = useMemo(() => {
        const trendRank = { up: 0, new: 1, same: 2, down: 3 }
        return rows
            .filter(row => row.level === 'High' || row.level === 'Critical')
            .filter(row => !programId || programId === 'all' || !row.programId || row.programId === programId)
            .sort((a, b) => trendRank[a.trend] - trendRank[b.trend] || b.score - a.score)
            .slice(0, limit)
    }, [rows, programId, limit])

    const askAssistant = (row: Snapshot) => {
        const reasons = row.reasons.slice(0, 3).map(reason => reason.label).join('; ')
        const sent = startMessage(
            `${row.participantName} (participant id ${row.id}) is now ${row.level} risk: ${reasons}. ` +
            `${row.suggestion ? `Suggested next step: ${row.suggestion.text} ` : ''}` +
            'Prepare that step for me to confirm, or tell me what you need from me to do it.'
        )
        if (sent) navigate('/chat')
    }

    const updated = rows.find(row => row.computedAt)?.computedAt

    return (
        <Card
            title={
                <Space>
                    <WarningOutlined style={{ color: LEVEL_COLOR.High }} />
                    <span>Early warning</span>
                </Space>
            }
            extra={updated ? <Text type='secondary' style={{ fontSize: 12 }}>Updated {dayjs(updated).format('D MMM, HH:mm')}</Text> : null}
            loading={loading}
            styles={{ body: { paddingTop: 4 } }}
        >
            {!visible.length ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description='No SMEs are at high risk right now.'
                />
            ) : (
                <List
                    dataSource={visible}
                    renderItem={row => (
                        <List.Item
                            actions={[
                                <Tooltip key='ask' title='The assistant prepares the next step for you to confirm'>
                                    <Button
                                        size='small'
                                        shape='round'
                                        icon={<OpenAIOutlined />}
                                        onClick={() => askAssistant(row)}
                                    >
                                        Ask the assistant
                                    </Button>
                                </Tooltip>
                            ]}
                        >
                            <List.Item.Meta
                                title={
                                    <Space size={8} wrap>
                                        <Text strong>{row.participantName}</Text>
                                        <Tag color={LEVEL_COLOR[row.level]}>{row.level} · {row.score}</Tag>
                                        {row.trend === 'up' && (
                                            <Text type='danger' style={{ fontSize: 12 }}>
                                                <ArrowUpOutlined /> up {row.score - (row.previousScore ?? row.score)}
                                            </Text>
                                        )}
                                        {row.trend === 'down' && (
                                            <Text type='success' style={{ fontSize: 12 }}>
                                                <ArrowDownOutlined /> down {(row.previousScore ?? row.score) - row.score}
                                            </Text>
                                        )}
                                        {row.trend === 'new' && <Tag>New</Tag>}
                                    </Space>
                                }
                                description={
                                    <Space direction='vertical' size={2}>
                                        <Text type='secondary'>
                                            {row.reasons.slice(0, 3).map(reason => reason.label).join(' · ')}
                                        </Text>
                                        {row.suggestion && (
                                            <Text style={{ fontSize: 13 }}>Next step: {row.suggestion.text}</Text>
                                        )}
                                    </Space>
                                }
                            />
                        </List.Item>
                    )}
                />
            )}
        </Card>
    )
}
