import { useEffect, useState } from 'react'
import { Button, Empty, Pagination, Tag } from 'antd'
import { ClockCircleOutlined, DollarOutlined, FieldTimeOutlined, FileTextOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { SortSelect, type SortOption } from '@/components/workspace'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import type { Proposal } from '@/types/proposal'
import { DeadlineHint, money, statusColor } from './proposalUi'

const PAGE_SIZE = 12

export type ProposalSort = 'updated' | 'deadline' | 'value'

const SORT_OPTIONS: SortOption<ProposalSort>[] = [
    { value: 'updated', label: 'Recently updated', icon: <ClockCircleOutlined /> },
    { value: 'deadline', label: 'Deadline, soonest first', icon: <FieldTimeOutlined /> },
    { value: 'value', label: 'Highest value', icon: <DollarOutlined /> }
]

/**
 * The left panel: one row per proposal with its client, value, status and
 * deadline. Selecting a row shows it in the detail panel.
 */
export function ProposalList({
    proposals,
    loading,
    selectedId,
    onSelect,
    sort,
    onSortChange,
    resetKey,
    emptyAction
}: {
    proposals: Proposal[]
    loading: boolean
    selectedId?: string
    onSelect: (proposal: Proposal) => void
    sort: ProposalSort
    onSortChange: (sort: ProposalSort) => void
    /** Changes whenever the filters do, so the list returns to page 1. */
    resetKey: string
    /** Shown when there are no proposals at all, rather than none matching. */
    emptyAction?: () => void
}) {
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, sort])

    // Keep the selected proposal's page in view when it changes from outside.
    useEffect(() => {
        if (!selectedId) return
        const index = proposals.findIndex(item => item.id === selectedId)
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId])

    const pageItems = proposals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
            <SortSelect value={sort} options={SORT_OPTIONS} onChange={onSortChange} label='Sort proposals' />

            {proposals.length === 0 ? (
                emptyAction
                    ? <Empty className='ws-list-empty' description='No proposals yet'>
                        <Button type='primary' onClick={emptyAction}>Create the first proposal</Button>
                    </Empty>
                    : <Empty className='ws-list-empty' description='No proposals match this search or filter' />
            ) : (
                <>
                    {/* Keyed by page, filters and sort, so each new set of rows staggers in. */}
                    <div key={`${page}|${resetKey}|${sort}`} className='ws-rows' role='listbox' aria-label='Proposals'>
                        {pageItems.map((proposal, index) => {
                            const selected = proposal.id === selectedId
                            return (
                                <motion.button
                                    key={proposal.id}
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                    type='button'
                                    role='option'
                                    aria-selected={selected}
                                    className={`ws-row proposal-row${selected ? ' is-selected' : ''}`}
                                    onClick={() => onSelect(proposal)}
                                >
                                    <span className='proposal-row-icon'><FileTextOutlined /></span>
                                    <div className='ws-row-main'>
                                        <div className='ws-row-name'>{proposal.title}</div>
                                        <div className='ws-row-meta'>
                                            {proposal.proposalNumber} · {proposal.clientName}
                                        </div>
                                        <DeadlineHint proposal={proposal} />
                                    </div>
                                    <div className='ws-row-side'>
                                        <span className='proposal-row-value'>{money(proposal.estimatedValue)}</span>
                                        <Tag color={statusColor[proposal.status]} bordered={false}>{proposal.status}</Tag>
                                    </div>
                                </motion.button>
                            )
                        })}
                    </div>

                    {proposals.length > PAGE_SIZE && (
                        <div className='ws-pagination'>
                            <Pagination size='small' current={page} pageSize={PAGE_SIZE}
                                total={proposals.length} onChange={setPage} showSizeChanger={false} />
                        </div>
                    )}
                </>
            )}
        </MotionCard>
    )
}
