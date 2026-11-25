import React, { useEffect, useMemo, useState } from 'react'
import { Button, Collapse, Empty, Input, Modal, Progress, Select, Table, Tag, Tooltip, Typography, theme } from 'antd'
import {
    ArrowLeftOutlined,
    CheckCircleOutlined,
    InfoCircleOutlined,
    SearchOutlined,
    StarFilled,
    WarningOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { SENT_STATUS_META, formatDay, toDate, type SentSurvey } from './surveyData'
import {
    formatDuration,
    overviewOf,
    profileSurvey,
    surveyTiming,
    type SentimentCounts,
    type SurveyProfile
} from './surveyAnalytics'

const { Text } = Typography

type Props = {
    open: boolean
    onClose: () => void
    /** The department's sent surveys in the selected programme or training. */
    surveys: SentSurvey[]
    /** Open straight on this survey instead of the overview. */
    initialSurveyId?: string | null
}

const dash = <Text type='secondary'>—</Text>

// ─────────────────────────────────────────────────────────────
// Small pieces
// ─────────────────────────────────────────────────────────────

/** One headline figure. */
const Figure: React.FC<{ label: string; value: React.ReactNode; note?: React.ReactNode }> = ({ label, value, note }) => {
    const { token } = theme.useToken()
    return (
        <div
            style={{
                flex: '1 1 160px',
                padding: '12px 14px',
                borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorFillQuaternary
            }}
        >
            <Text type='secondary' style={{ fontSize: 12 }}>
                {label}
            </Text>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3, margin: '2px 0' }}>{value}</div>
            {note ? (
                <Text type='secondary' style={{ fontSize: 12 }}>
                    {note}
                </Text>
            ) : null}
        </div>
    )
}

const Figures: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>{children}</div>
)

const Section: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
    <section style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <Text strong style={{ fontSize: 15 }}>
                {title}
            </Text>
            {note ? (
                <Text type='secondary' style={{ fontSize: 12 }}>
                    {note}
                </Text>
            ) : null}
        </div>
        {children}
    </section>
)

/**
 * A per-question section, closed by default so the page stays short: the
 * header carries the section's one-line summary, the questions open on click.
 */
const Collapsible: React.FC<{ title: string; summary: string; note?: string; children: React.ReactNode }> = ({
    title,
    summary,
    note,
    children
}) => (
    <Collapse
        size='small'
        style={{ marginTop: 10 }}
        items={[
            {
                key: title,
                label: (
                    <span>
                        <Text strong>{title}</Text>
                        <Text type='secondary' style={{ marginLeft: 8 }}>
                            {summary}
                        </Text>
                    </span>
                ),
                children: (
                    <>
                        {note ? (
                            <Text type='secondary' style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                                {note}
                            </Text>
                        ) : null}
                        {children}
                    </>
                )
            }
        ]}
    />
)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A question and its figure on one line; stacks on narrow screens. */
const QuestionRow: React.FC<{ label: string; meta?: React.ReactNode; children: React.ReactNode }> = ({
    label,
    meta,
    children
}) => (
    <div
        style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 16px',
            padding: '10px 0',
            borderTop: '1px solid rgba(127,127,127,0.15)'
        }}
    >
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <Text>{label}</Text>
            {meta ? (
                <div>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {meta}
                    </Text>
                </div>
            ) : null}
        </div>
        <div style={{ flex: '0 1 240px', minWidth: 180 }}>{children}</div>
    </div>
)

/** Positive / neutral / negative as one bar: diverging colours, grey middle, labelled. */
const SentimentBar: React.FC<{ counts: SentimentCounts; height?: number }> = ({ counts, height = 8 }) => {
    const { token } = theme.useToken()
    const total = counts.positive + counts.neutral + counts.negative
    if (!total) return dash
    const parts = [
        { key: 'positive', label: 'Positive', value: counts.positive, color: token.colorSuccess },
        { key: 'neutral', label: 'Neutral', value: counts.neutral, color: token.colorTextQuaternary },
        { key: 'negative', label: 'Negative', value: counts.negative, color: token.colorError }
    ].filter(part => part.value > 0)
    const pct = (value: number) => Math.round((value / total) * 100)
    return (
        <div>
            <div
                role='img'
                aria-label={parts.map(p => `${p.label} ${pct(p.value)}%`).join(', ')}
                style={{ display: 'flex', gap: 2, height, borderRadius: 4, overflow: 'hidden' }}
            >
                {parts.map(part => (
                    <Tooltip key={part.key} title={`${part.label}: ${part.value} (${pct(part.value)}%)`}>
                        <div style={{ flex: part.value, background: part.color, minWidth: 4 }} />
                    </Tooltip>
                ))}
            </div>
            <Text type='secondary' style={{ fontSize: 12 }}>
                {pct(counts.positive)}% positive · {pct(counts.neutral)}% neutral · {pct(counts.negative)}% negative
            </Text>
        </div>
    )
}

/** Average out of 5 with the spread of answers in a tooltip. */
const RatingFigure: React.FC<{ average: number; distribution?: number[]; max?: number }> = ({
    average,
    distribution,
    max = 5
}) => {
    const { token } = theme.useToken()
    const spread = distribution
        ? distribution.map((count, i) => `${i + 1}: ${count}`).join(' · ')
        : undefined
    return (
        <Tooltip title={spread ? `Answers per score (1–${max}) — ${spread}` : undefined}>
            <div>
                <span style={{ whiteSpace: 'nowrap' }}>
                    <StarFilled style={{ color: token.colorWarning, marginRight: 4 }} />
                    <Text strong>{average.toFixed(1)}</Text>
                    <Text type='secondary'> / 5</Text>
                </span>
                <Progress percent={(average / 5) * 100} showInfo={false} size='small' style={{ margin: 0 }} />
            </div>
        </Tooltip>
    )
}

const PercentFigure: React.FC<{ value: number | null; hint?: string }> = ({ value, hint }) =>
    value === null ? (
        dash
    ) : (
        <Tooltip title={hint}>
            <div>
                <Text strong>{value}%</Text>
                <Progress percent={value} showInfo={false} size='small' style={{ margin: 0 }} />
            </div>
        </Tooltip>
    )

const StatusTag: React.FC<{ status: keyof typeof SENT_STATUS_META }> = ({ status }) => (
    <Tag color={SENT_STATUS_META[status].color} bordered={false}>
        {SENT_STATUS_META[status].label}
    </Tag>
)

// ─────────────────────────────────────────────────────────────
// One survey
// ─────────────────────────────────────────────────────────────

const HIGHLIGHT_ICON = {
    good: <CheckCircleOutlined />,
    bad: <WarningOutlined />,
    info: <InfoCircleOutlined />
}

const SurveyView: React.FC<{ profile: SurveyProfile }> = ({ profile }) => {
    const { token } = theme.useToken()
    const { ratings, yesNo, choices, numbers, written } = profile
    const nothing = !ratings && !yesNo && !choices.length && !numbers.length && !written

    return (
        <div>
            <Figures>
                <Figure
                    label='Responses'
                    value={`${profile.responseRate}%`}
                    note={`${profile.responses} of ${profile.total}${profile.awaiting ? ` · ${profile.awaiting} awaiting` : ''}`}
                />
                <Figure label='Median time to respond' value={formatDuration(profile.medianResponseMs)} note='From sending to submitting' />
                {ratings ? (
                    <Figure
                        label='Average rating'
                        value={`${ratings.average.toFixed(1)} / 5`}
                        note={`${ratings.satisfaction}% gave 4 or 5`}
                    />
                ) : null}
                {yesNo && yesNo.favourable !== null ? (
                    <Figure
                        label='Favourable answers'
                        value={`${yesNo.favourable}%`}
                        note={`Of ${yesNo.answers} Yes/No answers`}
                    />
                ) : null}
                {written && written.score !== null ? (
                    <Figure
                        label='Sentiment'
                        value={`${written.score > 0 ? '+' : ''}${written.score}`}
                        note={`${written.questions.reduce((s, q) => s + q.answered, 0)} written answers`}
                    />
                ) : null}
            </Figures>

            {profile.responses === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No submitted responses yet' />
            ) : (
                <>
                    {profile.highlights.length ? (
                        <Section title='What stands out'>
                            <div style={{ display: 'grid', gap: 6 }}>
                                {profile.highlights.map(item => (
                                    <Text key={item.text}>
                                        <span
                                            style={{
                                                marginRight: 8,
                                                color:
                                                    item.tone === 'good'
                                                        ? token.colorSuccess
                                                        : item.tone === 'bad'
                                                            ? token.colorError
                                                            : token.colorTextSecondary
                                            }}
                                        >
                                            {HIGHLIGHT_ICON[item.tone]}
                                        </span>
                                        {item.text}
                                    </Text>
                                ))}
                            </div>
                        </Section>
                    ) : null}

                    {ratings ? (
                        <Collapsible
                            title='Ratings'
                            summary={`${plural(ratings.questions.length, 'question')} · ${ratings.average.toFixed(1)} / 5 average`}
                            note='Out of 5; hover an average for the spread of scores'
                        >
                            {ratings.questions.map(q => (
                                <QuestionRow
                                    key={q.field.id}
                                    label={q.field.label}
                                    meta={[
                                        `${q.answered} rated`,
                                        q.answered ? `${q.satisfaction}% gave ${q.max === 5 ? '4 or 5' : 'top marks'}` : '',
                                        q.notApplicable ? `${q.notApplicable} N/A` : ''
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                >
                                    {q.answered ? <RatingFigure average={q.average} distribution={q.distribution} max={q.max} /> : dash}
                                </QuestionRow>
                            ))}
                        </Collapsible>
                    ) : null}

                    {yesNo ? (
                        <Collapsible
                            title='Yes / No'
                            summary={`${plural(yesNo.questions.length, 'question')}${yesNo.favourable !== null ? ` · ${yesNo.favourable}% favourable` : ''}`}
                            note='The bar shows the good answer: Yes, or No where the question asks about problems'
                        >
                            {yesNo.questions.map(q => (
                                <QuestionRow
                                    key={q.field.id}
                                    label={q.field.label}
                                    meta={`${q.yes} yes · ${q.no} no${q.goodAnswer === 'no' ? ' · No is the good answer here' : ''}`}
                                >
                                    <PercentFigure
                                        value={q.favourable}
                                        hint={q.goodAnswer === 'no' ? 'Share answering no (no problem)' : 'Share answering yes'}
                                    />
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        {q.goodAnswer === 'no' ? 'answered no' : 'answered yes'}
                                    </Text>
                                </QuestionRow>
                            ))}
                        </Collapsible>
                    ) : null}

                    {choices.length ? (
                        <Collapsible title='Choices' summary={plural(choices.length, 'question')}>
                            {choices.map(q => (
                                <QuestionRow key={q.field.id} label={q.field.label} meta={`${q.answered} answered`}>
                                    <div style={{ display: 'grid', gap: 4 }}>
                                        {q.rows.slice(0, 4).map(row => (
                                            <div key={row.label}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                                    <Text ellipsis style={{ fontSize: 12 }}>
                                                        {row.label}
                                                    </Text>
                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                        {row.count}
                                                    </Text>
                                                </div>
                                                <Progress
                                                    percent={q.answered ? (row.count / q.answered) * 100 : 0}
                                                    showInfo={false}
                                                    size='small'
                                                    style={{ margin: 0 }}
                                                />
                                            </div>
                                        ))}
                                        {q.rows.length > 4 ? (
                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                +{q.rows.length - 4} more options
                                            </Text>
                                        ) : null}
                                    </div>
                                </QuestionRow>
                            ))}
                        </Collapsible>
                    ) : null}

                    {numbers.length ? (
                        <Collapsible title='Numbers' summary={plural(numbers.length, 'question')}>
                            {numbers.map(q => (
                                <QuestionRow key={q.field.id} label={q.field.label} meta={`${q.answered} answered`}>
                                    <Text strong>{Number(q.average.toFixed(2)).toLocaleString()}</Text>
                                    <Text type='secondary'> average</Text>
                                    <div>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            Range {q.min.toLocaleString()} – {q.max.toLocaleString()}
                                        </Text>
                                    </div>
                                </QuestionRow>
                            ))}
                        </Collapsible>
                    ) : null}

                    {written ? (
                        <Collapsible
                            title='Written feedback'
                            summary={`${plural(written.questions.length, 'question')}${
                                written.score !== null ? ` · sentiment ${written.score > 0 ? '+' : ''}${written.score}` : ''
                            }`}
                            note='Sentiment from the wording; the most telling comments are quoted'
                        >
                            {written.questions.map(q => (
                                <QuestionRow
                                    key={q.field.id}
                                    label={q.field.label}
                                    meta={
                                        <>
                                            {q.answered} written
                                            {q.examples.positive ? (
                                                <Text
                                                    type='secondary'
                                                    style={{ fontSize: 12, display: 'block' }}
                                                    ellipsis={{ tooltip: q.examples.positive }}
                                                >
                                                    👍 “{q.examples.positive}”
                                                </Text>
                                            ) : null}
                                            {q.examples.negative ? (
                                                <Text
                                                    type='secondary'
                                                    style={{ fontSize: 12, display: 'block' }}
                                                    ellipsis={{ tooltip: q.examples.negative }}
                                                >
                                                    👎 “{q.examples.negative}”
                                                </Text>
                                            ) : null}
                                        </>
                                    }
                                >
                                    <SentimentBar counts={q.sentiment} />
                                </QuestionRow>
                            ))}
                        </Collapsible>
                    ) : null}

                    {nothing ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description='This survey only has short answers, dates or uploads, so there is nothing to score. Open it to read the answers.'
                        />
                    ) : null}
                </>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────

type OverviewRow = { survey: SentSurvey } & ReturnType<typeof surveyTiming>

const OverviewView: React.FC<{ surveys: SentSurvey[]; onOpen: (id: string) => void }> = ({ surveys, onOpen }) => {
    const [search, setSearch] = useState('')
    const overview = useMemo(() => overviewOf(surveys), [surveys])
    const rows = useMemo<OverviewRow[]>(
        () =>
            surveys
                .map(survey => ({ survey, ...surveyTiming(survey) }))
                .sort((a, b) => (toDate(b.survey.sentAt)?.getTime() || 0) - (toDate(a.survey.sentAt)?.getTime() || 0)),
        [surveys]
    )
    const term = search.trim().toLowerCase()
    const shown = rows.filter(row => !term || row.survey.title.toLowerCase().includes(term))

    const columns: ColumnsType<OverviewRow> = [
        {
            title: 'Survey',
            key: 'title',
            render: (_, row) => (
                <div style={{ minWidth: 180 }}>
                    <Text strong>{row.survey.title}</Text>
                    <div>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {row.survey.sentAt ? `Sent ${formatDay(row.survey.sentAt)}` : 'Not dated'}
                            {row.survey.dueDate ? ` · due ${formatDay(row.survey.dueDate)}` : ''}
                        </Text>
                    </div>
                </div>
            )
        },
        {
            title: 'Response rate',
            key: 'rate',
            width: 170,
            sorter: (a, b) => a.responseRate - b.responseRate,
            render: (_, row) => (
                <PercentFigure
                    value={row.survey.total ? row.responseRate : null}
                    hint={`${row.survey.completed} of ${row.survey.total} responded`}
                />
            )
        },
        {
            title: 'Median time to respond',
            key: 'time',
            width: 190,
            sorter: (a, b) => (a.medianResponseMs ?? Infinity) - (b.medianResponseMs ?? Infinity),
            render: (_, row) => (row.medianResponseMs === null ? dash : <Text>{formatDuration(row.medianResponseMs)}</Text>)
        },
        {
            title: 'Awaiting',
            key: 'awaiting',
            width: 110,
            sorter: (a, b) => a.awaiting - b.awaiting,
            render: (_, row) => (row.awaiting ? <Text>{row.awaiting}</Text> : dash)
        },
        {
            title: 'Status',
            key: 'status',
            width: 110,
            render: (_, row) => <StatusTag status={row.status} />
        }
    ]

    return (
        <div>
            <Figures>
                <Figure label='Surveys sent' value={overview.sent} note={`${overview.open} still open`} />
                <Figure
                    label='Response rate'
                    value={`${overview.responseRate}%`}
                    note={`${overview.responses} of ${overview.total} responded`}
                />
                <Figure label='Median time to respond' value={formatDuration(overview.medianResponseMs)} note='From sending to submitting' />
                <Figure
                    label='Awaiting responses'
                    value={overview.awaiting}
                    note={overview.closedIncomplete ? `${overview.closedIncomplete} closed incomplete` : 'On open surveys'}
                />
            </Figures>

            <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder='Search surveys'
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ maxWidth: 360, marginBottom: 10 }}
                aria-label='Search surveys'
            />

            {shown.length ? (
                <Table<OverviewRow>
                    rowKey={row => row.survey.id}
                    columns={columns}
                    dataSource={shown}
                    size='middle'
                    pagination={shown.length > 8 ? { pageSize: 8, showSizeChanger: false } : false}
                    scroll={{ x: 760 }}
                    onRow={row => ({ onClick: () => onOpen(row.survey.id), style: { cursor: 'pointer' } })}
                />
            ) : (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={surveys.length ? 'No surveys match this search' : 'No surveys sent yet'}
                />
            )}
            <Text type='secondary' style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                Click a survey for analytics fitted to its questions.
            </Text>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Window
// ─────────────────────────────────────────────────────────────

/**
 * Analytics: an overview of response behaviour across the sent surveys, and
 * per survey, analysis fitted to the questions it actually asks.
 */
export const SurveyAnalyticsModal: React.FC<Props> = ({ open, onClose, surveys, initialSurveyId }) => {
    const [surveyId, setSurveyId] = useState<string | null>(null)

    useEffect(() => {
        if (open) setSurveyId(initialSurveyId || null)
    }, [open, initialSurveyId])

    const current = surveyId ? surveys.find(s => s.id === surveyId) || null : null
    const profile = useMemo(() => (current ? profileSurvey(current) : null), [current])

    return (
        <Modal
            title={
                current ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingRight: 28 }}>
                        <Button
                            type='text'
                            icon={<ArrowLeftOutlined />}
                            onClick={() => setSurveyId(null)}
                            aria-label='All surveys'
                        >
                            All surveys
                        </Button>
                        <Select
                            showSearch
                            optionFilterProp='label'
                            value={current.id}
                            onChange={setSurveyId}
                            style={{ flex: '1 1 260px', maxWidth: 520 }}
                            options={surveys.map(s => ({ value: s.id, label: s.title }))}
                            aria-label='Survey'
                        />
                        {profile ? <StatusTag status={profile.status} /> : null}
                    </div>
                ) : (
                    'Survey analytics'
                )
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={1000}
            centered
            destroyOnClose
        >
            {current && profile ? (
                <>
                    <SurveyView profile={profile} />
                    <Text type='secondary' style={{ fontSize: 12, display: 'block', marginTop: 16 }}>
                        Only submitted responses count. Ratings on other scales are converted to 5. Sentiment
                        is read from the wording of written answers (positive and negative words, with “not”
                        and similar flipping them), so treat it as a guide.
                    </Text>
                </>
            ) : (
                <OverviewView surveys={surveys} onOpen={setSurveyId} />
            )}
        </Modal>
    )
}
