import React, { useEffect, useState } from 'react'
import { Empty, Pagination } from 'antd'
import { AimOutlined, FallOutlined, SortAscendingOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { SortSelect, type SortOption } from '@/components/workspace'
import { STATUS_META, formatValue, periodLabel, type KpiRow } from './trackerModel'

export type TrackerSort = 'attention' | 'name' | 'lowest'

export const TRACKER_SORT_OPTIONS: SortOption<TrackerSort>[] = [
    { value: 'attention', label: 'Needs a look first', icon: <AimOutlined /> },
    { value: 'lowest', label: 'Lowest progress', icon: <FallOutlined /> },
    { value: 'name', label: 'Name A–Z', icon: <SortAscendingOutlined /> }
]

const PAGE_SIZE = 8

/** One line under the name: where the KPI stands this period, in words. */
export const rowSummary = (row: KpiRow) => {
    const period = periodLabel(row.periodType, row.periodKey)
    if (row.def.kpiKind === 'qualitative') {
        return `${period} · ${row.actual == null ? 'Not recorded yet' : row.actual >= 1 ? 'Done' : 'Not done'}`
    }
    if (row.status === 'no-target') return `${period} · No target set`
    if (row.actual == null) return `${period} · Target ${formatValue(row.def.unit, row.target)}, actual not recorded`
    return `${formatValue(row.def.unit, row.actual)} of ${formatValue(row.def.unit, row.target)} · ${period}`
}

/** A small ring showing the share of the target reached, in the status colour. */
export const ProgressRing: React.FC<{ row: KpiRow; size?: number }> = ({ row, size = 38 }) => {
    const stroke = 3.5
    const r = (size - stroke) / 2
    const c = 2 * Math.PI * r
    const share = row.percent == null ? 0 : Math.min(row.percent, 100) / 100
    const tone = STATUS_META[row.status].tone
    const text = row.def.kpiKind === 'qualitative'
        ? (row.actual == null ? '–' : row.actual >= 1 ? '✓' : '✕')
        : row.percent == null ? '–' : `${Math.min(row.percent, 999)}%`
    return (
        <span className={`trk-ring qtx-tone-${tone}`} style={{ width: size, height: size }} aria-hidden='true'>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <circle cx={size / 2} cy={size / 2} r={r} className='trk-ring-track' strokeWidth={stroke} />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    className='trk-ring-value'
                    strokeWidth={stroke}
                    strokeDasharray={`${c * share} ${c}`}
                    // At 0% a round line cap would still draw a dot.
                    style={{ opacity: share > 0 ? 1 : 0 }}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
            </svg>
            <span className='trk-ring-text' style={{ fontSize: text.length > 3 ? 9.5 : 11 }}>{text}</span>
        </span>
    )
}

type Props = {
    rows: KpiRow[]
    loading: boolean
    selectedId: string | null
    onSelect: (row: KpiRow) => void
    sort: TrackerSort
    onSortChange: (sort: TrackerSort) => void
    resetKey: string
    emptyText: string
}

export const TrackerList: React.FC<Props> = ({ rows, loading, selectedId, onSelect, sort, onSortChange, resetKey, emptyText }) => {
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, sort])

    const pageItems = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
            <SortSelect value={sort} options={TRACKER_SORT_OPTIONS} onChange={onSortChange} label='Sort KPIs' />

            {rows.length === 0 ? (
                <Empty className='ws-list-empty' description={emptyText} />
            ) : (
                <>
                    <div key={`${page}|${resetKey}|${sort}`} className='ws-rows' role='listbox' aria-label='KPIs'>
                        {pageItems.map((row, index) => {
                            const selected = row.def.id === selectedId
                            const meta = STATUS_META[row.status]
                            return (
                                <motion.button
                                    key={row.def.id}
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                    type='button'
                                    role='option'
                                    aria-selected={selected}
                                    className={`ws-row${selected ? ' is-selected' : ''}`}
                                    onClick={() => onSelect(row)}
                                >
                                    <ProgressRing row={row} />
                                    <div className='ws-row-main'>
                                        <div className='ws-row-name'>{row.def.kpiLabel}</div>
                                        <div className='ws-row-meta'>{rowSummary(row)}</div>
                                    </div>
                                    <div className='ws-row-side'>
                                        <span className={`trk-status qtx-tone-${meta.tone}`}>{meta.short}</span>
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
    )
}
