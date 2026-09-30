import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs, { Dayjs } from 'dayjs'
import { Tooltip } from 'antd'
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
import './attendance-density.css'

interface AttendanceDensityCardProps {
    startDate: string
    endDate: string
    entries: TimesheetEntry[]
    leaveRequests: LeaveRequestEntry[]
    shiftHours: BranchOperatingHours
    todayKey: string
    now: Date
}

const GAP = 6
const MIN_CELL = 22
const MAX_CELL = 34
const LABEL_GUTTER = 34 // weekday-label column width + body gap, kept in sync with the CSS
const WEEKDAY_LABEL = ['Mon', '', 'Wed', '', 'Fri', '', '']

// A quarter-length range needs a density overview, not per-day legibility —
// this is the weeks-as-columns "contribution graph" style, sibling to
// AttendanceHeatmapCard's calendar grid used for single-month ranges.
const AttendanceDensityCard = ({
    startDate,
    endDate,
    entries,
    leaveRequests,
    shiftHours,
    todayKey,
    now
}: AttendanceDensityCardProps) => {
    const [selectedKey, setSelectedKey] = useState<string | null>(null)

    const wrapRef = useRef<HTMLDivElement>(null)
    const [wrapWidth, setWrapWidth] = useState(0)

    useEffect(() => {
        const el = wrapRef.current
        if (!el) return
        const observer = new ResizeObserver(entries2 => {
            const width = entries2[0]?.contentRect.width
            if (typeof width === 'number') setWrapWidth(width)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const gridStart = mondayOf(dayjs(startDate))
    const gridEnd = mondayOf(dayjs(endDate)).add(6, 'day')
    const totalDays = gridEnd.diff(gridStart, 'day') + 1
    const weekCount = Math.ceil(totalDays / 7)

    const available = Math.max(0, wrapWidth - LABEL_GUTTER)
    const rawCell = weekCount > 0 ? (available - (weekCount - 1) * GAP) / weekCount : MIN_CELL
    const CELL = wrapWidth === 0 ? MIN_CELL : Math.min(MAX_CELL, Math.max(MIN_CELL, Math.floor(rawCell)))
    const COLUMN_WIDTH = CELL + GAP

    const days: DayInfo[] = useMemo(() => {
        const ctx = { startDate, endDate, entries, leaveRequests, shiftHours, todayKey, now }
        return Array.from({ length: weekCount * 7 }).map((_, index) =>
            computeDayInfo(gridStart.add(index, 'day'), ctx)
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gridStart.valueOf(), weekCount, entries, leaveRequests, shiftHours, startDate, endDate, todayKey, now])

    const stats = dayStats(days)

    const monthLabels = useMemo(() => {
        const labels: { week: number; text: string }[] = []
        let lastMonth = -1
        for (let week = 0; week < weekCount; week++) {
            const weekStart = gridStart.add(week * 7, 'day')
            if (weekStart.month() !== lastMonth) {
                labels.push({ week, text: weekStart.format('MMM') })
                lastMonth = weekStart.month()
            }
        }
        return labels
    }, [gridStart.valueOf(), weekCount])

    const selected = selectedKey ? days.find(d => d.key === selectedKey) || null : null

    return (
        <div className='attendance-density'>
            <div className='attendance-density__canvas-wrap' ref={wrapRef}>
                <div className='attendance-density__canvas'>
                    <div
                        className='attendance-density__months'
                        style={{
                            marginLeft: LABEL_GUTTER,
                            gridTemplateColumns: `repeat(${weekCount}, ${COLUMN_WIDTH}px)`
                        }}
                    >
                        {monthLabels.map(label => (
                            <span
                                key={label.week}
                                style={{ gridColumn: label.week + 1 }}
                                className='attendance-density__month-label'
                            >
                                {label.text}
                            </span>
                        ))}
                    </div>

                    <div className='attendance-density__body'>
                        <div className='attendance-density__weekday-labels'>
                            {WEEKDAY_LABEL.map((label, index) => (
                                <span key={index} style={{ height: CELL, marginBottom: index === 6 ? 0 : GAP }}>
                                    {label}
                                </span>
                            ))}
                        </div>

                        <div
                            className='attendance-density__grid'
                            style={{
                                gridTemplateColumns: `repeat(${weekCount}, ${CELL}px)`,
                                gridTemplateRows: `repeat(7, ${CELL}px)`
                            }}
                        >
                            {days.map(day => {
                                if (day.status === 'padding') {
                                    return <span key={day.key} className='attendance-density__cell attendance-density__cell--padding' />
                                }

                                const background = day.status === 'onsite' || day.status === 'remote'
                                    ? shade(COLORS[day.status], day.ratio)
                                    : COLORS[day.status]

                                const clickable = day.status !== 'upcoming' && day.status !== 'closed'
                                const isMuted = day.status === 'closed' || day.status === 'upcoming'

                                return (
                                    <Tooltip
                                        key={day.key}
                                        title={`${dayjs(day.date).format('ddd, D MMM')} · ${statusLabel(day.status)}`}
                                    >
                                        <button
                                            type='button'
                                            className={`attendance-density__cell${clickable ? ' attendance-density__cell--clickable' : ''}${isMuted ? ' attendance-density__cell--muted' : ''}`}
                                            style={{ background, fontSize: CELL >= 26 ? 11 : 9 }}
                                            disabled={!clickable}
                                            onClick={() => clickable && setSelectedKey(day.key)}
                                            aria-label={`${dayjs(day.date).format('D MMMM')}: ${statusLabel(day.status)}`}
                                        >
                                            {dayjs(day.date).date()}
                                        </button>
                                    </Tooltip>
                                )
                            })}
                        </div>
                    </div>
                </div>
            </div>

            <AttendanceLegend stats={stats} />
            <DayDetailModal selected={selected} onClose={() => setSelectedKey(null)} now={now} />
        </div>
    )
}

export default AttendanceDensityCard
