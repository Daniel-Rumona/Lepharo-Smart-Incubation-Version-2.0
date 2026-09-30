import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Modal, Table, Typography } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import {
    LeaveRequestEntry,
    TimesheetEntry,
    formatMinutes,
    getEntryWorkedMinutes,
    isLeaveCoveringDate,
    parseHoursStringToMinutes
} from '@/routes/shared/timesheet/timesheetUtils'
import {
    DayDetailModal,
    DayInfo,
    DayStatus,
    mondayOf
} from '@/routes/shared/timesheet/attendanceShared'
import './TeamAttendanceGrid.css'

const { Text } = Typography

export interface TeamMember {
    key: string
    name: string
    department?: string
    position?: string
}

type Row = TimesheetEntry & { userId: string }

interface TeamAttendanceGridProps {
    employees: TeamMember[]
    rows: Row[]
    leaveRequests: LeaveRequestEntry[]
    startDate: string
    endDate: string
    now: Date
}

const lateMinutesOf = (row?: Row) =>
    parseInt(String(row?.lateBy || '0m').replace(/\D/g, '')) || 0

const toDayInfo = (date: string, row?: Row, leave?: LeaveRequestEntry): DayInfo => {
    const status: DayStatus = leave ? 'leave' : row?.centerMatched ? 'onsite' : 'remote'
    return {
        key: `${row?.userId || leave?.employeeId}_${date}`,
        date: dayjs(date).toDate(),
        status,
        entry: row,
        leave,
        ratio: 1
    }
}

const TeamAttendanceGrid = ({ employees, rows, leaveRequests, startDate, endDate, now }: TeamAttendanceGridProps) => {
    const [drillEmployee, setDrillEmployee] = useState<TeamMember | null>(null)
    const [selected, setSelected] = useState<DayInfo | null>(null)

    const dayCount = Math.max(1, dayjs(endDate).diff(dayjs(startDate), 'day') + 1)
    const isWeekMode = dayCount <= 7

    const dateKeys = useMemo(
        () => Array.from({ length: dayCount }).map((_, i) => dayjs(startDate).add(i, 'day').format('YYYY-MM-DD')),
        [startDate, dayCount]
    )

    // Weekends are excluded everywhere in this view — same convention as the
    // single-user calendar, since the default schedule is closed Sat/Sun.
    const businessDateKeys = useMemo(
        () => dateKeys.filter(date => {
            const weekday = dayjs(date).day()
            return weekday !== 0 && weekday !== 6
        }),
        [dateKeys]
    )

    const byEmployee = useMemo(() => {
        const map = new Map<string, Map<string, Row>>()
        rows.forEach(row => {
            const key = String(row.userId)
            if (!map.has(key)) map.set(key, new Map())
            map.get(key)!.set(row.date, row)
        })
        return map
    }, [rows])

    const leaveByEmployee = useMemo(() => {
        const map = new Map<string, LeaveRequestEntry[]>()
        leaveRequests.forEach(leave => {
            const key = String(leave.employeeId)
            if (!map.has(key)) map.set(key, [])
            map.get(key)!.push(leave)
        })
        return map
    }, [leaveRequests])

    const leaveOn = (employeeKey: string, date: string) =>
        (leaveByEmployee.get(employeeKey) || []).find(l => isLeaveCoveringDate(l, date))

    const drillStats = useMemo(() => {
        if (!drillEmployee) return null

        const empRowsMap = byEmployee.get(drillEmployee.key)
        let onsite = 0
        let remote = 0
        let leave = 0
        let present = 0

        businessDateKeys.forEach(date => {
            const leaveHit = leaveOn(drillEmployee.key, date)
            const row = empRowsMap?.get(date)

            if (leaveHit) {
                leave += 1
                return
            }
            if (row?.checkIn) {
                present += 1
                if (row.centerMatched) onsite += 1
                else remote += 1
            }
        })

        const daysInPeriod = businessDateKeys.length
        const rate = daysInPeriod ? Math.round((present / daysInPeriod) * 100) : 0

        return { present, daysInPeriod, rate, onsite, remote, leave }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drillEmployee, byEmployee, leaveByEmployee, businessDateKeys])

    const summaryByEmployee = useMemo(() => {
        const map = new Map<string, {
            daysPresent: number
            totalMinutes: number
            lateMinutes: number
            overtimeMinutes: number
            rate: number
        }>()

        employees.forEach(emp => {
            const empRowsMap = byEmployee.get(emp.key)
            const empRows = businessDateKeys
                .map(date => empRowsMap?.get(date))
                .filter((row): row is Row => !!row)
            const daysPresent = empRows.filter(r => !!r.checkIn).length
            const totalMinutes = empRows.reduce((sum, r) => sum + getEntryWorkedMinutes(r, now), 0)
            const lateMinutes = empRows.reduce((sum, r) => sum + lateMinutesOf(r), 0)
            const overtimeMinutes = empRows.reduce((sum, r) => sum + parseHoursStringToMinutes(r.overtime || '0h 0m'), 0)
            const rate = businessDateKeys.length ? Math.round((daysPresent / businessDateKeys.length) * 100) : 0

            map.set(emp.key, { daysPresent, totalMinutes, lateMinutes, overtimeMinutes, rate })
        })

        return map
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [employees, byEmployee, businessDateKeys, now])

    const renderTimeCell = (row: Row | undefined, date: string, employeeKey: string) => {
        const dateLabel = dayjs(date).format('ddd D')
        const leave = leaveOn(employeeKey, date)

        if (leave) {
            return (
                <button
                    type='button'
                    className='team-grid__cell team-grid__cell--clickable team-grid__cell--leave'
                    onClick={event => {
                        event.stopPropagation()
                        setSelected(toDayInfo(date, row, leave))
                    }}
                >
                    <span className='team-grid__cell-date'>{dateLabel}</span>
                    <span>On leave</span>
                </button>
            )
        }

        if (!row || !row.checkIn) {
            return (
                <span className='team-grid__cell team-grid__cell--empty'>
                    <span className='team-grid__cell-date'>{dateLabel}</span>
                    <span>—</span>
                </span>
            )
        }

        const isLate = lateMinutesOf(row) > 0
        const checkOut = row.checkOut && row.checkOut !== '-' ? row.checkOut : '…'

        return (
            <button
                type='button'
                className={`team-grid__cell team-grid__cell--clickable${isLate ? ' team-grid__cell--late' : ''}`}
                onClick={event => {
                    event.stopPropagation()
                    setSelected(toDayInfo(date, row))
                }}
            >
                <span className='team-grid__cell-date'>{dateLabel}</span>
                <span>{row.checkIn}</span>
                <span className='team-grid__cell-arrow'>→</span>
                <span>{checkOut}</span>
            </button>
        )
    }

    const columns = [
        {
            key: 'card',
            render: (_: any, emp: TeamMember) => {
                const summary = summaryByEmployee.get(emp.key)

                const identity = (
                    <div className='team-card__identity'>
                        <Text strong>{emp.name}</Text>
                        {emp.position ? (
                            <span className='team-card__position'>{emp.position}</span>
                        ) : null}
                    </div>
                )
                const arrow = (
                    <span className='team-card__arrow' aria-hidden='true'>
                        <RightOutlined />
                    </span>
                )

                return (
                    <div
                        className='team-card team-card--clickable'
                        role='button'
                        tabIndex={0}
                        aria-label={`Open ${emp.name}'s period summary`}
                        onClick={() => setDrillEmployee(emp)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setDrillEmployee(emp)
                            }
                        }}
                    >
                        <div className='team-card__row'>
                            {identity}

                            {isWeekMode ? (
                                <div className='team-card__days'>
                                    {businessDateKeys.map(date => (
                                        <span key={date}>{renderTimeCell(byEmployee.get(emp.key)?.get(date), date, emp.key)}</span>
                                    ))}
                                </div>
                            ) : summary ? (
                                <div className='team-card__stats-inline'>
                                    <span className='team-card__stat-inline'>
                                        <b>{summary.rate}%</b> Attendance rate
                                    </span>
                                    <span className='team-card__stat-divider' />
                                    <span className='team-card__stat-inline'>
                                        <b>{summary.daysPresent}</b> Days present
                                    </span>
                                    <span className='team-card__stat-divider' />
                                    <span className='team-card__stat-inline'>
                                        <b>{formatMinutes(summary.totalMinutes)}</b> Hours worked
                                    </span>
                                    <span className='team-card__stat-divider' />
                                    <span className='team-card__stat-inline'>
                                        <b>{summary.lateMinutes}m</b> Late
                                    </span>
                                    <span className='team-card__stat-divider' />
                                    <span className='team-card__stat-inline'>
                                        <b>{formatMinutes(summary.overtimeMinutes)}</b> Overtime
                                    </span>
                                </div>
                            ) : <div className='team-card__days' />}

                            {arrow}
                        </div>
                    </div>
                )
            }
        }
    ]

    const drillDates = drillEmployee ? byEmployee.get(drillEmployee.key) : undefined

    // Grouped into real Mon–Fri calendar weeks (not just the flat filtered
    // list) so a period that starts mid-week still reads left-to-right in
    // the normal weekday order, with the days before/after the selected
    // range shown as blank padding rather than skipped.
    const drillWeeks = useMemo(() => {
        const firstMonday = mondayOf(dayjs(startDate))
        const lastSunday = mondayOf(dayjs(endDate)).add(6, 'day')
        const weekCount = Math.ceil((lastSunday.diff(firstMonday, 'day') + 1) / 7)

        return Array.from({ length: weekCount }).map((_, w) =>
            Array.from({ length: 5 }).map((_, d) => {
                const date = firstMonday.add(w * 7 + d, 'day').format('YYYY-MM-DD')
                return { date, inRange: date >= startDate && date <= endDate }
            })
        )
    }, [startDate, endDate])

    return (
        <>
            <Table
                rowKey='key'
                showHeader={false}
                columns={columns}
                dataSource={employees}
                pagination={{ pageSize: 10, showSizeChanger: false, position: ['bottomCenter'] }}
                locale={{ emptyText: 'No team members match the selected filters.' }}
                className='team-grid__table'
            />

            <Modal
                open={!!drillEmployee}
                onCancel={() => setDrillEmployee(null)}
                footer={null}
                title={drillEmployee?.name}
                width={460}
                centered
            >
                {drillStats && (
                    <div className='team-grid__drill-stats'>
                        <div className='team-grid__drill-stat'>
                            <span className='team-grid__drill-stat-value'>{drillStats.rate}%</span>
                            <span className='team-grid__drill-stat-label'>Attendance rate</span>
                        </div>
                        <div className='team-grid__drill-stat'>
                            <span className='team-grid__drill-stat-value'>{drillStats.present}/{drillStats.daysInPeriod}</span>
                            <span className='team-grid__drill-stat-label'>Days present</span>
                        </div>
                        <div className='team-grid__drill-stat'>
                            <span className='team-grid__drill-stat-value'>{drillStats.onsite}</span>
                            <span className='team-grid__drill-stat-label'>Onsite</span>
                        </div>
                        <div className='team-grid__drill-stat'>
                            <span className='team-grid__drill-stat-value'>{drillStats.remote}</span>
                            <span className='team-grid__drill-stat-label'>Remote</span>
                        </div>
                        <div className='team-grid__drill-stat'>
                            <span className='team-grid__drill-stat-value'>{drillStats.leave}</span>
                            <span className='team-grid__drill-stat-label'>Leave</span>
                        </div>
                    </div>
                )}

                <div className='team-grid__drill-chips'>
                    {drillWeeks.map((week, weekIndex) => (
                        <div className='team-grid__drill-week' key={weekIndex}>
                            {week.map(({ date, inRange }) => {
                                if (!inRange) {
                                    return <span key={date} className='team-grid__drill-chip team-grid__drill-chip--padding' />
                                }

                                const row = drillDates?.get(date)
                                const leave = drillEmployee ? leaveOn(drillEmployee.key, date) : undefined
                                const hasRecord = !!row?.checkIn
                                const isLate = hasRecord && lateMinutesOf(row) > 0
                                const clickable = !!leave || hasRecord
                                const variant = leave ? 'leave' : !hasRecord ? 'empty' : isLate ? 'late' : 'present'

                                return (
                                    <button
                                        key={date}
                                        type='button'
                                        className={`team-grid__drill-chip team-grid__drill-chip--${variant}`}
                                        disabled={!clickable}
                                        onClick={() => {
                                            if (!clickable) return
                                            setDrillEmployee(null)
                                            setSelected(toDayInfo(date, row, leave))
                                        }}
                                        title={leave ? 'On leave' : hasRecord ? `${row!.checkIn} → ${row!.checkOut && row!.checkOut !== '-' ? row!.checkOut : '…'}` : 'No record'}
                                    >
                                        <span className='team-grid__drill-chip-day'>{dayjs(date).format('ddd')}</span>
                                        <span className='team-grid__drill-chip-date'>{dayjs(date).format('D MMM')}</span>
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                </div>
            </Modal>

            <DayDetailModal selected={selected} onClose={() => setSelected(null)} now={now} />
        </>
    )
}

export default TeamAttendanceGrid
