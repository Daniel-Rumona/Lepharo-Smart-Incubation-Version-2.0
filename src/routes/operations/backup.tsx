import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Typography,
    Space,
    Layout,
    Table,
    Empty,
    Tooltip,
    Segmented,
} from 'antd'
import { TeamOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import {
    collection,
    getDoc,
    getDocs,
    doc,
    where,
    query
} from 'firebase/firestore'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import drilldown from 'highcharts/modules/drilldown'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import AppointmentsCalendarModal from '@/components/modals/AppointmentsCalender'
import AppointmentDetailsModal from '@/components/modals/AppointmentDetails'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import InterventionMetricsGrid from '@/components/dashboards/metrics/InterventionMetricsGrid'
import { fetchAppointments } from '@/services/appointmentService'
import { summarizeAssignedInterventions } from '@/services/interventionMetricsService'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import type { AssignmentLifecycleKey } from '@/services/assignmentLifecycleService'

if (typeof drilldown === 'function') drilldown(Highcharts)

dayjs.extend(isBetween)
const { Text } = Typography

/* ----------------------------- types ------------------------------ */
type AssignedIntervention = {
    id: string
    participantId: string
    departmentId?: string
    status?: string
    assignmentStatus?: string
    participantAcceptanceStatus?: string
    assigneeAcceptanceStatus?: string
    participantCompletionStatus?: string
    beneficiaryCompletionStatus?: string
    assigneeCompletionStatus?: string
    completionStatus?: string
    areaOfSupport?: string
    branchId?: string
    assignedBranchId?: string
    branch?: { id?: string; name?: string } | string
    branchName?: string
    assignedBranch?: { id?: string; name?: string } | string
    participantID?: string
    participant?: { id?: string } | string
    incubateeId?: string
    applicationId?: string
    assigneeId?: string
    interventionTitle?: string
    programId?: string
}

type DepartmentDoc = { id: string; name?: string; departmentName?: string }
type ApplicationDoc = {
    participantId?: string
    participantID?: string
    participant?: { id?: string } | string
    incubateeId?: string
    uid?: string
    branchId?: string
    assignedBranchId?: string
    branch?: { id?: string; name?: string } | string
    branchName?: string
    assignedBranch?: { id?: string; name?: string } | string
    programId?: string
}
type BranchDoc = { id: string; name?: string; branchName?: string }
type BranchReference = { id: string; name: string }
type ProgramDoc = {
    assignedBranch?: { id?: string; name?: string } | string
    assignedBranchId?: string
    branchId?: string
    branchName?: string
    isMultiBranch?: boolean
    supportedBranchIds?: string[]
    assignedBranches?: Array<{ id?: string; name?: string } | string>
}

type EventItem = {
    id: string
    title: string
    time?: any
    date?: string
    type?: string
    format?: 'virtual' | 'in-person' | string
    link?: string
    location?: string
    department?: string
    departmentName?: string
}

type DeptRow = {
    key: string
    department: string
    counts: Record<string, number>
    total: number
}

type EnrichedIntervention = AssignedIntervention & {
    departmentName: string
    branchName: string
}

type BranchPerformanceMetric = 'interventions' | 'reach'

/* ------------------------ status helpers -------------------------- */
const STATUS_COLORS: Record<AssignmentLifecycleKey, string> = {
    assigned: '#1677ff',
    'awaiting-participant-acceptance': '#fa8c16',
    'in-delivery': '#2f54eb',
    'awaiting-participant-confirmation': '#722ed1',
    'participant-rejected': '#d4380d',
    completed: '#52c41a',
    'needs-reassignment': '#eb2f96',
    'participant-declined': '#ff7875',
    cancelled: '#f5222d'
}

const STATUS_ORDER: AssignmentLifecycleKey[] = [
    'assigned',
    'awaiting-participant-acceptance',
    'in-delivery',
    'awaiting-participant-confirmation',
    'participant-rejected',
    'completed',
    'needs-reassignment',
    'participant-declined',
    'cancelled'
]

const formatStatusLabel = (status?: string): string => {
    const normalized = String(status || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-')

    const map: Record<string, string> = {
        assigned: 'Assigned',
        'awaiting-participant-acceptance': 'Awaiting SME Acceptance',
        'in-delivery': 'In Delivery',
        'awaiting-participant-confirmation': 'Awaiting SME Confirmation',
        'participant-rejected': 'SME Rejected Completion',
        completed: 'Completed',
        'needs-reassignment': 'Needs Reassignment',
        'participant-declined': 'SME Declined',
        cancelled: 'Cancelled'
    }

    return map[normalized] || 'Assigned'
}

const normalizeStatus = (record: AssignedIntervention): AssignmentLifecycleKey =>
    resolveAssignmentLifecycle({
        ...record,
        // Older records stored the assignment lifecycle in `status`.
        assignmentStatus: record.assignmentStatus || record.status,
        participantAcceptanceStatus:
            record.participantAcceptanceStatus ||
            (['in-progress', 'in_progress'].includes(
                String(record.assignmentStatus || record.status || '').toLowerCase()
            )
                ? 'accepted'
                : undefined),
        participantCompletionStatus:
            record.participantCompletionStatus ||
            record.beneficiaryCompletionStatus ||
            (['confirmed', 'completed'].includes(String(record.completionStatus || '').toLowerCase())
                ? record.completionStatus
                : undefined),
        assigneeCompletionStatus:
            record.assigneeCompletionStatus ||
            (['submitted', 'done', 'completed'].includes(String(record.completionStatus || '').toLowerCase())
                ? record.completionStatus
                : undefined)
    }).key

const getParticipantId = (record: AssignedIntervention | ApplicationDoc): string => {
    const participant = record.participant
    return String(
        record.participantId ||
        record.participantID ||
        (typeof participant === 'string' ? participant : participant?.id) ||
        record.incubateeId ||
        ('uid' in record ? record.uid : '') ||
        ''
    ).trim()
}

const getBranchReference = (record: AssignedIntervention | ApplicationDoc) => {
    const branch = record.branch
    const assignedBranch = record.assignedBranch
    const id = String(
        record.branchId ||
        record.assignedBranchId ||
        (typeof branch === 'string' ? branch : branch?.id) ||
        (typeof assignedBranch === 'string' ? assignedBranch : assignedBranch?.id) ||
        ''
    ).trim()
    const name = String(
        record.branchName ||
        (typeof branch === 'object' ? branch?.name : '') ||
        (typeof assignedBranch === 'object' ? assignedBranch?.name : '') ||
        ''
    ).trim()

    return { id, name }
}

const getProgramBranchReference = (program: ProgramDoc): BranchReference => {
    const assignedBranch = program.assignedBranch
    const assignedBranches = Array.isArray(program.assignedBranches)
        ? program.assignedBranches
        : []
    const candidates = [
        program.assignedBranchId,
        program.branchId,
        typeof assignedBranch === 'string' ? assignedBranch : assignedBranch?.id,
        ...(program.supportedBranchIds || []),
        ...assignedBranches.map(branch => typeof branch === 'string' ? branch : branch?.id)
    ]
        .map(value => String(value || '').trim())
        .filter(Boolean)
    const uniqueIds = Array.from(new Set(candidates))

    // A programme-level relationship is an exact branch source only when it
    // resolves to one branch. Multi-branch programmes require an application.
    if (program.isMultiBranch || uniqueIds.length !== 1) return { id: '', name: '' }

    const assignedName = typeof assignedBranch === 'object' ? assignedBranch?.name : ''
    const matchingAssignedBranch = assignedBranches.find(branch =>
        typeof branch === 'object' && branch?.id === uniqueIds[0]
    )
    return {
        id: uniqueIds[0],
        name: String(
            assignedName ||
            (typeof matchingAssignedBranch === 'object' ? matchingAssignedBranch?.name : '') ||
            program.branchName ||
            ''
        ).trim()
    }
}

/* --------- stacked row bar for department breakdown cell ---------- */
const StackedRowBar: React.FC<{
    counts: Record<string, number>
    statuses?: AssignmentLifecycleKey[]
}> = ({ counts, statuses = STATUS_ORDER }) => {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0)

    if (!total) {
        return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No data' />
    }

    return (
        <div
            style={{
                display: 'flex',
                height: 28,
                minWidth: '100%',
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid #f0f0f0'
            }}
        >
            {statuses.map(status => {
                const value = counts[status] || 0
                if (!value) return null
                const pct = (value / total) * 100

                return (
                    <Tooltip
                        key={status}
                        title={`${formatStatusLabel(status)}: ${value}`}
                    >
                        <div
                            style={{
                                width: `${pct}%`,
                                background: STATUS_COLORS[status] || '#999',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 10,
                                color: '#fff',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {pct > 12 ? value : ''}
                        </div>
                    </Tooltip>
                )
            })}
        </div>
    )
}

export const OperationsDashboard: React.FC = () => {
    const { activeProgramId } = useActiveProgramId()

    /* ----------------------------- state ---------------------------- */
    const [assigned, setAssigned] = useState<AssignedIntervention[]>([])
    const [totalRequired, setTotalRequired] = useState(0)
    const [deptMap, setDeptMap] = useState<Record<string, string>>({})
    const [appMap, setAppMap] = useState<
        Record<string, BranchReference & { programId: string }>
    >({})
    const [branchMap, setBranchMap] = useState<Record<string, string>>({})
    const [programBranchMap, setProgramBranchMap] = useState<Record<string, BranchReference>>({})
    const [branchPerformanceMetric, setBranchPerformanceMetric] =
        useState<BranchPerformanceMetric>('interventions')

    const [appointments, setAppointments] = useState<any[]>([])
    const [calendarVisible, setCalendarVisible] = useState(false)
    const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null)
    const [appointmentDetailsVisible, setAppointmentDetailsVisible] = useState(false)


    /* ---------------------- fetch core datasets --------------------- */
    useEffect(() => {
        const run = async () => {
            try {
                const ivQuery = query(
                    collection(db, 'assignedInterventions'),
                    ...(activeProgramId && activeProgramId !== 'all'
                        ? [where('programId', '==', activeProgramId)]
                        : [])
                )

                const ivSnap = await getDocs(ivQuery)
                const ivs: AssignedIntervention[] = ivSnap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))
                setAssigned(ivs)

                const depSnap = await getDocs(
                    collection(db, 'departments')
                )
                const depNameMap: Record<string, string> = {}
                depSnap.docs.forEach(d => {
                    const data = d.data() as DepartmentDoc
                    depNameMap[d.id] = data.name || data.departmentName || 'Unspecified'
                })
                setDeptMap(depNameMap)

                const programDocs = activeProgramId && activeProgramId !== 'all'
                    ? [await getDoc(doc(db, 'programs', activeProgramId))]
                    : (await getDocs(
                        collection(db, 'programs')
                    )).docs
                const nextProgramBranchMap: Record<string, BranchReference> = {}
                programDocs.forEach(programDoc => {
                    if (!programDoc.exists()) return
                    const branch = getProgramBranchReference(programDoc.data() as ProgramDoc)
                    if (branch.id || branch.name) nextProgramBranchMap[programDoc.id] = branch
                })
                setProgramBranchMap(nextProgramBranchMap)

                const appQuery = query(
                    collection(db, 'applications'),
                    where('applicationStatus', '==', 'accepted'),
                    ...(activeProgramId && activeProgramId !== 'all'
                        ? [where('programId', '==', activeProgramId)]
                        : [])
                )

                const appSnap = await getDocs(appQuery)
                const requiredCount = appSnap.docs.reduce((total, snapshot) => {
                    const data = snapshot.data() as any
                    return total + (Array.isArray(data?.interventions?.required)
                        ? data.interventions.required.length
                        : 0)
                }, 0)
                setTotalRequired(requiredCount)
                const participantBranchMap: Record<
                    string,
                    BranchReference & { programId: string }
                > = {}
                appSnap.docs.forEach(d => {
                    const a = d.data() as ApplicationDoc
                    const participantId = getParticipantId(a)
                    const branch = getBranchReference(a)
                    const applicationProgramBranch = a.programId
                        ? nextProgramBranchMap[a.programId]
                        : undefined
                    const resolvedBranch = branch.id || branch.name
                        ? branch
                        : applicationProgramBranch
                    if (!resolvedBranch?.id && !resolvedBranch?.name) return

                    const reference = {
                        id: resolvedBranch.id,
                        name: resolvedBranch.name,
                        programId: String(a.programId || '').trim()
                    }
                    // Some legacy assignments reference the application document
                    // while current assignments reference the participant document.
                    participantBranchMap[d.id] = reference
                    if (participantId) participantBranchMap[participantId] = reference
                })
                setAppMap(participantBranchMap)

                const brSnap = await getDocs(
                    collection(db, 'branches')
                )
                const branchNameMap: Record<string, string> = {}
                brSnap.docs.forEach(d => {
                    const b = d.data() as BranchDoc
                    branchNameMap[d.id] = b.name || b.branchName || 'Unknown Branch'
                })
                setBranchMap(branchNameMap)

                const appointmentRows = await fetchAppointments({
                    programId: activeProgramId
                })
                setAppointments(appointmentRows)
            } catch (e) {
                console.error('Error loading dashboard datasets:', e)
                setAppointments([])
            }
        }

        run()
    }, [activeProgramId])


    /* ----------------------- enrich interventions ------------------- */
    const enriched = useMemo<EnrichedIntervention[]>(() => {
        return assigned.map(x => {
            const departmentName =
                (x.departmentId && deptMap[x.departmentId]) ||
                x.areaOfSupport ||
                'Unspecified'

            const participantId = getParticipantId(x)
            const directBranch = getBranchReference(x)
            const applicationBranch =
                (participantId ? appMap[participantId] : undefined) ||
                (x.applicationId ? appMap[x.applicationId] : undefined)
            const programBranch = x.programId ? programBranchMap[x.programId] : undefined
            const resolvedBranch = programBranch || applicationBranch || directBranch
            const branchId = resolvedBranch?.id || ''
            const branchName =
                (branchId && branchMap[branchId]) ||
                resolvedBranch?.name ||
                (branchId && Object.values(branchMap).includes(branchId) ? branchId : '') ||
                'Unknown Branch'

            return {
                ...x,
                departmentName,
                branchName
            }
        })
    }, [assigned, deptMap, appMap, branchMap, programBranchMap])

    /* ---------------------------- metrics --------------------------- */
    const interventionMetrics = summarizeAssignedInterventions(enriched, totalRequired || enriched.length)

    /* -------------------- branch multi-level drilldown ------------- */
    const branchBreakdown = useMemo(() => {
        const map: Record<
            string,
            {
                total: number
                departments: Record<
                    string,
                    {
                        total: number
                        statuses: Record<string, number>
                    }
                >
            }
        > = {}

        enriched.forEach(item => {
            const branch = item.branchName || 'Unknown Branch'
            const department = item.departmentName || 'Unspecified'
            const status = normalizeStatus(item)

            if (!map[branch]) {
                map[branch] = { total: 0, departments: {} }
            }

            if (!map[branch].departments[department]) {
                map[branch].departments[department] = {
                    total: 0,
                    statuses: {}
                }

                STATUS_ORDER.forEach(s => {
                    map[branch].departments[department].statuses[s] = 0
                })
            }

            map[branch].total += 1
            map[branch].departments[department].total += 1
            map[branch].departments[department].statuses[status] =
                (map[branch].departments[department].statuses[status] || 0) + 1
        })

        return map
    }, [enriched])

    const branchReachBreakdown = useMemo(() => {
        const map: Record<
            string,
            {
                smeIds: Set<string>
                departments: Record<
                    string,
                    {
                        smeIds: Set<string>
                        statuses: Record<string, Set<string>>
                    }
                >
            }
        > = {}

        enriched.forEach(item => {
            const participantId = getParticipantId(item)
            if (!participantId) return

            const branch = item.branchName || 'Unknown Branch'
            const department = item.departmentName || 'Unspecified'
            const status = normalizeStatus(item)

            if (!map[branch]) {
                map[branch] = { smeIds: new Set(), departments: {} }
            }
            if (!map[branch].departments[department]) {
                map[branch].departments[department] = {
                    smeIds: new Set(),
                    statuses: Object.fromEntries(
                        STATUS_ORDER.map(key => [key, new Set<string>()])
                    )
                }
            }

            map[branch].smeIds.add(participantId)
            map[branch].departments[department].smeIds.add(participantId)
            map[branch].departments[department].statuses[status].add(participantId)
        })

        return map
    }, [enriched])

    const branchCategories = useMemo(
        () => Object.keys(branchBreakdown),
        [branchBreakdown]
    )

    const branchTopLevelData = useMemo(() => {
        return branchCategories.map(branch => ({
            name: branch,
            y: branchPerformanceMetric === 'reach'
                ? branchReachBreakdown[branch]?.smeIds.size || 0
                : branchBreakdown[branch]?.total || 0,
            drilldown: `branch::${branch}`
        }))
    }, [branchCategories, branchBreakdown, branchPerformanceMetric, branchReachBreakdown])

    const branchToDepartmentSeries = useMemo<Highcharts.DrilldownSeriesOptions[]>(() => {
        return branchCategories.map(branch => {
            const departments = branchBreakdown[branch]?.departments || {}
            const departmentNames = Object.keys(departments)

            return {
                type: 'column',
                id: `branch::${branch}`,
                name: `${branch} - Departments`,
                data: departmentNames.map(department => ({
                    name: department,
                    y: branchPerformanceMetric === 'reach'
                        ? branchReachBreakdown[branch]?.departments[department]?.smeIds.size || 0
                        : departments[department]?.total || 0,
                    drilldown: `branch::${branch}::dept::${department}`
                })) as any[]
            } as Highcharts.DrilldownSeriesColumnOptions
        })
    }, [branchCategories, branchBreakdown, branchPerformanceMetric, branchReachBreakdown])

    const departmentToStatusSeries = useMemo<Highcharts.DrilldownSeriesOptions[]>(() => {
        const out: Highcharts.DrilldownSeriesOptions[] = []

        branchCategories.forEach(branch => {
            const departments = branchBreakdown[branch]?.departments || {}

            Object.keys(departments).forEach(department => {
                const statusCounts = departments[department]?.statuses || {}
                const statusReach: Record<string, Set<string>> =
                    branchReachBreakdown[branch]?.departments[department]?.statuses || {}

                out.push({
                    type: 'column',
                    id: `branch::${branch}::dept::${department}`,
                    name: `${department} - Status Breakdown`,
                    data: STATUS_ORDER
                        .filter(status => (
                            branchPerformanceMetric === 'reach'
                                ? statusReach[status]?.size || 0
                                : statusCounts[status] || 0
                        ) > 0)
                        .map(status => ({
                            name: formatStatusLabel(status),
                            y: branchPerformanceMetric === 'reach'
                                ? statusReach[status]?.size || 0
                                : statusCounts[status] || 0,
                            color: STATUS_COLORS[status] || '#999'
                        })) as any[]
                } as Highcharts.DrilldownSeriesColumnOptions)
            })
        })

        return out
    }, [branchCategories, branchBreakdown, branchPerformanceMetric, branchReachBreakdown])

    const branchPerformanceOptions: Highcharts.Options = {
        chart: {
            type: 'column',
            height: 430
        },
        title: {
            text: branchPerformanceMetric === 'reach'
                ? 'Branch Performance - Unique SMEs Reached'
                : 'Branch Performance - Total Interventions'
        },
        xAxis: {
            type: 'category',
            title: { text: 'Branch / Department / Status' }
        },
        yAxis: {
            min: 0,
            title: {
                text: branchPerformanceMetric === 'reach'
                    ? 'Unique SMEs Reached'
                    : 'Intervention Count'
            }
        },
        legend: {
            enabled: false
        },
        plotOptions: {
            series: {
                borderWidth: 0,
                cursor: 'pointer',
                dataLabels: {
                    enabled: true,
                    format: '{point.y}'
                }
            },
            column: {
                borderRadius: 6
            }
        },
        tooltip: {
            headerFormat: '<span style="font-size:11px">{series.name}</span><br/>',
            pointFormat: '<span>{point.name}</span>: <b>{point.y}</b>'
        },
        series: [
            {
                type: 'column',
                name: branchPerformanceMetric === 'reach'
                    ? 'Unique SMEs Reached'
                    : 'Total Interventions',
                data: branchTopLevelData as any[],
                color: '#1677ff'
            }
        ],
        drilldown: {
            breadcrumbs: {
                position: { align: 'right' }
            },
            series: [...branchToDepartmentSeries, ...departmentToStatusSeries]
        },
        credits: { enabled: false }
    }

    const StatusLegend: React.FC<{ statuses?: AssignmentLifecycleKey[] }> = ({ statuses }) => {
        const keys = statuses ?? STATUS_ORDER

        return (
            <Space wrap size='small' style={{ marginBottom: 12 }}>
                {keys.map(k => (
                    <span
                        key={k}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                        <span
                            style={{
                                width: 12,
                                height: 12,
                                borderRadius: 3,
                                background: STATUS_COLORS[k],
                                display: 'inline-block'
                            }}
                        />
                        <Text type='secondary'>
                            {formatStatusLabel(k)}
                        </Text>
                    </span>
                ))}
            </Space>
        )
    }

    /* -------------------- department breakdown table ---------------- */
    const deptRows: DeptRow[] = useMemo(() => {
        const map: Record<string, { counts: Record<string, number>; total: number }> = {}

        enriched.forEach(d => {
            const dept = d.departmentName || 'Unspecified Department'
            const status = normalizeStatus(d)

            if (!map[dept]) {
                map[dept] = {
                    counts: Object.fromEntries(STATUS_ORDER.map(key => [key, 0])),
                    total: 0
                }
            }

            map[dept].counts[status] = (map[dept].counts[status] || 0) + 1
            map[dept].total += 1
        })

        return Object.entries(map).map(([department, agg]) => ({
            key: department,
            department,
            counts: agg.counts,
            total: agg.total
        }))
    }, [enriched])

    const deptColumns = [
        {
            title: 'Department',
            dataIndex: 'department',
            key: 'department',
            render: (v: string) => <Text strong>{v}</Text>
        },
        {
            title: 'Status',
            key: 'bar',
            render: (_: any, row: DeptRow) => (
                <StackedRowBar
                    counts={row.counts}
                    statuses={STATUS_ORDER}
                />
            )
        },
        {
            title: 'Total',
            dataIndex: 'total',
            key: 'total',
            align: 'right' as const
        }
    ]


    /* ------------------------------ UI ------------------------------ */
    return (
        <Layout style={{ padding: "5px 24px" }}>
            <Helmet>
                <title>Operations Dashboard</title>
            </Helmet>

            <div style={{ marginBottom: 24 }}>
                <InterventionMetricsGrid metrics={interventionMetrics} />
            </div>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col span={24}>
                    <MotionCard>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                marginBottom: 12
                            }}
                        >
                            <Segmented
                                value={branchPerformanceMetric}
                                options={[
                                    { label: 'Interventions', value: 'interventions' },
                                    { label: 'SME Reach', value: 'reach' }
                                ]}
                                onChange={value =>
                                    setBranchPerformanceMetric(value as BranchPerformanceMetric)
                                }
                            />
                        </div>
                        {branchCategories.length === 0 ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description='No interventions found by branch.'
                            />
                        ) : (
                            <HighchartsReact
                                key={branchPerformanceMetric}
                                highcharts={Highcharts}
                                options={branchPerformanceOptions}
                            />
                        )}
                    </MotionCard>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} lg={12}>
                    <MotionCard
                        title={
                            <Space>
                                <TeamOutlined />
                                <span>Department Breakdown — Intervention Status</span>
                            </Space>
                        }
                    >
                        <StatusLegend
                            statuses={STATUS_ORDER}
                        />

                        {deptRows.length === 0 ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description='No interventions found.'
                            />
                        ) : (
                            <Table
                                rowKey='key'
                                dataSource={deptRows}
                                columns={deptColumns}
                                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                            />
                        )}
                    </MotionCard>
                </Col>

                <Col xs={24} lg={12}>
                    <UpcomingAppointmentsCard
                        programId={activeProgramId}
                        daysAhead={7}
                        limit={6}
                        onViewCalendar={() => setCalendarVisible(true)}
                    />
                </Col>
            </Row>


            <AppointmentsCalendarModal
                open={calendarVisible}
                onClose={() => setCalendarVisible(false)}
                appointments={appointments}
                onAppointmentClick={appointment => {
                    setSelectedAppointment(appointment)
                    setAppointmentDetailsVisible(true)
                }}
            />

            <AppointmentDetailsModal
                open={appointmentDetailsVisible}
                onClose={() => setAppointmentDetailsVisible(false)}
                appointment={selectedAppointment}
            />
        </Layout>
    )
}

export default OperationsDashboard
