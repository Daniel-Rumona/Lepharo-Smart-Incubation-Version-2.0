import React, { useMemo } from 'react'
import {
    Alert,
    Button,
    Col,
    Empty,
    Row,
    Space,
    Spin,
    Statistic,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    ArrowRightOutlined,
    BarChartOutlined,
    FallOutlined,
    FileProtectOutlined,
    MinusOutlined,
    RiseOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs, { Dayjs } from 'dayjs'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'

import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useSmeJobs } from '@/contexts/SmeJobsContext'

const { Text } = Typography

type DateRangeValue = [Dayjs | null, Dayjs | null] | null

type Props = {
    dateRange?: DateRangeValue
    showViewAll?: boolean
}

const toPercent = (value: number, total: number) => {
    if (!total) return 0
    return Math.round((value / total) * 100)
}

const formatSignedNumber = (value: number) => {
    if (value > 0) return `+${value}`
    return String(value)
}

const buildDelta = (current: number, previous: number) => {
    const change = current - previous
    const percent =
        previous > 0
            ? Math.round(((change / previous) * 100) * 10) / 10
            : current > 0
                ? 100
                : 0

    return {
        change,
        percent,
        direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
    } as const
}

const getPeriodMonth = (dateRange?: DateRangeValue) => {
    const [start, end] = dateRange || []

    if (end) return end.startOf('month')
    if (start) return start.startOf('month')

    return dayjs().startOf('month')
}

const HseJobsParticipantsCard: React.FC<Props> = ({
    dateRange,
    showViewAll = true
}) => {
    const navigate = useNavigate()
    const { token } = theme.useToken()

    const {
        loading,
        error,
        applyFilters
    } = useSmeJobs()

    const currentMonth = useMemo(() => getPeriodMonth(dateRange), [dateRange])
    const previousMonth = useMemo(
        () => currentMonth.subtract(1, 'month'),
        [currentMonth]
    )

    const currentPeriod = useMemo(() => {
        return applyFilters({ month: currentMonth })
    }, [applyFilters, currentMonth])

    const previousPeriod = useMemo(() => {
        return applyFilters({ month: previousMonth })
    }, [applyFilters, previousMonth])

    const totals = currentPeriod.metrics
    const previousTotals = previousPeriod.metrics

    const totalJobsDelta = useMemo(
        () => buildDelta(totals.totalJobs, previousTotals.totalJobs),
        [totals.totalJobs, previousTotals.totalJobs]
    )

    const permanentPercent = toPercent(totals.permanentJobs, totals.totalJobs)
    const temporaryPercent = toPercent(totals.temporaryJobs, totals.totalJobs)

    const trendMonths = useMemo(
        () =>
            Array.from({ length: 6 }, (_, index) =>
                currentMonth.subtract(5 - index, 'month')
            ),
        [currentMonth]
    )

    const trendData = useMemo(
        () =>
            trendMonths.map(month => {
                const period = applyFilters({ month })

                return {
                    label: month.format('MMM'),
                    fullLabel: month.format('MMM YYYY'),
                    totalJobs: period.metrics.totalJobs
                }
            }),
        [applyFilters, trendMonths]
    )

    const trendChartOptions = useMemo<Highcharts.Options>(
        () => ({
            chart: {
                backgroundColor: 'transparent',
                height: 72,
                spacing: [0, 0, 0, 0],
                margin: [4, 0, 4, 0]
            },
            title: {
                text: undefined
            },
            credits: {
                enabled: false
            },
            legend: {
                enabled: false
            },
            xAxis: {
                categories: trendData.map(point => point.fullLabel),
                visible: false
            },
            yAxis: {
                visible: false,
                startOnTick: false,
                endOnTick: false
            },
            tooltip: {
                backgroundColor: token.colorBgElevated,
                borderColor: token.colorBorderSecondary,
                borderRadius: 10,
                shadow: false,
                style: {
                    color: token.colorText,
                    fontSize: '12px'
                },
                headerFormat: '<b>{point.key}</b><br/>',
                pointFormat: '<b>{point.y}</b> active jobs'
            },
            plotOptions: {
                series: {
                    animation: {
                        duration: 300
                    },
                    lineWidth: 2.5,
                    marker: {
                        enabled: false,
                        radius: 3,
                        states: {
                            hover: {
                                enabled: true
                            }
                        }
                    },
                    states: {
                        hover: {
                            lineWidthPlus: 0
                        }
                    }
                }
            },
            series: [
                {
                    type: 'areaspline',
                    name: 'Active jobs',
                    data: trendData.map(point => point.totalJobs),
                    color: token.colorPrimary,
                    fillColor: {
                        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                        stops: [
                            [0, Highcharts.color(token.colorPrimary).setOpacity(0.28).get('rgba')],
                            [1, Highcharts.color(token.colorPrimary).setOpacity(0).get('rgba')]
                        ]
                    },
                    threshold: null,
                    lineWidth: 2.5,
                    marker: { enabled: false }
                }
            ]
        }),
        [token, trendData]
    )

    const renderDeltaTag = (
        delta: ReturnType<typeof buildDelta>
    ) => {
        const content = `${formatSignedNumber(delta.change)} (${delta.percent}%)`

        if (delta.direction === 'up') {
            return (
                <Tag color="success" icon={<RiseOutlined />} style={{ marginInlineEnd: 0 }}>
                    {content}
                </Tag>
            )
        }

        if (delta.direction === 'down') {
            return (
                <Tag color="error" icon={<FallOutlined />} style={{ marginInlineEnd: 0 }}>
                    {content}
                </Tag>
            )
        }

        return (
            <Tag icon={<MinusOutlined />} style={{ marginInlineEnd: 0 }}>
                0 (0%)
            </Tag>
        )
    }

    const surfaceStyle: React.CSSProperties = {
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        borderRadius: 14
    }

    return (
        <MotionCard
            title={
                <Space>
                    <FileProtectOutlined />
                    <span>Jobs Overview</span>
                </Space>
            }
            extra={
                showViewAll ? (
                    <Button
                        variant="filled"
                        color="geekblue"
                        shape="round"
                        icon={<ArrowRightOutlined />}
                        onClick={() => navigate('/metrics/jobs')}
                    >
                        View All
                    </Button>
                ) : null
            }
        >
            <Spin spinning={loading}>
                {error ? (
                    <Alert
                        type="error"
                        showIcon
                        message={error}
                        style={{ marginBottom: 12 }}
                    />
                ) : null}

                {totals.totalJobs > 0 ? (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Row gutter={[12, 12]} align="stretch">
                            <Col xs={24} md={12}>
                                <div
                                    style={{
                                        ...surfaceStyle,
                                        height: '100%',
                                        minHeight: 132,
                                        padding: '14px 16px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'space-between'
                                    }}
                                >
                                    <Space align="center" size={7}>
                                        <BarChartOutlined style={{ color: token.colorPrimary }} />
                                        <Text type="secondary">Active Jobs</Text>
                                    </Space>

                                    <Statistic
                                        value={totals.totalJobs}
                                        valueStyle={{
                                            fontSize: 34,
                                            lineHeight: 1.05,
                                            fontWeight: 750
                                        }}
                                    />

                                    <Space size={7} wrap>
                                        {renderDeltaTag(totalJobsDelta)}
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            vs {previousMonth.format('MMM YYYY')}
                                        </Text>
                                    </Space>
                                </div>
                            </Col>

                            <Col xs={24} md={12}>
                                <div
                                    style={{
                                        ...surfaceStyle,
                                        height: '100%',
                                        minHeight: 132,
                                        padding: 12,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 14
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 108,
                                            height: 108,
                                            minWidth: 108,
                                            borderRadius: '50%',
                                            position: 'relative',
                                            display: 'grid',
                                            placeItems: 'center',
                                            background: `conic-gradient(#52c41a 0 ${permanentPercent}%, #fa8c16 ${permanentPercent}% 100%)`
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: 72,
                                                height: 72,
                                                borderRadius: '50%',
                                                background: token.colorBgContainer,
                                                border: `1px solid ${token.colorBorderSecondary}`,
                                                display: 'grid',
                                                placeItems: 'center',
                                                textAlign: 'center'
                                            }}
                                        >
                                            <div>
                                                <div
                                                    style={{
                                                        fontSize: 20,
                                                        fontWeight: 750,
                                                        lineHeight: 1
                                                    }}
                                                >
                                                    {permanentPercent}%
                                                </div>
                                                <Text type="secondary" style={{ fontSize: 10 }}>
                                                    permanent
                                                </Text>
                                            </div>
                                        </div>
                                    </div>

                                    <Space
                                        direction="vertical"
                                        size={10}
                                        style={{ flex: 1, minWidth: 0 }}
                                    >
                                        <div>
                                            <Row justify="space-between" align="middle" wrap={false}>
                                                <Col>
                                                    <Space size={6}>
                                                        <span
                                                            style={{
                                                                width: 8,
                                                                height: 8,
                                                                borderRadius: 999,
                                                                background: '#52c41a',
                                                                display: 'inline-block'
                                                            }}
                                                        />
                                                        <Text>Permanent</Text>
                                                    </Space>
                                                </Col>
                                                <Col>
                                                    <Text strong>{totals.permanentJobs}</Text>
                                                </Col>
                                            </Row>
                                            <Text type="secondary" style={{ fontSize: 11 }}>
                                                {permanentPercent}% of active jobs
                                            </Text>
                                        </div>

                                        <div>
                                            <Row justify="space-between" align="middle" wrap={false}>
                                                <Col>
                                                    <Space size={6}>
                                                        <span
                                                            style={{
                                                                width: 8,
                                                                height: 8,
                                                                borderRadius: 999,
                                                                background: '#fa8c16',
                                                                display: 'inline-block'
                                                            }}
                                                        />
                                                        <Text>Temporary</Text>
                                                    </Space>
                                                </Col>
                                                <Col>
                                                    <Text strong>{totals.temporaryJobs}</Text>
                                                </Col>
                                            </Row>
                                            <Text type="secondary" style={{ fontSize: 11 }}>
                                                {temporaryPercent}% of active jobs
                                            </Text>
                                        </div>
                                    </Space>
                                </div>
                            </Col>

                        </Row>

                        <div
                            style={{
                                ...surfaceStyle,
                                padding: '10px 12px 8px'
                            }}
                        >
                            <Row justify="space-between" align="middle" style={{ marginBottom: 2 }}>
                                <Col>
                                    <Text strong style={{ fontSize: 13 }}>
                                        6-month active jobs
                                    </Text>
                                </Col>
                                <Col>
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                        {trendData[0]?.label}–{trendData[trendData.length - 1]?.label}
                                    </Text>
                                </Col>
                            </Row>

                            <HighchartsReact
                                highcharts={Highcharts}
                                options={trendChartOptions}
                                containerProps={{
                                    style: {
                                        width: '100%',
                                        height: 72
                                    }
                                }}
                            />
                        </div>
                    </Space>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No active job records found for this period"
                    />
                )}
            </Spin>
        </MotionCard>
    )
}

export default HseJobsParticipantsCard
