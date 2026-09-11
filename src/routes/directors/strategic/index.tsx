import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Row,
    Col,
    Statistic,
    Table,
    Tag,
    Progress,
    Segmented,
    message
} from 'antd'
import { Helmet } from 'react-helmet'
import {
    ProjectOutlined,
    TeamOutlined,
    CheckCircleOutlined,
    PieChartOutlined,
    RiseOutlined
} from '@ant-design/icons'
import {
    collection,
    getDoc,
    getDocs,
    doc,
    query,
    where,
    DocumentData
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '@/firebase'
import { DashboardHeaderCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useActiveProgramId } from '@/lib/useActiveProgramId' // ← we use your hook

type SegKey = 'program' | 'kpis' | 'resources'

const fmtMoney = (v: number) =>
    new Intl.NumberFormat('en-ZA', {
        style: 'currency',
        currency: 'ZAR',
        minimumFractionDigits: 0
    }).format(v)

const periodKeyNow = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` // YYYY-MM
}

export default function StrategicDashboard() {
    const [seg, setSeg] = useState<SegKey>('program')
    const [loading, setLoading] = useState(false)

    const activeProgramId = useActiveProgramId() // program we should summarize

    // PROGRAM/RESOURCES
    const [programs, setPrograms] = useState<DocumentData[]>([])
    const [acceptedApps, setAcceptedApps] = useState(0)
    const [consultantsCount, setConsultantsCount] = useState(0)
    const [reqTotals, setReqTotals] = useState(0)
    const [reqApproved, setReqApproved] = useState(0)

    // KPI DATA (defs + targets + progress summary)
    const [kpiDefs, setKpiDefs] = useState<any[]>([])
    const [kpiTargets, setKpiTargets] = useState<Record<string, number>>({})
    const [kpiSummaryValues, setKpiSummaryValues] = useState<
        Record<string, number>
    >({})
    const [kpiSummaryRaw, setKpiSummaryRaw] = useState<Record<string, number>>({})

    const periodKey = useMemo(periodKeyNow, [])


    // 1) Load company-scoped program/resources + KPI defs/targets, and program-scoped KPI progress summary
    useEffect(() => {
        let cancelled = false

        const load = async () => {
            setLoading(true)
            try {
                const [
                    progSnap,
                    appsSnap,
                    consSnap,
                    reqSnap,
                    defsSnap,
                    tgtSnap,
                    progressSnap
                ] = await Promise.all([
                    getDocs(
                        query(
                            collection(db, 'programs'),
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'applications'),
                            where('applicationStatus', 'in', ['accepted', 'Accepted'])
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'consultants'),
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'resourceRequests'),
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'kpiDefinitions'),

                            where('active', '==', true)
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'kpiTargets'),

                            where('periodKey', '==', periodKey)
                        )
                    ),
                    getDoc(doc(db, 'kpiProgress', activeProgramId, 'summary', 'overview'))
                ])

                if (cancelled) return

                // Programs / resources
                setPrograms(progSnap.docs.map(d => ({ id: d.id, ...d.data() })))
                setAcceptedApps(appsSnap.size)
                setConsultantsCount(consSnap.size)

                const reqs = reqSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                setReqTotals(reqs.length)
                setReqApproved(
                    reqs.filter(r =>
                        String(r.status || '')
                            .toLowerCase()
                            .includes('approved')
                    ).length
                )

                // KPI defs (kpiLabel + unit [+ department, interventionIds])
                const defs = defsSnap.docs.map(d => {
                    const data = d.data() as any
                    return {
                        id: d.id,
                        name: data.kpiLabel || data.name || 'Unnamed KPI',
                        unit: data.unit || 'count',
                        department: data.department,
                        interventionIds: data.interventionIds || []
                    }
                })
                setKpiDefs(defs)

                // KPI targets (for the period)
                const tgtMap: Record<string, number> = {}
                tgtSnap.docs.forEach(d => {
                    const x = d.data() as any
                    const kid = x.kpiId
                    const t = Number(x.target || 0)
                    if (kid) tgtMap[kid] = t
                })
                setKpiTargets(tgtMap)

                // KPI progress summary for the active program
                if (progressSnap.exists()) {
                    const pd = progressSnap.data() as any
                    setKpiSummaryValues(pd.values || {})
                    setKpiSummaryRaw(pd.rawValues || {})
                } else {
                    setKpiSummaryValues({})
                    setKpiSummaryRaw({})
                }
            } catch (e) {
                console.error(e)
                message.error('Failed to load Strategic data')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [activeProgramId, periodKey])

    // Derivations
    const programCompliance = useMemo(() => {
        if (!programs.length) return 0
        const rates = programs
            .map(p => Number((p as any).compliancePct || 0))
            .filter(n => !Number.isNaN(n))
        return rates.length
            ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
            : 0
    }, [programs])

    const resourceUtilization = useMemo(() => {
        if (!reqTotals) return 0
        return Math.round((reqApproved / reqTotals) * 100)
    }, [reqTotals, reqApproved])

    // KPI rows based on your applyKpiDeltas design:
    // - unit === 'percent' → values[kpiId] already a %; target is 100.
    // - else → values[kpiId] is numeric; compare to kpiTargets[kpiId].
    const kpiRows = useMemo(() => {
        return kpiDefs.map(def => {
            const kpiId = def.id
            const unit = (def.unit || 'count').toLowerCase()
            const val = Number(kpiSummaryValues[kpiId] || 0)
            const raw = Number(kpiSummaryRaw[kpiId] || 0)
            const target = Number(kpiTargets[kpiId] || 0)

            if (unit === 'percent') {
                const pct = Math.max(0, Math.min(100, Math.round(val)))
                return {
                    key: kpiId,
                    name: def.name,
                    unit: '%',
                    targetDisplay: '100%',
                    actualDisplay: `${pct}%`,
                    progressPct: pct
                }
            } else {
                const progressPct =
                    target > 0 ? Math.min(100, Math.round((val / target) * 100)) : 0
                return {
                    key: kpiId,
                    name: def.name,
                    unit: def.unit,
                    targetDisplay:
                        def.unit?.toLowerCase() === 'zar'
                            ? fmtMoney(target)
                            : `${target} ${def.unit || ''}`,
                    actualDisplay:
                        def.unit?.toLowerCase() === 'zar'
                            ? fmtMoney(val)
                            : `${val} ${def.unit || ''}`,
                    // raw is available if you ever want to show it for context
                    progressPct
                }
            }
        })
    }, [kpiDefs, kpiTargets, kpiSummaryValues, kpiSummaryRaw])

    // UI sections
    const renderProgramOverview = () => (
        <>
            <Row gutter={[16, 16]}>
                <Col xs={24} md={6}>
                    <Card>
                        <Statistic
                            title='Total Programs'
                            value={programs.length}
                            prefix={<ProjectOutlined />}
                        />
                    </Card>
                </Col>
                <Col xs={24} md={6}>
                    <Card>
                        <Statistic
                            title='Accepted Incubatees'
                            value={acceptedApps}
                            prefix={<TeamOutlined />}
                        />
                    </Card>
                </Col>
                <Col xs={24} md={6}>
                    <Card>
                        <Statistic
                            title='Program Compliance'
                            value={programCompliance}
                            suffix='%'
                            prefix={<CheckCircleOutlined />}
                        />
                    </Card>
                </Col>
                <Col xs={24} md={6}>
                    <Card>
                        <Statistic
                            title='Consultants'
                            value={consultantsCount}
                            prefix={<TeamOutlined />}
                        />
                    </Card>
                </Col>
            </Row>

            <Card title='Incubation Programs' style={{ marginTop: 16 }}>
                <Table dataSource={programs} rowKey='id' pagination={false}>
                    <Table.Column title='Program' dataIndex='name' />
                    <Table.Column title='Type' dataIndex='type' />
                    <Table.Column
                        title='Progress'
                        dataIndex='progress'
                        render={(p: number) => (
                            <Progress
                                percent={Math.round(Number(p || 0))}
                                size='small'
                                status={
                                    Number(p || 0) < 50
                                        ? 'exception'
                                        : Number(p || 0) < 80
                                            ? 'active'
                                            : 'success'
                                }
                            />
                        )}
                    />
                    <Table.Column
                        title='Status'
                        dataIndex='status'
                        render={(status: string) => (
                            <Tag
                                color={
                                    status === 'Active'
                                        ? 'green'
                                        : status === 'Completed'
                                            ? 'blue'
                                            : 'orange'
                                }
                            >
                                {status || 'Unknown'}
                            </Tag>
                        )}
                    />
                </Table>
            </Card>
        </>
    )

    const renderKPIs = () => (
        <Card title='Key Performance Indicators'>
            <Table dataSource={kpiRows} rowKey='key' pagination={false}>
                <Table.Column title='KPI' dataIndex='name' />
                <Table.Column title='Target' dataIndex='targetDisplay' />
                <Table.Column title='Actual' dataIndex='actualDisplay' />
                <Table.Column
                    title='Progress'
                    render={(r: any) => (
                        <Progress
                            percent={r.progressPct}
                            size='small'
                            status={
                                r.progressPct >= 100
                                    ? 'success'
                                    : r.progressPct < 80
                                        ? 'exception'
                                        : 'active'
                            }
                        />
                    )}
                />
            </Table>
        </Card>
    )

    const renderResources = () => (
        <>
            <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                    <Card>
                        <Statistic
                            title='Resource Utilization'
                            value={resourceUtilization}
                            suffix='%'
                            prefix={<PieChartOutlined />}
                            valueStyle={{
                                color: resourceUtilization >= 80 ? '#3f8600' : undefined
                            }}
                        />
                    </Card>
                </Col>
                <Col xs={24} md={8}>
                    <Card>
                        <Statistic
                            title='Total Requests'
                            value={reqTotals}
                            prefix={<ProjectOutlined />}
                        />
                    </Card>
                </Col>
                <Col xs={24} md={8}>
                    <Card>
                        <Statistic
                            title='Approved Requests'
                            value={reqApproved}
                            prefix={<CheckCircleOutlined />}
                        />
                    </Card>
                </Col>
            </Row>
        </>
    )

    return (
        <div style={{ minHeight: '100vh', padding: 24 }}>
            <Helmet>
                <title>Strategic Dashboard</title>
            </Helmet>

            <DashboardHeaderCard
                title='Strategic Dashboard'
                subtitle='Programs, KPIs, and Resource Utilization'
                extraRight={
                    <Segmented<SegKey>
                        value={seg}
                        onChange={v => setSeg(v as SegKey)}
                        options={[
                            { label: 'Program', value: 'program', icon: <ProjectOutlined /> },
                            { label: 'KPIs', value: 'kpis', icon: <RiseOutlined /> },
                            {
                                label: 'Resources',
                                value: 'resources',
                                icon: <PieChartOutlined />
                            }
                        ]}
                    />
                }
            />

            {loading && <LoadingOverlay />}

            {!loading && (
                <>
                    {seg === 'program' && renderProgramOverview()}
                    {seg === 'kpis' && renderKPIs()}
                    {seg === 'resources' && renderResources()}
                </>
            )}
        </div>
    )
}
