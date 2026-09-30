import { useMemo, useState } from 'react'
import dayjs, { Dayjs } from 'dayjs'
import { Tooltip, Typography } from 'antd'
import { BranchOperatingHours } from '@/utils/branchOperatingHours'
import { LeaveRequestEntry, TimesheetEntry } from './timesheetUtils'
import {
    AttendanceLegend,
    COLORS,
    DayDetailModal,
    DayInfo,
    computeDayInfo,
    dayStats,
    mondayOf,
    shade,
    statusLabel
} from './attendanceShared'
import './attendance-heatmap.css'

const { Text } = Typography

interface AttendanceHeatmapCardProps {
    startDate: string
    endDate: string
    entries: TimesheetEntry[]
    leaveRequests: LeaveRequestEntry[]
    shiftHours: BranchOperatingHours
    todayKey: string
    now: Date
}

interface MonthBlock {
    key: string
    label: string
    days: DayInfo[]
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

const AttendanceHeatmapCard = ({
    startDate,
    endDate,
    entries,
    leaveRequests,
    shiftHours,
    todayKey,
    now
}: AttendanceHeatmapCardProps) => {
    const [selectedKey, setSelectedKey] = useState<string | null>(null)

    const ctx = { startDate, endDate, entries, leaveRequests, shiftHours, todayKey, now }

    const buildDay = (date: Dayjs, monthStart: Dayjs): DayInfo => {
        const info = computeDayInfo(date, ctx)
        return date.month() === monthStart.month() ? info : { ...info, status: 'padding' }
    }

    const months: MonthBlock[] = useMemo(() => {
        const firstMonth = dayjs(startDate).startOf('month')
        const lastMonth = dayjs(endDate).startOf('month')
        const monthSpan = lastMonth.diff(firstMonth, 'month') + 1

        return Array.from({ length: monthSpan }).map((_, index) => {
            const monthStart = firstMonth.add(index, 'month')
            const monthEnd = monthStart.endOf('month')
            const calStart = mondayOf(monthStart)
            const calEnd = mondayOf(monthEnd).add(6, 'day')
            const weekCount = Math.round(calEnd.diff(calStart, 'day') / 7) + 1

            const days: DayInfo[] = Array.from({ length: weekCount * 5 }).map((_, index2) => {
                const w = Math.floor(index2 / 5)
                const d = index2 % 5
                return buildDay(calStart.add(w * 7 + d, 'day'), monthStart)
            })

            return { key: monthStart.format('YYYY-MM'), label: monthStart.format('MMMM YYYY'), days }
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startDate, endDate, entries, leaveRequests, shiftHours, todayKey, now])

    const allDays = useMemo(() => months.flatMap(m => m.days), [months])
    const stats = dayStats(allDays)
    const selected = selectedKey ? allDays.find(d => d.key === selectedKey) || null : null

    return (
        <div className='attendance-heatmap'>
            <div className='attendance-heatmap__months-wrap'>
                {months.map(month => (
                    <div className='attendance-heatmap__month' key={month.key}>
                        <Text strong style={{ fontSize: 13 }}>{month.label}</Text>

                        <div className='attendance-heatmap__weekday-row'>
                            {WEEKDAY_HEADERS.map(label => (
                                <span key={label}>{label}</span>
                            ))}
                        </div>

                        <div className='attendance-heatmap__cal-grid'>
                            {month.days.map(day => {
                                if (day.status === 'padding') {
                                    return (
                                        <span key={day.key} className='attendance-heatmap__cal-cell attendance-heatmap__cal-cell--padding'>
                                            <span className='attendance-heatmap__cal-num'>{dayjs(day.date).date()}</span>
                                        </span>
                                    )
                                }

                                const tint = day.status === 'onsite' || day.status === 'remote'
                                    ? shade(COLORS[day.status], Math.max(day.ratio, 0.5) * 0.25)
                                    : day.status === 'leave' || day.status === 'absent'
                                        ? `${COLORS[day.status]}22`
                                        : COLORS[day.status]

                                const clickable = day.status !== 'upcoming' && day.status !== 'closed'

                                return (
                                    <Tooltip
                                        key={day.key}
                                        title={`${dayjs(day.date).format('ddd, D MMM')} · ${statusLabel(day.status)}`}
                                    >
                                        <button
                                            type='button'
                                            className={`attendance-heatmap__cal-cell${clickable ? ' attendance-heatmap__cal-cell--clickable' : ''}`}
                                            style={{ background: tint }}
                                            disabled={!clickable}
                                            onClick={() => clickable && setSelectedKey(day.key)}
                                            aria-label={`${dayjs(day.date).format('D MMMM')}: ${statusLabel(day.status)}`}
                                        >
                                            <span className='attendance-heatmap__cal-num'>{dayjs(day.date).date()}</span>
                                            {(day.status === 'onsite' || day.status === 'remote' || day.status === 'leave' || day.status === 'absent') && (
                                                <span
                                                    className='attendance-heatmap__cal-dot'
                                                    style={{ background: COLORS[day.status] }}
                                                />
                                            )}
                                        </button>
                                    </Tooltip>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <AttendanceLegend stats={stats} />
            <DayDetailModal selected={selected} onClose={() => setSelectedKey(null)} now={now} />
        </div>
    )
}

export default AttendanceHeatmapCard
