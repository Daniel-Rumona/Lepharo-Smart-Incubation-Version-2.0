import React from 'react'
import { Button, Card, Col, Row, Space, Tag, Typography } from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  EditOutlined,
  FileTextOutlined,
  SendOutlined
} from '@ant-design/icons'
import type { ReportBlockStatus, ReportContentType, ReportStatus } from './types'

const { Title, Text } = Typography

export const PageHeader: React.FC<{
  title: React.ReactNode
  subtitle?: React.ReactNode
  eyebrow?: React.ReactNode
  onBack?: () => void
  actions?: React.ReactNode
}> = ({ title, subtitle, eyebrow, onBack, actions }) => (
  <Card className="report-hero" styles={{ body: { padding: 20 } }}>
    <Row align="middle" justify="space-between" gutter={[14, 14]}>
      <Col flex="auto">
        <Space align="start" size={12}>
          {onBack ? <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} /> : null}
          <div>
            {eyebrow ? <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>{eyebrow}</Text> : null}
            <Title level={3} style={{ margin: eyebrow ? '3px 0 2px' : '0 0 2px' }}>{title}</Title>
            {subtitle ? <Text type="secondary">{subtitle}</Text> : null}
          </div>
        </Space>
      </Col>
      {actions ? <Col>{actions}</Col> : null}
    </Row>
  </Card>
)

export const MetricCard: React.FC<{
  icon: React.ReactNode
  iconBg: string
  title: string
  value: React.ReactNode
  subtitle?: string
}> = ({ icon, iconBg, title, value, subtitle }) => (
  <Card className="report-soft-card report-metric-card">
    <div className="report-metric">
      <div className="report-metric-icon" style={{ background: iconBg }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{title}</Text>
        <div style={{ fontSize: 25, fontWeight: 750, lineHeight: 1.15 }}>{value}</div>
        {subtitle ? <Text type="secondary" style={{ fontSize: 11 }}>{subtitle}</Text> : null}
      </div>
    </div>
  </Card>
)

export const ReportStatusTag: React.FC<{ status: ReportStatus }> = ({ status }) => {
  if (status === 'approved') return <Tag color="success">Approved</Tag>
  if (status === 'review') return <Tag color="processing">Under Review</Tag>
  if (status === 'in_progress') return <Tag color="blue">In Progress</Tag>
  if (status === 'archived') return <Tag>Archived</Tag>
  return <Tag>Draft</Tag>
}

export const BlockStatusTag: React.FC<{ status: ReportBlockStatus }> = ({ status }) => {
  if (status === 'approved') return <Tag color="success" icon={<CheckCircleFilled />}>Approved</Tag>
  if (status === 'submitted') return <Tag color="processing" icon={<SendOutlined />}>Submitted</Tag>
  if (status === 'changes_requested') return <Tag color="warning" icon={<EditOutlined />}>Changes Requested</Tag>
  if (status === 'draft') return <Tag color="blue">Draft</Tag>
  return <Tag icon={<ClockCircleOutlined />}>Not Started</Tag>
}

export const ContentTypeTag: React.FC<{ value: ReportContentType }> = ({ value }) => {
  const config: Record<ReportContentType, { label: string; color?: string }> = {
    static: { label: 'Static' },
    narrative: { label: 'Narrative', color: 'cyan' },
    table: { label: 'Structured Table', color: 'geekblue' },
    kpi: { label: 'KPI Block', color: 'purple' }
  }
  return <Tag color={config[value].color}>{config[value].label}</Tag>
}

export const FileBadge: React.FC<{ label?: string }> = ({ label = 'DOCX' }) => (
  <div style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: '#eef5ff', color: '#165d9f', fontWeight: 800, position: 'relative' }}>
    <FileTextOutlined style={{ fontSize: 22 }} />
    <span style={{ position: 'absolute', bottom: 3, fontSize: 8 }}>{label}</span>
  </div>
)

export const formatTimestamp = (value: any) => {
  if (!value) return '—'
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}
