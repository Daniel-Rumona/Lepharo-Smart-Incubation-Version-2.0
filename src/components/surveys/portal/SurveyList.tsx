import React, { useEffect, useState } from 'react'
import { Empty, Pagination, Tag } from 'antd'
import {
    CalendarOutlined,
    ClockCircleOutlined,
    PercentageOutlined,
    SortAscendingOutlined
} from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar, SortSelect, type SortOption } from '@/components/workspace'
import {
    SENT_STATUS_META,
    formatDay,
    questionCount,
    responseRate,
    sentStatusOf,
    type SentSurvey,
    type SurveyTemplate
} from './surveyData'
import type { SentSort, TemplateSort } from './SurveyToolbar'

const PAGE_SIZE = 12

const SENT_SORTS: SortOption<SentSort>[] = [
    { value: 'newest', label: 'Newest first', icon: <ClockCircleOutlined /> },
    { value: 'due', label: 'Due soonest', icon: <CalendarOutlined /> },
    { value: 'response', label: 'Lowest response rate', icon: <PercentageOutlined /> },
    { value: 'title', label: 'Title A–Z', icon: <SortAscendingOutlined /> }
]

const TEMPLATE_SORTS: SortOption<TemplateSort>[] = [
    { value: 'updated', label: 'Recently updated', icon: <ClockCircleOutlined /> },
    { value: 'title', label: 'Title A–Z', icon: <SortAscendingOutlined /> }
]

type Row = { id: string; title: string; meta: string; side: React.ReactNode }

type Props = {
    loading: boolean
    selectedId?: string
    onSelect: (id: string) => void
    /** Changes whenever the filters do, so the list returns to page 1. */
    resetKey: string
    emptyText: string
} & (
    | { view: 'sent'; surveys: SentSurvey[]; sort: SentSort; onSortChange: (sort: SentSort) => void }
    | { view: 'templates'; templates: SurveyTemplate[]; sort: TemplateSort; onSortChange: (sort: TemplateSort) => void }
)

const sentRow = (survey: SentSurvey): Row => {
    const status = sentStatusOf(survey)
    return {
        id: survey.id,
        title: survey.title,
        meta: [
            survey.sentAt && `Sent ${formatDay(survey.sentAt)}`,
            survey.dueDate && `Due ${formatDay(survey.dueDate)}`
        ]
            .filter(Boolean)
            .join(' · '),
        side: (
            <>
                {survey.total > 0 && (
                    <span className='ws-muted' title='Responses'>
                        {survey.completed}/{survey.total}
                    </span>
                )}
                <Tag color={SENT_STATUS_META[status].color} bordered={false}>
                    {status === 'pending' ? `${responseRate(survey)}%` : SENT_STATUS_META[status].label}
                </Tag>
            </>
        )
    }
}

const templateRow = (template: SurveyTemplate): Row => {
    const count = questionCount(template.fields)
    return {
        id: template.id,
        title: template.title,
        meta: [
            `${count} question${count === 1 ? '' : 's'}`,
            formatDay(template.updatedAt) && `Updated ${formatDay(template.updatedAt)}`
        ]
            .filter(Boolean)
            .join(' · '),
        side: template.archived ? (
            <Tag color='warning' bordered={false}>
                Archived
            </Tag>
        ) : (
            <Tag color={template.status === 'published' ? 'success' : 'default'} bordered={false}>
                {template.status === 'published' ? 'Published' : 'Draft'}
            </Tag>
        )
    }
}

export const SurveyList: React.FC<Props> = props => {
    const { loading, selectedId, onSelect, resetKey, emptyText } = props
    const rows = props.view === 'sent' ? props.surveys.map(sentRow) : props.templates.map(templateRow)
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, props.sort, props.view])

    // Keep the selected row's page in view when it changes from outside.
    useEffect(() => {
        if (!selectedId) return
        const index = rows.findIndex(row => row.id === selectedId)
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId])

    const pageItems = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
            {props.view === 'sent' ? (
                <SortSelect value={props.sort} options={SENT_SORTS} onChange={props.onSortChange} label='Sort surveys' />
            ) : (
                <SortSelect
                    value={props.sort}
                    options={TEMPLATE_SORTS}
                    onChange={props.onSortChange}
                    label='Sort templates'
                />
            )}

            {rows.length === 0 ? (
                <Empty className='ws-list-empty' description={emptyText} />
            ) : (
                <>
                    <div
                        key={`${page}|${resetKey}|${props.sort}|${props.view}`}
                        className='ws-rows'
                        role='listbox'
                        aria-label={props.view === 'sent' ? 'Sent surveys' : 'Survey templates'}
                    >
                        {pageItems.map((row, index) => {
                            const selected = row.id === selectedId
                            return (
                                <motion.button
                                    key={row.id}
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                    type='button'
                                    role='option'
                                    aria-selected={selected}
                                    className={`ws-row${selected ? ' is-selected' : ''}`}
                                    onClick={() => onSelect(row.id)}
                                >
                                    <EntityAvatar name={row.title} size={36} />
                                    <div className='ws-row-main'>
                                        <div className='ws-row-name'>{row.title}</div>
                                        <div className='ws-row-meta'>{row.meta || '—'}</div>
                                    </div>
                                    <div className='ws-row-side'>{row.side}</div>
                                </motion.button>
                            )
                        })}
                    </div>

                    {rows.length > PAGE_SIZE && (
                        <div className='ws-pagination'>
                            <Pagination
                                size='small'
                                current={page}
                                pageSize={PAGE_SIZE}
                                total={rows.length}
                                onChange={setPage}
                                showSizeChanger={false}
                            />
                        </div>
                    )}
                </>
            )}
        </MotionCard>
    )
}
