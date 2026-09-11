import React, { useEffect, useMemo, useRef, useState } from 'react'
import { computeSmeCompletedInterventionIds } from '@/services/assignmentLifecycleService'
import {
    Card,
    Col,
    Row,
    Table,
    Tag,
    Typography,
    Button,
    Drawer,
    Space,
    Empty,
    Spin,
    Select,
    Input,
    message,
    Modal
} from 'antd'
import {
    EyeOutlined,
    ReloadOutlined,
    TeamOutlined,
    FieldTimeOutlined,
    ApartmentOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import DrilldownModule from 'highcharts/modules/drilldown'
import dayjs from 'dayjs'

// Ensure drilldown safe-init
if (typeof DrilldownModule === 'function') DrilldownModule(Highcharts)

// Firebase
import { db } from '@/firebase'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where,
    Unsubscribe
} from 'firebase/firestore'

// Project hooks/components
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    MotionCard,
    DashboardHeaderCard
} from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { Helmet } from 'react-helmet'

const { Text, Title } = Typography
const { Option } = Select

// ---------- Utils ----------
const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
]

const visibleMonths = MONTHS.slice(0, dayjs().month() + 1)

export function safeArr<T>(v: ReadonlyArray<T> | null | undefined): T[] {
    return Array.isArray(v) ? [...v] : []
}
export function norm(v?: string | null): string {
    return (v ?? '').trim().toLowerCase()
}
export function chunk<T>(arr: ReadonlyArray<T>, size = 10): T[][] {
    const s = Math.max(1, Math.floor(size))
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += s) out.push(arr.slice(i, i + s))
    return out
}
function countFromUnknown(x: unknown): number {
    if (!x) return 0
    if (Array.isArray(x)) return x.length
    if (typeof x === 'object')
        return Object.keys(x as Record<string, unknown>).length
    if (typeof x === 'number') return Math.max(0, Math.floor(x))
    return 0
}

const currentYear = dayjs().year()

// ---------- Types ----------
type Application = {
    id: string
    | null
    programId?: string | null
    applicationStatus?: string | null
    participantId?: string | null
    email?: string | null
    interventions?: { required?: unknown; completed?: unknown } | null
}

type Participant = {
    id: string
    beneficiaryName?: string | null
    gender?: string | null
    sector?: string | null
    beeLevel?: string | number | null
    businessAddress?: string | null
    email?: string | null
    phone?: string | null
    | null
    headcountHistory?: {
        monthly?: Record<string, { permanent?: number; temporary?: number }>
    }
    revenueHistory?: {
        monthly?: Record<string, number>
    }
}

type AssignedIntervention = {
    id: string
    programId?: string | null
    participantId?: string | null
    interventionId?: string | null
    status?: string | null
}

type InterventionMeta = {
    id: string
    interventionId?: string | null
    areaOfSupport?: string | null
    interventionTitle?: string | null
    hasSubInterventions?: boolean
    subInterventions?: any[]
}

type RowData = {
    id: string
    name: string
    gender: string
    sector: string
    participant: Participant
}

// ---------- Extractors ----------
function monthlyHeadcountSeries(p: Participant) {
    const m = p?.headcountHistory?.monthly || {}

    return visibleMonths.map(label => {
        const v = (m as any)[label] || {}
        const perm = Number(v?.permanent || 0)
        const temp = Number(v?.temporary || 0)

        return (
            (Number.isFinite(perm) ? perm : 0) +
            (Number.isFinite(temp) ? temp : 0)
        )
    })
}

function monthlyRevenueSeries(p: Participant) {
    const m = p?.revenueHistory?.monthly || {}

    return visibleMonths.map(label => {
        const v = Number((m as any)[label] || 0)
        return Number.isFinite(v) ? v : 0
    })
}

// --- Metric Card ---
const MetricCard: React.FC<{
    title: string
    value: React.ReactNode
    icon: React.ReactNode
    iconBg?: string
}> = ({ title, value, icon, iconBg = '#e6f4ff' }) => (
    <MotionCard
        style={{ borderRadius: 16 }}
        bodyStyle={{ padding: 16 }}
        initial={{ y: 0, opacity: 0.96 }}
        whileHover={{ y: -4, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 20 }}
    >
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

// ---------- Component ----------
const IncubateesOverview: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const [programName, setProgramName] = useState<string | null>(null)

    // fine-grained ready flags so we only release overlay when *everything* is in
    const [readyProgram, setReadyProgram] = useState(false)
    const [readyRows, setReadyRows] = useState(false)
    const [readyAI, setReadyAI] = useState(false)

    // base loading used by table skeleton (after overlay lifts)
    const [loadingTable, setLoadingTable] = useState(true)

    // data
    const [apps, setApps] = useState<Application[]>([])
    const [rows, setRows] = useState<RowData[]>([])
    const [selected, setSelected] = useState<Participant | null>(null)
    const [modalOpen, setModalOpen] = useState(false)

    // intervention data
    const [aiByParticipant, setAiByParticipant] = useState<
        Record<string, AssignedIntervention[]>
    >({})
    const [metaByInterventionId, setMetaByInterventionId] = useState<
        Record<string, InterventionMeta>
    >({})

    // filters
    const [sectorFilter, setSectorFilter] = useState<string>('All')
    const [genderFilter, setGenderFilter] = useState<string>('All')
    const [search, setSearch] = useState<string>('')

    const appsUnsubRef = useRef<Unsubscribe | null>(null)
    const aiUnsubRef = useRef<Unsubscribe | null>(null)

    // Program name
    useEffect(() => {
        setReadyProgram(false)
        if (!activeProgramId) {
            setProgramName(null)
            setReadyProgram(true)
            return
        }
        ; (async () => {
            try {
                const ref = doc(db, 'programs', activeProgramId)
                const snap = await getDoc(ref)
                setProgramName(
                    snap.exists()
                        ? (snap.data() as any)?.name ||
                        (snap.data() as any)?.programName ||
                        activeProgramId
                        : activeProgramId
                )
            } catch {
                setProgramName(activeProgramId)
            } finally {
                setReadyProgram(true)
            }
        })()
    }, [activeProgramId])

    // Subscribe apps -> resolve participants
    useEffect(() => {
        if (identityLoading) return

        // reset state for this cycle
        setReadyRows(false)
        setLoadingTable(true)

        if (!activeProgramId) {
            setApps([])
            setRows([])
            setLoadingTable(false)
            setReadyRows(true)
            return
        }
        if (appsUnsubRef.current) {
            appsUnsubRef.current()
            appsUnsubRef.current = null
        }

        const appsQ = query(
            collection(db, 'applications'),
            where('programId', '==', activeProgramId),
            where('applicationStatus', 'in', ['accepted', 'Accepted'])
        )

        appsUnsubRef.current = onSnapshot(
            appsQ,
            async snap => {
                try {
                    const _apps: Application[] = snap.docs.map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    }))
                    setApps(_apps)

                    // Resolve participants
                    const parts: Participant[] = []
                    await Promise.all(
                        _apps.map(async a => {
                            let p: Participant | null = null
                            if (a.participantId) {
                                const pRef = doc(db, 'participants', a.participantId)
                                const pSnap = await getDoc(pRef)
                                if (pSnap.exists())
                                    p = { id: pSnap.id, ...(pSnap.data() as any) }
                            }
                            if (!p && a.email) {
                                const pQ = query(
                                    collection(db, 'participants'),
                                    where('email', '==', a.email)
                                )
                                const pRes = await getDocs(pQ)
                                if (!pRes.empty) {
                                    const d = pRes.docs[0]
                                    p = { id: d.id, ...(d.data() as any) }
                                }
                            }
                            if (p) parts.push(p)
                        })
                    )

                    const unique = new Map<string, Participant>()
                    for (const p of parts) unique.set(p.id, p)

                    const nextRows: RowData[] = Array.from(unique.values()).map(p => ({
                        id: p.id,
                        name: p.beneficiaryName || 'Unknown',
                        gender: p.gender || '—',
                        sector: p.sector || '—',
                        participant: p
                    }))
                    nextRows.sort((a, b) => a.name.localeCompare(b.name))

                    setRows(nextRows)
                    setLoadingTable(false)
                    setReadyRows(true)
                } catch (err) {
                    console.error(err)
                    message.error('Failed to load incubatees.')
                    setApps([])
                    setRows([])
                    setLoadingTable(false)
                    setReadyRows(true)
                }
            },
            err => {
                console.error(err)
                message.error('Failed to subscribe to applications.')
                setApps([])
                setRows([])
                setLoadingTable(false)
                setReadyRows(true)
            }
        )

        return () => {
            if (appsUnsubRef.current) {
                appsUnsubRef.current()
                appsUnsubRef.current = null
            }
        }
    }, [identityLoading, activeProgramId])

    // assignedInterventions (grouped) + intervention metas
    useEffect(() => {
        setReadyAI(false)
        if (!activeProgramId) {
            setAiByParticipant({})
            setMetaByInterventionId({})
            setReadyAI(true)
            return
        }
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
            async snap => {
                try {
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

                    const ints = Array.from(
                        new Set(list.map(x => x.interventionId).filter(Boolean))
                    ) as string[]
                    if (ints.length === 0) {
                        setMetaByInterventionId({})
                        setReadyAI(true)
                        return
                    }

                    const allMetas: Record<string, InterventionMeta> = {}

                    await Promise.all(
                        ints.map(async interventionId => {
                            try {
                                let snap = await getDoc(doc(db, 'interventions', interventionId))

                                const data = snap.exists() ? (snap.data() as any) : {}

                                allMetas[interventionId] = {
                                    id: snap.id,
                                    interventionId,
                                    areaOfSupport:
                                        data.areaOfSupport ||
                                        data.departmentName ||
                                        data.department ||
                                        data.departmentDisplayName ||
                                        'Unknown',
                                    interventionTitle:
                                        data.interventionTitle ||
                                        data.title ||
                                        data.name ||
                                        'Untitled intervention',
                                    hasSubInterventions: !!data.hasSubInterventions,
                                    subInterventions: Array.isArray(data.subInterventions) ? data.subInterventions : []
                                }
                            } catch (err) {
                                console.error('[Meta fetch error]', interventionId, err)
                            }
                        })
                    )

                    setMetaByInterventionId(allMetas)

                    setMetaByInterventionId(allMetas)
                    setMetaByInterventionId(allMetas)
                    setReadyAI(true)
                } catch (err) {
                    console.error(err)
                    message.error('Failed to load interventions metadata.')
                    setReadyAI(true)
                }
            },
            err => {
                console.error(err)
                message.error('Failed to subscribe to assigned interventions.')
                setReadyAI(true)
            }
        )

        return () => {
            if (aiUnsubRef.current) {
                aiUnsubRef.current()
                aiUnsubRef.current = null
            }
        }
    }, [activeProgramId])

    // ---------- Metrics ----------
    const totalSMEs = apps.length

    const interventionsSummary = useMemo(() => {
        let required = 0
        for (const a of apps) {
            required += countFromUnknown(a.interventions?.required)
        }
        // A completed assignment only means the whole intervention is done
        // when it has no sub-interventions - otherwise every active
        // sub-intervention needs its own completed assignment first.
        const completed = Object.values(aiByParticipant).reduce(
            (acc, list) => acc + computeSmeCompletedInterventionIds(list, metaByInterventionId).size,
            0
        )
        return { required, completed }
    }, [apps, aiByParticipant, metaByInterventionId])

    const mostCommonSector = useMemo(() => {
        const counts = new Map<string, number>()
        rows.forEach(r => {
            const key = r.sector || 'Unknown'
            counts.set(key, (counts.get(key) || 0) + 1)
        })
        let best = 'Unknown',
            bestCount = -1
        for (const [k, v] of counts.entries()) {
            if (v > bestCount) {
                best = k
                bestCount = v
            }
        }
        return { sector: best, count: Math.max(bestCount, 0) }
    }, [rows])

    // ---------- Filters ----------
    const sectorOptions = useMemo(() => {
        const set = new Set<string>(['All'])
        rows.forEach(r => set.add(r.sector || '—'))
        return Array.from(set)
    }, [rows])

    const genderOptions = useMemo(() => {
        const set = new Set<string>(['All'])
        rows.forEach(r => set.add(r.gender || '—'))
        return Array.from(set)
    }, [rows])

    const filteredRows = useMemo(() => {
        return rows.filter(r => {
            if (sectorFilter !== 'All' && r.sector !== sectorFilter) return false
            if (genderFilter !== 'All' && r.gender !== genderFilter) return false
            if (search && !r.name.toLowerCase().includes(search.toLowerCase()))
                return false
            return true
        })
    }, [rows, sectorFilter, genderFilter, search])

    // ---------- Table ----------
    const columns = useMemo(() => {
        return [
            { title: 'Name', dataIndex: 'name' },
            {
                title: 'Contact',
                key: 'contact',
                width: 260,
                render: (_: any, rec: RowData) => {
                    const phone =
                        rec.participant.phone ||
                        '—'

                    const email = rec.participant.email || '—'

                    return (
                        <Space direction='vertical' size={0}>
                            <Text>{phone}</Text>
                            <Text type='secondary'>{email}</Text>
                        </Space>
                    )
                }
            },
            {
                title: 'Gender',
                dataIndex: 'gender',
                width: 140,
                render: (g: string) => <Tag>{g || '—'}</Tag>
            },
            { title: 'Sector', dataIndex: 'sector' },
            {
                title: 'Action',
                key: 'action',
                width: 120,
                render: (_: any, rec: RowData) => (
                    <Button
                        shape='round'
                        icon={<EyeOutlined />}
                        onClick={() => {
                            setSelected(rec.participant)
                            setModalOpen(true)
                        }}
                    >
                        View
                    </Button>
                )
            }
        ]
    }, [])

    const refresh = () => {
        // soft refresh: re-trigger filteredRows memo by cloning
        setRows(r => [...r])
    }

    // ---------- Drawer charts ----------
    const headcountOptions: Highcharts.Options = useMemo(() => {
        const data = selected
            ? monthlyHeadcountSeries(selected)
            : MONTHS.map(() => 0)
        return {
            chart: { type: 'line', height: 250, backgroundColor: 'transparent' },
            title: { text: 'Headcount (MoM)' },
            xAxis: { categories: visibleMonths },
            yAxis: { title: { text: 'Employees' }, allowDecimals: false },
            series: [{ type: 'line', name: 'Headcount', data }],
            credits: { enabled: false }
        }
    }, [selected])

    const revenueOptions: Highcharts.Options = useMemo(() => {
        const data = selected ? monthlyRevenueSeries(selected) : MONTHS.map(() => 0)
        return {
            chart: { type: 'line', height: 250, backgroundColor: 'transparent' },
            title: { text: 'Turnover (MoM)' },
            xAxis: { categories: visibleMonths },
            yAxis: { title: { text: 'ZAR' } },
            tooltip: {
                pointFormatter: function () {
                    return `R ${Number(this.y).toLocaleString()}`
                }
            },
            series: [{ type: 'line', name: 'Revenue', data }],
            credits: { enabled: false }
        }
    }, [selected])

    function interventionStatusMeta(status?: string | null) {
        const s = norm(status)

        if (s === 'completed') {
            return { label: 'Completed', color: '#52c41a' }
        }

        if (s === 'overdue') {
            return { label: 'Overdue', color: '#ff4d4f' }
        }

        return { label: 'Pending', color: '#faad14' }
    }

    const interventionsOptions: Highcharts.Options = useMemo(() => {
        const pid = selected?.id || ''
        const items = safeArr(aiByParticipant[pid])

        const deptMap = new Map<string, AssignedIntervention[]>()

        for (const ai of items) {
            const meta = metaByInterventionId[ai.interventionId || '']
            const dept = meta?.areaOfSupport || 'Unknown'

            if (!deptMap.has(dept)) deptMap.set(dept, [])
            deptMap.get(dept)!.push(ai)
        }

        const departmentData: Highcharts.PointOptionsObject[] = []
        const drilldownSeries: Highcharts.SeriesOptionsType[] = []

        Array.from(deptMap.entries()).forEach(([dept, deptItems], index) => {
            const total = deptItems.length
            const drilldownId = `dept-${index}`

            departmentData.push({
                name: `${dept} (${total})`,
                y: total,
                color: '#1677ff',
                drilldown: drilldownId
            })

            const interventionCounts = new Map<
                string,
                { title: string; status: string; count: number; color: string }
            >()

            for (const ai of deptItems) {
                const meta = metaByInterventionId[ai.interventionId || '']
                const status = norm(ai.assignmentStatus)

                const statusLabel =
                    status === 'completed'
                        ? 'Completed'
                        : status === 'overdue'
                            ? 'Overdue'
                            : 'Pending'

                const color =
                    status === 'completed'
                        ? '#52c41a'
                        : status === 'overdue'
                            ? '#ff4d4f'
                            : '#faad14'

                const title =
                    meta?.interventionTitle ||
                    ai.interventionId ||
                    'Untitled intervention'

                const key = `${title}__${statusLabel}`

                const existing = interventionCounts.get(key)

                if (existing) {
                    existing.count += 1
                } else {
                    interventionCounts.set(key, {
                        title,
                        status: statusLabel,
                        count: 1,
                        color
                    })
                }
            }

            const drillData = Array.from(interventionCounts.values()).map(item => ({
                name: `${item.title} (${item.status})`,
                y: item.count,
                color: item.color
            }))

            drilldownSeries.push({
                type: 'bar',
                id: drilldownId,
                name: dept,
                data: drillData
            } as any)
        })

        return {
            chart: {
                type: 'bar',
                height: 420,
                backgroundColor: 'transparent'
            },
            title: { text: 'Interventions by Department' },
            subtitle: {
                useHTML: true,
                text:
                    'Click a department to view interventions<br/>' +
                    '<span style="color:#52c41a;font-weight:700">Green</span> Completed • ' +
                    '<span style="color:#faad14;font-weight:700">Amber</span> Pending • ' +
                    '<span style="color:#ff4d4f;font-weight:700">Red</span> Overdue'
            },
            legend: { enabled: false },
            xAxis: {
                type: 'category',
                title: { text: undefined }
            },
            yAxis: {
                min: 0,
                allowDecimals: false,
                title: { text: 'Interventions' }
            },
            tooltip: {
                pointFormatter: function () {
                    return `<b>${this.name}</b><br/>${this.y} intervention`
                }
            },
            plotOptions: {
                series: {
                    borderRadius: 4,
                    dataLabels: {
                        enabled: true,
                        format: '{point.y}',
                        crop: false,
                        overflow: 'allow',
                        style: {
                            fontWeight: '700',
                            textOutline: 'none'
                        }
                    }
                }
            },
            series: [
                {
                    type: 'bar',
                    name: 'Departments',
                    data: departmentData
                }
            ],
            drilldown: {
                breadcrumbs: {
                    position: { align: 'right' }
                },
                series: drilldownSeries
            },
            credits: { enabled: false }
        }
    }, [selected, aiByParticipant, metaByInterventionId])

    // ---------- Overlay gate ----------
    const allReady = !identityLoading && readyProgram && readyRows && readyAI

    if (!allReady) {
        return (
            <div style={{ minHeight: '100vh' }}>
                <LoadingOverlay tip='Loading incubatees and interventions' />
            </div>
        )
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>SMEs Overview | Smart Incubation</title>
            </Helmet>

            {/* Metrics */}
            <Row gutter={[16, 16]} style={{ marginTop: 4 }}>
                <Col xs={24} md={8}>
                    <MetricCard
                        title='Total SMEs'
                        value={totalSMEs}
                        icon={<TeamOutlined style={{ fontSize: 22 }} />}
                        iconBg='#f6ffed'
                    />
                </Col>

                <Col xs={24} md={8}>
                    <MetricCard
                        title='Most Common Sector'
                        value={
                            <>
                                {mostCommonSector.sector}{' '}
                                <Text type='secondary'>({mostCommonSector.count})</Text>
                            </>
                        }
                        icon={<ApartmentOutlined style={{ fontSize: 22 }} />}
                        iconBg='#fff7e6'
                    />
                </Col>

                <Col xs={24} md={8}>
                    <MetricCard
                        title='Interventions (Required : Completed)'
                        value={`${interventionsSummary.required} : ${interventionsSummary.completed}`}
                        icon={<FieldTimeOutlined style={{ fontSize: 22 }} />}
                        iconBg='#e6f7ff'
                    />
                </Col>
            </Row>

            {/* Table */}
            <MotionCard
                style={{
                    marginTop: 16,
                    borderRadius: 12
                }}
                filterBar={
                    <Row gutter={[12, 12]} align='middle'>
                        <Col xs={24} sm={24} md={8} lg={8}>
                            <Input.Search
                                placeholder='Search by name'
                                allowClear
                                value={search}
                                onSearch={setSearch}
                                onChange={e => setSearch(e.target.value)}
                                style={{ width: '100%' }}
                            />
                        </Col>

                        <Col xs={24} sm={12} md={6} lg={5}>
                            <Select
                                value={sectorFilter}
                                onChange={setSectorFilter}
                                style={{ width: '100%' }}
                            >
                                {sectorOptions.map(opt => (
                                    <Option key={opt} value={opt}>
                                        {opt}
                                    </Option>
                                ))}
                            </Select>
                        </Col>

                        <Col xs={24} sm={12} md={6} lg={5}>
                            <Select
                                value={genderFilter}
                                onChange={setGenderFilter}
                                style={{ width: '100%' }}
                            >
                                {genderOptions.map(opt => (
                                    <Option key={opt} value={opt}>
                                        {opt}
                                    </Option>
                                ))}
                            </Select>
                        </Col>

                        <Col xs={24} md={4} lg={6}>
                            <Button
                                block
                                shape='round'
                                icon={<ReloadOutlined />}
                                onClick={refresh}
                                style={{ border: '1px solid dodgerblue' }}
                            >
                                Refresh
                            </Button>
                        </Col>
                    </Row>
                }
            >
                {loadingTable ? (
                    <div
                        style={{
                            height: 300,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <Spin size='large' />
                    </div>
                ) : filteredRows.length === 0 ? (
                    <Empty description='No incubatees match the current filters.' />
                ) : (
                    <Table<RowData>
                        rowKey='id'
                        dataSource={filteredRows}
                        columns={columns as any}
                        pagination={{ pageSize: 12 }}
                    />
                )}
            </MotionCard>

            {/* Drawer */}
            <Modal
                width={1000}
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                footer={null}
                title={selected?.beneficiaryName || 'Incubatee'}
                centered
            >
                {!selected ? (
                    <Empty />
                ) : (
                    <Space direction='vertical' size='large' style={{ width: '100%' }}>
                        <Card>
                            <Row gutter={[16, 16]}>
                                <Col xs={24} md={12}>
                                    <Space direction='vertical'>
                                        <Text type='secondary'>BBBEE Level</Text>
                                        <Tag color='blue'>{selected.beeLevel ?? '—'}</Tag>
                                    </Space>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Space direction='vertical'>
                                        <Text type='secondary'>Business Address</Text>
                                        <Text>{selected.businessAddress || '—'}</Text>
                                    </Space>
                                </Col>
                            </Row>
                        </Card>

                        <Row gutter={[16, 16]}>
                            <Col xs={24} md={12}>
                                <Card>
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        options={headcountOptions}
                                    />
                                </Card>
                            </Col>
                            <Col xs={24} md={12}>
                                <Card>
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        options={revenueOptions}
                                    />
                                </Card>
                            </Col>
                        </Row>

                        <Card>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={interventionsOptions}
                            />
                        </Card>
                    </Space>
                )}
            </Modal>
        </div>
    )
}

export default IncubateesOverview
