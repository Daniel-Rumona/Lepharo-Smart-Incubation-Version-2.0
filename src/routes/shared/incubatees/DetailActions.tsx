import React from 'react'
import { Button } from 'antd'
import { DownloadOutlined, EditOutlined, MailOutlined } from '@ant-design/icons'
import { SmeRow } from './participantsData'
import { exportSingleSme } from './exportParticipants'

type DetailActionsProps = {
    record: SmeRow
    canEdit: boolean
    onEdit: (record: SmeRow) => void
    statusAction?: React.ReactNode
    /** Email this SME; only passed for roles that may send messages. */
    onMessage?: (record: SmeRow) => void
}

export const DetailActions: React.FC<DetailActionsProps> = ({ record, canEdit, onEdit, statusAction, onMessage }) => (
    <div className='ws-detail-actions'>
        {canEdit && <Button icon={<EditOutlined />} onClick={() => onEdit(record)}>Edit</Button>}
        {onMessage && record.participantId && <Button icon={<MailOutlined />} onClick={() => onMessage(record)}>Message</Button>}
        {statusAction}
        <Button data-guide='sme-export-one' icon={<DownloadOutlined />} onClick={() => exportSingleSme(record)}>Export</Button>
    </div>
)
