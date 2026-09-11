import React, { useEffect, useMemo, useState } from 'react'
import {
    Layout,
    Card,
    Row,
    Col,
    Typography,
    Button,
    Space,
    Modal,
    Form,
    Input,
    Select,
    DatePicker,
    Tag,
    Progress,
    message,
    Table,
    Empty,
    Radio,
    Tooltip,
    Slider,
    Upload,
    Timeline
} from 'antd'
import {
    CalendarOutlined,
    PlusOutlined,
    FlagOutlined,
    ClockCircleOutlined,
    FileOutlined,
    UserOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
dayjs.extend(isBetween)

import { Helmet } from 'react-helmet'
import { motion } from 'framer-motion'

import { db } from '@/firebase'
import {
    collection,
    getDocs,
    query,
    where,
    setDoc,
    doc,
    Timestamp,
    updateDoc,
    onSnapshot,
    orderBy
} from 'firebase/firestore'

import { useFullIdentity } from '@/hooks/src/useFullIdentity'

import QuickAppointmentModal from '@/components/modals/QuickAppointmentModal'
import { GlobalEventModal } from '@/components/modals/Events'
import UpcomingEventsCard from '@/components/modals/UpcomingEventsCard'
import EventDetailsModal from '@/components/modals/EventDetails'
import EventsCalendarModal from '@/components/modals/EventsCalender'
import { ref, uploadBytes, getDownloadURL, getStorage } from 'firebase/storage'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'

const { Title, Text } = Typography
const storage = getStorage()
/* ----------------------------- Types ----------------------------- */
type Teammate = { id: string; name: string; email?: string }
type Task = {
    id: string
    title: string
    description?: string
    assigneeId?: string
    assigneeName?: string
    priority?: 'low' | 'normal' | 'high'
    status?: 'todo' | 'in_progress' | 'done' | 'cancelled'
    progress?: number
    progressNotes?: string
    proofLink?: string
    proofValidated?: boolean
    dueDate?: any // Firestore Timestamp | ISO
    departmentId: string

    createdAt: any
    cancelledAt?: any
    cancelledBy?: any
    updatedAt?: any
    updatedBy?: string
}
type EventItem = {
    id: string
    title: string
    date?: string
    time?: any
    start?: any
    end?: any
    departmentId?: string
    department?: string
    createdAt?: any
}
type Appointment = {
    id: string
    title: string
    start: any
    end: any
    location?: string
}

/* ----------------------- Status / Priority UI -------------------- */
const STATUS_COLORS: Record<string, string> = {
    todo: '#d9d9d9',
    in_progress: '#faad14',
    done: '#52c41a'
}
const PRIORITY_COLORS: Record<string, 'default' | 'green' | 'blue' | 'red'> = {
    low: 'blue',
    normal: 'green',
    high: 'red'
}

/* ----------------------------- styles ---------------------------- */
const cardChrome: React.CSSProperties = {
    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
    transition: 'all 0.3s ease',
    borderRadius: 12,
    border: '1px solid #d6e4ff'
}

/* ----------------------------- Page ------------------------------ */
const DepartmentWorkroom: React.FC = () => {
    const { user } = useFullIdentity()
    const departmentId = user?.departmentId || ''
    const userId = user?.id

    /* ---------------------------- State ---------------------------- */
    const [deptName, setDeptName] = useState<string>('Unspecified')
    const [people, setPeople] = useState<Teammate[]>([])

    // Tasks
    const [tasks, setTasks] = useState<Task[]>([])
    const [taskModalOpen, setTaskModalOpen] = useState(false)
    const [taskForm] = Form.useForm()

    // Filters
    const [taskFilter, setTaskFilter] = useState<
        'all' | 'today' | 'week' | 'month' | 'custom'
    >('all')
    const [taskRange, setTaskRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(
        null
    )
    const [statusFilter, setStatusFilter] = useState<
        Array<'todo' | 'in_progress' | 'done'>
    >([])
    const [assigneeFilter, setAssigneeFilter] = useState<
        'all' | 'me' | 'unassigned' | string
    >('all')

    // Update modal (assignee-only)
    const [updateOpen, setUpdateOpen] = useState(false)
    const [selectedTask, setSelectedTask] = useState<Task | null>(null)
    const [updateForm] = Form.useForm()

    // Events / Calendar / Appointments
    const [events, setEvents] = useState<EventItem[]>([])
    const [calendarVisible, setCalendarVisible] = useState(false)
    const [apptOpen, setApptOpen] = useState(false)

    const [eventModalOpen, setEventModalOpen] = useState(false)
    const [eventForm] = Form.useForm()
    const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null)
    const [detailsModalVisible, setDetailsModalVisible] = useState(false)

    const [appts, setAppts] = useState<Appointment[]>([])
    const [history, setHistory] = useState<any[]>([])
    const isAdmin = user?.role === 'operations' || user?.role === 'projectadmin'

    useEffect(() => {
        if (!selectedTask?.id) return

        const q = query(
            collection(db, 'tasks', selectedTask.id, 'progressUpdates'),
            orderBy('createdAt', 'desc')
        )

        const unsubscribe = onSnapshot(q, snap => {
            const rows = snap.docs.map(d => d.data())
            setHistory(rows)
        })

        return () => unsubscribe()
    }, [selectedTask?.id])

    /* ------------------------- Load metadata ------------------------ */
    useEffect(() => {
        if (!departmentId) return
            ; (async () => {
                // department name
                const depSnap = await getDocs(
                    query(
                        collection(db, 'departments')
                    )
                )
                const match = depSnap.docs.find(d => d.id === departmentId)
                const d = match?.data() as any
                setDeptName(d?.name || d?.departmentName || 'Unspecified')

                // teammates from same department
                const userSnap = await getDocs(
                    query(
                        collection(db, 'users'),
                        where('departmentId', '==', departmentId)
                    )
                )
                setPeople(
                    userSnap.docs.map(docu => {
                        const u: any = docu.data()
                        return {
                            id: docu.id,
                            name: u.name || u.displayName || u.email || 'Unnamed',
                            email: u.email
                        }
                    })
                )
            })()
    }, [departmentId])

    /* ---------------------------- Tasks ---------------------------- */
    useEffect(() => {
        if (!departmentId) return
        const qy = query(
            collection(db, 'tasks'),
            where('departmentId', '==', departmentId)
        )
        const off = onSnapshot(qy, snap => {
            const rows = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            })) as Task[]
            setTasks(rows)
        })
        return () => off()
    }, [departmentId])

    // date window first
    const tasksAfterDate = useMemo(() => {
        if (!tasks.length) return []

        let from: dayjs.Dayjs, to: dayjs.Dayjs

        switch (taskFilter) {
            case 'today':
                from = dayjs().startOf('day')
                to = dayjs().endOf('day')
                break
            case 'week':
                from = dayjs().startOf('week')
                to = dayjs().endOf('week')
                break
            case 'month':
                from = dayjs().startOf('month')
                to = dayjs().endOf('month')
                break
            case 'custom':
                if (!taskRange || !taskRange[0] || !taskRange[1]) {
                    return tasks // ✅ fallback instead of []
                }
                from = taskRange[0].startOf('day')
                to = taskRange[1].endOf('day')
                break
            case 'all':
            default:
                return tasks
        }

        return tasks.filter(t => {
            const dd = t.dueDate?.toDate
                ? dayjs(t.dueDate.toDate())
                : t.dueDate
                    ? dayjs(t.dueDate)
                    : null
            return dd ? dd.isBetween(from, to, 'day', '[]') : false
        })
    }, [tasks, taskFilter, taskRange])

    // then status
    const tasksAfterStatus = useMemo(() => {
        if (!statusFilter.length) return tasksAfterDate
        return tasksAfterDate.filter(t =>
            statusFilter.includes((t.status || 'todo') as any)
        )
    }, [tasksAfterDate, statusFilter])

    // then assignee
    const filteredTasks = useMemo(() => {
        if (assigneeFilter === 'all') return tasksAfterStatus
        if (assigneeFilter === 'me')
            return tasksAfterStatus.filter(t => t.assigneeId === userId)
        if (assigneeFilter === 'unassigned')
            return tasksAfterStatus.filter(
                t => !t.assigneeId || t.assigneeId === '' || t.assigneeId === null
            )
        return tasksAfterStatus.filter(t => t.assigneeId === assigneeFilter)
    }, [tasksAfterStatus, assigneeFilter, userId])

    const canEditTask = (t: Task) =>
        !!userId && (t.assigneeId === userId || isAdmin)

    const canAdminReviewTask = (t: Task) =>
        !!userId &&
        (user?.role === 'operations' || user?.role === 'projectadmin') &&
        ['consultant', 'projectmanager'].includes(user?.role || '')

    const openUpdateModal = (t: Task) => {
        if (!canEditTask(t)) {
            message.info('Only the assignee can update this task.')
            return
        }
        setSelectedTask(t)
        updateForm.setFieldsValue({
            progress: t.progress ?? (t.status === 'done' ? 100 : 0),
            status: t.status || 'todo',
            progressNotes: t.progressNotes || '',
            proofLink: t.proofLink || ''
        })

        setUpdateOpen(true)
    }

    const taskColumns = [
        {
            title: 'Task',
            key: 'title',
            render: (_: any, r: Task) => (
                <div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap'
                        }}
                    >
                        <div
                            style={{
                                maxWidth: 220, // Adjust as needed
                                wordBreak: 'break-word',
                                overflowWrap: 'anywhere',
                                whiteSpace: 'normal'
                            }}
                        >
                            <Text strong>{r.title}</Text>
                        </div>
                        {r.priority && (
                            <Tag color={PRIORITY_COLORS[r.priority] || 'default'}>
                                {r.priority}
                            </Tag>
                        )}
                    </div>
                    {r.description && (
                        <Text type='secondary' style={{ display: 'block' }}>
                            {r.description}
                        </Text>
                    )}
                </div>
            )
        },
        {
            title: 'Assignee',
            dataIndex: 'assigneeName',
            key: 'assigneeName',
            width: 180,
            render: (v: string) => v || <Text type='secondary'>Unassigned</Text>
        },
        {
            title: 'Status',
            key: 'status',
            render: (_: any, r: Task) => {
                const status = r.status || 'todo'

                if (status === 'cancelled') {
                    const date = r.cancelledAt?.toDate
                        ? dayjs(r.cancelledAt.toDate()).format('YYYY-MM-DD')
                        : null
                    const by =
                        people.find(p => p.id === r.cancelledBy)?.name ||
                        r.cancelledBy ||
                        'Unknown'

                    return (
                        <div>
                            <Tooltip title={`Cancelled by ${by}${date ? ` on ${date}` : ''}`}>
                                <Tag color='red'>Cancelled</Tag>
                            </Tooltip>

                            {r.proofValidated !== undefined && (
                                <Tag color={r.proofValidated ? 'green' : 'orange'}>
                                    {r.proofValidated ? 'Validated' : 'Pending Review'}
                                </Tag>
                            )}
                        </div>
                    )
                }

                const s = status as NonNullable<Task['status']>
                const color = STATUS_COLORS[s] || '#999'
                const label = s.replace(/_/g, ' ')

                return (
                    <div>
                        <span
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                        >
                            <span
                                style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: '50%',
                                    background: color,
                                    display: 'inline-block'
                                }}
                            />
                            <Text style={{ textTransform: 'capitalize' }}>{label}</Text>
                        </span>

                        {s === 'done' && (
                            <Tag
                                color={
                                    r.proofValidated === true
                                        ? 'green'
                                        : r.proofValidated === false
                                            ? 'red'
                                            : 'orange'
                                }
                            >
                                {r.proofValidated === true
                                    ? 'Validated'
                                    : r.proofValidated === false
                                        ? 'Invalidated'
                                        : 'Pending Review'}
                            </Tag>
                        )}
                    </div>
                )
            }
        },
        {
            title: 'Progress',
            key: 'progress',
            width: 160,
            render: (_: any, r: Task) => {
                const percent = r.progress ?? (r.status === 'done' ? 100 : 0)
                return (
                    <div style={{ width: 120 }}>
                        <Progress percent={percent} size='small' />
                    </div>
                )
            }
        },
        {
            title: 'Due Date',
            key: 'dueDate',
            width: 140,
            render: (_: any, r: Task) => {
                const dd = r.dueDate?.toDate
                    ? dayjs(r.dueDate.toDate())
                    : r.dueDate
                        ? dayjs(r.dueDate)
                        : null
                return dd ? dd.format('YYYY-MM-DD') : <Text type='secondary'>—</Text>
            }
        },
        {
            // NEW: Actions column to update progress (assignee-only)
            title: 'Actions',
            key: 'actions',
            width: 130,
            render: (_: any, r: Task) => {
                const isDone = r.status === 'done'
                const editable = canEditTask(r)
                return (
                    <Space>
                        {editable && !isDone && (
                            <Tooltip title='Update progress'>
                                <Button size='small' onClick={() => openUpdateModal(r)}>
                                    Update
                                </Button>
                            </Tooltip>
                        )}
                    </Space>
                )
            }
        }
    ]

    /* --------------------- Upcoming week events --------------------- */
    useEffect(() => {
        if (!departmentId) return
            ; (async () => {
                const evSnap = await getDocs(
                    query(
                        collection(db, 'events'),
                        where('departmentId', '==', departmentId)
                    )
                )
                const rows: EventItem[] = evSnap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))
                const now = dayjs()
                const to = now.add(7, 'day')
                const list = rows
                    .filter(e => {
                        const dt = e.time?.toDate
                            ? dayjs(e.time.toDate())
                            : e.time
                                ? dayjs(e.time)
                                : e.date
                                    ? dayjs(e.date)
                                    : null
                        return (
                            dt?.isValid() &&
                            dt.isBetween(now.startOf('day'), to.endOf('day'), 'day', '[]')
                        )
                    })
                    .sort((a, b) => {
                        const da = a.time?.toDate
                            ? dayjs(a.time.toDate())
                            : a.time
                                ? dayjs(a.time)
                                : dayjs(a.date)
                        const dbx = b.time?.toDate
                            ? dayjs(b.time.toDate())
                            : b.time
                                ? dayjs(b.time)
                                : dayjs(b.date)
                        return (da?.valueOf?.() || 0) - (dbx?.valueOf?.() || 0)
                    })
                    .slice(0, 8)
                setEvents(list)
            })()
    }, [departmentId])

    /* ------------------- Appointments (next 7 days) ----------------- */
    useEffect(() => {
        if (!departmentId) return
            ; (async () => {
                const snap = await getDocs(query(collection(db, 'appointments'), where('departmentId', '==', departmentId)))
                const rows = (await hydrateAppointmentViews(
                    snap.docs.map(d => ({ id: d.id, data: d.data() as any }))
                )).map(row => ({
                    id: row.id, title: row.sessionTitle || row.interventionTitle,
                    start: row.startTime, end: row.endTime, location: row.location || ''
                })) as Appointment[]
                const now = dayjs()
                const to = now.add(7, 'day')
                const list = rows
                    .filter(a => {
                        const s = a.start?.toDate ? dayjs(a.start.toDate()) : dayjs(a.start)
                        const e = a.end?.toDate
                            ? dayjs(a.end.toDate())
                            : dayjs(a.end || a.start)
                        return (
                            s?.isValid() &&
                            e?.isValid() &&
                            s.isBefore(to.endOf('day')) &&
                            e.isAfter(now.startOf('day'))
                        )
                    })
                    .sort((a, b) => {
                        const sa = a.start?.toDate ? dayjs(a.start.toDate()) : dayjs(a.start)
                        const sb = b.start?.toDate ? dayjs(b.start.toDate()) : dayjs(b.start)
                        return (sa?.valueOf?.() || 0) - (sb?.valueOf?.() || 0)
                    })
                    .slice(0, 8)
                setAppts(list)
            })()
    }, [departmentId])

    /* -------------------- Clash check for events -------------------- */
    const checkEventClashes = async (dateStr?: string, timeVal?: any) => {
        if (!dateStr || !timeVal) return []
        const when = dayjs(timeVal?.toDate ? timeVal.toDate() : timeVal)
        if (!when.isValid()) return []

        const [evSnap, apSnap] = await Promise.all([
            getDocs(
                query(
                    collection(db, 'events'),
                    where('departmentId', '==', departmentId),
                    where('date', '==', dateStr)
                )
            ),
            getDocs(
                query(collection(db, 'appointments'), where('departmentId', '==', departmentId))
            )
        ])

        const evs = evSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
        const aps = (await hydrateAppointmentViews(
            apSnap.docs.map(d => ({ id: d.id, data: d.data() as any }))
        )).map(row => ({ id: row.id, title: row.sessionTitle || row.interventionTitle, start: row.startTime, end: row.endTime }))

        const conflicts: string[] = []

        // same-minute events are a clash
        evs.forEach(e => {
            const t = e.time?.toDate
                ? dayjs(e.time.toDate())
                : e.time
                    ? dayjs(e.time)
                    : null
            if (t && t.isSame(when, 'minute')) conflicts.push(e.title || 'Event')
        })

        // appointment overlap
        aps.forEach(a => {
            const s = a.start?.toDate ? dayjs(a.start.toDate()) : dayjs(a.start)
            const e = a.end?.toDate ? dayjs(a.end.toDate()) : dayjs(a.end || a.start)
            if (
                s?.isValid() &&
                e?.isValid() &&
                when.isBetween(s, e, 'minute', '[]')
            ) {
                conflicts.push(a.title || 'Appointment')
            }
        })

        return conflicts
    }

    /* --------------------------- UI blocks -------------------------- */
    const TaskCreateModal = (
        <Modal
            title='Create Task'
            open={taskModalOpen}
            onCancel={() => setTaskModalOpen(false)}
            onOk={async () => {
                try {
                    const vals = await taskForm.validateFields()
                    const id = `task-${Date.now()}`
                    await setDoc(doc(db, 'tasks', id), {
                        id,
                        title: vals.title,
                        description: vals.description || '',
                        assigneeId: vals.assigneeId,
                        assigneeName: people.find(p => p.id === vals.assigneeId)?.name,
                        priority: vals.priority || 'normal',
                        status: 'todo',
                        progress: 0,
                        // Due date ONLY, spans the whole row
                        dueDate: vals.dueDate
                            ? Timestamp.fromDate(vals.dueDate.toDate())
                            : undefined,
                        departmentId,
                        createdAt: Timestamp.now()
                    })
                    message.success('Task created')
                    setTaskModalOpen(false)
                    taskForm.resetFields()
                } catch (error) {
                    console.error(error)
                }
            }}
            okText='Create'
            style={{ maxWidth: '100vw' }}
            styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        >
            <Form layout='vertical' form={taskForm}>
                <Form.Item name='title' label='Title' rules={[{ required: true }]}>
                    <Input placeholder='e.g. Prepare client pack' />
                </Form.Item>
                <Form.Item name='description' label='Description'>
                    <Input.TextArea autoSize={{ minRows: 3 }} />
                </Form.Item>
                <Form.Item name='assigneeId' label='Assign to'>
                    <Select
                        allowClear
                        placeholder='Select teammate'
                        options={people.map(p => ({ value: p.id, label: p.name }))}
                    />
                </Form.Item>
                <Form.Item name='priority' label='Priority' initialValue='normal'>
                    <Radio.Group>
                        <Radio.Button value='low'>Low</Radio.Button>
                        <Radio.Button value='normal'>Normal</Radio.Button>
                        <Radio.Button value='high'>High</Radio.Button>
                    </Radio.Group>
                </Form.Item>
                {/* Due date spans the full row */}
                <Form.Item name='dueDate' label='Due Date' rules={[{ required: true }]}>
                    <DatePicker style={{ width: '100%' }} />
                </Form.Item>
            </Form>
        </Modal>
    )

    const TaskUpdateModal = (
        <Modal
            title={`Update Task${selectedTask ? `: ${selectedTask.title}` : ''}`}
            open={updateOpen}
            onCancel={() => {
                setUpdateOpen(false)
                setSelectedTask(null)
            }}
            footer={null}
        >
            <Form
                layout='vertical'
                form={updateForm}
                onFinish={async vals => {
                    if (!selectedTask) return

                    const id = `update-${Date.now()}`
                    const file = vals.proofFile?.file?.originFileObj
                    let fileUrl = ''

                    // Upload proof if provided
                    if (file) {
                        const storageRef = ref(
                            storage,
                            `task-proofs/${selectedTask.id}/${id}`
                        )
                        await uploadBytes(storageRef, file)
                        fileUrl = await getDownloadURL(storageRef)
                    }

                    // Create progress update entry
                    await setDoc(
                        doc(db, 'tasks', selectedTask.id, 'progressUpdates', id),
                        {
                            id,
                            progress: vals.progress,
                            notes: vals.progressNotes || '',
                            fileUrl,
                            createdAt: Timestamp.now(),
                            createdBy: userId,
                            createdByName: user?.name || 'Unnamed'
                        }
                    )

                    const newProgress = vals.progress
                    const newStatus =
                        newProgress === 100
                            ? 'done'
                            : vals.status === 'todo'
                                ? 'todo'
                                : 'in_progress'

                    // Force proof file at 100%
                    if (newProgress === 100 && !fileUrl) {
                        message.error('You must upload proof when marking task as done.')
                        return
                    }

                    await updateDoc(doc(db, 'tasks', selectedTask.id), {
                        progress: newProgress,
                        status: newStatus,
                        updatedAt: Timestamp.now(),
                        updatedBy: userId
                    })

                    message.success('Progress logged')
                    setUpdateOpen(false)
                    setSelectedTask(null)
                }}
            >
                <Form.Item name='status' label='Status' rules={[{ required: true }]}>
                    <Select
                        options={[
                            { value: 'todo', label: 'To do' },
                            { value: 'in_progress', label: 'In Progress' },
                            { value: 'done', label: 'Done' }
                        ]}
                    />
                </Form.Item>

                <Form.Item
                    name='progress'
                    label='Progress'
                    rules={[{ required: true }]}
                >
                    <Slider
                        min={0}
                        max={100}
                        step={5}
                        marks={{ 0: '0%', 100: '100%' }}
                        tooltip={{ open: true }}
                    />
                </Form.Item>

                <Form.Item name='progressNotes' label='Progress Notes'>
                    <Input.TextArea
                        autoSize={{ minRows: 3 }}
                        placeholder='Optional notes on what’s been completed...'
                    />
                </Form.Item>

                <Form.Item
                    name='proofFile'
                    label='Upload Proof (optional)'
                    valuePropName='file'
                    getValueFromEvent={e => (Array.isArray(e) ? e : e?.fileList)}
                >
                    <Upload
                        beforeUpload={() => false}
                        maxCount={1}
                        accept='.jpg,.jpeg,.png,.pdf,.doc,.docx'
                    >
                        <Button>Click to Upload</Button>
                    </Upload>
                </Form.Item>

                <Space style={{ marginTop: 16 }} wrap>
                    <Button htmlType='submit' type='primary'>
                        Save Changes
                    </Button>

                    <Button
                        danger
                        onClick={() => {
                            Modal.confirm({
                                title: 'Cancel Task',
                                content: (
                                    <Input.TextArea
                                        autoSize={{ minRows: 3 }}
                                        placeholder='Provide reason for cancellation...'
                                        id='cancel-reason-input'
                                    />
                                ),
                                okText: 'Cancel Task',
                                cancelText: 'Abort',
                                onOk: async () => {
                                    const reason = (
                                        document.getElementById(
                                            'cancel-reason-input'
                                        ) as HTMLTextAreaElement
                                    )?.value?.trim()
                                    if (!reason) {
                                        message.error('Cancellation reason is required')
                                        throw new Error('Cancelled')
                                    }
                                    await updateDoc(doc(db, 'tasks', selectedTask.id), {
                                        status: 'cancelled',
                                        cancelledAt: Timestamp.now(),
                                        cancelledBy: userId,
                                        cancelReason: reason
                                    })
                                    message.success('Task cancelled')
                                    setUpdateOpen(false)
                                    setSelectedTask(null)
                                }
                            })
                        }}
                    >
                        Cancel Task
                    </Button>

                    {/* Only show Send Reminder if user is NOT assignee */}
                    {selectedTask?.assigneeId !== userId && (
                        <Button
                            onClick={async () => {
                                const target = people.find(
                                    p => p.id === selectedTask?.assigneeId
                                )
                                const name = target?.name || 'Unnamed'
                                const email = target?.email

                                try {
                                    await new Promise(res => setTimeout(res, 600))
                                    message.success(
                                        `Reminder sent to ${name}${email ? ` (${email})` : ''}`
                                    )
                                } catch {
                                    message.error('Failed to send reminder')
                                }
                            }}
                        >
                            Send Reminder
                        </Button>
                    )}
                </Space>
            </Form>

            {history.length > 0 && (
                <div style={{ marginTop: 24 }}>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>
                        Progress History:
                    </Text>

                    {isAdmin && selectedTask?.status === 'done' && (
                        <div style={{ marginTop: 16 }}>
                            <Text strong>Admin Review:</Text>
                            <Space wrap style={{ marginTop: 8 }}>
                                <Button
                                    type='primary'
                                    onClick={async () => {
                                        await updateDoc(doc(db, 'tasks', selectedTask.id), {
                                            proofValidated: true
                                        })
                                        message.success('Proof validated.')
                                    }}
                                >
                                    Validate Proof
                                </Button>
                                <Button
                                    danger
                                    onClick={async () => {
                                        await updateDoc(doc(db, 'tasks', selectedTask.id), {
                                            proofValidated: false
                                        })
                                        message.warning('Proof invalidated.')
                                    }}
                                >
                                    Invalidate Proof
                                </Button>
                            </Space>
                        </div>
                    )}

                    <Timeline
                        mode='left'
                        style={{
                            maxHeight: 320,
                            overflowY: 'auto',
                            paddingRight: 8,
                            padding: 10
                        }}
                        items={history.slice(0, 8).map((h, index) => ({
                            color:
                                h.progress === 100
                                    ? 'green'
                                    : h.progress >= 50
                                        ? 'blue'
                                        : 'gray',
                            dot: <ClockCircleOutlined />,
                            children: (
                                <div key={h.id}>
                                    <div
                                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                                    >
                                        <Tag color={h.progress === 100 ? 'green' : 'blue'}>
                                            {h.progress}%
                                        </Tag>
                                        <Text style={{ wordBreak: 'break-word' }}>
                                            {h.notes?.slice(0, 100) || 'No notes'}
                                        </Text>
                                    </div>

                                    <div style={{ marginTop: 4 }}>
                                        <Text type='secondary'>
                                            <UserOutlined style={{ marginRight: 4 }} />
                                            {h.createdByName} •{' '}
                                            {dayjs(h.createdAt.toDate()).format('YYYY-MM-DD HH:mm')}
                                        </Text>
                                    </div>

                                    {h.fileUrl && (
                                        <div style={{ marginTop: 4 }}>
                                            <a href={h.fileUrl} target='_blank' rel='noreferrer'>
                                                <FileOutlined /> View Uploaded Proof
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )
                        }))}
                    />

                    {history.length > 8 && (
                        <Text type='secondary'>
                            Showing recent 8 of {history.length} updates.
                        </Text>
                    )}
                </div>
            )}
        </Modal>
    )

    /* ------------------------------ JSX ----------------------------- */
    return (
        <Layout style={{ minHeight: '100vh', background: '#fff', padding: 24 }}>
            <Helmet>
                <title>Department Workroom</title>
            </Helmet>

            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
            >
                <Card
                    style={{
                        ...cardChrome,
                        marginBottom: 12,
                        background: 'linear-gradient(90deg,#eef4ff, #f9fbff)'
                    }}
                >
                    <Row align='middle' justify='space-between'>
                        <Col>
                            <Title level={4} style={{ marginBottom: 0 }}>
                                {deptName} — Workroom
                            </Title>
                            <Text type='secondary'>
                                Tasks, shared calendar, events & appointments for your team.
                            </Text>
                        </Col>
                        <Col>
                            <Space
                                wrap
                                style={{ justifyContent: 'flex-end', display: 'flex' }}
                            >
                                <Button
                                    type='primary'
                                    icon={<PlusOutlined />}
                                    onClick={() => setTaskModalOpen(true)}
                                >
                                    New Task
                                </Button>
                                <Button
                                    type='primary'
                                    icon={<PlusOutlined />}
                                    onClick={() => setEventModalOpen(true)}
                                >
                                    Add Event
                                </Button>
                                <Button type='primary' onClick={() => setApptOpen(true)}>
                                    Book Appointment
                                </Button>
                                <Button
                                    icon={<CalendarOutlined />}
                                    onClick={() => setCalendarVisible(true)}
                                >
                                    Open Calendar
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                </Card>
            </motion.div>

            <Row gutter={[16, 16]}>
                {/* Tasks */}
                <Col xs={24} lg={14}>
                    <Card
                        title={
                            <Space>
                                <FlagOutlined />
                                <span>Department Tasks</span>
                            </Space>
                        }
                        style={cardChrome}
                    >
                        {/* Filter by Due Date - full width row */}
                        <Row gutter={[16, 8]} style={{ marginBottom: 16 }}>
                            <Col span={24}>
                                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                                    Filter by Due Date:
                                </Text>
                                <Radio.Group
                                    value={taskFilter}
                                    onChange={e => {
                                        setTaskFilter(e.target.value)
                                        if (e.target.value !== 'custom') setTaskRange(null)
                                    }}
                                    buttonStyle='solid'
                                    size='small'
                                >
                                    <Radio.Button value='today'>Today</Radio.Button>
                                    <Radio.Button value='week'>This Week</Radio.Button>
                                    <Radio.Button value='month'>This Month</Radio.Button>
                                    <Radio.Button value='custom'>Custom</Radio.Button>
                                    <Radio.Button value='all'>All</Radio.Button>
                                </Radio.Group>
                            </Col>

                            {taskFilter === 'custom' && (
                                <Col span={24} style={{ marginTop: 8 }}>
                                    <DatePicker.RangePicker
                                        allowClear={false}
                                        onChange={(r: any) => setTaskRange(r)}
                                        style={{ width: '100%' }}
                                    />
                                </Col>
                            )}
                        </Row>

                        {/* Attribute filters - second row */}
                        <Row gutter={[16, 16]} align='bottom'>
                            {/* Status Filter */}
                            <Col xs={24} md={12} lg={6}>
                                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                                    Status
                                </Text>
                                <Select
                                    mode='multiple'
                                    allowClear
                                    placeholder='Filter status'
                                    value={statusFilter as any}
                                    onChange={(v: any) => setStatusFilter(v)}
                                    style={{ width: '100%' }}
                                    options={[
                                        { value: 'todo', label: 'To do' },
                                        { value: 'in_progress', label: 'In progress' },
                                        { value: 'done', label: 'Done' }
                                    ]}
                                />
                            </Col>

                            {/* Assignee Filter */}
                            <Col xs={24} md={12} lg={6}>
                                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                                    Assignee
                                </Text>
                                <Select
                                    value={assigneeFilter}
                                    onChange={(v: any) => setAssigneeFilter(v)}
                                    style={{ width: '100%' }}
                                    options={[
                                        { value: 'all', label: 'All assignees' },
                                        { value: 'me', label: 'Assigned to me' },
                                        { value: 'unassigned', label: 'Unassigned' },
                                        ...people.map(p => ({ value: p.id, label: p.name }))
                                    ]}
                                />
                            </Col>

                            {/* Reset Button */}
                            <Col xs={24} md={12} lg={6}>
                                <Button
                                    block
                                    onClick={() => {
                                        setTaskFilter('all')
                                        setTaskRange(null)
                                        setStatusFilter([])
                                        setAssigneeFilter('all')
                                    }}
                                >
                                    Reset Filters
                                </Button>
                            </Col>
                        </Row>

                        {/* Then conditionally show Table or Empty */}
                        {filteredTasks.length === 0 ? (
                            <Empty description='No tasks found.' style={{ marginTop: 24 }} />
                        ) : (
                            <Table
                                rowKey='id'
                                dataSource={filteredTasks}
                                columns={taskColumns}
                                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                            />
                        )}
                    </Card>
                </Col>

                {/* Right column: Upcoming Events + Appointments */}
                <Col xs={24} lg={10}>
                    <UpcomingEventsCard
                        departmentId={departmentId}
                        daysAhead={7}
                        limit={6}
                        onAdd={() => setEventModalOpen(true)}
                        onViewCalendar={() => setCalendarVisible(true)}
                        onEventClick={ev => {
                            setSelectedEvent(ev as any)
                            setDetailsModalVisible(true)
                        }}
                    />

                    <Card
                        title={
                            <Space>
                                <CalendarOutlined />
                                <span>Upcoming Week — Appointments</span>
                            </Space>
                        }
                        style={{ ...cardChrome, marginTop: 16 }}
                    >
                        {appts.length === 0 ? (
                            <Empty description='No appointments in the next 7 days.' />
                        ) : (
                            <div style={{ display: 'grid', gap: 12 }}>
                                {appts.map(a => {
                                    const s = a.start?.toDate
                                        ? dayjs(a.start.toDate())
                                        : dayjs(a.start)
                                    const e = a.end?.toDate
                                        ? dayjs(a.end.toDate())
                                        : dayjs(a.end || a.start)
                                    return (
                                        <div
                                            key={a.id}
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                padding: '8px 12px',
                                                border: '1px solid #f0f0f0',
                                                borderRadius: 8,
                                                background: '#fafafa'
                                            }}
                                        >
                                            <div>
                                                <Text strong>{a.title || 'Appointment'}</Text>
                                                <div>
                                                    <Text type='secondary'>
                                                        {s.format('YYYY-MM-DD HH:mm')} → {e.format('HH:mm')}
                                                    </Text>
                                                </div>
                                                {a.location && (
                                                    <Text type='secondary'>📍 {a.location}</Text>
                                                )}
                                            </div>
                                            <Tag color='purple'>Appointment</Tag>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </Card>
                </Col>
            </Row>

            {/* Create Task */}
            {TaskCreateModal}

            {/* Update Task (assignee-only) */}
            {TaskUpdateModal}

            {/* Quick Appointment (dept-scoped) */}
            <QuickAppointmentModal
                open={apptOpen}
                onClose={() => setApptOpen(false)}
                departmentId={departmentId}
            />

            {/* Events — use YOUR GlobalEventModal + your onSubmit, with dept auto-pick & clash check */}
            <GlobalEventModal
                open={eventModalOpen}
                onCancel={() => setEventModalOpen(false)}
                form={eventForm}
                onSuccess={(newEvent: any) => setEvents(prev => [...prev, newEvent])}
                onSubmit={async (vals: any) => {
                    // === Your snippet (kept), with safe dept + attendees + clash check ===
                    try {
                        const eventDate = vals.date?.format?.('YYYY-MM-DD')
                        const timeValue = vals.time?.toDate ? vals.time.toDate() : vals.time

                        // 1) clash check (dept events + appointments)
                        const conflicts = await checkEventClashes(eventDate, timeValue)
                        if (conflicts.length) {
                            Modal.warning({
                                title: 'Time clash detected',
                                content: `Conflicts with: ${conflicts.slice(0, 5).join(', ')}`
                            })
                            return
                        }

                        // 2) same-department attendees (ids)
                        const attendees = people.map(p => ({
                            id: p.id,
                            name: p.name,
                            email: p.email
                        }))

                        // 3) proceed with your save flow (auto-pick department)
                        const newId = `event-${Date.now()}`
                        const newEvent = {
                            id: newId,
                            title: vals.title,
                            date: eventDate,
                            time: vals.time?.toDate ? vals.time.toDate() : vals.time,
                            type: vals.type,
                            format: vals.format,
                            link: vals.link,
                            location: vals.location,
                            // override: auto department + id
                            department: deptName,
                            departmentId,
                            attendees,
                            createdAt: Timestamp.now(),
                        }
                        await setDoc(doc(db, 'events', newId), newEvent)
                        setEvents(prev => [...prev, newEvent as any])
                        message.success('Event added successfully')
                        setEventModalOpen(false)
                        eventForm.resetFields()
                    } catch (e) {
                        console.error(e)
                        message.error('Failed to create event')
                    }
                }}
            />

            {/* Full Calendar (unchanged) */}
            <EventsCalendarModal
                open={calendarVisible}
                onClose={() => setCalendarVisible(false)}
                events={events as any}
                onEventClick={ev => {
                    setSelectedEvent(ev as any)
                    setDetailsModalVisible(true)
                }}
            />

            {/* Event details (unchanged) */}
            <EventDetailsModal
                open={detailsModalVisible}
                onClose={() => setDetailsModalVisible(false)}
                event={selectedEvent as any}
            />
        </Layout>
    )
}

export default DepartmentWorkroom
