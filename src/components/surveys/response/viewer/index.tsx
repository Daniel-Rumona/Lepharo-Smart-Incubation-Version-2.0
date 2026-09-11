import React, { useMemo } from 'react'
import { Card, Divider, Space, Tag, Typography, Rate } from 'antd'

const { Title, Text, Paragraph } = Typography

// ─────────────────────────────────────────────────────────────
// Types (loose enough to accept shapes from formTemplates / sentForms / responses)
// ─────────────────────────────────────────────────────────────
type ResponseType =
  | 'short'
  | 'textarea'
  | 'email'
  | 'number'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'multiple'
  | 'date'
  | 'file'
  | 'rating'
  | 'scale'
  | 'heading'

type Question = {
  id?: string
  type?: ResponseType
  label?: string
  questionText?: string
  question?: string
  options?: string[] | Record<string, string>
  required?: boolean
  multipleMode?: 'single' | 'multi'
  min?: number
  max?: number
  step?: number
  placeholder?: string
  // Any other builder fields are ignored safely
}

type Answers = Record<string, any> | any[] // support both array or keyed maps

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────
const isHeading = (q: Question) => q.type === 'heading'

const qId = (q: Question, i: number) => q.id ?? `q_${i}`
const qType = (q: Question) => (q.type ?? 'short') as ResponseType
const qText = (q: Question, i?: number) =>
  q.questionText ||
  q.label ||
  q.question ||
  (typeof i === 'number' ? `Question ${i + 1}` : 'Question')

function normalizeOptions (q: Question): string[] | undefined {
  const t = qType(q)
  if (!['select', 'radio', 'checkbox', 'multiple'].includes(t)) return undefined
  const opts = q.options
  if (!opts) return undefined
  if (Array.isArray(opts)) return opts.filter(Boolean)
  // handle object maps: {0:'Yes',1:'No',...}
  return Object.values(opts).filter(v => typeof v === 'string') as string[]
}

function answerOf (answers: Answers, q: Question, i: number) {
  const id = qId(q, i)
  if (Array.isArray(answers)) return answers[i]
  return (answers as Record<string, any>)[id]
}

function formatDateMaybe (val: any): string {
  // strings from Dayjs.toISOString() or native ISO -> render readable date
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    const d = new Date(val)
    if (!isNaN(d.getTime())) return d.toLocaleString()
  }
  return String(val)
}

// ─────────────────────────────────────────────────────────────
// Renderer for a single answer value
// ─────────────────────────────────────────────────────────────
function AnswerValue ({ q, value }: { q: Question; value: any }) {
  if (value === undefined || value === null || value === '') {
    return <Text type='secondary'>—</Text>
  }

  const t = qType(q)

  // multi choice / checkbox arrays
  if (t === 'multiple' || t === 'checkbox') {
    const arr = Array.isArray(value) ? value : [value]
    return (
      <Space wrap>
        {arr.map((v, idx) => (
          <Tag key={String(v) + idx}>{String(v)}</Tag>
        ))}
      </Space>
    )
  }

  // single choice
  if (t === 'radio' || t === 'select') {
    return <Tag>{String(value)}</Tag>
  }

  // star rating / numeric scale
  if (t === 'rating' || t === 'scale') {
    const max =
      typeof q.max === 'number' && q.max > 0 ? q.max : t === 'rating' ? 5 : 10
    const n = Number(value)
    // show stars for up to 10 (disabled Rate); fallback to text if NaN
    if (Number.isFinite(n) && max <= 10 && n <= 10) {
      return <Rate disabled count={max} value={n} />
    }
    return <Text strong>{Number.isFinite(n) ? n : String(value)}</Text>
  }

  // files — show as link(s)
  if (t === 'file') {
    const arr = Array.isArray(value) ? value : [value]
    return (
      <Space direction='vertical'>
        {arr.map((url, i) => (
          <a key={i} href={String(url)} target='_blank' rel='noreferrer'>
            {String(url)}
          </a>
        ))}
      </Space>
    )
  }

  // dates (stored as ISO strings in RespondSurvey)
  if (t === 'date') {
    return <Text>{formatDateMaybe(value)}</Text>
  }

  // text-ish
  return <Text>{String(value)}</Text>
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
type ViewerProps = {
  title?: string
  description?: string
  questions: Question[]
  answers: Answers
  /** Show sticky table-of-contents for section headings */
  showTOC?: boolean
}

const SurveyResponseViewer: React.FC<ViewerProps> = ({
  title,
  description,
  questions,
  answers,
  showTOC = false
}) => {
  // Normalize once
  const qList = useMemo(() => {
    return (questions || []).map(q => ({
      ...q,
      type: qType(q),
      options: normalizeOptions(q)
    }))
  }, [questions])

  const sections = useMemo(
    () =>
      qList
        .map((q, i) => ({
          anchorId: qId(q, i),
          text: qText(q, i),
          isHeading: isHeading(q)
        }))
        .filter(s => s.isHeading),
    [qList]
  )

  const gridCols = showTOC && sections.length ? '240px 1fr' : '1fr'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 16 }}>
      {showTOC && sections.length > 0 && (
        <Card
          size='small'
          style={{ position: 'sticky', top: 8, alignSelf: 'start' }}
        >
          <Text strong>Sections</Text>
          <Divider style={{ margin: '8px 0' }} />
          <Space direction='vertical' style={{ width: '100%' }}>
            {sections.map(s => (
              <a
                key={s.anchorId}
                href={`#${s.anchorId}`}
                onClick={e => {
                  e.preventDefault()
                  document
                    .getElementById(s.anchorId)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                {s.text}
              </a>
            ))}
          </Space>
        </Card>
      )}

      <Card>
        {title && (
          <Title level={4} style={{ marginTop: 0 }}>
            {title}
          </Title>
        )}
        {description && <Paragraph type='secondary'>{description}</Paragraph>}
        {title || description ? <Divider style={{ marginTop: 8 }} /> : null}

        {/* Questions */}
        <div>
          {qList.length === 0 ? (
            <Text type='secondary'>No questions found.</Text>
          ) : (
            qList.map((q, i) => {
              const id = qId(q, i)
              const t = qType(q)

              if (t === 'heading') {
                return (
                  <div key={id} id={id} style={{ margin: '18px 0 6px' }}>
                    <Title level={5} style={{ marginBottom: 6 }}>
                      {qText(q, i) || 'Section'}
                    </Title>
                    <Divider style={{ margin: '8px 0 0' }} />
                  </div>
                )
              }

              const val = answerOf(answers, q, i)

              return (
                <div key={id} id={id} style={{ padding: '10px 0' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {qText(q, i)}
                    {q.required ? (
                      <span style={{ color: 'red' }}> *</span>
                    ) : null}
                  </div>
                  <AnswerValue q={q} value={val} />
                  {i < qList.length - 1 && (
                    <Divider style={{ margin: '12px 0' }} />
                  )}
                </div>
              )
            })
          )}
        </div>
      </Card>
    </div>
  )
}

export default SurveyResponseViewer
