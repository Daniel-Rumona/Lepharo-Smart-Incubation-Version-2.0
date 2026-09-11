import React, { useEffect, useState } from 'react'
import { Badge, Button, Card, Col, Empty, List, Row, Space, Tag, Typography, theme } from 'antd'
import { CalendarOutlined, CheckCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import DashboardButton from './DashboardButton'

const { Text } = Typography

export interface DashboardScheduleRow {
    id: string
    title: string
    deliveryLabel: string
    confirmState: string
    location?: string
    _n: { date: string; start: string; end: string }
}

interface Props<T extends DashboardScheduleRow> {
    rows: T[]
    recentCompletions: { id: string; title: string; subtitle?: string; completedAt: Date | null }[]
    renderActions: (row: T) => React.ReactNode
    onViewAppointments: () => void
    onViewInterventions: () => void
    appointmentError?: string
    appointmentsLoading?: boolean
}

export default function DashboardOverview<T extends DashboardScheduleRow>({
    rows, recentCompletions, renderActions,
    onViewAppointments, onViewInterventions, appointmentError, appointmentsLoading
}: Props<T>) {
    const { token } = theme.useToken()
    const [today, setToday] = useState(() => dayjs().format('YYYY-MM-DD'))
    const [selection, setSelection] = useState<{ day: string; manual: boolean }>({ day: today, manual: false })
    useEffect(() => {
        const timer = window.setInterval(() => setToday(dayjs().format('YYYY-MM-DD')), 60000)
        return () => window.clearInterval(timer)
    }, [])
    const days = Array.from({ length: 7 }, (_, index) => dayjs(today).add(index, 'day').format('YYYY-MM-DD'))
    const weekRows = rows.filter(row => days.includes(row._n.date))
    const selectedDay = selection.manual && days.includes(selection.day)
        ? selection.day
        : weekRows[0]?._n.date || today
    const selectedRows = weekRows.filter(row => row._n.date === selectedDay)

    return (
        <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
                <Card data-guide="incubatee-schedule" className="incubatee-overview-card"
                    title={<Space><CalendarOutlined />Upcoming Appointments</Space>}
                    extra={<DashboardButton size="small" onClick={onViewAppointments}>View all</DashboardButton>}>
                    <div className="incubatee-week" role="group" aria-label="Appointments for the next seven days">
                        {days.map(day => {
                            const count = weekRows.filter(row => row._n.date === day).length
                            return <Button key={day} className="incubatee-week-day"
                                type={selectedDay === day ? 'primary' : 'default'}
                                aria-pressed={selectedDay === day}
                                aria-label={`${dayjs(day).format('dddd D MMMM')}, ${count} appointments`}
                                onClick={() => setSelection({ day, manual: true })}>
                                <span>{dayjs(day).format('ddd')}</span>
                                <strong>{dayjs(day).format('D')}</strong>
                                <span style={{ height: 8, lineHeight: '8px' }}>
                                    <Badge color={selectedDay === day ? '#fff' : token.colorPrimary} style={{ visibility: count ? 'visible' : 'hidden' }} />
                                </span>
                            </Button>
                        })}
                    </div>
                    {appointmentError ? <Text type="danger">{appointmentError}</Text> :
                        <List loading={appointmentsLoading} dataSource={selectedRows}
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={weekRows.length ? 'No appointments on this day. Select a marked day.' : 'No appointments in the next seven days. Your next session will appear here once scheduled.'} /> }}
                            renderItem={row => <List.Item className="incubatee-overview-appointment">
                                <div className="incubatee-overview-time"><Text>{row._n.start || 'Time TBC'}</Text>{row._n.end && <Text type="secondary">{row._n.end}</Text>}</div>
                                <div className="incubatee-overview-session">
                                    <Text strong>{row.title}</Text>
                                    <div><Text type="secondary">{row.deliveryLabel}{row.location ? ` · ${row.location}` : ''}</Text></div>
                                    <Tag color={row.confirmState === 'confirmed' ? 'green' : row.confirmState === 'declined' ? 'red' : 'orange'}>{row.confirmState === 'pending' ? 'Confirmation needed' : row.confirmState}</Tag>
                                    <div>{renderActions(row)}</div>
                                </div>
                            </List.Item>} />}
                    <Text type="secondary">{dayjs(today).format('D MMM')}–{dayjs(days[6]).format('D MMM')} · {weekRows.length} appointments</Text>
                </Card>
            </Col>
            <Col xs={24} lg={10}>
                <Card className="incubatee-overview-card" title="Recent Completions"
                    extra={<DashboardButton size="small" onClick={onViewInterventions}>View all</DashboardButton>}>
                    <List dataSource={recentCompletions} size="small"
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No confirmed completions yet. Completed interventions will appear here after your confirmation." /> }}
                        renderItem={item => <List.Item key={item.id}>
                            <List.Item.Meta
                                avatar={<CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 18 }} />}
                                title={item.title}
                                description={<Space direction="vertical" size={2}>
                                    {item.subtitle && <Text type="secondary">{item.subtitle}</Text>}
                                    <Text type="secondary">{item.completedAt ? dayjs(item.completedAt).format('D MMM YYYY') : 'Completion date unavailable'}</Text>
                                </Space>} />
                        </List.Item>} />
                </Card>
            </Col>
        </Row>
    )
}
