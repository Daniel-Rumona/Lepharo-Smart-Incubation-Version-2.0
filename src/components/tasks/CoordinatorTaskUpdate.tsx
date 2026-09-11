import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Space,
    Button,
    Table,
    Card,
    Tag,
    Modal,
    Form,
    Input,
    Segmented,
    Descriptions,
    Empty,
    message,
    Typography,
    Badge,
    Progress,
    Alert,
    Grid,
    theme,
    Slider
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    BarChartOutlined,
    EditOutlined,
    ProjectOutlined,
    FlagOutlined,
    CalendarOutlined,
    SearchOutlined,
    AppstoreOutlined,
    TableOutlined,
    ArrowLeftOutlined,
    ArrowUpOutlined,
    CloseOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import 'highcharts/modules/variable-pie'
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
type CoordinatorStatus = Exclude<Status, 'cancelled'>
type CoordinatorTaskFilter = 'all' | CoordinatorStatus | 'overdue'
type UpdateSection = 'note' | 'status' | 'blockers'

const COORDINATOR_STATUSES: CoordinatorStatus[] = ['todo', 'in_progress', 'done']

const UPDATE_SECTIONS: Array<{
    key: UpdateSection
    label: string
    question: string
    fields: string[]
}> = [
        { key: 'note', label: 'Work completed', question: 'What was done on this task?', fields: ['note', 'progressPercent'] },
        { key: 'status', label: 'Status', question: 'What is the task status now?', fields: ['status'] },
        { key: 'blockers', label: 'Blockers', question: 'Is anything blocking this task?', fields: [] }
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
    blockers?: string[]
}

type TaskDoc = {
    title: string
    description: string
    departmentId?: string
    programId?: string
    priority: Priority
    status: Status
    startAt?: Timestamp | null
    dueAt?: Timestamp | null
    completedAt?: Timestamp | null
    createdAt?: Timestamp
    updatedAt?: Timestamp
    createdBy?: string
    assignees?: Assignment[]
    progressPercent?: number
    coordinatorUpdates?: CoordinatorUpdate[]
    blockers?: string[]
    currentBottleneck?: string | null
    lastUpdatedBy?: string | null
    archived?: boolean
}

type TaskRow = TaskDoc & { id: string }
type Program = { id: string; name: string }

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

function countdownMeta(due: Date | null) {
    if (!due) return { text: 'No deadline', color: 'default' as const, overdue: false }

    const diff = due.getTime() - Date.now()
    const days = Math.max(1, Math.ceil(Math.abs(diff) / (24 * 60 * 60 * 1000)))
    const dayLabel = `${days} day${days === 1 ? '' : 's'}`

    if (diff < 0) {
        return {
            text: `Overdue by ${dayLabel}`,
            color: 'red' as const,
            overdue: true
        }
    }

    const day = 24 * 60 * 60 * 1000
    const color = diff < day ? 'red' : diff < day * 3 ? 'orange' : 'green'

    return {
        text: `Due in ${dayLabel}`,
        color: color as 'red' | 'orange' | 'green',
        overdue: false
    }
}

const isTaskOverdue = (task: TaskDoc) => {
    const due = asDate(task.dueAt)
    return Boolean(due && due.getTime() < Date.now() && safeStatus(task.status) !== 'done')
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

    const [q, setQ] = useState('')
    const [statusFilter, setStatusFilter] = useState<CoordinatorTaskFilter>('all')
    const [view, setView] = useState<'Board' | 'Table'>('Board')
    const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null)
    const [detailsTask, setDetailsTask] = useState<TaskRow | null>(null)
    const [analyticsOpen, setAnalyticsOpen] = useState(false)
    const [updateOpen, setUpdateOpen] = useState(false)
    const [updateForm] = Form.useForm()
    const [updateStep, setUpdateStep] = useState(0)
    const [updateReview, setUpdateReview] = useState(false)
    const [updateReviewEditSection, setUpdateReviewEditSection] = useState<UpdateSection | null>(null)
    const [isSavingUpdate, setSavingUpdate] = useState(false)
    const [hasBlockers, setHasBlockers] = useState<boolean | null>(null)
    const [blockerDraft, setBlockerDraft] = useState('')
    const [blockers, setBlockers] = useState<string[]>([])
    const watchedUpdateStatus = Form.useWatch('status', updateForm) as Status | undefined
    const watchedUpdateNote = Form.useWatch('note', updateForm) as string | undefined
    const watchedUpdateProgress = Form.useWatch('progressPercent', updateForm) as number | undefined

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

        return () => {
            unsubPrograms()
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
                const isActiveTask = safeStatus(task.status) !== 'cancelled' && task.archived !== true
                return {
                    id: task.id,
                    programId: task.programId || null,
                    assigneeIds,
                    identityMatch: isAssignedToCurrentUser,
                    programMatch: isInAccessibleProgram,
                    activeTask: isActiveTask,
                    visible: isAssignedToCurrentUser && isInAccessibleProgram && isActiveTask
                }
            })

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
    const searchedTasks = useMemo(() => {
        return tasks.filter(task => {
            const needle = q.toLowerCase().trim()
            return (
                !needle ||
                String(task.title || '').toLowerCase().includes(needle) ||
                String(task.description || '').toLowerCase().includes(needle) ||
                String(task.currentBottleneck || '').toLowerCase().includes(needle) ||
                (task.blockers || []).some(blocker => String(blocker).toLowerCase().includes(needle))
            )
        })
    }, [tasks, q])

    const statusCounts = useMemo(() => ({
        todo: searchedTasks.filter(task => safeStatus(task.status) === 'todo' && !isTaskOverdue(task)).length,
        in_progress: searchedTasks.filter(task => safeStatus(task.status) === 'in_progress' && !isTaskOverdue(task)).length,
        done: searchedTasks.filter(task => safeStatus(task.status) === 'done').length,
        overdue: searchedTasks.filter(isTaskOverdue).length
    }), [searchedTasks])

    const filteredTasks = useMemo(() => searchedTasks.filter(task => {
        if (statusFilter === 'all') return true
        if (statusFilter === 'overdue') return isTaskOverdue(task)
        return safeStatus(task.status) === statusFilter && !isTaskOverdue(task)
    }), [searchedTasks, statusFilter])

    const statusSeries = useMemo(() => {
        const counts: Record<CoordinatorStatus, number> = {
            todo: 0,
            in_progress: 0,
            done: 0
        }

        searchedTasks.forEach(t => {
            const status = safeStatus(t.status)
            if (status !== 'cancelled') counts[status] += 1
        })

        return [
            { name: 'To Do', y: counts.todo },
            { name: 'In Progress', y: counts.in_progress },
            { name: 'Done', y: counts.done }
        ]
    }, [searchedTasks])

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
        const existingBlockers = Array.isArray(task.blockers) && task.blockers.length
            ? task.blockers.map(String).filter(Boolean)
            : task.currentBottleneck
                ? [task.currentBottleneck]
                : []
        setSelectedTask(task)
        updateForm.setFieldsValue({
            status: safeStatus(task.status),
            progressPercent: typeof task.progressPercent === 'number' ? task.progressPercent : 0,
            note: ''
        })
        setBlockers(existingBlockers)
        setHasBlockers(existingBlockers.length ? true : null)
        setBlockerDraft('')
        setUpdateStep(0)
        setUpdateReview(false)
        setUpdateReviewEditSection(null)
        setSavingUpdate(false)
        setUpdateOpen(true)
    }

    const submitUpdate = async () => {
        if (!selectedTask || isSavingUpdate) return

        try {
            await updateForm.validateFields()
            const values = updateForm.getFieldsValue(true)

            const progress = Number(values.progressPercent)
            const note = String(values.note || '').trim() || null
            if (!note) {
                message.warning('Tell us what was done before saving.')
                return
            }
            if (!Number.isFinite(progress) || progress <= 0 || progress > 100) {
                message.warning('Progress must be between 1% and 100%.')
                return
            }
            if (hasBlockers === null || (hasBlockers && !blockers.length)) {
                message.warning(hasBlockers ? 'Add at least one blocker first.' : 'Confirm whether anything is blocking the task.')
                return
            }
            const status: Status = progress === 100 ? 'done' : 'in_progress'
            const currentBottleneck = blockers.length ? blockers.join(' • ') : null

            const updatePayload: CoordinatorUpdate = {
                by: coordinatorDocId || user?.email || 'coordinator',
                byName: user?.name || user?.email || null,
                // Firestore sentinels cannot be nested inside an arrayUnion value.
                at: Timestamp.now(),
                status,
                progressPercent: progress,
                note,
                blockers
            }

            setSavingUpdate(true)
            try {
                await updateDoc(doc(db, 'tasks', selectedTask.id), {
                    status,
                    progressPercent: progress,
                    completedAt: status === 'done' ? serverTimestamp() : null,
                    blockers,
                    currentBottleneck,
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
    const updateUsesSend = activeUpdateSection.key === 'note'

    const addBlocker = () => {
        const nextBlocker = blockerDraft.trim()
        if (!nextBlocker) return
        setBlockers(current => current.includes(nextBlocker) ? current : [...current, nextBlocker])
        setBlockerDraft('')
    }

    const continueUpdateConversation = async () => {
        if (activeUpdateSection.key === 'note') {
            await updateForm.validateFields(activeUpdateSection.fields)
            const progress = Number(updateForm.getFieldValue('progressPercent'))
            if (!Number.isFinite(progress) || progress <= 0 || progress > 100) {
                message.warning('Progress must be between 1% and 100%.')
                return
            }
            updateForm.setFieldValue('status', progress === 100 ? 'done' : 'in_progress')
        }
        if (activeUpdateSection.key === 'blockers') {
            if (hasBlockers === null) {
                message.warning('Choose Yes or No first.')
                return
            }
            if (hasBlockers && !blockers.length) {
                message.warning('Add at least one blocker first.')
                return
            }
        }
        if (activeUpdateSection.key !== 'note') {
            await updateForm.validateFields(activeUpdateSection.fields)
        }
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
        if (section === 'blockers') return blockers.length ? blockers.join(' · ') : 'No blockers'
        return `${String(values.note || '').trim() || 'No update note'} · ${Number(values.progressPercent || 0)}% complete`
    }

    const renderUpdateSection = (section: UpdateSection) => {
        if (section === 'status') {
            const storedProgress = Number(watchedUpdateProgress ?? updateForm.getFieldValue('progressPercent'))
            const progress = Number.isFinite(storedProgress)
                ? Math.min(100, Math.max(0, storedProgress))
                : 0
            const requiredStatus: CoordinatorStatus = progress === 100 ? 'done' : 'in_progress'
            return (
                <div>
                    <Form.Item name="status" hidden rules={[{ required: true, message: 'Select a status' }]}>
                        <Input />
                    </Form.Item>
                    <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 14 }}>
                        {progress}% progress sets this task to {STATUS_META[requiredStatus].label}.
                    </Text>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                        {COORDINATOR_STATUSES.map(status => {
                            const selected = watchedUpdateStatus === status
                            const disabled = status !== requiredStatus
                            return (
                                <div
                                    key={status}
                                    role="button"
                                    tabIndex={0}
                                    aria-disabled={disabled}
                                    onClick={() => {
                                        if (!disabled) updateForm.setFieldValue('status', status)
                                    }}
                                    onKeyDown={event => {
                                        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
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
                                        color: selected ? token.colorPrimary : disabled ? token.colorTextDisabled : token.colorText,
                                        cursor: disabled ? 'not-allowed' : 'pointer',
                                        fontWeight: selected ? 600 : 500,
                                        textAlign: 'center',
                                        opacity: disabled ? 0.48 : 1
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

        if (section === 'note') {
            return (
                <Space direction="vertical" size={24} style={{ width: '100%' }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-end',
                            gap: 8,
                            padding: 6,
                            border: `1px solid ${token.colorBorder}`,
                            borderRadius: 16,
                            background: token.colorBgContainer,
                            boxShadow: `0 0 0 1px ${token.colorPrimaryBg}`
                        }}
                    >
                        <Form.Item
                            name="note"
                            rules={[{ required: true, whitespace: true, message: 'Tell us what was done' }]}
                            style={{ flex: 1, marginBottom: 0 }}
                        >
                            <TextArea
                                bordered={false}
                                autoSize={{ minRows: 1, maxRows: 8 }}
                                placeholder="Share what changed on this task"
                                autoFocus
                                onPressEnter={event => {
                                    if (event.shiftKey) return
                                    event.preventDefault()
                                    void continueUpdateConversation()
                                }}
                                style={{ resize: 'none', padding: '7px 10px' }}
                            />
                        </Form.Item>
                        <Button
                            aria-label="Send update"
                            shape="round"
                            type="primary"
                            icon={<ArrowUpOutlined />}
                            onClick={() => void continueUpdateConversation()}
                            style={{ width: 36, height: 36, padding: 0, flexShrink: 0 }}
                        />
                    </div>

                    {String(watchedUpdateNote || '').trim() ? (
                        <Form.Item
                            name="progressPercent"
                            label="Progress"
                            rules={[
                                { required: true, message: 'Choose the progress percentage' },
                                {
                                    validator: (_, value) => Number(value) > 0
                                        ? Promise.resolve()
                                        : Promise.reject(new Error('Progress must be greater than 0%'))
                                }
                            ]}
                            style={{ marginBottom: 0 }}
                        >
                            <Slider
                                min={0}
                                max={100}
                                step={5}
                                marks={{ 0: '0%', 25: '25%', 50: '50%', 75: '75%', 100: '100%' }}
                                tooltip={{ formatter: value => `${value}%` }}
                                onChange={value => updateForm.setFieldValue('status', value === 100 ? 'done' : 'in_progress')}
                            />
                        </Form.Item>
                    ) : null}
                </Space>
            )
        }

        return (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    {[
                        { value: true, label: 'Yes' },
                        { value: false, label: 'No' }
                    ].map(option => {
                        const selected = hasBlockers === option.value
                        return (
                            <div
                                key={String(option.value)}
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                    setHasBlockers(option.value)
                                    if (!option.value) {
                                        setBlockers([])
                                        setBlockerDraft('')
                                    }
                                }}
                                onKeyDown={event => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return
                                    event.preventDefault()
                                    setHasBlockers(option.value)
                                    if (!option.value) {
                                        setBlockers([])
                                        setBlockerDraft('')
                                    }
                                }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    minHeight: 76,
                                    border: `2px solid ${selected ? token.colorPrimary : token.colorBorder}`,
                                    borderRadius: 14,
                                    background: selected ? token.colorPrimaryBg : token.colorFillAlter,
                                    color: selected ? token.colorPrimary : token.colorText,
                                    cursor: 'pointer',
                                    fontSize: 16,
                                    fontWeight: 600
                                }}
                            >
                                {option.label}
                            </div>
                        )
                    })}
                </div>

                {hasBlockers ? (
                    <>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: 6,
                                border: `1px solid ${token.colorBorder}`,
                                borderRadius: 16,
                                background: token.colorBgContainer
                            }}
                        >
                            <Input
                                bordered={false}
                                value={blockerDraft}
                                onChange={event => setBlockerDraft(event.target.value)}
                                onPressEnter={event => {
                                    event.preventDefault()
                                    addBlocker()
                                }}
                                placeholder="Add a blocker"
                                style={{ flex: 1 }}
                            />
                            <Button
                                aria-label="Add blocker"
                                shape="round"
                                type="primary"
                                icon={<ArrowUpOutlined />}
                                onClick={addBlocker}
                                style={{ width: 36, height: 36, padding: 0, flexShrink: 0 }}
                            />
                        </div>

                        {blockers.length ? (
                            <div style={{ display: 'grid', gap: 8 }}>
                                {blockers.map((blocker, index) => (
                                    <div
                                        key={`${blocker}-${index}`}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '36px minmax(0, 1fr) 28px',
                                            alignItems: 'center',
                                            gap: 10,
                                            padding: '10px 12px',
                                            border: `1px solid ${token.colorErrorBorder}`,
                                            borderRadius: 12,
                                            background: token.colorErrorBg
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: 34,
                                                height: 34,
                                                display: 'grid',
                                                placeItems: 'center',
                                                borderRadius: 10,
                                                color: token.colorError,
                                                background: token.colorErrorBgHover
                                            }}
                                        >
                                            <ExclamationCircleOutlined />
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <Text type="danger" strong style={{ display: 'block', fontSize: 12 }}>
                                                Blocker {index + 1}
                                            </Text>
                                            <Text style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{blocker}</Text>
                                        </div>
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`Remove blocker ${index + 1}`}
                                            onClick={() => setBlockers(current => current.filter((_, itemIndex) => itemIndex !== index))}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault()
                                                    setBlockers(current => current.filter((_, itemIndex) => itemIndex !== index))
                                                }
                                            }}
                                            style={{ color: token.colorTextSecondary, cursor: 'pointer', textAlign: 'center' }}
                                        >
                                            <CloseOutlined />
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </>
                ) : null}
            </Space>
        )
    }

    const taskBlockers = (task: TaskRow) => Array.isArray(task.blockers) && task.blockers.length
        ? task.blockers
        : task.currentBottleneck
            ? [task.currentBottleneck]
            : []

    const columns: ColumnsType<TaskRow> = [
        {
            title: 'Task',
            dataIndex: 'title',
            width: 220,
            render: (title: string) => <Text strong ellipsis={{ tooltip: title }}>{title}</Text>
        },
        ...(activeProgramId === 'all' ? [{
            title: 'Program',
            dataIndex: 'programId',
            width: 210,
            responsive: ['lg'],
            render: (pid: string) => (
                <Tag icon={<ProjectOutlined />}>
                    {programs.find(p => p.id === pid)?.name || pid || '—'}
                </Tag>
            )
        } as ColumnsType<TaskRow>[number]] : []),
        {
            title: 'Priority',
            dataIndex: 'priority',
            width: 100,
            render: (p: Priority) => {
                const meta = PRIORITY_META[safePriority(p)]
                return <Tag color={meta.color} icon={<FlagOutlined />}>{meta.label}</Tag>
            }
        },
        {
            title: 'Status & Progress',
            key: 'workflow',
            width: 190,
            render: (_value, row) => {
                const meta = isTaskOverdue(row)
                    ? { label: 'Overdue', color: 'error' }
                    : STATUS_META[safeStatus(row.status)]
                const progress = typeof row.progressPercent === 'number' ? row.progressPercent : 0
                return (
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Badge status={meta.color as any} text={meta.label} />
                        <Progress percent={progress} size="small" showInfo={false} />
                        <Text type="secondary" style={{ fontSize: 12 }}>{progress}% complete</Text>
                    </Space>
                )
            }
        },
        {
            title: 'Deadline',
            key: 'deadline',
            width: 170,
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
            title: 'Blockers',
            key: 'blockers',
            width: 110,
            render: (_value, row) => {
                const rowBlockers = taskBlockers(row)
                return rowBlockers.length ? (
                    <Tag color="error" icon={<ExclamationCircleOutlined />}>
                        {rowBlockers.length}
                    </Tag>
                ) : (
                    <Text type="secondary">0</Text>
                )
            }
        },
        {
            title: 'Action',
            key: 'action',
            fixed: screens.lg ? 'right' : undefined,
            render: (_value, row) => (
                <Button shape="round" icon={<EditOutlined />} size="small" onClick={event => {
                    event.stopPropagation()
                    openUpdate(row)
                }}>
                    Update
                </Button>
            )
        }
    ]

    const boardDefinitions: Array<{
        key: CoordinatorTaskFilter
        title: string
        color: string
        tasks: TaskRow[]
    }> = [
            { key: 'todo', title: 'To Do', color: token.colorTextSecondary, tasks: searchedTasks.filter(task => safeStatus(task.status) === 'todo' && !isTaskOverdue(task)) },
            { key: 'in_progress', title: 'In Progress', color: token.colorPrimary, tasks: searchedTasks.filter(task => safeStatus(task.status) === 'in_progress' && !isTaskOverdue(task)) },
            { key: 'done', title: 'Done', color: token.colorSuccess, tasks: searchedTasks.filter(task => safeStatus(task.status) === 'done') },
            { key: 'overdue', title: 'Overdue', color: token.colorError, tasks: searchedTasks.filter(isTaskOverdue) }
        ]

    const visibleBoardDefinitions = (statusFilter === 'all'
        ? boardDefinitions
        : boardDefinitions.filter(column => column.key === statusFilter))
        .filter(column => column.tasks.length > 0)

    const renderTaskCard = (task: TaskRow) => {
        const priority = PRIORITY_META[safePriority(task.priority)]
        const assigned = asDate(task.startAt) || asDate(task.createdAt)
        const due = asDate(task.dueAt)
        const deadline = countdownMeta(due)
        const rowBlockers = taskBlockers(task)
        const progress = typeof task.progressPercent === 'number' ? task.progressPercent : 0
        return (
            <MotionCard
                key={task.id}
                size="small"
                hoverable
                onClick={() => setDetailsTask(task)}
                style={{ cursor: 'pointer', boxShadow: 'none', height: '100%' }}
                styles={{ body: { padding: 14 } }}
            >
                <Space direction="vertical" size={9} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                        <Text strong style={{ fontSize: 15, lineHeight: 1.35 }}>{task.title}</Text>
                        <Tag color={priority.color} icon={<FlagOutlined />} style={{ marginInlineEnd: 0, flexShrink: 0 }}>{priority.label}</Tag>
                    </div>
                    {activeProgramId === 'all' ? (
                        <Text type="secondary" ellipsis={{ tooltip: programs.find(program => program.id === task.programId)?.name }}>
                            <ProjectOutlined /> {programs.find(program => program.id === task.programId)?.name || task.programId || 'No program'}
                        </Text>
                    ) : null}
                    <Space size={[12, 4]} wrap>
                        <Text type="secondary"><CalendarOutlined /> Assigned {assigned ? dayjs(assigned).format('DD MMM') : '—'}</Text>
                        <Text type="secondary"><CalendarOutlined /> Due {due ? dayjs(due).format('DD MMM') : '—'}</Text>
                    </Space>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <Tag color={deadline.color} icon={<ClockCircleOutlined />} style={{ marginInlineEnd: 0 }}>{deadline.text}</Tag>
                        {rowBlockers.length ? <Tag color="error" style={{ marginInlineEnd: 0 }}>{rowBlockers.length} blocker{rowBlockers.length === 1 ? '' : 's'}</Tag> : null}
                    </div>
                    <Progress percent={progress} size="small" />
                </Space>
            </MotionCard>
        )
    }

    const renderBoard = () => {
        if (!visibleBoardDefinitions.length) return <Empty description="No tasks found" />
        if (statusFilter !== 'all') {
            return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                    {visibleBoardDefinitions[0].tasks.map(renderTaskCard)}
                </div>
            )
        }
        return (
            <Row gutter={[14, 14]}>
                {visibleBoardDefinitions.map(column => (
                    <Col key={column.key} xs={24} md={visibleBoardDefinitions.length === 1 ? 24 : 12} xl={24 / Math.min(visibleBoardDefinitions.length, 4)}>
                        <Card
                            size="small"
                            title={<Space><span style={{ color: column.color }}>{column.title}</span><Badge count={column.tasks.length} showZero /></Space>}
                            style={{ height: '100%', background: token.colorFillQuaternary, boxShadow: 'none' }}
                            styles={{ body: { padding: 10 } }}
                        >
                            <div style={{ display: 'grid', gridTemplateColumns: statusFilter === 'all' ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                                {column.tasks.map(renderTaskCard)}
                            </div>
                        </Card>
                    </Col>
                ))}
            </Row>
        )
    }

    const statusChartOptions: Highcharts.Options = {
        chart: { type: 'pie', height: 320, backgroundColor: 'transparent' },
        title: { text: 'Task Status Breakdown', style: { color: token.colorText } },
        credits: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b> task(s)' },
        plotOptions: {
            pie: {
                dataLabels: {
                    enabled: true,
                    format: '{point.name}: {point.y}',
                    style: { color: token.colorText, textOutline: 'none' }
                }
            }
        },
        series: [{
            type: 'pie',
            name: 'Tasks',
            data: statusSeries.filter(point => point.y > 0)
        }]
    }

    const priorityChartOptions: Highcharts.Options = {
        chart: { type: 'variablepie', height: 320, backgroundColor: 'transparent' },
        title: { text: 'Priority Mix', style: { color: token.colorText } },
        credits: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b> task(s)' },
        plotOptions: {
            variablepie: {
                innerSize: '46%',
                minPointSize: 34,
                zMin: 1,
                dataLabels: {
                    enabled: true,
                    format: '{point.name}: {point.y}',
                    style: { color: token.colorText, textOutline: 'none' }
                }
            }
        },
        series: [{
            type: 'variablepie',
            name: 'Tasks',
            data: prioritySeries
                .map((point, index) => ({
                    name: point.name,
                    y: point.y,
                    z: index + 1,
                    color: [token.colorTextSecondary, token.colorPrimary, token.colorWarning, token.colorError][index]
                }))
                .filter(point => point.y > 0)
        }]
    }

    const deadlineChartOptions: Highcharts.Options = {
        chart: { type: 'column', height: 320, backgroundColor: 'transparent' },
        title: { text: 'Deadline Pressure', style: { color: token.colorText } },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: {
            type: 'category',
            labels: { style: { color: token.colorTextSecondary } },
            lineColor: token.colorBorderSecondary,
            tickColor: token.colorBorderSecondary
        },
        yAxis: {
            min: 0,
            allowDecimals: false,
            title: { text: 'Tasks', style: { color: token.colorTextSecondary } },
            labels: { style: { color: token.colorTextSecondary } },
            gridLineColor: token.colorBorderSecondary
        },
        tooltip: { pointFormat: '<b>{point.y}</b> task(s)' },
        plotOptions: {
            column: {
                borderRadius: 6,
                dataLabels: {
                    enabled: true,
                    formatter: function () { return Number(this.y) > 0 ? this.y : null },
                    style: { color: token.colorText, textOutline: 'none' }
                }
            }
        },
        series: [{
            type: 'column',
            name: 'Tasks',
            data: [
                { name: 'Overdue', y: deadlineSeries[0], color: token.colorError },
                { name: 'Due Today', y: deadlineSeries[1], color: '#fa541c' },
                { name: 'Due This Week', y: deadlineSeries[2], color: token.colorWarning },
                { name: 'Later', y: deadlineSeries[3], color: token.colorSuccess },
                { name: 'No Deadline', y: deadlineSeries[4], color: token.colorTextSecondary }
            ]
        }]
    }

    const visibleTaskTotal = searchedTasks.length
    const completionRate = visibleTaskTotal
        ? Math.round((statusCounts.done / visibleTaskTotal) * 100)
        : 0

    const metricDefinitions: Array<{
        key: string
        filter?: CoordinatorTaskFilter
        title: string
        count: number
        value: React.ReactNode
        alwaysVisible?: boolean
        subtitle: string
        icon: React.ReactNode
        iconBg: string
    }> = [
            { key: 'total', filter: 'all', title: 'Total Tasks', count: visibleTaskTotal, value: visibleTaskTotal, alwaysVisible: true, subtitle: 'Click to show all', icon: <AppstoreOutlined style={{ color: token.colorPrimary }} />, iconBg: token.colorPrimaryBg },
            { key: 'todo', filter: 'todo', title: 'To Do', count: statusCounts.todo, value: statusCounts.todo, subtitle: 'Click to filter', icon: <ClockCircleOutlined style={{ color: token.colorTextSecondary }} />, iconBg: token.colorFillSecondary },
            { key: 'in_progress', filter: 'in_progress', title: 'In Progress', count: statusCounts.in_progress, value: statusCounts.in_progress, alwaysVisible: true, subtitle: 'Click to filter', icon: <ClockCircleOutlined style={{ color: token.colorPrimary }} />, iconBg: token.colorPrimaryBg },
            { key: 'done', filter: 'done', title: 'Done', count: statusCounts.done, value: statusCounts.done, subtitle: 'Click to filter', icon: <CheckCircleOutlined style={{ color: token.colorSuccess }} />, iconBg: token.colorSuccessBg },
            { key: 'completion', title: 'Completion Rate', count: statusCounts.done, value: `${completionRate}%`, alwaysVisible: true, subtitle: 'Across visible tasks', icon: <CheckCircleOutlined style={{ color: token.colorSuccess }} />, iconBg: token.colorSuccessBg },
            { key: 'overdue', filter: 'overdue', title: 'Overdue', count: statusCounts.overdue, value: statusCounts.overdue, subtitle: 'Click to filter', icon: <ExclamationCircleOutlined style={{ color: token.colorError }} />, iconBg: token.colorErrorBg }
        ]

    return (
        <div style={{ padding: '8px 24px' }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
                {metricDefinitions.filter(metric => metric.alwaysVisible || metric.count > 0).map(metric => (
                    <MotionCard.Metric
                        key={metric.key}
                        icon={metric.icon}
                        iconBg={metric.iconBg}
                        title={metric.title}
                        value={metric.value}
                        subtitle={metric.subtitle}
                        onClick={metric.filter ? () => setStatusFilter(current => current === metric.filter ? 'all' : metric.filter!) : undefined}
                        wrapperStyle={metric.filter && statusFilter === metric.filter ? {
                            borderColor: token.colorPrimary,
                            boxShadow: `0 0 0 2px ${token.colorPrimaryBg}`
                        } : undefined}
                    />
                ))}
            </div>

            <MotionCard
                filterBar={
                    <Row gutter={[12, 12]} align="middle">
                        <Col flex="none">
                            <Segmented
                                value={view}
                                onChange={value => setView(value as 'Board' | 'Table')}
                                options={[
                                    { value: 'Board', label: <Space size={6}><AppstoreOutlined />Board</Space> },
                                    { value: 'Table', label: <Space size={6}><TableOutlined />Table</Space> }
                                ]}
                            />
                        </Col>
                        <Col flex="1 1 280px">
                            <Input
                                allowClear
                                value={q}
                                onChange={e => setQ(e.target.value)}
                                prefix={<SearchOutlined />}
                                placeholder="Search tasks or bottlenecks"
                                size="middle"
                            />
                        </Col>
                        <Col flex="0 0 150px">
                            <Button
                                type="primary"
                                shape="round"
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
                {view === 'Board' ? renderBoard() : filteredTasks.length ? (
                    <Table
                        rowKey="id"
                        loading={loading}
                        dataSource={filteredTasks}
                        columns={columns}
                        pagination={{ pageSize: 10, showSizeChanger: false, position: ['bottomCenter'] }}
                        scroll={{ x: 850 }}
                        onRow={row => ({
                            onClick: () => setDetailsTask(row),
                            style: { cursor: 'pointer' }
                        })}
                    />
                ) : (
                    <Empty description="No tasks found" />
                )}
            </MotionCard>

            <Modal
                open={Boolean(detailsTask)}
                title="Task Details"
                onCancel={() => setDetailsTask(null)}
                centered
                width={720}
                footer={detailsTask ? (
                    <Button
                        block
                        shape="round"
                        type="primary"
                        icon={<EditOutlined />}
                        onClick={() => {
                            const task = detailsTask
                            setDetailsTask(null)
                            openUpdate(task)
                        }}
                    >
                        Update Task
                    </Button>
                ) : null}
            >
                {detailsTask ? (
                    <Space direction="vertical" size={18} style={{ width: '100%' }}>
                        <div>
                            <Text strong style={{ display: 'block', fontSize: 20 }}>{detailsTask.title}</Text>
                            <Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>{detailsTask.description || 'No description provided.'}</Text>
                        </div>
                        <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                            <Descriptions.Item label="Status">
                                <Badge
                                    status={(isTaskOverdue(detailsTask) ? 'error' : STATUS_META[safeStatus(detailsTask.status)].color) as any}
                                    text={isTaskOverdue(detailsTask) ? 'Overdue' : STATUS_META[safeStatus(detailsTask.status)].label}
                                />
                            </Descriptions.Item>
                            <Descriptions.Item label="Progress">
                                {typeof detailsTask.progressPercent === 'number' ? detailsTask.progressPercent : 0}%
                            </Descriptions.Item>
                            <Descriptions.Item label="Priority">
                                <Tag color={PRIORITY_META[safePriority(detailsTask.priority)].color} icon={<FlagOutlined />}>{PRIORITY_META[safePriority(detailsTask.priority)].label}</Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Deadline">
                                {asDate(detailsTask.dueAt) ? dayjs(asDate(detailsTask.dueAt)).format('DD MMM YYYY') : 'No deadline'}
                            </Descriptions.Item>
                            {activeProgramId === 'all' ? (
                                <Descriptions.Item label="Program" span={2}>
                                    {programs.find(program => program.id === detailsTask.programId)?.name || detailsTask.programId || 'No program'}
                                </Descriptions.Item>
                            ) : null}
                        </Descriptions>
                        {taskBlockers(detailsTask).length ? (
                            <div>
                                <Text strong style={{ display: 'block', marginBottom: 8 }}>Blockers</Text>
                                <div style={{ display: 'grid', gap: 8 }}>
                                    {taskBlockers(detailsTask).map((blocker, index) => (
                                        <Alert key={`${blocker}-${index}`} type="error" showIcon message={`Blocker ${index + 1}`} description={blocker} />
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </Space>
                ) : null}
            </Modal>

            <Modal
                open={updateOpen}
                title={selectedTask ? (
                    <Space size={8} wrap>
                        <span>Update Task: {selectedTask.title}</span>
                        <Tag color={PRIORITY_META[safePriority(selectedTask.priority)].color} icon={<FlagOutlined />}>
                            {PRIORITY_META[safePriority(selectedTask.priority)].label}
                        </Tag>
                    </Space>
                ) : 'Update Task'}
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
                    ) : updateUsesSend && !updateReviewEditSection && updateStep === 0 ? null : updateUsesSend ? (
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
                                    } else if (updateStep > 0) {
                                        setUpdateStep(step => step - 1)
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
