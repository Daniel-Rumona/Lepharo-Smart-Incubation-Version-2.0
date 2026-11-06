import React from 'react'
import { Button, Popconfirm, Typography } from 'antd'
import {
    DeleteOutlined,
    FileExcelOutlined,
    FileImageOutlined,
    FileOutlined,
    FilePdfOutlined,
    FilePptOutlined,
    FileWordOutlined
} from '@ant-design/icons'

const { Text } = Typography

const iconFor = (name: string, type?: string) => {
    const lower = name.toLowerCase()
    if (lower.endsWith('.pdf') || type === 'application/pdf') return <FilePdfOutlined />
    if (/\.(png|jpe?g|gif|webp|heic)$/.test(lower) || type?.startsWith('image/')) return <FileImageOutlined />
    if (/\.(xls|xlsx|csv)$/.test(lower)) return <FileExcelOutlined />
    if (/\.(doc|docx)$/.test(lower)) return <FileWordOutlined />
    if (/\.(ppt|pptx)$/.test(lower)) return <FilePptOutlined />
    return <FileOutlined />
}

const sizeText = (bytes?: number) => {
    if (!bytes) return ''
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

type Props = {
    name: string
    type?: string
    size?: number
    /** Opens the file, for evidence that is already saved. */
    href?: string
    /** Shows the red circular delete button at the far end. Omit for read-only rows. */
    onRemove?: () => void
    /** Ask before removing: shown as a confirmation on the delete button itself. */
    confirmTitle?: string
    confirmDescription?: string
    /** An extra action shown just before the delete button, such as Replace. */
    extra?: React.ReactNode
    disabled?: boolean
}

/** One document in a list: icon, name, size, and a bordered red circular delete button at the far end. */
export const EvidenceFileRow: React.FC<Props> = ({ name, type, size, href, onRemove, confirmTitle, confirmDescription, extra, disabled }) => {
    const deleteButton = onRemove ? (
        <Button
            danger
            shape='circle'
            size='small'
            icon={<DeleteOutlined />}
            aria-label={`Remove ${name}`}
            disabled={disabled}
            onClick={confirmTitle ? undefined : onRemove}
            style={{ flex: '0 0 auto' }}
        />
    ) : null
    return (
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
            padding: '6px 6px 6px 10px',
            borderRadius: 10,
            border: '1px solid rgba(128,128,128,0.25)',
            background: 'rgba(128,128,128,0.06)'
        }}
    >
        <span style={{ fontSize: 18, color: '#8c8c8c', flex: '0 0 auto', display: 'inline-flex' }}>
            {iconFor(name, type)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
            {href ? (
                <a href={href} target='_blank' rel='noreferrer' style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                </a>
            ) : (
                <Text ellipsis={{ tooltip: name }} style={{ display: 'block' }}>{name}</Text>
            )}
            {size ? <Text type='secondary' style={{ fontSize: 11 }}>{sizeText(size)}</Text> : null}
        </div>
        {extra}
        {deleteButton && confirmTitle ? (
            <Popconfirm
                title={confirmTitle}
                description={confirmDescription}
                okText='Remove'
                okButtonProps={{ danger: true }}
                onConfirm={onRemove}
            >
                {deleteButton}
            </Popconfirm>
        ) : (
            deleteButton
        )}
    </div>
    )
}

export default EvidenceFileRow
