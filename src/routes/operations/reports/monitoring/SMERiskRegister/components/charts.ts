import type Highcharts from 'highcharts'

import type { SMERow } from '../types'

export type ChartTheme = {
    primary: string
    success: string
    mediumRisk: string
    highRisk: string
    criticalRisk: string
    text: string
    mutedText: string
    border: string
    split: string
    surface: string
}

const FALLBACK_THEME: ChartTheme = {
    primary: '#1677ff',
    success: '#52c41a',
    mediumRisk: '#faad14',
    highRisk: '#d46b08',
    criticalRisk: '#ff4d4f',
    text: '#262626',
    mutedText: '#8c8c8c',
    border: '#f0f0f0',
    split: '#f0f0f0',
    surface: '#ffffff'
}

const getTheme = (
    chartTheme?: Partial<ChartTheme>
): ChartTheme => ({
    ...FALLBACK_THEME,
    ...(chartTheme || {})
})

const baseOptions = (
    chartTheme?: Partial<ChartTheme>
): Highcharts.Options => {
    const colors = getTheme(chartTheme)

    return {
        chart: {
            backgroundColor: 'transparent',
            style: {
                fontFamily: 'inherit'
            },
            animation: {
                duration: 350
            }
        },
        title: {
            text: undefined
        },
        credits: {
            enabled: false
        },
        exporting: {
            enabled: false
        },
        tooltip: {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: 10,
            shadow: false,
            style: {
                color: colors.text,
                fontSize: '12px'
            }
        },
        legend: {
            itemStyle: {
                color: colors.text,
                fontSize: '11px',
                fontWeight: '500'
            },
            itemHoverStyle: {
                color: colors.text
            },
            symbolRadius: 5
        },
        xAxis: {
            lineColor: colors.border,
            tickColor: colors.border,
            labels: {
                style: {
                    color: colors.mutedText,
                    fontSize: '10px'
                }
            }
        },
        yAxis: {
            gridLineColor: colors.split,
            lineColor: colors.border,
            tickColor: colors.border,
            labels: {
                style: {
                    color: colors.mutedText,
                    fontSize: '10px'
                }
            },
            title: {
                text: undefined
            }
        },
        plotOptions: {
            series: {
                animation: {
                    duration: 420
                },
                states: {
                    inactive: {
                        opacity: 0.3
                    }
                }
            }
        }
    }
}

const countRiskLevels = (rows: SMERow[]) => ({
    critical: rows.filter(
        row => row.riskLevel === 'Critical'
    ).length,
    high: rows.filter(
        row => row.riskLevel === 'High'
    ).length,
    medium: rows.filter(
        row => row.riskLevel === 'Medium'
    ).length,
    low: rows.filter(
        row => row.riskLevel === 'Low'
    ).length
})

export function buildPortfolioRiskChartOptions(
    rows: SMERow[],
    chartTheme?: Partial<ChartTheme>,
    hiddenLevels: Array<'Critical' | 'High' | 'Medium' | 'Low'> = []
): Highcharts.Options {
    const colors = getTheme(chartTheme)
    const base = baseOptions(colors)
    const risk = countRiskLevels(rows)
    const hidden = new Set(hiddenLevels)

    return {
        ...base,
        chart: {
            ...base.chart,
            type: 'pie',
            height: 138,
            spacing: [0, 0, 0, 0]
        },
        title: {
            text: undefined
        },
        tooltip: {
            ...base.tooltip,
            pointFormat:
                '<b>{point.y}</b> SMEs · {point.percentage:.0f}%'
        },
        legend: {
            enabled: false
        },
        plotOptions: {
            ...base.plotOptions,
            pie: {
                startAngle: -90,
                endAngle: 90,
                center: ['50%', '92%'],
                size: '160%',
                innerSize: '70%',
                borderWidth: 3,
                borderColor: colors.surface,
                borderRadius: 5,
                dataLabels: {
                    enabled: false
                },
                showInLegend: false,
                cursor: 'default'
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Risk level',
                data: [
                    {
                        name: 'Critical',
                        y: risk.critical,
                        color: colors.criticalRisk,
                        visible: !hidden.has('Critical')
                    },
                    {
                        name: 'High',
                        y: risk.high,
                        color: colors.highRisk,
                        visible: !hidden.has('High')
                    },
                    {
                        name: 'Medium',
                        y: risk.medium,
                        color: colors.mediumRisk,
                        visible: !hidden.has('Medium')
                    },
                    {
                        name: 'Low',
                        y: risk.low,
                        color: colors.success,
                        visible: !hidden.has('Low')
                    }
                ]
            }
        ]
    }
}

type RiskDriverDatum = {
    label: string
    count: number
    color: string
}

export function buildRiskDriversChartOptions(
    rows: SMERow[],
    chartTheme?: Partial<ChartTheme>
): Highcharts.Options {
    const colors = getTheme(chartTheme)
    const base = baseOptions(colors)

    const affected = (
        predicate: (row: SMERow) => boolean
    ) => rows.filter(predicate).length

    const data: RiskDriverDatum[] = [
        {
            label: 'DP department review',
            count: affected(row =>
                row.expectedDepartments.some(
                    department =>
                        !department.deptConfirmed
                )
            ),
            color: colors.criticalRisk
        },
        {
            label: 'DP SME confirmation',
            count: affected(row =>
                row.expectedDepartments.some(
                    department =>
                        department.deptConfirmed &&
                        !department.smmeConfirmed
                )
            ),
            color: colors.highRisk
        },
        {
            label: 'Ready but unserviced',
            count: affected(row =>
                row.expectedDepartments.some(
                    department =>
                        department.deptConfirmed &&
                        department.smmeConfirmed &&
                        department.servicedCount === 0
                )
            ),
            color: colors.highRisk
        },
        {
            label: 'Missing documents',
            count: affected(
                row => row.docsMissing > 0
            ),
            color: colors.mediumRisk
        },
        {
            label: 'Queried / rejected docs',
            count: affected(
                row =>
                    row.docsQueried > 0 ||
                    row.docsRejected > 0
            ),
            color: colors.highRisk
        },
        {
            label: 'SME intervention response',
            count: affected(
                row =>
                    row.smePendingAcceptanceCount > 0 ||
                    row.smePendingConfirmationCount > 0
            ),
            color: colors.highRisk
        },
        {
            label: '30+ days inactive',
            count: affected(
                row =>
                    row.daysSinceLastService !== null &&
                    row.daysSinceLastService >= 30
            ),
            color: colors.mediumRisk
        },
        {
            label: 'Declined interventions',
            count: affected(
                row => row.declinedTouches > 0
            ),
            color: colors.criticalRisk
        }
    ]
        .filter(item => item.count > 0)
        .sort((a, b) => b.count - a.count)

    return {
        ...base,
        chart: {
            ...base.chart,
            type: 'bar',
            height: Math.max(320, data.length * 38 + 50),
            spacing: [8, 36, 0, 0]
        },
        legend: {
            enabled: false
        },
        xAxis: {
            ...(base.xAxis as Highcharts.XAxisOptions),
            categories: data.map(item => item.label),
            tickLength: 0,
            lineWidth: 0,
            labels: {
                style: {
                    color: colors.text,
                    fontSize: '10px',
                    textOverflow: 'ellipsis'
                }
            }
        },
        yAxis: {
            ...(base.yAxis as Highcharts.YAxisOptions),
            min: 0,
            allowDecimals: false,
            gridLineWidth: 0,
            labels: {
                enabled: false
            }
        },
        tooltip: {
            ...base.tooltip,
            headerFormat: '',
            pointFormatter: function () {
                return `<b>${this.category}</b><br/>${this.y} SME${Number(this.y) === 1 ? '' : 's'} affected`
            }
        },
        plotOptions: {
            ...base.plotOptions,
            bar: {
                borderWidth: 0,
                borderRadius: 7,
                pointWidth: 15,
                minPointLength: 4,
                dataLabels: {
                    enabled: true,
                    inside: false,
                    crop: false,
                    overflow: 'allow',
                    x: 5,
                    style: {
                        color: colors.text,
                        fontSize: '11px',
                        fontWeight: '600',
                        textOutline: 'none'
                    }
                }
            }
        },
        series: [
            {
                type: 'bar',
                name: 'SMEs affected',
                data: data.map(item => ({
                    y: item.count,
                    color: item.color
                }))
            }
        ]
    }
}

type DepartmentPressure = {
    departmentName: string
    departmentReview: number
    awaitingSme: number
    readyNoService: number
    total: number
}

export function buildDepartmentRiskPressureChartOptions(
    rows: SMERow[],
    isDepartmentScopedView: boolean,
    chartTheme?: Partial<ChartTheme>
): Highcharts.Options {
    const colors = getTheme(chartTheme)
    const base = baseOptions(colors)

    const map = new Map<string, DepartmentPressure>()

    rows.forEach(row => {
        row.expectedDepartments.forEach(department => {
            const name =
                department.departmentName ||
                'Unknown Department'

            const current =
                map.get(name) || {
                    departmentName: name,
                    departmentReview: 0,
                    awaitingSme: 0,
                    readyNoService: 0,
                    total: 0
                }

            if (!department.deptConfirmed) {
                current.departmentReview += 1
            } else if (!department.smmeConfirmed) {
                current.awaitingSme += 1
            } else if (department.servicedCount === 0) {
                current.readyNoService += 1
            }

            current.total =
                current.departmentReview +
                current.awaitingSme +
                current.readyNoService

            map.set(name, current)
        })
    })

    const data = [...map.values()]
        .filter(item => item.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 9)

    return {
        ...base,
        chart: {
            ...base.chart,
            type: 'column',
            height: 365,
            spacing: [8, 10, 52, 8]
        },
        xAxis: {
            ...(base.xAxis as Highcharts.XAxisOptions),
            categories: data.map(
                item => item.departmentName
            ),
            tickLength: 0,
            lineWidth: 0,
            labels: {
                rotation: -24,
                align: 'right',
                style: {
                    color: colors.text,
                    fontSize: '9px',
                    textOverflow: 'none'
                },
                formatter: function () {
                    const value = String(this.value)
                    return value.length > 22
                        ? `${value.slice(0, 20)}…`
                        : value
                }
            }
        },
        yAxis: {
            ...(base.yAxis as Highcharts.YAxisOptions),
            min: 0,
            allowDecimals: false,
            gridLineWidth: 1,
            stackLabels: {
                enabled: true,
                crop: false,
                overflow: 'allow',
                style: {
                    color: colors.text,
                    fontSize: '10px',
                    fontWeight: '600',
                    textOutline: 'none'
                },
                formatter: function () {
                    const total = Number(this.total || 0)
                    return total > 0 ? `${total}` : ''
                }
            }
        },
        legend: {
            ...base.legend,
            enabled: true,
            align: 'left',
            verticalAlign: 'top',
            layout: 'horizontal',
            margin: 8
        },
        tooltip: {
            ...base.tooltip,
            shared: true,
            valueSuffix: ' SMEs'
        },
        plotOptions: {
            ...base.plotOptions,
            series: {
                stacking: 'normal',
                borderWidth: 0,
                maxPointWidth: 42
            },
            column: {
                borderWidth: 0,
                borderRadius: 5,
                maxPointWidth: 42,
                groupPadding: 0.13,
                pointPadding: 0.03
            }
        },
        series: [
            {
                type: 'column',
                name: 'Department review',
                color: colors.criticalRisk,
                data: data.map(
                    item => item.departmentReview
                )
            },
            {
                type: 'column',
                name: 'Awaiting SME',
                color: colors.highRisk,
                data: data.map(
                    item => item.awaitingSme
                )
            },
            {
                type: 'column',
                name: isDepartmentScopedView
                    ? 'Ready, no service'
                    : 'Ready but unserviced',
                color: colors.mediumRisk,
                data: data.map(
                    item => item.readyNoService
                )
            }
        ]
    }
}
