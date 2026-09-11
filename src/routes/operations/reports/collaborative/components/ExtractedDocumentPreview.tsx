import React from 'react'
import { Alert, Card, Empty, Space, Table, Tag, Typography } from 'antd'
import type { ExtractedDocumentStructure } from '../types'

const { Text } = Typography

const ExtractedDocumentPreview: React.FC<{ structure?: ExtractedDocumentStructure | null; selectedNodeIds?: string[] }> = ({ structure, selectedNodeIds = [] }) => {
  if (!structure) return <Empty description="Extract the source DOCX to view its real document structure." />
  return <Space direction="vertical" size={12} style={{ width: '100%' }}>
    <Alert type="info" showIcon message={`${structure.paragraphs} paragraphs · ${structure.tables} tables · ${structure.images} images · ${structure.headers} headers · ${structure.footers} footers`} description="This is the extracted Word structure used for manual template mapping. Tables retain their cell text and merged-cell indicators." />
    {structure.nodes.map(node => <Card key={node.id} size="small" style={{ borderColor: selectedNodeIds.includes(node.id) ? '#1677ff' : undefined }} title={<Space><Tag color={node.kind === 'table' ? 'purple' : 'blue'}>{node.kind}</Tag><Text type="secondary">{node.id}</Text>{node.style ? <Tag>{node.style}</Tag> : null}{node.list ? <Tag color="cyan">list</Tag> : null}</Space>}>
      {node.kind === 'table' && node.rows && Object.keys(node.rows).length ? (() => { const rows = Object.values(node.rows).map(row => Object.values(row).map(cell => cell.text)); return <Table size="small" pagination={false} rowKey={(_, index) => String(index)} columns={(rows[0] || []).map((_, index) => ({ title: `Column ${index + 1}`, dataIndex: String(index), key: String(index), render: (_value, row: string[]) => row[index] }))} dataSource={rows} /> })() : <Text style={{ whiteSpace: 'pre-wrap' }}>{node.text || 'Empty paragraph'}</Text>}
    </Card>)}
  </Space>
}

export default ExtractedDocumentPreview
