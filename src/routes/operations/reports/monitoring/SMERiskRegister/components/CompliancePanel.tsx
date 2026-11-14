import { Empty, Progress, Space, Tag, Typography, theme } from 'antd'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    FileTextOutlined
} from '@ant-design/icons'

import type { ComplianceItemStatus, SMERow } from '../types'

const { Text } = Typography

type Props = {
    row: SMERow
}

const STATUS_META: Record<ComplianceItemStatus, { label: string; color: string; order: number }> = {
    missing: { label: 'Missing', color: 'red', order: 0 },
    expired: { label: 'Expired', color: 'volcano', order: 1 },
    rejected: { label: 'Rejected', color: 'red', order: 2 },
    queried: { label: 'Queried', color: 'gold', order: 3 },
    awaiting_review: { label: 'Awaiting review', color: 'blue', order: 4 },
    complete: { label: 'Complete', color: 'green', order: 5 }
}

/** The SME's compliance documents: counts, then each document, the ones needing action first. */
export default function CompliancePanel({ row }: Props) {
    const { token } = theme.useToken()

    const total = Number(row.docsTotal || 0)
    const completed = Number(row.docsCompleted || 0)
    const missing = Number(row.docsMissing || 0)
    const expired = Number(row.docsExpired || 0)
    const queriedOrRejected = Number(row.docsQueried || 0) + Number(row.docsRejected || 0)
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0

    const documents = [...(row.complianceItems ?? [])].sort(
        (a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || a.title.localeCompare(b.title)
    )

    const cards = [
        { label: 'Complete', value: completed, icon: <CheckCircleOutlined />, color: token.colorSuccess },
        { label: 'Missing', value: missing, icon: <FileTextOutlined />, color: token.colorError },
        { label: 'Expired', value: expired, icon: <ClockCircleOutlined />, color: token.colorWarning },
        { label: 'Queried or rejected', value: queriedOrRejected, icon: <CloseCircleOutlined />, color: token.colorInfo }
    ]

    return (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                {cards.map(card => (
                    <div
                        key={card.label}
                        style={{
                            minHeight: 72,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: 11,
                            padding: 11,
                            background: token.colorFillQuaternary
                        }}
                    >
                        <Space size={7}>
                            <span style={{ color: card.color, display: 'inline-flex' }}>{card.icon}</span>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                                {card.label}
                            </Text>
                        </Space>
                        <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{card.value}</div>
                    </div>
                ))}
            </div>

            <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 11, padding: 12 }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        marginBottom: 7
                    }}
                >
                    <Text strong>Compliance documents</Text>
                    <Text type="secondary">
                        {completed}/{total} complete
                    </Text>
                </div>
                <Progress percent={percent} status={completed < total ? 'active' : 'success'} />
            </div>

            {documents.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                    {documents.map(document => (
                        <div
                            key={document.key}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 10,
                                padding: '9px 12px',
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: 10
                            }}
                        >
                            <div style={{ minWidth: 0 }}>
                                <Text strong ellipsis={{ tooltip: document.title }} style={{ display: 'block' }}>
                                    {document.title}
                                </Text>
                                {document.detail ? (
                                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                                        {document.detail}
                                    </Text>
                                ) : null}
                            </div>
                            <Tag
                                color={STATUS_META[document.status].color}
                                style={{ marginInlineEnd: 0, borderRadius: 999, flex: '0 0 auto' }}
                            >
                                {STATUS_META[document.status].label}
                            </Tag>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No compliance documents are recorded for this SME."
                />
            )}
        </Space>
    )
}
