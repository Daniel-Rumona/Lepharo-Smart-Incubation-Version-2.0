import React from 'react'
import { Empty, Skeleton } from 'antd'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import type { Count, EngagementModel } from './engagementModel'
import { FigureBar, Legend, pct, type Status } from './FigureBar'

const SESSION_STATUSES: Status[] = [
    { key: 'held', label: 'Held', tone: 'done' },
    { key: 'awaitingOutcome', label: 'Outcome not recorded', tone: 'expiring' },
    { key: 'notHeld', label: 'Not held', tone: 'attention' },
    { key: 'upcoming', label: 'Upcoming', tone: 'waiting' }
]

/** A ranked list: label, a bar against the largest value, and the count. */
const RankList: React.FC<{ title: string; items: Count[] }> = ({ title, items }) => {
    const max = Math.max(1, ...items.map(i => i.value))
    return (
        <div className="cs-rank">
            <span className="cs-rank-title">{title}</span>
            {items.length ? (
                <ul>
                    {items.map(item => (
                        <li key={item.label}>
                            <span className="cs-rank-label" title={item.label}>{item.label}</span>
                            <span className="cs-rank-bar" aria-hidden="true">
                                <i style={{ width: `${(item.value / max) * 100}%` }} />
                            </span>
                            <strong>{item.value}</strong>
                        </li>
                    ))}
                </ul>
            ) : (
                <span className="ds-muted">None</span>
            )}
        </div>
    )
}

const Stat: React.FC<{ value: React.ReactNode; label: string; tone?: string }> = ({ value, label, tone }) => (
    <div className="ds-stat">
        <span className={`ds-stat-value${tone ? ` is-${tone}` : ''}`}>{value}</span>
        <span className="ds-stat-label">{label}</span>
    </div>
)

/** Appointment sessions and walk-ins, in figures. */
const EngagementSnapshot: React.FC<{
    model: EngagementModel | null
    loading?: boolean
    /** The monthly chart, shown small underneath. */
    trend?: React.ReactNode
}> = ({ model, loading, trend }) => {
    if (loading || !model) {
        return (
            <MotionCard>
                <Skeleton active paragraph={{ rows: 6 }} />
            </MotionCard>
        )
    }

    const { sessions, walkIns } = model

    return (
        <div className="cs">
            <MotionCard title="Appointments">
                {sessions.total || sessions.cancelled ? (
                    <div className="ds">
                        <div className="ds-summary">
                            <Stat value={sessions.total} label="sessions scheduled" />
                            <Stat value={sessions.held} label={`held (${pct(sessions.held, sessions.total)}%)`} tone="done" />
                            <Stat
                                value={sessions.invited ? `${pct(sessions.attended, sessions.invited)}%` : '—'}
                                label={`attendance (${sessions.attended} of ${sessions.invited} invited)`}
                            />
                            <Stat value={sessions.cancelled} label="cancelled" tone="gap" />
                        </div>
                        {sessions.total ? (
                            <>
                                <Legend statuses={SESSION_STATUSES} />
                                <div className="cs-rows" role="list">
                                    <FigureBar title="All sessions" total={sessions.total} statuses={SESSION_STATUSES} counts={sessions} />
                                    {model.departments.length > 1
                                        ? model.departments.map(d => (
                                            <FigureBar key={d.id} title={d.label} total={d.total} statuses={SESSION_STATUSES} counts={d} />
                                        ))
                                        : null}
                                </div>
                                <div className="cs-split">
                                    <RankList title="How they were delivered" items={sessions.byMethod} />
                                    <RankList
                                        title="Session type"
                                        items={[
                                            { label: 'One SME', value: sessions.individual },
                                            { label: 'Group', value: sessions.group }
                                        ].filter(i => i.value)}
                                    />
                                </div>
                            </>
                        ) : null}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No appointments in this period." />
                )}
            </MotionCard>

            <MotionCard title="Walk-ins">
                {walkIns.total ? (
                    <div className="ds">
                        <div className="ds-summary">
                            <Stat value={walkIns.total} label="walk-ins recorded" />
                            <Stat value={walkIns.incubated} label="incubated SMEs" tone="done" />
                            <Stat value={walkIns.nonIncubated} label="other visitors" />
                            <Stat value={walkIns.open} label="still open" tone="gap" />
                        </div>
                        <div className="cs-split">
                            <RankList title="What they came for" items={walkIns.byType} />
                            <RankList
                                title="Follow-up"
                                items={[
                                    { label: 'Resolved or closed', value: walkIns.closed },
                                    { label: 'Still open', value: walkIns.open }
                                ].filter(i => i.value)}
                            />
                        </div>
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No walk-ins recorded in this period." />
                )}
            </MotionCard>

            {trend ? <MotionCard title="Sessions held and walk-ins by month">{trend}</MotionCard> : null}
        </div>
    )
}

export default EngagementSnapshot
