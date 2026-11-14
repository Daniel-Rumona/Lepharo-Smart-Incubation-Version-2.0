import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Empty, Row, Segmented, theme } from 'antd'
import { CheckCircleOutlined, FieldTimeOutlined, InboxOutlined, RightOutlined, RiseOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { useAuth } from '@/hooks/useAuth'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useBranchNames } from '@/lib/useBranchNames'
import { inquiryService } from '@/services/inquiryService'
import { followUpService, type FollowUp } from '@/services/followUpService'
import type { Inquiry } from '@/types/inquiry'
import { STATUS_COLORS } from '@/types/inquiry'
import { channelLabel, resolveInquiryChannel, AUDIENCE_LABEL, resolveInquiryAudience } from '@/utils/inquirySource'
import { INQUIRY_STATUSES } from '@/lib/inquiryList'
import { useDataColor } from '@/lib/chartColors'
import { AdminKpiTile, AdminMiniBars, AdminShareRing, type AdminKpiTrend } from '@/components/admin/AdminKpiTile'
import '@/styles/admin-overview.css'
import '@/styles/receptionist-dashboard.css'

/*
 * Reception's analytics for its branch, in the system admin overview's style:
 * figures for the chosen period with the change on the period before, the
 * inquiries over time, where they stand, which departments and channels they
 * come through, and the busiest days. Scoped to the selected programme, like
 * the other reception pages (general inquiries show under every programme).
 */

type PeriodKey = '30d' | '3m' | '12m' | 'all'

const PERIODS: { value: PeriodKey; label: string }[] = [
    { value: '30d', label: '30 days' },
    { value: '3m', label: '3 months' },
    { value: '12m', label: '12 months' },
    { value: 'all', label: 'All time' }
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value?.toDate === 'function') return value.toDate()
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
}

/** The period's start (inclusive) and the same length just before it, or none for "All time". */
const periodBounds = (key: PeriodKey, now: Dayjs): { start: Dayjs | null; prevStart: Dayjs | null } => {
    const end = now.endOf('day')
    const start =
        key === '30d' ? end.subtract(30, 'day') : key === '3m' ? end.subtract(3, 'month') : key === '12m' ? end.subtract(12, 'month') : null
    if (!start) return { start: null, prevStart: null }
    return { start, prevStart: start.subtract(end.diff(start, 'day'), 'day') }
}

const trendOf = (current: number, previous: number, label: string, higherIsGood = true): AdminKpiTrend | undefined => {
    const change = current - previous
    if (change === 0) return undefined
    const percent = previous ? Math.round((Math.abs(change) / previous) * 100) : undefined
    return {
        amount: percent !== undefined ? `${percent}%` : String(Math.abs(change)),
        direction: change > 0 ? 'up' : 'down',
        tone: change > 0 === higherIsGood ? 'good' : 'bad',
        text: `${change > 0 ? '+' : ''}${change} vs ${label}`
    }
}

/**
 * When an inquiry first got a response from reception: its first status change
 * off "New", first communication or first follow-up done, whichever came first.
 */
const firstActionAt = (inquiry: Inquiry, followUps: FollowUp[]): Date | null => {
    const times: number[] = []
    ;(inquiry.statusHistory || []).forEach(e => {
        const at = toDate(e.changedAt)
        if (at && e.status !== 'New') times.push(at.getTime())
    })
    ;(inquiry.communications || []).forEach(c => {
        const at = toDate(c.sentAt)
        if (at) times.push(at.getTime())
    })
    followUps.forEach(f => f.status === 'Completed' && f.completedAt && times.push(f.completedAt.getTime()))
    return times.length ? new Date(Math.min(...times)) : null
}

const humanHours = (hours: number) =>
    hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`

const median = (values: number[]) => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const CardHead: React.FC<{ title: string; subtitle?: React.ReactNode; onMore?: () => void; moreLabel?: string }> = ({ title, subtitle, onMore, moreLabel }) => (
    <div className='admin-card-head'>
        <div>
            <h3>{title}</h3>
            {subtitle && <span>{subtitle}</span>}
        </div>
        {onMore && (
            <Button type='text' size='small' onClick={onMore}>
                {moreLabel || 'View more'} <RightOutlined />
            </Button>
        )}
    </div>
)

const RankList: React.FC<{ rows: { key: string; count: number; percent: number; color?: string }[] }> = ({ rows }) =>
    rows.length ? (
        <ul className='usage-rank-list'>
            {rows.map(row => (
                <li key={row.key}>
                    <div className='usage-rank-copy'>
                        <div className='usage-rank-top'>
                            <strong title={row.key}>{row.key}</strong>
                            <b>{row.count.toLocaleString()}</b>
                        </div>
                        <div className='usage-rank-bar'>
                            <span style={{ width: `${Math.max(2, row.percent)}%`, ...(row.color ? { background: row.color } : null) }} />
                        </div>
                        <small>{row.percent}% of inquiries</small>
                    </div>
                </li>
            ))}
        </ul>
    ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No inquiries in this period.' />
    )

const ReceptionistReports: React.FC = () => {
    const navigate = useNavigate()
    const { token } = theme.useToken()
    const { user, loading: userLoading } = useAuth()
    const { activeProgramId } = useActiveProgramId()
    const branchNames = useBranchNames()
    const branchId = String(user?.assignedBranch || '')

    const [inquiries, setInquiries] = useState<Inquiry[]>([])
    const [followUps, setFollowUps] = useState<FollowUp[]>([])
    const [loading, setLoading] = useState(true)
    const [period, setPeriod] = useState<PeriodKey>('12m')

    const load = useCallback(async () => {
        if (!branchId) return setLoading(false)
        setLoading(true)
        try {
            const [rows, fus] = await Promise.all([
                inquiryService.getInquiriesByBranch(branchId),
                followUpService.getFollowUpsByBranch(branchId).catch(() => [] as FollowUp[])
            ])
            setInquiries(activeProgramId ? rows.filter(i => !i.programId || i.programId === activeProgramId) : rows)
            setFollowUps(fus)
        } finally {
            setLoading(false)
        }
    }, [branchId, activeProgramId])

    useEffect(() => {
        if (!userLoading) load()
    }, [load, userLoading])

    // Data colour, not the accent: under a red accent a count must not look like bad news (lib/chartColors).
    const DATA = useDataColor()
    const DATA_DEEP = Highcharts.color(DATA).brighten(-0.25).get('rgb') as string
    const DATA_SOFT = Highcharts.color(DATA).setOpacity(0.35).get('rgba') as string

    const stats = useMemo(() => {
        const now = dayjs()
        const { start, prevStart } = periodBounds(period, now)
        const inPeriod = (d: Date | null, from: Dayjs | null, to: Dayjs | null) => !!d && (!from || !dayjs(d).isBefore(from)) && (!to || dayjs(d).isBefore(to))
        const current = inquiries.filter(i => inPeriod(toDate(i.submittedAt), start, null))
        const previous = start && prevStart ? inquiries.filter(i => inPeriod(toDate(i.submittedAt), prevStart, start)) : null
        const ids = new Set(current.map(i => i.id))
        const fuByInquiry = new Map<string, FollowUp[]>()
        followUps.forEach(f => fuByInquiry.set(f.inquiryId, [...(fuByInquiry.get(f.inquiryId) || []), f]))

        const doneIn = (from: Dayjs | null, to: Dayjs | null) =>
            followUps.filter(f => f.status === 'Completed' && inPeriod(f.completedAt || f.updatedAt || null, from, to)).length

        // Time to first response, for inquiries in the period that have one.
        const responseHours = current
            .map(i => {
                const received = toDate(i.submittedAt)
                const first = firstActionAt(i, fuByInquiry.get(i.id) || [])
                return received && first && first >= received ? (first.getTime() - received.getTime()) / 36e5 : null
            })
            .filter((h): h is number => h !== null)
        const prevResponseHours = (previous || [])
            .map(i => {
                const received = toDate(i.submittedAt)
                const first = firstActionAt(i, fuByInquiry.get(i.id) || [])
                return received && first && first >= received ? (first.getTime() - received.getTime()) / 36e5 : null
            })
            .filter((h): h is number => h !== null)

        // Over time: by week for 30 days and 3 months, by month otherwise.
        const byWeek = period === '30d' || period === '3m'
        const firstDate = start || dayjs(Math.min(...current.map(i => toDate(i.submittedAt)?.getTime() || Date.now()), Date.now()))
        const buckets: { label: string; from: Dayjs; to: Dayjs }[] = []
        if (byWeek) {
            let from = firstDate.subtract((firstDate.day() + 6) % 7, 'day').startOf('day')
            while (from.isBefore(now)) {
                buckets.push({ label: from.format('D MMM'), from, to: from.add(1, 'week') })
                from = from.add(1, 'week')
            }
        } else {
            let from = firstDate.startOf('month')
            while (from.isBefore(now)) {
                buckets.push({ label: from.format(from.year() === now.year() ? 'MMM' : 'MMM YY'), from, to: from.add(1, 'month') })
                from = from.add(1, 'month')
            }
        }
        const series = buckets.map(b => ({
            label: b.label,
            received: current.filter(i => inPeriod(toDate(i.submittedAt), b.from, b.to)).length,
            converted: current.filter(i => i.status === 'Converted' && inPeriod(toDate(i.submittedAt), b.from, b.to)).length
        }))

        const breakdown = (keyOf: (i: Inquiry) => string) => {
            const counts = new Map<string, number>()
            current.forEach(i => counts.set(keyOf(i), (counts.get(keyOf(i)) || 0) + 1))
            return [...counts.entries()]
                .map(([key, count]) => ({ key, count, percent: current.length ? Math.round((count / current.length) * 100) : 0 }))
                .sort((a, b) => b.count - a.count)
        }

        const weekday = WEEKDAYS.map((label, index) => ({
            label,
            count: current.filter(i => {
                const d = toDate(i.submittedAt)
                return d && (d.getDay() + 6) % 7 === index
            }).length
        }))

        const monthBars = Array.from({ length: 6 }, (_, k) => {
            const from = now.startOf('month').subtract(5 - k, 'month')
            return { key: from.valueOf(), label: from.format('MMM'), value: inquiries.filter(i => inPeriod(toDate(i.submittedAt), from, from.add(1, 'month'))).length }
        })
        const doneBars = Array.from({ length: 6 }, (_, k) => {
            const from = now.startOf('month').subtract(5 - k, 'month')
            return { key: from.valueOf(), label: from.format('MMM'), value: doneIn(from, from.add(1, 'month')) }
        })

        const converted = current.filter(i => i.status === 'Converted').length
        const prevConverted = previous ? previous.filter(i => i.status === 'Converted').length : 0
        const responseMedian = median(responseHours)
        const prevResponseMedian = median(prevResponseHours)

        return {
            total: current.length,
            prevTotal: previous?.length ?? null,
            converted,
            prevConverted,
            followUpsDone: doneIn(start, null),
            prevFollowUpsDone: start && prevStart ? doneIn(prevStart, start) : null,
            responseMedian,
            prevResponseMedian,
            responded: responseHours.length,
            series,
            byStatus: INQUIRY_STATUSES.map(status => ({
                status,
                count: current.filter(i => i.status === status).length
            })).filter(s => s.count > 0),
            byDepartment: breakdown(i => String(i.inquiryDetails?.department || '').trim() || 'No department'),
            bySource: breakdown(i => channelLabel(resolveInquiryChannel(i.source))),
            byAudience: breakdown(i => AUDIENCE_LABEL[resolveInquiryAudience(i)]),
            weekday,
            monthBars,
            doneBars,
            ids
        }
    }, [inquiries, followUps, period])

    const periodLabel = PERIODS.find(p => p.value === period)?.label.toLowerCase()
    const vsLabel = period === 'all' ? '' : `the ${periodLabel} before`

    const trendChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'areaspline', height: 300, spacing: [12, 4, 4, 4], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            xAxis: { categories: stats.series.map(s => s.label), lineWidth: 0, tickLength: 0, labels: { step: Math.max(1, Math.ceil(stats.series.length / 12)) } },
            yAxis: { title: { text: undefined }, allowDecimals: false, gridLineDashStyle: 'Dash' },
            legend: { align: 'right', verticalAlign: 'top', itemDistance: 16, symbolRadius: 6 },
            tooltip: { shared: true },
            plotOptions: { areaspline: { marker: { radius: 3, symbol: 'circle' }, lineWidth: 2.5 } },
            series: [
                {
                    type: 'areaspline',
                    name: 'Received',
                    data: stats.series.map(s => s.received),
                    color: DATA,
                    fillColor: {
                        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                        stops: [
                            [0, Highcharts.color(DATA).setOpacity(0.32).get('rgba') as string],
                            [1, Highcharts.color(DATA).setOpacity(0).get('rgba') as string]
                        ]
                    }
                },
                { type: 'areaspline', name: 'Converted', data: stats.series.map(s => s.converted), color: DATA_DEEP, fillColor: 'transparent', dashStyle: 'ShortDash' }
            ]
        }),
        [stats.series, DATA, DATA_DEEP]
    )

    const statusChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'pie', height: 220, spacing: [0, 0, 0, 0], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
            plotOptions: { pie: { innerSize: '74%', borderWidth: 3, borderColor: token.colorBgContainer, borderRadius: 6, dataLabels: { enabled: false } } },
            series: [
                {
                    type: 'pie',
                    name: 'Inquiries',
                    data: stats.byStatus.map(s => ({ name: s.status, y: s.count, color: STATUS_COLORS[s.status as keyof typeof STATUS_COLORS] || '#94a3b8' }))
                }
            ]
        }),
        [stats.byStatus, token.colorBgContainer]
    )

    const weekdayChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'column', height: 230, spacing: [8, 0, 0, 0], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            legend: { enabled: false },
            xAxis: { categories: stats.weekday.map(d => d.label), lineWidth: 0, tickLength: 0 },
            yAxis: { title: { text: undefined }, allowDecimals: false, gridLineDashStyle: 'Dash' },
            tooltip: { pointFormat: '<b>{point.y}</b> inquiries' },
            plotOptions: { column: { borderRadius: 6, pointPadding: 0.08, groupPadding: 0.12 } },
            series: [
                {
                    type: 'column',
                    name: 'Inquiries',
                    data: stats.weekday.map(d => d.count),
                    color: DATA_SOFT,
                    states: { hover: { color: DATA } }
                }
            ]
        }),
        [stats.weekday, DATA_SOFT, DATA]
    )

    if (!userLoading && !branchId) {
        return (
            <div className='admin-overview'>
                <Card className='admin-card' bordered={false}>
                    <Empty description='You need to be assigned to a branch to see its analytics.' />
                </Card>
            </div>
        )
    }

    const busiest = [...stats.weekday].sort((a, b) => b.count - a.count)[0]
    const statusTotal = stats.byStatus.reduce((t, s) => t + s.count, 0)
    const conversionRate = stats.total ? Math.round((stats.converted / stats.total) * 100) : 0

    return (
        <div className='admin-overview rcp-dashboard' style={{ ['--rcp-data' as any]: DATA }}>
            <Helmet>
                <title>Analytics | Smart Incubation</title>
            </Helmet>

            <div className='admin-toolbar rcp-fu-toolbar'>
                <Segmented className='admin-toolbar-tabs' value={period} onChange={value => setPeriod(value as PeriodKey)} options={PERIODS} />
                <span className='rcp-report-scope'>{branchNames[branchId] || 'Your branch'} reception</span>
            </div>

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<InboxOutlined />}
                        label='Inquiries'
                        value={stats.total}
                        trend={stats.prevTotal !== null ? trendOf(stats.total, stats.prevTotal, vsLabel) : undefined}
                        visual={<AdminMiniBars bars={stats.monthBars} />}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<RiseOutlined />}
                        label='Converted'
                        value={stats.converted}
                        trend={stats.prevTotal !== null ? trendOf(stats.converted, stats.prevConverted, vsLabel) : undefined}
                        visual={
                            <span title={`${conversionRate}% of inquiries in this period converted`}>
                                <AdminShareRing value={stats.converted} total={stats.total} color={DATA} />
                            </span>
                        }
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<FieldTimeOutlined />}
                        label='First response'
                        value={stats.responseMedian !== null ? humanHours(stats.responseMedian) : '—'}
                        trend={
                            stats.responseMedian !== null && stats.prevResponseMedian !== null && period !== 'all'
                                ? (() => {
                                      // Faster is better: a fall is good news.
                                      const t = trendOf(Math.round(stats.responseMedian), Math.round(stats.prevResponseMedian), vsLabel, false)
                                      return t && { ...t, amount: t.amount, text: `Median ${humanHours(stats.prevResponseMedian)} ${vsLabel}` }
                                  })()
                                : undefined
                        }
                        visual={
                            <span title={`${stats.responded} of ${stats.total} inquiries in this period have had a response`}>
                                <AdminShareRing value={stats.responded} total={stats.total} color={DATA} />
                            </span>
                        }
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<CheckCircleOutlined />}
                        label='Follow-ups done'
                        value={stats.followUpsDone}
                        trend={stats.prevFollowUpsDone !== null ? trendOf(stats.followUpsDone, stats.prevFollowUpsDone, vsLabel) : undefined}
                        visual={<AdminMiniBars bars={stats.doneBars} />}
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} className='admin-overview-row'>
                <Col xs={24} lg={16}>
                    <Card className='admin-card' bordered={false} loading={loading}>
                        <CardHead
                            title='Inquiries over time'
                            subtitle={`Received and converted, by ${period === '30d' || period === '3m' ? 'week' : 'month'}`}
                            onMore={() => navigate('/inquiries')}
                            moreLabel='All inquiries'
                        />
                        {stats.total ? <HighchartsReact highcharts={Highcharts} options={trendChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No inquiries in this period.' />}
                    </Card>
                </Col>
                <Col xs={24} lg={8}>
                    <Card className='admin-card' bordered={false} loading={loading}>
                        <CardHead title='Where they stand' subtitle='Status of inquiries received in this period' />
                        {statusTotal ? (
                            <>
                                <div className='admin-donut'>
                                    <HighchartsReact highcharts={Highcharts} options={statusChart} />
                                    <div className='admin-donut-center'>
                                        <strong>{statusTotal.toLocaleString()}</strong>
                                        <span>Inquiries</span>
                                    </div>
                                </div>
                                <ul className='admin-legend'>
                                    {stats.byStatus.map(s => (
                                        <li key={s.status}>
                                            <i style={{ background: STATUS_COLORS[s.status as keyof typeof STATUS_COLORS] || '#94a3b8' }} />
                                            <span>{s.status}</span>
                                            <b>{s.count}</b>
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
                    <Card className='admin-card is-fit' bordered={false} loading={loading}>
                        <CardHead title='By department' subtitle='Which department each inquiry is for' />
                        <RankList rows={stats.byDepartment} />
                    </Card>
                </Col>
                <Col xs={24} md={12} xl={8}>
                    <Card className='admin-card is-fit' bordered={false} loading={loading}>
                        <CardHead title='By source' subtitle='How inquiries reached reception' />
                        <RankList rows={stats.bySource} />
                        {stats.byAudience.length > 0 && (
                            <div className='rcp-report-split'>
                                {stats.byAudience.map(a => (
                                    <span key={a.key}>
                                        <b>{a.percent}%</b> {a.key}
                                    </span>
                                ))}
                            </div>
                        )}
                    </Card>
                </Col>
                <Col xs={24} xl={8}>
                    <Card className='admin-card is-fit' bordered={false} loading={loading}>
                        <CardHead
                            title='Busiest days'
                            subtitle={busiest && busiest.count ? `${busiest.label} is the busiest day in this period` : 'Inquiries by day of the week'}
                        />
                        {stats.total ? <HighchartsReact highcharts={Highcharts} options={weekdayChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                    </Card>
                </Col>
            </Row>
        </div>
    )
}

export default ReceptionistReports
