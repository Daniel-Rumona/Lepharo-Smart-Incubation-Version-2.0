import React, { useMemo } from 'react'
import { Tag } from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import dayjs from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { formatRole } from '@/lib/roleLabels'
import { dailySeries, formatAgo, formatDuration, type Person, type Session } from './activityData'

type Props = {
    person: Person
    sessions: Session[]
    days: number
    now: number
}

/** One person's use of the app in the window: totals, a daily chart and their latest sessions. */
export const ActivityPersonDetail: React.FC<Props> = ({ person, sessions, days, now }) => {
    const mine = useMemo(
        () => sessions.filter(s => s.personId === person.id).sort((a, b) => b.started - a.started),
        [sessions, person.id]
    )
    const series = useMemo(() => dailySeries(mine, days, now), [mine, days, now])

    const chart: Highcharts.Options = {
        chart: { type: 'column', height: 220 },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: { categories: series.map(p => dayjs(p.key).format('D MMM')) },
        yAxis: { min: 0, title: { text: undefined }, labels: { format: '{value}h' } },
        tooltip: { pointFormat: '<b>{point.y}h</b>' },
        plotOptions: { column: { borderRadius: 3, borderWidth: 0 } },
        series: [{ type: 'column', name: 'Hours', data: series.map(p => p.hours) }]
    }

    return (
        <div className='ws-detail'>
            <MotionCard>
                <header className='ws-detail-head'>
                    <EntityAvatar name={person.name} photo={person.photo} size={48} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{person.name}</h2>
                        <div className='ws-detail-sub'>{person.team || person.email}</div>
                        <div className='ws-detail-tags'>
                            <Tag color={person.active ? 'green' : 'default'} bordered={false}>
                                {person.active ? 'Active now' : `Last seen ${formatAgo(person.lastSeen, now)}`}
                            </Tag>
                            {person.roles.map(role => (
                                <Tag key={role} bordered={false}>
                                    {formatRole(role)}
                                </Tag>
                            ))}
                        </div>
                    </div>
                </header>

                <div className='ws-detail-tabs'>
                    <div className='ws-detail-pane'>
                        <div className='ws-detail-body'>
                            <section>
                                <h4 className='ws-section-title'>Last {days} days</h4>
                                <dl className='ws-facts'>
                                    <div>
                                        <dt>Time in the app</dt>
                                        <dd>{formatDuration(person.minutes)}</dd>
                                    </div>
                                    <div>
                                        <dt>Sessions</dt>
                                        <dd>{person.sessions}</dd>
                                    </div>
                                    <div>
                                        <dt>Average session</dt>
                                        <dd>{formatDuration(person.sessions ? person.minutes / person.sessions : 0)}</dd>
                                    </div>
                                    <div>
                                        <dt>Sessions today</dt>
                                        <dd>{person.sessionsToday}</dd>
                                    </div>
                                </dl>
                            </section>

                            <section>
                                <h4 className='ws-section-title'>Hours per day</h4>
                                <HighchartsReact highcharts={Highcharts} options={chart} />
                            </section>

                            <section>
                                <h4 className='ws-section-title'>Latest sessions</h4>
                                <ul className='act-sessions'>
                                    {mine.slice(0, 8).map(s => (
                                        <li key={`${s.started}-${s.role}`}>
                                            <span>{dayjs(s.started).format('ddd D MMM, HH:mm')}</span>
                                            <span className='ws-muted'>{formatDuration(s.minutes)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        </div>
                    </div>
                </div>
            </MotionCard>
        </div>
    )
}
