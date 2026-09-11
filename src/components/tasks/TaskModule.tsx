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
    EditOutlined,
    ArrowUpOutlined,
    ArrowLeftOutlined,
    LinkOutlined,
    CloseCircleOutlined
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
type TaskFormSection = 'title' | 'description' | 'assignment' | 'workflow' | 'schedule' | 'intervention'

const TASK_FORM_SECTIONS: Array<{
    key: TaskFormSection
    label: string
    createQuestion: string
    editQuestion: string
    fields: string[]
}> = [
    { key: 'title', label: 'Title', createQuestion: 'What would the task title be?', editQuestion: 'What should the task title be?', fields: ['title'] },
    { key: 'description', label: 'Description', createQuestion: 'What needs to be done?', editQuestion: 'How should the task description read?', fields: ['description'] },
    { key: 'assignment', label: 'Assignment', createQuestion: 'Which department and coordinators should own it?', editQuestion: 'Who should own this task now?', fields: ['departmentId', 'assignees'] },
    { key: 'workflow', label: 'Workflow', createQuestion: 'How should this task be prioritised?', editQuestion: 'What priority and status should this task have?', fields: ['priority', 'status'] },
    { key: 'schedule', label: 'Schedule', createQuestion: 'When should the task start and be completed?', editQuestion: 'When should this task now start and be due?', fields: ['startAt', 'dueAt'] },
    { key: 'intervention', label: 'Intervention', createQuestion: 'Should this task be linked to an intervention?', editQuestion: 'Which intervention should this task be linked to?', fields: ['interventionId'] }
]

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
    assignedPrograms?: string[]

}

type CoordinatorAccessUser = {
    id: string
    uid?: string | null
    email?: string | null
    assignedPrograms?: string[]
}

type Branch = { id: string; name: string }
type Department = { id: string; name: string; isMain?: boolean }
type Opt = { label: string; value: string }

/** ───────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────── */
const { Text } = Typography

const TypingPrompt: React.FC<{ text: string }> = ({ text }) => {
    const [visibleText, setVisibleText] = useState('')

    useEffect(() => {
        if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setVisibleText(text)
            return
        }

        setVisibleText('')
        let characterIndex = 0
        const timer = window.setInterval(() => {
            characterIndex += 1
            setVisibleText(text.slice(0, characterIndex))
            if (characterIndex >= text.length) window.clearInterval(timer)
        }, 42)

        return () => window.clearInterval(timer)
    }, [text])

    return (
        <span aria-label={text}>
            <span aria-hidden="true">{visibleText}</span>
            {visibleText.length < text.length ? <span className="task-typing-cursor" aria-hidden="true">|</span> : null}
        </span>
    )
}

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
    const [coordinatorUsers, setCoordinatorUsers] = useState<CoordinatorAccessUser[]>([])
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
    const [taskFormStep, setTaskFormStep] = useState(0)
    const [editSection, setEditSection] = useState<TaskFormSection | null>(null)
    const [editSectionChoice, setEditSectionChoice] = useState<TaskFormSection | undefined>()
    const [isCreateReview, setCreateReview] = useState(false)
    const [createReviewEditSection, setCreateReviewEditSection] = useState<TaskFormSection | null>(null)
    const [linkIntervention, setLinkIntervention] = useState<boolean | null>(null)
    const [isSavingTask, setSavingTask] = useState(false)
    const [form] = Form.useForm()
    const watchedDeptId = Form.useWatch('departmentId', form) as string | undefined
    const watchedPriority = Form.useWatch('priority', form) as Priority | undefined
    const watchedStatus = Form.useWatch('status', form) as Status | undefined

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

    /** department watch: fetch interventions for the active form selection */
    useEffect(() => {
        if (!watchedDeptId) {
            setInterventionOptions([])
            return
        }

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
                query(collection(db, 'users')),
                s => setCoordinatorUsers(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
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
        (deptId?: string) => {
            const targetProgramId = editing?.programId || (programId !== 'all' ? programId : '')
            if (!targetProgramId) return []

            return coordinators.filter(coordinator => {
                if ((coordinator.departmentId || '').trim() !== (deptId || '').trim()) return false

                const coordinatorIdentityIds = [coordinator.id, coordinator.uid, coordinator.authUid]
                    .filter(Boolean)
                    .map(value => String(value))
                const coordinatorEmail = String(coordinator.email || '').trim().toLowerCase()
                const linkedUser = coordinatorUsers.find(user => {
                    const userIds = [user.id, user.uid].filter(Boolean).map(value => String(value))
                    const matchesId = userIds.some(id => coordinatorIdentityIds.includes(id))
                    const matchesEmail = !!coordinatorEmail && String(user.email || '').trim().toLowerCase() === coordinatorEmail
                    return matchesId || matchesEmail
                })

                const userPrograms = Array.isArray(linkedUser?.assignedPrograms)
                    ? linkedUser.assignedPrograms.map(String).filter(Boolean)
                    : []
                const mirroredPrograms = Array.isArray(coordinator.assignedPrograms)
                    ? coordinator.assignedPrograms.map(String).filter(Boolean)
                    : []
                const accessiblePrograms = userPrograms.length ? userPrograms : mirroredPrograms

                return accessiblePrograms.includes(targetProgramId)
            })
        },
        [coordinators, coordinatorUsers, editing?.programId, programId]
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
        setTaskFormStep(0)
        setEditSection(null)
        setEditSectionChoice(undefined)
        setCreateReview(false)
        setCreateReviewEditSection(null)
        setLinkIntervention(null)
        setSavingTask(false)
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
            setTaskFormStep(0)
            setEditSection(null)
            setEditSectionChoice(undefined)
            setCreateReview(false)
            setCreateReviewEditSection(null)
            setLinkIntervention(!!row.interventionId)
            setSavingTask(false)
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
                        className: 'task-confirm-modal',
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
                    className: 'task-confirm-modal',
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
        if (isSavingTask) return
        await form.validateFields()
        const v = form.getFieldsValue(true)
        const deptId: string = v.departmentId
        const assigneeKeys: string[] = (v.assignees || []).map((x: any) => String(x))

        const picks = coordinatorsForDept(deptId)
        const selected = picks.filter(c => assigneeKeys.includes(coordinatorKey(c)))

        if (!selected.length) {
            message.error('Coordinators must belong to the department and have access to this program.')
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

        setSavingTask(true)
        try {
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
        } finally {
            setSavingTask(false)
        }
    }

    const handleEditSectionSubmit = async () => {
        if (isSavingTask) return
        if (!editing || !editSection) return

        const section = TASK_FORM_SECTIONS.find(item => item.key === editSection)
        if (!section) return
        if (editSection === 'intervention' && linkIntervention === null) {
            message.warning('Choose Yes or No first.')
            return
        }

        await form.validateFields(section.fields)
        const values = form.getFieldsValue(true)
        let payload: Record<string, any> = { updatedAt: serverTimestamp() }

        if (editSection === 'title') payload.title = values.title
        if (editSection === 'description') payload.description = values.description
        if (editSection === 'workflow') {
            payload.priority = safePriority(values.priority)
            payload.status = safeStatus(values.status)
        }
        if (editSection === 'schedule') {
            payload.startAt = values.startAt ? ts(values.startAt) : null
            payload.dueAt = ts(values.dueAt)
        }
        if (editSection === 'intervention') payload.interventionId = values.interventionId ?? null

        if (editSection === 'assignment') {
            const departmentId = String(values.departmentId)
            const assigneeKeys = (values.assignees || []).map((value: any) => String(value))
            const selected = coordinatorsForDept(departmentId).filter(coordinator =>
                assigneeKeys.includes(coordinatorKey(coordinator))
            )

            if (!selected.length) {
                message.error('Coordinators must belong to the department and have access to this program.')
                return
            }

            payload = {
                ...payload,
                departmentId,
                assignees: selected.map(coordinator => ({
                    userId: coordinatorKey(coordinator),
                    branchId: coordinator.branchId ?? null,
                    departmentId
                })),
                interventionId: values.interventionId ?? null
            }
        }

        setSavingTask(true)
        try {
            await updateDoc(doc(db, 'tasks', editing.id), payload)
            message.success(`${section.label} updated`)
            setModalOpen(false)
        } finally {
            setSavingTask(false)
        }
    }

    /** columns */
    const columns: any[] = [
        {
            title: 'Task',
            dataIndex: 'title',
            width: 160,
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
                                {isTerminal ? 'Reopen' : 'Complete'}
                            </Button>
                            <Dropdown menu={taskMoreMenu(row)} trigger={['click']} placement="bottomRight">
                                <Button
                                    aria-label="Task actions"
                                    size="small"
                                    shape="round"
                                    icon={<MoreOutlined />}
                                    onClick={event => event.stopPropagation()}
                                />
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
    const activeCreateSection = TASK_FORM_SECTIONS[taskFormStep]

    const sendTextAnswer = async () => {
        const sectionKey = editing ? editSection : createReviewEditSection || activeCreateSection.key
        const section = TASK_FORM_SECTIONS.find(item => item.key === sectionKey)
        if (!section) return
        await form.validateFields(section.fields)

        if (editing) {
            await handleEditSectionSubmit()
            return
        }

        if (createReviewEditSection) {
            setCreateReviewEditSection(null)
            setCreateReview(true)
            return
        }

        setTaskFormStep(step => step + 1)
    }

    const renderTaskFormSection = (section: TaskFormSection) => {
        if (section === 'title') {
            return (
                <Form.Item name="title" rules={[{ required: true, message: 'Title is required' }]}>
                    <Input
                        size="large"
                        placeholder="e.g. Prepare the monthly progress report"
                        autoFocus
                        onPressEnter={() => void sendTextAnswer()}
                        suffix={
                            <Button
                                aria-label="Send title"
                                size="small"
                                shape="round"
                                type="primary"
                                icon={<ArrowUpOutlined />}
                                loading={isSavingTask}
                                onClick={() => void sendTextAnswer()}
                                style={{ width: 30, height: 30, padding: 0 }}
                            />
                        }
                    />
                </Form.Item>
            )
        }

        if (section === 'description') {
            return (
                <div style={{ position: 'relative' }}>
                    <Form.Item
                        name="description"
                        rules={[{ required: true, message: 'Description is required' }]}
                        style={{ marginBottom: 0 }}
                    >
                        <Input.TextArea
                            autoSize={{ minRows: 1, maxRows: 8 }}
                            placeholder="Describe the expected work and outcome"
                            autoFocus
                            onPressEnter={event => {
                                if (event.shiftKey) return
                                event.preventDefault()
                                void sendTextAnswer()
                            }}
                            style={{ paddingRight: 48 }}
                        />
                    </Form.Item>
                    <Button
                        aria-label="Send description"
                        size="small"
                        shape="round"
                        type="primary"
                        icon={<ArrowUpOutlined />}
                        loading={isSavingTask}
                        onClick={() => void sendTextAnswer()}
                        style={{ position: 'absolute', right: 6, top: 5, width: 30, height: 30, padding: 0 }}
                    />
                </div>
            )
        }

        if (section === 'assignment') {
            return (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Form.Item name="departmentId" label="Department" rules={[{ required: true, message: 'Department is required' }]}>
                        <Select
                            size="large"
                            style={{ width: '100%' }}
                            placeholder="Select a department"
                            options={departments.map(department => ({ label: department.name, value: department.id }))}
                            onChange={() => form.setFieldsValue({ assignees: [], interventionId: null })}
                        />
                    </Form.Item>
                    <Form.Item name="assignees" label="Coordinators" rules={[{ required: true, message: 'Select at least one coordinator' }]}>
                        <Select
                            key={watchedDeptId || 'no-dept'}
                            size="large"
                            mode="multiple"
                            placeholder={watchedDeptId ? 'Select coordinators' : 'Choose a department first'}
                            notFoundContent={watchedDeptId ? 'No coordinators with access to this program' : 'Choose a department'}
                            options={coordinatorOptions}
                            showSearch
                            optionFilterProp="label"
                            disabled={!watchedDeptId}
                        />
                    </Form.Item>
                </Space>
            )
        }

        if (section === 'workflow') {
            return (
                <Space direction="vertical" size={22} style={{ width: '100%' }}>
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 10 }}>Priority</Text>
                        <Form.Item name="priority" hidden rules={[{ required: true, message: 'Choose a priority' }]}>
                            <Input />
                        </Form.Item>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                            {(Object.keys(PRIORITY_META) as Priority[]).map(priority => {
                                const meta = PRIORITY_META[priority]
                                const selected = watchedPriority === priority
                                return (
                                    <div
                                        key={priority}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => form.setFieldValue('priority', priority)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault()
                                                form.setFieldValue('priority', priority)
                                            }
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 7,
                                            minHeight: 62,
                                            padding: '10px 8px',
                                            border: `2px solid ${selected ? token.colorPrimary : token.colorBorder}`,
                                            borderRadius: 12,
                                            background: selected ? token.colorPrimaryBg : token.colorFillAlter,
                                            color: selected ? token.colorPrimary : token.colorText,
                                            cursor: 'pointer',
                                            fontWeight: selected ? 600 : 500
                                        }}
                                    >
                                        <FlagOutlined style={{ color: selected ? token.colorPrimary : meta.color }} />
                                        {meta.label}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 10 }}>Status</Text>
                        <Form.Item name="status" hidden rules={[{ required: true, message: 'Choose a status' }]}>
                            <Input />
                        </Form.Item>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                            {(Object.keys(STATUS_META) as Status[]).map(status => {
                                const meta = STATUS_META[status]
                                const selected = watchedStatus === status
                                return (
                                    <div
                                        key={status}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => form.setFieldValue('status', status)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault()
                                                form.setFieldValue('status', status)
                                            }
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            minHeight: 62,
                                            padding: '10px 8px',
                                            border: `2px solid ${selected ? token.colorPrimary : token.colorBorder}`,
                                            borderRadius: 12,
                                            background: selected ? token.colorPrimaryBg : token.colorFillAlter,
                                            color: selected ? token.colorPrimary : token.colorText,
                                            cursor: 'pointer',
                                            fontWeight: selected ? 600 : 500,
                                            textAlign: 'center'
                                        }}
                                    >
                                        {meta.label}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </Space>
            )
        }

        if (section === 'schedule') {
            return (
                <Row gutter={12}>
                    <Col xs={24} sm={12}>
                        <Form.Item name="startAt" label="Start date" rules={[{ required: true, message: 'Start date is required' }]}>
                            <DatePicker size="large" style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name="dueAt" label="Due date" rules={[{ required: true, message: 'Due date is required' }]}>
                            <DatePicker size="large" style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                </Row>
            )
        }

        return (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    {[
                        { value: true, label: 'Yes', icon: <LinkOutlined /> },
                        { value: false, label: 'No', icon: <CloseCircleOutlined /> }
                    ].map(option => {
                        const selected = linkIntervention === option.value
                        return (
                            <div
                                key={String(option.value)}
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                    setLinkIntervention(option.value)
                                    if (!option.value) form.setFieldValue('interventionId', null)
                                }}
                                onKeyDown={event => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return
                                    setLinkIntervention(option.value)
                                    if (!option.value) form.setFieldValue('interventionId', null)
                                }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 10,
                                    minHeight: 82,
                                    border: `2px solid ${selected ? token.colorPrimary : token.colorBorder}`,
                                    borderRadius: 14,
                                    background: selected ? token.colorPrimaryBg : token.colorFillAlter,
                                    color: selected ? token.colorPrimary : token.colorText,
                                    cursor: 'pointer',
                                    fontSize: 16,
                                    fontWeight: 600
                                }}
                            >
                                {option.icon}
                                {option.label}
                            </div>
                        )
                    })}
                </div>

                {linkIntervention ? (
                    <Form.Item
                        name="interventionId"
                        label="Intervention"
                        rules={[{ required: true, message: 'Select an intervention' }]}
                        style={{ marginBottom: 0 }}
                    >
                        <Select
                            size="large"
                            showSearch
                            placeholder="Select an intervention"
                            options={interventionOptions}
                            loading={loadingInterventions}
                            notFoundContent={watchedDeptId ? 'No interventions for this department' : 'Choose a department first'}
                            filterOption={(input, option) =>
                                ((option?.label as string) || '').toLowerCase().includes(input.toLowerCase())
                            }
                            disabled={!watchedDeptId}
                        />
                    </Form.Item>
                ) : null}
            </Space>
        )
    }

    const continueTaskConversation = async () => {
        if (activeCreateSection.key === 'intervention' && linkIntervention === null) {
            message.warning('Choose Yes or No first.')
            return
        }
        await form.validateFields(activeCreateSection.fields)
        if (taskFormStep === TASK_FORM_SECTIONS.length - 1) {
            setCreateReviewEditSection(null)
            setCreateReview(true)
            return
        }
        setTaskFormStep(step => step + 1)
    }

    const openCreateReviewSection = (section: TaskFormSection) => {
        const sectionIndex = TASK_FORM_SECTIONS.findIndex(item => item.key === section)
        if (sectionIndex < 0) return
        setTaskFormStep(sectionIndex)
        setCreateReviewEditSection(section)
        setCreateReview(false)
    }

    const saveCreateReviewSection = async () => {
        if (!createReviewEditSection) return
        const section = TASK_FORM_SECTIONS.find(item => item.key === createReviewEditSection)
        if (!section) return
        if (section.key === 'intervention' && linkIntervention === null) {
            message.warning('Choose Yes or No first.')
            return
        }
        await form.validateFields(section.fields)
        setCreateReviewEditSection(null)
        setCreateReview(true)
    }

    const createReviewValue = (section: TaskFormSection) => {
        const values = form.getFieldsValue(true)
        if (section === 'title') return values.title || 'Not provided'
        if (section === 'description') return values.description || 'Not provided'
        if (section === 'assignment') {
            const departmentName = departments.find(department => department.id === values.departmentId)?.name || 'No department'
            const assigneeNames = (values.assignees || []).map((key: string) => {
                const coordinator = coordinators.find(item => coordinatorKey(item) === key || item.id === key)
                return coordinator?.name || coordinator?.email || key
            })
            return `${departmentName}${assigneeNames.length ? ` · ${assigneeNames.join(', ')}` : ''}`
        }
        if (section === 'workflow') {
            return `${getPriorityMeta(values.priority).label} · ${STATUS_META[safeStatus(values.status)].label}`
        }
        if (section === 'schedule') {
            const start = values.startAt ? dayjs(values.startAt).format('DD MMM YYYY') : 'No start date'
            const due = values.dueAt ? dayjs(values.dueAt).format('DD MMM YYYY') : 'No due date'
            return `${start} → ${due}`
        }
        return interventionOptions.find(option => option.value === values.interventionId)?.label || 'Not linked'
    }

    const currentConversationSection = editing ? editSection : createReviewEditSection || activeCreateSection.key
    const conversationUsesSend = currentConversationSection === 'title' || currentConversationSection === 'description'

    /** UI */
    return (
        <div style={{ padding: '8px 24px' }}>
            <Helmet>
                <title>Tasks | Smart Incubator</title>
            </Helmet>
            <style>{`
                .task-confirm-modal .ant-modal-confirm-btns {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 8px;
                }
                .task-confirm-modal .ant-modal-confirm-btns .ant-btn {
                    width: 100%;
                    margin-inline-start: 0 !important;
                }
            `}</style>

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
                                onClick: event => {
                                    const target = event.target as HTMLElement
                                    if (target.closest('.ant-checkbox-wrapper, .ant-checkbox')) return
                                    setSelectedTask(record)
                                },
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
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: `repeat(${safeStatus(selectedTask.status) === 'done' || safeStatus(selectedTask.status) === 'cancelled' ? 3 : 4}, minmax(0, 1fr))`,
                                gap: 8
                            }}
                        >
                            <Button
                                block
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
                                    : 'Complete'}
                            </Button>
                            <Button
                                block
                                shape="round"
                                icon={<EditOutlined />}
                                onClick={() => {
                                    const task = selectedTask
                                    setSelectedTask(null)
                                    openEdit(task)
                                }}
                            >
                                Edit
                            </Button>
                            {safeStatus(selectedTask.status) !== 'done' && safeStatus(selectedTask.status) !== 'cancelled' ? (
                                <Button
                                    block
                                    shape="round"
                                    danger
                                    icon={<StopOutlined />}
                                    onClick={() =>
                                        Modal.confirm({
                                            className: 'task-confirm-modal',
                                            title: 'Cancel task?',
                                            content: 'This will move the task to Cancelled.',
                                            okText: 'Cancel Task',
                                            okButtonProps: { danger: true, shape: 'round' },
                                            cancelButtonProps: { shape: 'round' },
                                            onOk: async () => {
                                                await cancelTask(selectedTask.id)
                                                setSelectedTask(null)
                                            }
                                        })
                                    }
                                >
                                    Cancel Task
                                </Button>
                            ) : null}
                            <Button
                                block
                                shape="round"
                                icon={<InboxOutlined />}
                                onClick={() =>
                                    Modal.confirm({
                                        className: 'task-confirm-modal',
                                        title: 'Archive task?',
                                        content: 'This will hide it from the active board.',
                                        okText: 'Archive',
                                        okButtonProps: { shape: 'round' },
                                        cancelButtonProps: { shape: 'round' },
                                        onOk: async () => {
                                            await archiveTask(selectedTask.id)
                                            setSelectedTask(null)
                                        }
                                    })
                                }
                            >
                                Archive
                            </Button>
                        </div>
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

            {/* Conversational Create / Edit Task Modal */}
            <Modal
                open={isModalOpen}
                title={editing ? 'Edit Task' : 'New Task'}
                onCancel={() => setModalOpen(false)}
                destroyOnClose={false}
                maskClosable={false}
                centered
                width={editing ? 760 : 860}
                footer={
                    editing ? (
                        editSection ? (
                            conversationUsesSend ? (
                                <Button block shape="round" icon={<ArrowLeftOutlined />} onClick={() => setEditSection(null)}>
                                    Back
                                </Button>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                                    <Button block shape="round" icon={<ArrowLeftOutlined />} onClick={() => setEditSection(null)}>
                                        Back
                                    </Button>
                                    <Button block shape="round" type="primary" loading={isSavingTask} onClick={handleEditSectionSubmit}>
                                        Save Changes
                                    </Button>
                                </div>
                            )
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                                <Button
                                    block
                                    shape="round"
                                    icon={<ArrowLeftOutlined />}
                                    onClick={() => {
                                        setModalOpen(false)
                                        setSelectedTask(editing)
                                    }}
                                >
                                    Back
                                </Button>
                                <Button
                                    block
                                    shape="round"
                                    type="primary"
                                    disabled={!editSectionChoice}
                                    onClick={() => editSectionChoice && setEditSection(editSectionChoice)}
                                >
                                    Continue
                                </Button>
                            </div>
                        )
                    ) : isCreateReview ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                            <Button
                                block
                                shape="round"
                                icon={<ArrowLeftOutlined />}
                                onClick={() => {
                                    setTaskFormStep(TASK_FORM_SECTIONS.length - 1)
                                    setCreateReview(false)
                                }}
                            >
                                Back
                            </Button>
                            <Button block shape="round" type="primary" loading={isSavingTask} onClick={handleSubmit}>
                                Create Task
                            </Button>
                        </div>
                    ) : createReviewEditSection ? (
                        conversationUsesSend ? (
                            <Button
                                block
                                shape="round"
                                icon={<ArrowLeftOutlined />}
                                onClick={() => {
                                    setCreateReviewEditSection(null)
                                    setCreateReview(true)
                                }}
                            >
                                Back to Review
                            </Button>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                                <Button
                                    block
                                    shape="round"
                                    icon={<ArrowLeftOutlined />}
                                    onClick={() => {
                                        setCreateReviewEditSection(null)
                                        setCreateReview(true)
                                    }}
                                >
                                    Back to Review
                                </Button>
                                <Button block shape="round" type="primary" onClick={saveCreateReviewSection}>
                                    Save Changes
                                </Button>
                            </div>
                        )
                    ) : conversationUsesSend ? (
                        <Button
                            block
                            shape="round"
                            icon={<ArrowLeftOutlined />}
                            onClick={() => {
                                if (taskFormStep === 0) setModalOpen(false)
                                else setTaskFormStep(step => step - 1)
                            }}
                        >
                            Back
                        </Button>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                            <Button block shape="round" icon={<ArrowLeftOutlined />} onClick={() => setTaskFormStep(step => step - 1)}>
                                Back
                            </Button>
                            <Button block shape="round" type="primary" onClick={continueTaskConversation}>
                                {taskFormStep === TASK_FORM_SECTIONS.length - 1 ? 'Review Task' : 'Continue'}
                            </Button>
                        </div>
                    )
                }
            >
                {editing && !editSection ? (
                    <div
                        key="edit-section-choice"
                        style={{ width: '100%', maxWidth: 660, margin: '24px auto', animation: 'task-conversation-in .28s ease both' }}
                    >
                        <Text type="secondary" style={{ display: 'block', textAlign: 'center' }}>Choose one area to update</Text>
                        <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 22, margin: '8px 0 24px' }}>
                            What would you like to edit?
                        </Text>
                        <Select
                            size="large"
                            style={{ width: '100%' }}
                            value={editSectionChoice}
                            onChange={value => setEditSectionChoice(value)}
                            placeholder="Select a section"
                            options={TASK_FORM_SECTIONS.map(section => ({
                                label: section.label,
                                value: section.key
                            }))}
                        />
                    </div>
                ) : isCreateReview ? (
                    <div
                        key="create-review"
                        style={{ width: '100%', maxWidth: 720, margin: '12px auto 20px', animation: 'task-conversation-in .28s ease both' }}
                    >
                        <Text
                            type="secondary"
                            style={{ display: 'block', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}
                        >
                            Review
                        </Text>
                        <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 26px', minHeight: 32 }}>
                            <TypingPrompt text="Does everything look right?" />
                        </Text>

                        <div style={{ display: 'grid', gap: 8 }}>
                            {TASK_FORM_SECTIONS.map(section => (
                                <div
                                    key={section.key}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => openCreateReviewSection(section.key)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ') openCreateReviewSection(section.key)
                                    }}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '130px minmax(0, 1fr) auto',
                                        alignItems: 'center',
                                        gap: 16,
                                        padding: '12px 16px',
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        borderRadius: 12,
                                        background: token.colorFillAlter,
                                        cursor: 'pointer'
                                    }}
                                >
                                    <Text type="secondary">{section.label}</Text>
                                    <Text ellipsis={{ tooltip: String(createReviewValue(section.key)) }}>
                                        {createReviewValue(section.key)}
                                    </Text>
                                    <EditOutlined style={{ color: token.colorPrimary }} />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    (() => {
                        const section = editing
                            ? TASK_FORM_SECTIONS.find(item => item.key === editSection)!
                            : activeCreateSection
                        return (
                            <div
                                key={section.key}
                                style={{ width: '100%', maxWidth: 700, minHeight: 350, margin: '0 auto', padding: '34px 0 18px', animation: 'task-conversation-in .28s ease both' }}
                            >
                                <Text
                                    type="secondary"
                                    style={{ display: 'block', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}
                                >
                                    {editing || createReviewEditSection ? `Editing ${section.label}` : section.label}
                                </Text>
                                <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 28px', minHeight: 32 }}>
                                    {editing ? (
                                        section.editQuestion
                                    ) : (
                                        <TypingPrompt text={createReviewEditSection ? section.editQuestion : section.createQuestion} />
                                    )}
                                </Text>
                                <Form form={form} layout="vertical" preserve style={{ width: '100%', maxWidth: 660, margin: '0 auto' }}>
                                    {renderTaskFormSection(section.key)}
                                </Form>
                            </div>
                        )
                    })()
                )}

                <style>{`
                    @keyframes task-conversation-in {
                        from {
                            opacity: 0;
                            transform: translateX(22px);
                        }
                        to {
                            opacity: 1;
                            transform: translateX(0);
                        }
                    }
                    .task-typing-cursor {
                        display: inline-block;
                        margin-left: 2px;
                        color: ${token.colorPrimary};
                        animation: task-cursor-blink .8s steps(1) infinite;
                    }
                    @keyframes task-cursor-blink {
                        50% { opacity: 0; }
                    }
                `}</style>
            </Modal>

            <Modal
                open={isArchiveModalOpen}
                title={`Archived Tasks (${archivedTasks.length})`}
                onCancel={() => setArchiveModalOpen(false)}
                centered
                width={960}
                footer={null}
            >
                <Table
                    rowKey="id"
                    dataSource={archivedTasks}
                    columns={archivedColumns}
                    pagination={{ pageSize: 8, showSizeChanger: false, position: ['bottomCenter'] }}
                    scroll={{ x: 820 }}
                    tableLayout="fixed"
                />
            </Modal>

        </div>
    )
}
