import React, { useState } from 'react'
import { Button, Card, Col, Empty, message, Popconfirm, Row, Select, Skeleton, Space, Upload } from 'antd'
import { DeleteOutlined, EyeOutlined, UploadOutlined } from '@ant-design/icons'

export type ManagedEvidenceResource = {
    link: string
    label?: string
    originalName?: string
    type?: string
}

type Props = {
    participantLabel?: string
    interventionLabel?: string
    resources: ManagedEvidenceResource[]
    loading?: boolean
    uploading?: boolean
    disabled?: boolean
    showHeader?: boolean
    showUpload?: boolean
    uploadLabel?: string
    replaceTarget?: string
    headerActions?: React.ReactNode
    onReplaceTargetChange?: (value?: string) => void
    onReplace?: (resource: ManagedEvidenceResource) => void
    onUpload: (file: File) => void | Promise<void>
    onRemove: (resource: ManagedEvidenceResource) => void | Promise<void>
}

export const EvidenceManagerPanel: React.FC<Props> = ({
    participantLabel,
    interventionLabel,
    resources,
    loading,
    uploading,
    disabled,
    showHeader = true,
    showUpload = true,
    uploadLabel = 'Upload',
    replaceTarget,
    headerActions,
    onReplaceTargetChange,
    onReplace,
    onUpload,
    onRemove
}) => {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([])
    const [removingLink, setRemovingLink] = useState<string | null>(null)

    const removeResource = async (resource: ManagedEvidenceResource) => {
        if (removingLink) return
        setRemovingLink(resource.link)
        try {
            await onRemove(resource)
        } catch (error) {
            console.error('Failed to remove evidence', error)
            message.error('Failed to remove evidence.')
        } finally {
            setRemovingLink(null)
        }
    }
    return (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {showHeader ? <Card size="small" style={{ background: '#fafafa' }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                    <strong>{participantLabel || '—'}</strong>
                    <span style={{ color: '#8c8c8c' }}>{interventionLabel || 'Untitled intervention'}</span>
                </Space>
            </Card> : null}

            {loading ? <Skeleton active paragraph={{ rows: 3 }} /> : (
                <Card
                    size="small"
                    title={<span style={{ color: '#8c8c8c' }}>Currently on file ({resources.length})</span>}
                    extra={headerActions}
                    style={{ background: '#fafafa' }}
                >
                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        {resources.length ? resources.map(resource => (
                            <Card key={resource.link} size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                                <Row gutter={[12, 8]} align="middle" justify="space-between">
                                    <Col flex="auto" style={{ minWidth: 0 }}>
                                        <strong>{resource.label || resource.originalName || 'Evidence'}</strong>
                                        {resource.originalName && resource.originalName !== resource.label ? (
                                            <div style={{ color: '#8c8c8c' }}>{resource.originalName}</div>
                                        ) : null}
                                    </Col>
                                    <Col span={24}>
                                        <Row gutter={[8, 8]}>
                                            <Col span={onReplace ? 8 : 12}>
                                                <Button
                                                    shape='round'
                                                    block
                                                    size="small"
                                                    type="primary"
                                                    ghost
                                                    icon={<EyeOutlined />} onClick={() => window.open(resource.link, '_blank')}>
                                                    View
                                                </Button>
                                            </Col>
                                            {onReplace ? (
                                                <Col span={8}>
                                                    <Button
                                                        data-guide="replace-evidence-action"
                                                        block
                                                        size="small"
                                                        shape='round'
                                                        icon={<UploadOutlined />}
                                                        onClick={() => onReplace(resource)}>
                                                        Replace
                                                    </Button>
                                                </Col>
                                            ) : null}
                                            <Col span={onReplace ? 8 : 12}>
                                                <Popconfirm
                                                    title={`Remove ${resource.label || 'this evidence'}?`}
                                                    description="This removes the evidence reference from the assignment."
                                                    okText="Remove"
                                                    cancelText="Cancel"
                                                    okButtonProps={{ danger: true }}
                                                    onConfirm={() => void removeResource(resource)}
                                                >
                                                    <Button
                                                        block
                                                        size="small"
                                                        danger
                                                        shape='round'
                                                        loading={removingLink === resource.link} disabled={!!removingLink && removingLink !== resource.link} icon={<DeleteOutlined />}>Remove</Button>
                                                </Popconfirm>
                                            </Col>
                                        </Row>
                                    </Col>
                                </Row>
                            </Card>
                        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No evidence currently on file." />}
                    </Space>
                </Card>
            )}

            {onReplaceTargetChange ? (
                <Select
                    allowClear
                    style={{ width: '100%' }}
                    value={replaceTarget || undefined}
                    placeholder="Keep current evidence"
                    onChange={onReplaceTargetChange}
                    options={[
                        { label: 'Replace all current evidence', value: 'all' },
                        ...resources.map(resource => ({ label: `Replace: ${resource.label || resource.originalName || 'Evidence'}`, value: resource.link }))
                    ]}
                />
            ) : null}

            {showUpload ? <>
                {selectedFiles.length ? (
                    <Card size="small" title="Selected files" style={{ background: '#f8fafc' }}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                            {selectedFiles.map((file, index) => (
                                <Row key={`${file.name}-${index}`} justify="space-between" align="middle">
                                    <Col flex="auto">{file.name}</Col>
                                    <Col>
                                        <Button
                                            type="text"
                                            shape='round'
                                            danger
                                            onClick={() => setSelectedFiles(files => files.filter((_, i) => i !== index))}>
                                            Remove
                                        </Button>
                                    </Col>
                                </Row>
                            ))}
                        </Space>
                    </Card>
                ) : null}
                <Upload.Dragger
                    multiple
                    showUploadList={false}
                    beforeUpload={file => {
                        setSelectedFiles(files => [...files, file as File])
                        void onUpload(file as File)
                        return false
                    }}
                    disabled={disabled || loading || uploading}
                    style={{ width: '100%' }}
                >
                    <p className="ant-upload-drag-icon"><UploadOutlined /></p>
                    <p className="ant-upload-text">{uploadLabel}</p>
                    <p className="ant-upload-hint">Drag files here or click to choose</p>
                </Upload.Dragger>
            </> : null}
        </Space>
    )
}

export default EvidenceManagerPanel
