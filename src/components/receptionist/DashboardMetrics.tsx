import React from 'react'
import { Row, Col } from 'antd'
import {
  CalendarOutlined,
  FileTextOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import { ReceptionistDashboardData } from '@/types/inquiry'
import { MotionCard } from '../dashboards/metrics/Header'
import { MetricTile } from '../dashboards/metrics/MetricTile'
interface DashboardMetricsProps {
  dashboardData: ReceptionistDashboardData
}

const DashboardMetrics: React.FC<DashboardMetricsProps> = ({
  dashboardData
}) => {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} lg={6}>
        <MotionCard>
          <MetricTile
            title="Today's Inquiries"
            value={dashboardData.todayInquiries}
            subtitle='Received today'
            icon={<CalendarOutlined style={{ fontSize: 20 }} />}
            tone='info'
            wrapperStyle={{ minHeight: 72 }}
          />
        </MotionCard>
      </Col>

      <Col xs={24} sm={12} lg={6}>
        <MotionCard>
          <MetricTile
            title='This Week'
            value={dashboardData.weekInquiries}
            subtitle='Last 7 days'
            icon={<FileTextOutlined style={{ fontSize: 20 }} />}
            tone='success'
            wrapperStyle={{ minHeight: 72 }}
          />
        </MotionCard>
      </Col>

      <Col xs={24} sm={12} lg={6}>
        <MotionCard>
          <MetricTile
            title='This Month'
            value={dashboardData.monthInquiries}
            subtitle='Last 30 days'
            icon={<FileTextOutlined style={{ fontSize: 20 }} />}
            tone='info'
            wrapperStyle={{ minHeight: 72 }}
          />
        </MotionCard>
      </Col>

      <Col xs={24} sm={12} lg={6}>
        <MotionCard>
          <MetricTile
            title='Pending Follow-ups'
            value={dashboardData.pendingFollowUps}
            subtitle={dashboardData.pendingFollowUps > 0 ? 'Needs attention' : 'All caught up'}
            icon={<ClockCircleOutlined style={{ fontSize: 20 }} />}
            tone='warning'
            wrapperStyle={{ minHeight: 72 }}
          />
        </MotionCard>
      </Col>
    </Row>
  )
}

export default DashboardMetrics
