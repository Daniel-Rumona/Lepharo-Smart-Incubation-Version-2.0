import React from 'react'
import { Row, Col } from 'antd'
import {
  CalendarOutlined,
  FileTextOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import { ReceptionistDashboardData } from '@/types/inquiry'
import { MotionCard } from '../dashboards/metrics/Header'

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
          <MotionCard.Metric
            title="Today's Inquiries"
            value={dashboardData.todayInquiries}
            subtitle='Received today'
            icon={<CalendarOutlined style={{ color: '#1890ff', fontSize: 20 }} />}
            iconBg='rgba(24,144,255,.12)'
            wrapperStyle={{ minHeight: 72 }}
          />
        </MotionCard>
      </Col>

      <Col xs={24} sm={12} lg={6}>
        <MotionCard>
          <MotionCard.Metric
            title='This Week'
            value={dashboardData.weekInquiries}
            subtitle='Last 7 days'
            icon={<FileTextOutlined style={{ color: '#52c41a', fontSize: 20 }} />}
            iconBg='rgba(82,196,26,.12)'
            wrapperStyle={{ minHeight: 72 }}
          />
        </MotionCard>
      </Col>

      <Col xs={24} sm={12} lg={6}>
        <MotionCard>
          <MotionCard.Metric
            title='This Month'
            value={dashboardData.monthInquiries}
            subtitle='Last 30 days'
            icon={<FileTextOutlined style={{ color: '#722ed1', fontSize: 20 }} />}
            iconBg='rgba(114,46,209,.12)'
            wrapperStyle={{ minHeight: 72 }}
          />
        </MotionCard>
      </Col>

      <Col xs={24} sm={12} lg={6}>
        <MotionCard>
          <MotionCard.Metric
            title='Pending Follow-ups'
            value={dashboardData.pendingFollowUps}
            subtitle={dashboardData.pendingFollowUps > 0 ? 'Needs attention' : 'All caught up'}
            icon={<ClockCircleOutlined style={{ color: '#fa8c16', fontSize: 20 }} />}
            iconBg='rgba(250,140,22,.12)'
            wrapperStyle={{ minHeight: 72 }}
          />
        </MotionCard>
      </Col>
    </Row>
  )
}

export default DashboardMetrics
