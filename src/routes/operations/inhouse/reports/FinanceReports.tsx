import React from 'react'
import { Card, Row, Col, Statistic, Typography } from 'antd'
import {
  DollarOutlined,
  FileDoneOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'

const { Title } = Typography

const FinanceReports: React.FC = () => {
  // ✅ Dummy totals
  const totalApprovedAmount = 250000
  const totalSpentThisMonth = 120000
  const outstandingInvoices = 10

  // ✅ Dummy Data for Charts
  const requestsByDept = [
    { name: 'Legal', count: 12 },
    { name: 'ROM', count: 8 },
    { name: 'Training', count: 5 },
    { name: 'Financial Compliance', count: 15 }
  ]

  const requestStatus = [
    { name: 'Approved', y: 20 },
    { name: 'Pending', y: 7 },
    { name: 'Rejected', y: 3 }
  ]

  // ✅ Highcharts Configurations
  const requestsByDeptOptions: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 300
    },
    title: { text: 'Requests by Department' },
    xAxis: {
      categories: requestsByDept.map(d => d.name),
      title: { text: 'Departments' }
    },
    yAxis: {
      min: 0,
      title: { text: 'Number of Requests' }
    },
    series: [
      {
        type: 'column',
        name: 'Requests',
        data: requestsByDept.map(d => d.count)
      }
    ],
    credits: { enabled: false }
  }

  const requestStatusOptions: Highcharts.Options = {
    chart: {
      type: 'pie',
      height: 300
    },

    title: { text: 'Approved vs Pending vs Rejected' },
    series: [
      {
        type: 'pie',
        name: 'Requests',
        data: requestStatus
      }
    ],
    credits: { enabled: false }
  }

  return (
    <div style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
      <Title level={4} style={{ marginBottom: 16 }}>
        Finance Reports & Analytics
      </Title>

      {/* KPI Cards */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title='Total Approved Amount'
              prefix={<DollarOutlined style={{ color: '#1890ff' }} />}
              value={`R ${totalApprovedAmount.toLocaleString()}`}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title='Total Spent This Month'
              prefix={<FileDoneOutlined style={{ color: 'green' }} />}
              value={`R ${totalSpentThisMonth.toLocaleString()}`}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title='Outstanding Invoices'
              prefix={<ClockCircleOutlined style={{ color: 'orange' }} />}
              value={outstandingInvoices}
            />
          </Card>
        </Col>
      </Row>

      {/* Charts */}
      <Row gutter={16}>
        <Col span={12}>
          <Card>
            <HighchartsReact
              highcharts={Highcharts}
              options={requestsByDeptOptions}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card>
            <HighchartsReact
              highcharts={Highcharts}
              options={requestStatusOptions}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default FinanceReports
