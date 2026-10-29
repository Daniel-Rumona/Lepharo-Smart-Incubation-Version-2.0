import React from 'react'
import { Alert, Button, Empty, Space, Table, Tag, Typography } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import type { ReportTemplate, TemplateBlock } from '../types'
import { ContentTypeTag } from '../shared'

const { Paragraph, Text, Title } = Typography

type Props = {
  template: ReportTemplate
  selectedBlockId?: string | null
  onSelectBlock?: (sectionId: string, blockId: string) => void
}

const fallbackColumns = (block: TemplateBlock) => {
  if (block.schema?.columns?.length) return block.schema.columns
  if (block.contentType === 'kpi') return ['Indicator', 'Target', 'Achieved', 'Variance', 'Comments', 'Status']
  return ['Column 1', 'Column 2', 'Column 3']
}

const BlockPreview: React.FC<{
  block: TemplateBlock
  active: boolean
  onClick?: () => void
}> = ({ block, active, onClick }) => {
  const columns = fallbackColumns(block)
  const assigned = block.editorDepartmentNames || []

  return (
    <div
      className={`template-preview-block ${active ? 'active' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => {
        if (e.key === 'Enter' || e.key === ' ') onClick?.()
      } : undefined}
    >
      <Space size={6} wrap style={{ marginBottom: 8 }}>
        <Text strong>{block.title}</Text>
        <ContentTypeTag value={block.contentType} />
        {block.required ? <Tag color="red">Required</Tag> : <Tag>Optional</Tag>}
      </Space>

      {block.contentType === 'narrative' || block.contentType === 'static' ? (
        <Paragraph style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>
          {typeof block.defaultContent === 'string' && block.defaultContent.trim()
            ? block.defaultContent
            : block.contentType === 'static'
              ? 'Static content will appear here.'
              : 'The writer’s text goes here.'}
        </Paragraph>
      ) : (
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          scroll={{ x: true }}
          columns={columns.map(column => ({
            title: column,
            dataIndex: column,
            key: column,
            render: () => <Text type="secondary">—</Text>
          }))}
          dataSource={[Object.fromEntries([['key', 'preview'], ...columns.map(column => [column, '—'])])]}
        />
      )}

      <Text type="secondary" style={{ fontSize: 11 }}>
        {assigned.length ? `Owned by ${assigned.join(', ')}` : 'No editing department assigned yet'}
      </Text>
    </div>
  )
}

const TemplateLayoutPreview: React.FC<Props> = ({ template, selectedBlockId, onSelectBlock }) => (
  <Space direction="vertical" size={14} style={{ width: '100%' }}>
    <Alert
      type="info"
      showIcon
      message="Configuration preview"
      description="Each box is one section: written by one department, and reviewed and approved on its own."
    />

    {template.sourceFile?.url ? (
      <Button
        icon={<FileTextOutlined />}
        href={template.sourceFile.url}
        target="_blank"
        rel="noreferrer"
      >
        Open Source DOCX
      </Button>
    ) : null}

    <div className="template-preview-paper">
      <div className="template-preview-cover">
        <Text type="secondary" style={{ fontSize: 11 }}>{template.frequency.toUpperCase()} REPORT TEMPLATE</Text>
        <Title level={3} style={{ margin: '6px 0 4px' }}>{template.name}</Title>
        {template.description ? <Paragraph type="secondary">{template.description}</Paragraph> : null}
      </div>

      {template.sections.length ? template.sections.map(section => (
        <section key={section.id} className="template-preview-section">
          <Title level={4} style={{ marginBottom: 12 }}>{section.title}</Title>
          {section.blocks.length ? section.blocks.map(block => (
            <BlockPreview
              key={block.id}
              block={block}
              active={block.id === selectedBlockId}
              onClick={onSelectBlock ? () => onSelectBlock(section.id, block.id) : undefined}
            />
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No sections under this heading" />}
        </section>
      )) : <Empty description="Add headings and sections to see the template here" />}
    </div>
  </Space>
)

export default TemplateLayoutPreview
