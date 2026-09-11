import React, { useState } from 'react'
import { Button, Input, Space, message as AntdMessage } from 'antd'
import { CloseOutlined, MessageOutlined, SendOutlined } from '@ant-design/icons'
import { useLocation } from 'react-router-dom'
import { askAssistant, type ChartSpec } from '@/services/aiAssistantService'
import { useFullIdentity } from '@/hooks/useFullIdentity'

const { TextArea } = Input

type AnalyticsAskFabProps = {
  /** Extra page-specific context (filters, active date range, etc.) to help the assistant. */
  pageContext?: Record<string, unknown>
  /** Suggested starter questions shown next to the prompt bar. */
  suggestions?: string[]
  /** Called with the new chart when one comes back (null clears nothing —
   * the caller decides whether to keep the previous chart on a miss). */
  onChart: (chart: ChartSpec) => void
  /** Called when the assistant couldn't produce a chart, with the reason. */
  onMiss?: (reason: string) => void
  loading?: boolean
  onLoadingChange?: (loading: boolean) => void
}

// Pure prompt trigger — this component never renders a chart itself. It's
// just the floating "ask" affordance; the resulting chart is handed back to
// the page via onChart() so it can render alongside the page's own charts.
export const AnalyticsAskFab: React.FC<AnalyticsAskFabProps> = ({
  pageContext,
  suggestions,
  onChart,
  onMiss,
  loading = false,
  onLoadingChange
}) => {
  const { user } = useFullIdentity()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')

  const ask = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim()
    if (!trimmed || loading) return

    onLoadingChange?.(true)
    try {
      const activeProgramId =
        (window as any).__ACTIVE_PROGRAM_ID__ || window.localStorage.getItem('activeProgramId') || null

      const result = await askAssistant({
        message: trimmed,
        route: location.pathname,
        chartOnly: true,
        user: {
          uid: user?.uid || user?.id || null,
          email: user?.email || null,
          role: user?.role || null,
          participantId: user?.participantId || null,
          consultantId: user?.consultantId || null,
          departmentId: user?.departmentId || null,
          programId: activeProgramId
        },
        pageContext: { activeProgramId, ...(pageContext || {}) }
      })

      if (result.chart) {
        onChart(result.chart)
        setQuestion('')
      } else {
        onMiss?.(result.answer)
        AntdMessage.info(result.answer)
      }
    } catch (err: any) {
      const text = err?.message || 'The assistant is unavailable right now.'
      onMiss?.(text)
      AntdMessage.error(text)
    } finally {
      onLoadingChange?.(false)
    }
  }

  if (!open) {
    return (
      <Button
        type='primary'
        shape='circle'
        size='large'
        icon={<MessageOutlined style={{ fontSize: 22 }} />}
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          bottom: 32,
          right: 32,
          width: 56,
          height: 56,
          boxShadow: '0 8px 24px rgba(22,119,255,0.35)',
          zIndex: 1000
        }}
        aria-label='Ask about this report'
      />
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 420,
        maxWidth: 'calc(100vw - 32px)',
        background: '#fff',
        borderRadius: 14,
        border: '1px solid #e5e7eb',
        boxShadow: '0 16px 48px rgba(15,23,42,0.16)',
        padding: 14,
        zIndex: 1000
      }}
    >
      <Space direction='vertical' style={{ width: '100%' }} size={10}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 13 }}>Ask about this report</strong>
          <Button type='text' size='small' shape='circle' icon={<CloseOutlined />} onClick={() => setOpen(false)} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <TextArea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder='e.g. Chart completed interventions by department'
            autoSize={{ minRows: 1, maxRows: 3 }}
            disabled={loading}
            autoFocus
            onPressEnter={e => {
              if (!e.shiftKey) {
                e.preventDefault()
                void ask(question)
              }
            }}
          />
          <Button
            type='primary'
            shape='circle'
            icon={<SendOutlined />}
            loading={loading}
            disabled={!question.trim()}
            onClick={() => void ask(question)}
          />
        </div>

        {suggestions && suggestions.length > 0 && (
          <Space wrap size={[6, 6]}>
            {suggestions.map(item => (
              <Button key={item} size='small' shape='round' disabled={loading} onClick={() => void ask(item)}>
                {item}
              </Button>
            ))}
          </Space>
        )}
      </Space>
    </div>
  )
}
