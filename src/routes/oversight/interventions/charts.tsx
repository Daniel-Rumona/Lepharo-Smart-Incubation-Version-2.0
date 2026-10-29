import React, { useMemo } from 'react'
import { theme } from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'

// One-hue (blue) ramp from the dataviz reference palette. Ordinal use stays
// between steps 250 and 600, which holds >= 2:1 against both surfaces.
export const BLUE = {
    250: '#86b6ef',
    300: '#6da7ec',
    350: '#5598e7',
    400: '#3987e5',
    450: '#2a78d6',
    500: '#256abf',
    550: '#1c5cab',
    600: '#184f95'
}

export type ChartInk = {
    text: string
    muted: string
    grid: string
    surface: string
}

/** Chart ink follows the active antd theme, so dark mode needs no second code path. */
export function useChartInk(): ChartInk {
    const { token } = theme.useToken()
    return useMemo(
        () => ({
            text: token.colorText,
            muted: token.colorTextSecondary,
            grid: token.colorSplit,
            surface: token.colorBgContainer
        }),
        [token]
    )
}

const baseOptions = (ink: ChartInk, height: number): Highcharts.Options => ({
    chart: { height, backgroundColor: 'transparent', spacing: [4, 8, 4, 4], style: { fontFamily: 'inherit' }, animation: false },
    title: { text: undefined },
    credits: { enabled: false },
    accessibility: { enabled: false },
    legend: { enabled: false },
    plotOptions: { series: { animation: false, states: { inactive: { opacity: 1 } } } },
    tooltip: {
        backgroundColor: ink.surface,
        borderColor: ink.grid,
        style: { color: ink.text, fontSize: '12px' },
        shadow: false,
        outside: true
    }
})

export type BarDatum = { label: string; value: number; color?: string }

/**
 * Slim progress-bar rows: label, a thin bar scaled to the largest value, and
 * the exact count. Rows with a zero count are left out - an empty bar says
 * nothing - and a list of only zeros collapses to one muted line.
 */
export function BarList({ data, ink, empty = 'Nothing here' }: { data: BarDatum[]; ink: ChartInk; empty?: string }) {
    const rows = data.filter(d => d.value > 0)
    if (!rows.length) {
        return <div style={{ color: ink.muted, fontSize: 13, padding: '8px 0' }}>{empty}</div>
    }
    const max = Math.max(...rows.map(r => r.value))
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map(row => (
                <div key={row.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 42%) 1fr 28px', alignItems: 'center', gap: 10 }}>
                    <span title={row.label} style={{ color: ink.muted, fontSize: 12, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.label}
                    </span>
                    <div style={{ height: 8, borderRadius: 999, background: ink.grid, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(6, (row.value / max) * 100)}%`, height: '100%', borderRadius: 999, background: row.color ?? BLUE[450] }} />
                    </div>
                    <span style={{ color: ink.text, fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{row.value}</span>
                </div>
            ))}
        </div>
    )
}

export type StackSeries = { name: string; color: string; values: number[] }

/** Horizontal stacked bars, one per category, with a legend (>= 2 series always get one). */
export function StackedBars({ categories, series, height, ink }: { categories: string[]; series: StackSeries[]; height?: number; ink: ChartInk }) {
    const options = useMemo<Highcharts.Options>(() => {
        const h = height ?? Math.max(140, categories.length * 34 + 56)
        const base = baseOptions(ink, h)
        return {
            ...base,
            chart: { ...base.chart, type: 'bar' },
            legend: { enabled: true, itemStyle: { color: ink.muted, fontWeight: 'normal' }, symbolRadius: 2 },
            xAxis: { categories, lineWidth: 0, tickLength: 0, labels: { style: { color: ink.muted, fontSize: '12px' } } },
            yAxis: { min: 0, reversedStacks: false, title: { text: undefined }, gridLineColor: ink.grid, labels: { style: { color: ink.muted } }, allowDecimals: false },
            plotOptions: {
                ...base.plotOptions,
                bar: { stacking: 'normal', borderWidth: 2, borderColor: ink.surface, borderRadius: 3, pointPadding: 0.12, groupPadding: 0.08 }
            },
            tooltip: { ...base.tooltip, shared: true },
            series: series.map(s => ({ type: 'bar' as const, name: s.name, color: s.color, data: s.values }))
        }
    }, [categories, series, height, ink])
    return <HighchartsReact highcharts={Highcharts} options={options} />
}

export type Segment = { label: string; value: number; color: string }

/**
 * Tiny proportional bar for table cells. Plain divs, not Highcharts, so a
 * column of them costs nothing; the title carries the exact numbers.
 */
export function MiniStack({ segments, ink }: { segments: Segment[]; ink: ChartInk }) {
    const total = segments.reduce((sum, s) => sum + s.value, 0)
    if (!total) return <span style={{ color: ink.muted }}>None yet</span>
    const title = segments.filter(s => s.value).map(s => `${s.label}: ${s.value}`).join('\n')
    return (
        <div title={title} style={{ display: 'flex', gap: 2, height: 10, width: '100%', minWidth: 120, alignItems: 'center' }}>
            {segments
                .filter(s => s.value > 0)
                .map(s => (
                    <div key={s.label} style={{ flex: s.value, minWidth: 4, height: '100%', background: s.color, borderRadius: 2 }} />
                ))}
        </div>
    )
}
