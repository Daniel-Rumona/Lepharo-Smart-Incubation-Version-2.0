import React from 'react'
import { Empty, Skeleton } from 'antd'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { AssigneeAvatars, DueTag, PriorityTag } from './TaskBits'
import { STATUS_META, STATUS_ORDER, formatDay, isOpen, type Department, type Person, type Task } from './taskTypes'

type Props = {
    tasks: Task[]
    loading: boolean
    emptyText: string
    selectedId?: string
    onOpen: (task: Task) => void
    deptById: Map<string, Department>
    people: Map<string, Person>
}

/** Compact card for one task in a board column. */
const BoardCard: React.FC<{
    task: Task
    selected: boolean
    onOpen: (task: Task) => void
    deptName?: string
    people: Map<string, Person>
}> = ({ task, selected, onOpen, deptName, people }) => (
    <button type='button' className={`tw-card${selected ? ' is-selected' : ''}`} onClick={() => onOpen(task)}>
        <div className='tw-card-title'>{task.title}</div>
        <div className='tw-card-meta'>
            {[isOpen(task) ? `Due ${formatDay(task.dueAt)}` : formatDay(task.dueAt), deptName].filter(Boolean).join(' · ')}
        </div>
        <div className='tw-card-foot'>
            <div className='tw-card-tags'>
                <PriorityTag task={task} />
                <DueTag task={task} />
            </div>
            <AssigneeAvatars task={task} people={people} size={22} max={3} />
        </div>
    </button>
)

/** Board view: a column per status, each a stack of compact cards. */
export const TaskBoard: React.FC<Props> = ({ tasks, loading, emptyText, selectedId, onOpen, deptById, people }) => {
    if (!loading && tasks.length === 0) {
        return (
            <MotionCard>
                <Empty className='ws-list-empty' description={emptyText} />
            </MotionCard>
        )
    }

    return (
        <div className='tw-board'>
            {STATUS_ORDER.map(status => {
                const column = tasks.filter(t => t.status === status)
                return (
                    <section key={status} className='tw-column' aria-label={STATUS_META[status].label}>
                        <header className='tw-column-head'>
                            <span className={`tw-dot is-${status}`} aria-hidden='true' />
                            <span className='tw-column-title'>{STATUS_META[status].label}</span>
                            <span className='tw-column-count'>{loading ? '' : column.length}</span>
                        </header>
                        <div className='tw-column-body'>
                            {loading ? (
                                <Skeleton active paragraph={{ rows: 3 }} title={false} />
                            ) : column.length ? (
                                column.map(t => (
                                    <BoardCard
                                        key={t.id}
                                        task={t}
                                        selected={t.id === selectedId}
                                        onOpen={onOpen}
                                        deptName={deptById.get(t.departmentId)?.name}
                                        people={people}
                                    />
                                ))
                            ) : (
                                <div className='tw-column-empty'>Nothing here</div>
                            )}
                        </div>
                    </section>
                )
            })}
        </div>
    )
}
