import React, { useEffect, useMemo, useState, useCallback } from 'react'
import {
    Row,
    Col,
    Segmented,
    Space,
    Button,
    Table,
    Tag,
    Modal,
    Form,
    Input,
    Select,
    DatePicker,
    Empty,
    Divider,
    message,
    Typography,
    Badge,
    Card,
    Tooltip,
    Dropdown,
    Descriptions,
    theme
} from 'antd'
import {
    PlusOutlined,
    ApartmentOutlined,
    TeamOutlined,
    CalendarOutlined,
    TableOutlined,
    AppstoreOutlined,
    ProjectOutlined,
    FilterOutlined,
    FlagOutlined,
    ExclamationCircleOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    InboxOutlined,
    RollbackOutlined,
    StopOutlined,
    MoreOutlined,
    EditOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'
import {
    collection,
    query,
    where,
    onSnapshot,
    orderBy,
    addDoc,
    updateDoc,
    doc,
    serverTimestamp,
    Timestamp,
    getDocs,
    limit,
    writeBatch
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard } from '../dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'

/** ───────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────── */
type Priority = 'low' | 'medium' | 'high' | 'urgent'
type Status = 'todo' | 'in_progress' | 'cancelled' | 'done'
type TaskFilterStatus = Status | 'overdue'

type Assignment = {
    userId: string
    branchId?: string | null
    departmentId?: string | null
}

type TaskDoc = {
    title: string
    description: string
    programId: string

    departmentId: string
    priority: Priority
    status: Status
    startAt?: Timestamp | null
    dueAt: Timestamp
    createdAt: any
    updatedAt: any
    createdBy: string
    assignees: Assignment[]
    interventionId?: string | null
    completedAt?: any
    archived?: boolean
    archivedAt?: any
    archivedBy?: string | null
}

type TaskRow = TaskDoc & { id: string }

type Program = {
    id: string
    name: string
    branchId?: string | null
    department?: string | null
}

type Coordinator = {
    id: string
    uid?: string | null
    authUid?: string | null
    name: string
    email?: string | null
    departmentId?: string | null
    branchId?: string | null

}

type Branch = { id: string; name: string }
type Department = { id: string; name: string; isMain?: boolean }
type Opt = { label: string; value: string }

/** ───────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────── */
const { Text } = Typography

const isFsTimestamp = (x: any) => x && typeof x.toDate === 'function'
const asDate = (x: any): Date | null => {
    if (!x) return null
    if (isFsTimestamp(x)) return x.toDate()
    if (x instanceof Date) return x
    if (typeof x === 'number') return new Date(x)
    if (typeof x === 'string') {
        const d = new Date(x)
        return isNaN(d.getTime()) ? null : d
    }
    if (x.seconds != null) return new Date(x.seconds * 1000)
    return null
}
const asDayjs = (x: any) => {
    const d = asDate(x)
    return d ? dayjs(d) : null
}

const STATUS_META: Record<Status, { label: string; color: any }> = {
    todo: { label: 'To Do', color: 'default' },
    in_progress: { label: 'In Progress', color: 'processing' },
    cancelled: { label: 'Cancelled', color: 'error' },
    done: { label: 'Done', color: 'success' }
}
const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
    low: { label: 'Low', color: 'green' },
    medium: { label: 'Medium', color: 'blue' },
    high: { label: 'High', color: 'orange' },
    urgent: { label: 'Urgent', color: 'red' }
}

const safePriority = (p?: any): Priority => {
    const val = typeof p === 'string' ? p.toLowerCase().trim() : ''
    return (val in PRIORITY_META ? val : 'medium') as Priority
}
const safeStatus = (s?: any): Status => {
    const val = typeof s === 'string' ? s.toLowerCase().trim() : ''
    return (val in STATUS_META ? val : 'todo') as Status
}
const getPriorityMeta = (p: any) => PRIORITY_META[safePriority(p)] || PRIORITY_META.medium
const ts = (d: Dayjs) => Timestamp.fromDate(d.toDate())

function formatDuration(ms: number) {
    const sec = Math.max(0, Math.floor(ms / 1000))
    const d = Math.floor(sec / 86400)
    const h = Math.floor((sec % 86400) / 3600)
    const m = Math.floor((sec % 3600) / 60)
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
}
function countdownMeta(due: Date | null) {
    if (!due) return { text: '—', color: 'default' as any, overdue: false }
    const now = Date.now()
    const ms = due.getTime() - now
    if (ms < 0) {
        const overdueDays = Math.max(1, Math.ceil(-ms / (24 * 60 * 60 * 1000)))
        return {
            text: `Overdue by ${overdueDays}d`,
            color: 'red' as any,
            overdue: true
        }
    }
    const left = formatDuration(ms)
    const oneDay = 24 * 3600 * 1000
    const threeDays = 3 * oneDay
    const color =
        ms < oneDay ? ('red' as any) : ms < threeDays ? ('orange' as any) : ('green' as any)
    return { text: left, color, overdue: false }
}

const isTaskOverdue = (task: TaskRow) => {
    const due = asDate(task.dueAt)
    const status = safeStatus(task.status)
    return !!due && due.getTime() < Date.now() && status !== 'done' && status !== 'cancelled'
}

/** Always produce a stable key for a coordinator selection */
const coordinatorKey = (c: Coordinator) => (c.uid || c.authUid || c.id || '').trim()

/** ───────────────────────────────────────────────────────────
 * Component
 * ─────────────────────────────────────────────────────────── */
export default function TasksModule() {
    const { token } = theme.useToken()
    const [view, setView] = useState<'Board' | 'Table'>('Board')
    const { programId } = useActiveProgramId()

    const [deptFilter, setDeptFilter] = useState<string | 'all'>('all')
    const [statusFilter, setStatusFilter] = useState<TaskFilterStatus | 'all'>('all')
    const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all')
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)

    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const selectedCount = selectedRowKeys.length

    const [programs, setPrograms] = useState<Program[]>([])
    const [coordinators, setCoordinators] = useState<Coordinator[]>([])
    const [branches, setBranches] = useState<Branch[]>([])
    const [departments, setDepartments] = useState<Department[]>([])
    const [tasks, setTasks] = useState<TaskRow[]>([])
    const [statusCounts, setStatusCounts] = useState<Record<Status, number> & { overdue: number }>({
        todo: 0,
        in_progress: 0,
        cancelled: 0,
        done: 0,
        overdue: 0
    })
    const [archivedTasks, setArchivedTasks] = useState<TaskRow[]>([])
    const [isArchiveModalOpen, setArchiveModalOpen] = useState(false)
    const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null)
    const [loading, setLoading] = useState(true)

    // modal state (tasks)
    const [isModalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState<TaskRow | null>(null)
    const [form] = Form.useForm()
    const watchedDeptId = Form.useWatch('departmentId', form) as string | undefined

    // interventions
    const [interventionOptions, setInterventionOptions] = useState<Opt[]>([])
    const [loadingInterventions, setLoadingInterventions] = useState(false)
    const fetchIdRef = React.useRef(0)

    const { user: me } = useFullIdentity()

    const myDeptIsMain = useMemo(() => {
        const deptId = (me as any)?.departmentId
        if (!deptId) return true // if no dept on user, don't block
        const d = departments.find(x => x.id === deptId)
        if (!d) return true // wait for department metadata before restricting the feed
        return !!d.isMain
    }, [me, departments])

    /** department watch: reset + fetch interventions safely */
    useEffect(() => {
        if (!watchedDeptId) {
            setInterventionOptions([])
            form.setFieldsValue({ interventionId: null, assignees: [] })
            return
        }

        form.setFieldsValue({ interventionId: null, assignees: [] })
        const fetchId = ++fetchIdRef.current
        setLoadingInterventions(true)

            ; (async () => {
                const opts = await loadInterventionsForDept(watchedDeptId)
                if (fetchId === fetchIdRef.current) setInterventionOptions(opts)
                setLoadingInterventions(false)
            })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [watchedDeptId])

    /** lookups */
    useEffect(() => {
        const unsubs: Array<() => void> = []

        unsubs.push(
            onSnapshot(
                query(collection(db, 'programs')),
                s => setPrograms(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
            )
        )
        unsubs.push(
            onSnapshot(
                query(collection(db, 'coordinators')),
                s => setCoordinators(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
            )
        )
        unsubs.push(
            onSnapshot(
                query(collection(db, 'branches')),
                s => setBranches(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
            )
        )
        unsubs.push(
            onSnapshot(
                query(collection(db, 'departments')),
                s => setDepartments(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
            )
        )

        return () => unsubs.forEach(u => u())
    }, [])

    useEffect(() => {
        const deptId = (me as any)?.departmentId
        if (!deptId) return

        if (!myDeptIsMain) {
            // lock filter to my department
            setDeptFilter(deptId)
        }
    }, [me, myDeptIsMain])

    /** tasks feed */
    useEffect(() => {
        setLoading(true)

        const unsub = onSnapshot(
            query(collection(db, 'tasks'), orderBy('createdAt', 'desc')),
            snap => {
                let rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as TaskRow[]

                rows = rows.map(r => ({
                    ...r,
                    priority: safePriority(r.priority),
                    status: safeStatus(r.status)
                }))

                // Dept visibility rule:
                // If my department is NOT main, I can only see tasks for my department.
                if (!myDeptIsMain) {
                    const myDeptId = (me as any)?.departmentId
                    if (myDeptId) rows = rows.filter(r => r.departmentId === myDeptId)
                }

                if (programId !== 'all') rows = rows.filter(r => r.programId === programId)
                if (deptFilter !== 'all') rows = rows.filter(r => r.departmentId === deptFilter)

                setArchivedTasks(rows.filter(r => r.archived === true))
                rows = rows.filter(r => r.archived !== true)

                if (priorityFilter !== 'all') rows = rows.filter(r => r.priority === priorityFilter)

                if (dateRange) {
                    const [start, end] = dateRange
                    const startD = start.toDate()
                    const endD = end.endOf('day').toDate()
                    rows = rows.filter(r => {
                        const due = asDate(r.dueAt)
                        return !!due && due >= startD && due <= endD
                    })
                }

                setStatusCounts({
                    todo: rows.filter(r => r.status === 'todo' && !isTaskOverdue(r)).length,
                    in_progress: rows.filter(r => r.status === 'in_progress' && !isTaskOverdue(r)).length,
                    cancelled: rows.filter(r => r.status === 'cancelled').length,
                    done: rows.filter(r => r.status === 'done').length,
                    overdue: rows.filter(isTaskOverdue).length
                })

                if (statusFilter === 'overdue') {
                    rows = rows.filter(isTaskOverdue)
                } else if (statusFilter === 'todo' || statusFilter === 'in_progress') {
                    rows = rows.filter(r => r.status === statusFilter && !isTaskOverdue(r))
                } else if (statusFilter !== 'all') {
                    rows = rows.filter(r => r.status === statusFilter)
                }

                setTasks(rows)
                setLoading(false)
            }
        )

        return () => unsub()
    }, [programId, deptFilter, statusFilter, priorityFilter, dateRange, myDeptIsMain, me?.departmentId])

    /** derived */
    const deptOptions = useMemo(() => {
        const myDeptId = (me as any)?.departmentId
        const list = departments.map(d => ({ label: d.name, value: d.id }))

        if (!myDeptIsMain && myDeptId) {
            const mine = list.find(x => x.value === myDeptId)
            return mine ? [mine] : []
        }

        return [{ label: 'All Departments', value: 'all' }].concat(list)
    }, [departments, me, myDeptIsMain])

    const statusBuckets = useMemo(() => {
        const map: Record<Status, TaskRow[]> = { todo: [], in_progress: [], cancelled: [], done: [] }
        tasks.forEach(t => map[safeStatus(t.status)].push(t))
        return map
    }, [tasks])

    /** helpers */
    const coordinatorsForDept = useCallback(
        (deptId?: string) => coordinators.filter(c => (c.departmentId || '').trim() === (deptId || '').trim()),
        [coordinators]
    )

    const coordinatorOptions = useMemo(() => {
        const list = coordinatorsForDept(watchedDeptId)
        return list
            .map(c => {
                const key = coordinatorKey(c)
                if (!key) return null
                const branchName = c.branchId ? branches.find(b => b.id === c.branchId)?.name : ''
                return {
                    value: key,
                    label: `${c.name || c.email || c.id}${branchName ? ` • ${branchName}` : ''}`
                }
            })
            .filter(Boolean) as Array<{ value: string; label: string }>
    }, [watchedDeptId, coordinatorsForDept, branches])

    const getInterventionTitle = (x: any) =>
        (typeof x.title === 'string' && x.title.trim()) ||
        (typeof x.name === 'string' && x.name.trim()) ||
        (typeof x.code === 'string' && x.code.trim()) ||
        (typeof x.programName === 'string' && x.programName.trim()) ||
        (typeof x.interventionTitle === 'string' && x.interventionTitle.trim()) ||
        x.id

    const loadInterventionsForDept = async (deptId?: string) => {
        if (!deptId) return []
        const qref = query(
            collection(db, 'interventions'),
            where('departmentId', '==', deptId),
            limit(50)
        )
        const snap = await getDocs(qref)
        const raw = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
        const rows = raw.map(x => ({ id: x.id, title: getInterventionTitle(x) }))
        return rows.map(x => ({ label: x.title, value: x.id }))
    }

    /** create / edit task */
    const openCreate = useCallback(() => {
        if (!programId || programId === 'all') {
            message.error('Select a program first.')
            return
        }

        form.resetFields()
        form.setFieldsValue({
            startAt: dayjs(),
            dueAt: dayjs().add(7, 'day'),
            status: 'todo',
            priority: 'medium',
            departmentId: deptFilter !== 'all' ? deptFilter : undefined,
            assignees: [],
            interventionId: null
        })

        setEditing(null)
        setModalOpen(true)
    }, [form, programId, deptFilter])

    const openEdit = useCallback(
        (row: TaskRow) => {
            const due = asDayjs(row.dueAt) ?? dayjs()
            const start = asDayjs(row.startAt) ?? dayjs()

            form.setFieldsValue({
                title: row.title,
                description: row.description,
                priority: safePriority(row.priority),
                status: safeStatus(row.status),
                departmentId: row.departmentId,
                interventionId: row.interventionId ?? null,
                assignees: (row.assignees || []).map(a => a.userId),
                startAt: start,
                dueAt: due
            })

            setEditing(row)
            setModalOpen(true)
        },
        [form]
    )

    const cancelTask = async (taskId: string) => {
        await updateDoc(doc(db, 'tasks', taskId), { status: 'cancelled', updatedAt: serverTimestamp() })
        message.success('Task cancelled')
    }

    const reopenTask = async (taskId: string) => {
        await updateDoc(doc(db, 'tasks', taskId), { status: 'todo', completedAt: null, updatedAt: serverTimestamp() })
        message.success('Task reopened')
    }

    const archiveTask = async (taskId: string) => {
        await updateDoc(doc(db, 'tasks', taskId), {
            archived: true,
            archivedAt: serverTimestamp(),
            archivedBy: (me as any)?.uid || (me as any)?.email || null,
            updatedAt: serverTimestamp()
        })
        message.success('Task archived')
    }

    const archiveSelectedTasks = async () => {
        if (!selectedRowKeys.length) return
        const batch = writeBatch(db)
        const now = serverTimestamp()
        selectedRowKeys.forEach(id => {
            batch.update(doc(db, 'tasks', String(id)), {
                archived: true,
                archivedAt: now,
                archivedBy: (me as any)?.uid || (me as any)?.email || null,
                updatedAt: now
            })
        })
        await batch.commit()
        message.success(`Archived ${selectedRowKeys.length} task(s)`)
        setSelectedRowKeys([])
    }

    const completeTask = async (taskId: string) => {
        await updateDoc(doc(db, 'tasks', taskId), {
            status: 'done',
            completedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        })
        message.success('Task completed')
    }

    const runPrimaryTaskAction = async (task: TaskRow) => {
        const status = safeStatus(task.status)
        if (status === 'done' || status === 'cancelled') {
            await reopenTask(task.id)
        } else {
            await completeTask(task.id)
        }
        setSelectedTask(null)
    }

    const taskMoreMenu = (task: TaskRow) => {
        const status = safeStatus(task.status)
        const isActive = status !== 'done' && status !== 'cancelled'

        return {
            items: [
                { key: 'edit', icon: <EditOutlined />, label: 'Edit task' },
                ...(isActive ? [{ key: 'cancel', icon: <StopOutlined />, label: 'Cancel task', danger: true }] : []),
                { key: 'archive', icon: <InboxOutlined />, label: 'Archive task' }
            ],
            onClick: ({ key, domEvent }: any) => {
                domEvent?.stopPropagation?.()

                if (key === 'edit') {
                    setSelectedTask(null)
                    openEdit(task)
                    return
                }

                if (key === 'cancel') {
                    Modal.confirm({
                        title: 'Cancel task?',
                        content: 'This will move the task to Cancelled.',
                        okText: 'Cancel Task',
                        okButtonProps: { danger: true, shape: 'round' },
                        cancelButtonProps: { shape: 'round' },
                        onOk: async () => {
                            await cancelTask(task.id)
                            setSelectedTask(null)
                        }
                    })
                    return
                }

                Modal.confirm({
                    title: 'Archive task?',
                    content: 'This will hide it from the active board.',
                    okText: 'Archive',
                    okButtonProps: { shape: 'round' },
                    cancelButtonProps: { shape: 'round' },
                    onOk: async () => {
                        await archiveTask(task.id)
                        setSelectedTask(null)
                    }
                })
            }
        }
    }

    /** ✅ FIXED submit: no stale coordinators + stable key matching */
    const handleSubmit = async () => {
        const v = await form.validateFields()
        const deptId: string = v.departmentId
        const assigneeKeys: string[] = (v.assignees || []).map((x: any) => String(x))

        const picks = coordinatorsForDept(deptId)
        const selected = picks.filter(c => assigneeKeys.includes(coordinatorKey(c)))

        if (!selected.length) {
            message.error('Coordinators must belong to the selected department.')
            return
        }

        const assignees: Assignment[] = selected.map(c => ({
            userId: coordinatorKey(c),
            branchId: c.branchId ?? null,
            departmentId: deptId
        }))

        const resolvedProgramId = editing?.programId || programId
        if (!resolvedProgramId || resolvedProgramId === 'all') {
            message.error('Select a program first.')
            return
        }

        const payload: Partial<TaskDoc> = {
            title: v.title,
            description: v.description,
            programId: resolvedProgramId,
            priority: safePriority(v.priority),
            status: safeStatus(v.status),
            startAt: v.startAt ? ts(v.startAt) : null,
            dueAt: ts(v.dueAt),
            departmentId: deptId,
            assignees,
            interventionId: v.interventionId ?? null,
            updatedAt: serverTimestamp()
        }

        if (editing) {
            await updateDoc(doc(db, 'tasks', editing.id), payload)
            message.success('Task updated')
        } else {
            await addDoc(collection(db, 'tasks'), {
                ...payload,
                createdAt: serverTimestamp(),
                createdBy: (me as any)?.id || (me as any)?.email || 'system'
            } as TaskDoc)
            message.success('Task created')
        }

        setModalOpen(false)
    }

    /** columns */
    const columns: any[] = [
        {
            title: 'Task',
            dataIndex: 'title',
            width: 200,
            ellipsis: true,
            render: (title: string) => (
                <Text strong ellipsis={{ tooltip: title }}>
                    {title}
                </Text>
            )
        },
        {
            title: 'Context',
            key: 'context',
            width: 210,
            render: (_: any, row: TaskRow) => {
                const programName = programs.find(program => program.id === row.programId)?.name || row.programId || '—'
                const departmentName = departments.find(department => department.id === row.departmentId)?.name || row.departmentId || '—'
                return (
                    <Space direction="vertical" size={2} style={{ minWidth: 0, width: '100%' }}>
                        <Text ellipsis={{ tooltip: programName }} style={{ fontSize: 12 }}>
                            <ProjectOutlined /> {programName}
                        </Text>
                        <Text type="secondary" ellipsis={{ tooltip: departmentName }} style={{ fontSize: 12 }}>
                            <ApartmentOutlined /> {departmentName}
                        </Text>
                    </Space>
                )
            }
        },
        {
            title: 'Workflow',
            key: 'workflow',
            width: 135,
            render: (_: any, row: TaskRow) => {
                const status = safeStatus(row.status)
                const statusMeta = STATUS_META[status]
                const priorityMeta = getPriorityMeta(row.priority)
                return (
                    <Space direction="vertical" size={4}>
                        <Tag color={priorityMeta.color} icon={<FlagOutlined />} style={{ marginInlineEnd: 0 }}>
                            {priorityMeta.label}
                        </Tag>
                        <Badge
                            status={
                                status === 'done'
                                    ? 'success'
                                    : status === 'cancelled'
                                        ? 'error'
                                        : status === 'in_progress'
                                            ? 'processing'
                                            : 'default'
                            }
                            text={statusMeta.label}
                        />
                    </Space>
                )
            }
        },
        {
            title: 'Schedule',
            key: 'schedule',
            width: 180,
            render: (_: any, row: TaskRow) => {
                const status = safeStatus(row.status)
                const start = asDate(row.startAt)
                const due = asDate(row.dueAt)
                const meta = countdownMeta(due)
                const completed = asDate(row.completedAt) || asDate(row.updatedAt)

                return (
                    <Space direction="vertical" size={2}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            Start: {start ? dayjs(start).format('DD MMM YYYY') : '—'}
                        </Text>
                        <Text style={{ fontSize: 12 }}>
                            {status === 'done'
                                ? `Done: ${completed ? dayjs(completed).format('DD MMM YYYY') : '—'}`
                                : `Due: ${due ? dayjs(due).format('DD MMM YYYY') : '—'}`}
                        </Text>
                        {status !== 'done' && status !== 'cancelled' ? (
                            <Tag color={meta.color} icon={<ClockCircleOutlined />} style={{ marginInlineEnd: 0 }}>
                                {meta.text}
                            </Tag>
                        ) : null}
                    </Space>
                )
            }
        },
        {
            title: 'Assignees',
            dataIndex: 'assignees',
            width: 180,
            render: (_: any, row: TaskRow) => {
                if (!row.assignees?.length) return <Text type="secondary">Unassigned</Text>
                return (
                    <Space direction="vertical" size={1} style={{ minWidth: 0 }}>
                        {row.assignees.slice(0, 2).map((a: Assignment, i: number) => {
                            const c = coordinators.find(x => coordinatorKey(x) === a.userId || x.id === a.userId)
                            return (
                                <Text key={row.id + i} ellipsis style={{ maxWidth: 165, fontSize: 12 }}>
                                    <TeamOutlined />{' '}
                                    {c?.name || c?.email || a.userId}
                                </Text>
                            )
                        })}
                        {row.assignees.length > 2 ? (
                            <Text type="secondary" style={{ fontSize: 12 }}>+{row.assignees.length - 2} more</Text>
                        ) : null}
                    </Space>
                )
            }
        },
        {
            title: 'Actions',
            key: 'act',
            width: 220,
            render: (_: any, row: TaskRow) => {
                const isTerminal = safeStatus(row.status) === 'done' || safeStatus(row.status) === 'cancelled'
                return (
                    <div onClick={event => event.stopPropagation()}>
                        <Space size={6}>
                            <Button
                                size="small"
                                shape="round"
                                type="primary"
                                icon={isTerminal ? <RollbackOutlined /> : <CheckCircleOutlined />}
                                onClick={() => runPrimaryTaskAction(row)}
                            >
                                {isTerminal ? 'Reopen' : 'Mark Done'}
                            </Button>
                            <Dropdown menu={taskMoreMenu(row)} trigger={['click']} placement="bottomRight">
                                <Button
                                    size="small"
                                    shape="round"
                                    icon={<MoreOutlined />}
                                    onClick={event => event.stopPropagation()}
                                >
                                    More
                                </Button>
                            </Dropdown>
                        </Space>
                    </div>
                )
            }
        }
    ]

    const archivedColumns: any[] = [
        {
            title: 'Task',
            key: 'task',
            render: (_: any, row: TaskRow) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{row.title}</Text>
                    <Text type="secondary" ellipsis={{ tooltip: row.description }}>
                        {row.description}
                    </Text>
                </Space>
            )
        },
        {
            title: 'Status',
            dataIndex: 'status',
            width: 130,
            render: (status: Status) => {
                const meta = STATUS_META[safeStatus(status)]
                return <Tag color={meta.color}>{meta.label}</Tag>
            }
        },
        {
            title: 'Priority',
            dataIndex: 'priority',
            width: 120,
            render: (priority: Priority) => {
                const meta = getPriorityMeta(priority)
                return <Tag color={meta.color}>{meta.label}</Tag>
            }
        },
        {
            title: 'Department',
            dataIndex: 'departmentId',
            width: 180,
            render: (departmentId: string) => departments.find(d => d.id === departmentId)?.name || departmentId || '—'
        },
        {
            title: 'Archived',
            dataIndex: 'archivedAt',
            width: 150,
            render: (archivedAt: any) => {
                const date = asDate(archivedAt)
                return date ? dayjs(date).format('DD MMM YYYY') : '—'
            }
        }
    ]

    /** views */
    const Board = () => {
        const isFocusedStatus = statusFilter !== 'all'
        const cols: Array<{ key: string; title: string; data: TaskRow[] }> = isFocusedStatus
            ? [{
                key: statusFilter,
                title: statusFilter === 'overdue' ? 'Overdue' : STATUS_META[statusFilter].label,
                data: tasks
            }]
            : [
                {
                    key: 'todo',
                    title: 'To Do',
                    data: statusBuckets.todo.filter(task => !isTaskOverdue(task))
                },
                {
                    key: 'in_progress',
                    title: 'In Progress',
                    data: statusBuckets.in_progress.filter(task => !isTaskOverdue(task))
                },
                {
                    key: 'done',
                    title: 'Done',
                    data: statusBuckets.done
                },
                {
                    key: 'overdue',
                    title: 'Overdue',
                    data: tasks.filter(isTaskOverdue)
                }
            ]
        const populatedCols = cols.filter(column => column.data.length > 0)
        const desktopLaneSpan = isFocusedStatus ? 24 : Math.floor(24 / Math.max(populatedCols.length, 1))

        if (!tasks.length || !populatedCols.length) return <Empty description="No tasks yet" style={{ margin: 40 }} />

        return (
            <Row gutter={[12, 12]}>
                {populatedCols.map(c => (
                    <Col
                        key={c.key}
                        xs={24}
                        sm={isFocusedStatus || populatedCols.length === 1 ? 24 : 12}
                        md={isFocusedStatus || populatedCols.length === 1 ? 24 : 12}
                        lg={desktopLaneSpan}
                        style={{ minWidth: 0, overflow: 'hidden' }}
                    >
                        <Card
                            size="small"
                            bordered={!isFocusedStatus}
                            title={!isFocusedStatus ? (
                                <Space>
                                    <Text strong>{c.title}</Text>
                                    <Text type="secondary">{c.data.length}</Text>
                                </Space>
                            ) : undefined}
                            bodyStyle={{ padding: isFocusedStatus ? 0 : 8 }}
                            style={
                                isFocusedStatus
                                    ? {
                                        background: 'transparent',
                                        border: 'none',
                                        boxShadow: 'none',
                                        overflow: 'hidden'
                                    }
                                    : {
                                        borderRadius: 12,
                                        background: token.colorFillAlter,
                                        borderColor: token.colorBorderSecondary,
                                        boxShadow: token.boxShadowTertiary,
                                        overflow: 'hidden'
                                    }
                            }
                        >
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: isFocusedStatus
                                        ? 'repeat(auto-fit, minmax(280px, 1fr))'
                                        : '1fr',
                                    gap: 8,
                                    width: '100%',
                                    minWidth: 0,
                                    maxHeight: 'min(62vh, 640px)',
                                    overflowX: 'hidden',
                                    overflowY: 'auto',
                                    scrollbarGutter: 'stable',
                                    paddingRight: c.data.length ? 4 : 0
                                }}
                            >
                                {c.data.length ? c.data.map(t => {
                                    const pMeta = getPriorityMeta(t.priority)
                                    const due = asDate(t.dueAt)
                                    const completedAt = asDate(t.completedAt)
                                    const status = safeStatus(t.status)
                                    const deptName = departments.find(d => d.id === t.departmentId)?.name || t.departmentId
                                    const programName = programs.find(p => p.id === t.programId)?.name || t.programId
                                    const dueMeta = countdownMeta(due)

                                    return (
                                        <div key={t.id} style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
                                            <MotionCard
                                                size="small"
                                                bodyStyle={{ padding: 12 }}
                                                style={{
                                                    width: '100%',
                                                    minWidth: 0,
                                                    overflow: 'hidden',
                                                    boxShadow: 'none',
                                                    cursor: 'pointer'
                                                }}
                                                onClick={() => setSelectedTask(t)}
                                            >
                                                <Space direction="vertical" size={8} style={{ width: '100%', minWidth: 0 }}>
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            gap: 12,
                                                            minWidth: 0
                                                        }}
                                                    >
                                                        <Text
                                                            strong
                                                            style={{
                                                                flex: 1,
                                                                minWidth: 0,
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis'
                                                            }}
                                                            title={t.title}
                                                        >
                                                            {t.title}
                                                        </Text>
                                                        <Tag
                                                            color={pMeta.color}
                                                            icon={<FlagOutlined />}
                                                            style={{ flexShrink: 0, marginInlineEnd: 0 }}
                                                        >
                                                            {pMeta.label}
                                                        </Tag>
                                                    </div>

                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            flexWrap: 'wrap',
                                                            columnGap: 12,
                                                            rowGap: 4,
                                                            minWidth: 0
                                                        }}
                                                    >
                                                        {programId === 'all' ? (
                                                            <Tooltip title={programName}>
                                                                <Text
                                                                    type="secondary"
                                                                    style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: 5,
                                                                        flex: '1 1 140px',
                                                                        minWidth: 0,
                                                                        fontSize: 12
                                                                    }}
                                                                >
                                                                    <ProjectOutlined style={{ flexShrink: 0 }} />
                                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {programName}
                                                                    </span>
                                                                </Text>
                                                            </Tooltip>
                                                        ) : null}
                                                        <Tooltip title={deptName}>
                                                            <Text
                                                                type="secondary"
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 5,
                                                                    flex: '1 1 140px',
                                                                    minWidth: 0,
                                                                    fontSize: 12
                                                                }}
                                                            >
                                                                <ApartmentOutlined style={{ flexShrink: 0 }} />
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                    {deptName}
                                                                </span>
                                                            </Text>
                                                        </Tooltip>
                                                    </div>

                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            flexWrap: 'wrap',
                                                            gap: 8
                                                        }}
                                                    >
                                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                                            <CalendarOutlined />{' '}
                                                            {status === 'done'
                                                                ? completedAt
                                                                    ? `Completed ${dayjs(completedAt).format('DD MMM')}`
                                                                    : 'Completed'
                                                                : due
                                                                    ? `Due ${dayjs(due).format('DD MMM')}`
                                                                    : 'No due date'}
                                                        </Text>
                                                        {status !== 'done' && status !== 'cancelled' && dueMeta.overdue ? (
                                                            <Text type="danger" style={{ fontSize: 12 }}>
                                                                <ClockCircleOutlined /> {dueMeta.text.replace('Overdue by ', '')} overdue
                                                            </Text>
                                                        ) : null}
                                                    </div>
                                                </Space>
                                            </MotionCard>
                                        </div>
                                    )
                                }) : (
                                    <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description={`No ${c.title.toLowerCase()} tasks`}
                                        style={{ padding: '24px 8px' }}
                                    />
                                )}
                            </div>
                        </Card>
                    </Col>
                ))}
            </Row>
        )
    }

    const selectedMetricStyle = (status: TaskFilterStatus): React.CSSProperties =>
        statusFilter === status
            ? {
                borderColor: token.colorPrimary,
                boxShadow: `0 0 0 2px ${token.colorPrimaryBg}`
            }
            : {}
    const hasVisibleMetrics = Object.values(statusCounts).some(count => count > 0) || archivedTasks.length > 0

    /** UI */
    return (
        <div style={{ minHeight: '100vh', padding: 24 }}>
            <Helmet>
                <title>Tasks | Smart Incubator</title>
            </Helmet>

            {hasVisibleMetrics ? (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                        gap: 16,
                        marginBottom: 16
                    }}
                >
                    {statusCounts.todo > 0 ? (
                        <MotionCard.Metric
                            icon={<TableOutlined style={{ color: token.colorTextSecondary }} />}
                            iconBg={token.colorFillSecondary}
                            title="To Do"
                            value={statusCounts.todo}
                            subtitle="Tasks not started"
                            onClick={() => setStatusFilter(current => current === 'todo' ? 'all' : 'todo')}
                            wrapperStyle={selectedMetricStyle('todo')}
                        />
                    ) : null}
                    {statusCounts.in_progress > 0 ? (
                        <MotionCard.Metric
                            icon={<ClockCircleOutlined style={{ color: token.colorPrimary }} />}
                            iconBg={token.colorPrimaryBg}
                            title="In Progress"
                            value={statusCounts.in_progress}
                            subtitle="Tasks currently underway"
                            onClick={() => setStatusFilter(current => current === 'in_progress' ? 'all' : 'in_progress')}
                            wrapperStyle={selectedMetricStyle('in_progress')}
                        />
                    ) : null}
                    {statusCounts.done > 0 ? (
                        <MotionCard.Metric
                            icon={<CheckCircleOutlined style={{ color: token.colorSuccess }} />}
                            iconBg={token.colorSuccessBg}
                            title="Done"
                            value={statusCounts.done}
                            subtitle="Completed tasks"
                            onClick={() => setStatusFilter(current => current === 'done' ? 'all' : 'done')}
                            wrapperStyle={selectedMetricStyle('done')}
                        />
                    ) : null}
                    {statusCounts.overdue > 0 ? (
                        <MotionCard.Metric
                            icon={<ExclamationCircleOutlined style={{ color: token.colorError }} />}
                            iconBg={token.colorErrorBg}
                            title="Overdue"
                            value={statusCounts.overdue}
                            subtitle="Past their deadline"
                            onClick={() => setStatusFilter(current => current === 'overdue' ? 'all' : 'overdue')}
                            wrapperStyle={selectedMetricStyle('overdue')}
                        />
                    ) : null}
                    {statusCounts.cancelled > 0 ? (
                        <MotionCard.Metric
                            icon={<StopOutlined style={{ color: token.colorError }} />}
                            iconBg={token.colorErrorBg}
                            title="Cancelled"
                            value={statusCounts.cancelled}
                            subtitle="Cancelled tasks"
                            onClick={() => setStatusFilter(current => current === 'cancelled' ? 'all' : 'cancelled')}
                            wrapperStyle={selectedMetricStyle('cancelled')}
                        />
                    ) : null}
                    {archivedTasks.length > 0 ? (
                        <MotionCard.Metric
                            icon={<InboxOutlined style={{ color: token.colorWarning }} />}
                            iconBg={token.colorWarningBg}
                            title="Archived"
                            value={archivedTasks.length}
                            subtitle="View archived tasks"
                            onClick={() => setArchiveModalOpen(true)}
                        />
                    ) : null}
                </div>
            ) : null}

            <MotionCard
                filterBar={
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                            width: '100%',
                            minWidth: 0
                        }}
                    >
                        <Segmented
                            size="middle"
                            value={view}
                            onChange={value => setView(value as 'Board' | 'Table')}
                            options={[
                                { label: 'Board', value: 'Board', icon: <AppstoreOutlined /> },
                                { label: 'Table', value: 'Table', icon: <TableOutlined /> }
                            ]}
                        />

                        <Select
                            size="middle"
                            style={{ width: 190, flexShrink: 1 }}
                            value={deptFilter}
                            options={deptOptions}
                            onChange={val => setDeptFilter(val as any)}
                            placeholder="Department"
                            allowClear={false}
                            suffixIcon={<ApartmentOutlined />}
                            disabled={!myDeptIsMain}
                        />

                        <Select
                            size="middle"
                            style={{ width: 160, flexShrink: 1 }}
                            value={priorityFilter}
                            onChange={setPriorityFilter as any}
                            placeholder="Priority"
                            allowClear={false}
                            suffixIcon={<FlagOutlined />}
                            options={[{ label: 'All Priorities', value: 'all' }].concat(
                                (Object.keys(PRIORITY_META) as Priority[]).map(p => ({ label: PRIORITY_META[p].label, value: p }))
                            )}
                        />

                        <DatePicker.RangePicker
                            size="middle"
                            style={{ width: 250, flexShrink: 1 }}
                            value={dateRange}
                            onChange={val => setDateRange(val as [Dayjs, Dayjs] | null)}
                            allowClear
                        />

                        <Space size={6} style={{ marginLeft: 'auto', flexShrink: 0 }}>
                            <Button
                                size="middle"
                                shape="round"
                                icon={<FilterOutlined />}
                                onClick={() => {
                                    setDeptFilter('all')
                                    setStatusFilter('all')
                                    setPriorityFilter('all')
                                    setDateRange(null)
                                }}
                            >
                                Clear Filters
                            </Button>

                            {view === 'Table' && (
                                <Tooltip title="Archive selected tasks">
                                    <Button
                                        size="middle"
                                        shape="round"
                                        danger
                                        disabled={!selectedCount}
                                        onClick={archiveSelectedTasks}
                                    >
                                        Archive ({selectedCount})
                                    </Button>
                                </Tooltip>
                            )}

                            <Button size="middle" shape="round" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                                New Task
                            </Button>
                        </Space>
                    </div>
                }
            >
                {view === 'Board' && <Board />}

                {view === 'Table' &&
                    (tasks.length ? (
                        <Table
                            size="small"
                            rowKey="id"
                            loading={loading}
                            dataSource={tasks}
                            columns={columns}
                            pagination={{
                                pageSize: 10,
                                showSizeChanger: false,
                                responsive: true,
                                position: ['bottomCenter']
                            }}
                            scroll={{ x: 1250 }}
                            tableLayout="fixed"
                            sticky
                            onRow={record => ({
                                onClick: () => setSelectedTask(record),
                                style: { cursor: 'pointer' }
                            })}
                            rowSelection={{
                                selectedRowKeys,
                                onChange: keys => setSelectedRowKeys(keys)
                            }}
                        />
                    ) : (
                        <Empty />
                    ))}
            </MotionCard>

            <Modal
                open={!!selectedTask}
                title="Task Details"
                onCancel={() => setSelectedTask(null)}
                centered
                width={780}
                footer={
                    selectedTask ? (
                        <Space wrap>
                            <Button shape="round" onClick={() => setSelectedTask(null)}>
                                Close
                            </Button>
                            <Button
                                shape="round"
                                type="primary"
                                icon={
                                    safeStatus(selectedTask.status) === 'done' || safeStatus(selectedTask.status) === 'cancelled'
                                        ? <RollbackOutlined />
                                        : <CheckCircleOutlined />
                                }
                                onClick={() => runPrimaryTaskAction(selectedTask)}
                            >
                                {safeStatus(selectedTask.status) === 'done' || safeStatus(selectedTask.status) === 'cancelled'
                                    ? 'Reopen'
                                    : 'Mark Done'}
                            </Button>
                            <Dropdown menu={taskMoreMenu(selectedTask)} trigger={['click']} placement="topRight">
                                <Button shape="round" icon={<MoreOutlined />}>
                                    More
                                </Button>
                            </Dropdown>
                        </Space>
                    ) : null
                }
            >
                {selectedTask ? (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <div>
                            <Text strong style={{ display: 'block', fontSize: 18 }}>
                                {selectedTask.title}
                            </Text>
                            <Text type="secondary">{selectedTask.description || 'No description provided.'}</Text>
                        </div>

                        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                            <Descriptions.Item label="Status">
                                <Tag color={STATUS_META[safeStatus(selectedTask.status)].color}>
                                    {STATUS_META[safeStatus(selectedTask.status)].label}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Priority">
                                <Tag color={getPriorityMeta(selectedTask.priority).color}>
                                    {getPriorityMeta(selectedTask.priority).label}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Programme">
                                {programs.find(program => program.id === selectedTask.programId)?.name || selectedTask.programId || '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Department">
                                {departments.find(department => department.id === selectedTask.departmentId)?.name || selectedTask.departmentId || '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Start date">
                                {asDate(selectedTask.startAt) ? dayjs(asDate(selectedTask.startAt)!).format('DD MMM YYYY') : '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Due date">
                                {asDate(selectedTask.dueAt) ? dayjs(asDate(selectedTask.dueAt)!).format('DD MMM YYYY') : '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Intervention" span={2}>
                                {selectedTask.interventionId || 'Not linked'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Assignees" span={2}>
                                {selectedTask.assignees?.length ? (
                                    <Space wrap size={[6, 6]}>
                                        {selectedTask.assignees.map((assignment, index) => {
                                            const coordinator = coordinators.find(
                                                item => coordinatorKey(item) === assignment.userId || item.id === assignment.userId
                                            )
                                            return (
                                                <Tag key={`${assignment.userId}-${index}`} icon={<TeamOutlined />}>
                                                    {coordinator?.name || coordinator?.email || assignment.userId}
                                                </Tag>
                                            )
                                        })}
                                    </Space>
                                ) : (
                                    'Unassigned'
                                )}
                            </Descriptions.Item>
                        </Descriptions>
                    </Space>
                ) : null}
            </Modal>

            {/* Create / Edit Task Modal */}
            <Modal
                open={isModalOpen}
                title={editing ? 'Edit Task' : 'New Task'}
                onCancel={() => setModalOpen(false)}
                destroyOnClose={false}
                maskClosable={false}
                centered
                width={760}
                footer={
                    <Space wrap>
                        <Button shape="round" onClick={() => setModalOpen(false)}>Close</Button>
                        <Button shape="round" type="primary" onClick={handleSubmit}>
                            {editing ? 'Save' : 'Create'}
                        </Button>
                    </Space>
                }
            >
                <Form form={form} layout="vertical">
                    <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
                        <Input placeholder="What needs to be done?" />
                    </Form.Item>

                    <Form.Item name="description" label="Description" rules={[{ required: true, message: 'Description is required' }]}>
                        <Input.TextArea rows={3} placeholder="Details, links, acceptance criteria…" />
                    </Form.Item>

                    <Row gutter={12}>
                        <Col span={24}>
                            <Form.Item name="departmentId" label="Department" rules={[{ required: true, message: 'Department is required' }]}>
                                <Select
                                    style={{ width: '100%' }}
                                    allowClear={false}
                                    placeholder="Department"
                                    options={departments.map(d => ({ label: d.name, value: d.id }))}
                                    onChange={() => form.setFieldsValue({ assignees: [], interventionId: null })}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="priority" label="Priority" rules={[{ required: true }]} initialValue="medium">
                                <Select options={(Object.keys(PRIORITY_META) as Priority[]).map(p => ({ value: p, label: PRIORITY_META[p].label }))} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="status" label="Status" rules={[{ required: true }]} initialValue="todo">
                                <Select options={(Object.keys(STATUS_META) as Status[]).map(s => ({ value: s, label: STATUS_META[s].label }))} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="startAt" label="Start Date" initialValue={dayjs()} rules={[{ required: true, message: 'Start date is required' }]}>
                                <DatePicker style={{ width: '100%' }} disabledDate={current => !!current && current < dayjs().startOf('day')} />
                            </Form.Item>
                        </Col>

                        <Col span={12}>
                            <Form.Item name="dueAt" label="Due Date" initialValue={dayjs().add(7, 'day')} rules={[{ required: true, message: 'Due date is required' }]}>
                                <DatePicker style={{ width: '100%' }} disabledDate={current => !!current && current < dayjs().startOf('day')} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={12}>
                        <Col span={24}>
                            <Form.Item name="assignees" label="Coordinators" rules={[{ required: true, message: 'Select at least one coordinator' }]}>
                                <Select
                                    key={watchedDeptId || 'no-dept'}
                                    mode="multiple"
                                    placeholder={watchedDeptId ? 'Select coordinators' : 'Pick a department first'}
                                    notFoundContent={watchedDeptId ? 'No coordinators for this department' : 'Pick a department'}
                                    options={coordinatorOptions}
                                    showSearch
                                    optionFilterProp="label"
                                    disabled={!watchedDeptId}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Divider />

                    <Row gutter={12}>
                        <Col span={24}>
                            <Form.Item name="interventionId" label="Intervention (optional)">
                                <Select
                                    allowClear
                                    showSearch
                                    placeholder="Select intervention (optional)"
                                    options={interventionOptions}
                                    loading={loadingInterventions}
                                    notFoundContent={watchedDeptId ? 'No interventions for this department' : 'Pick a department first'}
                                    filterOption={(input, option) =>
                                        ((option?.label as string) || '').toLowerCase().includes(input.toLowerCase())
                                    }
                                    disabled={!watchedDeptId}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                open={isArchiveModalOpen}
                title={`Archived Tasks (${archivedTasks.length})`}
                onCancel={() => setArchiveModalOpen(false)}
                centered
                width={960}
                footer={
                    <Button shape="round" onClick={() => setArchiveModalOpen(false)}>
                        Close
                    </Button>
                }
            >
                <Table
                    rowKey="id"
                    dataSource={archivedTasks}
                    columns={archivedColumns}
                    pagination={{ pageSize: 8 }}
                    scroll={{ x: 820 }}
                    tableLayout="fixed"
                />
            </Modal>

        </div>
    )
}
