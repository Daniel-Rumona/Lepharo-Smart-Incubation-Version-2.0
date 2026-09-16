import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Modal,
    Row,
    Col,
    Layout,
    Empty,
    Space,
    Skeleton,
    Tag,
    Typography,
    Tooltip,
    message,
    theme
} from 'antd'
import { BellOutlined, CheckCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import {
    Timestamp,
    addDoc,
    arrayUnion,
    collection,
    getDoc,
    getDocs,
    doc,
    where,
    query,
    updateDoc
} from 'firebase/firestore'
import dayjs from 'dayjs'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import drilldown from 'highcharts/modules/drilldown'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import AppointmentsCalendarModal from '@/components/modals/AppointmentsCalender'
import AppointmentDetailsModal from '@/components/modals/AppointmentDetails'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import InterventionMetricsGrid from '@/components/dashboards/metrics/InterventionMetricsGrid'
import type { DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import { fetchAppointments } from '@/services/appointmentService'
import { summarizeAssignedInterventions } from '@/services/interventionMetricsService'
import DepartmentInterventionStatusCard, {
    INTERVENTION_STATUS_COLORS,
    INTERVENTION_STATUS_ORDER,
    formatInterventionStatusLabel,
    resolveInterventionStatus
} from '@/components/dashboards/metrics/DepartmentBreakdown'
import DepartmentMonthlyUploadStatusCard from '@/components/dashboards/metrics/DepartmentMonthlyUploadStatusCard'
import { useDashboardDateRange } from '@/lib/useDashboardDateRange'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import ResolveQueryModal from '@/components/modals/ResolveQueryModal'
import { workflowQueryService, type WorkflowQueryView } from '@/services/workflowQueryService'

const { Text } = Typography
const { useToken } = theme

if (typeof drilldown === 'function') drilldown(Highcharts)

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
    participantName?: string
    beneficiaryName?: string
    smeName?: string
    incubateeId?: string
    applicationId?: string
    assigneeId?: string
    interventionTitle?: string
    programId?: string
    assignedAt?: any
    assignedAtResolved?: any
    createdAt?: any
    startDate?: any
    dueDate?: any
}

type DepartmentDoc = {
    id: string
    name?: string
    departmentName?: string
    interventionsDepartment?: boolean
}
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



type EnrichedIntervention = AssignedIntervention & {
    departmentName: string
    branchName: string
}

type BranchPerformanceMetric = 'interventions' | 'reach'

type SubmissionRecord = {
    month?: string
    department?: string
    departmentName?: string
    interventions?: Array<{ department?: string; departmentName?: string }>
}


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

const DATA_FETCH_TIMEOUT_MS = 20000
const DATA_FETCH_MAX_ATTEMPTS = 2
const DATA_FETCH_RETRY_DELAY_MS = 1500

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Firestore reads have no built-in timeout, so a stalled query (bad network,
// a momentarily offline client) would otherwise leave the dashboard on its
// loading skeleton forever. This bounds the wait and gives the caller a
// rejected promise to react to instead.
const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} took longer than ${ms / 1000}s`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}

export const OperationsDashboard: React.FC = () => {
    const { activeProgramId } = useActiveProgramId()
    const { range: dateRange, label: periodLabel, withinRange } = useDashboardDateRange()
    const { user } = useFullIdentity() as any
    const { token } = useToken()

    /* ----------------------------- state ---------------------------- */
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [reloadToken, setReloadToken] = useState(0)
    const [assigned, setAssigned] = useState<AssignedIntervention[]>([])
    const [totalRequired, setTotalRequired] = useState(0)
    const [deptMap, setDeptMap] = useState<Record<string, string>>({})
    const [interventionDeptIds, setInterventionDeptIds] = useState<Set<string>>(new Set())
    const [appMap, setAppMap] = useState<
        Record<string, BranchReference & { programId: string }>
    >({})
    const [branchMap, setBranchMap] = useState<Record<string, string>>({})
    const [programBranchMap, setProgramBranchMap] = useState<Record<string, BranchReference>>({})
    const [branchPerformanceMetric, setBranchPerformanceMetric] =
        useState<BranchPerformanceMetric>('interventions')

    const [monthlyMovSubmissions, setMonthlyMovSubmissions] = useState<SubmissionRecord[]>([])
    const [workflowQueries, setWorkflowQueries] = useState<WorkflowQueryView[]>([])
    const [queriesLoading, setQueriesLoading] = useState(true)
    const [queriesModalOpen, setQueriesModalOpen] = useState(false)
    const [resolvingQuery, setResolvingQuery] = useState<WorkflowQueryView | null>(null)
    const [remindingQueryId, setRemindingQueryId] = useState<string | null>(null)

    const [appointments, setAppointments] = useState<any[]>([])
    const [calendarVisible, setCalendarVisible] = useState(false)
    const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null)
    const [appointmentDetailsVisible, setAppointmentDetailsVisible] = useState(false)


    /* ---------------------- fetch core datasets --------------------- */
    useEffect(() => {
        const run = async () => {
            setLoading(true)
            setLoadError(null)

            let lastError: unknown = null

            for (let attempt = 1; attempt <= DATA_FETCH_MAX_ATTEMPTS; attempt++) {
            try {
                const ivQuery = query(
                    collection(db, 'assignedInterventions'),
                    ...(activeProgramId && activeProgramId !== 'all'
                        ? [where('programId', '==', activeProgramId)]
                        : [])
                )

                const movQuery = query(
                    collection(db, 'consolidatedMOVs'),
                    ...(activeProgramId && activeProgramId !== 'all'
                        ? [where('programId', '==', activeProgramId)]
                        : [])
                )

                const appQuery = query(
                    collection(db, 'applications'),
                    where('applicationStatus', '==', 'accepted'),
                    ...(activeProgramId && activeProgramId !== 'all'
                        ? [where('programId', '==', activeProgramId)]
                        : [])
                )

                const programsFetch = activeProgramId && activeProgramId !== 'all'
                    ? getDoc(doc(db, 'programs', activeProgramId)).then(snap => [snap])
                    : getDocs(collection(db, 'programs')).then(snap => snap.docs)

                // These reads are independent of each other, so they run
                // concurrently instead of waiting on one another in sequence.
                // Bounded by a timeout so a stalled query can't leave the
                // dashboard on its loading skeleton indefinitely.
                const [ivSnap, depSnap, movSnap, programDocs, appSnap, brSnap, appointmentRows] =
                    await withTimeout(
                        Promise.all([
                            getDocs(ivQuery),
                            getDocs(collection(db, 'departments')),
                            getDocs(movQuery),
                            programsFetch,
                            getDocs(appQuery),
                            getDocs(collection(db, 'branches')),
                            fetchAppointments({ programId: activeProgramId })
                        ]),
                        DATA_FETCH_TIMEOUT_MS,
                        'Dashboard data'
                    )

                const ivs: AssignedIntervention[] = ivSnap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))
                setAssigned(ivs)

                const depNameMap: Record<string, string> = {}
                const nextInterventionDeptIds = new Set<string>()
                depSnap.docs.forEach(d => {
                    const data = d.data() as DepartmentDoc
                    depNameMap[d.id] = data.name || data.departmentName || 'Unspecified'
                    if (data.interventionsDepartment === true) {
                        nextInterventionDeptIds.add(d.id)
                    }
                })
                setDeptMap(depNameMap)
                setInterventionDeptIds(nextInterventionDeptIds)

                const submittedPacks = movSnap.docs
                    .map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    }))
                    .filter(pack =>
                        Array.isArray((pack as any).approvals) &&
                        (pack as any).approvals.some(
                            (approval: any) =>
                                String(approval?.step || '').toLowerCase() === 'hod_submission'
                        )
                    )

                setMonthlyMovSubmissions(submittedPacks)

                const nextProgramBranchMap: Record<string, BranchReference> = {}
                programDocs.forEach(programDoc => {
                    if (!programDoc.exists()) return
                    const branch = getProgramBranchReference(programDoc.data() as ProgramDoc)
                    if (branch.id || branch.name) nextProgramBranchMap[programDoc.id] = branch
                })
                setProgramBranchMap(nextProgramBranchMap)

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

                const branchNameMap: Record<string, string> = {}
                brSnap.docs.forEach(d => {
                    const b = d.data() as BranchDoc
                    branchNameMap[d.id] = b.name || b.branchName || 'Unknown Branch'
                })
                setBranchMap(branchNameMap)

                setAppointments(appointmentRows)
                lastError = null
                break
            } catch (e) {
                lastError = e
                console.error(
                    `Error loading dashboard datasets (attempt ${attempt}/${DATA_FETCH_MAX_ATTEMPTS}):`,
                    e
                )
                if (attempt < DATA_FETCH_MAX_ATTEMPTS) {
                    await delay(DATA_FETCH_RETRY_DELAY_MS)
                }
            }
            }

            if (lastError) {
                setAppointments([])
                setMonthlyMovSubmissions([])
                setLoadError(
                    lastError instanceof Error
                        ? lastError.message
                        : 'Failed to load dashboard data.'
                )
            }

            setLoading(false)
        }

        run()
    }, [activeProgramId, reloadToken])

    useEffect(() => {
        let cancelled = false
        setQueriesLoading(true)

        workflowQueryService.list(
            activeProgramId && activeProgramId !== 'all'
                ? { programId: activeProgramId }
                : {}
        )
            .then(rows => {
                if (!cancelled) setWorkflowQueries(rows)
            })
            .catch(error => {
                console.error('Error loading workflow queries:', error)
                if (!cancelled) setWorkflowQueries([])
            })
            .finally(() => {
                if (!cancelled) setQueriesLoading(false)
            })

        return () => { cancelled = true }
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

    const departmentNames = useMemo(
        () =>
            Array.from(
                new Set(
                    Object.entries(deptMap)
                        .filter(([id]) => interventionDeptIds.has(id))
                        .map(([, name]) => String(name || '').trim())
                        .filter(name => name && name !== 'Unspecified')
                )
            ).sort((a, b) =>
                a.localeCompare(b, undefined, { sensitivity: 'base' })
            ),
        [deptMap, interventionDeptIds]
    )

    /* ---------------------------- metrics --------------------------- */
    const periodInterventions = useMemo(
        () => enriched.filter(intervention =>
            withinRange(
                intervention.assignedAtResolved ||
                intervention.assignedAt ||
                intervention.createdAt ||
                intervention.startDate
            )
        ),
        [enriched, withinRange]
    )

    // Required remains the programme-wide obligation. The operational tiles
    // describe only assignments made within the topbar reporting period.
    const interventionMetrics = summarizeAssignedInterventions(
        periodInterventions,
        totalRequired || enriched.length
    )

    const openQueries = useMemo(
        () => workflowQueries.filter(queryItem =>
            !['resolved', 'cancelled'].includes(String(queryItem.status || '').toLowerCase()) &&
            withinRange(queryItem.updatedAt || queryItem.createdAt)
        ),
        [withinRange, workflowQueries]
    )

    const queryMetric = useMemo<DashboardMetric[]>(() => {
        // Zero queries is a good state, not a dashboard metric that needs a
        // permanent empty tile. The four intervention metrics then reclaim
        // the row width.
        if (!queriesLoading && openQueries.length === 0) return []

        return [{
            key: 'open-queries',
            important: true,
            icon: <QuestionCircleOutlined style={{ fontSize: 20, color: '#d97706' }} />,
            iconBg: 'transparent',
            title: 'Open Queries',
            value: queriesLoading ? '...' : openQueries.length,
            subtitle: `Open ${periodLabel.toLowerCase()}`,
            onClick: () => setQueriesModalOpen(true)
        }]
    }, [openQueries.length, periodLabel, queriesLoading])

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
            const status = resolveInterventionStatus(item)

            if (!map[branch]) {
                map[branch] = { total: 0, departments: {} }
            }

            if (!map[branch].departments[department]) {
                map[branch].departments[department] = {
                    total: 0,
                    statuses: {}
                }

                INTERVENTION_STATUS_ORDER.forEach(s => {
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
            const status = resolveInterventionStatus(item)

            if (!map[branch]) {
                map[branch] = { smeIds: new Set(), departments: {} }
            }
            if (!map[branch].departments[department]) {
                map[branch].departments[department] = {
                    smeIds: new Set(),
                    statuses: Object.fromEntries(
                        INTERVENTION_STATUS_ORDER.map(key => [key, new Set<string>()])
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
                    data: INTERVENTION_STATUS_ORDER
                        .filter(status => (
                            branchPerformanceMetric === 'reach'
                                ? statusReach[status]?.size || 0
                                : statusCounts[status] || 0
                        ) > 0)
                        .map(status => ({
                            name: formatInterventionStatusLabel(status),
                            y: branchPerformanceMetric === 'reach'
                                ? statusReach[status]?.size || 0
                                : statusCounts[status] || 0,
                            color: INTERVENTION_STATUS_COLORS[status] || '#999'
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

    const interventionHealth = useMemo(() => {
        const rows = periodInterventions
        const completed = rows.filter(item => resolveInterventionStatus(item) === 'completed').length
        const inDelivery = rows.filter(
            item => resolveInterventionStatus(item) === 'in-delivery'
        ).length
        const awaitingConfirmation = rows.filter(
            item => resolveInterventionStatus(item) === 'awaiting-participant-confirmation'
        ).length
        const periodEnd = dateRange?.[1]?.endOf('day') || dayjs().endOf('day')
        const isPastPeriod = !!dateRange && periodEnd.isBefore(dayjs().startOf('day'))
        const overdue = rows.filter(item => {
            const due = item.dueDate
            return resolveInterventionStatus(item) !== 'completed' &&
                !!due &&
                dayjs(typeof due?.toDate === 'function' ? due.toDate() : due).isBefore(periodEnd, 'day')
        }).length
        const percent = rows.length ? Math.round((completed / rows.length) * 100) : 0
        return { total: rows.length, completed, inDelivery, awaitingConfirmation, overdue, isPastPeriod, percent }
    }, [dateRange, periodInterventions])

    const remindQueryResolver = async (queryItem: WorkflowQueryView) => {
        const resolverId = String(queryItem.resolverId || '').trim()
        if (!resolverId) return message.warning('This query has no assigned responder.')

        setRemindingQueryId(queryItem.id)
        try {
            const role = String(queryItem.resolver?.role || 'consultant').trim()
            const reminder = { sentAt: Timestamp.now(), sentById: String(user?.uid || user?.id || '') || null }
            await Promise.all([
                addDoc(collection(db, 'notifications'), {
                    type: 'workflow-query-reminder',
                    message: { [role]: 'Reminder: an open query needs your response.' },
                    recipientRoles: [role], recipientIds: [resolverId], workflowQueryId: queryItem.id,
                    programId: queryItem.programId, createdAt: new Date(), readBy: {}
                }),
                updateDoc(doc(db, 'workflowQueries', queryItem.id), {
                    lastReminderAt: reminder.sentAt, reminders: arrayUnion(reminder), updatedAt: Timestamp.now()
                })
            ])
            message.success('Reminder sent.')
        } catch (error) {
            console.error('Failed to send query reminder:', error)
            message.error('Could not send the reminder.')
        } finally {
            setRemindingQueryId(null)
        }
    }



    /* ------------------------------ UI ------------------------------ */
    return (
        <Layout style={{ minHeight: '100vh', background: '#fff', padding: 24 }}>
            <Helmet>
                <title>Operations Dashboard</title>
            </Helmet>

            {loadError && (
                <Alert
                    type='error'
                    showIcon
                    style={{ marginBottom: 24 }}
                    message='Some dashboard data failed to load'
                    description={loadError}
                    action={
                        <Button
                            size='small'
                            danger
                            loading={loading}
                            onClick={() => setReloadToken(token => token + 1)}
                        >
                            Retry
                        </Button>
                    }
                />
            )}

            <div style={{ marginBottom: 24 }}>
                <InterventionMetricsGrid
                    metrics={interventionMetrics}
                    periodLabel={periodLabel}
                    extraMetrics={queryMetric}
                />
            </div>

            {/*
             * Branch drilldown chart temporarily disabled.
             * Keep the drilldown calculations above so this can be restored later.
             *
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
            */}

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} lg={12}>
                    <DepartmentInterventionStatusCard
                        interventions={enriched}
                        loading={loading}
                    />

                    <div style={{ marginTop: 16 }}>
                        <DepartmentMonthlyUploadStatusCard
                            departments={departmentNames}
                            submissions={monthlyMovSubmissions}
                            loading={loading}
                            dateRange={dateRange}
                        />
                    </div>
                </Col>

                <Col xs={24} lg={12}>
                    <div style={{ marginBottom: 16 }}>
                        <MotionCard
                            title='Intervention progress health'
                            extra={<Text type='secondary'>{periodLabel}</Text>}
                        >
                            {loading ? (
                                <Row gutter={16} align='middle'>
                                    <Col xs={24} sm={10} style={{ textAlign: 'center' }}>
                                        <Skeleton.Avatar active size={104} shape='circle' />
                                    </Col>
                                    <Col xs={24} sm={14}>
                                        <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                            <Skeleton.Input active size='small' style={{ width: 190 }} />
                                            <Skeleton.Input active size='small' style={{ width: '100%' }} />
                                            <Skeleton.Input active size='small' style={{ width: 150 }} />
                                        </Space>
                                    </Col>
                                </Row>
                            ) : <Row gutter={16} align='middle'>
                                <Col xs={24} sm={10} style={{ textAlign: 'center' }}>
                                    <svg
                                        viewBox='0 0 120 70'
                                        width='176'
                                        height='103'
                                        role='img'
                                        aria-label={`${interventionHealth.percent}% intervention completion`}
                                    >
                                        <path d='M 10 60 A 50 50 0 0 1 110 60' fill='none' stroke={token.colorFillSecondary} strokeWidth='12' strokeLinecap='round' />
                                        <path
                                            d='M 10 60 A 50 50 0 0 1 110 60'
                                            fill='none'
                                            stroke={interventionHealth.percent >= 80 ? '#52c41a' : interventionHealth.percent >= 50 ? '#faad14' : '#ff4d4f'}
                                            strokeWidth='12'
                                            strokeLinecap='round'
                                            pathLength='100'
                                            strokeDasharray={`${interventionHealth.percent} 100`}
                                        />
                                        <text x='60' y='51' textAnchor='middle' fontSize='23' fontWeight='700' fill={token.colorText}>{interventionHealth.percent}%</text>
                                        <text x='60' y='66' textAnchor='middle' fontSize='9' fill={token.colorTextSecondary}>completed</text>
                                    </svg>
                                </Col>
                                <Col xs={24} sm={14}>
                                    <Space direction='vertical' size={4} style={{ width: '100%' }}>
                                        <Text strong>Completion in this reporting period</Text>
                                        <Text type='secondary'>
                                            {interventionHealth.completed} of {interventionHealth.total} assigned interventions completed.
                                        </Text>
                                        <Text type='secondary'>
                                            {interventionHealth.inDelivery} in delivery · {interventionHealth.awaitingConfirmation} awaiting SME confirmation.
                                        </Text>
                                        <Tag color={interventionHealth.isPastPeriod ? (interventionHealth.overdue ? 'error' : 'default') : interventionHealth.percent >= 80 ? 'success' : interventionHealth.percent >= 50 ? 'warning' : 'error'} style={{ width: 'fit-content', marginTop: 6 }}>
                                            {interventionHealth.isPastPeriod
                                                ? interventionHealth.overdue
                                                    ? `${interventionHealth.overdue} overdue at period end`
                                                    : 'Period closed'
                                                : interventionHealth.percent >= 80 ? 'On track' : interventionHealth.percent >= 50 ? 'Needs attention' : 'Action required'}
                                        </Tag>
                                    </Space>
                                </Col>
                            </Row>}
                        </MotionCard>
                    </div>

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

            <Modal
                open={queriesModalOpen}
                onCancel={() => setQueriesModalOpen(false)}
                footer={null}
                centered
                title={`Open queries · ${periodLabel}`}
                width={760}
            >
                {queriesLoading ? (
                    <Space direction='vertical' size={10} style={{ width: '100%' }}>
                        {Array.from({ length: 4 }).map((_, index) => (
                            <Skeleton key={index} active title={false} paragraph={{ rows: 2 }} />
                        ))}
                    </Space>
                ) : openQueries.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No open queries in this period.' />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {openQueries.map(queryItem => {
                            const sme = String(
                                (queryItem as any).participantName ||
                                (queryItem as any).beneficiaryName ||
                                ''
                            )
                            const openedAt = dayjs(queryItem.createdAt?.toDate?.() || queryItem.createdAt)
                            const daysOpen = openedAt.isValid() ? Math.max(0, dayjs().startOf('day').diff(openedAt.startOf('day'), 'day')) : null

                            return (
                                <div
                                    key={queryItem.id}
                                    style={{ padding: '12px 14px', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 12 }}
                                >
                                    <Space align='start' style={{ width: '100%', justifyContent: 'space-between' }}>
                                        <div style={{ minWidth: 0 }}>
                                            <Space size={6} wrap>
                                                <Text strong>{queryItem.queryMessage || queryItem.message}</Text>
                                                <Tag color='warning'>Open</Tag>
                                                {daysOpen !== null && <Tag>{daysOpen === 0 ? 'Opened today' : `${daysOpen} day${daysOpen === 1 ? '' : 's'} open`}</Tag>}
                                            </Space>
                                            {sme ? <Text type='secondary' style={{ display: 'block', marginTop: 5 }}>SME: {sme}</Text> : null}
                                            <Text type='secondary' style={{ display: 'block', marginTop: 2, fontSize: 12 }}>
                                                Opened {openedAt.isValid() ? openedAt.format('DD MMM YYYY') : 'date unavailable'} · Assigned to {queryItem.resolver?.name || queryItem.resolver?.email || 'an unlisted responder'}
                                            </Text>
                                        </div>
                                        <Space size={4}>
                                            <Tooltip title='Send reminder'>
                                                <Button
                                                    shape='circle'
                                                    icon={<BellOutlined />}
                                                    loading={remindingQueryId === queryItem.id}
                                                    disabled={!queryItem.resolverId}
                                                    onClick={() => remindQueryResolver(queryItem)}
                                                    aria-label='Send reminder'
                                                />
                                            </Tooltip>
                                            <Button
                                                type='link'
                                                icon={<CheckCircleOutlined />}
                                                onClick={() => setResolvingQuery(queryItem)}
                                            >
                                                Resolve
                                            </Button>
                                        </Space>
                                    </Space>
                                </div>
                            )
                        })}
                    </div>
                )}
            </Modal>

            <ResolveQueryModal
                open={!!resolvingQuery}
                query={resolvingQuery}
                actor={{
                    id: String(user?.uid || user?.id || ''),
                    name: user?.name || user?.displayName || null,
                    email: user?.email || null,
                    role: user?.role || null,
                    departmentName: user?.departmentName || null
                }}
                onClose={() => setResolvingQuery(null)}
                onResolved={queryId => {
                    setWorkflowQueries(rows => rows.map(row =>
                        row.id === queryId ? { ...row, status: 'resolved' } : row
                    ))
                    setResolvingQuery(null)
                }}
            />
        </Layout>
    )
}

export default OperationsDashboard
