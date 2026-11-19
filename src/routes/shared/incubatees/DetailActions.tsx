import React from 'react'
import { Button } from 'antd'
import { DownloadOutlined, EditOutlined } from '@ant-design/icons'
import { SmeRow } from './participantsData'
import { exportSingleSme } from './exportParticipants'

type DetailActionsProps = {
    record: SmeRow
    canEdit: boolean
    onEdit: (record: SmeRow) => void
    statusAction?: React.ReactNode
}

export const DetailActions: React.FC<DetailActionsProps> = ({ record, canEdit, onEdit, statusAction }) => (
    <div className='ws-detail-actions'>
        {canEdit && <Button icon={<EditOutlined />} onClick={() => onEdit(record)}>Edit</Button>}
        {statusAction}
        <Button data-guide='sme-export-one' icon={<DownloadOutlined />} onClick={() => exportSingleSme(record)}>Export</Button>
    </div>
)
