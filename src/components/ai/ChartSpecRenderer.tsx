import React, { useMemo } from 'react'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import type { ChartSpec } from '@/services/aiAssistantService'

const CHART_PALETTE = [
  '#1677ff',
  '#7c3aed',
  '#52c41a',
  '#faad14',
  '#fa541c',
  '#13c2c2',
  '#2f54eb',
  '#eb2f96'
]

export const ChartSpecRenderer: React.FC<{
  chart: ChartSpec
  height?: number
  className?: string
}> = ({ chart, height = 280, className }) => {
  const options: Highcharts.Options = useMemo(() => {
    const shared = {
      credits: { enabled: false },
      exporting: { enabled: false },
      title: chart.title ? { text: chart.title, style: { fontSize: '13px' } } : { text: undefined },
      subtitle: chart.subtitle ? { text: chart.subtitle, style: { fontSize: '11px' } } : undefined
    }

    if (chart.type === 'donut') {
      const primary = chart.series[0]
      return {
        ...shared,
        chart: { type: 'pie', backgroundColor: 'transparent', height },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
        plotOptions: {
          pie: {
            innerSize: '62%',
            dataLabels: {
              enabled: true,
              distance: 14,
              format: '{point.name}: {point.y}',
              connectorWidth: 1,
              style: { fontSize: '11px', textOutline: 'none' }
            }
          }
        },
        legend: { enabled: true, itemStyle: { fontSize: '11px' } },
        series: [
          {
            type: 'pie',
            name: primary.name,
            colors: CHART_PALETTE,
            data: chart.categories.map((label, index) => ({
              name: label,
              y: primary.data[index],
              color: CHART_PALETTE[index % CHART_PALETTE.length]
            }))
          }
        ]
      }
    }

    return {
      ...shared,
      chart: { type: 'spline', backgroundColor: 'transparent', height },
      xAxis: {
        categories: chart.categories,
        labels: { style: { fontSize: '11px' } }
      },
      yAxis: { title: { text: undefined }, allowDecimals: false },
      legend: { enabled: chart.series.length > 1, itemStyle: { fontSize: '11px' } },
      tooltip: { shared: true },
      colors: CHART_PALETTE,
      plotOptions: {
        spline: {
          lineWidth: 3,
          marker: { enabled: true, radius: 4 },
          dataLabels: { enabled: true, format: '{point.y}', style: { textOutline: 'none', fontSize: '10px' } }
        }
      },
      series: chart.series.map(entry => ({
        type: 'spline',
        name: entry.name,
        data: entry.data
      }))
    }
  }, [chart, height])

  return (
    <div
      className={className || 'ai-chart-card'}
      style={
        className
          ? undefined
          : {
              width: '100%',
              padding: '10px 12px 4px',
              border: '1px solid #eef0f3',
              borderRadius: 14,
              background: '#fff',
              boxShadow: '0 6px 18px rgba(16, 24, 40, .06)'
            }
      }
    >
      <HighchartsReact highcharts={Highcharts} options={options} />
    </div>
  )
}
