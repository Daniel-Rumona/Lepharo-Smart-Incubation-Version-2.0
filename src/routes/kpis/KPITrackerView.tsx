import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    DatePicker,
    Empty,
    InputNumber,
    Progress,
    Result,
    Row,
    Segmented,
    Select,
    Skeleton,
    Space,
    Tag,
    Tooltip,
    Typography,
    theme,
    message
} from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { Link } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { computeKpi } from '@/services/kpiCalculationService'
import dayjs, { Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { CheckCircleOutlined, AimOutlined, WarningOutlined, QuestionCircleOutlined, SaveOutlined, LineChartOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'

const { Option } = Select
const { Text } = Typography
const { RangePicker } = DatePicker

dayjs.extend(quarterOfYear)

type Unit = 'count' | 'ZAR' | 'percent' | 'text'
type SourceType = 'applications' | 'interventions' | 'metrics'
type CalculationType = 'count' | 'sum' | 'average' | 'ratio'
type CountMode = 'records' | 'distinct'
type TargetPeriodType = 'monthly' | 'quarterly'

type KpiFilter = { field: string; op: '==' | '!=' | 'in'; value: any }
type RatioPartConfig = { calculationType: 'count_records' | 'sum_field' | 'avg_field'; field?: string | null; filters: KpiFilter[] }

type KpiDef = {
    id: string
    department: string
    kpiLabel: string
    unit: Unit
    sourceType: SourceType
    calculationType: CalculationType
    countMode?: CountMode | null
    field?: string | null
    filters?: KpiFilter[]
    interventionIds?: string[]
    numerator?: RatioPartConfig | null
    denominator?: RatioPartConfig | null
    appliesToAllPrograms?: boolean
    programId?: string | null
    trackingMode: 'computed' | 'manual'
}

type LatestTarget = {
    id: string
    target: number
    periodKey: string
    periodType: TargetPeriodType
    actual?: number | null
}

type KpiRowStatus = 'achieved' | 'on-track' | 'needs-attention' | 'no-target' | 'awaiting-update'

type KpiRow = {
    def: KpiDef
    periodKey: string | null
    targetId: string | null
    target: number | null
    actual: number | null
    achievementPercent: number | null
    status: KpiRowStatus
}

type MonthlySeriesPoint = { monthKey: string; values: Record<string, number | null> }

const STATUS_META: Record<KpiRowStatus, { label: string; color: string; icon: React.ReactNode }> = {
    achieved: { label: 'Achieved', color: 'green', icon: <CheckCircleOutlined /> },
    'on-track': { label: 'On track', color: 'blue', icon: <AimOutlined /> },
    'needs-attention': { label: 'Needs attention', color: 'red', icon: <WarningOutlined /> },
    'no-target': { label: 'No target set', color: 'default', icon: <QuestionCircleOutlined /> },
    'awaiting-update': { label: 'Awaiting update', color: 'orange', icon: <QuestionCircleOutlined /> }
}

const buildMonthKeys = (range: [Dayjs, Dayjs]) => {
    const start = range[0].startOf('month')
    const end = range[1].startOf('month')
    const keys: string[] = []
    let cursor = start.clone()
    while (cursor.isBefore(end) || cursor.isSame(end, 'month')) {
        keys.push(cursor.format('YYYY-MM'))
        cursor = cursor.add(1, 'month')
    }
    return keys
}

const KPITrackerView: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { token } = theme.useToken()

    const [department, setDepartment] = useState<string>('')
    const [isMainDept, setIsMainDept] = useState(false)
    const [allDepartments, setAllDepartments] = useState<string[]>([])
    const [viewMode, setViewMode] = useState<'mine' | 'all'>('mine')
    const [viewPeriod, setViewPeriod] = useState<Dayjs>(dayjs().startOf('month'))

    const [defsByDept, setDefsByDept] = useState<Record<string, KpiDef[]>>({})
    const [targetsByKpi, setTargetsByKpi] = useState<Record<string, LatestTarget[]>>({})
    const [defsLoading, setDefsLoading] = useState(true)

    const [rows, setRows] = useState<KpiRow[]>([])
    const [rowsLoading, setRowsLoading] = useState(false)

    const [deptSnapshots, setDeptSnapshots] = useState<Record<string, { total: number; achieved: number }>>({})
    const [deptSnapshotsLoading, setDeptSnapshotsLoading] = useState(false)

    const [manualActualDrafts, setManualActualDrafts] = useState<Record<string, number | null>>({})
    const [savingManualTargetId, setSavingManualTargetId] = useState<string | null>(null)

    const [compareKpiIds, setCompareKpiIds] = useState<string[]>([])
    const [compareRange, setCompareRange] = useState<[Dayjs, Dayjs]>([
        dayjs().subtract(5, 'month').startOf('month'),
        dayjs().endOf('month')
    ])
    const [compareSeries, setCompareSeries] = useState<MonthlySeriesPoint[]>([])
    const [compareLoading, setCompareLoading] = useState(false)
    const [compareView, setCompareView] = useState<'performance' | 'actual'>('performance')

    // ---- who am I, which department(s) can I see ----
    useEffect(() => {
        if (identityLoading || !user) return
        ;(async () => {
            try {
                if (user.departmentId) {
                    const snap = await getDocs(collection(db, 'departments'))
                    const deptDoc = snap.docs.find(d => d.id === user.departmentId)
                    const dept = deptDoc?.data() as any
                    if (dept) {
                        const main = Boolean(dept.isMain)
                        setIsMainDept(main)
                        setDepartment(String(dept.name || '').trim())
                        if (main) {
                            setAllDepartments(snap.docs.map(d => String(d.data()?.name || '').trim()).filter(Boolean))
                        }
                        return
                    }
                }
                setDepartment(String(user.departmentName || '').trim())
            } catch (err) {
                console.error(err)
            }
        })()
    }, [identityLoading, user])

    // ---- all KPI definitions + all their targets, loaded once ----
    useEffect(() => {
        if (identityLoading) return
        if (!user) { setDefsLoading(false); return }
        ;(async () => {
            setDefsLoading(true)
            try {
                const defsSnap = await getDocs(collection(db, 'kpiDefinitions'))
                const defs: KpiDef[] = defsSnap.docs
                    .filter(d => (d.data() as any).active !== false)
                    .map(d => {
                        const data = d.data() as any
                        return {
                            id: d.id,
                            department: String(data.department || '').trim(),
                            kpiLabel: String(data.kpiLabel || d.id),
                            unit: (data.unit || 'count') as Unit,
                            sourceType: data.sourceType as SourceType,
                            calculationType: data.calculationType as CalculationType,
                            countMode: (data.countMode || 'records') as CountMode,
                            field: data.field || null,
                            filters: Array.isArray(data.filters) ? data.filters : [],
                            interventionIds: Array.isArray(data.interventionIds) ? data.interventionIds : [],
                            numerator: data.numerator || null,
                            denominator: data.denominator || null,
                            appliesToAllPrograms: !!data.appliesToAllPrograms,
                            programId: data.programId || null,
                            trackingMode: data.trackingMode === 'manual' ? 'manual' : 'computed'
                        }
                    })

                const grouped: Record<string, KpiDef[]> = {}
                defs.forEach(def => {
                    if (!def.department) return
                    if (!grouped[def.department]) grouped[def.department] = []
                    grouped[def.department].push(def)
                })
                setDefsByDept(grouped)
                if (!allDepartments.length) setAllDepartments(Object.keys(grouped).sort())

                const targetSnap = await getDocs(collection(db, 'kpiTargets'))
                const byKpi: Record<string, LatestTarget[]> = {}
                targetSnap.docs.forEach(d => {
                    const row = d.data() as any
                    const target: LatestTarget = {
                        id: d.id,
                        target: Number(row.target || 0),
                        periodKey: row.periodKey,
                        periodType: row.periodType as TargetPeriodType,
                        actual: row.actual === undefined || row.actual === null ? null : Number(row.actual)
                    }
                    if (!byKpi[row.kpiId]) byKpi[row.kpiId] = []
                    byKpi[row.kpiId].push(target)
                })
                setTargetsByKpi(byKpi)
            } catch (err) {
                console.error(err)
                message.error('Failed to load KPI definitions and targets.')
            } finally {
                setDefsLoading(false)
            }
        })()
    }, [identityLoading, user])

    // A KPI only belongs "in view" when its own program matches the app's
    // active program (or it applies to every program) - this is what was
    // previously missing, so KPIs from an unrelated program showed up here
    // and got computed against the wrong program's data.
    const visibleDefsForDept = (deptName: string) =>
        (defsByDept[deptName] || []).filter(
            def => isAllPrograms || def.appliesToAllPrograms || def.programId === activeProgramId
        )

    const targetForPeriod = (kpiId: string, monthKey: string) => {
        const rows = targetsByKpi[kpiId] || []
        const quarterlyKey = `${dayjs(monthKey).year()}-Q${dayjs(monthKey).quarter()}`
        return rows.find(row => row.periodType === 'monthly' && row.periodKey === monthKey)
            || rows.find(row => row.periodType === 'quarterly' && row.periodKey === quarterlyKey)
            || null
    }

    const classify = (target: number | null, actual: number | null): KpiRowStatus | null => {
        if (target == null || target === 0) return null
        if (actual == null) return null
        if (actual >= target) return 'achieved'
        if (actual >= 0.8 * target) return 'on-track'
        return 'needs-attention'
    }

    const computeRow = async (def: KpiDef, monthKey: string): Promise<KpiRow> => {
        const targetInfo = targetForPeriod(def.id, monthKey)
        const target = targetInfo?.target ?? null

        if (def.trackingMode === 'manual') {
            const actual = targetInfo?.actual ?? null
            const status: KpiRowStatus = !targetInfo ? 'no-target' : actual == null ? 'awaiting-update' : (classify(target, actual) || 'needs-attention')
            return {
                def,
                periodKey: targetInfo?.periodKey ?? null,
                targetId: targetInfo?.id ?? null,
                target,
                actual,
                achievementPercent: target && actual != null ? Math.round((actual / target) * 100) : null,
                status
            }
        }

        try {
            const result = await computeKpi({
                kpi: {
                    id: def.id,
                    sourceType: def.sourceType,
                    calculationType: def.calculationType,
                    field: def.field || null,
                    filters: def.filters || [],
                    interventionIds: def.interventionIds || [],
                    numerator: def.numerator || null,
                    denominator: def.denominator || null,
                    countMode: (def.countMode || 'records') as CountMode,
                    appliesToAllPrograms: !!def.appliesToAllPrograms
                },
                // Compute against this KPI's own program, never whichever
                // program happens to be globally active right now.
                programId: def.appliesToAllPrograms ? null : (def.programId || null),
                isAllPrograms: !!def.appliesToAllPrograms,
                periodType: 'monthly',
                periodKey: monthKey,
                target
            })
            const status: KpiRowStatus = !targetInfo ? 'no-target' : (classify(target, result.actual) || 'needs-attention')
            return {
                def,
                periodKey: targetInfo?.periodKey ?? null,
                targetId: targetInfo?.id ?? null,
                target,
                actual: result.actual,
                achievementPercent: target ? Math.round((result.actual / target) * 100) : null,
                status
            }
        } catch (err) {
            console.error(`Failed to compute KPI: ${def.kpiLabel}`, err)
            return { def, periodKey: targetInfo?.periodKey ?? null, targetId: targetInfo?.id ?? null, target, actual: null, achievementPercent: null, status: 'no-target' }
        }
    }

    // ---- the main list: this department, this period ----
    useEffect(() => {
        if (!department || defsLoading) return
        let cancelled = false
        ;(async () => {
            setRowsLoading(true)
            try {
                const defs = visibleDefsForDept(department)
                const monthKey = viewPeriod.format('YYYY-MM')
                const results = await Promise.all(defs.map(def => computeRow(def, monthKey)))
                if (!cancelled) setRows(results)
            } finally {
                if (!cancelled) setRowsLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [department, viewPeriod, defsByDept, targetsByKpi, activeProgramId, isAllPrograms, defsLoading])

    // ---- department comparison, only computed when that view is open ----
    useEffect(() => {
        if (viewMode !== 'all' || !isMainDept || defsLoading) return
        let cancelled = false
        ;(async () => {
            setDeptSnapshotsLoading(true)
            try {
                const depts = allDepartments.length ? allDepartments : [department]
                const monthKey = viewPeriod.format('YYYY-MM')
                const next: Record<string, { total: number; achieved: number }> = {}
                for (const deptName of depts) {
                    const defs = visibleDefsForDept(deptName)
                    if (!defs.length) continue
                    const results = await Promise.all(defs.map(def => computeRow(def, monthKey)))
                    next[deptName] = { total: results.length, achieved: results.filter(r => r.status === 'achieved').length }
                }
                if (!cancelled) setDeptSnapshots(next)
            } finally {
                if (!cancelled) setDeptSnapshotsLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [viewMode, isMainDept, allDepartments, department, viewPeriod, defsByDept, targetsByKpi, activeProgramId, isAllPrograms, defsLoading])

    // ---- opt-in trend comparison ----
    useEffect(() => {
        if (!compareKpiIds.length) { setCompareSeries([]); return }
        let cancelled = false
        ;(async () => {
            setCompareLoading(true)
            try {
                const defs = compareKpiIds
                    .map(id => (defsByDept[department] || []).find(d => d.id === id))
                    .filter((d): d is KpiDef => !!d)
                const monthKeys = buildMonthKeys(compareRange)
                const series = await Promise.all(monthKeys.map(async monthKey => {
                    const values: Record<string, number | null> = {}
                    for (const def of defs) {
                        const row = await computeRow(def, monthKey)
                        values[`${def.id}:actual`] = row.actual
                        values[`${def.id}:target`] = row.target
                        values[`${def.id}:achievement`] = row.achievementPercent
                    }
                    return { monthKey, values }
                }))
                if (!cancelled) setCompareSeries(series)
            } finally {
                if (!cancelled) setCompareLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [compareKpiIds, compareRange, defsByDept, targetsByKpi])

    const saveManualActual = async (row: KpiRow) => {
        if (!row.targetId) return
        const value = manualActualDrafts[row.targetId]
        if (value === undefined || value === null) return
        setSavingManualTargetId(row.targetId)
        try {
            await updateDoc(doc(db, 'kpiTargets', row.targetId), {
                actual: value,
                actualUpdatedBy: user?.uid || 'system',
                actualUpdatedAt: new Date()
            })
            setTargetsByKpi(current => ({
                ...current,
                [row.def.id]: (current[row.def.id] || []).map(t => t.id === row.targetId ? { ...t, actual: value } : t)
            }))
            message.success('Actual recorded.')
        } catch (err) {
            console.error(err)
            message.error('Failed to save the actual value.')
        } finally {
            setSavingManualTargetId(null)
        }
    }

    const visibleDepts = isMainDept ? (allDepartments.length ? allDepartments : [department]) : [department].filter(Boolean)
    const periodLabel = viewPeriod.format('MMMM YYYY')

    const totalKpis = rows.length
    const achievedCount = rows.filter(r => r.status === 'achieved').length
    const needsAttentionCount = rows.filter(r => r.status === 'needs-attention').length
    const noTargetCount = rows.filter(r => r.status === 'no-target').length

    const compareOptions = (defsByDept[department] || []).map(def => ({ value: def.id, label: def.kpiLabel }))

    const trendOptions: Highcharts.Options = useMemo(() => {
        const defs = compareKpiIds
            .map(id => (defsByDept[department] || []).find(d => d.id === id))
            .filter((d): d is KpiDef => !!d)
        const colours = ['#1677ff', '#7c3aed']
        return {
            chart: { type: 'column', height: 320, spacing: [8, 8, 8, 8] },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { enabled: true, align: 'center', verticalAlign: 'bottom' },
            xAxis: { categories: compareSeries.map(s => s.monthKey), title: { text: '' } },
            yAxis: compareView === 'performance'
                ? { min: 0, title: { text: 'Achievement' }, labels: { format: '{value}%' } }
                : { min: 0, title: { text: 'Actual' } },
            tooltip: {
                // Whichever axis is plotted, the tooltip always shows actual,
                // target and achievement together - switching the view never
                // hides the raw numbers behind just a percentage or vice versa.
                formatter: function () {
                    const index = this.index
                    const def = defs.find(d => d.kpiLabel === this.series.name)
                    if (!def) return `${this.x}`
                    const point = compareSeries[index]
                    const actual = point?.values[`${def.id}:actual`]
                    const target = point?.values[`${def.id}:target`]
                    const achievement = point?.values[`${def.id}:achievement`]
                    return `<b>${def.kpiLabel}</b><br/>${this.x}: ${actual ?? '—'} / ${target ?? '—'}` +
                        (achievement != null ? ` (${Math.round(achievement)}%)` : '')
                }
            },
            plotOptions: { column: { borderRadius: 4 } },
            series: compareView === 'performance'
                ? defs.map((def, index) => ({
                    type: 'column' as const,
                    name: def.kpiLabel,
                    color: colours[index],
                    data: compareSeries.map(s => s.values[`${def.id}:achievement`] ?? 0)
                }))
                : defs.map((def, index) => ({
                    type: 'column' as const,
                    name: def.kpiLabel,
                    color: colours[index],
                    data: compareSeries.map(s => s.values[`${def.id}:actual`] ?? 0)
                }))
        }
    }, [compareKpiIds, compareSeries, compareView, defsByDept, department])

    const departmentComparisonOptions: Highcharts.Options = useMemo(() => {
        const entries = visibleDepts.filter(d => deptSnapshots[d])
        return {
            chart: { type: 'bar', height: Math.max(280, entries.length * 42 + 60), spacing: [8, 8, 8, 8] },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { enabled: false },
            xAxis: { categories: entries, title: { text: '' } },
            yAxis: { min: 0, max: 100, title: { text: '' } },
            plotOptions: {
                bar: {
                    borderRadius: 6,
                    dataLabels: { enabled: true, formatter: function () { return `${Math.round(Number(this.y || 0))}%` } },
                    cursor: 'pointer',
                    point: {
                        events: {
                            click: function () {
                                setDepartment(String(this.category))
                                setViewMode('mine')
                            }
                        }
                    }
                }
            },
            series: [{
                type: 'bar',
                name: 'Achieved %',
                data: entries.map(d => {
                    const snap = deptSnapshots[d]
                    const pct = snap.total ? Math.round((snap.achieved / snap.total) * 100) : 0
                    return { y: pct, color: pct >= 80 ? '#52c41a' : pct >= 50 ? '#faad14' : '#ff4d4f' }
                })
            }]
        }
    }, [visibleDepts, deptSnapshots])

    // Achieved/on-track KPIs are already accounted for in the metric cards
    // above - repeating every KPI here (including the ones that are fine)
    // is exactly the flat list the Register/Setup page already shows.
    // This list is deliberately scoped to what actually needs a look.
    const attentionRows = rows
        .filter(r => r.status !== 'achieved' && r.status !== 'on-track')
        .sort((a, b) => {
            const order: Record<KpiRowStatus, number> = { 'needs-attention': 0, 'awaiting-update': 1, 'no-target': 2, achieved: 3, 'on-track': 3 }
            return order[a.status] - order[b.status]
        })

    const renderAttentionRow = (row: KpiRow) => {
        const meta = STATUS_META[row.status]
        const draft = row.targetId ? manualActualDrafts[row.targetId] : undefined
        const displayValue = draft !== undefined ? draft : (row.actual ?? null)
        const percent = row.achievementPercent != null ? Math.max(0, Math.min(row.achievementPercent, 100)) : 0

        return (
            <div
                key={row.def.id}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '12px 0',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    flexWrap: 'wrap'
                }}
            >
                <div style={{ flex: '1 1 320px', minWidth: 200 }}>
                    <Text strong ellipsis={{ tooltip: row.def.kpiLabel }} style={{ display: 'block' }}>{row.def.kpiLabel}</Text>
                    <Space size={4} style={{ marginTop: 2 }}>
                        <Tag color={row.def.trackingMode === 'manual' ? 'orange' : 'blue'}>{row.def.trackingMode === 'manual' ? 'Manual' : 'Computed'}</Tag>
                        <Tag icon={meta.icon} color={meta.color}>{meta.label}</Tag>
                    </Space>
                </div>

                <div style={{ flex: '0 1 220px', minWidth: 160 }}>
                    {row.status === 'no-target' ? (
                        <Text type='secondary'>No target committed for this period.</Text>
                    ) : row.status === 'awaiting-update' ? (
                        <Text type='secondary'>Target {row.target} — actual not recorded yet.</Text>
                    ) : (
                        <Progress
                            style={{ maxWidth: 180 }}
                            percent={percent}
                            status={row.status === 'needs-attention' ? 'exception' : 'normal'}
                            format={() => `${row.actual} / ${row.target}`}
                        />
                    )}
                </div>

                <div style={{ flexShrink: 0 }}>
                    {row.status === 'no-target' ? (
                        <Link to='/kpis/setup'><Button size='small'>Set a target</Button></Link>
                    ) : row.def.trackingMode === 'manual' ? (
                        <Space>
                            <InputNumber
                                min={0}
                                size='small'
                                style={{ width: 100 }}
                                value={displayValue}
                                onChange={value => row.targetId && setManualActualDrafts(current => ({ ...current, [row.targetId as string]: value }))}
                            />
                            <Tooltip title={row.actual != null ? 'Update the recorded actual' : "Record this period's actual"}>
                                <Button
                                    size='small'
                                    type='primary'
                                    icon={<SaveOutlined />}
                                    loading={savingManualTargetId === row.targetId}
                                    disabled={draft === undefined || draft === null}
                                    onClick={() => saveManualActual(row)}
                                />
                            </Tooltip>
                        </Space>
                    ) : null}
                </div>
            </div>
        )
    }

    if (identityLoading || defsLoading) {
        return (
            <div style={{ padding: 24 }}>
                <Skeleton active paragraph={{ rows: 8 }} />
            </div>
        )
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} style={{ marginBottom: 16 }}>
                <DashboardFilterBar>
                    <Row gutter={[12, 12]} align='middle' wrap style={{ width: '100%' }}>
                        {isMainDept && (
                            <Col flex='0 0 auto'>
                                <Segmented
                                    value={viewMode}
                                    onChange={value => setViewMode(value as 'mine' | 'all')}
                                    options={[
                                        { label: 'One department', value: 'mine' },
                                        { label: 'Compare departments', value: 'all' }
                                    ]}
                                />
                            </Col>
                        )}
                        {viewMode === 'mine' && (
                            <Col flex='1 1 220px' style={{ minWidth: 0 }}>
                                <Select
                                    value={department}
                                    onChange={setDepartment}
                                    style={{ width: '100%' }}
                                    disabled={!isMainDept}
                                    placeholder='Select department'
                                >
                                    {visibleDepts.map(name => <Option key={name} value={name}>{name}</Option>)}
                                </Select>
                            </Col>
                        )}
                        <Col flex='1 1 160px' style={{ minWidth: 0 }}>
                            <DatePicker
                                picker='month'
                                value={viewPeriod}
                                allowClear={false}
                                onChange={value => value && setViewPeriod(value.startOf('month'))}
                                style={{ width: '100%' }}
                            />
                        </Col>
                    </Row>
                </DashboardFilterBar>
            </motion.div>

            {viewMode === 'all' && isMainDept ? (
                <MotionCard>
                    <div style={{ marginBottom: 8 }}>
                        <strong>Department comparison — {periodLabel}</strong>
                        <div><Text type='secondary' style={{ fontSize: 12 }}>Share of each department's KPIs achieved this period. Click a bar to open that department.</Text></div>
                    </div>
                    {deptSnapshotsLoading ? (
                        <Skeleton active paragraph={{ rows: 6 }} />
                    ) : visibleDepts.some(d => deptSnapshots[d]) ? (
                        <HighchartsReact highcharts={Highcharts} options={departmentComparisonOptions} />
                    ) : (
                        <Empty description='No KPIs found for these departments this period.' />
                    )}
                </MotionCard>
            ) : (
                <>
                    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                        {rowsLoading ? [0, 1, 2, 3].map(i => (
                            <Col xs={12} md={6} key={i}><Skeleton.Input active block style={{ height: 96, borderRadius: 14 }} /></Col>
                        )) : <>
                            <Col xs={12} md={6}><MotionCard.Metric icon={<LineChartOutlined style={{ color: '#1677ff', fontSize: 18 }} />} iconBg='rgba(22,119,255,0.12)' title='Total KPIs' value={totalKpis} subtitle={periodLabel} /></Col>
                            <Col xs={12} md={6}><MotionCard.Metric icon={<CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />} iconBg='rgba(82,196,26,0.12)' title='Achieved' value={achievedCount} subtitle='Met or exceeded target' /></Col>
                            <Col xs={12} md={6}><MotionCard.Metric icon={<WarningOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />} iconBg='rgba(255,77,79,0.12)' title='Needs attention' value={needsAttentionCount} subtitle='Below 80% of target' /></Col>
                            <Col xs={12} md={6}><MotionCard.Metric icon={<QuestionCircleOutlined style={{ color: '#8c8c8c', fontSize: 18 }} />} iconBg='rgba(140,140,140,0.12)' title='No target set' value={noTargetCount} subtitle='Nothing committed yet' /></Col>
                        </>}
                    </Row>

                    <MotionCard>
                        <div style={{ marginBottom: 8 }}>
                            <strong>Needs your attention — {department || 'your department'}, {periodLabel}</strong>
                            <div><Text type='secondary' style={{ fontSize: 12 }}>Off track, awaiting an actual, or missing a target. Everything else is already accounted for above.</Text></div>
                        </div>
                        {rowsLoading ? (
                            <Skeleton active paragraph={{ rows: 6 }} />
                        ) : !rows.length && !attentionRows.length ? (
                            <Result status='info' title='No KPIs found' subTitle='No KPI definitions were found for this department and program.' />
                        ) : attentionRows.length ? (
                            <div>{attentionRows.map(renderAttentionRow)}</div>
                        ) : (
                            <Result status='success' title='All caught up' subTitle={`Every KPI is on track or achieved for ${periodLabel}.`} />
                        )}
                    </MotionCard>

                    <div style={{ height: 16 }} />

                    <MotionCard>
                        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                            <div>
                                <strong>Compare KPIs over time</strong>
                                <div><Text type='secondary' style={{ fontSize: 12 }}>Optional — pick up to two KPIs to see their trend.</Text></div>
                            </div>
                            <Space wrap>
                                <Select
                                    mode='multiple'
                                    maxCount={2}
                                    value={compareKpiIds}
                                    onChange={setCompareKpiIds}
                                    placeholder='Choose up to two KPIs'
                                    style={{ minWidth: 260 }}
                                    options={compareOptions}
                                />
                                <RangePicker
                                    picker='month'
                                    value={compareRange}
                                    onChange={value => value?.[0] && value?.[1] && setCompareRange([value[0], value[1]])}
                                />
                                {compareKpiIds.length > 0 && (
                                    <Segmented
                                        value={compareView}
                                        onChange={value => setCompareView(value as 'performance' | 'actual')}
                                        options={[{ label: 'Performance', value: 'performance' }, { label: 'Actual', value: 'actual' }]}
                                    />
                                )}
                            </Space>
                        </div>
                        {!compareKpiIds.length ? (
                            <Empty description='Choose one or two KPIs above to see their trend.' />
                        ) : compareLoading ? (
                            <Skeleton active paragraph={{ rows: 6 }} />
                        ) : (
                            <HighchartsReact highcharts={Highcharts} options={trendOptions} />
                        )}
                    </MotionCard>
                </>
            )}
        </div>
    )
}

export default KPITrackerView
