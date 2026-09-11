import React, { useState, useMemo } from 'react'
import { Card, Typography, Row, Col, Form, InputNumber } from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { Helmet } from 'react-helmet'

const { Title } = Typography

// ⬇️ Includes negative weights now
const rawInterventions = [
  { name: 'Website Development', weightByMonth: [80, 85, 90, 92] },
  { name: 'CRM Setup', weightByMonth: [60, 65, 75, 78] },
  { name: 'Mentorship Sessions', weightByMonth: [88, 89, 91, 94] },
  { name: 'Financial Literacy', weightByMonth: [55, 60, 68, 70] },
  { name: 'Branding & Logo', weightByMonth: [-10, -5, 5, 12] },
  { name: 'Compliance Training', weightByMonth: [70, 72, -15, 78] },
  { name: 'Strategic Planning', weightByMonth: [83, 84, 86, 88] },
  { name: 'Workflow Tools', weightByMonth: [-30, -22, -10, 5] },
  { name: 'Legal Structuring', weightByMonth: [10, 15, 5, -8] }
]

export const ImpactAnalysisForm: React.FC = () => {
  const [topN, setTopN] = useState(5)
  const [lagMonths, setLagMonths] = useState(0)

  const chartData = useMemo(() => {
    const adjusted = rawInterventions.map(intervention => ({
      name: intervention.name,
      value:
        intervention.weightByMonth[lagMonths] ??
        intervention.weightByMonth.at(-1) ??
        0
    }))

    return adjusted
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)) // Sort by absolute impact
      .slice(0, topN)
  }, [topN, lagMonths])

  const chartOptions: Highcharts.Options = {
    chart: { type: 'bar' },
    title: {
      text: `Top ${topN} Interventions (Lag: ${lagMonths} month${
        lagMonths !== 1 ? 's' : ''
      })`
    },
    xAxis: {
      categories: chartData.map(i => i.name),
      title: { text: null }
    },
    yAxis: {
      min: Math.min(...chartData.map(i => i.value)) - 10,
      max: Math.max(...chartData.map(i => i.value)) + 10,
      title: { text: 'Impact Weight (%)', align: 'high' },
      plotLines: [{ value: 0, width: 1, color: '#999' }]
    },
    plotOptions: {
      series: {
        dataLabels: {
          enabled: true,
          format: '{point.y}'
        }
      }
    },
    tooltip: {
      formatter: function () {
        return `<strong>${this.key}</strong><br/>Impact: <b>${this.y}%</b>`
      }
    },
    series: [
      {
        name: 'Impact Weight',
        type: 'bar',
        data: chartData.map(i => i.value),
        colorByPoint: true
      }
    ]
  }

  return (
    <>
      <Helmet>
        <title>Intervention Impact Ranking | Smart Incubation Platform</title>
        <meta
          name='description'
          content='Analyze and rank the impact of interventions based on participation weight and lag-adjusted influence.'
        />
      </Helmet>{' '}
      <div style={{ padding: 24 }}>
        <Title level={3}>Intervention Impact Ranking</Title>

        <Card style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item label='Top N Interventions'>
                <InputNumber
                  min={1}
                  max={rawInterventions.length}
                  value={topN}
                  onChange={val => setTopN(val || 5)}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>

            <Col span={6}>
              <Form.Item label='Lagging (months)'>
                <InputNumber
                  min={0}
                  max={12}
                  value={lagMonths}
                  onChange={val => setLagMonths(val || 0)}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card>
          <HighchartsReact highcharts={Highcharts} options={chartOptions} />
        </Card>
      </div>
    </>
  )
}
