import React, { useEffect, useState } from 'react'
import { Empty, Space, Tag, Typography } from 'antd'
import { db } from '@/firebase'
import { listenReportRevisions } from '../services/reportsService'
import type { ReportRevision } from '../types'
import { formatTimestamp } from '../shared'

const { Text } = Typography

const BlockHistoryPanel: React.FC<{ blockId: string }> = ({ blockId }) => {
    const [revisions, setRevisions] = useState<ReportRevision[]>([])
    useEffect(() => listenReportRevisions(db, blockId, setRevisions), [blockId])

    if (!revisions.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No saved revisions yet" />

    return (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {revisions.map((revision, index) => (
                <div key={revision.id} className="activity-item">
                    <Space size={6} wrap><Text strong>Version {revisions.length - index}</Text><Tag>{revision.status.replace(/_/g, ' ')}</Tag></Space>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>{revision.createdByName} · {formatTimestamp(revision.createdAt)}</Text>
                    {revision.summary ? <Text style={{ display: 'block', marginTop: 3, fontSize: 12 }}>{revision.summary}</Text> : null}
                </div>
            ))}
        </Space>
    )
}

export default BlockHistoryPanel
