import React from 'react'
import { Button } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { StatusPill } from '@/routes/operations/movs/movParts'
import type { ReportBlock, ReportBlockStatus, ReportContentType, ReportStatus } from './types'

/**
 * A plain page header: back, title, one line under it, and the page's actions.
 * (Replaces the large "hero" card with an eyebrow line.)
 */
export const PageHeader: React.FC<{
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Kept for older callers; no longer shown. */
  eyebrow?: React.ReactNode
  onBack?: () => void
  actions?: React.ReactNode
}> = ({ title, subtitle, onBack, actions }) => (
  <div className="cr-header">
    {onBack ? <Button shape="circle" icon={<ArrowLeftOutlined />} aria-label="Back" onClick={onBack} /> : null}
    <div className="cr-header-text">
      <h1 className="cr-header-title">{title}</h1>
      {subtitle ? <div className="cr-header-sub">{subtitle}</div> : null}
    </div>
    {actions ? <div className="cr-header-actions">{actions}</div> : null}
  </div>
)

/** What a report's status means, in plain words. */
export const REPORT_STATUS: Record<ReportStatus, { label: string; tone: string }> = {
  draft: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'Writing', tone: 'info' },
  review: { label: 'Waiting for review', tone: 'warning' },
  approved: { label: 'Done', tone: 'success' },
  archived: { label: 'Archived', tone: 'neutral' }
}

export const ReportStatusTag: React.FC<{ status: ReportStatus }> = ({ status }) => {
  const s = REPORT_STATUS[status] || REPORT_STATUS.draft
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>
}

/** A section's status, including who it is waiting on. */
export const sectionStatus = (block: Pick<ReportBlock, 'status' | 'submittedTo'>): { label: string; tone: string } => {
  if (block.status === 'approved') return { label: 'Done', tone: 'success' }
  if (block.status === 'submitted') {
    return block.submittedTo === 'department'
      ? { label: 'With department head', tone: 'info' }
      : { label: 'Waiting for review', tone: 'warning' }
  }
  if (block.status === 'changes_requested') return { label: 'Changes asked', tone: 'danger' }
  if (block.status === 'draft') return { label: 'In progress', tone: 'info' }
  return { label: 'Not started', tone: 'neutral' }
}

export const BlockStatusTag: React.FC<{ status: ReportBlockStatus; submittedTo?: ReportBlock['submittedTo'] }> = ({ status, submittedTo }) => {
  const s = sectionStatus({ status, submittedTo: submittedTo ?? null })
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>
}

export const CONTENT_TYPE_LABEL: Record<ReportContentType, string> = {
  static: 'Fixed text',
  narrative: 'Written',
  table: 'Table',
  kpi: 'KPI table'
}

export const ContentTypeTag: React.FC<{ value: ReportContentType }> = ({ value }) => (
  <StatusPill tone="neutral">{CONTENT_TYPE_LABEL[value] || value}</StatusPill>
)

export const formatTimestamp = (value: any) => {
  if (!value) return '—'
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
