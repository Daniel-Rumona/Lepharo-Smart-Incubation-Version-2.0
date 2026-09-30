import dayjs from 'dayjs'
import { Tooltip, Typography } from 'antd'
import { BranchDayHours, BranchOperatingHours, getDayHours } from '@/utils/branchOperatingHours'
import {
    TimesheetEntry,
    dateKey,
    formatMinutes,
    getEntryWorkedMinutes,
    parseClockTimeToMinutes
} from './timesheetUtils'
import './weekly-timeline.css'

const { Text } = Typography

interface WeeklyTimelineCardProps {
    days: Date[]
    entries: TimesheetEntry[]
    shiftHours: BranchOperatingHours
    now: Date
    todayKey: string
}

type Segment = { startMin: number; endMin: number; color: string; label: string }

const COLOR_WORKED = '#1677ff'
const COLOR_LATE = '#ff4d4f'
const COLOR_OVERTIME = '#faad14'

const clampPct = (value: number) => Math.min(100, Math.max(0, value))

const clockLabel = (minutes: number | null) => {
    if (minutes === null) return '—'
    const wrapped = ((minutes % 1440) + 1440) % 1440
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

const formatTickStep = (spanMinutes: number) => {
    if (spanMinutes <= 6 * 60) return 60
    if (spanMinutes <= 10 * 60) return 60
    return 120
}

const formatShortDuration = (minutes: number) => {
    const safe = Math.max(0, minutes)
    const h = Math.floor(safe / 60)
    const m = safe % 60
    if (h <= 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

const WeeklyTimelineCard = ({ days, entries, shiftHours, now, todayKey }: WeeklyTimelineCardProps) => {
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    const rows = days.map(date => {
        const key = dateKey(date)
        const entry = entries.find(row => row.date === key)
        const shift: BranchDayHours = entry?.scheduledHours || getDayHours(shiftHours, date)
        const isToday = key === todayKey
        const isLive = !!entry && entry.status !== 'checked_out'

        const label = isToday ? 'Today' : dayjs(date).format('dddd, D')

        const checkInMin = entry?.checkIn ? parseClockTimeToMinutes(entry.checkIn) : null
        const checkOutMin = entry?.checkOut && entry.checkOut !== '-'
            ? parseClockTimeToMinutes(entry.checkOut)
            : isLive && isToday
                ? nowMinutes
                : null

        const openMin = shift.closed ? checkInMin : parseClockTimeToMinutes(shift.opens)
        const closeMin = shift.closed ? checkOutMin : parseClockTimeToMinutes(shift.closes)

        const segments: Segment[] = []
        if (checkInMin !== null) {
            if (!shift.closed && openMin !== null && checkInMin > openMin) {
                segments.push({ startMin: openMin, endMin: checkInMin, color: COLOR_LATE, label: 'Late' })
            }

            const workEnd = checkOutMin === null
                ? checkInMin
                : !shift.closed && closeMin !== null
                    ? Math.min(checkOutMin, closeMin)
                    : checkOutMin

            segments.push({
                startMin: checkInMin,
                endMin: Math.max(checkInMin, workEnd),
                color: COLOR_WORKED,
                label: 'Worked'
            })

            if (!shift.closed && closeMin !== null && checkOutMin !== null && checkOutMin > closeMin) {
                segments.push({ startMin: closeMin, endMin: checkOutMin, color: COLOR_OVERTIME, label: 'Overtime' })
            }
        }

        const durationMinutes = entry ? getEntryWorkedMinutes(entry, now) : 0

        return {
            key,
            label,
            entry,
            shift,
            isLive,
            checkInMin,
            checkOutMin,
            segments,
            durationLabel: formatMinutes(durationMinutes),
            emptyLabel: shift.closed ? 'Day off' : entry ? 'No clock-in recorded' : 'Not clocked in'
        }
    })

    const boundMinutes: number[] = []
    rows.forEach(row => {
        if (!row.shift.closed) {
            const opens = parseClockTimeToMinutes(row.shift.opens)
            const closes = parseClockTimeToMinutes(row.shift.closes)
            if (opens !== null) boundMinutes.push(opens)
            if (closes !== null) boundMinutes.push(closes)
        }
        row.segments.forEach(seg => {
            boundMinutes.push(seg.startMin, seg.endMin)
        })
    })

    const rawStart = boundMinutes.length ? Math.min(...boundMinutes) : 7 * 60
    const rawEnd = boundMinutes.length ? Math.max(...boundMinutes) : 17 * 60
    // Aligned to the actual earliest/latest bound (rounded to the hour), not padded —
    // padding here just reads as dead space at the start/end of every bar.
    const axisStart = Math.max(0, Math.floor(rawStart / 60) * 60)
    const axisEnd = Math.min(24 * 60, Math.ceil(rawEnd / 60) * 60)
    const span = Math.max(60, axisEnd - axisStart)

    const pct = (minutes: number) => clampPct(((minutes - axisStart) / span) * 100)

    const ticks: number[] = []
    const step = formatTickStep(span)
    for (let m = axisStart; m <= axisEnd; m += step) ticks.push(m)

    return (
        <div className='weekly-timeline'>
            <div className='weekly-timeline__legend'>
                <span className='weekly-timeline__legend-item'>
                    <i style={{ background: COLOR_WORKED }} /> Worked
                </span>
                <span className='weekly-timeline__legend-item'>
                    <i style={{ background: COLOR_LATE }} /> Late
                </span>
                <span className='weekly-timeline__legend-item'>
                    <i style={{ background: COLOR_OVERTIME }} /> Overtime
                </span>
            </div>

            <div className='weekly-timeline__axis-row'>
                <div className='weekly-timeline__side' />
                <div className='weekly-timeline__axis'>
                    {ticks.map(tick => (
                        <span
                            key={tick}
                            className='weekly-timeline__axis-tick'
                            style={{ left: `${pct(tick)}%` }}
                        >
                            {clockLabel(tick)}
                        </span>
                    ))}
                </div>
                <div className='weekly-timeline__side' />
            </div>

            {rows.map(row => (
                <div className='weekly-timeline__row' key={row.key}>
                    <div className='weekly-timeline__row-header'>
                        <Text strong style={{ fontSize: 13 }}>{row.label}</Text>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            Duration: <Text strong style={{ fontSize: 12 }}>{row.durationLabel}</Text>
                        </Text>
                    </div>

                    <div className='weekly-timeline__track-line'>
                        <div className='weekly-timeline__side weekly-timeline__side--start'>
                            <span className='weekly-timeline__side-label'>Clock-in</span>
                            <span className='weekly-timeline__side-value'>{clockLabel(row.checkInMin)}</span>
                        </div>

                        <div className='weekly-timeline__track'>
                            {row.segments.length === 0 ? (
                                <span className='weekly-timeline__track-empty'>{row.emptyLabel}</span>
                            ) : (
                                row.segments.map((seg, index) => {
                                    const isLiveSegment = row.isLive && index === row.segments.length - 1
                                    return (
                                        <Tooltip
                                            key={index}
                                            title={
                                                <div className='weekly-timeline__tooltip'>
                                                    <span
                                                        className='weekly-timeline__tooltip-dot'
                                                        style={{ background: seg.color }}
                                                    />
                                                    <div>
                                                        <div className='weekly-timeline__tooltip-title'>
                                                            {isLiveSegment ? `${seg.label} (in progress)` : seg.label}
                                                        </div>
                                                        <div className='weekly-timeline__tooltip-range'>
                                                            {clockLabel(seg.startMin)} – {isLiveSegment ? 'now' : clockLabel(seg.endMin)}
                                                            {' · '}{formatShortDuration(seg.endMin - seg.startMin)}
                                                        </div>
                                                    </div>
                                                </div>
                                            }
                                        >
                                            <div
                                                className={`weekly-timeline__segment${
                                                    isLiveSegment ? ' weekly-timeline__segment--live' : ''
                                                }`}
                                                style={{
                                                    left: `${pct(seg.startMin)}%`,
                                                    width: `${Math.max(pct(seg.endMin) - pct(seg.startMin), 0.6)}%`,
                                                    background: seg.color
                                                }}
                                            />
                                        </Tooltip>
                                    )
                                })
                            )}
                        </div>

                        <div className='weekly-timeline__side weekly-timeline__side--end'>
                            <span className='weekly-timeline__side-label'>Clock-out</span>
                            <span className='weekly-timeline__side-value'>
                                {row.isLive ? 'In progress' : clockLabel(row.checkOutMin)}
                            </span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}

export default WeeklyTimelineCard
