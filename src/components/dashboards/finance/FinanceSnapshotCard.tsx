import React, { useMemo } from 'react'
import { Empty, Skeleton, Tooltip, Typography, theme } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import dayjs, { type Dayjs } from 'dayjs'
import { MotionCard } from '../metrics/Header'
import type { DashboardDateRange } from '@/lib/useDashboardDateRange'
import { useDataColor } from '@/lib/chartColors'

const { Text } = Typography

type MonthRow = { month: string; label: string; revenue: number }

export type FinanceSnapshot = {
    clients: number
    totalRevenue: number
    monthlyRevenue: MonthRow[]
    /** Each SME's monthly revenue, used to work out momentum for the period. */
    smeMonths: MonthRow[][]
}

type Props = {
    summary: FinanceSnapshot
    loading?: boolean
    /** The topbar reporting window. null means All time. */
    dateRange: DashboardDateRange
}

const money = (value: number) =>
    `R ${Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`

/** Short rand amount for a headline figure: R 2.50M, R 812K. */
const compactMoney = (value: number) => {
    const n = Number(value || 0)
    const abs = Math.abs(n)
    if (abs >= 1_000_000_000) return `R ${(n / 1_000_000_000).toFixed(2)}B`
    if (abs >= 1_000_000) return `R ${(n / 1_000_000).toFixed(2)}M`
    if (abs >= 10_000) return `R ${(n / 1_000).toFixed(0)}K`
    return `R ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** First day of the month a finance row covers: "2026-03" or "Mar 2026". */
const monthStart = (row: MonthRow): Dayjs | null => {
    const key = String(row.month || '')
    const iso = key.match(/^(\d{4})-(\d{2})/)
    if (iso) return dayjs(new Date(Number(iso[1]), Number(iso[2]) - 1, 1))

    const text = String(row.label || row.month || '').trim().toLowerCase()
    const named = text.match(/^([a-z]{3})[a-z]*\s+(\d{4})$/)
    if (named && MONTHS.includes(named[1])) {
        return dayjs(new Date(Number(named[2]), MONTHS.indexOf(named[1]), 1))
    }
    return null
}

const inRange = (row: MonthRow, range: DashboardDateRange) => {
    if (!range) return true
    const start = monthStart(row)
    if (!start) return false
    return !start.isAfter(range[1], 'day') && !start.endOf('month').isBefore(range[0], 'day')
}

/**
 * Index of the month to report on inside `rows`: the last one in the period,
 * skipping the running month when an earlier month is available, because a
 * partial month always reads as a fall.
 */
const latestIndex = (rows: MonthRow[], range: DashboardDateRange) => {
    const currentMonth = dayjs().startOf('month')
    let fallback = -1
    for (let i = rows.length - 1; i >= 0; i--) {
        if (!inRange(rows[i], range)) continue
        if (fallback < 0) fallback = i
        const start = monthStart(rows[i])
        if (!start || !start.isSame(currentMonth, 'month')) return i
    }
    return fallback
}

/**
 * Finance snapshot for the linked SME accounts, scoped to the topbar date
 * filter: revenue for the period, the latest month against the month before,
 * the monthly trend and how many SMEs are growing, flat or declining.
 */
const FinanceSnapshotCard: React.FC<Props> = ({ summary, loading, dateRange }) => {
    const { token } = theme.useToken()
    // Neutral data colour: the accent unless it would read as a judgement (crimson).
    const dataColour = useDataColor()

    const periodMonths = useMemo(
        () => summary.monthlyRevenue.filter(m => inRange(m, dateRange)),
        [summary.monthlyRevenue, dateRange]
    )

    // All time uses the account totals, which go back further than the
    // 12 months of history the trend endpoint returns.
    const periodRevenue = dateRange
        ? periodMonths.reduce((sum, m) => sum + Number(m.revenue || 0), 0)
        : summary.totalRevenue

    const latest = useMemo(() => {
        const i = latestIndex(summary.monthlyRevenue, dateRange)
        if (i < 0) return null
        const row = summary.monthlyRevenue[i]
        const previous = summary.monthlyRevenue[i - 1]
        const change =
            previous && previous.revenue > 0
                ? Math.round(((row.revenue - previous.revenue) / previous.revenue) * 100)
                : null
        return { label: row.label || row.month, revenue: row.revenue, change }
    }, [summary.monthlyRevenue, dateRange])

    const momentumCounts = useMemo(() => {
        const counts = { growing: 0, flat: 0, declining: 0 }
        summary.smeMonths.forEach(rows => {
            const i = latestIndex(rows, dateRange)
            if (i < 0) return
            const current = Number(rows[i]?.revenue || 0)
            const previous = Number(rows[i - 1]?.revenue || 0)
            if (current > previous) counts.growing++
            else if (current < previous) counts.declining++
            else counts.flat++
        })
        return counts
    }, [summary.smeMonths, dateRange])

    const momentum = [
        { key: 'growing', label: 'Growing', count: momentumCounts.growing, color: token.colorSuccess },
        { key: 'flat', label: 'Flat', count: momentumCounts.flat, color: token.colorTextQuaternary },
        { key: 'declining', label: 'Declining', count: momentumCounts.declining, color: token.colorError }
    ]
    const momentumTotal = momentum.reduce((sum, m) => sum + m.count, 0)

    const chartOptions = useMemo<Highcharts.Options>(() => {
        const starts = periodMonths.map(monthStart)
        const spansYears =
            new Set(starts.filter(Boolean).map(s => (s as Dayjs).year())).size > 1
        return {
            chart: { type: 'areaspline', height: 200, backgroundColor: 'transparent', spacing: [8, 4, 4, 4] },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            legend: { enabled: false },
            xAxis: {
                categories: periodMonths.map((m, i) =>
                    starts[i] ? starts[i]!.format(spansYears ? "MMM 'YY" : 'MMM') : m.label || m.month
                ),
                tickLength: 0,
                labels: { style: { fontSize: '11px' } }
            },
            yAxis: {
                title: { text: undefined },
                tickAmount: 4,
                labels: {
                    style: { fontSize: '11px' },
                    formatter: function () {
                        return compactMoney(Number(this.value || 0))
                    }
                }
            },
            tooltip: {
                formatter: function () {
                    // Highcharts 12 binds `this` to the point; older versions to a context with `.point`.
                    const ctx = this as any
                    const row = periodMonths[Number(ctx.point?.index ?? ctx.index)]
                    return `<b>${row?.label || row?.month || ''}</b><br/>Revenue: <b>${money(Number(ctx.y || 0))}</b>`
                }
            },
            plotOptions: {
                areaspline: {
                    marker: { radius: 3, symbol: 'circle' },
                    lineWidth: 2,
                    fillColor: {
                        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                        stops: [
                            [0, Highcharts.color(dataColour).setOpacity(0.28).get('rgba') as string],
                            [1, Highcharts.color(dataColour).setOpacity(0).get('rgba') as string]
                        ]
                    }
                }
            },
            series: [
                {
                    type: 'areaspline',
                    name: 'Revenue',
                    color: dataColour,
                    data: periodMonths.map(m => Number(m.revenue || 0))
                }
            ]
        }
    }, [periodMonths, dataColour])

    const statLabel: React.CSSProperties = {
        fontSize: 12,
        color: token.colorTextSecondary,
        display: 'block',
        marginBottom: 2
    }
    const statValue: React.CSSProperties = {
        fontSize: 22,
        fontWeight: 600,
        lineHeight: 1.25,
        color: token.colorText,
        whiteSpace: 'nowrap'
    }

    const ChangeArrow =
        latest?.change == null || latest.change === 0
            ? MinusOutlined
            : latest.change > 0
                ? ArrowUpOutlined
                : ArrowDownOutlined
    const changeColor =
        latest?.change == null || latest.change === 0
            ? token.colorTextTertiary
            : latest.change > 0
                ? token.colorSuccess
                : token.colorError

    return (
        <MotionCard style={{ height: '100%' }} styles={{ body: { padding: 20 } }}>
            {loading ? (
                <Skeleton active paragraph={{ rows: 6 }} />
            ) : (
                <>
                    {/* Headline figures */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                            gap: 12,
                            paddingBottom: 16,
                            borderBottom: `1px solid ${token.colorBorderSecondary}`
                        }}
                    >
                        <div>
                            <span style={statLabel}>{dateRange ? 'Revenue in period' : 'Total revenue'}</span>
                            <Tooltip title={money(periodRevenue)}>
                                <span style={statValue}>{compactMoney(periodRevenue)}</span>
                            </Tooltip>
                        </div>
                        <div>
                            <span style={statLabel}>{latest ? latest.label : 'Latest month'}</span>
                            <Tooltip title={latest ? money(latest.revenue) : undefined}>
                                <span style={statValue}>{latest ? compactMoney(latest.revenue) : '—'}</span>
                            </Tooltip>
                            {latest?.change != null ? (
                                <Tooltip title='Against the month before'>
                                    <span style={{ marginLeft: 6, fontSize: 12, color: changeColor, whiteSpace: 'nowrap' }}>
                                        <ChangeArrow style={{ fontSize: 10 }} /> {Math.abs(latest.change)}%
                                    </span>
                                </Tooltip>
                            ) : null}
                        </div>
                        <div>
                            <span style={statLabel}>Clients</span>
                            <span style={statValue}>{summary.clients}</span>
                        </div>
                    </div>

                    {/* Revenue trend */}
                    <div style={{ marginTop: 14 }}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Monthly revenue</Text>
                        {periodMonths.length ? (
                            <HighchartsReact highcharts={Highcharts} options={chartOptions} />
                        ) : (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    summary.monthlyRevenue.length
                                        ? 'No revenue recorded in this period.'
                                        : 'No revenue trend data yet.'
                                }
                            />
                        )}
                    </div>

                    {/* SME momentum */}
                    <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <Text type='secondary' style={{ fontSize: 12 }}>SME momentum (month on month)</Text>
                            <Text type='secondary' style={{ fontSize: 12 }}>{momentumTotal} SMEs</Text>
                        </div>
                        <div
                            role='img'
                            aria-label={momentum.map(m => `${m.label} ${m.count}`).join(', ')}
                            style={{
                                display: 'flex',
                                gap: 2,
                                height: 8,
                                borderRadius: 999,
                                overflow: 'hidden',
                                background: token.colorFillSecondary
                            }}
                        >
                            {momentum
                                .filter(m => m.count > 0)
                                .map(m => (
                                    <div key={m.key} style={{ flex: m.count, background: m.color }} />
                                ))}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 10 }}>
                            {momentum.map(m => (
                                <span key={m.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 999, background: m.color }} />
                                    <Text type='secondary'>{m.label}</Text>
                                    <Text strong>{m.count}</Text>
                                </span>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </MotionCard>
    )
}

export default FinanceSnapshotCard
