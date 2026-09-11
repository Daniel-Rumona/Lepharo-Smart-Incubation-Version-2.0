import React, { useMemo, useState } from 'react'
import { Modal, Button, Space, Typography, DatePicker, Row, Col, Card, Table, Empty, Segmented, Tag, Progress } from 'antd'
import { FullscreenOutlined, FullscreenExitOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'

import SessionReviewStory from './SessionReviewStory'
import { getCoverageReviewPhotos } from '@/lib/coveragePhotos'
import CoveragePhotoGallery from '@/components/appointments/CoveragePhotoGallery'

dayjs.extend(isBetween)

const { Text } = Typography
const { RangePicker } = DatePicker

type ViewMode = 'data' | 'story'

export type ReviewRange = 'day' | 'week' | 'month' | 'quarter'

// Fiscal year runs April - March, so Q1 = Apr/May/Jun (dayjs months are 0-indexed, April = 3)
const FISCAL_START_MONTH = 3

export interface ReviewMethod {
    label: string
    value: string
}

type ReviewAppt = any

interface SessionReviewModalProps {
    open: boolean
    onClose: () => void
    reviewRange: ReviewRange
    reviewDate: Dayjs
    onRangeChange: (range: ReviewRange) => void
    onDateChange: (value: Dayjs | null) => void
    groupedDisplayAppointments: any[]
    derivedStatus: (...args: any[]) => string
    getDisplayRowMembers: (...args: any[]) => any[]
    getAttendanceCounts: (...args: any[]) => { checkedIn: number }
    isMemberCheckedIn: (row: any, member: any) => boolean
    deliveryMethods: ReviewMethod[]
}

const rangeOptions = [
    { label: 'Daily', value: 'day' },
    { label: 'Weekly', value: 'week' },
    { label: 'Monthly', value: 'month' },
    { label: 'Quarterly', value: 'quarter' },
    { label: 'Custom', value: 'custom' }
]

const pickerByRange: Record<ReviewRange, 'date' | 'week' | 'month'> = {
    day: 'date',
    week: 'week',
    month: 'month',
    quarter: 'date'
}

const getFiscalQuarterStart = (date: Dayjs) => {
    const monthsIntoQuarter = ((date.month() - FISCAL_START_MONTH + 12) % 12) % 3
    return date.startOf('month').subtract(monthsIntoQuarter, 'month')
}

const getFiscalQuarterInfo = (date: Dayjs) => {
    const fiscalMonthIndex = (date.month() - FISCAL_START_MONTH + 12) % 12
    const quarterNumber = Math.floor(fiscalMonthIndex / 3) + 1
    const fiscalYear = date.month() >= FISCAL_START_MONTH ? date.year() : date.year() - 1
    return { quarterNumber, fiscalYear }
}

const getRangeBounds = (date: Dayjs, range: ReviewRange) => {
    switch (range) {
        case 'day':
            return {
                start: date.startOf('day'),
                end: date.endOf('day')
            }
        case 'week': {
            const start = date.startOf('week')
            return {
                start,
                end: start.endOf('week')
            }
        }
        case 'month':
            return {
                start: date.startOf('month'),
                end: date.endOf('month')
            }
        case 'quarter': {
            const start = getFiscalQuarterStart(date)
            return {
                start,
                end: start.add(2, 'month').endOf('month')
            }
        }
    }
}

const getRangeLabel = (date: Dayjs, range: ReviewRange) => {
    switch (range) {
        case 'day':
            return date.format('MMMM D, YYYY')
        case 'week': {
            const start = date.startOf('week')
            const end = start.endOf('week')
            return `${start.format('MMM D')} — ${end.format('MMM D, YYYY')}`
        }
        case 'month':
            return date.format('MMMM YYYY')
        case 'quarter': {
            const { quarterNumber, fiscalYear } = getFiscalQuarterInfo(date)
            return `Q${quarterNumber} ${fiscalYear} (${getFiscalQuarterStart(date).format('MMM')} – ${getFiscalQuarterStart(date).add(2, 'month').format('MMM')})`
        }
    }
}

const SessionReviewModal: React.FC<SessionReviewModalProps> = ({
    open,
    onClose,
    reviewRange,
    reviewDate,
    onRangeChange,
    onDateChange,
    groupedDisplayAppointments,
    derivedStatus,
    getDisplayRowMembers,
    getAttendanceCounts,
    isMemberCheckedIn,
    deliveryMethods
}) => {
    const [viewMode, setViewMode] = useState<ViewMode>('data')
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [customActive, setCustomActive] = useState(false)
    const [customDates, setCustomDates] = useState<[Dayjs, Dayjs] | null>(null)

    const activeRange = useMemo(() => {
        if (customActive && customDates) {
            return { start: customDates[0].startOf('day'), end: customDates[1].endOf('day') }
        }
        return getRangeBounds(reviewDate, reviewRange)
    }, [customActive, customDates, reviewDate, reviewRange])

    const rangeLabel = customActive && customDates
        ? `${customDates[0].format('MMM D, YYYY')} — ${customDates[1].format('MMM D, YYYY')}`
        : getRangeLabel(reviewDate, reviewRange)

    const rows = useMemo(() => {
        return groupedDisplayAppointments.filter(row => {
            const d = dayjs(row.date, 'YYYY-MM-DD')
            return d.isValid() && d.isBetween(activeRange.start, activeRange.end, 'day', '[]')
        })
    }, [groupedDisplayAppointments, activeRange])

    const upcoming = useMemo(() => {
        return groupedDisplayAppointments
            .filter(row => {
                const d = dayjs(row.date, 'YYYY-MM-DD')
                return d.isValid() && d.isAfter(activeRange.end, 'day')
            })
            .sort((a, b) => dayjs(a.date, 'YYYY-MM-DD').valueOf() - dayjs(b.date, 'YYYY-MM-DD').valueOf())
            .slice(0, 5)
            .map(row => ({
                date: row.date,
                title: row.sessionTitle || (row as any)?.sessionCoverage?.title || row.interventionTitle || 'Untitled session',
                branchName: row.branchName || row.branchId || ''
            }))
    }, [groupedDisplayAppointments, activeRange])

    const reviewData = useMemo(() => {
        const invitedIds = new Set<string>()
        const attendedIds = new Set<string>()
        let invitedInstances = 0
        let attendedInstances = 0

        rows.forEach(row => {
            getDisplayRowMembers(row).forEach((member: any) => {
                invitedInstances += 1
                const checkedIn = isMemberCheckedIn(row, member)
                if (checkedIn) attendedInstances += 1

                const participantId = String(member?.participantId || '').trim()
                if (!participantId) return
                invitedIds.add(participantId)
                if (checkedIn) attendedIds.add(participantId)
            })
        })

        const invited = invitedIds.size
        const attended = attendedIds.size
        const held = rows.filter(row => {
            const latest = (row as any)?.sessionCoverage?.latest
            return latest?.held === true || derivedStatus(row) === 'completed'
        }).length

        const deliveryCounts = deliveryMethods.map(method => ({
            name: method.label,
            y: rows.filter(row => row.deliveryMethod === method.value).length
        }))

        const coveredMap = new Map<string, number>()
        rows.forEach(row => {
            const latest = (row as any)?.sessionCoverage?.latest
            const points = latest?.coveredPoints || []
            points.forEach((point: string) => {
                coveredMap.set(point, (coveredMap.get(point) || 0) + 1)
            })
        })

        const coveredItems = Array.from(coveredMap.entries())
            .map(([topic, count]) => ({ topic, count }))
            .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))

        const attendanceRate = invited ? Math.round((attended / invited) * 100) : 0

        return {
            rows,
            sessions: rows.length,
            held,
            invited,
            attended,
            invitedInstances,
            attendedInstances,
            attendanceRate,
            deliveryCounts,
            coveredItems,
            photos: getCoverageReviewPhotos(rows)
        }
    }, [rows, deliveryMethods, derivedStatus, getDisplayRowMembers, isMemberCheckedIn])

    const topicsChartOptions: Highcharts.Options = {
        chart: { type: 'column', height: 280 },
        title: { text: undefined },
        credits: { enabled: false },
        xAxis: {
            categories: reviewData.coveredItems.slice(0, 8).map(item => item.topic),
            labels: { rotation: -25 }
        },
        yAxis: {
            min: 0,
            allowDecimals: false,
            title: { text: 'Sessions' }
        },
        tooltip: { pointFormat: '<b>{point.y}</b> session(s)' },
        series: [
            {
                type: 'column',
                name: 'Covered',
                data: reviewData.coveredItems.slice(0, 8).map(item => item.count)
            }
        ]
    }

    return (
        <Modal
            className='guide-session-review-modal'
            centered
            title='Session Review'
            open={open}
            onCancel={onClose}
            width={isFullscreen ? '96vw' : 900}
            styles={{
                body: {
                    maxHeight: '78vh',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingRight: 4
                }
            }}
            footer={[
                <Button key='close' type='primary' onClick={onClose}>
                    Close
                </Button>
            ]}
            destroyOnClose
        >
            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                <div data-guide='session-review-controls'>
                    <Space wrap style={{ width: '100%', justifyContent: 'space-between' }} align='center'>
                        <Text strong style={{ fontSize: 16 }}>
                            {rangeLabel}
                        </Text>

                        <Space wrap>
                            <Segmented
                                value={viewMode}
                                options={[
                                    { label: 'Data', value: 'data' },
                                    { label: 'Story', value: 'story' }
                                ]}
                                onChange={value => setViewMode(value as ViewMode)}
                            />
                            <Segmented
                                value={customActive ? 'custom' : reviewRange}
                                options={rangeOptions}
                                onChange={value => {
                                    if (value === 'custom') {
                                        setCustomActive(true)
                                        if (!customDates) {
                                            setCustomDates([reviewDate.startOf('month'), reviewDate.endOf('month')])
                                        }
                                    } else {
                                        setCustomActive(false)
                                        onRangeChange(value as ReviewRange)
                                    }
                                }}
                            />
                            {customActive ? (
                                <RangePicker
                                    value={customDates}
                                    onChange={value => {
                                        if (value && value[0] && value[1]) {
                                            setCustomDates([value[0], value[1]])
                                        }
                                    }}
                                    allowClear={false}
                                />
                            ) : reviewRange === 'quarter' ? (
                                <Space.Compact>
                                    <Button icon={<LeftOutlined />} onClick={() => onDateChange(reviewDate.subtract(3, 'month'))} />
                                    <Button icon={<RightOutlined />} onClick={() => onDateChange(reviewDate.add(3, 'month'))} />
                                </Space.Compact>
                            ) : (
                                <DatePicker
                                    picker={pickerByRange[reviewRange]}
                                    value={reviewDate}
                                    onChange={value => onDateChange(value || dayjs())}
                                    allowClear={false}
                                />
                            )}
                            <Button
                                icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                                onClick={() => setIsFullscreen(v => !v)}
                            />
                        </Space>
                    </Space>
                </div>

                {viewMode === 'story' ? (
                    <SessionReviewStory
                        rangeLabel={rangeLabel}
                        reviewData={reviewData}
                        upcoming={upcoming}
                        onExit={() => setViewMode('data')}
                    />
                ) : (
                    <>
                        <Row data-guide='session-review-metrics' gutter={[8, 8]}>
                            <Col xs={12} md={6}>
                                <Card size='small'>
                                    <Text type='secondary'>Sessions Held</Text>
                                    <div style={{ fontSize: 22, fontWeight: 700 }}>{reviewData.held}/{reviewData.sessions}</div>
                                </Card>
                            </Col>
                            <Col xs={12} md={6}>
                                <Card size='small'>
                                    <Text type='secondary'>Unique SMEs Invited</Text>
                                    <div style={{ fontSize: 22, fontWeight: 700 }}>{reviewData.invited}</div>
                                    {reviewData.invitedInstances !== reviewData.invited && (
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            {reviewData.invitedInstances} invites sent
                                        </Text>
                                    )}
                                </Card>
                            </Col>
                            <Col xs={12} md={6}>
                                <Card size='small'>
                                    <Text type='secondary'>Unique SMEs Attended</Text>
                                    <div style={{ fontSize: 22, fontWeight: 700 }}>{reviewData.attended}</div>
                                    {reviewData.attendedInstances !== reviewData.attended && (
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            {reviewData.attendedInstances} attendances
                                        </Text>
                                    )}
                                </Card>
                            </Col>
                            <Col xs={12} md={6}>
                                <Card size='small'>
                                    <Text type='secondary'>Attendance Rate</Text>
                                    <div style={{ fontSize: 22, fontWeight: 700 }}>{reviewData.attendanceRate}%</div>
                                </Card>
                            </Col>
                        </Row>

                        <Row data-guide='session-review-insights' gutter={[12, 12]}>
                            <Col xs={24} lg={12}>
                                <Card size='small' title='Delivery Distribution'>
                                    {reviewData.deliveryCounts.length ? (
                                        <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                            {reviewData.deliveryCounts.map(method => (
                                                <div key={method.name}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <Text>{method.name}</Text>
                                                        <Text type='secondary'>{method.y}</Text>
                                                    </div>
                                                    <Progress
                                                        percent={reviewData.sessions ? Math.round((method.y / reviewData.sessions) * 100) : 0}
                                                        size='small'
                                                        showInfo={false}
                                                    />
                                                </div>
                                            ))}
                                        </Space>
                                    ) : (
                                        <Empty description='No delivery methods configured.' />
                                    )}
                                </Card>
                            </Col>
                            <Col xs={24} lg={12}>
                                <Card size='small' title='Top Covered Topics'>
                                    {reviewData.coveredItems.length ? (
                                        <HighchartsReact highcharts={Highcharts} options={topicsChartOptions} />
                                    ) : (
                                        <Empty description='No covered topics captured for this range yet.' />
                                    )}
                                </Card>
                            </Col>
                        </Row>

                        <div data-guide='session-review-table'>
                            <Card size='small' title='Coverage'>
                                <Table
                                    rowKey='id'
                                    size='small'
                                    tableLayout='fixed'
                                    pagination={{
                                        pageSize: 5,
                                        showSizeChanger: false,
                                        position: ['bottomCenter']
                                    }}
                                    scroll={{ x: 860 }}
                                    expandable={{
                                        expandedRowKeys: reviewData.rows.map(row => row.id),
                                        showExpandColumn: false,
                                        expandedRowRender: (row: ReviewAppt) => {
                                            const latest = row.sessionCoverage?.latest
                                            const points: string[] = latest?.coveredPoints || []
                                            return (
                                                <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                                    <Text strong>Coverage</Text>
                                                    <Text>
                                                        {latest?.held === false
                                                            ? 'Session not held: ' + (latest.reasonNotHeld || 'No reason recorded.')
                                                            : latest?.notes || points.join('; ') || 'No coverage summary captured.'}
                                                    </Text>
                                                    {latest?.notes && points.length ? (
                                                        <Space wrap>{points.filter(point => point.trim() !== latest.notes.trim()).map(point => <Tag key={point}>{point}</Tag>)}</Space>
                                                    ) : null}
                                                    <CoveragePhotoGallery row={row} />
                                                </Space>
                                            )
                                        }
                                    }}
                                    dataSource={reviewData.rows}
                                    columns={[
                                        {
                                            title: 'Date',
                                            key: 'date',
                                            width: 110,
                                            render: (_: any, row: ReviewAppt) => dayjs(row.date).format('YYYY-MM-DD')
                                        },
                                        {
                                            title: 'Branch',
                                            key: 'branch',
                                            width: 150,
                                            ellipsis: true,
                                            render: (_: any, row: ReviewAppt) => (
                                                <Text ellipsis={{ tooltip: row.branchName || row.branchId }} style={{ display: 'block', maxWidth: 130 }}>
                                                    {row.branchName || row.branchId || '—'}
                                                </Text>
                                            )
                                        },
                                        {
                                            title: 'Title',
                                            key: 'title',
                                            width: 260,
                                            ellipsis: true,
                                            render: (_: any, row: ReviewAppt) => (
                                                <Space direction='vertical' size={0} style={{ width: '100%' }}>
                                                    <Text
                                                        strong
                                                        ellipsis={{ tooltip: row.sessionTitle || (row as any)?.sessionCoverage?.title || row.interventionTitle }}
                                                        style={{ display: 'block', maxWidth: 240 }}
                                                    >
                                                        {row.sessionTitle || (row as any)?.sessionCoverage?.title || row.interventionTitle}
                                                    </Text>
                                                    <Text
                                                        type='secondary'
                                                        ellipsis={{ tooltip: row.interventionTitle }}
                                                        style={{ display: 'block', maxWidth: 240, fontSize: 12 }}
                                                    >
                                                        {row.interventionTitle}
                                                    </Text>
                                                </Space>
                                            )
                                        },
                                        {
                                            title: 'Invited',
                                            key: 'invited',
                                            width: 90,
                                            render: (_: any, row: ReviewAppt) => getDisplayRowMembers(row).length
                                        },
                                        {
                                            title: 'Attended',
                                            key: 'attended',
                                            width: 100,
                                            render: (_: any, row: ReviewAppt) => getAttendanceCounts(row).checkedIn
                                        },
                                        {
                                            title: 'Delivery',
                                            key: 'delivery',
                                            width: 150,
                                            render: (_: any, row: ReviewAppt) => {
                                                const meta = deliveryMethods.find(m => m.value === row.deliveryMethod)
                                                return <Tag>{meta?.label || row.deliveryMethod}</Tag>
                                            }
                                        },

                                    ]}
                                />
                            </Card>
                        </div>
                    </>
                )}
            </Space>
        </Modal>
    )
}

export default SessionReviewModal
