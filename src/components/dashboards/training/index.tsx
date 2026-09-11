import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Table,
    Tag,
    Typography,
    Button,
    Space,
    Tooltip,
    Form,
    Empty,
    Result,
    Grid,
    Progress,
    List,
    Select
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CheckCircleOutlined,
    CalendarOutlined,
    ProjectOutlined,
    FilterOutlined
} from '@ant-design/icons'
import { db } from '@/firebase'
import { collection, getDocs, query, where, QueryConstraint } from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import { motion } from 'framer-motion'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import { Helmet } from 'react-helmet'
import AppointmentDetailsModal from '@/components/modals/AppointmentDetails'
import AppointmentsCalendarModal from '@/components/modals/AppointmentsCalender'
import { fetchAppointments } from '@/services/appointmentService'
import { loadInterventionMetrics, type InterventionMetricSummary } from '@/services/interventionMetricsService'
import InterventionMetricsGrid from '@/components/dashboards/metrics/InterventionMetricsGrid'

const { Text } = Typography


type EventItem = {
    id: string
    title: string
    date: string
    startTime?: string
    endTime?: string
    type?: string
    format?: string
    location?: string
    link?: string
    description?: string
    departmentId?: string
    departmentName?: string
    programId?: string
    participants?: Array<{
        id?: string
        email?: string
        type?: string
        confirmationStatus?: string
    }>
    time?: Dayjs
    locationType?: string
    meetLink?: string
    joinLink?: string
    onlineLink?: string
}

type LearnerRow = {
    id: string
    name: string
    program: string
    progress: number
    status: string
    assigneeName: string
    departmentId?: string
    departmentName?: string
    programId?: string

    computedProgress?: number
    assigneeCompletionStatus?: string
    participantCompletionStatus?: string
    assigneeAcceptanceStatus?: string
    participantAcceptanceStatus?: string
    tracking?: any
    progressUpdates?: any[]
}

type CanonicalStatus = 'completed' | 'in_progress' | 'assigned' | 'pending'

type DepartmentOption = {
    id: string
    name: string
    parentDepartmentId?: string
    isParent?: boolean
}

const DEBUG = true
const log = (...args: any[]) => DEBUG && console.log('[TrainingDashboard]', ...args)

const chunk = <T,>(arr: T[], size: number) => {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
}

const norm = (v?: any) =>
    String(v ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s|_/g, '-')

const isPending = (v?: any) => {
    const s = norm(v)
    return (
        s === 'pending' ||
        s === 'awaiting' ||
        s === 'not-started' ||
        s === 'new' ||
        s === 'submitted' ||
        s === 'queued' ||
        s === 'assigned'
    )
}

const isAccepted = (v?: any) => {
    const s = norm(v)
    return s === 'accepted' || s === 'approved' || s === 'acknowledged'
}

const isInProgress = (v?: any) => {
    const s = norm(v)
    return (
        s === 'in-progress' ||
        s === 'inprogress' ||
        s === 'ongoing' ||
        s === 'active' ||
        s === 'running' ||
        s === 'underway' ||
        s === 'started'
    )
}

const isCompleted = (v?: any) => {
    const s = norm(v)
    return s === 'completed' || s === 'done' || s === 'complete' || s === 'finished'
}

const isConfirmed = (v?: any) => {
    const s = norm(v)
    return s === 'confirmed' || s === 'approved' || s === 'verified' || s === 'accepted'
}

const hasStartedWork = (row: any) => {
    const progress = Number(row?.computedProgress ?? row?.progress ?? 0)
    const hasUpdates = Array.isArray(row?.progressUpdates) && row.progressUpdates.length > 0
    const docsUploaded =
        Array.isArray(row?.tracking?.documentsUploaded) && row.tracking.documentsUploaded.length > 0
    const sessions = Number(row?.tracking?.sessionsLogged ?? 0)
    const timeHours = Number(row?.tracking?.timeSpentHours ?? 0)

    return progress > 0 || hasUpdates || docsUploaded || sessions > 0 || timeHours > 0
}

const canonicalStatus = (row: any): CanonicalStatus => {
    const overall = norm(row?.status)

    const consultantCompDone = isCompleted(row?.assigneeCompletionStatus)
    const userCompDone = isCompleted(row?.participantCompletionStatus) || isConfirmed(row?.participantCompletionStatus)

    if (isCompleted(overall) || (consultantCompDone && userCompDone)) return 'completed'

    const started = hasStartedWork(row)

    if (isInProgress(overall)) return 'in_progress'
    if (started) return 'in_progress'

    const cStatus = norm(row?.assigneeAcceptanceStatus)
    const uStatus = norm(row?.participantAcceptanceStatus)

    const consultantAccepted = isAccepted(cStatus)
    const consultantPending = isPending(cStatus) || cStatus === ''

    const userPending = isPending(uStatus) || uStatus === ''
    const userAccepted = isAccepted(uStatus)

    if (overall === 'assigned') return 'assigned'
    if (consultantPending) return 'assigned'
    if (consultantAccepted && userPending) return 'assigned'
    if (userAccepted && !started) return 'assigned'

    if (isPending(overall)) return 'pending'

    return 'pending'
}

const matchesEventProgram = (value?: any, selectedProgramId?: string, isAllPrograms?: boolean) => {
    if (isAllPrograms) return true

    const v = String(value ?? '').trim()
    if (!selectedProgramId) return true

    // legacy events without a program should still show
    if (!v) return true

    return v === selectedProgramId
}

const getBottleneck = (row: any): string => {
    const c = canonicalStatus(row)

    if (c === 'assigned') {
        if (isPending(row?.participantAcceptanceStatus) || norm(row?.participantAcceptanceStatus) === '') {
            return 'Awaiting SME Acceptance'
        }

        return '—'
    }

    if (c === 'in_progress') {
        if (isPending(row?.assigneeCompletionStatus) || norm(row?.assigneeCompletionStatus) === '') {
            return 'Awaiting Facilitator Completion'
        }

        if (isCompleted(row?.assigneeCompletionStatus)) {
            const u = row?.participantCompletionStatus
            if (!isConfirmed(u) && !isCompleted(u)) return 'Awaiting SME Confirmation'
        }

        return '—'
    }

    return '—'
}

const getEventIcon = (type: string) => {
    switch (type) {
        case 'meeting':
            return <CalendarOutlined style={{ color: '#1890ff' }} />
        case 'deadline':
            return <CheckCircleOutlined style={{ color: '#ff4d4f' }} />
        case 'workshop':
            return <ProjectOutlined style={{ color: '#722ed1' }} />
        default:
            return <CalendarOutlined style={{ color: '#52c41a' }} />
    }
}

const TrainingDashboard: React.FC = () => {
    const { user } = useFullIdentity()
    const { programId, isAllPrograms, activeProgramId } = useActiveProgramId()

    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md

    const [loading, setLoading] = useState(true)
    const [learners, setLearners] = useState<LearnerRow[]>([])
    const [interventionMetrics, setInterventionMetrics] = useState<InterventionMetricSummary>({
        totalRequired: 0,
        assigned: 0,
        pendingAssignment: 0,
        inProgress: 0,
        completed: 0
    })
    const [events, setEvents] = useState<EventItem[]>([])
    const [appointments, setAppointments] = useState<any[]>([])

    const [departmentScopeOptions, setDepartmentScopeOptions] = useState<DepartmentOption[]>([])
    const [selectedDepartmentScope, setSelectedDepartmentScope] = useState<string>('all')
    const [appointmentDepartmentScopeIds, setAppointmentDepartmentScopeIds] = useState<string[]>([])
    const [isParentDepartmentView, setIsParentDepartmentView] = useState(false)

    const [calendarVisible, setCalendarVisible] = useState(false)
    const [eventModalOpen, setEventModalOpen] = useState(false)
    const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null)
    const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null)
    const [detailsModalVisible, setDetailsModalVisible] = useState(false)
    const [eventForm] = Form.useForm()

    const fetchData = async () => {
        try {
            setLoading(true)

            const myDepartmentId = (user as any)?.departmentId as string | undefined

            let allowedDeptIds: string[] = []
            let scopeOptions: DepartmentOption[] = []
            let parentView = false

            if (myDepartmentId) {
                const myDepartmentSnap = await getDocs(
                    query(collection(db, 'departments'))
                )

                const allDepartments = myDepartmentSnap.docs.map(doc => ({
                    id: doc.id,
                    ...(doc.data() as any)
                }))

                const myDepartment = allDepartments.find(d => d.id === myDepartmentId)
                const childDepartments = allDepartments.filter(d => d.parentDepartmentId === myDepartmentId)

                parentView = childDepartments.length > 0
                setIsParentDepartmentView(parentView)

                if (parentView) {
                    allowedDeptIds = Array.from(new Set([myDepartmentId, ...childDepartments.map(d => d.id)]))

                    scopeOptions = [
                        { id: 'all', name: 'All Departments' },
                        ...(myDepartment
                            ? [
                                {
                                    id: myDepartment.id,
                                    name: myDepartment.name || 'Parent Department',
                                    isParent: true
                                }
                            ]
                            : []),
                        ...childDepartments.map(d => ({
                            id: d.id,
                            name: d.name || 'Unnamed Department',
                            parentDepartmentId: d.parentDepartmentId
                        }))
                    ]
                } else {
                    allowedDeptIds = [myDepartmentId]
                    scopeOptions = myDepartment
                        ? [
                            {
                                id: myDepartment.id,
                                name: myDepartment.name || 'Current Department'
                            }
                        ]
                        : []
                }
            } else {
                const depsSnap = await getDocs(
                    query(collection(db, 'departments'))
                )
                const allDepartments = depsSnap.docs.map(doc => ({
                    id: doc.id,
                    ...(doc.data() as any)
                }))

                allowedDeptIds = allDepartments.map(d => d.id)
                scopeOptions = [
                    { id: 'all', name: 'All Departments' },
                    ...allDepartments.map(d => ({
                        id: d.id,
                        name: d.name || 'Unnamed Department',
                        parentDepartmentId: d.parentDepartmentId
                    }))
                ]
                setIsParentDepartmentView(true)
            }

            setDepartmentScopeOptions(scopeOptions)
            setAppointmentDepartmentScopeIds(allowedDeptIds)

            setSelectedDepartmentScope(prev => {
                if (!scopeOptions.length) return 'all'
                if (scopeOptions.some(opt => opt.id === prev)) return prev
                return scopeOptions.some(opt => opt.id === 'all') ? 'all' : scopeOptions[0].id
            })

            let interventionsData: LearnerRow[] = []

            if (allowedDeptIds.length > 0) {
                const deptChunks = chunk(allowedDeptIds, 10)
                const collected: LearnerRow[] = []

                for (const ids of deptChunks) {
                    const constraints: QueryConstraint[] = [where('departmentId', 'in', ids)]
                    const qInterventions = query(collection(db, 'assignedInterventions'), ...constraints)
                    const snap = await getDocs(qInterventions)

                    snap.forEach(d => {
                        const data = d.data() as any

                        if (!isAllPrograms && activeProgramId && data.programId !== activeProgramId) return

                        collected.push({
                            id: d.id,
                            name: data.participantName || 'Unknown',
                            program: data.interventionTitle || 'Unknown',
                            progress: Number(data.computedProgress ?? 0),
                            status: String(data.assignmentStatus || ''),
                            assigneeName: data.assigneeName || 'Unassigned',
                            departmentId: data.departmentId,
                            departmentName: data.departmentName || data.areaOfSupport || '—',
                            programId: data.programId,
                            computedProgress: data.computedProgress,
                            assigneeCompletionStatus: data.assigneeCompletionStatus,
                            participantCompletionStatus: data.participantCompletionStatus,
                            assigneeAcceptanceStatus: data.assigneeAcceptanceStatus,
                            participantAcceptanceStatus: data.participantAcceptanceStatus,
                            tracking: data.tracking,
                            progressUpdates: data.progressUpdates
                        })
                    })
                }

                const byId = new Map(collected.map(x => [x.id, x]))
                interventionsData = Array.from(byId.values())
            } else {
                const constraints: QueryConstraint[] = []
                const interventionsQuery = query(collection(db, 'assignedInterventions'), ...constraints)
                const interventionsSnap = await getDocs(interventionsQuery)

                interventionsData = interventionsSnap.docs
                    .map(d => {
                        const data = d.data() as any
                        return {
                            id: d.id,
                            name: data.participantName || 'Unknown',
                            program: data.interventionTitle || 'Unknown',
                            progress: Number(data.computedProgress ?? 0),
                            status: String(data.assignmentStatus || ''),
                            assigneeName: data.assigneeName || 'Unassigned',
                            departmentId: data.departmentId,
                            departmentName: data.departmentName || data.areaOfSupport || '—',
                            programId: data.programId,
                            computedProgress: data.computedProgress,
                            assigneeCompletionStatus: data.assigneeCompletionStatus,
                            participantCompletionStatus: data.participantCompletionStatus,
                            assigneeAcceptanceStatus: data.assigneeAcceptanceStatus,
                            participantAcceptanceStatus: data.participantAcceptanceStatus,
                            tracking: data.tracking,
                            progressUpdates: data.progressUpdates
                        }
                    })
                    .filter(row => isAllPrograms || !activeProgramId || row.programId === activeProgramId)
            }

            let sessionData: EventItem[] = []

            if (allowedDeptIds.length > 0) {
                const deptChunks = chunk(allowedDeptIds, 10)
                const collected: EventItem[] = []

                for (const ids of deptChunks) {
                    const constraints: QueryConstraint[] = [where('departmentId', 'in', ids)]
                    const qEvents = query(collection(db, 'events'), ...constraints)
                    const snap = await getDocs(qEvents)

                    snap.forEach(d => {
                        const data = d.data() as any

                        if (!matchesEventProgram(data.programId, activeProgramId, isAllPrograms)) return

                        collected.push({
                            id: d.id,
                            ...data,
                            departmentName: data.departmentName || data.areaOfSupport || '—'
                        } as EventItem)
                    })
                }

                const byId = new Map(collected.map(e => [e.id, e]))
                sessionData = Array.from(byId.values())
            } else {
                const constraints: QueryConstraint[] = []
                const qEvents = query(collection(db, 'events'))
                const snap = await getDocs(qEvents)

                sessionData = snap.docs
                    .map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    } as EventItem))
                    .filter(ev => matchesEventProgram(ev.programId, activeProgramId, isAllPrograms))
            }

            const appointmentData = await fetchAppointments({
                departmentIds: allowedDeptIds.length ? allowedDeptIds : undefined,
                programId: !isAllPrograms ? activeProgramId : undefined
            })

            setLearners(interventionsData)
            setEvents(sessionData)
            setAppointments(appointmentData)
        } catch (err) {
            console.error('Error fetching dashboard data:', err)
            setLearners([])
            setEvents([])
            setAppointments([])
            setDepartmentScopeOptions([])
            setAppointmentDepartmentScopeIds([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!user) return
        fetchData()
    }, [(user as any)?.departmentId, activeProgramId, isAllPrograms])

    const filteredLearners = useMemo(() => {
        if (selectedDepartmentScope === 'all') return learners
        return learners.filter(item => String(item.departmentId || '') === selectedDepartmentScope)
    }, [learners, selectedDepartmentScope])

    const filteredEvents = useMemo(() => {
        if (selectedDepartmentScope === 'all') return events
        return events.filter(item => String(item.departmentId || '') === selectedDepartmentScope)
    }, [events, selectedDepartmentScope])

    const filteredAppointments = useMemo(() => {
        if (selectedDepartmentScope === 'all') return appointments
        return appointments.filter(item => String(item.departmentId || '') === selectedDepartmentScope)
    }, [appointments, selectedDepartmentScope])

    useEffect(() => {
        if (!isAllPrograms && !activeProgramId) {
            setInterventionMetrics({ totalRequired: 0, assigned: 0, pendingAssignment: 0, inProgress: 0, completed: 0 })
            return
        }
        const selectedDepartmentName = departmentScopeOptions.find(option => option.id === selectedDepartmentScope)?.name || ''
        loadInterventionMetrics({
            programId: isAllPrograms ? null : activeProgramId,
            assignedMatches: row => selectedDepartmentScope === 'all' ||
                String(row.departmentId || '') === selectedDepartmentScope,
            requiredMatches: entry => selectedDepartmentScope === 'all' ||
                String(entry.departmentId || '') === selectedDepartmentScope ||
                String(entry.areaOfSupport || entry.area || entry.departmentName || '').trim().toLowerCase() ===
                String(selectedDepartmentName).trim().toLowerCase()
        }).then(setInterventionMetrics).catch(error => {
            console.error('[TrainingDashboard] intervention metrics failed', error)
            setInterventionMetrics({ totalRequired: 0, assigned: 0, pendingAssignment: 0, inProgress: 0, completed: 0 })
        })
    }, [activeProgramId, isAllPrograms, selectedDepartmentScope, departmentScopeOptions])

    const distribution = useMemo(() => {
        let completed = 0
        let inProgress = 0
        let assigned = 0
        let pending = 0

        for (const l of filteredLearners as any[]) {
            const s = canonicalStatus(l)
            if (s === 'completed') completed++
            else if (s === 'in_progress') inProgress++
            else if (s === 'assigned') assigned++
            else pending++
        }

        return { completed, inProgress, assigned, pending, total: filteredLearners.length }
    }, [filteredLearners])

    const donutChartOptions: Highcharts.Options = {
        chart: { type: 'pie', backgroundColor: 'transparent' },
        title: { text: 'Interventions Status', style: { color: '#000', fontWeight: 'bold' } },
        credits: { enabled: false },
        exporting: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: '60%',
                dataLabels: {
                    enabled: true,
                    style: { color: '#000', fontWeight: 'bold', textOutline: 'none' },
                    distance: 20,
                    connectorWidth: 2,
                    connectorColor: '#666',
                    formatter: function () {
                        // @ts-ignore
                        if (this.y === 0) return null
                        // @ts-ignore
                        return `${(this.point as any).name}: ${this.y}`
                    }
                }
            }
        },
        legend: {
            enabled: true,
            layout: 'vertical',
            align: 'right',
            verticalAlign: 'middle',
            itemStyle: { color: '#000', fontWeight: 'normal' },
            itemHoverStyle: { color: '#1890ff' }
        },
        tooltip: { pointFormat: '{series.name}: <b>{point.percentage:.1f}%</b>' },
        series: [
            {
                type: 'pie',
                name: 'Interventions',
                data: [
                    { name: 'Assigned', y: distribution.assigned, color: '#722ed1' },
                    { name: 'In Progress', y: distribution.inProgress, color: '#fa8c16' },
                    { name: 'Pending', y: distribution.pending, color: '#1890ff' },
                    { name: 'Completed', y: distribution.completed, color: '#52c41a' }
                ].filter(d => d.y > 0)
            }
        ]
    }

    const columns: ColumnsType<LearnerRow> = [
        {
            title: 'Beneficiary',
            dataIndex: 'name',
            key: 'name',
            ellipsis: true,
            responsive: ['xs', 'sm', 'md', 'lg']
        },
        {
            title: 'Intervention',
            dataIndex: 'program',
            key: 'program',
            ellipsis: true,
            render: (text: string) => <Tag color="geekblue">{text}</Tag>,
            responsive: ['sm', 'md', 'lg']
        },
        {
            title: 'Department',
            dataIndex: 'departmentName',
            key: 'departmentName',
            ellipsis: true,
            render: (d: string) => <Tag>{d || '—'}</Tag>,
            responsive: ['md', 'lg']
        },
        {
            title: 'Progress',
            dataIndex: 'progress',
            key: 'progress',
            width: 100,
            render: (v: number) => `${Number(v || 0)}%`,
            responsive: ['xs', 'sm', 'md', 'lg']
        },
        {
            title: 'Status',
            key: 'status',
            width: 130,
            render: (_: any, r: any) => {
                const s = canonicalStatus(r)
                const map = {
                    completed: { color: 'green', label: 'Completed' },
                    in_progress: { color: 'orange', label: 'In Progress' },
                    assigned: { color: 'purple', label: 'Assigned' },
                    pending: { color: 'blue', label: 'Pending' }
                } as const
                return <Tag color={map[s].color}>{map[s].label}</Tag>
            },
            responsive: ['xs', 'sm', 'md', 'lg']
        },
        {
            title: 'Bottleneck',
            key: 'bottleneck',
            ellipsis: true,
            render: (_: any, r: any) => {
                const b = getBottleneck(r)
                if (b === '—') return <Text type="secondary">—</Text>
                return <Tag color="volcano">{b}</Tag>
            },
            responsive: ['lg']
        },
        {
            title: 'Facilitator',
            dataIndex: 'assigneeName',
            key: 'assigneeName',
            ellipsis: true,
            render: (name: string) => (
                <Tag color={name === 'Unassigned' ? 'red' : 'default'}>{name}</Tag>
            ),
            responsive: ['md', 'lg']
        }
    ]

    const renderLearnerCard = (item: LearnerRow) => {
        const s = canonicalStatus(item)
        const statusMap = {
            completed: { color: 'green', label: 'Completed' },
            in_progress: { color: 'orange', label: 'In Progress' },
            assigned: { color: 'purple', label: 'Assigned' },
            pending: { color: 'blue', label: 'Pending' }
        } as const

        const bottleneck = getBottleneck(item)
        const progressValue = Number(item.progress || 0)

        return (
            <div
                style={{
                    padding: 14,
                    border: '1px solid #f0f0f0',
                    borderRadius: 12,
                    background: '#fff'
                }}
            >
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <div>
                        <Text strong style={{ fontSize: 15 }}>
                            {item.name}
                        </Text>
                        <div style={{ marginTop: 6 }}>
                            <Tag color="geekblue">{item.program}</Tag>
                            <Tag>{item.departmentName || '—'}</Tag>
                            <Tag color={statusMap[s].color}>{statusMap[s].label}</Tag>
                        </div>
                    </div>

                    <div>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 12,
                                marginBottom: 6
                            }}
                        >
                            <Text type="secondary">Progress</Text>
                            <Text strong>{progressValue}%</Text>
                        </div>
                        <Progress percent={progressValue} size="small" />
                    </div>

                    <div>
                        <Text type="secondary">Facilitator</Text>
                        <div style={{ marginTop: 4 }}>
                            <Tag color={item.assigneeName === 'Unassigned' ? 'red' : 'default'}>
                                {item.assigneeName}
                            </Tag>
                        </div>
                    </div>

                    {bottleneck !== '—' && (
                        <div>
                            <Text type="secondary">Bottleneck</Text>
                            <div style={{ marginTop: 4 }}>
                                <Tag color="volcano">{bottleneck}</Tag>
                            </div>
                        </div>
                    )}
                </Space>
            </div>
        )
    }

    const upcomingNext7 = useMemo(() => {
        const start = dayjs().startOf('day')
        const end = dayjs().add(7, 'day').endOf('day')

        return filteredEvents
            .map(e => ({
                ...e,
                _t: e.time || dayjs(`${e.date}T${e.startTime || '00:00'}`)
            }))
            .filter((e: any) => e._t.isValid() && e._t.isAfter(start) && e._t.isBefore(end))
            .sort((a: any, b: any) => a._t.valueOf() - b._t.valueOf())
    }, [filteredEvents])

    const completionRate = useMemo(() => {
        if (!filteredLearners.length) return 0
        return Math.round((distribution.completed / filteredLearners.length) * 100)
    }, [distribution.completed, filteredLearners.length])

    const filterBar = (
        <Row gutter={[12, 12]} align="middle">
            <Col xs={24} md={16} lg={12}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Text strong>
                        <FilterOutlined style={{ marginRight: 8 }} />
                        Department Scope
                    </Text>
                </Space>
            </Col>
        </Row>
    )

    if (loading) {
        return (
            <div style={{ minHeight: '100vh' }}>
                <LoadingOverlay tip="Loading Dashboard" />
            </div>
        )
    }

    if (!isAllPrograms && !activeProgramId) {
        return (
            <div style={{ padding: 24 }}>
                <MotionCard>
                    <Result
                        status="info"
                        title="No active program selected"
                        subTitle="Select a program from the global program filter to view the training dashboard."
                    />
                </MotionCard>
            </div>
        )
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Training Academy | Smart Incubation</title>
            </Helmet>

            <>
                <div style={{ marginBottom: 15 }}>
                    <InterventionMetricsGrid metrics={interventionMetrics} />
                </div>

                <MotionCard style={{ marginBottom: 10 }}>
                    {filteredLearners.length === 0 ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No interventions found for this department scope and project."
                        />
                    ) : isMobile ? (
                        <List
                            dataSource={filteredLearners}
                            rowKey="id"
                            split={false}
                            pagination={{
                                pageSize: 5,
                                hideOnSinglePage: true
                            }}
                            renderItem={item => (
                                <List.Item
                                    style={{
                                        paddingInline: 0,
                                        border: 'none'
                                    }}
                                >
                                    {renderLearnerCard(item)}
                                </List.Item>
                            )}
                        />
                    ) : (
                        <Table
                            columns={columns}
                            dataSource={filteredLearners}
                            rowKey="id"
                            pagination={{
                                pageSize: 5,
                                showSizeChanger: false,
                                position: ['bottomCenter']
                            }}
                            scroll={{ x: 'max-content' }}
                        />
                    )}
                </MotionCard>

                <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4 }}
                            style={{ height: '100%' }}
                        >
                            <MotionCard style={{ height: '100%' }}>
                                {(donutChartOptions.series?.[0] as any)?.data?.length ? (
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        options={donutChartOptions}
                                    />
                                ) : (
                                    <div
                                        style={{
                                            minHeight: 320,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            textAlign: 'center'
                                        }}
                                    >
                                        <Text
                                            strong
                                            style={{
                                                fontSize: 34,
                                                lineHeight: 1
                                            }}
                                        >
                                            0
                                        </Text>

                                        <Text
                                            type="secondary"
                                            style={{ marginTop: 8 }}
                                        >
                                            Interventions
                                        </Text>
                                    </div>
                                )}
                            </MotionCard>
                        </motion.div>
                    </Col>

                    <Col xs={24} md={12}>
                        <UpcomingAppointmentsCard
                            showAddEvent
                            departmentId={
                                selectedDepartmentScope === 'all'
                                    ? null
                                    : selectedDepartmentScope
                            }
                            departmentIds={
                                selectedDepartmentScope === 'all'
                                    ? appointmentDepartmentScopeIds
                                    : undefined
                            }
                            programId={activeProgramId}
                            daysAhead={7}
                            limit={5}
                            onViewCalendar={() => setCalendarVisible(true)}
                            onEventCreated={() => {
                                fetchData()
                            }}
                        />
                    </Col>
                </Row>
            </>

            <AppointmentsCalendarModal
                open={calendarVisible}
                onClose={() => setCalendarVisible(false)}
                appointments={filteredAppointments}
                onAppointmentClick={appointment => {
                    setSelectedAppointment(appointment)
                    setDetailsModalVisible(true)
                }}
            />

            <AppointmentDetailsModal
                open={detailsModalVisible}
                onClose={() => setDetailsModalVisible(false)}
                appointment={selectedAppointment}
            />

        </div>
    )
}

export default TrainingDashboard
