import React from 'react'
import {
    Col,
    Empty,
    List,
    Row,
    Space,
    Typography,
    theme
} from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'

import DashboardButton from './DashboardButton'
import { MotionCard } from '../dashboards/metrics/Header'
import UpcomingAppointmentsCard, {
    type UpcomingAppointment
} from '@/components/modals/UpcomingAppointmentsCard'

const { Text } = Typography

interface Props {
    /** The SME's own appointments; the shared card narrows them to this work week. */
    appointments: UpcomingAppointment[]
    recentCompletions: {
        id: string
        title: string
        subtitle?: string
        completedAt: Date | null
    }[]
    /** Opens the SME's appointment details, where confirm / decline / food live. */
    onAppointmentClick: (appointment: UpcomingAppointment) => void
    /** The facilitator line under each appointment. */
    facilitatorLabel: (appointment: UpcomingAppointment) => string | undefined
    onViewAppointments: () => void
    onViewInterventions: () => void
    appointmentError?: string
    recentCompletionsLoading?: boolean
}

export default function DashboardOverview({
    appointments,
    recentCompletions,
    onAppointmentClick,
    facilitatorLabel,
    onViewAppointments,
    onViewInterventions,
    appointmentError,
    recentCompletionsLoading = false
}: Props) {
    const { token } = theme.useToken()

    return (
        <Row gutter={[16, 16]}>
            <Col xs={24} lg={14} data-guide="incubatee-schedule">
                {appointmentError ? (
                    <MotionCard
                        className="incubatee-overview-card"
                        title={
                            <Space>
                                <CalendarOutlined />
                                Upcoming Appointments
                            </Space>
                        }
                    >
                        <Text type="danger">{appointmentError}</Text>
                    </MotionCard>
                ) : (
                    <UpcomingAppointmentsCard
                        appointments={appointments}
                        onAppointmentClick={onAppointmentClick}
                        personLabel={facilitatorLabel}
                        onViewCalendar={onViewAppointments}
                    />
                )}
            </Col>

            <Col xs={24} lg={10}>
                <MotionCard
                    className="incubatee-overview-card"
                    title="Recent Completions"
                    extra={
                        <DashboardButton
                            size="small"
                            onClick={onViewInterventions}
                        >
                            View all
                        </DashboardButton>
                    }
                    loading={recentCompletionsLoading}
                >
                    <List
                        dataSource={recentCompletions}
                        size="small"
                        locale={{
                            emptyText: (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description="No confirmed completions yet. Completed interventions will appear here after your confirmation."
                                />
                            )
                        }}
                        renderItem={item => (
                            <List.Item key={item.id}>
                                <List.Item.Meta
                                    avatar={
                                        <CheckCircleOutlined
                                            style={{
                                                color: token.colorSuccess,
                                                fontSize: 18
                                            }}
                                        />
                                    }
                                    title={item.title}
                                    description={
                                        <Space direction="vertical" size={2}>
                                            {item.subtitle && (
                                                <Text type="secondary">{item.subtitle}</Text>
                                            )}

                                            <Text type="secondary">
                                                {item.completedAt
                                                    ? dayjs(item.completedAt).format('D MMM YYYY')
                                                    : 'Completion date unavailable'}
                                            </Text>
                                        </Space>
                                    }
                                />
                            </List.Item>
                        )}
                    />
                </MotionCard>
            </Col>
        </Row>
    )
}
