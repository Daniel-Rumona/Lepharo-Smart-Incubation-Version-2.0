import dayjs, { Dayjs } from 'dayjs'
import { Alert, Modal, Space, Tag, Tooltip, Typography } from 'antd'
import {
    CheckCircleOutlined,
    EnvironmentOutlined,
    ExclamationCircleOutlined,
    HourglassOutlined
} from '@ant-design/icons'
import { BranchOperatingHours, getDayHours } from '@/utils/branchOperatingHours'
import {
    LeaveRequestEntry,
    TimesheetEntry,
    dateKey,
    formatMinutes,
    getEntryWorkedMinutes,
    getLeaveTypeLabel,
    isLeaveCoveringDate,
    parseClockTimeToMinutes
} from './timesheetUtils'
import './attendanceShared.css'

const { Text, Title } = Typography

export type DayStatus = 'onsite' | 'remote' | 'leave' | 'absent' | 'closed' | 'upcoming' | 'padding'

export interface DayInfo {
    key: string
    date: Date
    status: DayStatus
    entry?: TimesheetEntry
    leave?: LeaveRequestEntry
    ratio: number
}

export interface DayContext {
    startDate: string
    endDate: string
    entries: TimesheetEntry[]
    leaveRequests: LeaveRequestEntry[]
    shiftHours: BranchOperatingHours
    todayKey: string
    now: Date
}

export const COLORS: Record<Exclude<DayStatus, 'padding'>, string> = {
    onsite: '#1677ff',
    remote: '#13c2c2',
    leave: '#faad14',
    absent: '#ff4d4f',
    // CSS custom properties, not hex — these two are neutral surface fills
    // (day off / hasn't happened yet), so they need to track light vs dark
    // mode instead of being fixed to a single pale shade.
    closed: 'var(--app-surface-sunken)',
    upcoming: 'var(--app-bg)'
}

export const TAG_COLOR: Partial<Record<DayStatus, string>> = {
    onsite: 'blue',
    remote: 'cyan',
    leave: 'gold',
    absent: 'red'
}

export const BANNER_TINT: Partial<Record<DayStatus, string>> = {
    onsite: 'rgba(22, 119, 255, .08)',
    remote: 'rgba(19, 194, 194, .08)',
    leave: 'rgba(250, 173, 20, .10)',
    absent: 'rgba(255, 77, 79, .08)'
}

export const mondayOf = (d: Dayjs) => {
    const day = d.day()
    const diff = day === 0 ? -6 : 1 - day
    return d.add(diff, 'day').startOf('day')
}

export const shade = (hex: string, ratio: number) => {
    const clamped = Math.min(1, Math.max(0.35, ratio))
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${clamped})`
}

export const statusLabel = (status: DayStatus) => {
    switch (status) {
        case 'onsite': return 'Onsite'
        case 'remote': return 'Remote'
        case 'leave': return 'On leave'
        case 'absent': return 'No record'
        case 'closed': return 'Day off'
        case 'upcoming': return 'Upcoming'
        default: return ''
    }
}

export const computeDayInfo = (date: Dayjs, ctx: DayContext): DayInfo => {
    const nativeDate = date.toDate()
    const key = dateKey(nativeDate)
    const inRange = key >= ctx.startDate && key <= ctx.endDate

    if (!inRange) {
        return { key, date: nativeDate, status: 'padding', ratio: 0 }
    }

    const leave = ctx.leaveRequests.find(l => isLeaveCoveringDate(l, key))
    const entry = ctx.entries.find(e => e.date === key)
    const shift = entry?.scheduledHours || getDayHours(ctx.shiftHours, nativeDate)
    const isFuture = key > ctx.todayKey

    let status: DayStatus
    if (leave) {
        status = 'leave'
    } else if (entry?.checkIn) {
        status = entry.centerMatched ? 'onsite' : 'remote'
    } else if (shift.closed) {
        status = 'closed'
    } else if (isFuture) {
        status = 'upcoming'
    } else {
        status = 'absent'
    }

    const workedMinutes = entry ? getEntryWorkedMinutes(entry, ctx.now) : 0
    const plannedMinutes = shift.closed
        ? 0
        : (() => {
            const [oh, om] = shift.opens.split(':').map(Number)
            const [ch, cm] = shift.closes.split(':').map(Number)
            return Math.max(1, (ch * 60 + cm) - (oh * 60 + om))
        })()
    const ratio = plannedMinutes ? workedMinutes / plannedMinutes : 1

    return { key, date: nativeDate, status, entry, leave, ratio }
}

export const dayStats = (days: DayInfo[]) => {
    const businessDays = days.filter(d => d.status !== 'padding' && d.status !== 'upcoming' && d.status !== 'closed')
    const countOf = (status: DayStatus) => businessDays.filter(d => d.status === status).length
    const total = businessDays.length || 1
    const pct = (count: number) => Math.round((count / total) * 100)

    return {
        onsite: pct(countOf('onsite')),
        remote: pct(countOf('remote')),
        leave: pct(countOf('leave')),
        absent: pct(countOf('absent'))
    }
}

export const AttendanceLegend = ({ stats }: { stats: ReturnType<typeof dayStats> }) => (
    <div className='attendance-heatmap__legend'>
        <span className='attendance-heatmap__legend-item'>
            <i style={{ background: COLORS.onsite }} /> Onsite <b>{stats.onsite}%</b>
        </span>
        <span className='attendance-heatmap__legend-item'>
            <i style={{ background: COLORS.remote }} /> Remote <b>{stats.remote}%</b>
        </span>
        <span className='attendance-heatmap__legend-item'>
            <i style={{ background: COLORS.leave }} /> On leave <b>{stats.leave}%</b>
        </span>
        {stats.absent > 0 && (
            <span className='attendance-heatmap__legend-item attendance-heatmap__legend-item--muted'>
                <i style={{ background: COLORS.absent }} /> No record <b>{stats.absent}%</b>
            </span>
        )}
    </div>
)

type DaySegment = { startMin: number; endMin: number; color: string; label: string }

const clockLabel = (minutes: number) => {
    const wrapped = ((minutes % 1440) + 1440) % 1440
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

const shortDuration = (minutes: number) => {
    const safe = Math.max(0, minutes)
    const h = Math.floor(safe / 60)
    const m = safe % 60
    if (h <= 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

const buildDaySegments = (entry: TimesheetEntry) => {
    const checkInMin = parseClockTimeToMinutes(entry.checkIn)
    if (checkInMin === null) return null

    const checkOutMin = entry.checkOut && entry.checkOut !== '-'
        ? parseClockTimeToMinutes(entry.checkOut)
        : null
    const isLive = entry.status !== 'checked_out'
    const shift = entry.scheduledHours
    const openMin = shift && !shift.closed ? parseClockTimeToMinutes(shift.opens) : null
    const closeMin = shift && !shift.closed ? parseClockTimeToMinutes(shift.closes) : null

    const segments: DaySegment[] = []
    if (openMin !== null && checkInMin > openMin) {
        segments.push({ startMin: openMin, endMin: checkInMin, color: COLORS.absent, label: 'Late' })
    }

    const workEnd = checkOutMin === null
        ? checkInMin
        : closeMin !== null
            ? Math.min(checkOutMin, closeMin)
            : checkOutMin
    segments.push({ startMin: checkInMin, endMin: Math.max(checkInMin, workEnd), color: COLORS.onsite, label: 'Worked' })

    if (closeMin !== null && checkOutMin !== null && checkOutMin > closeMin) {
        segments.push({ startMin: closeMin, endMin: checkOutMin, color: COLORS.leave, label: 'Overtime' })
    }

    const boundStart = Math.min(openMin ?? checkInMin, checkInMin)
    const boundEnd = Math.max(closeMin ?? checkOutMin ?? checkInMin, checkOutMin ?? checkInMin)
    const span = Math.max(30, boundEnd - boundStart)
    const pct = (minutes: number) => Math.min(100, Math.max(0, ((minutes - boundStart) / span) * 100))

    return { segments, pct, isLive }
}

export const DayDetailModal = ({
    selected,
    onClose,
    now
}: {
    selected: DayInfo | null
    onClose: () => void
    now: Date
}) => (
    <Modal
        open={!!selected}
        onCancel={onClose}
        footer={null}
        title={null}
        width={480}
        centered
        className='attendance-heatmap__modal-root'
    >
        {selected && (
            <div className='attendance-heatmap__modal'>
                <div
                    className='attendance-heatmap__modal-banner'
                    style={{ background: BANNER_TINT[selected.status] || 'rgba(0,0,0,.03)' }}
                >
                    <div>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {dayjs(selected.date).format('dddd')}
                        </Text>
                        <Title level={4} style={{ margin: '2px 0 0' }}>
                            {dayjs(selected.date).format('D MMMM YYYY')}
                        </Title>
                    </div>
                    <Tag color={TAG_COLOR[selected.status] || 'default'} style={{ fontSize: 12, padding: '3px 10px' }}>
                        {statusLabel(selected.status)}
                    </Tag>
                </div>

                {selected.entry && (() => {
                    const entry = selected.entry
                    const timeline = buildDaySegments(entry)
                    const checkOutLabel = entry.checkOut && entry.checkOut !== '-' ? entry.checkOut : null

                    return (
                        <>
                            {timeline && (
                                <div className='day-detail__timeline'>
                                    <div className='day-detail__timeline-track'>
                                        {timeline.segments.map((seg, index) => {
                                            const isLiveSegment = timeline.isLive && index === timeline.segments.length - 1
                                            return (
                                                <Tooltip
                                                    key={index}
                                                    title={
                                                        <div className='day-detail__tooltip'>
                                                            <span className='day-detail__tooltip-dot' style={{ background: seg.color }} />
                                                            <div>
                                                                <div className='day-detail__tooltip-title'>
                                                                    {isLiveSegment ? `${seg.label} (in progress)` : seg.label}
                                                                </div>
                                                                <div className='day-detail__tooltip-range'>
                                                                    {clockLabel(seg.startMin)} – {isLiveSegment ? 'now' : clockLabel(seg.endMin)}
                                                                    {' · '}{shortDuration(seg.endMin - seg.startMin)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    }
                                                >
                                                    <span
                                                        className={`day-detail__timeline-segment${isLiveSegment ? ' day-detail__timeline-segment--live' : ''}`}
                                                        style={{
                                                            left: `${timeline.pct(seg.startMin)}%`,
                                                            width: `${Math.max(timeline.pct(seg.endMin) - timeline.pct(seg.startMin), 1.5)}%`,
                                                            background: seg.color
                                                        }}
                                                    />
                                                </Tooltip>
                                            )
                                        })}
                                    </div>
                                    <div className='day-detail__timeline-labels'>
                                        <span>{entry.checkIn}</span>
                                        <span>{checkOutLabel ? checkOutLabel : timeline.isLive ? 'In progress' : '—'}</span>
                                    </div>
                                </div>
                            )}

                            <div className='day-detail__stats'>
                                <div className='day-detail__stat'>
                                    <CheckCircleOutlined className='day-detail__stat-icon' style={{ color: COLORS.onsite }} />
                                    <span className='day-detail__stat-label'>Hours worked</span>
                                    <span className='day-detail__stat-value'>{formatMinutes(getEntryWorkedMinutes(entry, now))}</span>
                                </div>
                                <div className='day-detail__stat-divider' />
                                <div className='day-detail__stat'>
                                    <HourglassOutlined className='day-detail__stat-icon' style={{ color: COLORS.absent }} />
                                    <span className='day-detail__stat-label'>Late by</span>
                                    <span className='day-detail__stat-value'>{entry.lateBy || '0m'}</span>
                                </div>
                                <div className='day-detail__stat-divider' />
                                <div className='day-detail__stat'>
                                    <ExclamationCircleOutlined className='day-detail__stat-icon' style={{ color: COLORS.leave }} />
                                    <span className='day-detail__stat-label'>Overtime</span>
                                    <span className='day-detail__stat-value'>{entry.overtime || '0h 0m'}</span>
                                </div>
                            </div>

                            <div className='day-detail__location'>
                                <EnvironmentOutlined className='day-detail__location-icon' />
                                <div>
                                    <Text type='secondary' style={{ fontSize: 11 }}>Location</Text>
                                    <div><Text strong>{entry.locationLabel || '—'}</Text></div>
                                </div>
                            </div>

                            {entry.overtimeReason && (
                                <Alert
                                    type={
                                        entry.overtimeApprovalStatus === 'approved' ? 'success' :
                                            entry.overtimeApprovalStatus === 'rejected' ? 'error' : 'warning'
                                    }
                                    showIcon
                                    message={
                                        <Space size={6}>
                                            <span>Overtime reason</span>
                                            {entry.overtimeApprovalStatus && (
                                                <Tag color={
                                                    entry.overtimeApprovalStatus === 'approved' ? 'green' :
                                                        entry.overtimeApprovalStatus === 'rejected' ? 'red' : 'gold'
                                                }>
                                                    {entry.overtimeApprovalStatus}
                                                </Tag>
                                            )}
                                        </Space>
                                    }
                                    description={entry.overtimeReason}
                                />
                            )}

                            {entry.autoClockedOut && (
                                <Alert
                                    type='warning'
                                    showIcon
                                    message='Auto clocked out'
                                    description={entry.autoClockOutReason || 'The system closed this session automatically.'}
                                />
                            )}

                            {entry.auditFlag && (
                                <Alert
                                    type='error'
                                    showIcon
                                    message='Flagged for review'
                                    description={entry.auditFlag}
                                />
                            )}
                        </>
                    )
                })()}

                {selected.leave && (
                    <div className='attendance-heatmap__modal-grid'>
                        <div>
                            <Text type='secondary'>Leave type</Text>
                            <div><Text strong>{getLeaveTypeLabel(selected.leave.type)}</Text></div>
                        </div>
                        <div>
                            <Text type='secondary'>Dates</Text>
                            <div><Text strong>{selected.leave.from} to {selected.leave.to}</Text></div>
                        </div>
                        {selected.leave.reason && (
                            <div style={{ gridColumn: '1 / -1' }}>
                                <Text type='secondary'>Reason</Text>
                                <div><Text>{selected.leave.reason}</Text></div>
                            </div>
                        )}
                    </div>
                )}

                {selected.status === 'absent' && (
                    <Text type='secondary'>No attendance record was captured for this working day.</Text>
                )}
            </div>
        )}
    </Modal>
)
