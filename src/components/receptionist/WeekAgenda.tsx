import React, { useMemo, useState } from 'react'
import { Button, Card, Empty, Skeleton } from 'antd'
import { EnvironmentOutlined, ReloadOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import '@/styles/admin-overview.css'
import '@/styles/receptionist-dashboard.css'

/*
 * The working week at the branch: Monday to Friday (the coming week at a
 * weekend), today always marked, each day with how
 * many appointments and events it holds, and the chosen day's agenda in time
 * order beneath it.
 */

export type ScheduleKind = 'event' | 'appointment'

export type ScheduleItem = {
    id: string
    kind: ScheduleKind
    title: string
    date: Date
    startTime?: string
    endTime?: string
    participant?: string
    facilitator?: string
    location?: string
    branchId?: string
    programId?: string
}

const DAYS = 5

/**
 * Monday of the working week on show: this week's, or the coming week's at a
 * weekend, when this week's working days are over.
 */
export const agendaWeekStart = (today = dayjs().startOf('day')) => {
    const weekday = today.day() // 0 Sunday … 6 Saturday
    if (weekday === 6) return today.add(2, 'day')
    if (weekday === 0) return today.add(1, 'day')
    return today.subtract(weekday - 1, 'day')
}

const WeekAgenda: React.FC<{
    items: ScheduleItem[]
    loading: boolean
    branchName: string
    onRefresh: () => void
}> = ({ items, loading, branchName, onRefresh }) => {
    const today = dayjs().startOf('day')
    const monday = agendaWeekStart(today)
    // Opens on today; at a weekend, on the coming Monday.
    const [selected, setSelected] = useState(() => Math.max(0, today.diff(monday, 'day')))

    const days = useMemo(
        () =>
            Array.from({ length: DAYS }, (_, i) => monday.add(i, 'day')).map(day => {
                const dayItems = items
                    .filter(item => dayjs(item.date).isSame(day, 'day'))
                    .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'))
                return { day, items: dayItems }
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [items, today.valueOf()]
    )

    const weekTotal = days.reduce((total, d) => total + d.items.length, 0)
    const current = days[selected]
    const relativeName = (day: dayjs.Dayjs) =>
        day.isSame(today, 'day') ? 'Today' : day.isSame(today.add(1, 'day'), 'day') ? 'Tomorrow' : null
    const dayName = relativeName(current.day) || current.day.format('dddd')

    return (
        <Card className='admin-card' bordered={false}>
            <div className='admin-card-head'>
                <div>
                    <h3>This week's agenda</h3>
                    <span>
                        {branchName} · {weekTotal} {weekTotal === 1 ? 'booking' : 'bookings'}, Monday{' '}
                        {days[0].day.format('D MMM')} to Friday {days[DAYS - 1].day.format('D MMM')}
                    </span>
                </div>
                <Button type='text' size='small' icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
                    Refresh
                </Button>
            </div>

            <div className='rcp-week-strip' role='tablist' aria-label='Days this week'>
                {days.map((d, i) => (
                    <button
                        key={d.day.valueOf()}
                        type='button'
                        role='tab'
                        aria-selected={i === selected}
                        aria-current={d.day.isSame(today, 'day') ? 'date' : undefined}
                        className={[
                            'rcp-week-day',
                            i === selected && 'is-selected',
                            d.day.isSame(today, 'day') && 'is-today',
                            d.day.isBefore(today, 'day') && 'is-past'
                        ]
                            .filter(Boolean)
                            .join(' ')}
                        onClick={() => setSelected(i)}
                    >
                        {d.day.isSame(today, 'day') && <span className='rcp-today-flag'>Today</span>}
                        <small>{d.day.format('ddd')}</small>
                        <strong>{d.day.format('D')}</strong>
                        <span className={d.items.length ? 'rcp-week-count has-items' : 'rcp-week-count'}>
                            {d.items.length || '–'}
                        </span>
                    </button>
                ))}
            </div>

            <div className='rcp-agenda-day'>
                <span>
                    {dayName}, {current.day.format('D MMMM')}
                </span>
                <span>
                    {current.items.length} {current.items.length === 1 ? 'item' : 'items'}
                </span>
            </div>

            {loading ? (
                <Skeleton active paragraph={{ rows: 3 }} />
            ) : current.items.length ? (
                <ol className='rcp-agenda'>
                    {current.items.map(item => (
                        <li key={item.id} className={`is-${item.kind}`}>
                            <div className='rcp-agenda-time'>
                                <strong>{item.startTime || 'All day'}</strong>
                                {item.endTime && <small>{item.endTime}</small>}
                            </div>
                            <div className='rcp-agenda-body'>
                                <div className='rcp-agenda-title'>
                                    <strong>{item.title}</strong>
                                    <span className='rcp-kind'>{item.kind === 'appointment' ? 'Appointment' : 'Event'}</span>
                                </div>
                                <div className='rcp-agenda-meta'>
                                    {item.participant && (
                                        <span>
                                            <UserOutlined /> {item.participant}
                                        </span>
                                    )}
                                    {item.facilitator && (
                                        <span>
                                            <TeamOutlined /> {item.facilitator}
                                        </span>
                                    )}
                                    {item.location && (
                                        <span>
                                            <EnvironmentOutlined /> {item.location}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}
                </ol>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`Nothing booked for ${dayName.toLowerCase() === 'today' ? 'today' : dayName}.`} />
            )}
        </Card>
    )
}

export default WeekAgenda
