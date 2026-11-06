import React, { useMemo } from 'react'
import { Empty } from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { MotionCard } from '@/components/dashboards/metrics/Header'

export type DeptSnapshot = { id: string; name: string; total: number; achieved: number; onTrack: number; behind: number; toUpdate: number }

type Props = {
    snapshots: DeptSnapshot[]
    loading: boolean
    periodText: string
    onOpen: (department: string) => void
    isDark: boolean
}

/**
 * Each department's KPIs for the month, as one stacked bar of achieved, on
 * track, behind and still to update. Sorted best first; click a bar to open it.
 */
export const DepartmentCompare: React.FC<Props> = ({ snapshots, loading, periodText, onOpen, isDark }) => {
    const rows = useMemo(
        () => [...snapshots].sort((a, b) => b.achieved / (b.total || 1) - a.achieved / (a.total || 1) || a.name.localeCompare(b.name)),
        [snapshots]
    )

    const options = useMemo<Highcharts.Options>(() => {
        // Validated slots: achieved aqua, on track blue, behind orange; still-to-update neutral.
        const ink = isDark
            ? { achieved: '#199e70', onTrack: '#3987e5', behind: '#d95926', toUpdate: 'rgba(255,255,255,0.18)', text: 'rgba(255,255,255,0.88)', muted: '#9a9890', grid: 'rgba(255,255,255,0.08)' }
            : { achieved: '#1baf7a', onTrack: '#2a78d6', behind: '#eb6834', toUpdate: '#d4d2cb', text: '#1f2937', muted: '#7a7873', grid: '#ecebe6' }
        const series = (name: string, key: keyof DeptSnapshot, color: string): Highcharts.SeriesBarOptions => ({
            type: 'bar',
            name,
            color,
            data: rows.map(r => Number(r[key]))
        })
        return {
            chart: { type: 'bar', height: Math.max(220, rows.length * 44 + 80), backgroundColor: 'transparent', spacing: [8, 8, 8, 8], style: { fontFamily: 'inherit' } },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { enabled: true, align: 'left', verticalAlign: 'top', itemStyle: { color: ink.muted, fontSize: '11px', fontWeight: '600' }, symbolRadius: 2 },
            xAxis: { categories: rows.map(r => r.name), lineWidth: 0, tickLength: 0, labels: { style: { color: ink.text, fontSize: '12px' } } },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, gridLineColor: ink.grid, labels: { style: { color: ink.muted, fontSize: '11px' } }, reversedStacks: false },
            tooltip: {
                shared: true,
                backgroundColor: isDark ? '#2e3238' : '#ffffff',
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,24,40,0.10)',
                borderRadius: 10,
                shadow: false,
                style: { color: ink.text, fontSize: '12px' },
                formatter: function () {
                    const r = rows[this.points?.[0]?.index ?? 0]
                    const pct = r.total ? Math.round((r.achieved / r.total) * 100) : 0
                    return `<b>${r.name}</b> · ${pct}% achieved<br/>${(this.points || []).map(p => `${p.series.name}: <b>${p.y}</b>`).join('<br/>')}`
                }
            },
            plotOptions: {
                series: { animation: { duration: 500 }, cursor: 'pointer', point: { events: { click: function () { onOpen(rows[this.index]?.id ?? '') } } } },
                bar: { stacking: 'normal', borderWidth: 0, borderRadius: 3, pointPadding: 0.08, groupPadding: 0.12 }
            },
            series: [
                series('Achieved', 'achieved', ink.achieved),
                series('On track', 'onTrack', ink.onTrack),
                series('Behind', 'behind', ink.behind),
                series('To update', 'toUpdate', ink.toUpdate)
            ]
        }
    }, [rows, isDark, onOpen])

    return (
        <MotionCard loading={loading} skeleton='text' skeletonRows={8}>
            <div className='trk-compare-head'>
                <h3 className='trk-compare-title'>Departments · {periodText}</h3>
                <p className='ws-muted'>Each department's KPIs by standing. Click a department to open its KPIs.</p>
            </div>
            {rows.length ? (
                <HighchartsReact highcharts={Highcharts} options={options} />
            ) : (
                <Empty description='No departments have KPIs for this programme.' />
            )}
        </MotionCard>
    )
}
