import React, { useEffect, useState } from 'react'
import { Empty, Pagination } from 'antd'
import {
    AimOutlined,
    ApartmentOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DollarOutlined,
    NumberOutlined,
    PercentageOutlined,
    SortAscendingOutlined
} from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { SortSelect, type SortOption } from '@/components/workspace'
import { prettySourceLabel, type KPI } from '@/components/kpis/builder/kpiModel'
import { formatTarget, hasTarget, isDeliverable, isManual, type KpiSort } from './kpiRegisterDefs'

export const KPI_SORT_OPTIONS: SortOption<KpiSort>[] = [
    { value: 'name', label: 'Name A–Z', icon: <SortAscendingOutlined /> },
    { value: 'department', label: 'Department', icon: <ApartmentOutlined /> },
    { value: 'newest', label: 'Newest first', icon: <ClockCircleOutlined /> },
    { value: 'needsTarget', label: 'Needs a target first', icon: <AimOutlined /> }
]

const PAGE_SIZE = 8

/** The KPI's measure as an icon: count, rand, percent or a deliverable. */
export const kpiIcon = (k: KPI) =>
    isDeliverable(k) ? <CheckCircleOutlined /> : k.unit === 'ZAR' ? <DollarOutlined /> : k.unit === 'percent' ? <PercentageOutlined /> : <NumberOutlined />

type Props = {
    kpis: KPI[]
    loading: boolean
    selectedId: string | null
    onSelect: (kpi: KPI) => void
    sort: KpiSort
    onSortChange: (sort: KpiSort) => void
    /** Show the department in each row (for people who see several). */
    showDepartment: boolean
    /** Changes whenever the filters do, so the list returns to page 1. */
    resetKey: string
}

export const KpiList: React.FC<Props> = ({ kpis, loading, selectedId, onSelect, sort, onSortChange, showDepartment, resetKey }) => {
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, sort])

    // Keep the selected KPI's page in view when it changes from outside.
    useEffect(() => {
        if (!selectedId) return
        const index = kpis.findIndex(k => k.id === selectedId)
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId])

    const pageItems = kpis.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
            <SortSelect value={sort} options={KPI_SORT_OPTIONS} onChange={onSortChange} label='Sort KPIs' />

            {kpis.length === 0 ? (
                <Empty className='ws-list-empty' description='No KPIs match these filters' />
            ) : (
                <>
                    <div key={`${page}|${resetKey}|${sort}`} className='ws-rows' role='listbox' aria-label='KPIs'>
                        {pageItems.map((kpi, index) => {
                            const selected = kpi.id === selectedId
                            const meta = [
                                showDepartment ? kpi.department : null,
                                isDeliverable(kpi) ? 'Deliverable' : isManual(kpi) ? 'Reported manually' : prettySourceLabel(kpi.sourceType)
                            ].filter(Boolean).join(' · ')
                            return (
                                <motion.button
                                    key={kpi.id}
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                    type='button'
                                    role='option'
                                    aria-selected={selected}
                                    className={`ws-row${selected ? ' is-selected' : ''}`}
                                    onClick={() => onSelect(kpi)}
                                >
                                    <span className='kpr-row-icon' aria-hidden='true'>{kpiIcon(kpi)}</span>
                                    <div className='ws-row-main'>
                                        <div className='ws-row-name'>{kpi.kpiLabel}</div>
                                        <div className='ws-row-meta'>{meta || '—'}</div>
                                    </div>
                                    <div className='ws-row-side'>
                                        {hasTarget(kpi) ? (
                                            <span className='kpr-row-target' title='Latest target'>{formatTarget(kpi, kpi.latestTarget)}</span>
                                        ) : (
                                            <span className='kpr-row-target is-missing'>No target</span>
                                        )}
                                    </div>
                                </motion.button>
                            )
                        })}
                    </div>

                    {kpis.length > PAGE_SIZE && (
                        <div className='ws-pagination'>
                            <Pagination size='small' current={page} pageSize={PAGE_SIZE} total={kpis.length} onChange={setPage} showSizeChanger={false} showLessItems />
                        </div>
                    )}
                </>
            )}
        </MotionCard>
    )
}
