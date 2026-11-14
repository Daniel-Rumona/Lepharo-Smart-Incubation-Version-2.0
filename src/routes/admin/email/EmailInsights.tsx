import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Drawer, Empty, Progress, Row, Skeleton, Table, Tag, theme, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    ApiOutlined,
    ArrowDownOutlined,
    ArrowUpOutlined,
    CheckCircleOutlined,
    FieldTimeOutlined,
    MinusOutlined,
    ReloadOutlined,
    SendOutlined,
    WarningOutlined
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { collection, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { db } from '@/firebase'
import { useDashboardDateRange } from '@/lib/useDashboardDateRange'
import '@/styles/admin-overview.css'

dayjs.extend(relativeTime)

const { Text } = Typography

/*
 * The overview at the top of the email page: delivery figures for the topbar
 * period, Brevo's state, which email types are going out, and every scheduled
 * job's last run (functions/src/cronHeartbeat.ts writes those heartbeats).
 */

/** Reads stop here; the page says so when a period hits it. */
const LOG_CAP = 5000
/** Brevo expires an API key after 90 days with no API activity (functions/src/brevoClient.ts). */
const BREVO_KEY_IDLE_DAYS = 90
const HOUR_MS = 3_600_000

/** Every scheduled function. `schedule` is the fallback until the job reports its own. */
const JOBS: Record<string, { label: string; purpose: string; schedule: string; sendsEmail: boolean }> = {
    brevoApiKeepAlive: { label: 'Brevo API keep-alive', purpose: 'Keeps the Brevo API key from expiring', schedule: '0 3 * * 1', sendsEmail: false },
    taskDeadlineNotifier: { label: 'Task deadline notifier', purpose: 'Emails people about tasks that are due', schedule: '0 9,13,17 * * *', sendsEmail: true },
    appointmentCompletionNotifier: { label: 'Appointment completion', purpose: 'Asks for coverage after appointments end', schedule: '*/30 * * * *', sendsEmail: true },
    devPlanReminderCron: { label: 'Development plan reminders', purpose: 'Chases SMEs and staff on development plans', schedule: '0 9 * * *', sendsEmail: true },
    movReminderCron: { label: 'MOV reminders', purpose: 'Reminds about outstanding means of verification', schedule: '0 8 * * *', sendsEmail: true },
    movStageReminderCron: { label: 'MOV stage reminders', purpose: 'Chases MOVs stuck at a review stage', schedule: '20 8 * * *', sendsEmail: true },
    complianceExpiryReminderCron: { label: 'Compliance expiry', purpose: 'Warns SMEs before compliance documents expire', schedule: '0 7 * * *', sendsEmail: true },
    kpiManualUpdateReminderCron: { label: 'KPI update reminders', purpose: 'Chases manually tracked KPIs with no actual', schedule: '0 7 * * *', sendsEmail: true },
    challengeDueReminderCron: { label: 'Challenge due reminders', purpose: 'Reminds about challenges that are due', schedule: '0 7 * * *', sendsEmail: true },
    planRoadmapCheckInCron: { label: 'Roadmap check-ins', purpose: 'Prompts plan roadmap check-ins', schedule: '15 7 * * *', sendsEmail: true },
    outcomeFollowUpReminderCron: { label: 'Outcome follow-ups', purpose: 'Reminds about intervention outcome follow-ups', schedule: '30 7 * * *', sendsEmail: true },
    stalledApplicationEscalationCron: { label: 'Stalled applications', purpose: 'Escalates applications waiting too long', schedule: '30 7 * * *', sendsEmail: true },
    workflowQueryReminderCron: { label: 'Workflow query reminders', purpose: 'Chases unanswered workflow queries', schedule: '0 8 * * *', sendsEmail: true },
    governanceMeetingReminderCron: { label: 'Governance meetings', purpose: 'Reminds attendees of governance meetings', schedule: '*/15 * * * *', sendsEmail: true },
    requireMoaAfter3Months: { label: 'MOA requirement', purpose: 'Flags SMEs without an MOA after 3 months', schedule: 'every 24 hours', sendsEmail: true },
    revenueMetricsSyncCron: { label: 'Revenue metrics sync', purpose: 'Pulls SME revenue into participant metrics', schedule: '0 5 * * *', sendsEmail: false },
    smeRiskScoringCron: { label: 'SME risk scoring', purpose: 'Scores SME risk and raises alerts', schedule: '0 6 * * *', sendsEmail: false },
    interventionImpact: { label: 'Intervention impact', purpose: 'Recalculates intervention impact monthly', schedule: '30 5 1 * *', sendsEmail: false }
}

type JobStatus = 'ok' | 'running' | 'failed' | 'late' | 'pending'
const STATUS_META: Record<JobStatus, { label: string; color: string; rank: number }> = {
    failed: { label: 'Failed', color: 'error', rank: 0 },
    late: { label: 'Late', color: 'warning', rank: 1 },
    running: { label: 'Running', color: 'processing', rank: 2 },
    pending: { label: 'Not reported yet', color: 'default', rank: 3 },
    ok: { label: 'Healthy', color: 'success', rank: 4 }
}

type Job = {
    id: string
    label: string
    purpose: string
    schedule: string
    scheduleText: string
    everyHours: number
    status: JobStatus
    lastAt: Date | null
    durationMs: number | null
    error: string | null
    summary: Record<string, unknown> | null
    runs: number
    fails: number
    nextAt: Dayjs | null
}

type LogRow = { id: string; type: string; status: string; source: string; at: Date | null }

type Trend = { amount: string; direction: 'up' | 'down' | 'flat'; tone: 'good' | 'bad' | 'neutral'; text: string }

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
}

const humanise = (value: string) => value.replace(/[_-]+/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

const formatDuration = (ms: number | null) => {
    if (ms == null) return '—'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

const pad = (n: number) => String(n).padStart(2, '0')
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Reads the cron shapes the functions use into words, a cadence in hours (to
 * tell when a job is late) and the next run. Times are Johannesburg time, which
 * is what every job is scheduled in.
 */
const describeSchedule = (schedule: string): { text: string; everyHours: number; next: (from: Dayjs) => Dayjs | null } => {
    const every = schedule.match(/^every (\d+) (minute|hour)s?$/i)
    if (every) {
        const hours = Number(every[1]) / (every[2].toLowerCase() === 'minute' ? 60 : 1)
        return { text: `Every ${every[1]} ${every[2].toLowerCase()}s`, everyHours: hours, next: () => null }
    }
    const parts = schedule.trim().split(/\s+/)
    if (parts.length !== 5) return { text: schedule || 'Unknown', everyHours: 24, next: () => null }
    const [min, hour, dom, , dow] = parts

    const step = min.match(/^\*\/(\d+)$/)
    if (step && hour === '*') {
        const m = Number(step[1])
        return {
            text: `Every ${m} minutes`,
            everyHours: m / 60,
            next: from => from.add(m - (from.minute() % m), 'minute').second(0)
        }
    }

    const hours = hour.split(',').map(Number)
    const times = hours.map(h => `${pad(h)}:${pad(Number(min))}`).join(', ')
    const nextDaily = (from: Dayjs, dayOk: (d: Dayjs) => boolean) => {
        for (let i = 0; i < 40; i++) {
            const day = from.add(i, 'day').startOf('day')
            if (!dayOk(day)) continue
            const slot = hours.map(h => day.hour(h).minute(Number(min))).find(t => t.isAfter(from))
            if (slot) return slot
        }
        return null
    }

    if (dom !== '*') {
        return { text: `Monthly on day ${dom} at ${times}`, everyHours: 24 * 31, next: from => nextDaily(from, d => d.date() === Number(dom)) }
    }
    if (dow !== '*') {
        return { text: `Weekly on ${DAYS[Number(dow)] || dow} at ${times}`, everyHours: 24 * 7, next: from => nextDaily(from, d => d.day() === Number(dow)) }
    }
    return {
        text: hours.length > 1 ? `Daily at ${times}` : `Daily at ${times}`,
        everyHours: 24,
        next: from => nextDaily(from, () => true)
    }
}

const evaluateJob = (id: string, data: any): Job => {
    const meta = JOBS[id] || { label: humanise(id), purpose: '', schedule: '', sendsEmail: false }
    const schedule = String(data?.schedule || meta.schedule)
    const described = describeSchedule(schedule)
    // Jobs that reported before cronHeartbeat.ts carry only their own fields.
    const lastAt = toDate(data?.runFinishedAt) || toDate(data?.lastRunAt) || toDate(data?.lastPingAt)
    const startedAt = toDate(data?.runStartedAt)
    const ownStatus = String(data?.lastStatus || '').toLowerCase()
    const failed = data?.runStatus === 'failed' || ownStatus === 'failed' || ownStatus === 'error'

    let status: JobStatus = 'ok'
    if (data?.runState === 'running' && startedAt && Date.now() - startedAt.getTime() < HOUR_MS) status = 'running'
    else if (failed) status = 'failed'
    else if (!lastAt) status = 'pending'
    // A run missed by more than half a cycle (and at least an hour) is late.
    else if (Date.now() - lastAt.getTime() > Math.max(described.everyHours * 1.5, described.everyHours + 1) * HOUR_MS) status = 'late'

    return {
        id,
        label: meta.label,
        purpose: meta.purpose,
        schedule,
        scheduleText: described.text,
        everyHours: described.everyHours,
        status,
        lastAt,
        durationMs: typeof data?.runDurationMs === 'number' ? data.runDurationMs : null,
        error: failed ? String(data?.runError || data?.lastError || 'Last run failed') : null,
        summary: data?.runSummary || null,
        runs: Number(data?.runCount) || 0,
        fails: Number(data?.runFailCount) || 0,
        nextAt: described.next(dayjs())
    }
}

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

const StatTile: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; trend?: Trend; note?: React.ReactNode; loading: boolean }> = ({
    icon,
    label,
    value,
    trend,
    note,
    loading
}) => (
    <Card className='admin-card admin-kpi' bordered={false}>
        {loading ? (
            <Skeleton active paragraph={{ rows: 1 }} />
        ) : (
            <div className='admin-kpi-copy'>
                <span className='admin-kpi-label'>{label}</span>
                <div className='admin-kpi-value-line'>
                    <span className='admin-kpi-icon'>{icon}</span>
                    <span className='admin-kpi-value'>{value}</span>
                    {trend && (
                        <span className={`admin-kpi-trend is-${trend.tone}`} title={trend.text} aria-label={trend.text}>
                            {trend.direction === 'up' ? <ArrowUpOutlined /> : trend.direction === 'down' ? <ArrowDownOutlined /> : <MinusOutlined />}
                            {trend.amount}
                        </span>
                    )}
                </div>
                {note && <span className='admin-kpi-note'>{note}</span>}
            </div>
        )}
    </Card>
)

const CardHead: React.FC<{ title: string; subtitle: React.ReactNode; extra?: React.ReactNode }> = ({ title, subtitle, extra }) => (
    <div className='admin-card-head'>
        <div>
            <h3>{title}</h3>
            <span>{subtitle}</span>
        </div>
        {extra}
    </div>
)

const isFailure = (status: string) => status === 'failed' || status === 'bounced'

/** `actions` sit in the email volume card: the page's own buttons (logs, sending). */
const EmailInsights: React.FC<{ isMobile: boolean; actions?: React.ReactNode }> = ({ isMobile, actions }) => {
    const { token } = theme.useToken()
    const { range } = useDashboardDateRange()

    const [logs, setLogs] = useState<LogRow[]>([])
    const [previousLogs, setPreviousLogs] = useState<LogRow[]>([])
    const [capped, setCapped] = useState(false)
    const [heartbeats, setHeartbeats] = useState<Record<string, any>>({})
    const [suppressions, setSuppressions] = useState<{ total: number; fromBrevo: number }>({ total: 0, fromBrevo: 0 })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [reloadKey, setReloadKey] = useState(0)
    const [openJob, setOpenJob] = useState<Job | null>(null)
    const [runs, setRuns] = useState<any[] | null>(null)

    const end = range ? range[1].endOf('day') : dayjs().endOf('day')
    const start = range ? range[0].startOf('day') : null
    const previous = useMemo(() => {
        if (!range) return null
        const days = range[1].diff(range[0], 'day') + 1
        const prevEnd = range[0].subtract(1, 'day').endOf('day')
        return [prevEnd.subtract(days - 1, 'day').startOf('day'), prevEnd] as [Dayjs, Dayjs]
    }, [range])
    const periodKey = `${start?.valueOf() ?? 'all'}|${end.valueOf()}`

    useEffect(() => {
        let active = true
        setLoading(true)
        setError(null)

        const logsBetween = (from: Dayjs | null, to: Dayjs) =>
            getDocs(
                query(
                    collection(db, 'emailLogs'),
                    ...(from ? [where('createdAt', '>=', Timestamp.fromDate(from.toDate()))] : []),
                    where('createdAt', '<=', Timestamp.fromDate(to.toDate())),
                    orderBy('createdAt', 'desc'),
                    limit(LOG_CAP)
                )
            )
        const toRows = (snap: Awaited<ReturnType<typeof logsBetween>>) =>
            snap.docs.map(d => {
                const row = d.data() as any
                return {
                    id: d.id,
                    type: String(row.type || 'EMAIL'),
                    status: String(row.status || 'unknown').toLowerCase(),
                    source: String(row.source || ''),
                    at: toDate(row.createdAt)
                }
            })

        Promise.all([
            logsBetween(start, end),
            previous ? logsBetween(previous[0], previous[1]) : Promise.resolve(null),
            getDocs(collection(db, 'systemHeartbeats')),
            getDocs(collection(db, 'emailSuppressions'))
        ])
            .then(([current, prior, beats, supp]) => {
                if (!active) return
                setLogs(toRows(current))
                setCapped(current.size >= LOG_CAP)
                setPreviousLogs(prior ? toRows(prior) : [])
                setHeartbeats(Object.fromEntries(beats.docs.map(d => [d.id, d.data()])))
                setSuppressions({
                    total: supp.size,
                    fromBrevo: supp.docs.filter(d => String(d.data().source || '') === 'brevo-webhook').length
                })
            })
            .catch(e => active && setError(String(e?.message || e)))
            .finally(() => active && setLoading(false))
        return () => {
            active = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [periodKey, reloadKey])

    // Run history for the job opened in the drawer.
    useEffect(() => {
        if (!openJob) return
        let active = true
        setRuns(null)
        getDocs(query(collection(db, 'systemHeartbeats', openJob.id, 'runs'), orderBy('startedAt', 'desc'), limit(30)))
            .then(snap => active && setRuns(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
            .catch(() => active && setRuns([]))
        return () => {
            active = false
        }
    }, [openJob])

    const jobs = useMemo(() => {
        const ids = new Set([...Object.keys(JOBS), ...Object.keys(heartbeats)])
        return [...ids]
            .map(id => evaluateJob(id, heartbeats[id]))
            .sort((a, b) => STATUS_META[a.status].rank - STATUS_META[b.status].rank || a.label.localeCompare(b.label))
    }, [heartbeats])

    const stats = useMemo(() => {
        const count = (rows: LogRow[]) => {
            const sent = rows.filter(r => r.status === 'sent').length
            const failed = rows.filter(r => isFailure(r.status)).length
            return { sent, failed, attempted: sent + failed }
        }
        const current = count(logs)
        const prior = count(previousLogs)
        const rate = current.attempted ? Math.round((current.sent / current.attempted) * 1000) / 10 : null
        return { current, prior, rate }
    }, [logs, previousLogs])

    const healthyJobs = jobs.filter(j => j.status === 'ok' || j.status === 'running').length
    const problemJobs = jobs.filter(j => j.status === 'failed' || j.status === 'late').length

    // Daily volume over the period; "All time" shows the span the loaded logs cover.
    const volumeChart = useMemo<Highcharts.Options>(() => {
        const dated = logs.filter(l => l.at)
        const first = start || (dated.length ? dayjs(dated[dated.length - 1].at).startOf('day') : end.startOf('day'))
        const last = end.isAfter(dayjs()) ? dayjs().endOf('day') : end
        const days: string[] = []
        for (let d = first.startOf('day'); !d.isAfter(last) && days.length < 400; d = d.add(1, 'day')) days.push(d.format('YYYY-MM-DD'))
        const sent = new Map<string, number>()
        const failed = new Map<string, number>()
        dated.forEach(l => {
            const key = dayjs(l.at).format('YYYY-MM-DD')
            const map = l.status === 'sent' ? sent : isFailure(l.status) ? failed : null
            map?.set(key, (map.get(key) || 0) + 1)
        })
        return {
            chart: { type: 'column', height: 260, spacing: [8, 0, 0, 0], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: {
                categories: days.map(k => dayjs(k).format('D MMM')),
                lineWidth: 0,
                tickLength: 0,
                labels: { step: Math.max(1, Math.ceil(days.length / 8)) }
            },
            yAxis: { title: { text: undefined }, allowDecimals: false, gridLineDashStyle: 'Dash' },
            legend: { align: 'right', verticalAlign: 'top', symbolRadius: 6 },
            tooltip: { shared: true },
            plotOptions: { column: { stacking: 'normal', borderRadius: 3, pointPadding: 0.06, groupPadding: 0.1, borderWidth: 0 } },
            series: [
                { type: 'column', name: 'Sent', data: days.map(k => sent.get(k) || 0), color: token.colorPrimary },
                { type: 'column', name: 'Failed or bounced', data: days.map(k => failed.get(k) || 0), color: token.colorError }
            ]
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logs, periodKey, token.colorPrimary, token.colorError])

    const byType = useMemo(() => {
        const map = new Map<string, { type: string; sent: number; failed: number }>()
        logs.forEach(l => {
            const row = map.get(l.type) || { type: l.type, sent: 0, failed: 0 }
            if (l.status === 'sent') row.sent += 1
            else if (isFailure(l.status)) row.failed += 1
            map.set(l.type, row)
        })
        return [...map.values()].sort((a, b) => b.sent + b.failed - (a.sent + a.failed))
    }, [logs])
    const typeMax = Math.max(1, ...byType.map(t => t.sent + t.failed))

    const brevo = useMemo(() => {
        const beat = heartbeats.brevoApiKeepAlive || {}
        const lastPing = toDate(beat.lastPingAt) || toDate(beat.runFinishedAt)
        const lastSend = logs.find(l => l.source === 'brevo-api' && l.status === 'sent')?.at ?? null
        const lastActivity = [lastPing, lastSend].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] || null
        const expiresAt = lastActivity ? dayjs(lastActivity).add(BREVO_KEY_IDLE_DAYS, 'day') : null
        const daysLeft = expiresAt ? expiresAt.diff(dayjs(), 'day') : null
        const viaApi = logs.filter(l => l.source === 'brevo-api')
        const viaSmtp = logs.filter(l => l.source === 'firebase-functions')
        return {
            ok: String(beat.lastStatus || beat.runStatus || '').toLowerCase() !== 'failed',
            error: beat.lastError || beat.runError || null,
            lastPing,
            lastActivity,
            expiresAt,
            daysLeft,
            apiSent: viaApi.filter(l => l.status === 'sent').length,
            apiFailed: viaApi.filter(l => isFailure(l.status)).length,
            smtpSent: viaSmtp.filter(l => l.status === 'sent').length,
            smtpFailed: viaSmtp.filter(l => isFailure(l.status)).length
        }
    }, [heartbeats, logs])

    const jobColumns: ColumnsType<Job> = [
        {
            title: 'Job',
            key: 'job',
            render: (_, j) => (
                <div style={{ minWidth: 180 }}>
                    <div style={{ fontWeight: 500 }}>{j.label}</div>
                    {j.purpose && <Text type='secondary' style={{ fontSize: 12 }}>{j.purpose}</Text>}
                </div>
            )
        },
        {
            title: 'Status',
            key: 'status',
            width: 140,
            render: (_, j) => (
                <Tooltip title={j.error || undefined}>
                    <Tag color={STATUS_META[j.status].color} bordered={false}>{STATUS_META[j.status].label}</Tag>
                </Tooltip>
            )
        },
        { title: 'Schedule', dataIndex: 'scheduleText', width: 190, render: (t: string) => <Text style={{ fontSize: 13 }}>{t}</Text> },
        {
            title: 'Last run',
            key: 'last',
            width: 150,
            render: (_, j) =>
                j.lastAt ? (
                    <Tooltip title={dayjs(j.lastAt).format('D MMM YYYY HH:mm:ss')}>
                        <div>{dayjs(j.lastAt).fromNow()}</div>
                        <Text type='secondary' style={{ fontSize: 12 }}>{formatDuration(j.durationMs)}</Text>
                    </Tooltip>
                ) : (
                    <Text type='secondary'>Never</Text>
                )
        },
        { title: 'Next run', key: 'next', width: 130, render: (_, j) => (j.nextAt ? j.nextAt.format('D MMM HH:mm') : '—') },
        {
            title: 'Runs',
            key: 'runs',
            width: 90,
            render: (_, j) =>
                j.runs ? (
                    <span>
                        {j.runs}
                        {j.fails ? <Text type='danger'> · {j.fails} failed</Text> : null}
                    </span>
                ) : (
                    '—'
                )
        }
    ]

    return (
        <div className='admin-overview' style={{ padding: 0, marginBottom: 16 }}>
            {error && <Alert type='error' showIcon message='Could not load email insights' description={error} style={{ marginBottom: 16 }} />}
            {capped && (
                <Alert
                    type='warning'
                    showIcon
                    message={`Figures use the latest ${LOG_CAP.toLocaleString()} emails only; pick a shorter period for complete numbers.`}
                    style={{ marginBottom: 16 }}
                />
            )}

            <Row gutter={[16, 16]}>
                <Col xs={12} xl={6}>
                    <StatTile
                        loading={loading}
                        icon={<SendOutlined />}
                        label='Emails sent'
                        value={stats.current.sent.toLocaleString()}
                        trend={previous ? trendOf(stats.current.sent, stats.prior.sent) : undefined}
                        note={range ? 'In the selected period' : 'All time'}
                    />
                </Col>
                <Col xs={12} xl={6}>
                    <StatTile
                        loading={loading}
                        icon={<CheckCircleOutlined />}
                        label='Delivery rate'
                        value={stats.rate === null ? '—' : `${stats.rate}%`}
                        note={`${stats.current.attempted.toLocaleString()} attempted`}
                    />
                </Col>
                <Col xs={12} xl={6}>
                    <StatTile
                        loading={loading}
                        icon={<WarningOutlined />}
                        label='Failed or bounced'
                        value={stats.current.failed.toLocaleString()}
                        trend={previous ? trendOf(stats.current.failed, stats.prior.failed, false) : undefined}
                        note={`${suppressions.total.toLocaleString()} addresses suppressed`}
                    />
                </Col>
                <Col xs={12} xl={6}>
                    <StatTile
                        loading={loading}
                        icon={<FieldTimeOutlined />}
                        label='Scheduled jobs healthy'
                        value={`${healthyJobs}/${jobs.length}`}
                        note={problemJobs ? <Text type='danger'>{problemJobs} failing or late</Text> : 'All on schedule'}
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} className='admin-overview-row' align='top'>
                <Col xs={24} lg={16}>
                    <Card className='admin-card is-fit' bordered={false} loading={loading}>
                        <CardHead
                            title='Email volume'
                            subtitle='Sent and failed per day'
                            extra={
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    <Button type='text' icon={<ReloadOutlined />} onClick={() => setReloadKey(k => k + 1)} aria-label='Refresh' />
                                    {actions}
                                </div>
                            }
                        />
                        {logs.length ? <HighchartsReact highcharts={Highcharts} options={volumeChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No emails in this period.' />}
                    </Card>
                </Col>
                <Col xs={24} lg={8}>
                    <Card className='admin-card admin-card-accent is-fit' bordered={false} loading={loading}>
                        <CardHead title='Brevo' subtitle='Transactional email provider' />
                        <div className='admin-pipeline-hero'>
                            <span className='admin-kpi-icon'><ApiOutlined /></span>
                            <span>
                                API key{' '}
                                <Tag color={brevo.ok ? 'success' : 'error'} bordered={false}>
                                    {brevo.ok ? 'Active' : 'Keep-alive failing'}
                                </Tag>
                            </span>
                        </div>
                        {brevo.error && !brevo.ok && <Alert type='error' showIcon message={brevo.error} style={{ marginBottom: 12 }} />}
                        <ul className='admin-pipeline-steps'>
                            <li>
                                <i style={{ background: token.colorPrimary }} />
                                <span>Last keep-alive</span>
                                <b>{brevo.lastPing ? dayjs(brevo.lastPing).fromNow() : 'Never'}</b>
                            </li>
                            <li>
                                <i style={{ background: token.colorPrimary }} />
                                <span>Sent through Brevo API</span>
                                <b>
                                    {brevo.apiSent.toLocaleString()}
                                    {brevo.apiFailed ? <Text type='danger'> / {brevo.apiFailed} failed</Text> : null}
                                </b>
                            </li>
                            <li>
                                <i style={{ background: token.colorPrimaryBorderHover }} />
                                <span>Sent through SMTP</span>
                                <b>
                                    {brevo.smtpSent.toLocaleString()}
                                    {brevo.smtpFailed ? <Text type='danger'> / {brevo.smtpFailed} failed</Text> : null}
                                </b>
                            </li>
                            <li>
                                <i style={{ background: '#94a3b8' }} />
                                <span>Bounces reported by Brevo</span>
                                <b>{suppressions.fromBrevo.toLocaleString()}</b>
                            </li>
                        </ul>
                        <div className='admin-pipeline-foot'>
                            <Progress
                                type='circle'
                                size={34}
                                strokeWidth={12}
                                showInfo={false}
                                percent={brevo.daysLeft === null ? 0 : Math.max(0, Math.min(100, (brevo.daysLeft / BREVO_KEY_IDLE_DAYS) * 100))}
                                strokeColor={brevo.daysLeft !== null && brevo.daysLeft < 14 ? token.colorError : token.colorPrimary}
                            />
                            <span>
                                {brevo.expiresAt ? (
                                    <>
                                        Key safe until <b>{brevo.expiresAt.format('D MMM YYYY')}</b> without activity
                                    </>
                                ) : (
                                    'No Brevo API activity seen yet'
                                )}
                            </span>
                        </div>
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} className='admin-overview-row' align='top'>
                <Col xs={24} xl={16}>
                    <Card className='admin-card is-fit' bordered={false} loading={loading}>
                        <CardHead
                            title='Scheduled jobs'
                            subtitle='Background jobs and when they last ran · select one for its run history'
                        />
                        <Table<Job>
                            size='small'
                            rowKey='id'
                            dataSource={jobs}
                            columns={isMobile ? jobColumns.slice(0, 2).concat(jobColumns[3]) : jobColumns}
                            pagination={{ pageSize: 5, showSizeChanger: false, size: 'small' }}
                            scroll={{ x: isMobile ? undefined : 860 }}
                            onRow={j => ({ onClick: () => setOpenJob(j), style: { cursor: 'pointer' } })}
                        />
                    </Card>
                </Col>
                <Col xs={24} xl={8}>
                    <Card className='admin-card is-fit' bordered={false} loading={loading}>
                        <CardHead title='Emails by type' subtitle='What is being sent in this period' />
                        {byType.length ? (
                            <ul className='usage-rank-list'>
                                {byType.slice(0, 10).map((t, i) => (
                                    <li key={t.type}>
                                        <span className='usage-rank-index'>{i + 1}</span>
                                        <div className='usage-rank-copy'>
                                            <div className='usage-rank-top'>
                                                <strong title={t.type}>{humanise(t.type)}</strong>
                                                <b>{(t.sent + t.failed).toLocaleString()}</b>
                                            </div>
                                            <div className='usage-rank-bar'>
                                                <span style={{ width: `${((t.sent + t.failed) / typeMax) * 100}%` }} />
                                            </div>
                                            <small>
                                                {t.sent.toLocaleString()} sent
                                                {t.failed ? <Text type='danger' style={{ fontSize: 12 }}>· {t.failed} failed</Text> : null}
                                            </small>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No emails in this period.' />
                        )}
                    </Card>
                </Col>
            </Row>

            <Drawer
                open={!!openJob}
                onClose={() => setOpenJob(null)}
                width={isMobile ? '100%' : 640}
                title={openJob?.label}
                destroyOnClose
            >
                {openJob && (
                    <>
                        <Text type='secondary'>{openJob.purpose}</Text>
                        <div style={{ margin: '12px 0 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Tag color={STATUS_META[openJob.status].color} bordered={false}>{STATUS_META[openJob.status].label}</Tag>
                            <Tag bordered={false}>{openJob.scheduleText}</Tag>
                            <Tag bordered={false}>{openJob.id}</Tag>
                        </div>
                        {openJob.error && <Alert type='error' showIcon message='Last error' description={openJob.error} style={{ marginBottom: 16 }} />}
                        {openJob.summary && (
                            <div style={{ marginBottom: 16 }}>
                                <Text strong>Last run reported</Text>
                                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {Object.entries(openJob.summary).map(([k, v]) => (
                                        <Tag key={k} bordered={false}>{humanise(k)}: {String(v)}</Tag>
                                    ))}
                                </div>
                            </div>
                        )}
                        <Text strong>Recent runs</Text>
                        <Table
                            size='small'
                            rowKey='id'
                            loading={runs === null}
                            dataSource={runs || []}
                            pagination={{ pageSize: 10, showSizeChanger: false }}
                            locale={{ emptyText: 'No runs recorded yet. History starts once the updated functions are deployed.' }}
                            style={{ marginTop: 8 }}
                            columns={[
                                { title: 'Started', dataIndex: 'startedAt', render: (v: any) => (toDate(v) ? dayjs(toDate(v)).format('D MMM HH:mm:ss') : '—') },
                                { title: 'Took', dataIndex: 'durationMs', render: (v: number) => formatDuration(v ?? null), width: 90 },
                                {
                                    title: 'Result',
                                    key: 'status',
                                    render: (_: unknown, r: any) =>
                                        r.status === 'failed' ? (
                                            <Tooltip title={r.error}>
                                                <Tag color='error' bordered={false}>Failed</Tag>
                                            </Tooltip>
                                        ) : (
                                            <Tag color='success' bordered={false}>OK</Tag>
                                        )
                                },
                                {
                                    title: 'Details',
                                    dataIndex: 'summary',
                                    render: (s: Record<string, unknown> | null, r: any) =>
                                        r.status === 'failed' ? (
                                            <Text type='danger' style={{ fontSize: 12 }} ellipsis={{ tooltip: r.error }}>{r.error}</Text>
                                        ) : s ? (
                                            <Text style={{ fontSize: 12 }}>
                                                {Object.entries(s).map(([k, v]) => `${humanise(k)}: ${v}`).join(' · ')}
                                            </Text>
                                        ) : (
                                            '—'
                                        )
                                }
                            ]}
                        />
                    </>
                )}
            </Drawer>
        </div>
    )
}

export default EmailInsights
