import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Col, Empty, Grid, Pagination, Row, Space, Tag, Typography } from 'antd'
import {
    CheckCircleFilled,
    CloseCircleFilled,
    ExclamationCircleFilled,
    MailOutlined,
    SafetyCertificateOutlined,
    ClockCircleOutlined,
    HistoryOutlined,
    SyncOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { Link, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { collection, getCountFromServer, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile, type MetricTone } from '@/components/dashboards/metrics/MetricTile'
import { MobileCardList } from '@/components/shared/MobileCardList'
import '@/components/shared/setup-segmented.css'

dayjs.extend(relativeTime)

const { Text } = Typography

const WINDOW_HOURS = 24
const LIST_PAGE_SIZE = 6
const EMAIL_LOG_CAP = 500
const HOUR_MS = 3_600_000

/** Scheduled jobs that write to systemHeartbeats, and how often they should report. */
const HEARTBEAT_JOBS: Record<string, { label: string; purpose: string; cadence: string; expectedEveryHours: number }> = {
    brevoApiKeepAlive: { label: 'Brevo API keep-alive', purpose: 'Keeps the email provider connection active', cadence: 'Weekly', expectedEveryHours: 24 * 7 },
    revenueMetricsSyncCron: { label: 'Revenue metrics sync', purpose: 'Pulls SME revenue into participant metrics', cadence: 'Daily', expectedEveryHours: 24 }
}
// A job is "late" once it is this many times past its expected cadence.
const STALE_FACTOR = 1.5

/** 'pending' = the job has never reported; shown neutrally and not counted as a problem. */
type Severity = 'ok' | 'warn' | 'error' | 'pending'

type EmailFailure = {
    id: string
    to: string
    subject: string
    type: string
    status: string
    error: string
    at: Date | null
}

type Job = {
    id: string
    label: string
    severity: Severity
    detail: string
    lastAt: Date | null
    purpose: string
    cadence: string
}

type StuckUser = { id: string; name: string; email: string; role: string; createdAt: Date | null }

type AuditRow = { id: string; type: string; actor: string; target: string; when: Date | null }

type DashboardData = {
    emailSent: number
    emailFailed: EmailFailure[]
    emailCapped: boolean
    suppressions: number
    jobs: Job[]
    mustChangePassword: StuckUser[]
    audit: AuditRow[]
    loadedAt: Date
}

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (value instanceof Timestamp) return value.toDate()
    if (typeof value?.toDate === 'function') return value.toDate()
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
}

const humanise = (value: string) => value.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const SEVERITY_COLOR: Record<Severity, string> = { ok: '#52c41a', warn: '#faad14', error: '#ff4d4f', pending: '#8c8c8c' }
const SEVERITY_BG: Record<Severity, string> = { ok: '#f6ffed', warn: '#fff7e6', error: '#fff2f0', pending: '#f5f5f5' }
const SEVERITY_LABEL: Record<Severity, string> = { ok: 'Healthy', warn: 'Late', error: 'Failed', pending: 'Awaiting first run' }

const SeverityIcon = ({ severity }: { severity: Severity }) =>
    severity === 'ok' ? (
        <CheckCircleFilled style={{ color: SEVERITY_COLOR.ok }} />
    ) : severity === 'warn' ? (
        <ExclamationCircleFilled style={{ color: SEVERITY_COLOR.warn }} />
    ) : severity === 'error' ? (
        <CloseCircleFilled style={{ color: SEVERITY_COLOR.error }} />
    ) : (
        <ClockCircleOutlined style={{ color: SEVERITY_COLOR.pending }} />
    )

const evaluateJob = (id: string, data: any): Job => {
    const meta = HEARTBEAT_JOBS[id]
    const lastAt = toDate(data?.lastRunAt) || toDate(data?.lastPingAt)
    const base = { id, label: meta?.label || humanise(id), purpose: meta?.purpose || '', cadence: meta?.cadence || '', lastAt }
    const status = String(data?.lastStatus || '').toLowerCase()

    if (status === 'failed' || status === 'error') {
        return { ...base, severity: 'error', detail: String(data?.lastError || 'Last run failed') }
    }
    if (meta && lastAt && Date.now() - lastAt.getTime() > meta.expectedEveryHours * STALE_FACTOR * HOUR_MS) {
        return { ...base, severity: 'warn', detail: `No run reported since ${dayjs(lastAt).fromNow()}` }
    }
    if (!lastAt) return { ...base, severity: 'pending', detail: 'Has not reported a run yet' }
    return { ...base, severity: 'ok', detail: `Last run ${dayjs(lastAt).fromNow()}` }
}

const loadDashboard = async (): Promise<DashboardData> => {
    const since = Timestamp.fromMillis(Date.now() - WINDOW_HOURS * HOUR_MS)

    const [emailSnap, suppressionCount, heartbeatSnap, stuckSnap, auditSnap] = await Promise.all([
        getDocs(
            query(collection(db, 'emailLogs'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(EMAIL_LOG_CAP))
        ),
        getCountFromServer(collection(db, 'emailSuppressions')),
        getDocs(collection(db, 'systemHeartbeats')),
        getDocs(query(collection(db, 'users'), where('mustChangePassword', '==', true), limit(100))),
        getDocs(query(collection(db, 'auditLogs'), orderBy('when', 'desc'), limit(10)))
    ])

    const emailFailed: EmailFailure[] = []
    let emailSent = 0
    emailSnap.docs.forEach(d => {
        const row = d.data() as any
        const status = String(row.status || '').toLowerCase()
        if (status === 'failed' || status === 'bounced') {
            emailFailed.push({
                id: d.id,
                to: String(row.to || ''),
                subject: String(row.subject || ''),
                type: String(row.type || ''),
                status,
                error: String(row.error || ''),
                at: toDate(row.createdAt)
            })
        } else if (status === 'sent') {
            emailSent += 1
        }
    })

    // Jobs we expect to hear from are listed even if they have never written a heartbeat.
    const seen = new Set<string>()
    const jobs = heartbeatSnap.docs.map(d => {
        seen.add(d.id)
        return evaluateJob(d.id, d.data())
    })
    Object.keys(HEARTBEAT_JOBS).forEach(id => {
        if (!seen.has(id)) {
            jobs.push(evaluateJob(id, null))
        }
    })
    const rank: Record<Severity, number> = { error: 0, warn: 1, pending: 2, ok: 3 }
    jobs.sort((a, b) => rank[a.severity] - rank[b.severity] || a.label.localeCompare(b.label))

    const mustChangePassword: StuckUser[] = stuckSnap.docs
        .map(d => {
            const u = d.data() as any
            return {
                id: d.id,
                name: String(u.name || u.displayName || [u.firstName, u.surname].filter(Boolean).join(' ') || ''),
                email: String(u.email || ''),
                role: String(u.role || ''),
                createdAt: toDate(u.createdAt)
            }
        })
        .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))

    const audit: AuditRow[] = auditSnap.docs.map(d => {
        const a = d.data() as any
        return {
            id: d.id,
            type: String(a.type || 'event'),
            actor: String(a.actor?.email || a.actor?.uid || 'system'),
            target: String(a.target?.email || a.target?.uid || ''),
            when: toDate(a.when)
        }
    })

    return {
        emailSent,
        emailFailed,
        emailCapped: emailSnap.size >= EMAIL_LOG_CAP,
        suppressions: suppressionCount.data().count,
        jobs,
        mustChangePassword,
        audit,
        loadedAt: new Date()
    }
}

type Tile = {
    key: string
    title: string
    value: number
    subtitle: string
    severity: Severity
    icon: React.ReactNode
    tone: MetricTone
    to?: string
}

/** One row inside a card: leading marker, title, detail, and a right-aligned note. */
const ListRow: React.FC<{ leading?: React.ReactNode; title: React.ReactNode; detail?: React.ReactNode; note?: React.ReactNode }> = ({
    leading,
    title,
    detail,
    note
}) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(128,128,128,.15)' }}>
        {leading}
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            {detail ? (
                <Text type='secondary' style={{ fontSize: 12 }} ellipsis>
                    {detail}
                </Text>
            ) : null}
        </div>
        {note ? (
            <Text type='secondary' style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {note}
            </Text>
        ) : null}
    </div>
)

const CardEmpty: React.FC<{ text: string }> = ({ text }) => <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />

const SystemAdminDashboard: React.FC = () => {
    const navigate = useNavigate()
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const [data, setData] = useState<DashboardData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [failurePage, setFailurePage] = useState(1)
    const [onboardingPage, setOnboardingPage] = useState(1)

    const refresh = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            setData(await loadDashboard())
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void refresh()
    }, [refresh])

    const tiles: Tile[] = useMemo(() => {
        const failedJobs = data ? data.jobs.filter(j => j.severity === 'error' || j.severity === 'warn').length : 0
        const jobsError = !!data?.jobs.some(j => j.severity === 'error')
        return [
            {
                key: 'email',
                title: 'Failed Emails',
                value: data?.emailFailed.length ?? 0,
                subtitle: data ? `Failed or bounced in ${WINDOW_HOURS}h · ${data.emailSent} sent` : '',
                severity: data?.emailFailed.length ? 'error' : 'ok',
                icon: <MailOutlined style={{ fontSize: 18 }} />,
                tone: 'danger',
                to: '/system_admin/email'
            },
            {
                key: 'jobs',
                title: 'Jobs Needing Attention',
                value: failedJobs,
                subtitle: data ? `Failing or late · ${data.jobs.length} tracked` : '',
                severity: jobsError ? 'error' : failedJobs ? 'warn' : 'ok',
                icon: <SyncOutlined style={{ fontSize: 18 }} />,
                tone: 'warning'
            },
            {
                key: 'onboarding',
                title: 'Awaiting Onboarding',
                value: data?.mustChangePassword.length ?? 0,
                subtitle: 'Users yet to set their password',
                severity: data?.mustChangePassword.length ? 'warn' : 'ok',
                icon: <TeamOutlined style={{ fontSize: 18 }} />,
                tone: 'info',
                to: '/system_admin/users'
            },
            {
                key: 'suppressions',
                title: 'Suppressed Addresses',
                value: data?.suppressions ?? 0,
                subtitle: 'Hard-bounced, no longer emailed',
                severity: 'ok',
                icon: <SafetyCertificateOutlined style={{ fontSize: 18 }} />,
                tone: 'info',
                to: '/system_admin/email'
            }
        ]
    }, [data])

    return (
        <div style={{ padding: '5px 24px' }}>
            <Helmet>
                <title>System Admin Dashboard | Smart Incubation</title>
            </Helmet>

            {error && <Alert type='error' showIcon message='Could not load the dashboard' description={error} style={{ marginBottom: 16 }} />}

            <Row gutter={[16, 16]}>
                {tiles.map(tile => (
                    <Col key={tile.key} xs={12} md={6}>
                        <MetricTile
                            icon={tile.icon}
                            tone={tile.tone}
                            title={tile.title}
                            value={tile.value}
                            subtitle={isMobile ? undefined : tile.subtitle}
                            onClick={tile.to ? () => navigate(tile.to!) : undefined}
                            loading={loading && !data}
                        />
                    </Col>
                ))}
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} xl={12}>
                    <MotionCard
                        title='Recent Email Failures'
                        extra={<Link to='/system_admin/email'>Email monitor</Link>}
                        loading={loading && !data}
                        skeleton='list'
                    >
                        {isMobile && data && data.emailFailed.length > 0 ? (
                            <MobileCardList
                                data={data.emailFailed}
                                getKey={row => row.id}
                                pageSize={LIST_PAGE_SIZE}
                                renderCard={row => ({
                                    title: row.to || '(unknown recipient)',
                                    subtitle: humanise(row.type || 'email'),
                                    badge: (
                                        <Tag color={row.status === 'bounced' ? 'orange' : 'red'}>{row.status}</Tag>
                                    ),
                                    fields: [{ label: 'When', value: row.at ? dayjs(row.at).fromNow() : '\u2014' }],
                                    note: row.error ? <Text type='danger'>{row.error}</Text> : undefined
                                })}
                            />
                        ) : !data || data.emailFailed.length === 0 ? (
                            <CardEmpty text={`No failures in the last ${WINDOW_HOURS}h`} />
                        ) : (
                            <>
                                {data.emailFailed.slice((failurePage - 1) * LIST_PAGE_SIZE, failurePage * LIST_PAGE_SIZE).map(row => (
                                    <ListRow
                                        key={row.id}
                                        leading={
                                            <Tag color={row.status === 'bounced' ? 'orange' : 'red'} style={{ margin: 0, borderRadius: 999 }}>
                                                {row.status}
                                            </Tag>
                                        }
                                        title={row.to || '(unknown recipient)'}
                                        detail={`${humanise(row.type || 'email')} · ${row.error || 'No error detail'}`}
                                        note={row.at ? dayjs(row.at).fromNow() : ''}
                                    />
                                ))}
                                {data.emailFailed.length > LIST_PAGE_SIZE && (
                                    <Pagination
                                        current={failurePage}
                                        pageSize={LIST_PAGE_SIZE}
                                        total={data.emailFailed.length}
                                        showSizeChanger={false}
                                        onChange={setFailurePage}
                                        style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}
                                    />
                                )}
                                {data.emailCapped && (
                                    <Text type='secondary' style={{ fontSize: 12, display: 'block', marginTop: 8, textAlign: 'center' }}>
                                        Based on the latest {EMAIL_LOG_CAP} log entries
                                    </Text>
                                )}
                            </>
                        )}
                    </MotionCard>
                </Col>

                <Col xs={24} xl={12}>
                    <MotionCard
                        title='Scheduled Jobs'
                        extra={<Text type='secondary' style={{ fontSize: 12 }}>Background tasks that report a heartbeat</Text>}
                        loading={loading && !data}
                        skeleton='stats'
                    >
                        {isMobile && data && data.jobs.length > 0 ? (
                            <MobileCardList
                                data={data.jobs}
                                getKey={job => job.id}
                                pageSize={LIST_PAGE_SIZE}
                                renderCard={job => ({
                                    title: job.label,
                                    subtitle: job.purpose || undefined,
                                    badge: (
                                        <Tag
                                            color={job.severity === 'pending' ? 'default' : job.severity === 'ok' ? 'success' : job.severity === 'warn' ? 'warning' : 'error'}
                                        >
                                            {SEVERITY_LABEL[job.severity]}
                                        </Tag>
                                    ),
                                    fields: [
                                        { label: 'Schedule', value: job.cadence || '\u2014' },
                                        { label: 'Last run', value: job.lastAt ? dayjs(job.lastAt).fromNow() : 'Never' }
                                    ],
                                    note:
                                        job.severity === 'error' || job.severity === 'warn' ? (
                                            <Text type={job.severity === 'error' ? 'danger' : 'warning'}>{job.detail}</Text>
                                        ) : undefined
                                })}
                            />
                        ) : !data || data.jobs.length === 0 ? (
                            <CardEmpty text='No job heartbeats yet' />
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {data.jobs.map(job => (
                                    <div
                                        key={job.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 10,
                                            flexWrap: 'wrap',
                                            padding: '6px 12px',
                                            borderRadius: 10,
                                            border: `1px solid ${job.severity === 'error' || job.severity === 'warn' ? SEVERITY_COLOR[job.severity] : 'rgba(128,128,128,.3)'}`
                                        }}
                                    >
                                        <span style={{ fontSize: 16, flex: '0 0 auto', display: 'inline-flex' }}>
                                            <SeverityIcon severity={job.severity} />
                                        </span>
                                        <div style={{ minWidth: 160, flex: '1 1 200px', lineHeight: 1.3 }}>
                                            <div style={{ fontWeight: 600, fontSize: 13 }}>{job.label}</div>
                                            <Text type='secondary' style={{ fontSize: 11 }}>
                                                {job.severity === 'error' || job.severity === 'warn' ? job.detail : job.purpose || job.detail}
                                            </Text>
                                        </div>
                                        <Space size={6} wrap>
                                            {job.cadence && (
                                                <Tag icon={<ClockCircleOutlined />} style={{ margin: 0, borderRadius: 999 }}>
                                                    {job.cadence}
                                                </Tag>
                                            )}
                                            <Tag icon={<HistoryOutlined />} style={{ margin: 0, borderRadius: 999 }}>
                                                {job.lastAt ? `Last run ${dayjs(job.lastAt).fromNow()}` : 'Never run'}
                                            </Tag>
                                            <Tag
                                                color={job.severity === 'pending' ? 'default' : job.severity === 'ok' ? 'success' : job.severity === 'warn' ? 'warning' : 'error'}
                                                style={{ margin: 0, borderRadius: 999 }}
                                            >
                                                {SEVERITY_LABEL[job.severity]}
                                            </Tag>
                                        </Space>
                                    </div>
                                ))}
                            </div>
                        )}
                    </MotionCard>
                </Col>

                <Col xs={24} xl={12}>
                    <MotionCard
                        title='Awaiting First Sign-in'
                        extra={<Link to='/system_admin/users'>Manage users</Link>}
                        loading={loading && !data}
                        skeleton='list'
                    >
                        {isMobile && data && data.mustChangePassword.length > 0 ? (
                            <MobileCardList
                                data={data.mustChangePassword}
                                getKey={u => u.id}
                                pageSize={LIST_PAGE_SIZE}
                                renderCard={u => ({
                                    title: u.name || u.email,
                                    subtitle: u.name ? u.email : undefined,
                                    fields: [
                                        { label: 'Role', value: u.role ? humanise(u.role) : '\u2014' },
                                        { label: 'Invited', value: u.createdAt ? dayjs(u.createdAt).fromNow() : '\u2014' }
                                    ]
                                })}
                            />
                        ) : !data || data.mustChangePassword.length === 0 ? (
                            <CardEmpty text='Everyone has completed onboarding' />
                        ) : (
                            <>
                                {data.mustChangePassword.slice((onboardingPage - 1) * LIST_PAGE_SIZE, onboardingPage * LIST_PAGE_SIZE).map(u => (
                                    <ListRow
                                        key={u.id}
                                        title={u.name || u.email}
                                        detail={`${u.email}${u.role ? ` · ${humanise(u.role)}` : ''}`}
                                        note={u.createdAt ? `invited ${dayjs(u.createdAt).fromNow()}` : ''}
                                    />
                                ))}
                                {data.mustChangePassword.length > LIST_PAGE_SIZE && (
                                    <Pagination
                                        current={onboardingPage}
                                        pageSize={LIST_PAGE_SIZE}
                                        total={data.mustChangePassword.length}
                                        showSizeChanger={false}
                                        onChange={setOnboardingPage}
                                        style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}
                                    />
                                )}
                            </>
                        )}
                    </MotionCard>
                </Col>

                <Col xs={24} xl={12}>
                    <MotionCard title='Recent Admin Activity' loading={loading && !data} skeleton='list'>
                        {isMobile && data && data.audit.length > 0 ? (
                            <MobileCardList
                                data={data.audit}
                                getKey={a => a.id}
                                pageSize={LIST_PAGE_SIZE}
                                renderCard={a => ({
                                    title: humanise(a.type),
                                    subtitle: `${a.actor}${a.target ? ` \u2192 ${a.target}` : ''}`,
                                    fields: [{ label: 'When', value: a.when ? dayjs(a.when).fromNow() : '\u2014' }]
                                })}
                            />
                        ) : !data || data.audit.length === 0 ? (
                            <CardEmpty text='No audit entries yet' />
                        ) : (
                            data.audit.map(a => (
                                <ListRow
                                    key={a.id}
                                    title={humanise(a.type)}
                                    detail={`${a.actor}${a.target ? ` → ${a.target}` : ''}`}
                                    note={a.when ? dayjs(a.when).fromNow() : ''}
                                />
                            ))
                        )}
                    </MotionCard>
                </Col>
            </Row>
        </div>
    )
}

export default SystemAdminDashboard
