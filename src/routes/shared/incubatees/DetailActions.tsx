import React, { useState } from 'react'
import { Button, Popconfirm } from 'antd'
import { DownloadOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { SmeRow } from './participantsData'
import { exportSingleSme } from './exportParticipants'
import { deleteDummySme } from './dummySme'

type DetailActionsProps = {
    record: SmeRow
    canEdit: boolean
    /** Internal dummy SMEs only. */
    canDelete: boolean
    onEdit: (record: SmeRow) => void
    /** Called after a dummy SME is deleted, so the list can reload. */
    onDeleted: () => Promise<void> | void
}

// Circular icon buttons on desktop; on phones they become full-width labelled
// buttons sitting side by side along the bottom of the card.
/** Edit, Export and (for internal dummy SMEs) Delete, shown in the detail header. */
export const DetailActions: React.FC<DetailActionsProps> = ({ record, canEdit, canDelete, onEdit, onDeleted }) => {
    const [deletingDummySmeId, setDeletingDummySmeId] = useState<string | null>(null)

    const handleDeleteDummySme = async (row: SmeRow) => {
        setDeletingDummySmeId(row.appId)
        try {
            if (await deleteDummySme(row)) await onDeleted()
        } finally {
            setDeletingDummySmeId(null)
        }
    }

    return (
        <div className='ws-detail-actions'>
            {canEdit && (
                <Button icon={<EditOutlined />} onClick={() => onEdit(record)}>
                    Edit
                </Button>
            )}
            <Button data-guide='sme-export-one' icon={<DownloadOutlined />} onClick={() => exportSingleSme(record)}>
                Export
            </Button>
            {canDelete && (
                <Popconfirm
                    title='Delete this dummy SME?'
                    description='This permanently removes the participant, application, and any linked interventions.'
                    okText='Delete'
                    okButtonProps={{ danger: true }}
                    onConfirm={() => handleDeleteDummySme(record)}
                >
                    <Button
                        danger
                        icon={<DeleteOutlined />}
                        loading={deletingDummySmeId === record.appId}
                        aria-label='Delete dummy SME'
                    >
                        Delete
                    </Button>
                </Popconfirm>
            )}
        </div>
    )
}
