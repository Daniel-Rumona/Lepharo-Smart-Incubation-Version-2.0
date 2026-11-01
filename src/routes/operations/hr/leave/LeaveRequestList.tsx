import React, { useEffect, useState } from 'react'
import { Empty, Pagination, Tag } from 'antd'
import { CalendarOutlined, ClockCircleOutlined, SortAscendingOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import dayjs from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar, SortSelect, type SortOption } from '@/components/workspace'
import { isOnLeaveOn, requestDays } from './leavePolicy'
import { typeLabel, type Employee, type LeaveRequest } from './types'

export type LeaveSort = 'newest' | 'starting' | 'name'

const SORT_OPTIONS: SortOption<LeaveSort>[] = [
    { value: 'newest', label: 'Newest first', icon: <ClockCircleOutlined /> },
    { value: 'starting', label: 'Starting soonest', icon: <CalendarOutlined /> },
    { value: 'name', label: 'Employee A–Z', icon: <SortAscendingOutlined /> }
]

const PAGE_SIZE = 12

export const STATUS_TAG: Record<LeaveRequest['status'], { color: string; label: string }> = {
    pending: { color: 'gold', label: 'Pending' },
    approved: { color: 'green', label: 'Approved' },
    rejected: { color: 'red', label: 'Rejected' }
}

export const displayNameOf = (r: LeaveRequest, employee?: Employee) =>
    r.employeeName || employee?.name || r.employeeEmail || employee?.email || 'Unknown employee'

export const dateSpan = (r: Pick<LeaveRequest, 'from' | 'to'>) =>
    dayjs(r.from).isSame(dayjs(r.to), 'day')
        ? dayjs(r.from).format('D MMM YYYY')
        : dayjs(r.from).isSame(dayjs(r.to), 'year')
            ? `${dayjs(r.from).format('D MMM')} – ${dayjs(r.to).format('D MMM YYYY')}`
            : `${dayjs(r.from).format('D MMM YYYY')} – ${dayjs(r.to).format('D MMM YYYY')}`

type Props = {
    requests: LeaveRequest[]
    employeeById: Map<string, Employee>
    loading: boolean
    selectedId?: string
    onSelect: (request: LeaveRequest) => void
    sort: LeaveSort
    onSortChange: (sort: LeaveSort) => void
    /** Changes with the filters, so the list returns to page 1. */
    resetKey: string
}

/** Leave requests as workspace rows: who, what and when, with the status at the end. */
export const LeaveRequestList: React.FC<Props> = ({
    requests,
    employeeById,
    loading,
    selectedId,
    onSelect,
    sort,
    onSortChange,
    resetKey
}) => {
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, sort])

    // Keep the selected request's page in view when it changes from outside.
    useEffect(() => {
        if (!selectedId) return
        const index = requests.findIndex(r => r.id === selectedId)
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId])

    const pageItems = requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
            <SortSelect value={sort} options={SORT_OPTIONS} onChange={onSortChange} label='Sort leave requests' />

            {requests.length === 0 ? (
                <Empty className='ws-list-empty' description='No leave requests match these filters' />
            ) : (
                <>
                    <div key={`${page}|${resetKey}|${sort}`} className='ws-rows' role='listbox' aria-label='Leave requests'>
                        {pageItems.map((r, index) => {
                            const employee = employeeById.get(r.employeeId)
                            const name = displayNameOf(r, employee)
                            const days = requestDays(r)
                            const selected = r.id === selectedId
                            const onNow = r.status === 'approved' && isOnLeaveOn(r)
                            return (
                                <motion.button
                                    key={r.id}
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                    type='button'
                                    role='option'
                                    aria-selected={selected}
                                    className={`ws-row${selected ? ' is-selected' : ''}`}
                                    onClick={() => onSelect(r)}
                                >
                                    <EntityAvatar name={name} photo={r.employeePhoto || employee?.photoURL} size={36} />
                                    <div className='ws-row-main'>
                                        <div className='ws-row-name'>{name}</div>
                                        <div className='ws-row-meta'>
                                            {typeLabel(r.type)} · {dateSpan(r)} · {days} day{days === 1 ? '' : 's'}
                                        </div>
                                    </div>
                                    <div className='ws-row-side'>
                                        <Tag color={onNow ? 'blue' : STATUS_TAG[r.status]?.color} bordered={false}>
                                            {onNow ? 'On leave' : STATUS_TAG[r.status]?.label || r.status}
                                        </Tag>
                                    </div>
                                </motion.button>
                            )
                        })}
                    </div>

                    {requests.length > PAGE_SIZE && (
                        <div className='ws-pagination'>
                            <Pagination
                                size='small'
                                current={page}
                                pageSize={PAGE_SIZE}
                                total={requests.length}
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
