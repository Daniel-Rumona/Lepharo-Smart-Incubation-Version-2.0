import React, { useEffect, useMemo, useState } from 'react'
import {
    Layout,
    Row,
    Col,
    Card,
    Space,
    Typography,
    DatePicker,
    Select,
    Button,
    message
} from 'antd'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import {
    collection,
    onSnapshot,
    orderBy,
    query,
    where,
    Timestamp
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'

import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import HCHeatmap from 'highcharts/modules/heatmap'
import HCNoData from 'highcharts/modules/no-data-to-display'
import { DashboardHeaderCard } from '@/components/dashboards/metrics/Header'

if (typeof HCHeatmap === 'function') HCHeatmap(Highcharts)
if (typeof HCNoData === 'function') HCNoData(Highcharts)

// global no-data text
Highcharts.setOptions({
    lang: { noData: 'No data for selected filters' }
})

const { Title, Text } = Typography
const { RangePicker } = DatePicker
const { Option } = Select

type StakeholderType =
    | 'Funder'
    | 'Government'
    | 'Corporate'
    | 'SMME'
    | 'Community'
    | 'Other'
type EngagementMode = 'Online' | 'In-person' | 'Hybrid'

interface Engagement {
    id: string

    title: string
    stakeholder: string
    stakeholderType: StakeholderType
    date: Timestamp
    mode: EngagementMode
    attendees: string[]
    images: string[]
    location?: string | null
    meetingLink?: string | null
    startAt?: Timestamp | null
    endAt?: Timestamp | null
    onlineStartAt?: Timestamp | null
    onlineEndAt?: Timestamp | null
    inPersonStartAt?: Timestamp | null
    inPersonEndAt?: Timestamp | null
}

const STAKEHOLDER_TYPES: StakeholderType[] = [
    'Funder',
    'Government',
    'Corporate',
    'SMME',
    'Community',
    'Other'
]
const MODES: EngagementMode[] = ['Online', 'In-person', 'Hybrid']

const getStartDate = (e: Engagement): Date => {
    const ts = e.startAt || e.onlineStartAt || e.inPersonStartAt || e.date
    const d = ts?.toDate() ?? e.date.toDate()
    const base = dayjs(d)
    return base.hour() === 0 && base.minute() === 0 ? base.hour(9).toDate() : d
}

const bucketDay = (d: Date) => dayjs(d).startOf('day').format('YYYY-MM-DD')

// ---------- tiny helpers for “no data” logic ----------
const sumPairs = (pairs: Array<[number, number]>) =>
    pairs.reduce((s, [, y]) => s + (y || 0), 0)

const sumNumbers = (nums: number[]) => nums.reduce((s, v) => s + (v || 0), 0)

const sumPoints = (pts: Array<{ y: number }>) =>
    pts.reduce((s, p) => s + (p?.y || 0), 0)

const onlyNonZeroPie = <T extends { y: number }>(data: T[]) =>
    data.map(p => ({ ...p })) // keep all points, but we’ll hide labels when y === 0

// A convenience that returns [] if all values are 0, so Highcharts can show the no-data overlay
const emptyIfAllZeroPairs = (pairs: Array<[number, number]>) =>
    sumPairs(pairs) > 0 ? pairs : []

const emptyIfAllZeroNums = (nums: number[]) =>
    sumNumbers(nums) > 0 ? nums : []

const emptyIfAllZeroPie = (pts: Array<{ y: number }>) =>
    sumPoints(pts) > 0 ? pts : []

export const StakeholderEngagementAnalytics: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const [engagements, setEngagements] = useState<Engagement[]>([])

    // Filters
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
        dayjs().startOf('month'),
        dayjs().endOf('month')
    ])
    const [typeFilter, setTypeFilter] = useState<StakeholderType | 'All'>('All')
    const [modeFilter, setModeFilter] = useState<EngagementMode | 'All'>('All')
    const [stakeholderFilter, setStakeholderFilter] = useState<string | 'All'>(
        'All'
    )


    useEffect(() => {
        const qy = query(
            collection(db, 'stakeholderEngagements'),
            orderBy('date', 'desc')
        )
        const unsub = onSnapshot(
            qy,
            snap => {
                const rows = snap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                })) as Engagement[]
                setEngagements(rows)
            },
            err => {
                console.error(err)
                message.error('Failed to load analytics.')
            }
        )
        return () => unsub()
    }, [])

    const allStakeholders = useMemo(() => {
        const s = new Set<string>()
        engagements.forEach(e => e.stakeholder && s.add(e.stakeholder))
        return Array.from(s).sort((a, b) => a.localeCompare(b))
    }, [engagements])

    const filtered = useMemo(() => {
        const [start, end] = dateRange
        return engagements.filter(e => {
            const dt = dayjs(e.date.toDate())
            const inRange =
                (dt.isSame(start, 'day') || dt.isAfter(start, 'day')) &&
                (dt.isSame(end, 'day') || dt.isBefore(end, 'day'))
            const matchType = typeFilter === 'All' || e.stakeholderType === typeFilter
            const matchMode = modeFilter === 'All' || e.mode === modeFilter
            const matchStakeholder =
                stakeholderFilter === 'All' || e.stakeholder === stakeholderFilter
            return inRange && matchType && matchMode && matchStakeholder
        })
    }, [engagements, dateRange, typeFilter, modeFilter, stakeholderFilter])

    // Time series (engagement count per day)
    const engagementsByDayPairs = useMemo(() => {
        const map: Record<string, number> = {}
        filtered.forEach(e => {
            const k = bucketDay(getStartDate(e))
            map[k] = (map[k] || 0) + 1
        })
        const filled: [string, number][] = []
        let cur = dateRange[0].startOf('day')
        while (
            cur.isBefore(dateRange[1].endOf('day')) ||
            cur.isSame(dateRange[1], 'day')
        ) {
            const key = cur.format('YYYY-MM-DD')
            filled.push([key, map[key] || 0])
            cur = cur.add(1, 'day')
        }
        return filled.map(([iso, v]) => [new Date(iso).getTime(), v]) as [
            number,
            number
        ][]
    }, [filtered, dateRange])

    // Attendees over time (sum attendees per day)
    const attendeesByDayPairs = useMemo(() => {
        const map: Record<string, number> = {}
        filtered.forEach(e => {
            const k = bucketDay(getStartDate(e))
            map[k] = (map[k] || 0) + (e.attendees?.length || 0)
        })
        const filled: [string, number][] = []
        let cur = dateRange[0].startOf('day')
        while (
            cur.isBefore(dateRange[1].endOf('day')) ||
            cur.isSame(dateRange[1], 'day')
        ) {
            const key = cur.format('YYYY-MM-DD')
            filled.push([key, map[key] || 0])
            cur = cur.add(1, 'day')
        }
        return filled.map(([iso, v]) => [new Date(iso).getTime(), v]) as [
            number,
            number
        ][]
    }, [filtered, dateRange])

    // Mode split (pie -> donut)
    const modeCounts = useMemo(() => {
        const map: Record<EngagementMode, number> = {
            Online: 0,
            'In-person': 0,
            Hybrid: 0
        }
        filtered.forEach(e => {
            map[e.mode] = (map[e.mode] || 0) + 1
        })
        return MODES.map(m => ({ name: m, y: map[m] || 0 }))
    }, [filtered])

    // By stakeholder type
    const typeCounts = useMemo(() => {
        return STAKEHOLDER_TYPES.map(t => ({
            name: t,
            y: filtered.filter(f => f.stakeholderType === t).length
        }))
    }, [filtered])

    // Top stakeholders (by count)
    const topStakeholders = useMemo(() => {
        const c: Record<string, number> = {}
        filtered.forEach(e => {
            c[e.stakeholder] = (c[e.stakeholder] || 0) + 1
        })
        return Object.entries(c)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
    }, [filtered])

    // Heatmap data: weekday (0=Sun..6=Sat) x hour (0..23)
    const heatmapData = useMemo(() => {
        const counts: number[][] = Array.from({ length: 7 }, () =>
            Array(24).fill(0)
        )
        filtered.forEach(e => {
            const d = getStartDate(e)
            const dow = dayjs(d).day() // 0..6
            const hr = dayjs(d).hour() // 0..23
            counts[dow][hr] += 1
        })
        const points: Array<[number, number, number]> = []
        for (let dow = 0; dow < 7; dow++) {
            for (let hr = 0; hr < 24; hr++) {
                points.push([hr, dow, counts[dow][hr]])
            }
        }
        const total = points.reduce((s, [, , v]) => s + v, 0)
        return total > 0 ? points : []
    }, [filtered])

    // Images over time
    const imagesByDayPairs = useMemo(() => {
        const map: Record<string, number> = {}
        filtered.forEach(e => {
            const k = bucketDay(getStartDate(e))
            map[k] = (map[k] || 0) + (e.images?.length || 0)
        })
        const filled: [string, number][] = []
        let cur = dateRange[0].startOf('day')
        while (
            cur.isBefore(dateRange[1].endOf('day')) ||
            cur.isSame(dateRange[1], 'day')
        ) {
            const key = cur.format('YYYY-MM-DD')
            filled.push([key, map[key] || 0])
            cur = cur.add(1, 'day')
        }
        return filled.map(([iso, v]) => [new Date(iso).getTime(), v]) as [
            number,
            number
        ][]
    }, [filtered, dateRange])

    // Interactions
    const onModeSliceClick = (mode: EngagementMode) => setModeFilter(mode)
    const onStakeholderBarClick = (name: string) => setStakeholderFilter(name)
    const resetFilters = () => {
        setDateRange([dayjs().startOf('month'), dayjs().endOf('month')])
        setTypeFilter('All')
        setModeFilter('All')
        setStakeholderFilter('All')
    }

    // ---------- Chart option snippets with no-data + donut + hidden labels ----------
    const commonNoData = {
        noData: { style: { fontSize: '14px', fontWeight: '500' } }
    }
    const commonCredits = { credits: { enabled: false } }

    const engagementsSeries = emptyIfAllZeroPairs(engagementsByDayPairs)
    const attendeesSeries = emptyIfAllZeroPairs(attendeesByDayPairs)
    const imagesSeries = emptyIfAllZeroPairs(imagesByDayPairs)

    // Pie (donut) data: keep zeros, but hide labels when y===0
    const donutData = emptyIfAllZeroPie(onlyNonZeroPie(modeCounts))

    return (
        <Layout
            style={{ minHeight: '100vh', padding: 24, background: 'transparent' }}
        >
            {/* Header + Filters */}
            <DashboardHeaderCard
                title=' Stakeholder Analytics'
                subtitle='Charts & insights across engagements'
                extraRight={
                    <Button icon={<ReloadOutlined />} onClick={resetFilters}>
                        Reset
                    </Button>
                }
            />

            <Card style={{ marginBottom: 16 }}>
                <Space wrap align='center' style={{ width: '100%' }}>
                    <Space>
                        <FilterOutlined />
                        <Text strong>Filters</Text>
                    </Space>

                    <RangePicker
                        value={dateRange}
                        onChange={v => v && setDateRange(v as [Dayjs, Dayjs])}
                        allowClear={false}
                    />

                    <Select
                        value={typeFilter}
                        onChange={v => setTypeFilter(v as any)}
                        style={{ width: 200 }}
                    >
                        <Option value='All'>All Stakeholder Types</Option>
                        {STAKEHOLDER_TYPES.map(t => (
                            <Option key={t} value={t}>
                                {t}
                            </Option>
                        ))}
                    </Select>

                    <Select
                        value={modeFilter}
                        onChange={v => setModeFilter(v as any)}
                        style={{ width: 180 }}
                    >
                        <Option value='All'>All Modes</Option>
                        {MODES.map(m => (
                            <Option key={m} value={m}>
                                {m}
                            </Option>
                        ))}
                    </Select>

                    <Select
                        showSearch
                        value={stakeholderFilter}
                        onChange={v => setStakeholderFilter(v as any)}
                        style={{ width: 260 }}
                        placeholder='Stakeholder'
                        filterOption={(input, option) =>
                            (String(option?.value) ?? '')
                                .toLowerCase()
                                .includes(input.toLowerCase()) ||
                            (String(option?.children) ?? '')
                                .toLowerCase()
                                .includes(input.toLowerCase())
                        }
                    >
                        <Option value='All'>All Stakeholders</Option>
                        {allStakeholders.map(s => (
                            <Option key={s} value={s}>
                                {s}
                            </Option>
                        ))}
                    </Select>
                </Space>
            </Card>

            {/* Row 1: Time series */}
            <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>
                    <Card>
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={{
                                title: { text: 'Engagements Over Time' },
                                xAxis: { type: 'datetime' },
                                yAxis: { title: { text: 'Engagements' }, allowDecimals: false },
                                legend: { enabled: false },
                                series: engagementsSeries.length
                                    ? [
                                        {
                                            type: 'line',
                                            data: engagementsSeries,
                                            name: 'Engagements'
                                        }
                                    ]
                                    : [],
                                tooltip: { shared: true },
                                ...commonNoData,
                                ...commonCredits
                            }}
                        />
                    </Card>
                </Col>
                <Col xs={24} lg={10}>
                    <Card>
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={{
                                title: { text: 'Attendees Over Time' },
                                xAxis: { type: 'datetime' },
                                yAxis: { title: { text: 'Attendees' }, allowDecimals: false },
                                legend: { enabled: false },
                                series: attendeesSeries.length
                                    ? [{ type: 'area', data: attendeesSeries, name: 'Attendees' }]
                                    : [],
                                tooltip: { shared: true },
                                ...commonNoData,
                                ...commonCredits
                            }}
                        />
                    </Card>
                </Col>
            </Row>

            {/* Row 2: Mode split + By type */}
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={10}>
                    <Card>
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={{
                                chart: { type: 'pie', animation: { duration: 600 } }, // smooth entry
                                title: { text: 'Mode Split' },
                                plotOptions: {
                                    pie: {
                                        innerSize: '60%', // donut
                                        allowPointSelect: true,
                                        cursor: 'pointer',
                                        dataLabels: {
                                            enabled: true,
                                            formatter: function () {
                                                const p = this as any
                                                // Hide label if the slice value is zero
                                                return p.y > 0 ? `${p.point.name}: ${p.y}` : null
                                            }
                                        }
                                    }
                                },
                                series: donutData.length
                                    ? [
                                        {
                                            type: 'pie',
                                            name: 'Engagements',
                                            data: donutData,
                                            point: {
                                                events: {
                                                    click: function () {
                                                        const mode = (this as any).name as EngagementMode
                                                        onModeSliceClick(mode)
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                    : [],
                                tooltip: { pointFormat: '{series.name}: <b>{point.y}</b>' },
                                ...commonNoData,
                                ...commonCredits
                            }}
                        />
                    </Card>
                </Col>
                <Col xs={24} lg={14}>
                    <Card>
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={{
                                chart: { type: 'column' },
                                title: { text: 'By Stakeholder Type' },
                                xAxis: { categories: STAKEHOLDER_TYPES },
                                yAxis: { title: { text: 'Engagements' }, allowDecimals: false },
                                series: emptyIfAllZeroNums(typeCounts.map(t => t.y)).length
                                    ? [
                                        {
                                            type: 'column',
                                            name: 'Engagements',
                                            data: typeCounts.map(t => t.y)
                                        }
                                    ]
                                    : [],
                                tooltip: { shared: true },
                                ...commonNoData,
                                ...commonCredits
                            }}
                        />
                    </Card>
                </Col>
            </Row>

            {/* Row 3: Top stakeholders + Heatmap */}
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={12}>
                    <Card>
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={{
                                chart: { type: 'bar' },
                                title: { text: 'Top Stakeholders' },
                                xAxis: {
                                    categories: topStakeholders.length
                                        ? topStakeholders.map(([n]) => n)
                                        : [],
                                    title: { text: '' }
                                },
                                yAxis: { title: { text: 'Engagements' }, allowDecimals: false },
                                series: topStakeholders.length
                                    ? [
                                        {
                                            type: 'bar',
                                            name: 'Engagements',
                                            data: topStakeholders.map(([, v]) => v),
                                            point: {
                                                events: {
                                                    click: function () {
                                                        const name = (this as any).category as string
                                                        onStakeholderBarClick(name)
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                    : [],
                                ...commonNoData,
                                ...commonCredits
                            }}
                        />
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card>
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={{
                                chart: { type: 'heatmap' },
                                title: { text: 'Engagement Density (Weekday × Hour)' },
                                xAxis: {
                                    title: { text: 'Hour of Day' },
                                    categories: Array.from({ length: 24 }, (_, i) => String(i))
                                },
                                yAxis: {
                                    title: { text: 'Day of Week' },
                                    categories: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
                                    reversed: true
                                },
                                colorAxis: { min: 0, minColor: '#FFFFFF', maxColor: '#1890ff' },
                                series: heatmapData.length
                                    ? [
                                        {
                                            type: 'heatmap',
                                            data: heatmapData,
                                            borderWidth: 0,
                                            tooltip: {
                                                pointFormatter: function () {
                                                    const p = this as any
                                                    const day = [
                                                        'Sun',
                                                        'Mon',
                                                        'Tue',
                                                        'Wed',
                                                        'Thu',
                                                        'Fri',
                                                        'Sat'
                                                    ][p.y]
                                                    return `<b>${p.value}</b> engagements<br/>${day} @ ${p.x}:00`
                                                }
                                            }
                                        }
                                    ]
                                    : [],
                                ...commonNoData,
                                ...commonCredits
                            }}
                        />
                    </Card>
                </Col>
            </Row>

            {/* Row 4: Images over time */}
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col span={24}>
                    <Card>
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={{
                                title: { text: 'Images Over Time' },
                                xAxis: { type: 'datetime' },
                                yAxis: { title: { text: 'Images' }, allowDecimals: false },
                                legend: { enabled: false },
                                series: imagesSeries.length
                                    ? [{ type: 'column', data: imagesSeries, name: 'Images' }]
                                    : [],
                                tooltip: { shared: true },
                                ...commonNoData,
                                ...commonCredits
                            }}
                        />
                    </Card>
                </Col>
            </Row>
        </Layout>
    )
}

export default StakeholderEngagementAnalytics
