import type Highcharts from 'highcharts'

import type { SMERow } from '../types'

export type CoverageMetrics = {
    fullyCovered: number
    withMissing: number
    notServiced: number
    critical: number
}

export type MissingDeptChartDatum = {
    departmentName: string
    count: number
}

// Validated palette (see the dataviz skill's references/palette.md). Status colors
// are reserved for charts where the color literally means good/bad; magnitude-only
// charts use the single sequential hue instead -- the two are never mixed on one
// chart.
const STATUS_COLORS = {
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b'
}

const SEQUENTIAL_BLUE = '#2a78d6'

const CHART_INK = '#0b0b0b'
const CHART_MUTED_INK = '#898781'
const CHART_GRIDLINE = '#e1e0d9'
const CHART_AXIS_LINE = '#c3c2b7'

const RECESSIVE_AXIS: Highcharts.XAxisOptions = {
    gridLineColor: CHART_GRIDLINE,
    lineColor: CHART_AXIS_LINE,
    tickColor: CHART_AXIS_LINE,
    labels: { style: { color: CHART_MUTED_INK, fontSize: '12px' } }
}

const OUTSIDE_LABEL_STYLE: Highcharts.CSSObject = {
    textOutline: 'none',
    fontSize: '12px',
    fontWeight: '600',
    color: CHART_INK
}

const ALWAYS_ON_STACK_LABELS: Highcharts.YAxisStackLabelsOptions = {
    enabled: true,
    allowOverlap: true,
    crop: false,
    overflow: 'allow',
    formatter: function () {
        return `${Number(this.total ?? 0)}`
    },
    style: {
        textOutline: 'none',
        fontSize: '12px',
        fontWeight: '700',
        color: CHART_INK
    }
}

export function buildCoverageChartOptions(metrics: CoverageMetrics, isDepartmentScopedView: boolean): Highcharts.Options {
    // Status progression good -> critical: color IS the meaning here, so this is
    // exactly the "status" job, one color per bar rather than a single series hue.
    const points = [
        { y: Number(metrics.fullyCovered || 0), color: STATUS_COLORS.good },
        { y: Number(metrics.withMissing || 0), color: STATUS_COLORS.warning },
        { y: Number(metrics.notServiced || 0), color: STATUS_COLORS.serious },
        { y: Number(metrics.critical || 0), color: STATUS_COLORS.critical }
    ]

    return {
        chart: {
            type: 'column',
            height: 360,
            backgroundColor: 'transparent',
            animation: false,
            spacingTop: 24
        },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: {
            ...RECESSIVE_AXIS,
            categories: isDepartmentScopedView
                ? ['Complete', 'Needs Action', 'No Service', 'Critical Risk']
                : ['Fully Covered', 'Needs Follow-Up', 'Not Serviced', 'Critical Risk']
        },
        yAxis: {
            min: 0,
            title: { text: 'SMEs', style: { color: CHART_MUTED_INK } },
            allowDecimals: false,
            gridLineColor: CHART_GRIDLINE,
            labels: { style: { color: CHART_MUTED_INK } }
        },
        plotOptions: {
            column: {
                borderRadius: 4,
                animation: false,
                minPointLength: 8,
                dataLabels: {
                    enabled: true,
                    inside: false,
                    crop: false,
                    overflow: 'allow',
                    formatter: function () {
                        return Number(this.y ?? 0) > 0 ? `${this.y}` : ''
                    },
                    style: OUTSIDE_LABEL_STYLE
                }
            }
        },
        series: [
            {
                type: 'column',
                name: 'SMEs',
                data: points
            }
        ]
    }
}

export function buildMissingDeptChartOptions(
    missingDeptChartData: MissingDeptChartDatum[],
    isDepartmentScopedView: boolean
): Highcharts.Options {
    return {
        chart: {
            type: 'bar',
            height: 420,
            backgroundColor: 'transparent',
            animation: false,
            spacingRight: 40
        },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: {
            ...RECESSIVE_AXIS,
            categories: missingDeptChartData.map(item => item.departmentName)
        },
        yAxis: {
            min: 0,
            title: { text: isDepartmentScopedView ? 'SMEs needing my department follow-up' : 'SMEs needing this department follow-up', style: { color: CHART_MUTED_INK } },
            allowDecimals: false,
            gridLineColor: CHART_GRIDLINE,
            labels: { style: { color: CHART_MUTED_INK } }
        },
        plotOptions: {
            bar: {
                borderRadius: 4,
                animation: false,
                minPointLength: 8,
                color: SEQUENTIAL_BLUE,
                dataLabels: {
                    enabled: true,
                    inside: false,
                    crop: false,
                    overflow: 'allow',
                    formatter: function () {
                        return Number(this.y ?? 0) > 0 ? `${this.y}` : ''
                    },
                    style: OUTSIDE_LABEL_STYLE
                }
            }
        },
        series: [
            {
                type: 'bar',
                name: 'Needs Follow-Up',
                data: missingDeptChartData.map(item => Number(item.count || 0))
            }
        ]
    }
}

export function buildActivityBreakdownChartOptions(servicedTouchRows: SMERow[]): Highcharts.Options {
    // Completed/Pending/Declined is a status set too -- reuse the same tokens as
    // the coverage chart so "good/warning/critical" mean the same thing everywhere
    // in this modal. Per-segment labels are dropped (status fills range from light
    // amber to dark red, so no single ink reads on all three); the always-on stack
    // total plus the legend and tooltip carry the value instead.
    return {
        chart: {
            type: 'bar',
            height: Math.max(320, servicedTouchRows.length * 48),
            backgroundColor: 'transparent'
        },
        title: { text: undefined },
        credits: { enabled: false },
        xAxis: {
            ...RECESSIVE_AXIS,
            categories: servicedTouchRows.map(row => row.smeName)
        },
        yAxis: {
            min: 0,
            title: { text: 'Times Serviced', style: { color: CHART_MUTED_INK } },
            allowDecimals: false,
            gridLineColor: CHART_GRIDLINE,
            labels: { style: { color: CHART_MUTED_INK } },
            stackLabels: {
                ...ALWAYS_ON_STACK_LABELS,
                formatter: function () {
                    const total = Number(this.total ?? 0)
                    return total > 0 ? `${total}` : ''
                }
            }
        },
        legend: { enabled: true, itemStyle: { color: CHART_INK } },
        plotOptions: {
            series: {
                stacking: 'normal',
                dataLabels: { enabled: false }
            },
            bar: {
                borderRadius: 4,
                minPointLength: 6,
                borderWidth: 2,
                borderColor: 'transparent'
            }
        },
        series: [
            {
                type: 'bar',
                name: 'Completed',
                color: STATUS_COLORS.good,
                data: servicedTouchRows.map(row => Number(row.completedTouches || 0))
            },
            {
                type: 'bar',
                name: 'Pending',
                color: STATUS_COLORS.warning,
                data: servicedTouchRows.map(row => Number(row.pendingTouches || 0))
            },
            {
                type: 'bar',
                name: 'Declined',
                color: STATUS_COLORS.critical,
                data: servicedTouchRows.map(row => Number(row.declinedTouches || 0))
            }
        ]
    }
}

export function buildNeglectedChartOptions(neglectedRows: SMERow[]): Highcharts.Options {
    // Pure magnitude (days), not a discrete status -- sequential blue, same hue as
    // the other magnitude-only chart above, keeping status red reserved for charts
    // where color encodes state.
    return {
        chart: {
            type: 'bar',
            height: Math.max(320, neglectedRows.length * 48),
            backgroundColor: 'transparent'
        },
        title: { text: undefined },
        credits: { enabled: false },
        xAxis: {
            ...RECESSIVE_AXIS,
            categories: neglectedRows.map(row => row.smeName)
        },
        yAxis: {
            min: 0,
            title: { text: 'Days since last service', style: { color: CHART_MUTED_INK } },
            allowDecimals: false,
            gridLineColor: CHART_GRIDLINE,
            labels: { style: { color: CHART_MUTED_INK } }
        },
        legend: { enabled: false },
        plotOptions: {
            bar: {
                borderRadius: 4,
                minPointLength: 6,
                color: SEQUENTIAL_BLUE,
                dataLabels: {
                    enabled: true,
                    inside: false,
                    crop: false,
                    overflow: 'allow',
                    formatter: function () {
                        const val = Number(this.y ?? 0)
                        return val > 0 ? `${val}d` : ''
                    },
                    style: OUTSIDE_LABEL_STYLE
                }
            }
        },
        series: [
            {
                type: 'bar',
                name: 'Days',
                data: neglectedRows.map(row => Number(row.daysSinceLastService || 0))
            }
        ]
    }
}
