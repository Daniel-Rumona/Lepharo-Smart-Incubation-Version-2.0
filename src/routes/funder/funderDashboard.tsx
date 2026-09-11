import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Card,
    Col,
    Row,
    Table,
    Typography,
    DatePicker,
    Button,
    Empty,
    Spin,
    Tag,
    message,
    Space
} from 'antd'
import {
    FileDoneOutlined,
    ReloadOutlined,
    SafetyCertificateOutlined,
    TeamOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { db } from '@/firebase'
import {
    collection,
    doc,
    documentId,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where,
    Unsubscribe
} from 'firebase/firestore'
import { computeSmeCompletedInterventionIds } from '@/services/assignmentLifecycleService'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    DashboardHeaderCard,
    MotionCard
} from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import dayjs, { Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'

const { RangePicker } = DatePicker
const { Text } = Typography

// ---------- utils ----------
function safeArr<T>(v: ReadonlyArray<T> | null | undefined): T[] {
    return Array.isArray(v) ? [...v] : []
}
function norm(v?: string | null): string {
    return (v ?? '').trim().toLowerCase()
}
function countFromUnknown(x: unknown): number {
    if (!x) return 0
    if (Array.isArray(x)) return x.length
    if (typeof x === 'object')
        return Object.keys(x as Record<string, unknown>).length
    if (typeof x === 'number') return Math.max(0, Math.floor(x))
    return 0
}
function normalizeBeeLevel(
    raw: unknown
): '1' | '2' | '3' | '4' | '5+' | 'Unknown' {
    const s = String(raw ?? '').trim()
    if (!s) return 'Unknown'
    const n = parseInt(s, 10) // handles "5+"
    if (Number.isNaN(n)) return 'Unknown'
    if (n >= 1 && n <= 4) return String(n) as any
    if (n >= 5) return '5+'
    return 'Unknown'
}

function toDayjsDate(v: any): Dayjs | null {
    if (!v) return null
    if (typeof v?.toDate === 'function') return dayjs(v.toDate())
    if (typeof v?._seconds === 'number') return dayjs.unix(v._seconds)
    if (typeof v === 'string' || v instanceof Date) {
        const d = dayjs(v)
        return d.isValid() ? d : null
    }
    return null
}

function getApplicationDate(a: any): Dayjs | null {
    return (
        toDayjsDate(a.submittedAt) ||
        toDayjsDate(a.createdAt) ||
        toDayjsDate(a.acceptedAt) ||
        toDayjsDate(a.updatedAt)
    )
}

// ---------- types ----------
type Application = {
    id: string
    | null
    programId?: string | null
    applicationStatus?: string | null
    participantId?: string | null
    email?: string | null
    profile?: Record<string, unknown> | null
    complianceDocuments?: Array<{
        key?: string | null
        type?: string | null
        status?: string | null
    }>
    interventions?: { required?: unknown; completed?: unknown } | null
}
type Participant = {
    id: string
    beneficiaryName?: string | null
    gender?: string | null
    sector?: string | null
    beeLevel?: string | number | null
    email?: string | null
    | null
}
type AssignedIntervention = {
    id: string
    programId?: string | null
    participantId?: string | null
    status?: string | null
}
type ProfileRow = { value: string; count: number }

const MetricCard: React.FC<{
    title: string
    value: React.ReactNode
    icon: React.ReactNode
    iconBg?: string
}> = ({ title, value, icon, iconBg = '#e6f4ff' }) => (
    <MotionCard>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div
                style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: iconBg,
                    display: 'grid',
                    placeItems: 'center',
                    flex: '0 0 auto'
                }}
            >
                {icon}
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
                    {title}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
                    {value}
                </div>
            </div>
        </div>
    </MotionCard>
)

// ---------- component ----------
const FunderDashboard: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()

    const [loading, setLoading] = useState(true)
    const [programName, setProgramName] = useState<string | null>(null)
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
        dayjs().startOf('year'),
        dayjs().endOf('day')
    ])

    const [apps, setApps] = useState<Application[]>([])
    const [participants, setParticipants] = useState<Record<string, Participant>>(
        {}
    )
    const [aiByParticipant, setAiByParticipant] = useState<
        Record<string, AssignedIntervention[]>
    >({})
    // hasSubInterventions/subInterventions for the SME-level completion
    // rollup - a completed assignment only finishes the whole intervention
    // once every active sub-intervention has its own completed assignment.
    const [interventionDefsById, setInterventionDefsById] = useState<Record<string, any>>({})

    const appsUnsubRef = useRef<Unsubscribe | null>(null)
    const aiUnsubRef = useRef<Unsubscribe | null>(null)
    const progUnsubRef = useRef<Unsubscribe | null>(null)

    // Program name
    useEffect(() => {
        if (progUnsubRef.current) {
            progUnsubRef.current()
            progUnsubRef.current = null
        }
        setProgramName(null)
        if (!activeProgramId) return
        const ref = doc(db, 'programs', activeProgramId)
        progUnsubRef.current = onSnapshot(
            ref,
            snap => {
                if (snap.exists()) {
                    const d = snap.data() as any
                    setProgramName(d?.name || d?.programName || activeProgramId)
                } else setProgramName(activeProgramId)
            },
            () => setProgramName(activeProgramId)
        )
        return () => {
            if (progUnsubRef.current) {
                progUnsubRef.current()
                progUnsubRef.current = null
            }
        }
    }, [activeProgramId])

    // Applications & participants
    useEffect(() => {
        if (identityLoading) return
        if (!activeProgramId) {
            setApps([])
            setParticipants({})
            setLoading(false)
            return
        }
        if (appsUnsubRef.current) {
            appsUnsubRef.current()
            appsUnsubRef.current = null
        }
        setLoading(true)

        const qApps = query(
            collection(db, 'applications'),
            where('programId', '==', activeProgramId)
        )

        appsUnsubRef.current = onSnapshot(
            qApps,
            async snap => {
                try {
                    const list: Application[] = snap.docs.map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    }))
                    setApps(list)

                    const found: Record<string, Participant> = {}
                    await Promise.all(
                        list.map(async a => {
                            let p: Participant | null = null
                            if (a.participantId) {
                                const ref = doc(db, 'participants', a.participantId)
                                const ps = await getDoc(ref)
                                if (ps.exists()) p = { id: ps.id, ...(ps.data() as any) }
                            }
                            if (!p && a.email) {
                                const pQ = query(
                                    collection(db, 'participants'),
                                    where('email', '==', a.email)
                                )
                                const rs = await getDocs(pQ)
                                if (!rs.empty) {
                                    const d = rs.docs[0]
                                    p = { id: d.id, ...(d.data() as any) }
                                }
                            }
                            if (p) found[p.id] = p
                        })
                    )
                    setParticipants(found)
                    setLoading(false)
                } catch (e) {
                    console.error(e)
                    message.error('Failed to load applications/participants.')
                    setApps([])
                    setParticipants({})
                    setLoading(false)
                }
            },
            () => {
                setApps([])
                setParticipants({})
                setLoading(false)
            }
        )

        return () => {
            if (appsUnsubRef.current) {
                appsUnsubRef.current()
                appsUnsubRef.current = null
            }
        }
    }, [identityLoading, activeProgramId])

    // assignedInterventions (for completed fallback)
    useEffect(() => {
        if (!activeProgramId) return
        if (aiUnsubRef.current) {
            aiUnsubRef.current()
            aiUnsubRef.current = null
        }

        const qAI = query(
            collection(db, 'assignedInterventions'),
            where('programId', '==', activeProgramId)
        )

        aiUnsubRef.current = onSnapshot(
            qAI,
            snap => {
                const list: AssignedIntervention[] = snap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))
                const grouped: Record<string, AssignedIntervention[]> = {}
                for (const it of list) {
                    const pid = it.participantId || 'unknown'
                    if (!grouped[pid]) grouped[pid] = []
                    grouped[pid].push(it)
                }
                setAiByParticipant(grouped)
            },
            () => setAiByParticipant({})
        )

        return () => {
            if (aiUnsubRef.current) {
                aiUnsubRef.current()
                aiUnsubRef.current = null
            }
        }
    }, [activeProgramId])

    // Definitions needed for the completion rollup - only fetches ids not
    // already cached.
    useEffect(() => {
        const ids = Array.from(
            new Set(
                Object.values(aiByParticipant)
                    .flat()
                    .map(it => String((it as any)?.interventionId || ''))
                    .filter(Boolean)
            )
        ).filter(id => !interventionDefsById[id])
        if (!ids.length) return

            ; (async () => {
                const out: Record<string, any> = {}
                for (let i = 0; i < ids.length; i += 10) {
                    const chunk = ids.slice(i, i + 10)
                    const snap = await getDocs(query(collection(db, 'interventions'), where(documentId(), 'in', chunk)))
                    snap.docs.forEach(d => { out[d.id] = { id: d.id, ...(d.data() as any) } })
                }
                setInterventionDefsById(prev => ({ ...prev, ...out }))
            })().catch(() => { })
    }, [aiByParticipant, interventionDefsById])

    const filteredApps = useMemo(() => {
        const [start, end] = dateRange

        return apps.filter(a => {
            const d = getApplicationDate(a)
            if (!d) return false

            return (
                d.isSame(start) ||
                d.isSame(end) ||
                (d.isAfter(start) && d.isBefore(end))
            )
        })
    }, [apps, dateRange])

    const acceptedApps = useMemo(
        () => filteredApps.filter(a => norm(a.applicationStatus) === 'accepted'),
        [filteredApps]
    )

    // ---------- Metrics ----------
    const totalSMEs = acceptedApps.length

    // Interventions required : completed
    const interventionsSummary = useMemo(() => {
        let required = 0
        for (const a of acceptedApps) {
            required += countFromUnknown(a.interventions?.required)
        }
        // A completed assignment only means the whole intervention is done
        // when it has no sub-interventions - otherwise every active
        // sub-intervention needs its own completed assignment first.
        const completed = Object.values(aiByParticipant).reduce(
            (acc, list) => acc + computeSmeCompletedInterventionIds(list, interventionDefsById).size,
            0
        )
        return { required, completed }
    }, [acceptedApps, aiByParticipant, interventionDefsById])

    // BBBEE distribution & mode (most common actual level)
    const { beeMode, beeDist } = useMemo(() => {
        const counts = new Map<'1' | '2' | '3' | '4' | '5+' | 'Unknown', number>()
        const scopeIds = new Set(
            acceptedApps.map(a => a.participantId).filter(Boolean) as string[]
        )
        for (const p of Object.values(participants)) {
            if (!scopeIds.has(p.id)) continue
            const lvl = normalizeBeeLevel(p.beeLevel)
            counts.set(lvl, (counts.get(lvl) || 0) + 1)
        }
        // determine mode; break ties preferring '1','2','3','4','5+','Unknown' (in that order)
        const order: Array<'1' | '2' | '3' | '4' | '5+' | 'Unknown'> = [
            '1',
            '2',
            '3',
            '4',
            '5+',
            'Unknown'
        ]
        let best: typeof order[number] = 'Unknown'
        let bestCount = -1
        for (const k of order) {
            const c = counts.get(k) || 0
            if (c > bestCount) {
                best = k
                bestCount = c
            }
        }
        return {
            beeMode: { level: best, count: Math.max(0, bestCount) },
            beeDist: counts
        }
    }, [participants, acceptedApps])

    // Compliance donut (valid certificate/affidavit)
    const complianceCounts = useMemo(() => {
        let hasCert = 0,
            missing = 0
        for (const a of apps) {
            const docs = safeArr(a.complianceDocuments)
            const ok = docs.some(d => {
                const t = norm(d?.type)
                const s = norm(d?.status)
                return (
                    s === 'valid' &&
                    (t.includes('certificate') ||
                        t.includes('affidavit') ||
                        t.includes('b-bbee'))
                )
            })
            if (ok) hasCert++
            else missing++
        }
        return { hasCert, missing }
    }, [apps])

    // Profile decomposition table
    const profileRows: ProfileRow[] = useMemo(() => {
        const counts = new Map<string, number>()
        for (const a of apps) {
            const map = a.profile && typeof a.profile === 'object' ? a.profile : null
            if (!map) {
                counts.set('Unknown', (counts.get('Unknown') || 0) + 1)
                continue
            }
            const firstKey = Object.keys(map)[0]
            if (!firstKey) {
                counts.set('Unknown', (counts.get('Unknown') || 0) + 1)
                continue
            }
            const val = (map as any)[firstKey]
            if (typeof val === 'string') {
                const label = val || 'Unknown'
                counts.set(label, (counts.get(label) || 0) + 1)
            } else if (Array.isArray(val)) {
                if (val.length === 0)
                    counts.set('Unknown', (counts.get('Unknown') || 0) + 1)
                else
                    for (const item of val) {
                        const label = String(item || 'Unknown')
                        counts.set(label, (counts.get(label) || 0) + 1)
                    }
            } else if (val && typeof val === 'object') {
                const entries = Object.entries(val as Record<string, unknown>)
                let hit = false
                for (const [k, v] of entries) {
                    const on = typeof v === 'boolean' ? v : !!v
                    if (on) {
                        hit = true
                        counts.set(k || 'Unknown', (counts.get(k || 'Unknown') || 0) + 1)
                    }
                }
                if (!hit) counts.set('Unknown', (counts.get('Unknown') || 0) + 1)
            } else {
                counts.set('Unknown', (counts.get('Unknown') || 0) + 1)
            }
        }
        return Array.from(counts.entries())
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count)
    }, [apps])

    // -------- Charts (legend only) --------
    const genderPie = useMemo<Highcharts.Options>(() => {
        const gCount = new Map<string, number>()
        const scopeIds = new Set(
            apps.map(a => a.participantId).filter(Boolean) as string[]
        )

        for (const p of Object.values(participants)) {
            if (!scopeIds.has(p.id)) continue
            const g = (p.gender || 'Unspecified').toString()
            gCount.set(g, (gCount.get(g) || 0) + 1)
        }

        const seriesData = Array.from(gCount.entries())
            .map(([name, y]) => ({ name, y }))
            .filter(point => Number(point.y) > 0)

        return {
            chart: { type: 'pie', backgroundColor: 'transparent', height: 300 },
            title: { text: 'Gender Distribution' },
            legend: { enabled: true },
            tooltip: {
                pointFormat: '<b>{point.y}</b> SME(s) ({point.percentage:.1f}%)'
            },
            plotOptions: {
                pie: {
                    showInLegend: true,
                    dataLabels: {
                        enabled: true,
                        format: '{point.name}: {point.y}',
                        distance: 14,
                        connectorWidth: 1,
                        softConnector: true,
                        style: {
                            fontWeight: '600',
                            color: '#1f1f1f',
                            textOutline: 'none'
                        }
                    }
                }
            },
            series: [
                {
                    type: 'pie',
                    name: 'Count',
                    data: seriesData
                }
            ],
            credits: { enabled: false }
        }
    }, [participants, apps])

    const complianceDonut = useMemo<Highcharts.Options>(() => {
        const data = [
            { name: 'Has Certificate/Affidavit', y: complianceCounts.hasCert },
            { name: 'Missing/Invalid', y: complianceCounts.missing }
        ].filter(point => Number(point.y) > 0)

        return {
            chart: { type: 'pie', backgroundColor: 'transparent', height: 300 },
            title: { text: 'B-BBEE Certificate/Affidavit' },
            legend: { enabled: true },
            tooltip: {
                pointFormat: '<b>{point.y}</b> SME(s) ({point.percentage:.1f}%)'
            },
            plotOptions: {
                pie: {
                    innerSize: '60%',
                    showInLegend: true,
                    dataLabels: {
                        enabled: true,
                        format: '{point.name}: {point.y}',
                        distance: 14,
                        connectorWidth: 1,
                        softConnector: true,
                        style: {
                            fontWeight: '600',
                            color: '#1f1f1f',
                            textOutline: 'none'
                        }
                    }
                }
            },
            series: [
                {
                    type: 'pie',
                    name: 'Count',
                    data
                }
            ],
            credits: { enabled: false }
        }
    }, [complianceCounts])


    const applicationStatusChart = useMemo<Highcharts.Options>(() => {
        const counts = {
            total: filteredApps.length,
            accepted: filteredApps.filter(a => norm(a.applicationStatus) === 'accepted').length,
            declined: filteredApps.filter(a =>
                ['declined', 'rejected'].includes(norm(a.applicationStatus))
            ).length
        }

        const undecided = counts.total - counts.accepted - counts.declined

        const chartData = [
            { name: `Total Applied (${counts.total})`, y: counts.total, color: '#1677ff' },
            { name: `Accepted (${counts.accepted})`, y: counts.accepted, color: '#52c41a' },
            { name: `Declined (${counts.declined})`, y: counts.declined, color: '#ff4d4f' },
            { name: `Pending / Undecided (${undecided})`, y: undecided, color: '#faad14' }
        ]

        return {
            chart: {
                type: 'bar',
                backgroundColor: 'transparent',
                height: 360
            },
            title: { text: 'Applications: Total vs Accepted vs Declined' },
            legend: { enabled: false },
            xAxis: {
                type: 'category',
                labels: {
                    style: {
                        fontWeight: '600'
                    }
                },
                title: { text: undefined }
            },
            yAxis: {
                min: 0,
                allowDecimals: false,
                title: { text: 'Applications' }
            },
            tooltip: {
                pointFormat: '<b>{point.y}</b> application(s)'
            },
            plotOptions: {
                bar: {
                    borderRadius: 6
                }
            },
            series: [
                {
                    type: 'bar',
                    name: 'Applications',
                    data: chartData
                }
            ],
            credits: { enabled: false }
        }
    }, [filteredApps])

    const sectorDonut = useMemo<Highcharts.Options>(() => {
        const counts = new Map<string, number>()

        for (const a of acceptedApps) {
            const pid = a.participantId || ''
            const participant = pid ? participants[pid] : undefined

            const sector =
                participant?.sector ||
                (a as any)?.sector ||
                (a as any)?.businessSector ||
                'Unspecified'

            counts.set(sector, (counts.get(sector) || 0) + 1)
        }

        const data = Array.from(counts.entries())
            .map(([name, y]) => ({ name, y }))
            .filter(point => point.y > 0)

        return {
            chart: { type: 'pie', backgroundColor: 'transparent', height: 420 },
            title: { text: 'Sector Distribution' },
            legend: { enabled: false },
            tooltip: {
                pointFormat: '<b>{point.y}</b> SME(s) ({point.percentage:.1f}%)'
            },
            plotOptions: {
                pie: {
                    innerSize: '60%',
                    showInLegend: true,
                    dataLabels: {
                        enabled: true,
                        format: '{point.name}: {point.y}',
                        distance: 14,
                        connectorWidth: 1,
                        softConnector: true,
                        style: {
                            fontWeight: '600',
                            color: '#1f1f1f',
                            textOutline: 'none'
                        }
                    }
                }
            },
            series: [
                {
                    type: 'pie',
                    name: 'SMEs',
                    data
                }
            ],
            credits: { enabled: false }
        }
    }, [acceptedApps, participants])

    const profileColumns = useMemo(
        () => [
            { title: 'Ward / Locality', dataIndex: 'value' },
            {
                title: 'SMEs',
                dataIndex: 'count',
                width: 120,
                render: (v: number) => <Tag color='blue'>{v}</Tag>
            }
        ],
        []
    )

    const refresh = () => setApps(prev => [...prev])

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Funder Dashboard | Smart Incubation</title>
            </Helmet>
            {loading ? (
                <div
                    style={{
                        height: 320,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    <LoadingOverlay tip='Loading Dashboard' />
                </div>
            ) : apps.length === 0 ? (
                <Card style={{ marginTop: 16 }}>
                    <Empty description='No SMEs found for this program.' />
                </Card>
            ) : (
                <>
                    <DashboardHeaderCard
                        title='Funder Dashboard'
                        subtitle={programName || 'Selected program'}
                        extraRight={
                            <Space wrap>
                                <RangePicker
                                    // showTime
                                    value={dateRange}
                                    onChange={value => {
                                        if (!value || !value[0] || !value[1]) {
                                            setDateRange([
                                                dayjs().startOf('year'),
                                                dayjs().endOf('day')
                                            ])
                                            return
                                        }

                                        setDateRange([value[0], value[1]])
                                    }}
                                />

                                <Button
                                    shape='round'
                                    icon={<ReloadOutlined />}
                                    onClick={() =>
                                        setDateRange([
                                            dayjs().startOf('year'),
                                            dayjs().endOf('day')
                                        ])
                                    }
                                >
                                    YTD
                                </Button>
                            </Space>
                        }
                    />

                    {/* Metrics */}
                    <Row gutter={[16, 16]}>
                        <Col xs={24} sm={12} lg={6}>
                            <MetricCard
                                title='Total SMEs'
                                value={Object.keys(participants).length}
                                icon={<TeamOutlined style={{ fontSize: 22 }} />}
                                iconBg='#f6ffed'
                            />
                        </Col>

                        <Col xs={24} sm={12} lg={6}>
                            <MetricCard
                                title='Total Applied'
                                value={filteredApps.length}
                                icon={<FileDoneOutlined style={{ fontSize: 22 }} />}
                                iconBg='#e6f4ff'
                            />
                        </Col>

                        <Col xs={24} sm={12} lg={6}>
                            <MetricCard
                                title='Total Accepted'
                                value={
                                    filteredApps.filter(
                                        a => norm(a.applicationStatus) === 'accepted'
                                    ).length
                                }
                                icon={<SafetyCertificateOutlined style={{ fontSize: 22 }} />}
                                iconBg='#f6ffed'
                            />
                        </Col>

                        <Col xs={24} sm={12} lg={6}>
                            <MetricCard
                                title='Total Declined'
                                value={
                                    filteredApps.filter(a =>
                                        ['declined', 'rejected'].includes(
                                            norm(a.applicationStatus)
                                        )
                                    ).length
                                }
                                icon={<SafetyCertificateOutlined style={{ fontSize: 22 }} />}
                                iconBg='#fff1f0'
                            />
                        </Col>
                    </Row>

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                        <Col xs={24} lg={12}>
                            <MotionCard style={{ minHeight: 460 }}>
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={applicationStatusChart}
                                />
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={12}>
                            <MotionCard style={{ minHeight: 460 }}>
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={sectorDonut}
                                />
                            </MotionCard>
                        </Col>
                    </Row>

                    {/* Table + Charts */}
                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                        <Col xs={24} lg={12}>
                            <MotionCard>
                                <Table<ProfileRow>
                                    rowKey={r => r.value}
                                    dataSource={profileRows}
                                    columns={profileColumns as any}
                                    pagination={{ pageSize: 8 }}
                                />
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={12}>
                            <Row gutter={[16, 16]}>
                                <Col span={24}>
                                    <MotionCard style={{ borderRadius: 12 }}>
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={genderPie}
                                        />
                                    </MotionCard>
                                </Col>
                                <Col span={24}>
                                    <MotionCard style={{ borderRadius: 12 }}>
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={complianceDonut}
                                        />
                                    </MotionCard>
                                </Col>
                            </Row>
                        </Col>
                    </Row>
                </>
            )}
        </div>
    )
}

export default FunderDashboard
