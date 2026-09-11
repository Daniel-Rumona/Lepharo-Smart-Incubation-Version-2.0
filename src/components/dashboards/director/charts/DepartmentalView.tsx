import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Row, Col, Button, Modal, Empty, DatePicker, Alert } from 'antd'
import { ExpandOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import DrilldownModule from 'highcharts/modules/drilldown'
import {
    collection,
    documentId,
    getDocs,
    query,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import isBetween from 'dayjs/plugin/isBetween'
dayjs.extend(isBetween)

if (typeof DrilldownModule === 'function') DrilldownModule(Highcharts)

const { RangePicker } = DatePicker

// ---------- props ----------
type DepartmentalViewProps = {
    /** Optional external date range. If not provided, defaults to current year. */
    dateRange?: [Dayjs, Dayjs]
    /** Show an inline date filter (RangePicker). Default false. */
    showDateFilter?: boolean
    /** Header title override */
    title?: string
}

// ---------- defaults ----------
const DEFAULT_RANGE: [Dayjs, Dayjs] = [
    dayjs().startOf('year'),
    dayjs().endOf('year')
]

// ---------- utils ----------
const normalize = (s?: string) => (s || '').toString().trim().toLowerCase()
const normDept = (s?: string) =>
    (s || 'Other').toString().replace(/\s+/g, ' ').trim()

const toDate = (v: any): Date | null => {
    if (!v) return null
    if (typeof v.toDate === 'function') return v.toDate()
    if (typeof v.seconds === 'number') {
        const ms = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6)
        return new Date(ms)
    }
    if (typeof v._seconds === 'number') {
        const ms = v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6)
        return new Date(ms)
    }
    if (typeof v === 'number') return new Date(v)
    if (typeof v === 'string') {
        const d = new Date(v)
        return isNaN(d.getTime()) ? null : d
    }
    if (v instanceof Date) return v
    return null
}

const STATUS_MAP: Record<string, string> = {
    // completed-ish
    completed: 'Completed',
    done: 'Completed',
    approved: 'Completed',
    // in-progress-ish
    'in progress': 'In Progress',
    'in-progress': 'In Progress',
    active: 'In Progress',
    ongoing: 'In Progress',
    // pending-ish
    pending: 'Pending',
    requested: 'Pending',
    scheduled: 'Pending',
    assigned: 'Pending',
    // other
    declined: 'Declined',
    rejected: 'Declined',
    cancelled: 'Cancelled',
    canceled: 'Cancelled'
}

const canonicalStatus = (s?: string) => {
    const k = (s || '').toString().trim().toLowerCase()
    return (
        STATUS_MAP[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Unknown')
    )
}

const isCompletedCanonical = (label: string) => label === 'Completed'

export function chunk<T>(arr: readonly T[], size = 10): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size) as T[])
    return out
}

// ---------- types ----------
type AppDoc = {
    id: string
    participantId?: string
    branchId?: string
    programId?: string
    applicationStatus?: string
    interventions?: { required?: Array<{ area?: string; title?: string }> }
}

type ParticipantDoc = { id: string }

type AssignedIntervention = {
    id?: string
    participantId?: string
    beneficiaryId?: string
    createdAt?: any
    completedAt?: any
    areaOfSupport?: string
    interventionTitle?: string
    status?: string
}

type UserDoc = {
    id: string
    department?: string
    departmentName?: string
    role?: string
    roles?: string[]
    isActive?: boolean
}

// =====================================================
// Component
// =====================================================
const DepartmentalView: React.FC<DepartmentalViewProps> = ({
    dateRange: controlledRange,
    showDateFilter = false,
    title = 'Departmental View'
}) => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()

    // if a prop dateRange is provided, use it; else default.
    const [internalRange, setInternalRange] = useState<[Dayjs, Dayjs]>(
        controlledRange || DEFAULT_RANGE
    )
    // keep internalRange synced if parent changes it
    useEffect(() => {
        if (controlledRange) setInternalRange(controlledRange)
    }, [controlledRange])

    const dateRange = controlledRange || internalRange

    const [loading, setLoading] = useState(false)
    const [depsLoaded, setDepsLoaded] = useState(false) // departments
    const [coreLoaded, setCoreLoaded] = useState(false) // apps + assigned + team
    const [plansLoaded, setPlansLoaded] = useState(false) // diagnosticPlans

    const allLoaded = depsLoaded && coreLoaded && plansLoaded

    const [expandedChart, setExpandedChart] = useState<string | null>(null)
    const [topError, setTopError] = useState<string | null>(null)

    // data
    const [apps, setApps] = useState<AppDoc[]>([])
    const [assigned, setAssigned] = useState<AssignedIntervention[]>([])
    const [team, setTeam] = useState<UserDoc[]>([])
    const [deptNames, setDeptNames] = useState<string[]>([])
    const latestPlanByPidRef = useRef<Map<string, any>>(new Map())

    const assignedBranch = user?.assignedBranch

    // Exclusions for DP mapping
    const EXCLUDED_SUBSTR = ['ihf', 'm&e', 'stakeholder', 'hrm']
    const isExcludedDept = (name?: string) =>
        !!name && EXCLUDED_SUBSTR.some(s => name.toLowerCase().includes(s))

    const hasAgreement = (app: any, slug: string) => {
        const m = app?.signedAgreements || {}
        return Object.keys(m).some((k: string) => k.toLowerCase() === slug)
    }

    const inRange = useCallback(
        (d?: any) => {
            const dt = toDate(d)
            if (!dt) return false
            return dayjs(dt).isBetween(dateRange[0], dateRange[1], 'day', '[]')
        },
        [dateRange]
    )

    // ---- Load Departments list (names) ----
    useEffect(() => {
        setDepsLoaded(false)
            ; (async () => {
                try {
                    const qs = await getDocs(
                        query(
                            collection(db, 'departments'),
                        )
                    )
                    setDeptNames(
                        qs.docs
                            .map(d => String((d.data() as any).name || d.id).trim())
                            .filter(n => n && !isExcludedDept(n))
                    )
                } finally {
                    setDepsLoaded(true)
                }
            })()
    }, [identityLoading])

    // ---- Load Applications, Participants, AssignedInterventions, Team ----
    // ---- Load Applications (by program), AssignedInterventions, Team ----
    useEffect(() => {
        setCoreLoaded(false)
        setTopError(null)

            ; (async () => {
                try {
                    setLoading(true)

                    // ---- Applications (all branches, scoped by program + tenant) ----
                    const applicationsQuery = query(
                        collection(db, 'applications'),
                        where('programId', '==', activeProgramId),
                    )

                    const appsSnap = await getDocs(applicationsQuery)
                    const _apps: AppDoc[] = appsSnap.docs.map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    }))
                    setApps(_apps)
                    // ---- AssignedInterventions (by participantId + beneficiaryId) ----
                    const pids = Array.from(
                        new Set(_apps.map(a => a.participantId).filter(Boolean) as string[])
                    )
                    const assignedRows: AssignedIntervention[] = []

                    if (pids.length) {
                        for (const ids of chunk(pids, 10)) {
                            const s = await getDocs(
                                query(
                                    collection(db, 'assignedInterventions'),
                                    where('participantId', 'in', ids)
                                )
                            )
                            assignedRows.push(
                                ...s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                            )
                        }
                        // fallback: beneficiaryId
                        for (const ids of chunk(pids, 10)) {
                            const s = await getDocs(
                                query(
                                    collection(db, 'assignedInterventions'),
                                    where('beneficiaryId', 'in', ids)
                                )
                            )
                            assignedRows.push(
                                ...s.docs.map(d => ({
                                    id: d.id,
                                    ...(d.data() as any),
                                    participantId: (d.data() as any).beneficiaryId
                                }))
                            )
                        }
                    }

                    // dedupe by id
                    const byId = new Map<string, AssignedIntervention>()
                    assignedRows.forEach(r => r.id && byId.set(r.id, r))
                    let merged = Array.from(byId.values())

                    // Enrich missing labels from the canonical intervention definitions.
                    const missing = merged.filter(
                        r => !r.areaOfSupport || !r.interventionTitle
                    )
                    const idsToFetch = Array.from(
                        new Set(
                            missing
                                .map((r: any) => r.interventionId)
                                .filter(Boolean) as string[]
                        )
                    )

                    if (idsToFetch.length) {
                        const detailsMap = new Map<string, any>()
                        for (const ids of chunk(idsToFetch, 10)) {
                            const s = await getDocs(
                                query(
                                    collection(db, 'interventions'),
                                    where(documentId(), 'in', ids)
                                )
                            )
                            s.forEach(d => detailsMap.set(d.id, d.data()))
                        }
                        merged = merged.map(r => {
                            if (r.areaOfSupport && r.interventionTitle) return r
                            const info = (r as any).interventionId
                                ? detailsMap.get((r as any).interventionId)
                                : null
                            return info
                                ? {
                                    ...r,
                                    areaOfSupport:
                                        r.areaOfSupport ??
                                        info.areaOfSupport ??
                                        info.department ??
                                        'Other',
                                    interventionTitle:
                                        r.interventionTitle ??
                                        info.title ??
                                        info.interventionTitle ??
                                        'Untitled'
                                }
                                : r
                        })
                    }

                    setAssigned(merged)


                    // ---- Team (tenant-wide) ----
                    const teamSnap = await getDocs(
                        query(
                            collection(db, 'users'),
                        )
                    )
                    const teamRows = teamSnap.docs.map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    }))
                    setTeam(teamRows)


                    setCoreLoaded(true)
                } catch (e: any) {
                    console.error('[DeptView] core load failed', e)
                    setTopError(
                        `Failed to load departmental analytics: ${e?.message || String(e)}`
                    )
                    setCoreLoaded(true) // unblock UI even if some parts failed
                } finally {
                    setLoading(false)
                }
            })()
    }, [activeProgramId, identityLoading])

    // ---- DiagnosticPlans latest per ROM-confirmed participants (for DPs) ----
    useEffect(() => {
        setPlansLoaded(false)
            ; (async () => {
                try {
                    const pids = Array.from(
                        new Set(apps.map(a => a.participantId).filter(Boolean) as string[])
                    )

                    if (!pids.length) {
                        latestPlanByPidRef.current = new Map()
                        setPlansLoaded(true) // ✅ ensure we flip the flag even with no data
                        return
                    }

                    const romConfirmed = new Set<string>()
                    for (const ids of chunk(pids, 10)) {
                        const gs = await getDocs(
                            query(
                                collection(db, 'gapAnalysis'),
                                where('participantId', 'in', ids)
                            )
                        )
                        gs.forEach(s => {
                            const g: any = s.data()
                            const st = String(
                                g?.romReview?.status || g?.confirmationStatus || ''
                            ).toLowerCase()
                            if (st === 'confirmed' && g?.participantId)
                                romConfirmed.add(String(g.participantId))
                        })
                    }

                    const latest = new Map<string, any>()
                    const toMillis = (v: any) =>
                        v?.toMillis?.() ??
                        (v?._seconds
                            ? v._seconds * 1000
                            : v instanceof Date
                                ? v.getTime()
                                : Number(v) || 0)

                    for (const ids of chunk(Array.from(romConfirmed), 10)) {
                        const ds = await getDocs(
                            query(
                                collection(db, 'diagnosticPlans'),
                                where('participantId', 'in', ids)
                            )
                        )
                        ds.forEach(s => {
                            const d: any = s.data()
                            const pid = String(d?.participantId || '')
                            const prev = latest.get(pid)
                            if (!prev || toMillis(d?.createdAt) > toMillis(prev?.createdAt))
                                latest.set(pid, d)
                        })
                    }

                    latestPlanByPidRef.current = latest
                } catch (e) {
                    // optional: surface error
                    console.error('plans load failed', e)
                } finally {
                    setPlansLoaded(true) // ✅ always release the gate
                }
            })()
    }, [apps])

    // ---- scoped intervs by date ----
    const assignedInRange = useMemo(
        () => assigned.filter(r => inRange(r.createdAt) || inRange(r.completedAt)),
        [assigned, inRange]
    )

    // =====================================================
    // 1) Interventions by Department (Dept → Status → Intervention)
    // =====================================================
    const breakdown = useMemo(() => {
        const perDept: Record<string, AssignedIntervention[]> = {}
        assignedInRange.forEach(r => {
            const dept = normDept(r.areaOfSupport)
            if (!perDept[dept]) perDept[dept] = []
            perDept[dept].push(r)
        })

        const topData: Highcharts.PointOptionsObject[] = []
        const drillSeries: Highcharts.DrilldownSeriesOptions[] = []

        Object.entries(perDept).forEach(([dept, rows]) => {
            const perStatus: Record<string, AssignedIntervention[]> = {}
            rows.forEach(r => {
                const st = canonicalStatus(r.status)
                if (!perStatus[st]) perStatus[st] = []
                perStatus[st].push(r)
            })

            topData.push({ name: dept, y: rows.length, drilldown: `dept:${dept}` })

            const statusPoints: Highcharts.PointOptionsObject[] = []
            Object.entries(perStatus).forEach(([st, srows]) => {
                const id = `dept:${dept}::status:${st}`
                statusPoints.push({ name: st, y: srows.length, drilldown: id })

                const perTitle: Record<string, number> = {}
                srows.forEach(r => {
                    const t = r.interventionTitle || 'Untitled'
                    perTitle[t] = (perTitle[t] || 0) + 1
                })

                drillSeries.push({
                    id,
                    name: `${dept} • ${st}`,
                    type: 'column',
                    data: Object.entries(perTitle).map(([t, n]) => [t, n])
                })
            })

            drillSeries.push({
                id: `dept:${dept}`,
                name: `${dept} — by Status`,
                type: 'column',
                data: statusPoints
            })
        })

        return { topData, drillSeries }
    }, [assignedInRange])

    const breakdownHasData = breakdown.topData.some(p => (p as any).y > 0)
    const breakdownOptions: Highcharts.Options = {
        chart: { type: 'column', height: 360 },
        title: { text: '' },
        credits: { enabled: false },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Interventions' } },
        legend: { enabled: false },
        plotOptions: {
            series: {
                borderWidth: 0,
                dataLabels: { enabled: true, format: '{point.y}' }
            }
        },
        series: [
            {
                type: 'column',
                name: 'Department',
                colorByPoint: true,
                data: breakdown.topData
            }
        ],
        drilldown: { series: breakdown.drillSeries }
    }

    // =====================================================
    // 2) Team Members per Department (drilldown to Roles)
    // =====================================================
    const teamByDeptDrill = useMemo(() => {
        const HIDE_DEPT = new Set(['unassigned', 'other', ''])
        const HIDE_ROLE = new Set(['incubatee'])

        // Normalize & map role labels
        const roleLabel = (r?: string): string => {
            const key = (r || '').toLowerCase().trim()
            switch (key) {
                case 'operations':
                    return 'HOD'
                case 'projectmanager':
                    return 'Project Coordinator'
                default:
                    return key
                        ? key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
                        : 'Member'
            }
        }

        const getRoles = (u: UserDoc): string[] => {
            const arr =
                Array.isArray(u.roles) && u.roles.length
                    ? u.roles
                    : ([u.role].filter(Boolean) as string[])
            return arr.map(r => (r || '').toString().trim().toLowerCase())
        }

        const perDept: Record<string, UserDoc[]> = {}

        team.forEach(u => {
            const dept = normDept(u.departmentName || u.department || '')
            const deptNorm = dept.toLowerCase()

            const rolesNorm = getRoles(u)
            if (HIDE_DEPT.has(deptNorm) || rolesNorm.some(r => HIDE_ROLE.has(r)))
                return

            if (!perDept[dept]) perDept[dept] = []
            perDept[dept].push(u)
        })

        const topData: Highcharts.PointOptionsObject[] = []
        const drillSeries: Highcharts.DrilldownSeriesOptions[] = []

        Object.entries(perDept).forEach(([dept, users]) => {
            const perRole: Record<string, number> = {}

            users.forEach(u => {
                const rolesNorm = getRoles(u).filter(r => !HIDE_ROLE.has(r))
                    ; (rolesNorm.length ? rolesNorm : ['member']).forEach(r => {
                        const label = roleLabel(r)
                        perRole[label] = (perRole[label] || 0) + 1
                    })
            })

            const total = Object.values(perRole).reduce((a, b) => a + b, 0)
            if (!total) return

            topData.push({ name: dept, y: total, drilldown: `t:${dept}` })

            drillSeries.push({
                id: `t:${dept}`,
                name: `${dept} — Roles`,
                type: 'column',
                data: Object.entries(perRole).map(([r, n]) => [r, n])
            })
        })

        return { topData, drillSeries }
    }, [team])

    const teamHasData = teamByDeptDrill.topData.some(p => (p as any).y > 0)
    const teamOptions: Highcharts.Options = {
        chart: { type: 'column', height: 320 },
        title: { text: '' },
        credits: { enabled: false },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Team Members' } },
        legend: { enabled: false },
        plotOptions: {
            series: {
                borderWidth: 0,
                dataLabels: { enabled: true, format: '{point.y}' }
            }
        },
        series: [
            {
                type: 'column',
                name: 'Department',
                colorByPoint: true,
                data: teamByDeptDrill.topData
            }
        ],
        drilldown: { series: teamByDeptDrill.drillSeries }
    }

    // =====================================================
    // 3) DPs — Needed vs Confirmed (participants per department)
    // =====================================================
    const paDPModel = useMemo(() => {
        const deptSet = new Set<string>()

        // observed from assignedInterventions
        assignedInRange.forEach(r => {
            const n = normDept(r.areaOfSupport)
            if (!isExcludedDept(n)) deptSet.add(n)
        })

        // needed per dept from applications.interventions.required[].area
        const neededByDept = new Map<string, Set<string>>() // participants needing that dept
        apps.forEach(a => {
            if (normalize(a.applicationStatus) !== 'accepted') return
            const pid = String(a.participantId || '')
            const req = a?.interventions?.required
            if (!pid || !Array.isArray(req)) return
            const areas = new Set(req.map(it => normDept(it?.area)).filter(Boolean))
            areas.forEach(area => {
                if (isExcludedDept(area)) return
                deptSet.add(area)
                const set = neededByDept.get(area) || new Set<string>()
                set.add(pid)
                neededByDept.set(area, set)
            })
        })

        // confirmed from latest diagnosticPlans.confirmed (ROM-gated)
        const confirmedByDept = new Map<string, Set<string>>()
        const latest = latestPlanByPidRef.current
        const norm = (s: string) =>
            s
                .toLowerCase()
                .replace(/\(.*?\)|and|&/gi, '')
                .trim()

        latest.forEach((plan, pid) => {
            const conf = (plan?.confirmed || {}) as Record<string, boolean>
            Object.entries(conf).forEach(([k, v]) => {
                if (!v) return
                const nk = norm(k)
                const match = deptNames.find(
                    d =>
                        !isExcludedDept(d) && (norm(d).includes(nk) || nk.includes(norm(d)))
                )
                if (match) {
                    const m = confirmedByDept.get(match) || new Set<string>()
                    m.add(String(pid))
                    confirmedByDept.set(match, m)
                }
            })
        })

        const cats = Array.from(
            new Set([...deptSet, ...deptNames.filter(d => !isExcludedDept(d))])
        )
            .filter(Boolean)
            .sort()
        const needed = cats.map(d => neededByDept.get(d)?.size || 0)
        const confirmed = cats.map(d => confirmedByDept.get(d)?.size || 0)
        return { cats, needed, confirmed }
    }, [assignedInRange, apps, deptNames])

    const paDPHasData =
        paDPModel.cats.length &&
        (paDPModel.needed.some(v => v > 0) || paDPModel.confirmed.some(v => v > 0))

    const paDPOptions: Highcharts.Options = {
        chart: { type: 'bar', height: 380 },
        title: { text: '' },
        credits: { enabled: false },
        xAxis: { categories: paDPModel.cats },
        yAxis: { min: 0, allowDecimals: false, title: { text: 'Participants' } },
        legend: { reversed: false },
        tooltip: { shared: true },
        plotOptions: { bar: { dataLabels: { enabled: true }, borderRadius: 4 } },
        series: [
            { type: 'bar', name: 'Confirmed', data: paDPModel.confirmed },
            { type: 'bar', name: 'Needed', data: paDPModel.needed }
        ]
    }

    // =====================================================
    // 4) Interventions Gap — Required vs Completed (counts per dept)
    // =====================================================
    const interventionsGap = useMemo(() => {
        const reqCount: Record<string, number> = {}
        apps.forEach(a => {
            if (normalize(a.applicationStatus) !== 'accepted') return
            const req = a?.interventions?.required
            if (!Array.isArray(req)) return
            req.forEach(it => {
                const area = normDept(it?.area)
                if (isExcludedDept(area)) return
                reqCount[area] = (reqCount[area] || 0) + 1
            })
        })

        const doneCount: Record<string, number> = {}
        assignedInRange.forEach(r => {
            const label = canonicalStatus(r.status)
            if (!isCompletedCanonical(label)) return
            const area = normDept(r.areaOfSupport)
            if (isExcludedDept(area)) return
            doneCount[area] = (doneCount[area] || 0) + 1
        })

        const cats = Array.from(
            new Set([...Object.keys(reqCount), ...Object.keys(doneCount)])
        ).sort()
        return {
            cats,
            required: cats.map(c => reqCount[c] || 0),
            completed: cats.map(c => doneCount[c] || 0)
        }
    }, [apps, assignedInRange])

    const interventionsGapHasData =
        interventionsGap.required.some(v => v > 0) ||
        interventionsGap.completed.some(v => v > 0)

    const interventionsGapOptions: Highcharts.Options = {
        chart: { type: 'column', height: 340 },
        title: { text: '' },
        credits: { enabled: false },
        xAxis: { categories: interventionsGap.cats },
        yAxis: { min: 0, title: { text: 'Interventions' } },
        plotOptions: { column: { borderRadius: 4, dataLabels: { enabled: true } } },
        series: [
            { type: 'column', name: 'Required', data: interventionsGap.required },
            { type: 'column', name: 'Completed', data: interventionsGap.completed }
        ]
    }

    // ---- Generic chart wrapper ----
    const ChartOrEmpty: React.FC<{
        hasData: boolean
        options: Highcharts.Options
    }> = ({ hasData, options }) =>
            hasData ? (
                <HighchartsReact highcharts={Highcharts} options={options} />
            ) : (
                <div
                    style={{
                        height: (options.chart as any)?.height || 300,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    <Empty description='No data in selected range' />
                </div>
            )

    // ---- Render ----
    return (
        <div>
            {!allLoaded ? (
                <LoadingOverlay tip='Loading Departmental Analytics' />
            ) : (
                <>
                    {topError && (
                        <Alert
                            type='warning'
                            showIcon
                            message='Some data did not load cleanly'
                            description={topError}
                            style={{ marginBottom: 8 }}
                        />
                    )}

                    <Row gutter={[16, 16]}>
                        <Col xs={24}>
                            <MotionCard
                                title='Interventions by Department (Dept → Status → Intervention)'
                                extra={
                                    <Button
                                        size='small'
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart('breakdown')}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty
                                    hasData={breakdownHasData}
                                    options={breakdownOptions}
                                />
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={12}>
                            <MotionCard
                                title='Team Members per Department (Drilldown to Roles)'
                                extra={
                                    <Button
                                        size='small'
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart('team')}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty hasData={teamHasData} options={teamOptions} />
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={12}>
                            <MotionCard
                                title='Interventions Gap — Required vs Completed (by Department)'
                                extra={
                                    <Button
                                        size='small'
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart('gap')}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty
                                    hasData={interventionsGapHasData}
                                    options={interventionsGapOptions}
                                />
                            </MotionCard>
                        </Col>

                        <Col xs={24}>
                            <MotionCard
                                title='Developmental Plans — Needed vs Confirmed (by Department)'
                                extra={
                                    <Button
                                        size='small'
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart('dps')}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty hasData={!!paDPHasData} options={paDPOptions} />
                            </MotionCard>
                        </Col>
                    </Row>

                    <Modal
                        open={!!expandedChart}
                        footer={null}
                        onCancel={() => setExpandedChart(null)}
                        width={1000}
                        title={`Expanded View — ${expandedChart}`}
                    >
                        {expandedChart === 'breakdown' && (
                            <ChartOrEmpty
                                hasData={breakdownHasData}
                                options={breakdownOptions}
                            />
                        )}
                        {expandedChart === 'team' && (
                            <ChartOrEmpty hasData={teamHasData} options={teamOptions} />
                        )}
                        {expandedChart === 'gap' && (
                            <ChartOrEmpty
                                hasData={interventionsGapHasData}
                                options={interventionsGapOptions}
                            />
                        )}
                        {expandedChart === 'dps' && (
                            <ChartOrEmpty hasData={!!paDPHasData} options={paDPOptions} />
                        )}
                    </Modal>
                </>
            )}
        </div>
    )
}

export default DepartmentalView
