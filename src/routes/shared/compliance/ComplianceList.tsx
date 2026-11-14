import React, { useEffect, useState } from 'react'
import { Empty, Pagination, Tag } from 'antd'
import { ClockCircleOutlined, FieldTimeOutlined, SortAscendingOutlined, WarningOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { EntityAvatar, SortSelect, type SortOption } from '@/components/workspace'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { viewHeadline, type ComplianceSort, type ComplianceView } from './complianceWorkspace'
import './compliance.css'

const PAGE_SIZE = 12

const SORT_OPTIONS: SortOption<ComplianceSort>[] = [
    { value: 'outstanding', label: 'Most outstanding', icon: <WarningOutlined /> },
    { value: 'expiring', label: 'Expiring soonest', icon: <FieldTimeOutlined /> },
    { value: 'recent', label: 'Recently uploaded', icon: <ClockCircleOutlined /> },
    { value: 'name', label: 'Name A–Z', icon: <SortAscendingOutlined /> }
]

type Props = {
    views: ComplianceView[]
    loading: boolean
    selectedId?: string
    onSelect: (view: ComplianceView) => void
    sort: ComplianceSort
    onSortChange: (sort: ComplianceSort) => void
    /** Shows each SME's programme (All programmes). */
    showProgramme: boolean
    /** Changes whenever the filters do, so the list returns to page 1. */
    resetKey: string
    emptyText: string
}

export const ComplianceList: React.FC<Props> = ({
    views,
    loading,
    selectedId,
    onSelect,
    sort,
    onSortChange,
    showProgramme,
    resetKey,
    emptyText
}) => {
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, sort])

    // Keep the selected SME's page in view when it changes from outside.
    useEffect(() => {
        if (!selectedId) return
        const index = views.findIndex(view => view.participantId === selectedId)
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId])

    const pageItems = views.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
            <div data-guide='compliance-table'>
                <SortSelect value={sort} options={SORT_OPTIONS} onChange={onSortChange} label='Sort SMEs' />

                {views.length === 0 ? (
                    <Empty className='ws-list-empty' description={emptyText} />
                ) : (
                    <>
                        <div key={`${page}|${resetKey}|${sort}`} className='ws-rows' role='listbox' aria-label='SMEs'>
                            {pageItems.map((view, index) => {
                                const selected = view.participantId === selectedId
                                const headline = viewHeadline(view)
                                const percent = view.required ? Math.round((view.covered / view.required) * 100) : 0
                                const meta = [showProgramme ? view.programName : '', view.branchName, view.gapGroup]
                                    .filter(value => value && value !== '—')
                                    .join(' · ')
                                return (
                                    <motion.button
                                        key={view.participantId}
                                        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                        type='button'
                                        role='option'
                                        aria-selected={selected}
                                        data-guide={index === 0 ? 'manage-compliance-action' : undefined}
                                        className={`ws-row${selected ? ' is-selected' : ''}`}
                                        onClick={() => onSelect(view)}
                                    >
                                        <EntityAvatar name={view.name} size={36} />
                                        <div className='ws-row-main'>
                                            <div className='ws-row-name'>{view.name}</div>
                                            <div className='ws-row-meta'>{meta || view.email || '—'}</div>
                                        </div>
                                        <div className='ws-row-side'>
                                            <Tag color={headline.color} bordered={false}>
                                                {headline.label}
                                            </Tag>
                                            {view.required > 0 && (
                                                <span
                                                    className='cmp-coverage'
                                                    title={`${view.covered} of ${view.required} documents in order`}
                                                >
                                                    <span className='cmp-coverage-track'>
                                                        <span style={{ width: `${percent}%` }} />
                                                    </span>
                                                    {view.covered}/{view.required}
                                                </span>
                                            )}
                                        </div>
                                    </motion.button>
                                )
                            })}
                        </div>

                        {views.length > PAGE_SIZE && (
                            <div className='ws-pagination'>
                                <Pagination
                                    size='small'
                                    current={page}
                                    pageSize={PAGE_SIZE}
                                    total={views.length}
                                    onChange={setPage}
                                    showSizeChanger={false}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </MotionCard>
    )
}
