import React, { useEffect, useMemo, useState } from 'react'
import {
    Badge,
    Button,
    Col,
    Empty,
    List,
    Row,
    Space,
    Tag,
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

const { Text } = Typography

export interface DashboardScheduleRow {
    id: string
    title: string
    deliveryLabel: string
    confirmState: string
    location?: string
    _n: {
        date: string
        start: string
        end: string
    }
}

interface Props<T extends DashboardScheduleRow> {
    rows: T[]
    recentCompletions: {
        id: string
        title: string
        subtitle?: string
        completedAt: Date | null
    }[]
    renderActions: (row: T) => React.ReactNode
    onViewAppointments: () => void
    onViewInterventions: () => void
    appointmentError?: string
    appointmentsLoading?: boolean
    recentCompletionsLoading?: boolean
}

const getWorkWeekStart = (
    date: dayjs.Dayjs
) => {
    const weekday = date.day()

    if (weekday === 0) {
        return date.add(1, 'day')
    }

    if (weekday === 6) {
        return date.add(2, 'day')
    }

    return date.subtract(
        weekday - 1,
        'day'
    )
}

export default function DashboardOverview<
    T extends DashboardScheduleRow
>({
    rows,
    recentCompletions,
    renderActions,
    onViewAppointments,
    onViewInterventions,
    appointmentError,
    appointmentsLoading = false,
    recentCompletionsLoading = false
}: Props<T>) {
    const { token } = theme.useToken()

    const [today, setToday] = useState(
        () =>
            dayjs().format(
                'YYYY-MM-DD'
            )
    )

    const [selection, setSelection] =
        useState<{
            day: string
            manual: boolean
        }>({
            day: today,
            manual: false
        })

    useEffect(() => {
        const timer =
            window.setInterval(() => {
                setToday(
                    dayjs().format(
                        'YYYY-MM-DD'
                    )
                )
            }, 60000)

        return () =>
            window.clearInterval(
                timer
            )
    }, [])

    const days = useMemo(() => {
        const currentDate =
            dayjs(today)

        const monday =
            getWorkWeekStart(
                currentDate
            )

        return Array.from(
            { length: 5 },
            (_, index) =>
                monday
                    .add(index, 'day')
                    .format(
                        'YYYY-MM-DD'
                    )
        )
    }, [today])

    const weekRows = useMemo(
        () =>
            rows.filter(row =>
                days.includes(
                    row._n.date
                )
            ),
        [rows, days]
    )

    const selectedDay =
        selection.manual &&
            days.includes(
                selection.day
            )
            ? selection.day
            : weekRows[0]
                ?._n.date ||
            (days.includes(today)
                ? today
                : days[0])

    const selectedRows =
        useMemo(
            () =>
                weekRows.filter(
                    row =>
                        row._n.date ===
                        selectedDay
                ),
            [
                weekRows,
                selectedDay
            ]
        )

    const weekStartLabel =
        dayjs(days[0]).format(
            'D MMM'
        )

    const weekEndLabel =
        dayjs(days[4]).format(
            'D MMM'
        )

    return (
        <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
                <MotionCard
                    data-guide="incubatee-schedule"
                    className="incubatee-overview-card"
                    title={
                        <Space>
                            <CalendarOutlined />
                            Upcoming Appointments
                        </Space>
                    }
                    extra={
                        <DashboardButton
                            variant='filled'
                            size="small"
                            icon={<CalendarOutlined />}
                            iconPosition="end"
                            onClick={
                                onViewAppointments
                            }
                        >
                            View all
                        </DashboardButton>
                    }
                    loading={
                        appointmentsLoading
                    }
                >
                    <div
                        className="incubatee-week"
                        role="group"
                        aria-label="Appointments from Monday to Friday"
                        style={{
                            display: 'grid',
                            gridTemplateColumns:
                                'repeat(5, minmax(0, 1fr))',
                            gap: 6,
                            width: '100%',
                            marginBottom: 14
                        }}
                    >
                        {days.map(day => {
                            const count =
                                weekRows.filter(
                                    row =>
                                        row
                                            ._n
                                            .date ===
                                        day
                                ).length

                            const isSelected =
                                selectedDay ===
                                day

                            return (
                                <Button
                                    key={day}
                                    className="incubatee-week-day"
                                    type={
                                        isSelected
                                            ? 'primary'
                                            : 'default'
                                    }
                                    aria-pressed={
                                        isSelected
                                    }
                                    aria-label={`${dayjs(
                                        day
                                    ).format(
                                        'dddd D MMMM'
                                    )}, ${count} appointments`}
                                    onClick={() =>
                                        setSelection(
                                            {
                                                day,
                                                manual: true
                                            }
                                        )
                                    }
                                    style={{
                                        width:
                                            '100%',
                                        minWidth:
                                            0,
                                        height:
                                            'auto',
                                        minHeight:
                                            62,
                                        padding:
                                            '7px 4px',
                                        display:
                                            'flex',
                                        flexDirection:
                                            'column',
                                        alignItems:
                                            'center',
                                        justifyContent:
                                            'center',
                                        gap: 1
                                    }}
                                >
                                    <span
                                        style={{
                                            fontSize:
                                                11,
                                            lineHeight:
                                                1.2
                                        }}
                                    >
                                        {dayjs(
                                            day
                                        ).format(
                                            'ddd'
                                        )}
                                    </span>

                                    <strong
                                        style={{
                                            fontSize:
                                                16,
                                            lineHeight:
                                                1.25
                                        }}
                                    >
                                        {dayjs(
                                            day
                                        ).format(
                                            'D'
                                        )}
                                    </strong>

                                    <span
                                        style={{
                                            height: 8,
                                            lineHeight:
                                                '8px'
                                        }}
                                    >
                                        <Badge
                                            color={
                                                isSelected
                                                    ? '#fff'
                                                    : token.colorPrimary
                                            }
                                            style={{
                                                visibility:
                                                    count
                                                        ? 'visible'
                                                        : 'hidden'
                                            }}
                                        />
                                    </span>
                                </Button>
                            )
                        })}
                    </div>

                    {appointmentError ? (
                        <Text type="danger">
                            {
                                appointmentError
                            }
                        </Text>
                    ) : (
                        <List
                            dataSource={
                                selectedRows
                            }
                            locale={{
                                emptyText: (
                                    <Empty
                                        image={
                                            Empty.PRESENTED_IMAGE_SIMPLE
                                        }
                                        description={
                                            weekRows.length
                                                ? 'No appointments on this day. Select a marked day.'
                                                : 'No appointments scheduled for this work week.'
                                        }
                                    />
                                )
                            }}
                            renderItem={row => (
                                <List.Item className="incubatee-overview-appointment">
                                    <div className="incubatee-overview-time">
                                        <Text>
                                            {row
                                                ._n
                                                .start ||
                                                'Time TBC'}
                                        </Text>

                                        {row
                                            ._n
                                            .end && (
                                                <Text type="secondary">
                                                    {
                                                        row
                                                            ._n
                                                            .end
                                                    }
                                                </Text>
                                            )}
                                    </div>

                                    <div className="incubatee-overview-session">
                                        <Text
                                            strong
                                        >
                                            {
                                                row.title
                                            }
                                        </Text>

                                        <div>
                                            <Text type="secondary">
                                                {
                                                    row.deliveryLabel
                                                }

                                                {row.location
                                                    ? ` · ${row.location}`
                                                    : ''}
                                            </Text>
                                        </div>

                                        <Tag
                                            color={
                                                row.confirmState ===
                                                    'confirmed'
                                                    ? 'green'
                                                    : row.confirmState ===
                                                        'declined'
                                                        ? 'red'
                                                        : 'orange'
                                            }
                                        >
                                            {row.confirmState ===
                                                'pending'
                                                ? 'Confirmation needed'
                                                : row.confirmState}
                                        </Tag>

                                        <div>
                                            {renderActions(
                                                row
                                            )}
                                        </div>
                                    </div>
                                </List.Item>
                            )}
                        />
                    )}
                </MotionCard>
            </Col>

            <Col xs={24} lg={10}>
                <MotionCard
                    className="incubatee-overview-card"
                    title="Recent Completions"
                    extra={
                        <DashboardButton
                            size="small"
                            onClick={
                                onViewInterventions
                            }
                        >
                            View all
                        </DashboardButton>
                    }
                    loading={
                        recentCompletionsLoading
                    }
                >
                    <List
                        dataSource={
                            recentCompletions
                        }
                        size="small"
                        locale={{
                            emptyText: (
                                <Empty
                                    image={
                                        Empty.PRESENTED_IMAGE_SIMPLE
                                    }
                                    description="No confirmed completions yet. Completed interventions will appear here after your confirmation."
                                />
                            )
                        }}
                        renderItem={item => (
                            <List.Item
                                key={
                                    item.id
                                }
                            >
                                <List.Item.Meta
                                    avatar={
                                        <CheckCircleOutlined
                                            style={{
                                                color:
                                                    token.colorSuccess,
                                                fontSize:
                                                    18
                                            }}
                                        />
                                    }
                                    title={
                                        item.title
                                    }
                                    description={
                                        <Space
                                            direction="vertical"
                                            size={
                                                2
                                            }
                                        >
                                            {item.subtitle && (
                                                <Text type="secondary">
                                                    {
                                                        item.subtitle
                                                    }
                                                </Text>
                                            )}

                                            <Text type="secondary">
                                                {item.completedAt
                                                    ? dayjs(
                                                        item.completedAt
                                                    ).format(
                                                        'D MMM YYYY'
                                                    )
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
