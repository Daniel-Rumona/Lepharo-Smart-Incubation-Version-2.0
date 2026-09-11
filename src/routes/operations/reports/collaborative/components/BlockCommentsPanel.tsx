import React, { useEffect, useState } from 'react'
import { Button, Empty, Input, Space, Typography, message } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { db } from '@/firebase'
import { addReportComment, listenReportComments } from '../services/reportsService'
import type { ReportComment, ReportUserContext } from '../types'
import { formatTimestamp } from '../shared'

const { Text } = Typography

type Props = {
    blockId: string
    user: ReportUserContext
}

const BlockCommentsPanel: React.FC<Props> = ({ blockId, user }) => {
    const [comments, setComments] = useState<ReportComment[]>([])
    const [text, setText] = useState('')
    const [sending, setSending] = useState(false)

    useEffect(() => listenReportComments(db, blockId, setComments), [blockId])

    const send = async () => {
        if (!text.trim()) return
        setSending(true)
        try {
            await addReportComment(db, blockId, user, text)
            setText('')
        } catch (err: any) {
            message.error(err?.message || 'Could not add comment.')
        } finally {
            setSending(false)
        }
    }

    return (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {comments.length ? comments.map(comment => (
                <div key={comment.id} style={{ paddingBottom: 10, borderBottom: '1px solid #edf1f5' }}>
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Text strong>{comment.createdByName}</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>{formatTimestamp(comment.createdAt)}</Text>
                    </Space>
                    <Text style={{ display: 'block', marginTop: 4 }}>{comment.text}</Text>
                </div>
            )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No comments yet" />}
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} value={text} onChange={e => setText(e.target.value)} placeholder="Add a comment..." />
            <Button type="primary" icon={<SendOutlined />} onClick={send} loading={sending} disabled={!text.trim()}>Comment</Button>
        </Space>
    )
}

export default BlockCommentsPanel
