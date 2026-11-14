import React, { useEffect, useState } from 'react'
import { Checkbox, Empty, Pagination } from 'antd'
import { CalendarOutlined, ClockCircleOutlined, FlagOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar, SortSelect, type SortOption } from '@/components/workspace'
import { DueTag, StatusTag, assigneeSummary, assigneesOf } from './TaskBits'
import { formatDay, isOpen, type Department, type Person, type Task } from './taskTypes'

export type TaskSort = 'due' | 'newest' | 'priority'

const SORT_OPTIONS: SortOption<TaskSort>[] = [
    { value: 'due', label: 'Due soonest', icon: <CalendarOutlined /> },
    { value: 'newest', label: 'Newest first', icon: <ClockCircleOutlined /> },
    { value: 'priority', label: 'Priority', icon: <FlagOutlined /> }
]

const PAGE_SIZE = 12

type Props = {
    tasks: Task[]
    loading: boolean
    /** Shown when nothing is listed: "No tasks yet" or "No tasks match these filters". */
    emptyText: string
    selectedId?: string
    onSelect: (task: Task) => void
    sort: TaskSort
    onSortChange: (sort: TaskSort) => void
    /** Changes with the filters, so the list returns to page 1. */
    resetKey: string
    deptById: Map<string, Department>
    people: Map<string, Person>
    /** Bulk selection (staff only). */
    selectable: boolean
    checkedIds: Set<string>
    onCheck: (id: string, checked: boolean) => void
    /** Bulk bar shown above the rows while something is checked. */
    bulkBar?: React.ReactNode
}

/** Tasks as workspace rows: title, who and when, with the status at the end. */
export const TaskList: React.FC<Props> = ({
    tasks,
    loading,
    emptyText,
    selectedId,
    onSelect,
    sort,
    onSortChange,
    resetKey,
    deptById,
    people,
    selectable,
    checkedIds,
    onCheck,
    bulkBar
}) => {
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, sort])

    // Keep the selected task's page in view when it changes from outside.
    useEffect(() => {
        if (!selectedId) return
        const index = tasks.findIndex(t => t.id === selectedId)
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId])

    const pageItems = tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
            <SortSelect value={sort} options={SORT_OPTIONS} onChange={onSortChange} label='Sort tasks' />
            {bulkBar}

            {tasks.length === 0 ? (
                <Empty className='ws-list-empty' description={emptyText} />
            ) : (
                <>
                    <div key={`${page}|${resetKey}|${sort}`} className='ws-rows' role='list' aria-label='Tasks'>
                        {pageItems.map((t, index) => {
                            const selected = t.id === selectedId
                            const first = assigneesOf(t, people)[0]
                            const dept = deptById.get(t.departmentId)?.name
                            const when = isOpen(t) ? `Due ${formatDay(t.dueAt)}` : formatDay(t.dueAt)
                            return (
                                <motion.div
                                    key={t.id}
                                    role='listitem'
                                    className='tw-row-wrap'
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                >
                                    {selectable && (
                                        <Checkbox
                                            className='tw-row-check'
                                            checked={checkedIds.has(t.id)}
                                            onChange={e => onCheck(t.id, e.target.checked)}
                                            aria-label={`Select ${t.title}`}
                                        />
                                    )}
                                    <button
                                        type='button'
                                        aria-current={selected || undefined}
                                        className={`ws-row${selected ? ' is-selected' : ''}`}
                                        onClick={() => onSelect(t)}
                                    >
                                        <EntityAvatar name={first?.name || t.title} photo={first?.photo} size={36} />
                                        <div className='ws-row-main'>
                                            <div className='ws-row-name'>{t.title}</div>
                                            <div className='ws-row-meta'>
                                                {[assigneeSummary(t, people), when, dept].filter(Boolean).join(' · ')}
                                            </div>
                                        </div>
                                        <div className='ws-row-side'>
                                            <StatusTag task={t} />
                                            <DueTag task={t} />
                                        </div>
                                    </button>
                                </motion.div>
                            )
                        })}
                    </div>

                    {tasks.length > PAGE_SIZE && (
                        <div className='ws-pagination'>
                            <Pagination
                                size='small'
                                current={page}
                                pageSize={PAGE_SIZE}
                                total={tasks.length}
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
