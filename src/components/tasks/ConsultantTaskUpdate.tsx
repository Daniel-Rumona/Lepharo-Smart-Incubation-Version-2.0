import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Space,
    Button,
    Table,
    Tag,
    Modal,
    Form,
    Input,
    Select,
    Empty,
    message,
    Typography,
    Badge,
    Progress,
    Alert,
    Grid,
    theme
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    BarChartOutlined,
    EditOutlined,
    ProjectOutlined,
    ApartmentOutlined,
    SearchOutlined,
    FilterOutlined,
    UnorderedListOutlined,
    ArrowLeftOutlined,
    ArrowUpOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import {
    collection,
    query,
    where,
    onSnapshot,
    updateDoc,
    doc,
    serverTimestamp,
    Timestamp,
    arrayUnion,
    QueryConstraint
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '../dashboards/metrics/Header'

type Priority = 'low' | 'medium' | 'high' | 'urgent'
type Status = 'todo' | 'in_progress' | 'cancelled' | 'done'
type UpdateSection = 'status' | 'progress' | 'bottleneck' | 'note'

const UPDATE_SECTIONS: Array<{
    key: UpdateSection
    label: string
    question: string
    fields: string[]
}> = [
        { key: 'status', label: 'Status', question: 'What is the task status now?', fields: ['status'] },
        { key: 'progress', label: 'Progress', question: 'How much of the task is complete?', fields: ['progressPercent'] },
        { key: 'bottleneck', label: 'Bottleneck', question: 'Is anything slowing the task down?', fields: ['bottleneck'] },
        { key: 'note', label: 'Update note', question: 'What progress would you like to record?', fields: ['note'] }
    ]

type Assignment = {
    userId: string
    branchId?: string | null
    departmentId?: string | null
}

type CoordinatorUpdate = {
    by: string
    byName?: string | null
    at: Timestamp
    status: Status
    progressPercent: number
    note?: string | null
    bottleneck?: string | null
}

type TaskDoc = {
    title: string
    description: string
    departmentId?: string
    programId?: string
    priority: Priority
    status: Status
    dueAt?: Timestamp | null
    createdAt?: Timestamp
    updatedAt?: Timestamp
    createdBy?: string
    assignees?: Assignment[]
    progressPercent?: number
    coordinatorUpdates?: CoordinatorUpdate[]
    currentBottleneck?: string | null
    lastUpdatedBy?: string | null
}

type TaskRow = TaskDoc & { id: string }
type Program = { id: string; name: string }
type Department = { id: string; name: string }

const { Text } = Typography
const { TextArea } = Input
const { useBreakpoint } = Grid

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

    return <span aria-label={text}><span aria-hidden="true">{visibleText}</span></span>
}

const STATUS_META: Record<Status, { label: string; color: string }> = {
    todo: { label: 'To Do', color: 'default' },
    in_progress: { label: 'In Progress', color: 'processing' },
    cancelled: { label: 'Cancelled', color: 'error' },
    done: { label: 'Done', color: 'success' }
}

const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
    low: { label: 'Low', color: 'default' },
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

const isFsTimestamp = (x: any) => x && typeof x.toDate === 'function'

const asDate = (x: any): Date | null => {
    if (!x) return null
    if (isFsTimestamp(x)) return x.toDate()
    if (x instanceof Date) return x
    if (typeof x === 'string') {
        const d = new Date(x)
        return Number.isNaN(d.getTime()) ? null : d
    }
    if (typeof x === 'number') return new Date(x)
    if (x?.seconds != null) return new Date(x.seconds * 1000)
    return null
}

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
    if (!due) return { text: 'No deadline', color: 'default' as const, overdue: false }

    const diff = due.getTime() - Date.now()

    if (diff < 0) {
        return {
            text: `Overdue by ${formatDuration(Math.abs(diff))}`,
            color: 'red' as const,
            overdue: true
        }
    }

    const day = 24 * 60 * 60 * 1000
    const color = diff < day ? 'red' : diff < day * 3 ? 'orange' : 'green'

    return {
        text: `${formatDuration(diff)} left`,
        color: color as 'red' | 'orange' | 'green',
        overdue: false
    }
}

export default function CoordinatorTasksOnly() {
    const { user } = useFullIdentity()
    const { programId: activeProgramId } = useActiveProgramId()
    const screens = useBreakpoint()
    const { token } = theme.useToken()

    const assignedProgramIds = useMemo(
        () => Array.isArray((user as any)?.assignedPrograms)
            ? (user as any).assignedPrograms.map((value: unknown) => String(value)).filter(Boolean)
            : [],
        [(user as any)?.assignedPrograms]
    )

    const userIdentityKeys = useMemo(
        () => new Set(
            [(user as any)?.id, (user as any)?.uid, user?.email]
                .filter(Boolean)
                .map(value => String(value).trim().toLowerCase())
        ),
        [(user as any)?.id, (user as any)?.uid, user?.email]
    )

    const [coordinatorDocId, setCoordinatorDocId] = useState<string | null>(null)
    const [tasks, setTasks] = useState<TaskRow[]>([])
    const [loading, setLoading] = useState(true)

    const [programs, setPrograms] = useState<Program[]>([])
    const [departments, setDepartments] = useState<Department[]>([])

    const [q, setQ] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
    const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null)
    const [analyticsOpen, setAnalyticsOpen] = useState(false)
    const [updateOpen, setUpdateOpen] = useState(false)
    const [updateForm] = Form.useForm()
    const [updateStep, setUpdateStep] = useState(0)
    const [updateReview, setUpdateReview] = useState(false)
    const [updateReviewEditSection, setUpdateReviewEditSection] = useState<UpdateSection | null>(null)
    const [isSavingUpdate, setSavingUpdate] = useState(false)
    const watchedUpdateStatus = Form.useWatch('status', updateForm) as Status | undefined

    useEffect(() => {
        if (!user?.email) {
            setCoordinatorDocId(null)
            return
        }

        const unsub = onSnapshot(collection(db, 'coordinators'), snap => {
            let cid: string | null = null
            snap.forEach(docSnap => {
                const data = docSnap.data() as any
                if (String(data?.email || '').toLowerCase() === user.email.toLowerCase()) {
                    cid = docSnap.id
                }
            })
            setCoordinatorDocId(cid)
        })

        return () => unsub()
    }, [user?.email])

    useEffect(() => {

        const unsubPrograms = onSnapshot(
            query(collection(db, 'programs')),
            snap => setPrograms(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
        )

        const unsubDepartments = onSnapshot(
            query(collection(db, 'departments')),
            snap => setDepartments(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
        )

        return () => {
            unsubPrograms()
            unsubDepartments()
        }
    }, [])

    useEffect(() => {
        if (!user?.email || !activeProgramId) {
            console.warn('[CoordinatorTasks] subscription skipped', {
                hasEmail: !!user?.email,
                activeProgramId: activeProgramId || null
            })
            setTasks([])
            setLoading(false)
            return
        }

        setLoading(true)

        const constraints: QueryConstraint[] = activeProgramId === 'all'
            ? []
            : [where('programId', '==', activeProgramId)]

        console.info('[CoordinatorTasks] subscribing', {
            activeProgramId,
            assignedProgramIds,
            identityKeys: Array.from(userIdentityKeys),
            coordinatorDocId
        })

        const unsub = onSnapshot(query(collection(db, 'tasks'), ...constraints), snap => {
            const acceptedIdentityKeys = new Set(userIdentityKeys)
            if (coordinatorDocId) acceptedIdentityKeys.add(String(coordinatorDocId).trim().toLowerCase())

            const snapshotRows = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            }) as TaskRow)
            const diagnostics = snapshotRows.map(task => {
                const assigneeIds = (task.assignees || []).map(assignment => String(assignment?.userId || '').trim().toLowerCase())
                const isAssignedToCurrentUser = (task.assignees || []).some(a =>
                    acceptedIdentityKeys.has(String(a?.userId || '').trim().toLowerCase())
                )
                const isInAccessibleProgram = activeProgramId !== 'all'
                    || assignedProgramIds.includes(String(task.programId || ''))
                return {
                    id: task.id,
                    programId: task.programId || null,
                    assigneeIds,
                    identityMatch: isAssignedToCurrentUser,
                    programMatch: isInAccessibleProgram,
                    visible: isAssignedToCurrentUser && isInAccessibleProgram
                }
            })

            console.info('[CoordinatorTasks] snapshot result', {
                snapshotCount: snapshotRows.length,
                visibleCount: diagnostics.filter(item => item.visible).length,
                activeProgramId
            })
            console.table(diagnostics)

            const visibleIds = new Set(diagnostics.filter(item => item.visible).map(item => item.id))
            const rows = snapshotRows
                .filter(task => visibleIds.has(task.id))
                .map(r => ({
                    ...r,
                    priority: safePriority(r.priority),
                    status: safeStatus(r.status)
                }))

            setTasks(rows)
            setLoading(false)
        }, error => {
            console.error('Unable to load assigned tasks', error)
            setTasks([])
            setLoading(false)
            message.error('Unable to load your assigned tasks.')
        })

        return () => unsub()
    }, [user?.email, coordinatorDocId, activeProgramId, assignedProgramIds, userIdentityKeys])
    const filteredTasks = useMemo(() => {
        return tasks.filter(task => {
            const needle = q.toLowerCase().trim()

            const matchesQ =
                !needle ||
                String(task.title || '').toLowerCase().includes(needle) ||
                String(task.description || '').toLowerCase().includes(needle) ||
                String(task.currentBottleneck || '').toLowerCase().includes(needle)

            const matchesStatus = statusFilter === 'all' || safeStatus(task.status) === statusFilter

            return matchesQ && matchesStatus
        })
    }, [tasks, q, statusFilter])

    const totalTasks = filteredTasks.length

    const overdueTasks = filteredTasks.filter(t => {
        const due = asDate(t.dueAt)
        return due && due.getTime() < Date.now() && safeStatus(t.status) !== 'done'
    }).length

    const completionRate = totalTasks
        ? Math.round((filteredTasks.filter(t => safeStatus(t.status) === 'done').length / totalTasks) * 100)
        : 0

    const statusSeries = useMemo(() => {
        const counts: Record<Status, number> = {
            todo: 0,
            in_progress: 0,
            cancelled: 0,
            done: 0
        }

        filteredTasks.forEach(t => {
            counts[safeStatus(t.status)] += 1
        })

        return [
            { name: 'To Do', y: counts.todo },
            { name: 'In Progress', y: counts.in_progress },
            { name: 'Done', y: counts.done },
            { name: 'Cancelled', y: counts.cancelled }
        ]
    }, [filteredTasks])

    const prioritySeries = useMemo(() => {
        const counts: Record<Priority, number> = {
            low: 0,
            medium: 0,
            high: 0,
            urgent: 0
        }

        filteredTasks.forEach(t => {
            counts[safePriority(t.priority)] += 1
        })

        return [
            { name: 'Low', y: counts.low },
            { name: 'Medium', y: counts.medium },
            { name: 'High', y: counts.high },
            { name: 'Urgent', y: counts.urgent }
        ]
    }, [filteredTasks])

    const deadlineSeries = useMemo(() => {
        const buckets = {
            overdue: 0,
            today: 0,
            week: 0,
            later: 0,
            no_deadline: 0
        }

        filteredTasks.forEach(t => {
            const due = asDate(t.dueAt)
            const status = safeStatus(t.status)

            if (!due) {
                buckets.no_deadline += 1
                return
            }

            if (status === 'done' || status === 'cancelled') return

            const dueDay = dayjs(due)
            if (dueDay.isBefore(dayjs(), 'day')) buckets.overdue += 1
            else if (dueDay.isSame(dayjs(), 'day')) buckets.today += 1
            else if (dueDay.isBefore(dayjs().add(7, 'day').endOf('day'))) buckets.week += 1
            else buckets.later += 1
        })

        return [buckets.overdue, buckets.today, buckets.week, buckets.later, buckets.no_deadline]
    }, [filteredTasks])

    const openUpdate = (task: TaskRow) => {
        setSelectedTask(task)
        updateForm.setFieldsValue({
            status: safeStatus(task.status),
            progressPercent: typeof task.progressPercent === 'number' ? task.progressPercent : 0,
            note: '',
            bottleneck: task.currentBottleneck || ''
        })
        setUpdateStep(0)
        setUpdateReview(false)
        setUpdateReviewEditSection(null)
        setSavingUpdate(false)
        setUpdateOpen(true)
    }

    const submitUpdate = async () => {
        if (!selectedTask || isSavingUpdate) return

        try {
            const values = await updateForm.validateFields()

            const progress = Number(values.progressPercent)
            const status = values.status as Status
            const bottleneck = String(values.bottleneck || '').trim() || null
            const note = String(values.note || '').trim() || null

            const updatePayload: CoordinatorUpdate = {
                by: coordinatorDocId || user?.email || 'coordinator',
                byName: user?.name || user?.email || null,
                at: serverTimestamp() as any,
                status,
                progressPercent: progress,
                note,
                bottleneck
            }

            setSavingUpdate(true)
            try {
                await updateDoc(doc(db, 'tasks', selectedTask.id), {
                    status,
                    progressPercent: progress,
                    currentBottleneck: bottleneck,
                    lastUpdatedBy: coordinatorDocId || user?.email || 'coordinator',
                    updatedAt: serverTimestamp() as any,
                    coordinatorUpdates: arrayUnion(updatePayload)
                })

                message.success('Task updated')
                setUpdateOpen(false)
                setSelectedTask(null)
                updateForm.resetFields()
            } finally {
                setSavingUpdate(false)
            }
        } catch (e: any) {
            if (e?.errorFields) return
            console.error(e)
            message.error('Failed to update task')
        }
    }

    const activeUpdateSection = UPDATE_SECTIONS.find(section => section.key === updateReviewEditSection)
        || UPDATE_SECTIONS[updateStep]
    const updateUsesSend = activeUpdateSection.key !== 'status'

    const continueUpdateConversation = async () => {
        await updateForm.validateFields(activeUpdateSection.fields)
        if (updateReviewEditSection) {
            setUpdateReviewEditSection(null)
            setUpdateReview(true)
            return
        }
        if (updateStep === UPDATE_SECTIONS.length - 1) {
            setUpdateReview(true)
            return
        }
        setUpdateStep(step => step + 1)
    }

    const openUpdateReviewSection = (section: UpdateSection) => {
        const index = UPDATE_SECTIONS.findIndex(item => item.key === section)
        if (index < 0) return
        setUpdateStep(index)
        setUpdateReviewEditSection(section)
        setUpdateReview(false)
    }

    const updateReviewValue = (section: UpdateSection) => {
        const values = updateForm.getFieldsValue(true)
        if (section === 'status') return STATUS_META[safeStatus(values.status)].label
        if (section === 'progress') return `${Number(values.progressPercent || 0)}% complete`
        if (section === 'bottleneck') return String(values.bottleneck || '').trim() || 'No bottleneck'
        return String(values.note || '').trim() || 'No update note'
    }

    const renderUpdateSection = (section: UpdateSection) => {
        if (section === 'status') {
            return (
                <div>
                    <Form.Item name="status" hidden rules={[{ required: true, message: 'Select a status' }]}>
                        <Input />
                    </Form.Item>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                        {(Object.keys(STATUS_META) as Status[]).map(status => {
                            const selected = watchedUpdateStatus === status
                            return (
                                <div
                                    key={status}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => updateForm.setFieldValue('status', status)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault()
                                            updateForm.setFieldValue('status', status)
                                        }
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        minHeight: 66,
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
                                    {STATUS_META[status].label}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )
        }

        if (section === 'progress') {
            return (
                <Form.Item
                    name="progressPercent"
                    rules={[
                        { required: true, message: 'Enter progress' },
                        {
                            validator: (_, value) => {
                                const progress = Number(value)
                                return Number.isFinite(progress) && progress >= 0 && progress <= 100
                                    ? Promise.resolve()
                                    : Promise.reject(new Error('Use a value between 0 and 100'))
                            }
                        }
                    ]}
                >
                    <Input
                        type="number"
                        min={0}
                        max={100}
                        size="large"
                        autoFocus
                        placeholder="0–100"
                        onPressEnter={() => void continueUpdateConversation()}
                        suffix={
                            <Button
                                aria-label="Send progress"
                                size="small"
                                shape="round"
                                type="primary"
                                icon={<ArrowUpOutlined />}
                                onClick={() => void continueUpdateConversation()}
                                style={{ width: 30, height: 30, padding: 0 }}
                            />
                        }
                    />
                </Form.Item>
            )
        }

        const isBottleneck = section === 'bottleneck'
        return (
            <div style={{ position: 'relative' }}>
                <Form.Item name={section} style={{ marginBottom: 0 }}>
                    <TextArea
                        autoSize={{ minRows: 1, maxRows: 8 }}
                        placeholder={isBottleneck ? 'Describe the blocker, or leave this empty' : 'Share what changed on this task'}
                        autoFocus
                        onPressEnter={event => {
                            if (event.shiftKey) return
                            event.preventDefault()
                            void continueUpdateConversation()
                        }}
                        style={{ paddingRight: 48 }}
                    />
                </Form.Item>
                <Button
                    aria-label={isBottleneck ? 'Send bottleneck' : 'Send update note'}
                    size="small"
                    shape="round"
                    type="primary"
                    icon={<ArrowUpOutlined />}
                    onClick={() => void continueUpdateConversation()}
                    style={{ position: 'absolute', right: 6, top: 5, width: 30, height: 30, padding: 0 }}
                />
            </div>
        )
    }

    const columns: ColumnsType<TaskRow> = [
        {
            title: 'Task',
            dataIndex: 'title',
            render: (_value, row) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{row.title}</Text>
                    <Text
                        type="secondary"
                        ellipsis={{ tooltip: row.description || 'No description' }}
                        style={{ maxWidth: screens.md ? 420 : 220 }}
                    >
                        {row.description || 'No description'}
                    </Text>
                </Space>
            )
        },
        {
            title: 'Program',
            dataIndex: 'programId',
            responsive: ['lg'],
            render: (pid: string) => (
                <Tag icon={<ProjectOutlined />}>
                    {programs.find(p => p.id === pid)?.name || pid || '—'}
                </Tag>
            )
        },
        {
            title: 'Department',
            dataIndex: 'departmentId',
            responsive: ['lg'],
            render: (deptId: string) => (
                <Tag icon={<ApartmentOutlined />}>
                    {departments.find(d => d.id === deptId)?.name || deptId || '—'}
                </Tag>
            )
        },
        {
            title: 'Priority',
            dataIndex: 'priority',
            render: (p: Priority) => {
                const meta = PRIORITY_META[safePriority(p)]
                return <Tag color={meta.color}>{meta.label}</Tag>
            }
        },
        {
            title: 'Status',
            dataIndex: 'status',
            render: (s: Status) => {
                const meta = STATUS_META[safeStatus(s)]
                return <Badge status={meta.color as any} text={meta.label} />
            }
        },
        {
            title: 'Deadline',
            key: 'deadline',
            render: (_value, row) => {
                const due = asDate(row.dueAt)
                const meta = countdownMeta(due)

                return (
                    <Space direction="vertical" size={0}>
                        <Text>{due ? dayjs(due).format('DD MMM YYYY') : 'No deadline'}</Text>
                        <Tag color={meta.color} icon={<ClockCircleOutlined />}>
                            {meta.text}
                        </Tag>
                    </Space>
                )
            }
        },
        {
            title: 'Progress',
            key: 'progress',
            render: (_value, row) => {
                const progress = typeof row.progressPercent === 'number' ? row.progressPercent : 0
                return (
                    <div style={{ minWidth: 120 }}>
                        <Progress percent={progress} size="small" />
                    </div>
                )
            }
        },
        {
            title: 'Bottleneck',
            key: 'bottleneck',
            render: (_value, row) =>
                row.currentBottleneck ? (
                    <Text ellipsis={{ tooltip: row.currentBottleneck }} style={{ maxWidth: 220 }}>
                        {row.currentBottleneck}
                    </Text>
                ) : (
                    <Text type="secondary">None listed</Text>
                )
        },
        {
            title: 'Action',
            key: 'action',
            fixed: screens.lg ? 'right' : undefined,
            render: (_value, row) => (
                <Button icon={<EditOutlined />} size="small" onClick={() => openUpdate(row)}>
                    Update
                </Button>
            )
        }
    ]

    const statusChartOptions: Highcharts.Options = {
        chart: { type: 'pie', height: 320 },
        title: { text: 'Task Status Breakdown' },
        credits: { enabled: false },
        series: [{ type: 'pie', name: 'Tasks', data: statusSeries }]
    }

    const priorityChartOptions: Highcharts.Options = {
        chart: { type: 'column', height: 320 },
        title: { text: 'Priority Mix' },
        credits: { enabled: false },
        xAxis: { categories: prioritySeries.map(p => p.name) },
        yAxis: { title: { text: 'Tasks' }, allowDecimals: false },
        series: [{ type: 'column', name: 'Tasks', data: prioritySeries.map(p => p.y) }]
    }

    const deadlineChartOptions: Highcharts.Options = {
        chart: { type: 'bar', height: 320 },
        title: { text: 'Deadline Pressure' },
        credits: { enabled: false },
        xAxis: { categories: ['Overdue', 'Due Today', 'Due This Week', 'Later', 'No Deadline'] },
        yAxis: { title: { text: 'Tasks' }, allowDecimals: false },
        series: [{ type: 'bar', name: 'Tasks', data: deadlineSeries }]
    }

    return (
        <div style={{ minHeight: '100vh', padding: 24 }}>
            <Helmet>
                <title>My Tasks | Smart Incubator</title>
            </Helmet>

            {!activeProgramId ? (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="No active program selected"
                    description="Select a program to view your assigned tasks."
                />
            ) : null}

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} md={8}>
                    <MotionCard.Metric
                        icon={<UnorderedListOutlined style={{ color: '#1677ff' }} />}
                        iconBg="rgba(22,119,255,.12)"
                        title="Total Tasks"
                        value={totalTasks}
                        subtitle="Tasks assigned to you"
                    />
                </Col>

                <Col xs={24} md={8}>
                    <MotionCard.Metric
                        icon={<ExclamationCircleOutlined style={{ color: '#fa8c16' }} />}
                        iconBg="rgba(250,140,22,.14)"
                        title="Overdue"
                        value={overdueTasks}
                        subtitle="Past their deadline"
                    />
                </Col>

                <Col xs={24} md={8}>
                    <MotionCard.Metric
                        icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                        iconBg="rgba(82,196,26,.14)"
                        title="Completion Rate"
                        value={`${completionRate}%`}
                        subtitle="Completed out of visible tasks"
                    />
                </Col>
            </Row>

            <MotionCard
                filterBar={
                    <Row gutter={[12, 12]} align="middle">
                        <Col xs={24} md={12} lg={14}>
                            <Input
                                allowClear
                                value={q}
                                onChange={e => setQ(e.target.value)}
                                prefix={<SearchOutlined />}
                                placeholder="Search tasks or bottlenecks"
                            />
                        </Col>

                        <Col xs={24} md={7} lg={5}>
                            <Select
                                value={statusFilter}
                                onChange={v => setStatusFilter(v)}
                                style={{ width: '100%' }}
                                suffixIcon={<FilterOutlined />}
                                options={[
                                    { label: 'All Statuses', value: 'all' },
                                    { label: 'To Do', value: 'todo' },
                                    { label: 'In Progress', value: 'in_progress' },
                                    { label: 'Done', value: 'done' },
                                    { label: 'Cancelled', value: 'cancelled' }
                                ]}
                            />
                        </Col>

                        <Col xs={24} md={5} lg={5}>
                            <Button
                                type="primary"
                                icon={<BarChartOutlined />}
                                onClick={() => setAnalyticsOpen(true)}
                                block
                            >
                                Analytics
                            </Button>
                        </Col>
                    </Row>
                }
            >
                {filteredTasks.length ? (
                    <Table
                        rowKey="id"
                        loading={loading}
                        dataSource={filteredTasks}
                        columns={columns}
                        pagination={{ pageSize: 10, showSizeChanger: false }}
                        scroll={{ x: 1100 }}
                    />
                ) : (
                    <Empty description="No tasks found" />
                )}
            </MotionCard>

            <Modal
                open={updateOpen}
                title={selectedTask ? `Update Task: ${selectedTask.title}` : 'Update Task'}
                onCancel={() => {
                    setUpdateOpen(false)
                    setSelectedTask(null)
                    updateForm.resetFields()
                }}
                centered
                width={820}
                maskClosable={false}
                footer={
                    updateReview ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                            <Button
                                block
                                shape="round"
                                icon={<ArrowLeftOutlined />}
                                onClick={() => {
                                    setUpdateStep(UPDATE_SECTIONS.length - 1)
                                    setUpdateReview(false)
                                }}
                            >
                                Back
                            </Button>
                            <Button block shape="round" type="primary" loading={isSavingUpdate} onClick={submitUpdate}>
                                Save Update
                            </Button>
                        </div>
                    ) : updateUsesSend ? (
                        <Button
                            block
                            shape="round"
                            icon={<ArrowLeftOutlined />}
                            onClick={() => {
                                if (updateReviewEditSection) {
                                    setUpdateReviewEditSection(null)
                                    setUpdateReview(true)
                                } else {
                                    setUpdateStep(step => Math.max(0, step - 1))
                                }
                            }}
                        >
                            {updateReviewEditSection ? 'Back to Review' : 'Back'}
                        </Button>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                            <Button
                                block
                                shape="round"
                                icon={<ArrowLeftOutlined />}
                                onClick={() => {
                                    if (updateReviewEditSection) {
                                        setUpdateReviewEditSection(null)
                                        setUpdateReview(true)
                                    } else {
                                        setUpdateOpen(false)
                                        setSelectedTask(null)
                                        updateForm.resetFields()
                                    }
                                }}
                            >
                                {updateReviewEditSection ? 'Back to Review' : 'Back'}
                            </Button>
                            <Button block shape="round" type="primary" onClick={continueUpdateConversation}>
                                Continue
                            </Button>
                        </div>
                    )
                }
            >
                {updateReview ? (
                    <div style={{ width: '100%', maxWidth: 700, margin: '12px auto 20px' }}>
                        <Text type="secondary" style={{ display: 'block', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}>
                            Review
                        </Text>
                        <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 26px', minHeight: 32 }}>
                            <TypingPrompt text="Does this update look right?" />
                        </Text>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {UPDATE_SECTIONS.map(section => (
                                <div
                                    key={section.key}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => openUpdateReviewSection(section.key)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ') openUpdateReviewSection(section.key)
                                    }}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '120px minmax(0, 1fr) auto',
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
                                    <Text ellipsis={{ tooltip: updateReviewValue(section.key) }}>{updateReviewValue(section.key)}</Text>
                                    <EditOutlined style={{ color: token.colorPrimary }} />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div style={{ width: '100%', maxWidth: 680, minHeight: 340, margin: '0 auto', padding: '34px 0 18px' }}>
                        <Text type="secondary" style={{ display: 'block', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 12 }}>
                            {updateReviewEditSection ? `Editing ${activeUpdateSection.label}` : activeUpdateSection.label}
                        </Text>
                        <Text strong style={{ display: 'block', textAlign: 'center', fontSize: 24, margin: '8px 0 28px', minHeight: 32 }}>
                            <TypingPrompt text={activeUpdateSection.question} />
                        </Text>
                        <Form form={updateForm} layout="vertical" preserve>
                            {renderUpdateSection(activeUpdateSection.key)}
                        </Form>
                    </div>
                )}
            </Modal>

            <Modal
                open={analyticsOpen}
                title="Task Analytics"
                onCancel={() => setAnalyticsOpen(false)}
                footer={null}
                width={1100}
                centered
            >
                <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                        <MotionCard>
                            <HighchartsReact highcharts={Highcharts} options={statusChartOptions} />
                        </MotionCard>
                    </Col>
                    <Col xs={24} lg={12}>
                        <MotionCard>
                            <HighchartsReact highcharts={Highcharts} options={priorityChartOptions} />
                        </MotionCard>
                    </Col>
                    <Col xs={24}>
                        <MotionCard>
                            <HighchartsReact highcharts={Highcharts} options={deadlineChartOptions} />
                        </MotionCard>
                    </Col>
                </Row>
            </Modal>
        </div>
    )
}
