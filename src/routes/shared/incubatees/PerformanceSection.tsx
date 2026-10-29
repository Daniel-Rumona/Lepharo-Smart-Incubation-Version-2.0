import React, { useMemo } from 'react'
import { Row, Col, Space, Empty, Skeleton } from 'antd'
import { TeamOutlined, DollarCircleOutlined } from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { Dayjs } from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { JobContract, MonthlyFinancePoint, SmePerformanceDetail, SmeRow, carryForwardMonthlyValues, countActiveJobsForMonth, monthKeyFromValue, monthNames } from './participantsData'

type PerformanceSectionProps = {
    row: SmeRow | null
    perfDetail: SmePerformanceDetail | null
    financeRevenue: MonthlyFinancePoint[]
    jobContracts: JobContract[]
    reportingRange: [Dayjs, Dayjs]
    loading: boolean
    isPhone: boolean
    isDark: boolean
}

/** Revenue and employment tiles plus the month-on-month revenue and employment charts for the selected SME. */
export const PerformanceSection: React.FC<PerformanceSectionProps> = ({
    row: selectedRow,
    perfDetail,
    financeRevenue,
    jobContracts,
    reportingRange,
    loading: performanceTrendLoading,
    isPhone,
    isDark
}) => {
    const performanceTrend = useMemo(() => {
        const startMonth = reportingRange[0].startOf('month')
        const monthCount = Math.max(1, reportingRange[1].endOf('month').diff(startMonth, 'month') + 1)
        const months = Array.from({ length: monthCount }, (_, index) => {
            const month = startMonth.add(index, 'month')
            const date = month.toDate()
            return {
                key: month.format('YYYY-MM'),
                monthIndex: date.getMonth(),
                label: new Intl.DateTimeFormat('en-ZA', { month: 'short', year: '2-digit' }).format(date)
            }
        })

        const financeByMonth = new Map<string, number>()
        financeRevenue.forEach(row => {
            const rawMonth = `${row.month || ''} ${row.monthLabel || ''}`.trim()
            const parsedKey = monthKeyFromValue(row.month) || monthKeyFromValue(row.monthLabel)
            const monthName = rawMonth.toLowerCase().split(/\s+/)[0]
            const monthIndex = monthNames.findIndex(name => name.toLowerCase() === monthName)
            const inferredKey = monthIndex >= 0 ? months.find(month => month.monthIndex === monthIndex)?.key : null
            const key = /\b\d{4}\b/.test(rawMonth) ? parsedKey : inferredKey || parsedKey
            if (key) financeByMonth.set(key, Number(row.revenue || 0))
        })

        const fallbackKeyByMonthIndex = new Map<number, string>()
        months.forEach(month => fallbackKeyByMonthIndex.set(month.monthIndex, month.key))
        const hasFinanceFeed = financeByMonth.size > 0
        const revenue = months.map(month => hasFinanceFeed
            ? financeByMonth.get(month.key) ?? null
            : fallbackKeyByMonthIndex.get(month.monthIndex) === month.key
                ? perfDetail?.mergedRevenue[month.monthIndex] ?? null
                : null)
        const hasVerifiedJobs = jobContracts.length > 0
        const carriedPermanent = carryForwardMonthlyValues(perfDetail?.mergedPerm || Array(12).fill(null))
        const carriedTemporary = carryForwardMonthlyValues(perfDetail?.mergedTemp || Array(12).fill(null))
        const reportedEmployees = months.map(month => {
            if (fallbackKeyByMonthIndex.get(month.monthIndex) !== month.key) return null
            const permanent = carriedPermanent[month.monthIndex]
            const temporary = carriedTemporary[month.monthIndex]
            return permanent == null && temporary == null ? null : (permanent || 0) + (temporary || 0)
        })
        const verifiedJobs = months.map(month => hasVerifiedJobs
            ? countActiveJobsForMonth(jobContracts, month.key)
            : null)
        const hasReportedEmployees = reportedEmployees.some(value => value != null)
        const hasData = revenue.some(value => value != null) || hasReportedEmployees || hasVerifiedJobs

        // Validated categorical slots (light/dark): revenue blue, reported headcount
        // aqua, verified jobs orange. Text never takes a series colour.
        const ink = isDark
            ? { revenue: '#3987e5', reported: '#199e70', verified: '#d95926', text: 'rgba(255,255,255,0.88)', muted: '#9a9890', grid: 'rgba(255,255,255,0.08)', axis: 'rgba(255,255,255,0.16)' }
            : { revenue: '#2a78d6', reported: '#1baf7a', verified: '#eb6834', text: '#1f2937', muted: '#7a7873', grid: '#ecebe6', axis: '#d4d2cb' }
        const currency = (v: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(v)
        // R 123k / R 1.2m: short enough for an axis tick or a point label.
        const compactRand = (v: number) => v >= 1e6 ? `R ${(v / 1e6).toFixed(1).replace(/\.0$/, '')}m` : v >= 1e3 ? `R ${Math.round(v / 1e3)}k` : `R ${Math.round(v)}`

        // Selective labelling: only the latest reported month carries a value label;
        // every other point is read from the hover tooltip.
        const labelLatest = (data: (number | null)[], format: (v: number) => string) => {
            let last = -1
            data.forEach((v, i) => { if (v != null) last = i })
            return data.map((v, i) => i === last && v != null
                ? { y: v, dataLabels: { enabled: true, format: format(v) } }
                : v)
        }

        const categories = months.map(month => month.label)
        const base = (height: number): Highcharts.Options => ({
            // A fixed left margin keeps both charts' months in the same columns.
            chart: { height, backgroundColor: 'transparent', spacing: [12, 4, 4, 4], marginLeft: 56, style: { fontFamily: 'inherit' } },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: {
                categories,
                crosshair: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,24,40,0.05)' },
                lineColor: ink.axis,
                tickLength: 0,
                labels: { style: { color: ink.muted, fontSize: '11px' } }
            },
            tooltip: {
                shared: true,
                backgroundColor: isDark ? '#2e3238' : '#ffffff',
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,24,40,0.10)',
                borderRadius: 10,
                shadow: false,
                style: { color: ink.text, fontSize: '12px' }
            },
            plotOptions: {
                series: {
                    animation: { duration: 500 },
                    dataLabels: {
                        enabled: false,
                        crop: false,
                        overflow: 'allow',
                        style: { color: ink.text, fontSize: '11px', fontWeight: '700', textOutline: 'none' }
                    }
                }
            }
        })
        const yAxis = (format: (v: number) => string): Highcharts.YAxisOptions => ({
            title: { text: undefined },
            min: 0,
            gridLineColor: ink.grid,
            labels: {
                style: { color: ink.muted, fontSize: '11px' },
                formatter: function () { return format(Number(this.value)) }
            }
        })

        const revenueOptions: Highcharts.Options = {
            ...base(220),
            legend: { enabled: false },
            yAxis: yAxis(compactRand),
            tooltip: {
                ...base(220).tooltip,
                formatter: function () {
                    const p = (this.points || [])[0]
                    return `<b>${this.x}</b><br/>Revenue: <b>${p && p.y != null ? currency(Number(p.y)) : 'Not reported'}</b>`
                }
            },
            series: [{
                type: 'areaspline',
                name: 'Revenue',
                data: labelLatest(revenue, compactRand),
                color: ink.revenue,
                lineWidth: 2,
                fillColor: {
                    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                    stops: [[0, Highcharts.color(ink.revenue).setOpacity(isDark ? 0.28 : 0.18).get('rgba') as string], [1, Highcharts.color(ink.revenue).setOpacity(0).get('rgba') as string]]
                },
                marker: { enabled: true, radius: 4, lineWidth: 2, lineColor: isDark ? '#26292e' : '#ffffff' },
                dataLabels: { y: -6 }
            }]
        }

        const employmentSeries: Highcharts.SeriesColumnOptions[] = [
            ...(hasReportedEmployees ? [{
                type: 'column' as const,
                name: 'Reported employees',
                data: labelLatest(reportedEmployees, v => String(v)),
                color: ink.reported
            }] : []),
            ...(hasVerifiedJobs ? [{
                type: 'column' as const,
                name: 'Verified active jobs',
                data: labelLatest(verifiedJobs, v => String(v)),
                color: ink.verified
            }] : [])
        ]
        const employmentOptions: Highcharts.Options = {
            ...base(200),
            // A legend only when two series share the chart; one series is named by its heading.
            legend: {
                enabled: employmentSeries.length > 1,
                align: 'right',
                verticalAlign: 'top',
                itemStyle: { color: ink.text, fontWeight: '500', fontSize: '12px' },
                symbolRadius: 3
            },
            yAxis: { ...yAxis(v => String(Math.round(v))), allowDecimals: false },
            tooltip: {
                ...base(200).tooltip,
                formatter: function () {
                    const lines = (this.points || []).map(p =>
                        `<span style="color:${p.color}">●</span> ${p.series.name}: <b>${p.y ?? 0}</b>`)
                    return `<b>${this.x}</b><br/>${lines.join('<br/>')}`
                }
            },
            plotOptions: {
                ...base(200).plotOptions,
                column: { borderRadius: 4, borderWidth: 0, pointPadding: 0.08, groupPadding: 0.18, maxPointWidth: 28 }
            },
            series: employmentSeries
        }

        return {
            revenueOptions,
            employmentOptions,
            hasRevenue: revenue.some(value => value != null),
            hasEmployment: employmentSeries.length > 0,
            hasData,
            revenueSource: hasFinanceFeed ? 'Finance workspace' : 'Monthly performance reports',
            employmentSource: hasVerifiedJobs && hasReportedEmployees
                ? 'Carried-forward headcount and HSE contracts'
                : hasVerifiedJobs ? 'HSE job contracts' : 'Carried-forward reported headcount'
        }
    }, [financeRevenue, jobContracts, perfDetail, reportingRange, isDark])

    if (!selectedRow) return <Empty description='Select an SME to view performance' />

    return (
        <Space direction='vertical' style={{ width: '100%' }} size='large'>
            <Row gutter={16}>
                <Col xs={12} sm={12}>
                    <MetricTile
                        title={isPhone ? 'Revenue' : 'Total revenue'}
                        value={new Intl.NumberFormat('en-ZA', {
                            style: 'currency', currency: 'ZAR',
                            ...(isPhone ? { notation: 'compact' as const, maximumFractionDigits: 1 } : {})
                        }).format(selectedRow.metrics.totalRevenue)}
                        subtitle={isPhone ? undefined : 'Across all reported months'}
                        icon={<DollarCircleOutlined />}
                        tone='success'
                    />
                </Col>
                <Col xs={12} sm={12}>
                    <MetricTile
                        title={isPhone ? 'Employees' : 'Current employees'}
                        value={selectedRow.metrics.currentEmployees}
                        subtitle={isPhone ? undefined : 'Latest reported headcount'}
                        icon={<TeamOutlined />}
                        tone='info'
                    />
                </Col>
            </Row>
            <div data-guide='sme-performance-chart'>
                <MotionCard title='Month-on-month trend'>
                    {performanceTrendLoading ? (
                        <Skeleton active paragraph={{ rows: 8 }} />
                    ) : !performanceTrend.hasData ? (
                        <Empty description='No monthly revenue or employment data has been captured for this period.' />
                    ) : (
                        <div className='ptx-trend'>
                            <section>
                                <div className='ptx-trend-head'>
                                    <span className='ptx-trend-title'>Revenue</span>
                                    <span className='ptx-trend-source'>{performanceTrend.revenueSource}</span>
                                </div>
                                {performanceTrend.hasRevenue
                                    ? <HighchartsReact highcharts={Highcharts} options={performanceTrend.revenueOptions} />
                                    : <div className='ptx-trend-empty'>No revenue reported in this period</div>}
                            </section>
                            <section>
                                <div className='ptx-trend-head'>
                                    <span className='ptx-trend-title'>Employment</span>
                                    <span className='ptx-trend-source'>{performanceTrend.employmentSource}</span>
                                </div>
                                {performanceTrend.hasEmployment
                                    ? <HighchartsReact highcharts={Highcharts} options={performanceTrend.employmentOptions} />
                                    : <div className='ptx-trend-empty'>No employment reported in this period</div>}
                            </section>
                        </div>
                    )}
                </MotionCard>
            </div>
        </Space>
    )
}
