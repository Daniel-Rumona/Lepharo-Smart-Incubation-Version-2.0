import {
    Empty,
    Progress,
    Space,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    FileSearchOutlined,
    FileTextOutlined
} from '@ant-design/icons'

import type { SMERow } from '../types'

const { Text } = Typography

type Props = {
    row: SMERow
}

type DocumentRow = {
    key: string
    title: string
    status: string
}

const normalizeDocuments = (row: SMERow): DocumentRow[] => {
    const rawRow = row as any

    const candidates = [
        rawRow.complianceDocuments,
        rawRow.documents,
        rawRow.documentStatuses,
        rawRow.requiredDocuments
    ]

    const list = candidates.find(Array.isArray)

    if (!Array.isArray(list)) return []

    return list.map((item: any, index: number) => ({
        key: String(
            item?.id ||
                item?.key ||
                item?.requirementId ||
                index
        ),
        title: String(
            item?.title ||
                item?.name ||
                item?.documentName ||
                item?.requirementTitle ||
                `Document ${index + 1}`
        ),
        status: String(
            item?.status ||
                item?.state ||
                item?.reviewStatus ||
                (item?.completed ? 'complete' : 'missing')
        ).toLowerCase()
    }))
}

const statusColor = (status: string) => {
    if (
        status.includes('complete') ||
        status.includes('approved') ||
        status.includes('accepted')
    ) {
        return 'green'
    }

    if (
        status.includes('reject') ||
        status.includes('invalid')
    ) {
        return 'red'
    }

    if (
        status.includes('quer') ||
        status.includes('review') ||
        status.includes('pending')
    ) {
        return 'gold'
    }

    return 'default'
}

export default function CompliancePanel({ row }: Props) {
    const { token } = theme.useToken()

    const completed = Number(row.docsCompleted || 0)
    const total = Number(row.docsTotal || 0)
    const missing = Math.max(0, total - completed)
    const queried = Number(row.docsQueried || 0)
    const rejected = Number(row.docsRejected || 0)

    const documents = normalizeDocuments(row)

    const percent =
        total > 0
            ? Math.round((completed / total) * 100)
            : 0

    const cards = [
        {
            label: 'Complete',
            value: completed,
            icon: <CheckCircleOutlined />,
            color: token.colorSuccess
        },
        {
            label: 'Outstanding',
            value: missing,
            icon: <FileTextOutlined />,
            color: token.colorWarning
        },
        {
            label: 'Queried',
            value: queried,
            icon: <FileSearchOutlined />,
            color: token.colorInfo
        },
        {
            label: 'Rejected',
            value: rejected,
            icon: <CloseCircleOutlined />,
            color: token.colorError
        }
    ]

    return (
        <Space
            direction="vertical"
            size={14}
            style={{ width: '100%' }}
        >
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns:
                        'repeat(4, minmax(0, 1fr))',
                    gap: 8
                }}
            >
                {cards.map(card => (
                    <div
                        key={card.label}
                        style={{
                            minHeight: 72,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: 11,
                            padding: 11,
                            background:
                                token.colorFillQuaternary
                        }}
                    >
                        <Space size={7}>
                            <span
                                style={{
                                    color: card.color,
                                    display: 'inline-flex'
                                }}
                            >
                                {card.icon}
                            </span>
                            <Text
                                type="secondary"
                                style={{ fontSize: 11 }}
                            >
                                {card.label}
                            </Text>
                        </Space>

                        <div
                            style={{
                                marginTop: 6,
                                fontWeight: 700,
                                fontSize: 18
                            }}
                        >
                            {card.value}
                        </div>
                    </div>
                ))}
            </div>

            <div
                style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 11,
                    padding: 12
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        marginBottom: 7
                    }}
                >
                    <Text strong>
                        Compliance documents
                    </Text>
                    <Text type="secondary">
                        {completed}/{total} complete
                    </Text>
                </div>

                <Progress
                    percent={percent}
                    status={
                        missing > 0 ? 'active' : 'success'
                    }
                />
            </div>

            {documents.length > 0 ? (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            'repeat(2, minmax(0, 1fr))',
                        gap: 8
                    }}
                >
                    {documents.map(document => (
                        <div
                            key={document.key}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent:
                                    'space-between',
                                gap: 8,
                                padding: '9px 11px',
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: 10
                            }}
                        >
                            <Text
                                ellipsis={{
                                    tooltip: document.title
                                }}
                                style={{
                                    minWidth: 0
                                }}
                            >
                                {document.title}
                            </Text>

                            <Tag
                                color={statusColor(
                                    document.status
                                )}
                                style={{
                                    marginInlineEnd: 0,
                                    borderRadius: 999,
                                    flex: '0 0 auto'
                                }}
                            >
                                {document.status ||
                                    'Unknown'}
                            </Tag>
                        </div>
                    ))}
                </div>
            ) : missing > 0 ? (
                <div
                    style={{
                        padding: 12,
                        borderRadius: 10,
                        background: token.colorWarningBg,
                        border: `1px solid ${token.colorWarningBorder}`
                    }}
                >
                    <Text>
                        {missing} document
                        {missing === 1 ? '' : 's'}{' '}
                        outstanding.
                    </Text>
                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            marginTop: 3,
                            fontSize: 12
                        }}
                    >
                        The current SME risk row contains the
                        compliance counts but not the individual
                        document names. Once document-level
                        compliance data is included on the row,
                        this section will list exactly which
                        documents are missing, queried or rejected.
                    </Text>
                </div>
            ) : (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No compliance document detail is available."
                />
            )}
        </Space>
    )
}
