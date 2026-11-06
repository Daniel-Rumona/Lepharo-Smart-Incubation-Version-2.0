import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Col,
    DatePicker,
    Empty,
    Grid,
    Row,
    Segmented,
    Select,
    Table,
    Typography,
    theme
} from 'antd'
import {
    BarChartOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    DollarOutlined,
    FileDoneOutlined,
    TableOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import dayjs, { Dayjs } from 'dayjs'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@/firebase'
import { useColorMode } from '@/contexts/ThemeContext'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { isSmeRequest } from '@/lib/resourceRequests'
import { useBranchNames } from '@/lib/useBranchNames'
import { FINANCE_ACTION_STAGES, PAID_STAGES } from '@/lib/financeActions'
import { stageInfo } from '@/lib/internalRequests'

const { Text } = Typography

// ---------------------------------------------------------------------------
// Colour (validated with the dataviz palette checker against this app's card
// surfaces: #ffffff light, #26292e dark)

const SERIES = {
    light: { requests: '#2a78d6', packs: '#eb6834' },
    dark: { requests: '#3987e5', packs: '#d95926' }
}
// Ordered aging buckets: one hue, nearest-surface step for the youngest
const AGE_RAMP = {
    light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'],
    dark: ['#256abf', '#3987e5', '#6da7ec', '#9ec5f4']
}
// De-emphasis for "not finance's step" in the pipeline
const MUTED = { light: '#c9c8c3', dark: '#4b4f56' }

// ---------------------------------------------------------------------------
// Data shapes

interface StageEntry {
    stage: string
    timestamp?: any
}

interface RequestRow {
    id: string
    resourceName: string
    status: string
    amount?: number
    requestedFrom?: string
    createdAt?: Date
    progress: StageEntry[]
    paidAt?: Date
}

interface Payment {
    date: Date
    amount: number
    source: 'request' | 'pack'
    requestedFrom?: string
    daysToPay?: number
}

const toDate = (value: any): Date | undefined => {
    if (!value) return undefined
    const d = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
    return Number.isNaN(d.getTime()) ? undefined : d
}

const lastStageAt = (row: RequestRow, stages?: string[]) =>
    [...row.progress]
        .filter(p => !stages || stages.includes(p.stage))
        .map(p => toDate(p.timestamp))
        .filter(Boolean)
        .sort((a, b) => b!.getTime() - a!.getTime())[0]

const toRequest = (id: string, data: any): RequestRow => {
    const progress: StageEntry[] = Array.isArray(data.progress) ? data.progress : []
    const row: RequestRow = {
        id,
        resourceName: data.resourceName || data.resource || 'Unnamed request',
        status: data.status || progress[progress.length - 1]?.stage || 'pending_purchase_approval',
        amount: typeof data.amount === 'number' ? data.amount : undefined,
        requestedFrom: data.requestedFrom || '',
        createdAt: toDate(data.createdAt),
        progress
    }
    row.paidAt = toDate(data.paidAt) || lastStageAt(row, PAID_STAGES)
    return row
}

// Open stages in workflow order, for the pipeline chart
const PIPELINE_STAGES = [
    'pending_purchase_approval',
    'pending_quotation',
    'quotation_submitted',
    'pending_finance_review',
    'quotation_approved',
    'invoice_requested',
    'invoice_uploaded'
]

const AGE_BUCKETS = [
    { label: '0–3 days', max: 3 },
    { label: '4–7 days', max: 7 },
    { label: '8–14 days', max: 14 },
    { label: '15+ days', max: Infinity }
]

const PERIODS = [
    { value: 3, label: '3M' },
    { value: 6, label: '6M' },
    { value: 12, label: '12M' }
]

const compactMoney = (value: number) =>
    value >= 1_000_000
        ? `R ${(value / 1_000_000).toFixed(1)}M`
        : value >= 1000
            ? `R ${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`
            : `R ${Math.round(value)}`

const fullMoney = (value: number) =>
    `R ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

// ---------------------------------------------------------------------------

interface ChartCardProps {
    title: string
    subtitle?: string
    options: Highcharts.Options
    empty?: boolean
    table: { columns: any[]; rows: any[] }
}

// Every chart has a table view so no value depends on hovering
const ChartCard: React.FC<ChartCardProps> = ({ title, subtitle, options, empty, table }) => {
    const [view, setView] = useState<'chart' | 'table'>('chart')
    return (
        <Card
            style={{ borderRadius: 12, height: '100%' }}
            title={
                <div style={{ padding: '4px 0' }}>
                    <div>{title}</div>
                    {subtitle && (
                        <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>
                            {subtitle}
                        </Text>
                    )}
                </div>
            }
            extra={
                <Segmented
                    size='small'
                    value={view}
                    onChange={v => setView(v as 'chart' | 'table')}
                    options={[
                        { value: 'chart', icon: <BarChartOutlined />, title: 'Chart' },
                        { value: 'table', icon: <TableOutlined />, title: 'Table' }
                    ]}
                />
            }
        >
            {empty ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='Nothing in this period' />
            ) : view === 'chart' ? (
                <HighchartsReact highcharts={Highcharts} options={options} />
            ) : (
                <Table
                    size='small'
                    pagination={false}
                    columns={table.columns}
                    dataSource={table.rows}
                    rowKey='key'
                />
            )}
        </Card>
    )
}

// ---------------------------------------------------------------------------

const FinanceReports: React.FC = () => {
    const { token } = theme.useToken()
    const { mode } = useColorMode()
    const screens = Grid.useBreakpoint()
    const isMobile = screens.md === false
    const barCol = (flex: string) => (isMobile ? { span: 24 } : { flex })

    const [period, setPeriod] = useState(6)
    // A custom range overrides the month presets until a preset is picked again
    const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
    const [branch, setBranch] = useState<string | undefined>()

    const [liveRequests, setLiveRequests] = useState<RequestRow[]>([])
    const [livePacks, setLivePacks] = useState<
        Array<{ id: string; department?: string; confirmedAt?: Date; hasInvoice: boolean }>
    >([])
    const [packDecisions, setPackDecisions] = useState<
        Record<string, { decision?: string; amount?: number; decidedAt?: Date }>
    >({})
    const [loading, setLoading] = useState(true)
    const branchNames = useBranchNames()

    useEffect(() => {
        const unsubs = [
            onSnapshot(collection(db, 'resourceRequests'), snap => {
                // Internal purchases only; SME booking requests share the collection
                setLiveRequests(
                    snap.docs.filter(d => !isSmeRequest(d.data())).map(d => toRequest(d.id, d.data()))
                )
                setLoading(false)
            }),
            onSnapshot(collection(db, 'consolidatedMOVs'), snap => {
                setLivePacks(
                    snap.docs.flatMap(d => {
                        const data = d.data() as any
                        const final = (Array.isArray(data.approvals) ? data.approvals : []).find(
                            (a: any) =>
                                ['final_submission', 'final_confirmation'].includes(
                                    String(a.step || '').toLowerCase()
                                )
                        )
                        if (!final) return []
                        const inv = data.invoiceAttachment
                        return [
                            {
                                id: d.id,
                                department: data.department,
                                confirmedAt: toDate(final.date || final.at || final.timestamp),
                                hasInvoice: Boolean(typeof inv === 'string' ? inv : inv?.url)
                            }
                        ]
                    })
                )
            }),
            onSnapshot(collection(db, 'invoices'), snap => {
                const latest: Record<string, { decision?: string; amount?: number; decidedAt?: Date }> =
                    {}
                snap.forEach(d => {
                    const data = d.data() as any
                    if (!data.packId) return
                    const at = toDate(data.decidedAt)
                    const prev = latest[data.packId]
                    if (!prev || (at?.getTime() ?? 0) >= (prev.decidedAt?.getTime() ?? 0)) {
                        latest[data.packId] = {
                            decision: data.decision,
                            amount: typeof data.amount === 'number' ? data.amount : undefined,
                            decidedAt: at
                        }
                    }
                })
                setPackDecisions(latest)
            })
        ]
        return () => unsubs.forEach(u => u())
    }, [])

    const names = branchNames
    const branchName = (id?: string) => (id && names[id]) || 'Unassigned'

    const requests = liveRequests

    const packs = useMemo(
        () => livePacks.map(p => ({ ...p, ...packDecisions[p.id] })),
        [livePacks, packDecisions]
    )

    const payments = useMemo<Payment[]>(() => {
        const fromRequests = requests
            .filter(r => PAID_STAGES.includes(r.status) && r.paidAt && typeof r.amount === 'number')
            .map(r => ({
                date: r.paidAt!,
                amount: r.amount!,
                source: 'request' as const,
                requestedFrom: r.requestedFrom,
                daysToPay: r.createdAt
                    ? Math.max(0, dayjs(r.paidAt).diff(r.createdAt, 'day'))
                    : undefined
            }))
        const fromPacks = packs
            .filter(p => p.decision === 'approved' && p.decidedAt && typeof p.amount === 'number')
            .map(p => ({ date: p.decidedAt!, amount: p.amount!, source: 'pack' as const }))
        return [...fromRequests, ...fromPacks]
    }, [requests, packs])

    // ---- Filters (period + branch) scope everything below
    // The window is a custom range when one is picked, otherwise the last N months
    const periodStart: Dayjs = range ? range[0].startOf('day') : dayjs().subtract(period - 1, 'month').startOf('month')
    const periodEnd: Dayjs = range ? range[1].endOf('day') : dayjs().endOf('day')
    const periodKey = `${periodStart.valueOf()}-${periodEnd.valueOf()}`
    const periodLabel = range
        ? `${range[0].format('D MMM YYYY')} – ${range[1].format('D MMM YYYY')}`
        : `last ${period} months`
    const inPeriod = (d?: Date) =>
        !!d && !dayjs(d).isBefore(periodStart) && !dayjs(d).isAfter(periodEnd)
    // Packs belong to departments, not branches, so a branch filter leaves them out
    const branchMatch = (requestedFrom?: string) => !branch || requestedFrom === branch

    const periodPayments = payments.filter(
        p => inPeriod(p.date) && (p.source === 'request' ? branchMatch(p.requestedFrom) : !branch)
    )
    const branchRequests = requests.filter(r => branchMatch(r.requestedFrom))

    const branchOptions = useMemo(
        () =>
            Array.from(new Set(requests.map(r => r.requestedFrom).filter(Boolean)))
                .map(id => ({ value: id as string, label: branchName(id) }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [requests, names]
    )

    // ---- KPIs
    const kpis = useMemo(() => {
        const paidTotal = periodPayments.reduce((t, p) => t + p.amount, 0)
        const open = branchRequests.filter(
            r => !PAID_STAGES.includes(r.status) && r.status !== 'rejected'
        )
        const pipeline = open.reduce((t, r) => t + (r.amount ?? 0), 0)
        const timed = periodPayments.filter(p => typeof p.daysToPay === 'number')
        const avgDays = timed.length
            ? timed.reduce((t, p) => t + (p.daysToPay ?? 0), 0) / timed.length
            : undefined
        const decided = branchRequests.filter(
            r =>
                (PAID_STAGES.includes(r.status) || r.status === 'rejected') &&
                inPeriod(lastStageAt(r) || r.createdAt)
        )
        const rejected = decided.filter(r => r.status === 'rejected').length
        return {
            paidTotal,
            paidCount: periodPayments.length,
            pipeline,
            openCount: open.length,
            avgDays,
            rejectionRate: decided.length ? rejected / decided.length : undefined,
            rejected,
            decided: decided.length
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [periodPayments, branchRequests, periodKey])

    // ---- Monthly spend, split by source
    // One bucket per month across the window (custom ranges can span part-months)
    const months = Array.from(
        { length: periodEnd.startOf('month').diff(periodStart.startOf('month'), 'month') + 1 },
        (_, i) => periodStart.startOf('month').add(i, 'month')
    )
    const monthly = months.map(m => {
        const inMonth = periodPayments.filter(p => dayjs(p.date).isSame(m, 'month'))
        return {
            key: m.format('YYYY-MM'),
            month: m.format('MMM YY'),
            requests: inMonth.filter(p => p.source === 'request').reduce((t, p) => t + p.amount, 0),
            packs: inMonth.filter(p => p.source === 'pack').reduce((t, p) => t + p.amount, 0),
            // Average request-to-payment time for requests paid that month (none: no point)
            avgDays: (() => {
                const timed = inMonth.filter(p => typeof p.daysToPay === 'number')
                return timed.length
                    ? Math.round((timed.reduce((t, p) => t + (p.daysToPay ?? 0), 0) / timed.length) * 10) / 10
                    : null
            })()
        }
    })

    // ---- Waiting on finance, by how long
    const now = dayjs()
    const waiting = [
        ...branchRequests
            .filter(r => FINANCE_ACTION_STAGES.includes(r.status))
            .map(r => lastStageAt(r) || r.createdAt),
        // Packs with an invoice and no decision yet (requests only if a branch is chosen)
        ...(branch ? [] : packs.filter(p => p.hasInvoice && !p.decision).map(p => p.confirmedAt))
    ].filter(Boolean) as Date[]
    const aging = AGE_BUCKETS.map((b, i) => {
        const min = i === 0 ? 0 : AGE_BUCKETS[i - 1].max + 1
        return {
            key: b.label,
            label: b.label,
            count: waiting.filter(d => {
                const days = now.diff(d, 'day')
                return days >= min && days <= b.max
            }).length
        }
    })

    // ---- Pipeline by stage
    const pipeline = PIPELINE_STAGES.map(stage => {
        const list = branchRequests.filter(r => r.status === stage)
        return {
            key: stage,
            label: stageInfo(stage).label,
            count: list.length,
            amount: list.reduce((t, r) => t + (r.amount ?? 0), 0),
            finance: FINANCE_ACTION_STAGES.includes(stage)
        }
    }).filter(s => s.count > 0)

    // ---- Spend by branch (requests only; packs aren't tied to a branch)
    const byBranch = Object.entries(
        periodPayments
            .filter(p => p.source === 'request')
            .reduce<Record<string, number>>((acc, p) => {
                const name = branchName(p.requestedFrom)
                acc[name] = (acc[name] || 0) + p.amount
                return acc
            }, {})
    )
        .map(([name, amount]) => ({ key: name, name, amount }))
        .sort((a, b) => b.amount - a.amount)

    // ---- Shared chart chrome: thin marks, hairline solid grid, 2px surface gaps
    const surface = token.colorBgContainer
    const textColor = token.colorText
    const mutedText = token.colorTextSecondary
    const base = (height: number): Highcharts.Options => ({
        chart: { height, spacing: [8, 8, 8, 8], style: { fontFamily: 'inherit' } },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: false },
        accessibility: { enabled: false },
        tooltip: { outside: true }
    })
    const valueAxis = (format: (v: number) => string): Highcharts.YAxisOptions => ({
        title: { text: undefined },
        gridLineWidth: 1,
        gridLineDashStyle: 'Solid',
        labels: { formatter: ctx => format(Number(ctx.value)) }
    })
    const barLabels = (format: (v: number) => string) => ({
        enabled: true,
        style: { textOutline: 'none', fontWeight: '500', color: textColor },
        formatter: function (this: any) {
            return format(this.y)
        }
    })

    const c = SERIES[mode]
    const lastMonthIndex = monthly.length - 1

    const monthlyOptions: Highcharts.Options = {
        ...base(300),
        chart: { ...base(300).chart, type: 'column' },
        legend: { enabled: true, align: 'left', verticalAlign: 'top', symbolRadius: 2 },
        xAxis: {
            categories: monthly.map(m => m.month),
            lineWidth: 1,
            crosshair: { width: 1, color: token.colorBorder }
        },
        yAxis: {
            ...valueAxis(compactMoney),
            // Only the latest month is labelled; the axis and tooltip carry the rest
            stackLabels: {
                enabled: true,
                style: { textOutline: 'none', fontWeight: '600', color: textColor },
                formatter: function (this: any) {
                    return this.x === lastMonthIndex && this.total ? compactMoney(this.total) : ''
                }
            }
        },
        tooltip: {
            outside: true,
            shared: true,
            useHTML: true,
            formatter: function (this: any) {
                const rows = (this.points || [])
                    .map(
                        (p: any) =>
                            `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">` +
                            `<span style="width:12px;height:2px;background:${p.color};display:inline-block"></span>` +
                            `<b>${fullMoney(p.y)}</b><span style="color:${mutedText}">${p.series.name}</span></div>`
                    )
                    .join('')
                // Highcharts 12: the category name is on the point (`key`), x is its index
                const month = this.points?.[0]?.key ?? this.x
                return `<div style="color:${mutedText}">${month}</div>${rows}` +
                    `<div style="margin-top:4px"><b>${fullMoney((this.points || []).reduce((t: number, p: any) => t + (p.y || 0), 0))}</b> total</div>`
            }
        },
        plotOptions: {
            column: {
                stacking: 'normal',
                maxPointWidth: 24,
                borderWidth: 2,
                borderColor: surface,
                borderRadius: { radius: 4, where: 'end', scope: 'stack' } as any
            }
        },
        series: [
            {
                type: 'column',
                name: 'MOV packs',
                color: c.packs,
                data: monthly.map(m => m.packs),
                legendIndex: 1
            },
            {
                type: 'column',
                name: 'Resource requests',
                color: c.requests,
                data: monthly.map(m => m.requests),
                legendIndex: 0
            }
        ]
    }

    const horizontalBar = (
        categories: string[],
        values: number[],
        colors: string[] | string,
        format: (v: number) => string,
        tooltipLabel: (i: number) => string
    ): Highcharts.Options => ({
        ...base(Math.max(160, categories.length * 44 + 40)),
        chart: {
            ...base(0).chart,
            height: Math.max(160, categories.length * 44 + 40),
            type: 'bar'
        },
        xAxis: { categories, lineWidth: 1, labels: { style: { color: textColor } } },
        yAxis: { ...valueAxis(format), allowDecimals: false },
        tooltip: {
            outside: true,
            formatter: function (this: any) {
                return `<b>${format(this.y)}</b> · ${tooltipLabel(this.point.index)}`
            }
        },
        plotOptions: {
            bar: {
                maxPointWidth: 24,
                borderWidth: 2,
                borderColor: surface,
                borderRadius: { radius: 4, where: 'end' } as any,
                colorByPoint: Array.isArray(colors),
                dataLabels: barLabels(format)
            }
        },
        colors: Array.isArray(colors) ? colors : undefined,
        series: [
            {
                type: 'bar',
                name: 'Value',
                data: values,
                color: Array.isArray(colors) ? undefined : colors
            }
        ]
    })

    // Trend over time, one series: 2px line, ringed markers, crosshair, and only
    // the latest point labelled
    const lastWithDays = monthly.reduce((last, m, i) => (m.avgDays !== null ? i : last), -1)
    const daysOptions: Highcharts.Options = {
        ...base(260),
        chart: { ...base(260).chart, type: 'spline' },
        xAxis: {
            categories: monthly.map(m => m.month),
            lineWidth: 1,
            crosshair: { width: 1, color: token.colorBorder }
        },
        yAxis: { ...valueAxis(v => `${v}d`), min: 0, allowDecimals: false },
        tooltip: {
            outside: true,
            formatter: function (this: any) {
                return `<b>${this.y} days</b> · ${this.key ?? this.x}`
            }
        },
        plotOptions: {
            spline: {
                lineWidth: 2,
                connectNulls: true,
                marker: { radius: 4, lineWidth: 2, lineColor: surface, symbol: 'circle' },
                dataLabels: {
                    enabled: true,
                    style: { textOutline: 'none', fontWeight: '600', color: textColor },
                    formatter: function (this: any) {
                        return this.point.index === lastWithDays ? `${this.y}d` : ''
                    }
                }
            }
        },
        series: [
            {
                type: 'spline',
                name: 'Average days to pay',
                color: c.requests,
                data: monthly.map(m => m.avgDays)
            }
        ]
    }

    // Part-to-whole at a glance (4 ordered parts): donut in the age ramp, the
    // total in the middle, legend for identity
    const waitingTotal = aging.reduce((t, a) => t + a.count, 0)
    const agingOptions: Highcharts.Options = {
        ...base(280),
        chart: { ...base(280).chart, type: 'pie' },
        title: {
            text: `<div style="text-align:center"><div style="font-size:28px;font-weight:600;color:${textColor}">${waitingTotal}</div><div style="font-size:12px;color:${mutedText}">waiting</div></div>`,
            useHTML: true,
            verticalAlign: 'middle',
            y: -8
        },
        legend: { enabled: true, symbolRadius: 2 },
        tooltip: {
            outside: true,
            formatter: function (this: any) {
                return `<b>${this.y}</b> · waiting ${this.key}`
            }
        },
        plotOptions: {
            pie: {
                innerSize: '68%',
                borderWidth: 2,
                borderColor: surface,
                borderRadius: 4,
                showInLegend: true,
                dataLabels: { enabled: false }
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Waiting',
                data: aging.map((a, i) => ({ name: a.label, y: a.count, color: AGE_RAMP[mode][i] }))
            }
        ]
    }

    // Comparing magnitude across a few short names: columns, one colour, value
    // on each cap
    const branchChartOptions: Highcharts.Options = {
        ...base(280),
        chart: { ...base(280).chart, type: 'column' },
        xAxis: { categories: byBranch.map(b => b.name), lineWidth: 1, labels: { style: { color: textColor } } },
        yAxis: valueAxis(compactMoney),
        tooltip: {
            outside: true,
            formatter: function (this: any) {
                return `<b>${fullMoney(this.y)}</b> · ${this.key ?? this.x}`
            }
        },
        plotOptions: {
            column: {
                maxPointWidth: 24,
                borderWidth: 2,
                borderColor: surface,
                borderRadius: { radius: 4, where: 'end' } as any,
                dataLabels: barLabels(compactMoney)
            }
        },
        series: [{ type: 'column', name: 'Paid', color: c.requests, data: byBranch.map(b => b.amount) }]
    }

    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
    const count = (v: number) => String(v)

    return (
        <div style={{ padding: isMobile ? 12 : 24, minHeight: '100vh' }}>
            {/* KPIs: two side by side on mobile */}
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<DollarOutlined />}
                        tone='success'
                        title={range ? 'Paid in range' : `Paid · last ${period} months`}
                        value={compactMoney(kpis.paidTotal)}
                        subtitle={plural(kpis.paidCount, 'payment')}
                        loading={loading}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<FileDoneOutlined />}
                        tone='info'
                        title='In pipeline'
                        value={compactMoney(kpis.pipeline)}
                        subtitle={`${plural(kpis.openCount, 'open request')}, not yet paid`}
                        loading={loading}
                    />
                </Col>
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<ClockCircleOutlined />}
                        tone='warning'
                        title='Avg days to pay'
                        value={kpis.avgDays === undefined ? '—' : kpis.avgDays.toFixed(1)}
                        subtitle='From request to payment'
                        loading={loading}
                    />
                </Col>
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<CloseCircleOutlined />}
                        tone='danger'
                        title='Rejection rate'
                        value={
                            kpis.rejectionRate === undefined
                                ? '—'
                                : `${Math.round(kpis.rejectionRate * 100)}%`
                        }
                        subtitle={`${kpis.rejected} of ${plural(kpis.decided, 'decided request')}`}
                        loading={loading}
                    />
                </Col>
            </Row>

            {/* Filters: one row below the metrics, scoping every chart below */}
            <DashboardFilterBar>
                <Row gutter={[12, 12]} align='middle'>
                    <Col {...barCol('1 1 260px')}>
                        <DatePicker.RangePicker
                            value={range}
                            onChange={value =>
                                setRange(value && value[0] && value[1] ? [value[0], value[1]] : null)
                            }
                            disabledDate={current => current && current > dayjs().endOf('day')}
                            allowClear
                            style={{ width: '100%' }}
                        />
                    </Col>
                    <Col {...barCol('0 1 220px')}>
                        {/* Picking a preset drops any custom range */}
                        <Segmented
                            block
                            // -1 matches no option, so none shows selected while a range is set
                            value={range ? -1 : period}
                            onChange={v => {
                                setRange(null)
                                setPeriod(Number(v))
                            }}
                            options={PERIODS}
                        />
                    </Col>
                    <Col {...barCol('0 1 240px')}>
                        <Select
                            allowClear
                            placeholder='All branches'
                            value={branch}
                            onChange={setBranch}
                            options={branchOptions}
                            style={{ width: '100%' }}
                        />
                    </Col>
                    {branch && (
                        <Col {...barCol('1 1 260px')}>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                MOV packs belong to departments, not branches, so they&apos;re left
                                out while a branch is selected.
                            </Text>
                        </Col>
                    )}
                </Row>
            </DashboardFilterBar>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={16}>
                    <ChartCard
                        title='Monthly spend'
                        subtitle={`Paid resource requests and MOV pack invoices, ${periodLabel}`}
                        empty={!monthly.some(m => m.requests || m.packs)}
                        options={monthlyOptions}
                        table={{
                            columns: [
                                { title: 'Month', dataIndex: 'month' },
                                { title: 'Resource requests', dataIndex: 'requests', align: 'right', render: fullMoney },
                                { title: 'MOV packs', dataIndex: 'packs', align: 'right', render: fullMoney },
                                {
                                    title: 'Total',
                                    align: 'right',
                                    render: (_: any, r: any) => <b>{fullMoney(r.requests + r.packs)}</b>
                                }
                            ],
                            rows: monthly
                        }}
                    />
                </Col>
                <Col xs={24} xl={8}>
                    <ChartCard
                        title='Waiting on finance'
                        subtitle='Quotes, invoices and MOV packs, by how long they have waited'
                        empty={!waitingTotal}
                        options={agingOptions}
                        table={{
                            columns: [
                                { title: 'Waiting', dataIndex: 'label' },
                                { title: 'Items', dataIndex: 'count', align: 'right' }
                            ],
                            rows: aging
                        }}
                    />
                </Col>
                <Col xs={24} xl={12}>
                    <ChartCard
                        title='Days to pay'
                        subtitle='Average from request to payment, by the month it was paid'
                        empty={lastWithDays === -1}
                        options={daysOptions}
                        table={{
                            columns: [
                                { title: 'Month', dataIndex: 'month' },
                                {
                                    title: 'Average days',
                                    dataIndex: 'avgDays',
                                    align: 'right',
                                    render: (v: number | null) => (v === null ? '—' : v)
                                }
                            ],
                            rows: monthly
                        }}
                    />
                </Col>
                <Col xs={24} xl={12}>
                    <ChartCard
                        title='Pipeline by stage'
                        subtitle='Open requests; finance’s own steps are highlighted'
                        empty={!pipeline.length}
                        options={horizontalBar(
                            pipeline.map(s => s.label),
                            pipeline.map(s => s.count),
                            pipeline.map(s => (s.finance ? c.requests : MUTED[mode])),
                            count,
                            i =>
                                `${pipeline[i].finance ? 'needs finance' : 'with others'} · ${fullMoney(pipeline[i].amount)}`
                        )}
                        table={{
                            columns: [
                                { title: 'Stage', dataIndex: 'label' },
                                {
                                    title: 'Whose step',
                                    dataIndex: 'finance',
                                    render: (v: boolean) => (v ? 'Finance' : 'Others')
                                },
                                { title: 'Requests', dataIndex: 'count', align: 'right' },
                                { title: 'Value', dataIndex: 'amount', align: 'right', render: fullMoney }
                            ],
                            rows: pipeline
                        }}
                    />
                </Col>
                <Col xs={24}>
                    <ChartCard
                        title='Spend by branch'
                        subtitle={`Paid resource requests, ${periodLabel}`}
                        empty={!byBranch.length}
                        options={branchChartOptions}
                        table={{
                            columns: [
                                { title: 'Branch', dataIndex: 'name' },
                                { title: 'Paid', dataIndex: 'amount', align: 'right', render: fullMoney }
                            ],
                            rows: byBranch
                        }}
                    />
                </Col>
            </Row>
        </div>
    )
}

export default FinanceReports
