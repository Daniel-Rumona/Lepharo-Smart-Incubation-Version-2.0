import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Empty, Progress, Row, Skeleton, Tag, theme, Typography } from 'antd'
import {
    ArrowDownOutlined,
    ArrowUpOutlined,
    CheckCircleOutlined,
    MinusOutlined,
    RightOutlined,
    TeamOutlined,
    WarningOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { db } from '@/firebase'
import { useDashboardDateRange } from '@/lib/useDashboardDateRange'
import { formatRole } from '@/lib/roleLabels'
import '@/styles/admin-overview.css'

/*
 * System admin overview: platform size, growth, who uses it, applications,
 * sign-in activity and email delivery failures. The period comes from the
 * topbar date filter (lib/useDashboardDateRange); "All time" shows everything
 * with no comparison.
 */

const dateFormatter = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })

type Trend = { amount: string; direction: 'up' | 'down' | 'flat'; tone: 'good' | 'bad' | 'neutral'; text: string }

type UserRow = { id: string; role: string; createdAt: Date | null; active: boolean }
type ApplicationRow = { id: string; status: 'accepted' | 'pending' | 'rejected'; at: Date | null }
type FailureRow = { id: string; type: string; to: string; error: string; at: Date | null }
type SessionRow = { uid: string; at: Date }
type Month = { month: Date; newUsers: number; totalUsers: number; activeUsers: number; applications: number; errors: number }

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
}

const between = (d: Date | null, from: Dayjs, to: Dayjs) => !!d && d >= from.toDate() && d <= to.toDate()
/** Undated records count as existing from the start, rather than vanishing. */
const byEnd = (d: Date | null, end: Dayjs) => !d || d <= end.toDate()

const applicationStatus = (v: unknown): ApplicationRow['status'] => {
    const s = String(v || '').trim().toLowerCase()
    return s === 'accepted' || s === 'rejected' ? s : 'pending'
}

const humanise = (value: string) => value.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

/** Higher is good for most figures; for errors a rise is bad news. */
const trendOf = (current: number, previous: number, higherIsGood = true): Trend => {
    const change = current - previous
    const percent = previous ? Math.round((Math.abs(change) / previous) * 100) : undefined
    return {
        amount: percent !== undefined ? `${percent}%` : String(Math.abs(change)),
        direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
        tone: change === 0 ? 'neutral' : change > 0 === higherIsGood ? 'good' : 'bad',
        text: `${change >= 0 ? '+' : ''}${change} vs previous period`
    }
}

/** A figure in a soft rounded card: icon disc, large number, change badge and small monthly bars. */
const KpiTile: React.FC<{ icon: React.ReactNode; label: string; value: number; trend?: Trend; months: Month[]; pick: (m: Month) => number; loading: boolean }> = ({
    icon,
    label,
    value,
    trend,
    months,
    pick,
    loading
}) => {
    const max = Math.max(...months.map(pick), 1)
    return (
        <Card className='admin-card admin-kpi' bordered={false}>
            {loading ? (
                <Skeleton active paragraph={{ rows: 1 }} />
            ) : (
                <div className='admin-kpi-body'>
                    <div className='admin-kpi-copy'>
                        <span className='admin-kpi-label'>{label}</span>
                        <div className='admin-kpi-value-line'>
                            <span className='admin-kpi-icon'>{icon}</span>
                            <span className='admin-kpi-value'>{value.toLocaleString()}</span>
                            {trend && (
                                <span className={`admin-kpi-trend is-${trend.tone}`} title={trend.text} aria-label={trend.text}>
                                    {trend.direction === 'up' ? <ArrowUpOutlined /> : trend.direction === 'down' ? <ArrowDownOutlined /> : <MinusOutlined />}
                                    {trend.amount}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className='admin-kpi-bars' aria-hidden='true'>
                        {months.map((m, i) => (
                            <div key={m.month.getTime()} className='admin-kpi-bar-col'>
                                <span
                                    className={i === months.length - 1 ? 'admin-kpi-bar is-current' : 'admin-kpi-bar'}
                                    style={{ height: `${Math.max(8, (pick(m) / max) * 100)}%` }}
                                />
                                <small>{dayjs(m.month).format('MMM')}</small>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    )
}

const CardHead: React.FC<{ title: string; subtitle: React.ReactNode; onMore?: () => void }> = ({ title, subtitle, onMore }) => (
    <div className='admin-card-head'>
        <div>
            <h3>{title}</h3>
            <span>{subtitle}</span>
        </div>
        {onMore && (
            <Button type='text' size='small' onClick={onMore}>
                View more <RightOutlined />
            </Button>
        )}
    </div>
)

const SystemAdminDashboard: React.FC = () => {
    const navigate = useNavigate()
    const { token } = theme.useToken()
    const { range } = useDashboardDateRange()

    const [users, setUsers] = useState<UserRow[]>([])
    const [applications, setApplications] = useState<ApplicationRow[]>([])
    const [failures, setFailures] = useState<FailureRow[]>([])
    const [sessions, setSessions] = useState<SessionRow[]>([])
    const [baseLoading, setBaseLoading] = useState(true)
    const [sessionsLoading, setSessionsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Accent shades from the theme, so charts follow the selected accent and colour mode.
    const ACCENT = token.colorPrimary
    const ACCENT_DEEP = token.colorPrimaryActive
    const ACCENT_LIGHT = token.colorPrimaryBorderHover
    const ACCENT_SOFT = token.colorPrimaryBorder
    const ROLE_COLORS = [ACCENT, ACCENT_LIGHT, ACCENT_DEEP, '#0d9488', '#d97706', '#94a3b8', '#db2777', '#0891b2']
    const STATUS_META = [
        { key: 'accepted', label: 'Accepted', color: ACCENT },
        { key: 'pending', label: 'In review', color: ACCENT_LIGHT },
        { key: 'rejected', label: 'Declined', color: '#94a3b8' }
    ] as const

    // The period on screen; "All time" runs to today.
    const end = range ? range[1].endOf('day') : dayjs().endOf('day')
    const start = range ? range[0].startOf('day') : null
    const previous = useMemo(() => {
        if (!range) return null
        const days = range[1].diff(range[0], 'day') + 1
        const prevEnd = range[0].subtract(1, 'day').endOf('day')
        return [prevEnd.subtract(days - 1, 'day').startOf('day'), prevEnd] as [Dayjs, Dayjs]
    }, [range])

    // Sessions chart: the last 31 days of the period at most, and never past today.
    const activityEnd = end.isAfter(dayjs()) ? dayjs().endOf('day') : end
    const activityStart = (() => {
        const floor = activityEnd.subtract(30, 'day').startOf('day')
        return start && start.isAfter(floor) ? start : floor
    })()
    const activityKey = `${activityStart.valueOf()}|${activityEnd.valueOf()}`

    // Accounts, applications and delivery failures are read once; the period only filters them.
    useEffect(() => {
        let active = true
        Promise.all([
            getDocs(collection(db, 'users')),
            getDocs(collection(db, 'applications')),
            getDocs(query(collection(db, 'emailLogs'), where('status', 'in', ['failed', 'bounced'])))
        ])
            .then(([userSnap, appSnap, failSnap]) => {
                if (!active) return
                setUsers(
                    userSnap.docs.map(d => {
                        const u = d.data() as any
                        return {
                            id: d.id,
                            role: String(u.role || 'unknown').trim().toLowerCase().replace(/\s+/g, '_'),
                            createdAt: toDate(u.createdAt),
                            active: String(u.status || '').toLowerCase() !== 'inactive' && u.active !== false && u.disabled !== true
                        }
                    })
                )
                setApplications(
                    appSnap.docs.map(d => {
                        const a = d.data() as any
                        return {
                            id: d.id,
                            status: applicationStatus(a.applicationStatus),
                            at: toDate(a.submittedAt) || toDate(a.createdAt) || toDate(a.appliedAt)
                        }
                    })
                )
                setFailures(
                    failSnap.docs
                        .map(d => {
                            const row = d.data() as any
                            return {
                                id: d.id,
                                type: String(row.type || 'email'),
                                to: String(row.to || ''),
                                error: String(row.error || 'Unknown delivery error'),
                                at: toDate(row.createdAt)
                            }
                        })
                        .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
                )
            })
            .catch(e => active && setError(String(e?.message || e)))
            .finally(() => active && setBaseLoading(false))
        return () => {
            active = false
        }
    }, [])

    useEffect(() => {
        let active = true
        setSessionsLoading(true)
        getDocs(
            query(
                collection(db, 'userSessions'),
                where('startedAt', '>=', Timestamp.fromDate(activityStart.toDate())),
                where('startedAt', '<=', Timestamp.fromDate(activityEnd.toDate()))
            )
        )
            .then(snap => {
                if (!active) return
                setSessions(
                    snap.docs.flatMap(d => {
                        const s = d.data() as any
                        const at = toDate(s.startedAt)
                        return at ? [{ uid: String(s.uid || d.id), at }] : []
                    })
                )
            })
            // Activity is a nice-to-have: the rest of the overview still loads without it.
            .catch(() => active && setSessions([]))
            .finally(() => active && setSessionsLoading(false))
        return () => {
            active = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activityKey])

    const loading = baseLoading

    const summary = useMemo(() => {
        const inPeriod = (d: Date | null) => (start ? between(d, start, end) : true)
        const usersBy = (e: Dayjs) => users.filter(u => byEnd(u.createdAt, e))
        const currentUsers = usersBy(end)
        const periodApps = applications.filter(a => inPeriod(a.at))
        const periodErrors = failures.filter(f => inPeriod(f.at))

        const months: Month[] = Array.from({ length: 12 }, (_, i) => {
            const mStart = end.startOf('month').subtract(11 - i, 'month')
            const mEnd = mStart.endOf('month')
            const total = usersBy(mEnd)
            return {
                month: mStart.toDate(),
                newUsers: users.filter(u => between(u.createdAt, mStart, mEnd)).length,
                totalUsers: total.length,
                activeUsers: total.filter(u => u.active).length,
                applications: applications.filter(a => between(a.at, mStart, mEnd)).length,
                errors: failures.filter(f => between(f.at, mStart, mEnd)).length
            }
        })

        const usersByRole: Record<string, number> = {}
        currentUsers.filter(u => u.active).forEach(u => (usersByRole[u.role] = (usersByRole[u.role] || 0) + 1))

        const byStatus = { accepted: 0, pending: 0, rejected: 0 }
        periodApps.forEach(a => (byStatus[a.status] += 1))

        const prev = previous && {
            users: usersBy(previous[1]).length,
            activeUsers: usersBy(previous[1]).filter(u => u.active).length,
            errors: failures.filter(f => between(f.at, previous[0], previous[1])).length
        }

        return {
            users: currentUsers.length,
            activeUsers: currentUsers.filter(u => u.active).length,
            errors: periodErrors.length,
            recentErrors: periodErrors.slice(0, 5),
            prev,
            months,
            usersByRole,
            applications: periodApps.length,
            byStatus
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [users, applications, failures, start?.valueOf(), end.valueOf(), previous])

    const recentMonths = summary.months.slice(-6)

    const growthChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'areaspline', height: 290, spacing: [12, 4, 4, 4], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: { categories: summary.months.map(m => dayjs(m.month).format('MMM')), lineWidth: 0, tickLength: 0 },
            yAxis: { title: { text: undefined }, allowDecimals: false, gridLineDashStyle: 'Dash' },
            legend: { align: 'right', verticalAlign: 'top', itemDistance: 16, symbolRadius: 6 },
            tooltip: { shared: true },
            plotOptions: { areaspline: { marker: { radius: 3, symbol: 'circle' }, lineWidth: 2.5 } },
            series: [
                {
                    type: 'areaspline',
                    name: 'New users',
                    data: summary.months.map(m => m.newUsers),
                    color: ACCENT,
                    fillColor: {
                        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                        stops: [
                            [0, Highcharts.color(ACCENT).setOpacity(0.32).get('rgba') as string],
                            [1, Highcharts.color(ACCENT).setOpacity(0).get('rgba') as string]
                        ]
                    }
                },
                {
                    type: 'areaspline',
                    name: 'Applications',
                    data: summary.months.map(m => m.applications),
                    color: ACCENT_DEEP,
                    fillColor: 'transparent',
                    dashStyle: 'ShortDash'
                }
            ]
        }),
        [summary.months, ACCENT, ACCENT_DEEP]
    )

    const roleEntries = useMemo(() => Object.entries(summary.usersByRole).sort((a, b) => b[1] - a[1]), [summary.usersByRole])
    const roleTotal = roleEntries.reduce((t, [, n]) => t + n, 0)
    const roleChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'pie', height: 220, spacing: [0, 0, 0, 0], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
            plotOptions: { pie: { innerSize: '74%', borderWidth: 3, borderColor: token.colorBgContainer, borderRadius: 6, dataLabels: { enabled: false } } },
            series: [
                {
                    type: 'pie',
                    name: 'Users',
                    data: roleEntries.map(([role, count], i) => ({ name: formatRole(role), y: count, color: ROLE_COLORS[i % ROLE_COLORS.length] }))
                }
            ]
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [roleEntries, ACCENT, token.colorBgContainer]
    )

    const dailySessions = useMemo(() => {
        const days = new Map<string, { day: Dayjs; sessions: number; uids: Set<string> }>()
        for (let d = activityStart; !d.isAfter(activityEnd); d = d.add(1, 'day')) {
            days.set(d.format('YYYY-MM-DD'), { day: d, sessions: 0, uids: new Set() })
        }
        sessions.forEach(s => {
            const bucket = days.get(dayjs(s.at).format('YYYY-MM-DD'))
            if (!bucket) return
            bucket.sessions += 1
            bucket.uids.add(s.uid)
        })
        return [...days.values()]
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions, activityKey])
    const totalSessions = dailySessions.reduce((t, d) => t + d.sessions, 0)

    const activityChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'column', height: 230, spacing: [8, 0, 0, 0], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { enabled: false },
            xAxis: {
                categories: dailySessions.map(d => d.day.format('D MMM')),
                lineWidth: 0,
                tickLength: 0,
                labels: { step: Math.max(1, Math.ceil(dailySessions.length / 6)) }
            },
            yAxis: { title: { text: undefined }, allowDecimals: false, gridLineDashStyle: 'Dash' },
            tooltip: { shared: true },
            plotOptions: { column: { borderRadius: 4, pointPadding: 0.08, groupPadding: 0.12 } },
            series: [
                { type: 'column', name: 'Sessions', data: dailySessions.map(d => d.sessions), color: ACCENT_SOFT, states: { hover: { color: ACCENT } } },
                { type: 'spline', name: 'Users signed in', data: dailySessions.map(d => d.uids.size), color: ACCENT, marker: { enabled: false }, lineWidth: 2 }
            ]
        }),
        [dailySessions, ACCENT, ACCENT_SOFT]
    )

    const acceptedShare = summary.applications ? Math.round((summary.byStatus.accepted / summary.applications) * 100) : 0
    const periodLabel = range ? 'In the selected period' : 'All time'

    return (
        <div className='admin-overview'>
            <Helmet>
                <title>System Admin Dashboard | Smart Incubation</title>
            </Helmet>

            {error && <Alert type='error' showIcon message='Could not load the dashboard' description={error} style={{ marginBottom: 16 }} />}

            <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                    <KpiTile
                        loading={loading}
                        icon={<TeamOutlined />}
                        label='Users'
                        value={summary.users}
                        trend={summary.prev ? trendOf(summary.users, summary.prev.users) : undefined}
                        months={recentMonths}
                        pick={m => m.totalUsers}
                    />
                </Col>
                <Col xs={24} md={8}>
                    <KpiTile
                        loading={loading}
                        icon={<CheckCircleOutlined />}
                        label='Active users'
                        value={summary.activeUsers}
                        trend={summary.prev ? trendOf(summary.activeUsers, summary.prev.activeUsers) : undefined}
                        months={recentMonths}
                        pick={m => m.activeUsers}
                    />
                </Col>
                <Col xs={24} md={8}>
                    <KpiTile
                        loading={loading}
                        icon={<WarningOutlined />}
                        label='Email delivery errors'
                        value={summary.errors}
                        trend={summary.prev ? trendOf(summary.errors, summary.prev.errors, false) : undefined}
                        months={recentMonths}
                        pick={m => m.errors}
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} className='admin-overview-row'>
                <Col xs={24} lg={16}>
                    <Card className='admin-card' bordered={false} loading={loading}>
                        <CardHead title='Platform growth' subtitle='New users and applications over 12 months' />
                        <HighchartsReact highcharts={Highcharts} options={growthChart} />
                    </Card>
                </Col>
                <Col xs={24} lg={8}>
                    <Card className='admin-card' bordered={false} loading={loading}>
                        <CardHead title='Users by role' subtitle='Active accounts' onMore={() => navigate('/system_admin/users')} />
                        {roleTotal ? (
                            <>
                                <div className='admin-donut'>
                                    <HighchartsReact highcharts={Highcharts} options={roleChart} />
                                    <div className='admin-donut-center'>
                                        <strong>{roleTotal.toLocaleString()}</strong>
                                        <span>Users</span>
                                    </div>
                                </div>
                                <ul className='admin-legend'>
                                    {roleEntries.slice(0, 6).map(([role, count], i) => (
                                        <li key={role}>
                                            <i style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }} />
                                            <span>{formatRole(role)}</span>
                                            <b>{count}</b>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                        )}
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} className='admin-overview-row' align='top'>
                <Col xs={24} md={12} xl={8}>
                    <Card className='admin-card admin-card-accent is-fit' bordered={false} loading={loading}>
                        <CardHead title='Applications' subtitle={periodLabel} onMore={() => navigate('/applications')} />
                        <div className='admin-pipeline-hero'>
                            <span className='admin-pipeline-total'>{summary.applications.toLocaleString()}</span>
                            <span>applications received</span>
                        </div>
                        <div className='admin-pipeline-bar' aria-hidden='true'>
                            {STATUS_META.map(s =>
                                summary.byStatus[s.key] ? <span key={s.key} style={{ flex: summary.byStatus[s.key], background: s.color }} /> : null
                            )}
                        </div>
                        <ul className='admin-pipeline-steps'>
                            {STATUS_META.map(s => (
                                <li key={s.key}>
                                    <i style={{ background: s.color }} />
                                    <span>{s.label}</span>
                                    <b>{summary.byStatus[s.key]}</b>
                                </li>
                            ))}
                        </ul>
                        <div className='admin-pipeline-foot'>
                            <Progress type='circle' percent={acceptedShare} size={34} strokeColor={ACCENT} showInfo={false} strokeWidth={12} />
                            <span>
                                <b>{acceptedShare}%</b> accepted
                            </span>
                        </div>
                    </Card>
                </Col>
                <Col xs={24} md={12} xl={8}>
                    <Card className='admin-card is-fit' bordered={false} loading={sessionsLoading}>
                        <CardHead
                            title='Platform activity'
                            subtitle={`${totalSessions.toLocaleString()} sessions · ${activityStart.format('D MMM')} – ${activityEnd.format('D MMM')}`}
                            onMore={() => navigate('/system_admin/usage')}
                        />
                        {totalSessions ? (
                            <HighchartsReact highcharts={Highcharts} options={activityChart} />
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No sign-ins in this period.' />
                        )}
                    </Card>
                </Col>
                <Col xs={24} xl={8}>
                    <Card className='admin-card' bordered={false} loading={loading}>
                        <CardHead title='Delivery errors' subtitle='Most recent failures' onMore={() => navigate('/system_admin/email')} />
                        {summary.recentErrors.length ? (
                            <ol className='admin-timeline'>
                                {summary.recentErrors.map(row => (
                                    <li key={row.id}>
                                        <div className='admin-timeline-top'>
                                            <Tag color='orange' bordered={false}>
                                                {humanise(row.type)}
                                            </Tag>
                                            <time>{row.at ? dateFormatter.format(row.at) : 'N/A'}</time>
                                        </div>
                                        <Typography.Paragraph ellipsis={{ rows: 2, tooltip: row.error }}>
                                            {row.to ? `${row.to}: ` : ''}
                                            {row.error}
                                        </Typography.Paragraph>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No delivery errors in this period.' />
                        )}
                    </Card>
                </Col>
            </Row>
        </div>
    )
}

export default SystemAdminDashboard
