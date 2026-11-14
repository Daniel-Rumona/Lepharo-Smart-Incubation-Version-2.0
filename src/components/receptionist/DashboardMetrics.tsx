import React, { useMemo } from 'react'
import { Col, Row } from 'antd'
import { CalendarOutlined, ClockCircleOutlined, FileTextOutlined, InboxOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Inquiry } from '@/types/inquiry'
import { useDataColor } from '@/lib/chartColors'
import { AdminKpiTile, AdminMiniBars, AdminShareRing, type AdminKpiTrend } from '@/components/admin/AdminKpiTile'

/*
 * The receptionist's figures, in the same tiles as the system admin overview:
 * a count, its change on the period before, and small bars of recent periods.
 * Everything is worked out from the branch's inquiries, already scoped to the
 * selected programme by inquiryService.getReceptionistDashboard.
 */

interface DashboardMetricsProps {
    /** All the branch's inquiries, newest first. */
    inquiries: Inquiry[]
    /** The branch's open follow-ups due today or earlier (lib/followUpBuckets), as on the follow-ups page. */
    dueFollowUps: number
    /** All the branch's open follow-ups, for the share ring. */
    openFollowUps: number
}

/**
 * For inquiries a rise is good news (more people coming in). No change shows
 * no badge at all, rather than a "— 0" that says nothing.
 */
const trendOf = (current: number, previous: number, label: string, higherIsGood = true): AdminKpiTrend | undefined => {
    const change = current - previous
    if (change === 0) return undefined
    const percent = previous ? Math.round((Math.abs(change) / previous) * 100) : undefined
    return {
        amount: percent !== undefined ? `${percent}%` : String(Math.abs(change)),
        direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
        tone: change === 0 ? 'neutral' : change > 0 === higherIsGood ? 'good' : 'bad',
        text: `${change >= 0 ? '+' : ''}${change} vs ${label}`
    }
}

const DashboardMetrics: React.FC<DashboardMetricsProps> = ({ inquiries, dueFollowUps, openFollowUps }) => {
    // Data colour, not the accent: a red accent must not make a count look like bad news (lib/chartColors).
    const DATA = useDataColor()
    const figures = useMemo(() => {
        const today = dayjs().startOf('day')
        const count = (from: Dayjs, to: Dayjs) =>
            inquiries.filter(i => {
                const at = dayjs(i.submittedAt)
                return !at.isBefore(from) && at.isBefore(to)
            }).length

        // Rolling windows ending tonight: the last 1 and 7 days, each with the one before it.
        const window = (days: number, back = 0) => {
            const to = today.add(1, 'day').subtract(days * back, 'day')
            return count(to.subtract(days, 'day'), to)
        }
        const bars = (days: number, n: number, label: (start: Dayjs) => string) =>
            Array.from({ length: n }, (_, i) => {
                const back = n - 1 - i
                const start = today.add(1, 'day').subtract(days * (back + 1), 'day')
                return { key: start.valueOf(), label: label(start), value: window(days, back) }
            })

        // Calendar months, so the figure and every bar mean the month named under it.
        // This month runs to tonight and is compared with the same days of last month.
        const tomorrow = today.add(1, 'day')
        const monthStart = today.startOf('month')
        const lastMonthStart = monthStart.subtract(1, 'month')
        const elapsed = tomorrow.diff(monthStart, 'day')
        const lastMonthSameDays = lastMonthStart.add(Math.min(elapsed, lastMonthStart.daysInMonth()), 'day')
        const monthBars = Array.from({ length: 6 }, (_, i) => {
            const start = monthStart.subtract(5 - i, 'month')
            const end = i === 5 ? tomorrow : start.add(1, 'month')
            return { key: start.valueOf(), label: start.format('MMM'), value: count(start, end) }
        })

        return {
            today: window(1),
            yesterday: window(1, 1),
            week: window(7),
            lastWeek: window(7, 1),
            month: count(monthStart, tomorrow),
            lastMonth: count(lastMonthStart, lastMonthSameDays),
            dayBars: bars(1, 7, d => d.format('dd').charAt(0)),
            // Four weeks, so the bars leave room for the change badge beside the figure.
            weekBars: bars(7, 4, d => d.add(6, 'day').format('D/M')),
            monthBars
        }
    }, [inquiries])

    return (
        <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
                <AdminKpiTile
                    compact
                    icon={<CalendarOutlined />}
                    label="Today's inquiries"
                    value={figures.today}
                    trend={trendOf(figures.today, figures.yesterday, 'yesterday')}
                    visual={<AdminMiniBars bars={figures.dayBars} />}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <AdminKpiTile
                    compact
                    icon={<FileTextOutlined />}
                    label='Last 7 days'
                    value={figures.week}
                    trend={trendOf(figures.week, figures.lastWeek, 'the 7 days before')}
                    visual={<AdminMiniBars bars={figures.weekBars} />}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <AdminKpiTile
                    compact
                    icon={<InboxOutlined />}
                    label='This month'
                    value={figures.month}
                    trend={trendOf(figures.month, figures.lastMonth, 'the same days last month')}
                    visual={<AdminMiniBars bars={figures.monthBars} />}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <AdminKpiTile
                    compact
                    icon={<ClockCircleOutlined />}
                    label='Follow-ups due'
                    value={dueFollowUps}
                    // No note line, so this tile is the same height as the others; the
                    // ring's tooltip says what the share is of.
                    visual={
                        <span
                            title={`${dueFollowUps.toLocaleString()} of ${openFollowUps.toLocaleString()} open ${openFollowUps === 1 ? 'follow-up' : 'follow-ups'}`}
                        >
                            <AdminShareRing value={dueFollowUps} total={openFollowUps} color={DATA} />
                        </span>
                    }
                />
            </Col>
        </Row>
    )
}

export default DashboardMetrics
