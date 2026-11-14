import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Col, Drawer, Popconfirm, Row } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined, InboxOutlined, ProfileOutlined, UndoOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useIsMobile } from '@/hooks/useIsMobile'
import { MetricTile, type MetricTone } from '@/components/dashboards/metrics/MetricTile'
import { useTaskData } from './useTaskData'
import { archiveTasks, restoreTasks, useTaskRunner } from './taskActions'
import { TaskToolbar, DEFAULT_FILTERS, type StatusFilter, type TaskFilterState, type TaskView } from './TaskToolbar'
import { TaskList, type TaskSort } from './TaskList'
import { TaskBoard } from './TaskBoard'
import { TaskDetail, TaskDetailEmpty } from './TaskDetail'
import { TaskFormModal } from './TaskFormModal'
import { assigneesOf } from './TaskBits'
import { PRIORITY_META, asDayjs, completedOn, isOverdue, type Task } from './taskTypes'
import './tasks.css'

const PAGE_TITLE = 'Team Workroom'

const TILES: { key: StatusFilter; title: string; tone: MetricTone; icon: React.ReactNode }[] = [
    { key: 'todo', title: 'To do', tone: 'neutral', icon: <ProfileOutlined /> },
    { key: 'in_progress', title: 'In progress', tone: 'accent', icon: <ClockCircleOutlined /> },
    { key: 'overdue', title: 'Overdue', tone: 'danger', icon: <ExclamationCircleOutlined /> },
    { key: 'done_month', title: 'Done this month', tone: 'success', icon: <CheckCircleOutlined /> }
]

const dueValue = (t: Task) => asDayjs(t.dueAt)?.valueOf() ?? Number.MAX_SAFE_INTEGER
const createdValue = (t: Task) => asDayjs(t.createdAt)?.valueOf() ?? 0

const sorters: Record<TaskSort, (a: Task, b: Task) => number> = {
    due: (a, b) => dueValue(a) - dueValue(b),
    newest: (a, b) => createdValue(b) - createdValue(a),
    priority: (a, b) => PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank || dueValue(a) - dueValue(b)
}

const isDoneThisMonth = (t: Task) => t.status === 'done' && !!completedOn(t)?.isSame(dayjs(), 'month')

const matchesStatus = (t: Task, status: StatusFilter) =>
    status === 'all'
        ? true
        : status === 'overdue'
            ? isOverdue(t)
            : status === 'done_month'
                ? isDoneThisMonth(t)
                : t.status === status

/**
 * Team Workroom: the department task board. Staff create and manage tasks for
 * coordinators; funders (and government viewers) see their programmes' tasks
 * read-only. A list with the selected task beside it, or a board by status.
 */
const TaskModule: React.FC = () => {
    const { programId } = useActiveProgramId()
    const isMobile = useIsMobile()
    const data = useTaskData(programId)
    const { tasks, people, deptById, programById, lockedDepartmentId, canEdit, loading, error } = data

    const [filters, setFilters] = useState<TaskFilterState>(DEFAULT_FILTERS)
    const [view, setView] = useState<TaskView>('list')
    const [showArchived, setShowArchived] = useState(false)
    const [sort, setSort] = useState<TaskSort>('due')
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [checked, setChecked] = useState<Set<string>>(new Set())
    const [formOpen, setFormOpen] = useState(false)
    const [editing, setEditing] = useState<Task | null>(null)
    const bulk = useTaskRunner()

    const patchFilters = (patch: Partial<TaskFilterState>) => setFilters(f => ({ ...f, ...patch }))

    // Tasks follow the header's programme; a locked department wins over the filter.
    const programFilter = programId
    const departmentFilter = lockedDepartmentId || filters.departmentId

    /** Every filter except status and the archive switch: tiles count from this. */
    const filtered = useMemo(() => {
        const q = filters.search.trim().toLowerCase()
        const from = filters.due?.[0].startOf('day')
        const to = filters.due?.[1].endOf('day')
        return tasks.filter(t => {
            if (programFilter !== 'all' && t.programId !== programFilter) return false
            if (departmentFilter !== 'all' && t.departmentId !== departmentFilter) return false
            if (filters.priority !== 'all' && t.priority !== filters.priority) return false
            if (filters.assigneeId !== 'all' && !(t.assignees || []).some(a => people.get(String(a.userId))?.id === filters.assigneeId || a.userId === filters.assigneeId))
                return false
            if (from && to) {
                const due = asDayjs(t.dueAt)
                if (!due || due.isBefore(from) || due.isAfter(to)) return false
            }
            if (q) {
                const names = assigneesOf(t, people).map(p => p.name).join(' ')
                if (!`${t.title} ${t.description} ${names}`.toLowerCase().includes(q)) return false
            }
            return true
        })
    }, [tasks, people, programFilter, departmentFilter, filters])

    const counts = useMemo(() => {
        const active = filtered.filter(t => !t.archived)
        return {
            todo: active.filter(t => t.status === 'todo').length,
            in_progress: active.filter(t => t.status === 'in_progress').length,
            overdue: active.filter(t => isOverdue(t)).length,
            done_month: active.filter(isDoneThisMonth).length
        } as Record<string, number>
    }, [filtered])

    const visible = useMemo(
        () =>
            filtered
                .filter(t => !!t.archived === showArchived && matchesStatus(t, filters.status))
                .sort(sorters[sort]),
        [filtered, showArchived, filters.status, sort]
    )

    const inMode = useMemo(() => tasks.filter(t => !!t.archived === showArchived), [tasks, showArchived])
    const emptyText = error
        ? 'Tasks couldn’t be loaded'
        : data.isFunder && data.funderPrograms.length === 0
            ? 'No programmes are assigned to you yet'
            : inMode.length === 0
                ? showArchived
                    ? 'No archived tasks'
                    : 'No tasks yet'
                : 'No tasks match these filters'

    const resetKey = `${JSON.stringify({ ...filters, due: filters.due?.map(d => d.valueOf()) })}|${view}|${showArchived}|${programId}`

    // Bulk selection never outlives the filters or view it was made in.
    useEffect(() => setChecked(new Set()), [resetKey])

    // Desktop list: keep a visible task selected.
    useEffect(() => {
        if (isMobile || view !== 'list') return
        if (!visible.some(t => t.id === selectedId)) setSelectedId(visible[0]?.id)
    }, [visible, selectedId, isMobile, view])

    /** The live task, read by id from the snapshot. */
    const selected = tasks.find(t => t.id === selectedId) || null

    const open = (t: Task) => {
        setSelectedId(t.id)
        if (isMobile || view === 'board') setDrawerOpen(true)
    }

    const openCreate = () => {
        setEditing(null)
        setFormOpen(true)
    }
    const openEdit = (t: Task) => {
        setEditing(t)
        setFormOpen(true)
    }

    const visibleChecked = visible.filter(t => checked.has(t.id)).map(t => t.id)
    const toggleCheck = (id: string, on: boolean) =>
        setChecked(prev => {
            const next = new Set(prev)
            if (on) next.add(id)
            else next.delete(id)
            return next
        })

    const bulkBar =
        canEdit && view === 'list' && visible.length > 0 && !loading ? (
            visibleChecked.length ? (
                <div className='tw-bulk'>
                    <span>{visibleChecked.length} selected</span>
                    <div className='tw-bulk-actions'>
                        <Button size='small' onClick={() => setChecked(new Set())} disabled={!!bulk.busy}>
                            Clear
                        </Button>
                        {showArchived ? (
                            <Button
                                size='small'
                                type='primary'
                                icon={<UndoOutlined />}
                                loading={bulk.busy === 'restore'}
                                onClick={async () => {
                                    const ids = visible.filter(t => checked.has(t.id)).map(t => t.id)
                                    if (await bulk.run('restore', () => restoreTasks(ids), `Restored ${ids.length} task${ids.length === 1 ? '' : 's'}`))
                                        setChecked(new Set())
                                }}
                            >
                                Restore
                            </Button>
                        ) : (
                            <Popconfirm
                                title={`Archive ${visibleChecked.length} task${visibleChecked.length === 1 ? '' : 's'}?`}
                                description='They leave the board. You can restore them from Archived.'
                                okText='Archive'
                                onConfirm={async () => {
                                    const ids = visible.filter(t => checked.has(t.id)).map(t => t.id)
                                    if (await bulk.run('archive', () => archiveTasks(ids, data.myUid), `Archived ${ids.length} task${ids.length === 1 ? '' : 's'}`))
                                        setChecked(new Set())
                                }}
                            >
                                <Button size='small' type='primary' icon={<InboxOutlined />} loading={bulk.busy === 'archive'}>
                                    Archive
                                </Button>
                            </Popconfirm>
                        )}
                    </div>
                </div>
            ) : (
                <Checkbox
                    className='tw-select-all'
                    checked={false}
                    onChange={e => e.target.checked && setChecked(new Set(visible.map(t => t.id)))}
                >
                    Select all {visible.length}
                </Checkbox>
            )
        ) : null

    const detail = selected ? (
        <TaskDetail
            task={selected}
            deptById={deptById}
            programById={programById}
            people={people}
            canEdit={canEdit}
            canReadInterventions={canEdit}
            myUid={data.myUid}
            onEdit={openEdit}
        />
    ) : null

    const optionsOf = (list: { id: string; name: string }[]) =>
        list.map(x => ({ value: x.id, label: x.name })).sort((a, b) => a.label.localeCompare(b.label))

    const assigneeOptions = useMemo(() => {
        const map = new Map<string, string>()
        tasks.forEach(t => assigneesOf(t, people).forEach(p => map.set(p.id, p.name)))
        return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
    }, [tasks, people])

    const lockedDepartment = lockedDepartmentId
        ? { value: lockedDepartmentId, label: deptById.get(lockedDepartmentId)?.name || 'Your department' }
        : undefined

    return (
        <div className='ws-page'>
            <Helmet>
                <title>{PAGE_TITLE}</title>
            </Helmet>

            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {TILES.map(t => {
                    const active = !showArchived && filters.status === t.key
                    return (
                        <Col key={t.key} xs={12} lg={6}>
                            <MetricTile
                                icon={t.icon}
                                tone={t.tone}
                                title={t.title}
                                mobileTitle={t.key === 'done_month' ? 'Done (month)' : undefined}
                                value={counts[t.key]}
                                loading={loading}
                                compact={isMobile}
                                onClick={() => {
                                    setShowArchived(false)
                                    patchFilters({ status: active ? 'all' : t.key })
                                }}
                                wrapperStyle={active ? { borderRadius: 16, boxShadow: '0 0 0 2px var(--app-accent)' } : undefined}
                            />
                        </Col>
                    )
                })}
            </Row>

            <TaskToolbar
                filters={filters}
                onChange={patchFilters}
                view={view}
                onViewChange={v => {
                    setView(v)
                    setDrawerOpen(false)
                }}
                showArchived={showArchived}
                onShowArchivedChange={setShowArchived}
                departmentOptions={optionsOf(data.departments)}
                lockedDepartment={lockedDepartment}
                assigneeOptions={assigneeOptions}
                canCreate={canEdit}
                createDisabledReason={programId === 'all' ? 'Choose a programme in the header to add tasks to it' : undefined}
                onCreate={openCreate}
            />

            {error && <Alert type='error' showIcon message={error} style={{ marginBottom: 12 }} />}

            {view === 'list' ? (
                <div className='ws-layout'>
                    <TaskList
                        tasks={error ? [] : visible}
                        loading={loading}
                        emptyText={emptyText}
                        selectedId={selectedId}
                        onSelect={open}
                        sort={sort}
                        onSortChange={setSort}
                        resetKey={resetKey}
                        deptById={deptById}
                        people={people}
                        selectable={canEdit}
                        checkedIds={checked}
                        onCheck={toggleCheck}
                        bulkBar={bulkBar}
                    />
                    {!isMobile && (
                        <div className='ws-detail-sticky'>
                            {detail || (
                                <TaskDetailEmpty
                                    loading={loading}
                                    text={visible.length ? 'Select a task to see it' : emptyText}
                                />
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <TaskBoard
                    tasks={error ? [] : visible}
                    loading={loading}
                    emptyText={emptyText}
                    selectedId={drawerOpen ? selectedId : undefined}
                    onOpen={open}
                    deptById={deptById}
                    people={people}
                />
            )}

            <Drawer
                className='ws-drawer'
                open={drawerOpen && !!selected && (isMobile || view === 'board')}
                onClose={() => setDrawerOpen(false)}
                placement='right'
                width={isMobile ? '100%' : 640}
                title={selected?.title || 'Task'}
            >
                {detail}
            </Drawer>

            {canEdit && (
                <TaskFormModal
                    open={formOpen}
                    task={editing}
                    onClose={() => setFormOpen(false)}
                    departments={data.departments}
                    assignables={data.assignables}
                    assignablesLoading={data.assignablesLoading}
                    lockedDepartmentId={lockedDepartmentId}
                    activeProgramId={programId !== 'all' ? programId : undefined}
                    defaultDepartmentId={departmentFilter !== 'all' ? departmentFilter : undefined}
                    myUid={data.myUid}
                />
            )}
        </div>
    )
}

export default TaskModule
