import React, { useEffect, useState } from 'react'
import { Empty, Pagination } from 'antd'
import { CalendarOutlined, ClockCircleOutlined, SortAscendingOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import dayjs from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar, SortSelect, type SortOption } from '@/components/workspace'
import { MOV_STATUS_META, hasMovEvidence, monthLabel, movStatus, type Mov, type MovStatus } from './movData'
import { ROLE_CONFIG, type MovRole } from './roles'
import { StatusPill } from './movParts'
import type { QueryCounts } from './useMovWorkspace'

export type MovSort = 'ended' | 'due' | 'company'

export const MOV_SORT_OPTIONS: SortOption<MovSort>[] = [
    { value: 'ended', label: 'Recently confirmed', icon: <ClockCircleOutlined /> },
    { value: 'due', label: 'Due date', icon: <CalendarOutlined /> },
    { value: 'company', label: 'Company A–Z', icon: <SortAscendingOutlined /> }
]

const PAGE_SIZE = 10

type Props = {
    rows: Mov[]
    loading: boolean
    selectedId: string | null
    onSelect: (mov: Mov) => void
    sort: MovSort
    onSortChange: (sort: MovSort) => void
    queryIndex: Record<string, QueryCounts>
    /** The pack an MOV is in, if any (pack id → month shown). */
    packMonthOf: (mov: Mov) => string | null
    lateTarget: (mov: Mov) => string | null
    resetKey: string
    emptyText: string
    /** The status as this role sees it (see useMovWorkspace.statusOf). */
    statusOf?: (mov: Mov) => MovStatus
    role?: MovRole
}

export const MovList: React.FC<Props> = ({ rows, loading, selectedId, onSelect, sort, onSortChange, queryIndex, packMonthOf, lateTarget, resetKey, emptyText, statusOf, role = 'hod' }) => {
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, sort])
    // Keep the selected MOV's page in view (e.g. after "next" moves the selection).
    useEffect(() => {
        const index = rows.findIndex(r => r.id === selectedId)
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId])

    const pageItems = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <div data-guide='mov-main-table'>
            <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
                <SortSelect value={sort} options={MOV_SORT_OPTIONS} onChange={onSortChange} label='Sort MOVs' />
                {rows.length === 0 ? (
                    <Empty className='ws-list-empty' description={emptyText} />
                ) : (
                    <>
                        <div key={`${page}|${resetKey}|${sort}`} className='ws-rows' role='listbox' aria-label='MOVs'>
                            {pageItems.map((mov, index) => {
                                const status = statusOf ? statusOf(mov) : movStatus(mov)
                                const queries = queryIndex[mov.id]
                                const inPack = packMonthOf(mov)
                                const late = status === 'approved' ? lateTarget(mov) : null
                                return (
                                    <motion.button
                                        key={mov.id}
                                        data-guide={index === 0 ? 'mov-view-action' : undefined}
                                        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.03, 0.3) }}
                                        type='button'
                                        role='option'
                                        aria-selected={mov.id === selectedId}
                                        className={`ws-row${mov.id === selectedId ? ' is-selected' : ''}`}
                                        onClick={() => onSelect(mov)}
                                    >
                                        <EntityAvatar name={mov.smmeCompanyName || mov.smmeName || 'SME'} size={36} />
                                        <div className='ws-row-main'>
                                            <div className='ws-row-name'>{mov.smmeCompanyName || mov.smmeName || 'SME'}</div>
                                            <div className='ws-row-meta'>{[mov.interventionTitle, mov.facilitatorName].filter(Boolean).join(' · ') || '—'}</div>
                                            <div className='mv-row-flags'>
                                                {!hasMovEvidence(mov) && <span className='mv-flag is-danger'>No evidence</span>}
                                                {queries?.open ? <span className='mv-flag is-warning'>{queries.open} open {queries.open === 1 ? 'query' : 'queries'}</span> : null}
                                                {inPack && <span className='mv-flag'>In {monthLabel(inPack, 'MMM YYYY')} pack</span>}
                                                {late && <span className='mv-flag is-warning'>Late · {dayjs(late, 'YYYY-MM').format('MMM')} pack</span>}
                                            </div>
                                        </div>
                                        <div className='ws-row-side'>
                                            <StatusPill tone={MOV_STATUS_META[status].tone}>{ROLE_CONFIG[role].movLabels[status] || MOV_STATUS_META[status].label}</StatusPill>
                                        </div>
                                    </motion.button>
                                )
                            })}
                        </div>
                        {rows.length > PAGE_SIZE && (
                            <div className='ws-pagination'>
                                <Pagination size='small' current={page} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} showSizeChanger={false} showLessItems />
                            </div>
                        )}
                    </>
                )}
            </MotionCard>
        </div>
    )
}
