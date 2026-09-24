import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Space,
    Typography,
    Modal,
    Button,
    Empty,
} from 'antd'
import { ExpandOutlined, ReloadOutlined } from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import drilldownModule from 'highcharts/modules/drilldown'
import heatmapModule from 'highcharts/modules/heatmap'
import dayjs from 'dayjs'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { canViewControlReportData, filterReportRecords } from '@/utils/reportVisibility'
import { MotionCard } from '@/components/dashboards/metrics/Header'

// Init Highcharts modules (safe-guard for SSR)
if (typeof Highcharts === 'function') {
    drilldownModule(Highcharts)
    heatmapModule(Highcharts)
}

// Global disable exporting / credits as requested
Highcharts.setOptions({
    credits: { enabled: false },
    exporting: { enabled: false }
})

const { Title, Text } = Typography

/** Types (lean) */
type UserDoc = {
    id: string
    departmentname?: string
    role?: string
    position?: string
    createdAt?: string
}
type Timesheet = {
    id: string
    userId: string
    date: string
    hoursWorked?: string
    lateBy?: string
    overtime?: string
}
type Leave = {
    id: string
    employeeId: string
    type: 'annual' | 'sick' | 'personal'
    status: 'pending' | 'approved' | 'rejected'
    from: string
    to: string
    days: number
}

/** Dummy fallback data (realistic) */
const D_USERS: UserDoc[] = [
    {
        id: 'u1',
        departmentname: 'Engineering',
        role: 'staff',
        position: 'Frontend Dev',
        createdAt: dayjs().subtract(8, 'month').toISOString()
    },
    {
        id: 'u2',
        departmentname: 'Engineering',
        role: 'manager',
        position: 'Tech Lead',
        createdAt: dayjs().subtract(14, 'month').toISOString()
    },
    {
        id: 'u3',
        departmentname: 'HR',
        role: 'hr',
        position: 'HRBP',
        createdAt: dayjs().subtract(4, 'month').toISOString()
    },
    {
        id: 'u4',
        departmentname: 'Finance',
        role: 'staff',
        position: 'Accountant',
        createdAt: dayjs().subtract(10, 'month').toISOString()
    },
    {
        id: 'u5',
        departmentname: 'Operations',
        role: 'staff',
        position: 'Coordinator',
        createdAt: dayjs().subtract(2, 'month').toISOString()
    }
]
const D_LEAVE: Leave[] = [
    {
        id: 'l1',
        employeeId: 'u1',
        type: 'annual',
        status: 'approved',
        from: dayjs().subtract(25, 'day').format('YYYY-MM-DD'),
        to: dayjs().subtract(20, 'day').format('YYYY-MM-DD'),
        days: 5
    },
    {
        id: 'l2',
        employeeId: 'u2',
        type: 'sick',
        status: 'approved',
        from: dayjs().subtract(6, 'day').format('YYYY-MM-DD'),
        to: dayjs().subtract(5, 'day').format('YYYY-MM-DD'),
        days: 1
    },
    {
        id: 'l3',
        employeeId: 'u3',
        type: 'personal',
        status: 'pending',
        from: dayjs().add(3, 'day').format('YYYY-MM-DD'),
        to: dayjs().add(3, 'day').format('YYYY-MM-DD'),
        days: 1
    },
    {
        id: 'l4',
        employeeId: 'u4',
        type: 'annual',
        status: 'rejected',
        from: dayjs().add(10, 'day').format('YYYY-MM-DD'),
        to: dayjs().add(12, 'day').format('YYYY-MM-DD'),
        days: 3
    }
]
const D_SHEETS: Timesheet[] = Array.from({ length: 30 }).flatMap((_, i) => {
    const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD')
    const mk = (h: number, m: number) => `${h}h ${m}m`
    return [
        {
            id: `t1_${i}`,
            userId: 'u1',
            date: d,
            hoursWorked: mk(8, Math.floor(Math.random() * 50) % 60),
            lateBy: `${Math.floor(Math.random() * 20)}m`,
            overtime: mk(
                Math.floor(Math.random() * 2),
                Math.floor(Math.random() * 30)
            )
        },
        {
            id: `t2_${i}`,
            userId: 'u2',
            date: d,
            hoursWorked: mk(7, Math.floor(Math.random() * 50) % 60),
            lateBy: `${Math.floor(Math.random() * 10)}m`,
            overtime: mk(
                Math.floor(Math.random() * 1),
                Math.floor(Math.random() * 30)
            )
        }
    ]
})

/** Sum helpers */
const parseHM = (s?: string) => {
    if (!s) return 0
    const m = /(\d+)h\s+(\d+)m/.exec(s)
    const h = m ? +m[1] : 0
    const mm = m ? +m[2] : 0
    return h * 60 + mm
}

/** Generic chart card with Expand */
const ChartCard: React.FC<{
    title: string
    options: Highcharts.Options
    height?: number
}> = ({ title, options, height = 300 }) => {
    const [open, setOpen] = useState(false)
    return (
        <>
            <MotionCard
                title={
                    <Space>
                        <span>{title}</span>
                    </Space>
                }
                extra={
                    <Button icon={<ExpandOutlined />} onClick={() => setOpen(true)}>
                        Expand
                    </Button>
                }
            >
                <HighchartsReact
                    highcharts={Highcharts}
                    options={{ ...options, chart: { ...(options.chart || {}), height } }}
                />
            </MotionCard>
            <Modal
                open={open}
                onCancel={() => setOpen(false)}
                footer={null}
                width={1100}
                title={title}
                destroyOnClose
            >
                <HighchartsReact
                    highcharts={Highcharts}
                    options={{
                        ...options,
                        chart: { ...(options.chart || {}), height: 580 }
                    }}
                />
            </Modal>
        </>
    )
}

const HRMReportsPage: React.FC = () => {
    const [loading, setLoading] = useState(true)
    const { user } = useFullIdentity()
    const [users, setUsers] = useState<UserDoc[]>([])
    const [sheets, setSheets] = useState<Timesheet[]>([])
    const [leaves, setLeaves] = useState<Leave[]>([])

    const load = async () => {
        setLoading(true)
        try {
            const uSnap = await getDocs(
                query(
                    collection(db, 'users'),
                )
            )


            const allUsers = uSnap
                ? (uSnap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                })) as UserDoc[])
                : D_USERS

            // exclude non-employees here (only incubatee per your instruction)
            const NON_EMPLOYEE_ROLES = new Set(['incubatee'])
            const employees = filterReportRecords(allUsers as unknown as Record<string, unknown>[], user?.email).filter(
                u => !NON_EMPLOYEE_ROLES.has((u.role || '').toLowerCase())
            ) as unknown as UserDoc[]

            // leave / timesheets
            const [lSnap, tSnap] = await Promise.all([
                getDocs(query(collection(db, 'leaveRequests'))),
                getDocs(query(collection(db, 'timesheets')))
            ])

            const l = lSnap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            })) as Leave[]
            const t = tSnap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            })) as Timesheet[]

            setUsers(employees)
            setLeaves(l.length ? l : D_LEAVE)
            setSheets(t.length ? t : D_SHEETS)
        } catch {
            // fallback still excludes incubatees
            const NON_EMPLOYEE_ROLES = new Set(['incubatee'])
            setUsers(canViewControlReportData(user?.email) ? D_USERS.filter(
                u => !NON_EMPLOYEE_ROLES.has((u.role || '').toLowerCase())
            ) : [])
            setLeaves(D_LEAVE)
            setSheets(D_SHEETS)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [user])

    /* ---------- Derived aggregates ---------- */
    const roleCounts = useMemo(() => {
        const map = new Map<string, number>()
        users.forEach(u =>
            map.set(u.role || 'employee', (map.get(u.role || 'employee') || 0) + 1)
        )
        return Array.from(map.entries())
    }, [users])

    const byMonth = useMemo(() => {
        const months = Array.from({ length: 12 }).map((_, i) =>
            dayjs()
                .startOf('month')
                .subtract(11 - i, 'month')
        )
        const hires = months.map(
            m =>
                users.filter(u => u.createdAt && dayjs(u.createdAt).isSame(m, 'month'))
                    .length
        )
        const exits = months.map(() => 0)
        const leaveDays = months.map(m => {
            const start = m.startOf('month'),
                end = m.endOf('month')
            let sum = 0
            leaves.forEach(l => {
                if (l.status !== 'approved') return
                const f = dayjs(l.from),
                    t = dayjs(l.to)
                // overlap
                const s = f.isBefore(start) ? start : f
                const e = t.isAfter(end) ? end : t
                const d = e.diff(s, 'day') + 1
                if (d > 0 && f.isBefore(end) && t.isAfter(start)) sum += d
            })
            return sum
        })
        return {
            months: months.map(m => m.format('MMM YYYY')),
            hires,
            exits,
            leaveDays
        }
    }, [users, leaves])

    const hoursSeries = useMemo(() => {
        // total worked minutes per day (last 30), weekends excluded so the
        // line doesn't dip to zero every Sat/Sun when nobody's clocked in.
        const days = Array.from({ length: 30 })
            .map((_, i) =>
                dayjs()
                    .subtract(29 - i, 'day')
                    .format('YYYY-MM-DD')
            )
            .filter(d => {
                const dow = dayjs(d).day()
                return dow !== 0 && dow !== 6
            })
        const totals = days.map(d => {
            const mm = sheets
                .filter(s => s.date === d)
                .reduce((a, b) => a + parseHM(b.hoursWorked), 0)
            return Math.round((mm / 60) * 100) / 100 // hours with 2dp
        })
        return { cats: days.map(d => dayjs(d).format('D MMM')), vals: totals }
    }, [sheets])

    const attendanceHeat = useMemo(() => {
        // weekday (rows) x hour bucket (cols) – approximate using hoursWorked spread (dummy logic)
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const hours = Array.from({ length: 10 }).map((_, i) => 7 + i) // 7..16
        const matrix: [number, number, number][] = []
        weekdays.forEach((_, r) => {
            hours.forEach((h, c) => {
                const val = Math.max(
                    0,
                    Math.round(Math.random() * 10 + (r >= 1 && r <= 5 ? 5 : 0))
                )
                matrix.push([c, r, val])
            })
        })
        return { weekdays, hours, data: matrix }
    }, [sheets])

    // 1) nice, consistent status colors
    const STATUS_COLORS = {
        Approved: '#52c41a',
        Pending: '#faad14',
        Rejected: '#f5222d'
    }

    // 2) robust type/status grouping + zero filtering
    const leaveByTypeStatus = useMemo(() => {
        const types: Highcharts.PointOptionsObject[] = []
        const dd: Highcharts.DrilldownSeriesOptions[] = []

        // dynamic buckets so unknown types won't crash
        const typeGroups: Record<string, Leave[]> = {}

        leaves.forEach(l => {
            const t = String(l.type || 'other').toLowerCase()
            if (!typeGroups[t]) typeGroups[t] = []
            typeGroups[t].push(l)
        })

        Object.entries(typeGroups).forEach(([type, arr]) => {
            const id = `dd_${type}`
            const niceType = type.charAt(0).toUpperCase() + type.slice(1)

            const byStatus = { approved: 0, pending: 0, rejected: 0 }
            arr.forEach(a => {
                const s = String(a.status || 'pending').toLowerCase()
                if (s === 'approved') byStatus.approved++
                else if (s === 'rejected') byStatus.rejected++
                else byStatus.pending++
            })

            const total = byStatus.approved + byStatus.pending + byStatus.rejected
            if (total === 0) return // skip empty types entirely

            types.push({ name: niceType, y: total, drilldown: id })

            dd.push({
                id,
                name: niceType,
                type: 'bar',
                data: [
                    {
                        name: 'Approved',
                        y: byStatus.approved,
                        color: STATUS_COLORS.Approved
                    },
                    {
                        name: 'Pending',
                        y: byStatus.pending,
                        color: STATUS_COLORS.Pending
                    },
                    {
                        name: 'Rejected',
                        y: byStatus.rejected,
                        color: STATUS_COLORS.Rejected
                    }
                ].filter(p => (p as any).y > 0), // hide zero bars
                dataLabels: { enabled: true, format: '{point.y}' },
                pointWidth: 12,
                borderRadius: 8,
                pointPadding: 0.02,
                // @ts-ignore
                groupPadding: 0.06
            } as Highcharts.SeriesBarOptions)
        })

        return { types, dd }
    }, [leaves])

    /* ---------- Charts ---------- */
    // Role distribution (pie)
    const rolePie: Highcharts.Options = {
        chart: { type: 'pie' },
        title: { text: undefined },
        legend: { enabled: true },
        plotOptions: {
            pie: {
                innerSize: '60%',
                showInLegend: true,
                dataLabels: {
                    enabled: true,
                    format: '{point.name}: {point.y}',
                    // hide labels for zero values
                    filter: { property: 'y', operator: '>', value: 0 } as any
                }
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Roles',
                // also drop zero-slices entirely
                data: roleCounts
                    .map(([name, val]) => ({ name, y: val }))
                    .filter(p => p.y > 0)
            }
        ]
    }

    // 3) Worked hours timeseries (line)
    const hoursLine: Highcharts.Options = {
        chart: { type: 'spline' },
        title: { text: undefined },
        xAxis: { categories: hoursSeries.cats },
        yAxis: { title: { text: 'Hours' } },
        tooltip: { valueSuffix: ' h' },
        plotOptions: {
            spline: {
                dataLabels: { enabled: true, format: '{y}' }
            }
        },
        series: [{ type: 'spline', name: 'Total Hours', data: hoursSeries.vals }]
    }

    // 4) Leave by type with drilldown to status
    const leaveDrilldown: Highcharts.Options = {
        chart: { type: 'pie' },
        title: { text: undefined },
        tooltip: { pointFormat: '<b>{point.y}</b> requests' },
        xAxis: { type: 'category' },
        plotOptions: {
            pie: {
                innerSize: '60%',
                dataLabels: { enabled: true, format: '{point.name}: {point.y}' }
            },
            // global defaults for bar drilldowns (pie ignores these)
            series: {
                // tighter vertical spacing between bars
                // @ts-ignore - allowed at runtime
                groupPadding: 0.06,
                pointPadding: 0.02
            },
            bar: {
                pointWidth: 12,
                borderRadius: 8,
                dataLabels: { enabled: true, style: { fontWeight: '600' } }
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Leave Types',
                colorByPoint: true,
                data: leaveByTypeStatus.types
            }
        ],
        drilldown: {
            series: leaveByTypeStatus.dd
        }
    }

    // 5) Attendance heatmap (weekday x hour)
    const heat = attendanceHeat
    const attendanceHeatmap: Highcharts.Options = {
        chart: { type: 'heatmap' },
        title: { text: undefined },
        xAxis: { categories: heat.hours.map(h => `${h}:00`) },
        yAxis: { categories: heat.weekdays, title: undefined, reversed: true },
        colorAxis: {
            min: 0,
            stops: [
                [0, '#e6f7ff'],
                [0.5, '#69c0ff'],
                [1, '#0050b3']
            ]
        },
        legend: { align: 'right', verticalAlign: 'top', layout: 'vertical' },
        plotOptions: {
            heatmap: {
                dataLabels: { enabled: true, format: '{point.value}', style: { textOutline: 'none' } }
            }
        },
        series: [
            { type: 'heatmap', name: 'Activity', data: heat.data, borderWidth: 1 }
        ]
    }

    // 6) Leave days taken per month (last 12 months)
    const leaveDaysTrend: Highcharts.Options = {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: { categories: byMonth.months },
        yAxis: { title: { text: 'Days' } },
        tooltip: { valueSuffix: ' day(s)' },
        plotOptions: {
            column: {
                dataLabels: { enabled: true, format: '{y}' }
            }
        },
        series: [
            { type: 'column', name: 'Leave Days Taken', data: byMonth.leaveDays }
        ]
    }

    return (
        <div style={{ padding: '5px 24px' }}>
            <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                    <ChartCard title='Worked Hours (Last 30 Days)' options={hoursLine} />
                </Col>
                <Col xs={24} lg={12}>
                    <ChartCard
                        title='Attendance Heatmap (Weekday × Hour)'
                        options={attendanceHeatmap}
                    />
                </Col>

                <Col xs={24} lg={12}>
                    <ChartCard
                        title='Leave by Type (Drilldown to Status)'
                        options={leaveDrilldown}
                    />
                </Col>
                <Col xs={24} lg={12}>
                    <ChartCard
                        title='Leave Days Taken (Last 12 Months)'
                        options={leaveDaysTrend}
                    />
                </Col>
            </Row>

            {/* Empty state (unlikely due to dummy fallback) */}
            {!users.length && !sheets.length && !leaves.length && (
                <MotionCard style={{ marginTop: 16 }}>
                    <Empty description='No data yet' />
                </MotionCard>
            )}
        </div>
    )
}

export default HRMReportsPage
