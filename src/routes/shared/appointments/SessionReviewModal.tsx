import React, { useMemo, useState } from 'react'
import { Modal, Button, Space, Typography, DatePicker, Row, Col, Card, Empty, Tag, Progress, Input, Pagination, message } from 'antd'
import {
    SearchOutlined,
    FullscreenOutlined,
    FullscreenExitOutlined,
    FileWordOutlined,
    FilePdfOutlined,
    CheckCircleOutlined,
    TeamOutlined,
    UserOutlined,
    PercentageOutlined,
    TableOutlined,
    PlayCircleOutlined,
    CalendarOutlined,
    EnvironmentOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'

import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import SessionReviewStory from './SessionReviewStory'
import { getCoverageReviewPhotos } from '@/lib/coveragePhotos'
import CoveragePhotoGallery from '@/components/appointments/CoveragePhotoGallery'
import './session-review.css'
import { aggregateCoverageTopics } from '@/lib/coverageTopics'
import { isSessionReviewStatus } from '@/lib/sessionReviewScope'
import {
    exportAttendanceReportDocx,
    exportAttendanceReportPdf,
    type AttendanceReportRow
} from '@/utils/attendanceReportExport'

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

const getFiscalQuarterStart = (date: Dayjs) => {
    const monthsIntoQuarter = ((date.month() - FISCAL_START_MONTH + 12) % 12) % 3
    return date.startOf('month').subtract(monthsIntoQuarter, 'month')
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
    // The date range is always live and editable — no separate "custom"
    // toggle. It starts wherever the parent's last-used range/date landed,
    // and This Week/Month/Quarter live as the RangePicker's own preset
    // panel (the column to the left of the calendar when it opens).
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() => {
        const bounds = getRangeBounds(reviewDate, reviewRange)
        return [bounds.start, bounds.end]
    })

    const rangePresets = useMemo(() => {
        const now = dayjs()
        const toPreset = (preset: 'week' | 'month' | 'quarter') => {
            const bounds = getRangeBounds(now, preset)
            return [bounds.start, bounds.end] as [Dayjs, Dayjs]
        }
        return [
            { label: 'This Week', value: toPreset('week') },
            { label: 'This Month', value: toPreset('month') },
            { label: 'This Quarter', value: toPreset('quarter') }
        ]
    }, [])

    const activeRange = useMemo(
        () => ({ start: dateRange[0].startOf('day'), end: dateRange[1].endOf('day') }),
        [dateRange]
    )

    const rangeLabel = `${dateRange[0].format('MMM D, YYYY')} — ${dateRange[1].format('MMM D, YYYY')}`

    const inRange = useMemo(() => {
        return groupedDisplayAppointments.filter(row => {
            const d = dayjs(row.date, 'YYYY-MM-DD')
            return d.isValid() && d.isBetween(activeRange.start, activeRange.end, 'day', '[]')
        })
    }, [groupedDisplayAppointments, activeRange])
    // Use the same finished-session statuses as the appointments list. A date
    // range can include future days, but planned/live sessions are not results.
    const rows = useMemo(
        () => inRange.filter(row => isSessionReviewStatus(derivedStatus(row))),
        [inRange, derivedStatus]
    )
    const cancelledCount = inRange.filter(row => ['cancelled', 'postponed'].includes(derivedStatus(row))).length

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

        const coveredItems = aggregateCoverageTopics(rows)

        const attendanceRate = invited ? Math.round((attended / invited) * 100) : 0
        // Ended, but nobody has recorded what happened.
        const needsCoverage = rows.filter(row => derivedStatus(row) === 'awaiting_coverage').length

        return {
            rows,
            sessions: rows.length,
            held,
            invited,
            attended,
            invitedInstances,
            attendedInstances,
            attendanceRate,
            needsCoverage,
            deliveryCounts,
            coveredItems,
            photos: getCoverageReviewPhotos(rows)
        }
    }, [rows, deliveryMethods, derivedStatus, getDisplayRowMembers, isMemberCheckedIn])

    // Same fields as the Data-mode Coverage table below, reshaped for the
    // exported report so both views of this data stay in sync.
    const coverageRows = useMemo<AttendanceReportRow[]>(() => {
        return reviewData.rows.map((row: ReviewAppt) => {
            const methodMeta = deliveryMethods.find(m => m.value === row.deliveryMethod)
            return {
                date: row.date,
                branchName: row.branchName || row.branchId || '',
                title:
                    row.sessionTitle ||
                    (row as any)?.sessionCoverage?.title ||
                    row.interventionTitle ||
                    '',
                invited: getDisplayRowMembers(row).length,
                attended: getAttendanceCounts(row).checkedIn,
                delivery: methodMeta?.label || row.deliveryMethod || ''
            }
        })
    }, [reviewData.rows, deliveryMethods, getDisplayRowMembers, getAttendanceCounts])

    const buildReportData = () => ({
        rangeLabel,
        sessions: reviewData.sessions,
        held: reviewData.held,
        invited: reviewData.invited,
        attended: reviewData.attended,
        invitedInstances: reviewData.invitedInstances,
        attendedInstances: reviewData.attendedInstances,
        attendanceRate: reviewData.attendanceRate,
        deliveryCounts: reviewData.deliveryCounts,
        coveredItems: reviewData.coveredItems,
        rows: coverageRows,
        photos: reviewData.photos
    })

    const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null)

    const handleExport = async (format: 'docx' | 'pdf') => {
        setExporting(format)
        try {
            const data = buildReportData()
            if (format === 'docx') {
                await exportAttendanceReportDocx(data)
            } else {
                await exportAttendanceReportPdf(data)
            }
        } catch (error) {
            console.error('Failed to export attendance report:', error)
            message.error('Failed to export the attendance report. Please try again.')
        } finally {
            setExporting(null)
        }
    }

    // Skips zero-count topics — a 0-height bar is just clutter.
    const chartedTopics = reviewData.coveredItems.filter(item => item.count > 0).slice(0, 8)

    const [sessionSearch, setSessionSearch] = useState('')
    const [sessionPage, setSessionPage] = useState(1)
    const matchingRows = reviewData.rows.filter(row =>
        [row.sessionTitle, row.sessionCoverage?.title, row.interventionTitle, row.branchName, row.branchId]
            .some(value => String(value || '').toLowerCase().includes(sessionSearch.trim().toLowerCase()))
    ).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    const currentPage = Math.min(sessionPage, Math.max(1, Math.ceil(matchingRows.length / 6)))
    const visibleRows = matchingRows.slice((currentPage - 1) * 6, currentPage * 6)

    return (
        <Modal
            wrapClassName={isFullscreen ? 'session-review-fullscreen' : 'mobile-sheet'}
            className='guide-session-review-modal'
            centered={!isFullscreen}
            title={<span className='session-review-title'><CalendarOutlined /> Session review</span>}
            open={open}
            onCancel={onClose}
            afterClose={() => setIsFullscreen(false)}
            width={isFullscreen ? '100%' : 1120}
            styles={{
                body: {
                    maxHeight: isFullscreen ? undefined : '78vh',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingRight: 4
                }
            }}
            footer={null}
            destroyOnClose
        >
            <div className='session-review-layout'>
                <header className='session-review-heading'>
                    <div>
                        <span className='session-review-eyebrow'>DELIVERY & PARTICIPATION</span>
                        <h2>Your sessions at a glance</h2>
                        <Text type='secondary'>{rangeLabel}</Text>
                    </div>
                    <Tag color='blue'>{reviewData.sessions} ended sessions in this period</Tag>
                </header>
                <div className='session-review-toolbar' data-guide='session-review-controls'>
                    <Space wrap style={{ width: '100%', justifyContent: 'space-between' }} align='center'>
                        <Space wrap align='center' size={10}>
                            {/* This Week / This Month / This Quarter live as the
                                picker's own preset panel — the column of options
                                to the left of the calendar when it opens — rather
                                than a separate row of buttons. */}
                            <RangePicker
                                value={dateRange}
                                onChange={value => {
                                    if (value && value[0] && value[1]) {
                                        setDateRange([value[0], value[1]])
                                        setSessionPage(1)
                                        onDateChange(value[0])
                                    }
                                }}
                                presets={rangePresets}
                                allowClear={false}
                            />
                        </Space>

                        <Space wrap align='center'>
                            {/* Styled to match the app's top-nav segmented pills
                                (workspace-primary-nav / workspace-primary-segment in
                                components/layout/layout.css) rather than antd's
                                default Segmented look. */}
                            <div className='workspace-primary-nav'>
                                {[
                                    { value: 'data' as ViewMode, label: 'Overview', icon: <TableOutlined /> },
                                    { value: 'story' as ViewMode, label: 'Play review', icon: <PlayCircleOutlined /> }
                                ].map(option => (
                                    <button
                                        type='button'
                                        key={option.value}
                                        className={`workspace-primary-segment ${
                                            viewMode === option.value ? 'workspace-primary-segment-active' : ''
                                        }`}
                                        aria-pressed={viewMode === option.value}
                                        onClick={() => setViewMode(option.value)}
                                    >
                                        <span className='workspace-segment-icon'>{option.icon}</span>
                                        <span>{option.label}</span>
                                    </button>
                                ))}
                            </div>

                            <Space.Compact>
                                <Button
                                    icon={<FileWordOutlined />}
                                    loading={exporting === 'docx'}
                                    disabled={exporting !== null && exporting !== 'docx'}
                                    onClick={() => handleExport('docx')}
                                >
                                    Word
                                </Button>
                                <Button
                                    icon={<FilePdfOutlined />}
                                    loading={exporting === 'pdf'}
                                    disabled={exporting !== null && exporting !== 'pdf'}
                                    onClick={() => handleExport('pdf')}
                                >
                                    PDF
                                </Button>
                            </Space.Compact>
                            <Button
                                icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                                aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                                aria-pressed={isFullscreen}
                                onClick={() => setIsFullscreen(v => !v)}
                            />
                        </Space>
                    </Space>
                </div>

                {viewMode === 'story' ? (
                    <SessionReviewStory
                        rangeLabel={rangeLabel}
                        reviewData={reviewData}
                        onExit={() => setViewMode('data')}
                    />
                ) : (
                    <>
                        <Row data-guide='session-review-metrics' gutter={[8, 8]}>
                            <Col xs={12} md={6}>
                                <MetricTile
                                    title='Sessions held'
                                    value={`${reviewData.held} of ${reviewData.sessions}`}
                                    icon={<CheckCircleOutlined />}
                                    tone='info'
                                />
                            </Col>
                            <Col xs={12} md={6}>
                                <MetricTile
                                    title='SMEs invited'
                                    value={reviewData.invited}
                                    icon={<TeamOutlined />}
                                    tone='info'
                                />
                            </Col>
                            <Col xs={12} md={6}>
                                <MetricTile
                                    title='SMEs who attended'
                                    value={reviewData.attended}
                                    icon={<UserOutlined />}
                                    tone='success'
                                />
                            </Col>
                            <Col xs={12} md={6}>
                                <MetricTile
                                    title='Attendance rate'
                                    value={`${reviewData.attendanceRate}%`}
                                    icon={<PercentageOutlined />}
                                    tone='warning'
                                />
                            </Col>
                        </Row>
                        {(reviewData.needsCoverage > 0 || cancelledCount > 0) && (
                            <Text type='secondary' className='session-review-note'>
                                {[
                                    reviewData.needsCoverage ? `${reviewData.needsCoverage} ended session${reviewData.needsCoverage === 1 ? '' : 's'} still need${reviewData.needsCoverage === 1 ? 's' : ''} coverage.` : null,
                                    cancelledCount ? `${cancelledCount} cancelled or postponed session${cancelledCount === 1 ? ' is' : 's are'} left out.` : null
                                ].filter(Boolean).join(' ')}
                            </Text>
                        )}

                        <Row data-guide='session-review-insights' gutter={[12, 12]}>
                            <Col xs={24} lg={12}>
                                <Card className='session-review-panel' title='How sessions were delivered'>
                                    {reviewData.deliveryCounts.some(method => method.y > 0) ? (
                                        <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                            {reviewData.deliveryCounts.filter(method => method.y > 0).map(method => (
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
                                        <Empty description='No delivery data for this period.' />
                                    )}
                                </Card>
                            </Col>
                            <Col xs={24} lg={12}>
                                <Card className='session-review-panel' title='Topics covered'>
                                    {reviewData.coveredItems.length ? (
                                        <div className='session-review-topics'>
                                            {chartedTopics.map(item => (
                                                <div key={item.topic}>
                                                    <div className='session-review-topic-label'>
                                                        <Text>{item.topic}</Text>
                                                        <Text type='secondary'>{item.count} {item.count === 1 ? 'session' : 'sessions'}</Text>
                                                    </div>
                                                    <Progress percent={Math.round(item.count / Math.max(1, reviewData.sessions) * 100)} showInfo={false} size='small' strokeColor='#7c83db' />
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <Empty description='No covered topics captured for this range yet.' />
                                    )}
                                </Card>
                            </Col>
                        </Row>

                        <div data-guide='session-review-table'>
                            <Card className='session-review-panel session-review-records' title='Session details'>
                                <div className='session-review-list-tools'>
                                    <Text type='secondary'>Coverage, attendance and photos · newest first</Text>
                                    <Input prefix={<SearchOutlined />} placeholder='Search sessions or branches' aria-label='Search sessions or branches' allowClear value={sessionSearch}
                                        onChange={event => { setSessionSearch(event.target.value); setSessionPage(1) }} />
                                </div>
                                {matchingRows.length ? (
                                    <div className='session-review-session-grid'>
                                        {visibleRows.map((row: ReviewAppt) => {
                                            const latest = row.sessionCoverage?.latest
                                            const points: string[] = latest?.coveredPoints || []
                                            const meta = deliveryMethods.find(m => m.value === row.deliveryMethod)
                                            const title = row.sessionTitle || row.sessionCoverage?.title || row.interventionTitle || 'Untitled session'

                                            return (
                                                <Card
                                                    key={row.id}
                                                    size='small'
                                                    className='session-review-session-card'
                                                >
                                                    <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                                                            <div style={{ minWidth: 0 }}>
                                                                <Text strong style={{ fontSize: 14 }}>{title}</Text>
                                                                {row.interventionTitle && row.interventionTitle !== title ? (
                                                                    <div>
                                                                        <Text type='secondary' style={{ fontSize: 12 }}>{row.interventionTitle}</Text>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                            <Space size={6} wrap style={{ flex: '0 0 auto' }}>
                                                                <Tag icon={<CalendarOutlined />} color='blue'>
                                                                    {dayjs(row.date).format('DD MMM YYYY')}
                                                                </Tag>
                                                                <Tag>{meta?.label || row.deliveryMethod}</Tag>
                                                                {derivedStatus(row) === 'awaiting_coverage' ? <Tag color='gold'>Needs coverage</Tag> : null}
                                                                {latest?.held === false ? <Tag color='red'>Not held</Tag> : null}
                                                            </Space>
                                                        </div>

                                                        <Space size={18} wrap>
                                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                                <EnvironmentOutlined /> {row.branchName || row.branchId || '—'}
                                                            </Text>
                                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                                <TeamOutlined /> {getDisplayRowMembers(row).length} invited
                                                            </Text>
                                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                                <CheckCircleOutlined /> {getAttendanceCounts(row).checkedIn} attended
                                                            </Text>
                                                        </Space>

                                                        <Text style={{ fontSize: 13 }}>
                                                            {latest?.held === false
                                                                ? 'Not held: ' + (latest.reasonNotHeld || 'no reason recorded.')
                                                                : latest?.notes || points.join('; ') || (derivedStatus(row) === 'awaiting_coverage' ? 'Ended — coverage not recorded yet.' : 'Not held yet.')}
                                                        </Text>
                                                        {latest?.notes && points.length ? (
                                                            <Space wrap>
                                                                {points
                                                                    .filter(point => point.trim() !== latest.notes.trim())
                                                                    .map(point => <Tag key={point}>{point}</Tag>)}
                                                            </Space>
                                                        ) : null}

                                                        <CoveragePhotoGallery row={row} />
                                                    </Space>
                                                </Card>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <Empty description={sessionSearch ? 'No sessions match your search.' : 'No ended sessions in this period.'} />
                                )}
                                {matchingRows.length > 6 && (
                                    <Pagination className='session-review-pagination' current={currentPage} pageSize={6} total={matchingRows.length} onChange={setSessionPage} showSizeChanger={false} />
                                )}
                            </Card>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    )
}

export default SessionReviewModal
