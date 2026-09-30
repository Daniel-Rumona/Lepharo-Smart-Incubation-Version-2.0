import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Col, Empty, Row, Space, Tag, Typography } from 'antd'
import {
    DollarOutlined,
    FallOutlined,
    LineChartOutlined,
    MinusOutlined,
    RiseOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'

import { db } from '@/firebase'
import { MotionCard, useMetricPalette } from '@/components/dashboards/metrics/Header'
import {
    buildEmployeeKey,
    formatSignedPercent,
    getContractMonthStart,
    getEffectiveContractsForMonth,
    getFullReportingMonths,
    getPreviousReportingMonths,
    getUniqueJobsForPeriod,
    hasPeriodRevenueData,
    loadProgramFinanceSeries,
    moneyCompact,
    periodLabel,
    signedPercent,
    sumPeriodRevenue,
    toDayjs,
    type DateRangeValue,
    type FinanceCompanySeries,
    type JobContract
} from './ProjectAdminProgramPulse'

const { Text } = Typography

type Props = {
    programId?: string | null
    dateRange?: DateRangeValue
}

// A change inside this band reads as "steady" rather than growth or decline.
const STEADY_BAND_PERCENT = 2
const EXPIRING_SOON_DAYS = 90
const PERMANENT_HEALTHY_SHARE = 60
const PERMANENT_MIXED_SHARE = 40

const COLORS = {
    revenue: '#1677ff',
    permanent: '#52c41a',
    temporary: '#fa8c16'
}

const trendMeta = (change: number) =>
    change > STEADY_BAND_PERCENT
        ? { label: 'Growing', color: 'green', icon: <RiseOutlined /> }
        : change < -STEADY_BAND_PERCENT
            ? { label: 'Declining', color: 'red', icon: <FallOutlined /> }
            : { label: 'Steady', color: 'blue', icon: <MinusOutlined /> }

const StatRow = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
            <Text style={{ fontSize: 12 }}>{label}</Text>
            {hint ? <div><Text type='secondary' style={{ fontSize: 10 }}>{hint}</Text></div> : null}
        </div>
        <Text strong>{value}</Text>
    </div>
)

const ProjectAdminPerformance: React.FC<Props> = ({ programId, dateRange }) => {
    const track = useMetricPalette().isDark ? 'rgba(255, 255, 255, 0.10)' : '#f0f0f0'
    const reportingMonths = useMemo(() => getFullReportingMonths(dateRange), [dateRange])
    const previousMonths = useMemo(() => getPreviousReportingMonths(reportingMonths), [reportingMonths])
    const hasPeriod = reportingMonths.length > 0
    const selectedLabel = useMemo(() => periodLabel(reportingMonths), [reportingMonths])
    const previousLabel = useMemo(() => periodLabel(previousMonths), [previousMonths])

    const [jobsLoading, setJobsLoading] = useState(true)
    const [jobsError, setJobsError] = useState('')
    const [contracts, setContracts] = useState<JobContract[]>([])

    const [financeLoading, setFinanceLoading] = useState(true)
    const [financeError, setFinanceError] = useState('')
    const [companies, setCompanies] = useState<FinanceCompanySeries[]>([])

    useEffect(() => {
        let cancelled = false
        setJobsLoading(true)
        setJobsError('')
        ;(async () => {
            try {
                const snap = await getDocs(programId
                    ? query(collection(db, 'hseJobContracts'), where('programId', '==', programId))
                    : query(collection(db, 'hseJobContracts')))
                if (cancelled) return
                setContracts(snap.docs.map(item => ({ id: item.id, ...(item.data() as any) })) as JobContract[])
            } catch (error) {
                console.error('[ProjectAdminPerformance] jobs failed', error)
                if (!cancelled) {
                    setContracts([])
                    setJobsError('Jobs reporting is temporarily unavailable.')
                }
            } finally {
                if (!cancelled) setJobsLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [programId])

    useEffect(() => {
        let cancelled = false
        setFinanceLoading(true)
        setFinanceError('')
        ;(async () => {
            try {
                const { series, failed, total } = await loadProgramFinanceSeries(programId)
                if (cancelled) return
                setCompanies(series)
                setFinanceError(failed
                    ? `Monthly revenue could not be loaded for ${failed} of ${total} SMEs.`
                    : '')
            } catch (error) {
                console.error('[ProjectAdminPerformance] finance failed', error)
                if (!cancelled) {
                    setCompanies([])
                    setFinanceError('Finance reporting is temporarily unavailable.')
                }
            } finally {
                if (!cancelled) setFinanceLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [programId])

    // ---- Jobs health ----
    const jobs = useMemo(() => {
        const current = hasPeriod ? getUniqueJobsForPeriod(contracts, reportingMonths) : []
        const previous = previousMonths.length ? getUniqueJobsForPeriod(contracts, previousMonths) : []
        const permanent = current.filter(item => item.contractType === 'permanent').length
        const temporary = current.filter(item => item.contractType === 'temporal')

        // Contracts carry only the month they were reported and an end date, so a
        // temporary term runs from the first month the job was reported to its end date.
        const firstReported = new Map<string, Dayjs>()
        contracts.forEach(item => {
            const month = getContractMonthStart(item)
            if (!month) return
            const key = buildEmployeeKey(item)
            const seen = firstReported.get(key)
            if (!seen || month.isBefore(seen)) firstReported.set(key, month)
        })
        const terms = temporary.flatMap(item => {
            const end = toDayjs(item.contractEndDate)
            const start = firstReported.get(buildEmployeeKey(item))
            if (!end || !start) return []
            return [Math.max(end.diff(start, 'month', true), 0)]
        })

        const endMonth = reportingMonths[reportingMonths.length - 1]
        const active = endMonth ? getEffectiveContractsForMonth(contracts, endMonth) : []
        const soonLimit = dayjs().add(EXPIRING_SOON_DAYS, 'day')
        const expiringSoon = active.filter(item => {
            if (item.contractType !== 'temporal') return false
            const end = toDayjs(item.contractEndDate)
            return Boolean(end && !end.isBefore(dayjs(), 'day') && !end.isAfter(soonLimit))
        }).length

        const total = current.length
        return {
            total,
            permanent,
            temporary: temporary.length,
            permanentShare: total ? Math.round((permanent / total) * 100) : 0,
            avgTermMonths: terms.length ? terms.reduce((sum, value) => sum + value, 0) / terms.length : null,
            termsKnown: terms.length,
            expiringSoon,
            change: total - previous.length,
            changePercent: signedPercent(total, previous.length),
            hasPrevious: previous.length > 0
        }
    }, [contracts, hasPeriod, reportingMonths, previousMonths])

    // ---- Revenue health ----
    const revenue = useMemo(() => {
        let current = 0
        let previous = 0
        let up = 0
        let down = 0
        let unchanged = 0
        let hasCurrent = false
        let hasPrevious = false
        companies.forEach(company => {
            const companyCurrent = hasPeriodRevenueData(company.months, reportingMonths)
            const companyPrevious = hasPeriodRevenueData(company.months, previousMonths)
            const currentSum = sumPeriodRevenue(company.months, reportingMonths)
            const previousSum = sumPeriodRevenue(company.months, previousMonths)
            if (companyCurrent) { hasCurrent = true; current += currentSum }
            if (companyPrevious) { hasPrevious = true; previous += previousSum }
            if (!companyCurrent || !companyPrevious) return
            if (currentSum > previousSum) up += 1
            else if (currentSum < previousSum) down += 1
            else unchanged += 1
        })
        const comparable = up + down + unchanged
        return {
            current,
            previous,
            hasCurrent,
            hasPrevious,
            change: signedPercent(current, previous),
            up,
            down,
            unchanged,
            comparable,
            growingShare: comparable ? Math.round((up / comparable) * 100) : 0
        }
    }, [companies, reportingMonths, previousMonths])

    // ---- Month on month ----
    const monthly = useMemo(() => {
        const thisMonth = dayjs().startOf('month')
        return reportingMonths.map(month => {
            const reported = month.isAfter(thisMonth, 'month') ? false : true
            const active = reported ? getEffectiveContractsForMonth(contracts, month) : []
            const hasRevenue = companies.some(company => hasPeriodRevenueData(company.months, [month]))
            return {
                label: month.format('MMM YY'),
                revenue: hasRevenue
                    ? companies.reduce((sum, company) => sum + sumPeriodRevenue(company.months, [month]), 0)
                    : null,
                permanent: reported ? active.filter(item => item.contractType === 'permanent').length : null,
                temporary: reported ? active.filter(item => item.contractType === 'temporal').length : null
            }
        })
    }, [contracts, companies, reportingMonths])

    const hasMonthlyData = monthly.some(row => row.revenue !== null || row.permanent || row.temporary)

    const chartOptions = useMemo<Highcharts.Options>(() => ({
        chart: { height: 340, spacing: [8, 8, 8, 0] },
        title: { text: undefined },
        credits: { enabled: false },
        exporting: { enabled: false },
        legend: { enabled: true, align: 'right', verticalAlign: 'top' },
        xAxis: { categories: monthly.map(row => row.label), crosshair: true },
        yAxis: [
            {
                min: 0,
                allowDecimals: false,
                title: { text: 'Active jobs' },
                gridLineDashStyle: 'Dot',
                stackLabels: { enabled: true }
            },
            {
                min: 0,
                opposite: true,
                title: { text: 'Revenue' },
                gridLineWidth: 0,
                labels: { formatter() { return moneyCompact(Number(this.value)) } }
            }
        ],
        tooltip: {
            shared: true,
            formatter() {
                const points = this.points || []
                const rows = points.map(point => {
                    const value = point.series.name === 'Revenue'
                        ? `R ${Number(point.y).toLocaleString('en-ZA')}`
                        : String(point.y)
                    return `<span style="color:${point.color}">●</span> ${point.series.name}: <b>${value}</b>`
                })
                return `<b>${this.x}</b><br/>${rows.join('<br/>')}`
            }
        },
        plotOptions: {
            column: { stacking: 'normal', borderWidth: 0, borderRadius: 3, maxPointWidth: 34 },
            spline: { lineWidth: 3, marker: { enabled: true, radius: 3 } }
        },
        series: [
            {
                type: 'column', name: 'Permanent jobs', yAxis: 0, color: COLORS.permanent,
                data: monthly.map(row => row.permanent)
            },
            {
                type: 'column', name: 'Temporary jobs', yAxis: 0, color: COLORS.temporary,
                data: monthly.map(row => row.temporary)
            },
            {
                type: 'spline', name: 'Revenue', yAxis: 1, color: COLORS.revenue,
                data: monthly.map(row => row.revenue)
            }
        ]
    }), [monthly])

    const revenueTrend = trendMeta(revenue.change)
    const jobsTrend = trendMeta(jobs.changePercent)
    const stability = jobs.permanentShare >= PERMANENT_HEALTHY_SHARE
        ? { label: 'Mostly permanent', color: 'green' }
        : jobs.permanentShare >= PERMANENT_MIXED_SHARE
            ? { label: 'Mixed', color: 'gold' }
            : { label: 'Mostly temporary', color: 'orange' }

    if (!hasPeriod && !jobsLoading && !financeLoading) {
        return (
            <MotionCard title='Metrics & Performance'>
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description='Jobs and revenue are reported monthly. Choose a range containing at least one complete month.'
                />
            </MotionCard>
        )
    }

    return (
        <>
            {(jobsError || financeError) ? (
                <Alert type='warning' showIcon message={jobsError || financeError} style={{ marginBottom: 12 }} />
            ) : null}

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} lg={12}>
                    <MotionCard
                        loading={jobsLoading}
                        skeletonRows={6}
                        style={{ height: '100%' }}
                        title={<Space size={6}><TeamOutlined /> Jobs health</Space>}
                        extra={<Tag color={stability.color} style={{ marginInlineEnd: 0 }}>{stability.label}</Tag>}
                    >
                        <Space direction='vertical' size={10} style={{ width: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                                <div>
                                    <Text strong style={{ fontSize: 26, lineHeight: 1.1 }}>{jobs.total}</Text>
                                    <div><Text type='secondary' style={{ fontSize: 11 }}>Unique active jobs · {selectedLabel}</Text></div>
                                </div>
                                {jobs.hasPrevious ? (
                                    <div style={{ textAlign: 'right' }}>
                                        <Tag color={jobsTrend.color} icon={jobsTrend.icon} style={{ marginInlineEnd: 0 }}>
                                            {jobs.change > 0 ? '+' : ''}{jobs.change} · {formatSignedPercent(jobs.changePercent)}
                                        </Tag>
                                        <div><Text type='secondary' style={{ fontSize: 10 }}>vs {previousLabel}</Text></div>
                                    </div>
                                ) : null}
                            </div>

                            {jobs.total > 0 ? (
                                <div
                                    aria-label='Permanent versus temporary jobs'
                                    style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: track }}
                                >
                                    <div style={{ width: `${jobs.permanentShare}%`, background: COLORS.permanent }} />
                                    <div style={{ width: `${100 - jobs.permanentShare}%`, background: COLORS.temporary }} />
                                </div>
                            ) : null}

                            <StatRow label='Permanent' value={`${jobs.permanent} (${jobs.permanentShare}%)`} />
                            <StatRow label='Temporary' value={`${jobs.temporary} (${jobs.total ? 100 - jobs.permanentShare : 0}%)`} />
                            <StatRow
                                label='Average temporary term'
                                hint={jobs.termsKnown
                                    ? `From first reported month to end date, across ${jobs.termsKnown} contract${jobs.termsKnown === 1 ? '' : 's'}`
                                    : 'No temporary contracts with an end date'}
                                value={jobs.avgTermMonths === null ? '—' : `${jobs.avgTermMonths.toFixed(1)} months`}
                            />
                            <StatRow
                                label={`Temporary ending within ${EXPIRING_SOON_DAYS} days`}
                                hint='Contracts still active at the end of the period'
                                value={jobs.expiringSoon}
                            />
                        </Space>
                    </MotionCard>
                </Col>

                <Col xs={24} lg={12}>
                    <MotionCard
                        loading={financeLoading}
                        skeletonRows={6}
                        style={{ height: '100%' }}
                        title={<Space size={6}><DollarOutlined /> Revenue health</Space>}
                        extra={revenue.hasPrevious
                            ? <Tag color={revenueTrend.color} icon={revenueTrend.icon} style={{ marginInlineEnd: 0 }}>{revenueTrend.label}</Tag>
                            : null}
                    >
                        <Space direction='vertical' size={10} style={{ width: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                                <div>
                                    <Text strong style={{ fontSize: 26, lineHeight: 1.1 }}>
                                        {revenue.hasCurrent ? moneyCompact(revenue.current) : '—'}
                                    </Text>
                                    <div><Text type='secondary' style={{ fontSize: 11 }}>Combined SME revenue · {selectedLabel}</Text></div>
                                </div>
                                {revenue.hasPrevious ? (
                                    <div style={{ textAlign: 'right' }}>
                                        <Tag color={revenueTrend.color} icon={revenueTrend.icon} style={{ marginInlineEnd: 0 }}>
                                            {formatSignedPercent(revenue.change)}
                                        </Tag>
                                        <div><Text type='secondary' style={{ fontSize: 10 }}>vs {previousLabel}</Text></div>
                                    </div>
                                ) : null}
                            </div>

                            {revenue.comparable > 0 ? (
                                <div
                                    aria-label='SMEs by revenue movement'
                                    style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: track }}
                                >
                                    <div style={{ flex: revenue.up, background: COLORS.permanent }} />
                                    <div style={{ flex: revenue.unchanged, background: '#91caff' }} />
                                    <div style={{ flex: revenue.down, background: '#ff4d4f' }} />
                                </div>
                            ) : null}

                            <StatRow label='Previous period' value={revenue.hasPrevious ? moneyCompact(revenue.previous) : '—'} />
                            <StatRow label='SMEs growing' value={revenue.comparable ? `${revenue.up} (${revenue.growingShare}%)` : '—'}
                                hint={revenue.comparable ? undefined : 'No SME has reported in both periods yet'} />
                            <StatRow label='SMEs unchanged' value={revenue.comparable ? revenue.unchanged : '—'} />
                            <StatRow label='SMEs declining' value={revenue.comparable ? revenue.down : '—'} />
                        </Space>
                    </MotionCard>
                </Col>
            </Row>

            <MotionCard
                loading={jobsLoading || financeLoading}
                skeletonRows={8}
                title={<Space size={6}><LineChartOutlined /> Month on month</Space>}
                extra={<Text type='secondary' style={{ fontSize: 12 }}>Revenue (line) and active jobs (bars) · {selectedLabel}</Text>}
            >
                {hasMonthlyData
                    ? <HighchartsReact highcharts={Highcharts} options={chartOptions} />
                    : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No jobs or revenue reported in this period' />}
            </MotionCard>
        </>
    )
}

export default ProjectAdminPerformance
