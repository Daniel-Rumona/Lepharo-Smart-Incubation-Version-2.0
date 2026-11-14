import React, { useEffect, useState } from 'react'
import { Button, Empty, Popconfirm } from 'antd'
import { CheckOutlined, EditOutlined, InboxOutlined, RollbackOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { fetchInterventionTitle } from './useTaskData'
import {
    archiveTasks,
    cancelTask,
    completeTask,
    reopenStatus,
    reopenTask,
    restoreTasks,
    useTaskRunner
} from './taskActions'
import { ArchivedTag, DueTag, PriorityTag, StatusTag, assigneesOf } from './TaskBits'
import {
    STATUS_META,
    completedOn,
    formatDay,
    isOpen,
    isOverdue,
    overdueDays,
    type Department,
    type Person,
    type Program,
    type Task
} from './taskTypes'

type Props = {
    task: Task
    deptById: Map<string, Department>
    programById: Map<string, Program>
    people: Map<string, Person>
    /** Staff can act; funders only read. */
    canEdit: boolean
    /** Interventions are staff-only in the rules; funders see the stored title. */
    canReadInterventions: boolean
    myUid: string
    onEdit: (task: Task) => void
}

/** The linked intervention's title: stored on the task, else read once by id. */
const useInterventionTitle = (task: Task, canRead: boolean) => {
    const [title, setTitle] = useState<string | null>(task.interventionTitle || null)
    useEffect(() => {
        setTitle(task.interventionTitle || null)
        if (!task.interventionId || task.interventionTitle || !canRead) return
        let live = true
        fetchInterventionTitle(task.interventionId).then(t => live && setTitle(t))
        return () => {
            live = false
        }
    }, [task.interventionId, task.interventionTitle, canRead])
    return title
}

/** One task: what it is, who has it, when it's due, and what can be done with it. */
export const TaskDetail: React.FC<Props> = ({
    task,
    deptById,
    programById,
    people,
    canEdit,
    canReadInterventions,
    myUid,
    onEdit
}) => {
    const { busy, run } = useTaskRunner()
    const interventionTitle = useInterventionTitle(task, canReadInterventions)
    const assignees = assigneesOf(task, people)
    const overdue = isOverdue(task)
    const open = isOpen(task)
    const finished = completedOn(task)

    const actions = canEdit ? (
        <div className='ws-detail-actions tw-detail-actions'>
            {task.archived ? (
                <Button
                    type='primary'
                    icon={<UndoOutlined />}
                    loading={busy === 'restore'}
                    onClick={() => run('restore', () => restoreTasks([task.id]), 'Task restored')}
                >
                    Restore
                </Button>
            ) : (
                <>
                    {open ? (
                        <Popconfirm
                            title='Mark this task as done?'
                            okText='Complete'
                            onConfirm={() => run('complete', () => completeTask(task), 'Task completed')}
                        >
                            <Button type='primary' icon={<CheckOutlined />} loading={busy === 'complete'}>
                                Complete
                            </Button>
                        </Popconfirm>
                    ) : (
                        <Button
                            type='primary'
                            icon={<RollbackOutlined />}
                            loading={busy === 'reopen'}
                            onClick={() =>
                                run('reopen', () => reopenTask(task), `Task reopened as ${STATUS_META[reopenStatus(task)].label}`)
                            }
                        >
                            Reopen
                        </Button>
                    )}
                    <Button icon={<EditOutlined />} onClick={() => onEdit(task)} disabled={!!busy}>
                        Edit
                    </Button>
                    {open && (
                        <Popconfirm
                            title='Cancel this task?'
                            description='It moves to Cancelled. You can reopen it later.'
                            okText='Cancel task'
                            okButtonProps={{ danger: true }}
                            cancelText='Keep'
                            onConfirm={() => run('cancel', () => cancelTask(task), 'Task cancelled')}
                        >
                            <Button danger icon={<StopOutlined />} loading={busy === 'cancel'}>
                                Cancel
                            </Button>
                        </Popconfirm>
                    )}
                    <Popconfirm
                        title='Archive this task?'
                        description='It leaves the board. You can restore it from Archived.'
                        okText='Archive'
                        onConfirm={() => run('archive', () => archiveTasks([task.id], myUid), 'Task archived')}
                    >
                        <Button icon={<InboxOutlined />} loading={busy === 'archive'}>
                            Archive
                        </Button>
                    </Popconfirm>
                </>
            )}
        </div>
    ) : null

    return (
        <div className='ws-detail'>
            <MotionCard>
                <header className='ws-detail-head'>
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{task.title}</h2>
                        <div className='ws-detail-sub'>
                            {[programById.get(task.programId)?.name, deptById.get(task.departmentId)?.name]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                        </div>
                        <div className='ws-detail-tags'>
                            <StatusTag task={task} />
                            <PriorityTag task={task} />
                            <DueTag task={task} />
                            <ArchivedTag task={task} />
                        </div>
                    </div>
                    {actions}
                </header>

                <div className='ws-detail-tabs'>
                    <div className='ws-detail-pane'>
                        <div className='ws-detail-body'>
                            <section>
                                <h4 className='ws-section-title'>Assigned to</h4>
                                {assignees.length ? (
                                    <ul className='tw-people'>
                                        {assignees.map(p => (
                                            <li key={p.id}>
                                                <EntityAvatar name={p.name} photo={p.photo} size={32} />
                                                <span>{p.name}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className='ws-prose ws-muted'>Nobody is assigned.</p>
                                )}
                            </section>

                            <section>
                                <h4 className='ws-section-title'>Schedule</h4>
                                <dl className='ws-facts'>
                                    <div>
                                        <dt>Due</dt>
                                        <dd>
                                            {formatDay(task.dueAt)}
                                            {overdue && (
                                                <div className='tw-overdue'>
                                                    Overdue by {overdueDays(task)} day{overdueDays(task) === 1 ? '' : 's'}
                                                </div>
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Start</dt>
                                        <dd>{formatDay(task.startAt)}</dd>
                                    </div>
                                    {task.status === 'done' && (
                                        <div>
                                            <dt>Completed</dt>
                                            <dd>{finished ? finished.format('D MMM YYYY') : '—'}</dd>
                                        </div>
                                    )}
                                    {typeof task.progressPercent === 'number' && (
                                        <div>
                                            <dt>Progress</dt>
                                            <dd>{task.progressPercent}%</dd>
                                        </div>
                                    )}
                                    <div>
                                        <dt>Created</dt>
                                        <dd>{formatDay(task.createdAt)}</dd>
                                    </div>
                                </dl>
                            </section>

                            <section>
                                <h4 className='ws-section-title'>Description</h4>
                                <p className='ws-prose'>{task.description || <span className='ws-muted'>No description</span>}</p>
                            </section>

                            {task.currentBottleneck && (
                                <section>
                                    <h4 className='ws-section-title'>Blocker</h4>
                                    <p className='ws-prose'>{task.currentBottleneck}</p>
                                </section>
                            )}

                            <section>
                                <h4 className='ws-section-title'>Context</h4>
                                <dl className='ws-facts'>
                                    <div>
                                        <dt>Programme</dt>
                                        <dd>{programById.get(task.programId)?.name || '—'}</dd>
                                    </div>
                                    <div>
                                        <dt>Department</dt>
                                        <dd>{deptById.get(task.departmentId)?.name || '—'}</dd>
                                    </div>
                                    <div>
                                        <dt>Intervention</dt>
                                        <dd>
                                            {task.interventionId ? (
                                                interventionTitle || <span className='ws-muted'>Linked intervention</span>
                                            ) : (
                                                <span className='ws-muted'>None</span>
                                            )}
                                        </dd>
                                    </div>
                                </dl>
                            </section>
                        </div>
                    </div>
                </div>
            </MotionCard>
        </div>
    )
}

/** A detail panel's placeholder while nothing is selected. */
export const TaskDetailEmpty: React.FC<{ loading: boolean; text: string }> = ({ loading, text }) => (
    <MotionCard loading={loading} skeleton='text' skeletonRows={8}>
        <Empty className='ws-detail-empty' description={text} />
    </MotionCard>
)
