import React, { useEffect, useState } from 'react'
import { Empty, Pagination, Tag } from 'antd'
import { ClockCircleOutlined, SortAscendingOutlined, TrophyOutlined } from '@ant-design/icons'
import { SortSelect, type SortOption } from '@/components/workspace'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { ApplicantAvatar } from './ApplicantAvatar'
import { STATUS_META, displayName, scoreTone, type Application } from './applicationData'
import type { ApplicationSort } from './ApplicationFilters'

const PAGE_SIZE = 12

const SORT_OPTIONS: SortOption<ApplicationSort>[] = [
    { value: 'score', label: 'Highest AI score', icon: <TrophyOutlined /> },
    { value: 'newest', label: 'Newest first', icon: <ClockCircleOutlined /> },
    { value: 'name', label: 'Name A–Z', icon: <SortAscendingOutlined /> }
]

type Props = {
    applications: Application[]
    loading: boolean
    selectedId?: string
    onSelect: (app: Application) => void
    sort: ApplicationSort
    onSortChange: (sort: ApplicationSort) => void
    /** Changes whenever the filters do, so the list returns to page 1. */
    resetKey: string
}

export const ApplicationList: React.FC<Props> = ({
    applications,
    loading,
    selectedId,
    onSelect,
    sort,
    onSortChange,
    resetKey
}) => {
    const [page, setPage] = useState(1)

    useEffect(() => setPage(1), [resetKey, sort])

    // Keep the selected application's page in view when it changes from outside.
    useEffect(() => {
        if (!selectedId) return
        const index = applications.findIndex(a => a.id === selectedId)
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId])

    const pageItems = applications.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    const reduceMotion = useReducedMotion()

    return (
        <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
            <SortSelect value={sort} options={SORT_OPTIONS} onChange={onSortChange} label='Sort applications' />

            {applications.length === 0 ? (
                <Empty className='ws-list-empty' description='No applications match these filters' />
            ) : (
                <>
                    {/* Keyed by page, filters and sort, so each new set of rows staggers in. */}
                    <div
                        key={`${page}|${resetKey}|${sort}`}
                        className='ws-rows'
                        role='listbox'
                        aria-label='Applications'
                    >
                        {pageItems.map((app, index) => {
                            const meta = [app.hub, app.submittedAt?.format('D MMM YYYY')].filter(Boolean).join(' · ')
                            const selected = app.id === selectedId
                            return (
                                <motion.button
                                    key={app.id}
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                    type='button'
                                    role='option'
                                    aria-selected={selected}
                                    className={`ws-row${selected ? ' is-selected' : ''}`}
                                    onClick={() => onSelect(app)}
                                >
                                    <ApplicantAvatar app={app} size={36} />
                                    <div className='ws-row-main'>
                                        <div className='ws-row-name'>{displayName(app)}</div>
                                        <div className='ws-row-meta'>{meta || app.email || '—'}</div>
                                    </div>
                                    <div className='ws-row-side'>
                                        <span
                                            className={`apx-score qtx-tone-${scoreTone(app.aiScore)}`}
                                            title='AI score'
                                        >
                                            {app.aiScore ?? '–'}
                                        </span>
                                        <Tag color={STATUS_META[app.applicationStatus].color} bordered={false}>
                                            {STATUS_META[app.applicationStatus].label}
                                        </Tag>
                                    </div>
                                </motion.button>
                            )
                        })}
                    </div>

                    {applications.length > PAGE_SIZE && (
                        <div className='ws-pagination'>
                            <Pagination
                                size='small'
                                current={page}
                                pageSize={PAGE_SIZE}
                                total={applications.length}
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
