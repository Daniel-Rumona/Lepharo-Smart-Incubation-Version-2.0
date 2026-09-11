import React, { useEffect, useMemo, useState } from 'react'
import {
    Layout,
    Row,
    Col,
    Card,
    Statistic,
    Space,
    Typography,
    DatePicker,
    Select,
    Button,
    Divider,
    Empty,
    message
} from 'antd'
import {
    PlusOutlined,
    LineChartOutlined,
    TableOutlined,
    ProjectOutlined,
    UsergroupAddOutlined,
    TeamOutlined,
    PictureOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
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
import { DashboardHeaderCard, MotionCard } from '../metrics/Header'

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
    images: string[]
    attendees: string[]
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

const bucketByDay = (d: Date) => dayjs(d).startOf('day').format('YYYY-MM-DD')

const groupCount = <T extends string>(arr: T[]) =>
    arr.reduce<Record<T, number>>((acc, k) => {
        acc[k] = (acc[k] || 0) + 1
        return acc
    }, {} as Record<T, number>)

const ensureSeriesDates = (
    counts: Record<string, number>,
    start: Dayjs,
    end: Dayjs
) => {
    const map: Record<string, number> = { ...counts }
    let cursor = start.startOf('day')
    while (cursor.isBefore(end.endOf('day')) || cursor.isSame(end, 'day')) {
        const key = cursor.format('YYYY-MM-DD')
        if (!(key in map)) map[key] = 0
        cursor = cursor.add(1, 'day')
    }
    return Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1))
}

const toHighchartsSeries = (pairs: [string, number][]) =>
    pairs.map(([iso, v]) => [new Date(iso).getTime(), v]) as [number, number][]

export const StakeholderEngagementDashboard: React.FC = () => {
    const navigate = useNavigate()
    const { user, loading: identityLoading } = useFullIdentity()

    const [engagements, setEngagements] = useState<Engagement[]>([])
    const [loading, setLoading] = useState<boolean>(true)

    // Filters
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
        dayjs().startOf('month'),
        dayjs().endOf('month')
    ])
    const [typeFilter, setTypeFilter] = useState<StakeholderType | 'All'>('All')
    const [modeFilter, setModeFilter] = useState<EngagementMode | 'All'>('All')


    useEffect(() => {

        setLoading(true)
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
                setLoading(false)
            },
            err => {
                console.error(err)
                message.error('Failed to load dashboard data.')
                setLoading(false)
            }
        )
        return () => unsub()
    }, [])

    // Apply filters
    const filtered = useMemo(() => {
        const [start, end] = dateRange
        return engagements.filter(e => {
            const dt = dayjs(e.date.toDate())
            const inRange =
                dt.isSame(start, 'day') ||
                dt.isSame(end, 'day') ||
                (dt.isAfter(start) && dt.isBefore(end))
            const matchType = typeFilter === 'All' || e.stakeholderType === typeFilter
            const matchMode = modeFilter === 'All' || e.mode === modeFilter
            return inRange && matchType && matchMode
        })
    }, [engagements, dateRange, typeFilter, modeFilter])

    // KPIs
    const kpis = useMemo(() => {
        const total = filtered.length
        const uniqueStakeholders = new Set(filtered.map(f => f.stakeholder)).size
        const totalAttendees = filtered.reduce(
            (acc, f) => acc + (f.attendees?.length || 0),
            0
        )
        const totalImages = filtered.reduce(
            (acc, f) => acc + (f.images?.length || 0),
            0
        )
        return { total, uniqueStakeholders, totalAttendees, totalImages }
    }, [filtered])

    // Chart 1: engagements over time (by day)
    const timeSeriesPairs = useMemo(() => {
        const counts: Record<string, number> = {}
        filtered.forEach(e => {
            const k = bucketByDay(e.date.toDate())
            counts[k] = (counts[k] || 0) + 1
        })
        return ensureSeriesDates(counts, dateRange[0], dateRange[1])
    }, [filtered, dateRange])

    const hcEngagementsOverTime: Highcharts.Options = useMemo(
        () => ({
            title: { text: 'Engagements Over Time' },
            xAxis: { type: 'datetime' },
            yAxis: { title: { text: 'Engagements' }, allowDecimals: false },
            legend: { enabled: false },
            tooltip: { shared: true },
            series: [
                {
                    type: 'line',
                    name: 'Engagements',
                    data: toHighchartsSeries(timeSeriesPairs)
                }
            ],
            credits: { enabled: false }
        }),
        [timeSeriesPairs]
    )

    // Chart 2: mode split (pie)
    const modeCounts = useMemo(() => {
        const counts = groupCount(filtered.map(f => f.mode))
        return MODES.map(m => ({ name: m, y: counts[m] || 0 }))
    }, [filtered])

    const hcModeSplit: Highcharts.Options = useMemo(
        () => ({
            title: { text: 'Mode Split' },
            chart: { type: 'pie' },
            tooltip: { pointFormat: '{series.name}: <b>{point.y}</b>' },
            series: [
                {
                    type: 'pie',
                    name: 'Engagements',
                    data: modeCounts
                }
            ],
            credits: { enabled: false }
        }),
        [modeCounts]
    )

    // Chart 3: top stakeholders (bar)
    const topStakeholders = useMemo(() => {
        const counts = groupCount(filtered.map(f => f.stakeholder))
        const entries = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
        return {
            categories: entries.map(([name]) => name),
            values: entries.map(([, v]) => v)
        }
    }, [filtered])

    const hcTopStakeholders: Highcharts.Options = useMemo(
        () => ({
            title: { text: 'Top Stakeholders' },
            xAxis: { categories: topStakeholders.categories, title: { text: '' } },
            yAxis: { title: { text: 'Engagements' }, allowDecimals: false },
            series: [
                {
                    type: 'bar',
                    name: 'Engagements',
                    data: topStakeholders.values
                }
            ],
            credits: { enabled: false }
        }),
        [topStakeholders]
    )

    // Chart 4: engagements by stakeholder type (column)
    const typeCounts = useMemo(() => {
        const counts = groupCount(filtered.map(f => f.stakeholderType))
        return STAKEHOLDER_TYPES.map(t => counts[t] || 0)
    }, [filtered])

    const hcByType: Highcharts.Options = useMemo(
        () => ({
            title: { text: 'By Stakeholder Type' },
            xAxis: { categories: STAKEHOLDER_TYPES },
            yAxis: { title: { text: 'Engagements' }, allowDecimals: false },
            series: [
                {
                    type: 'column',
                    name: 'Engagements',
                    data: typeCounts
                }
            ],
            credits: { enabled: false }
        }),
        [typeCounts]
    )

    return (
        <Layout
            style={{ minHeight: '100vh', padding: 24, background: 'transparent' }}
        >
            <DashboardHeaderCard
                title=' Stakeholder Engagement Dashboard'
                subtitle='KPI overview, trends and breakdowns'
                extraRight={
                    <Space wrap>
                        <Button
                            icon={<TableOutlined />}
                            onClick={() => navigate('/stakeholders/engagements')}
                        >
                            Open Engagement Log
                        </Button>
                        <Button
                            type='primary'
                            icon={<PlusOutlined />}
                            onClick={() => navigate('/stakeholders/engagements?create=1')}
                        >
                            New Engagement
                        </Button>
                    </Space>
                }
            />

            {/* Filters */}
            <MotionCard style={{ marginBottom: 16 }}>
                <Row gutter={[12, 12]} align='middle'>
                    <Col>
                        <Space>
                            <LineChartOutlined />
                            <Text strong>Filters</Text>
                        </Space>
                    </Col>
                    <Col>
                        <RangePicker
                            value={dateRange}
                            onChange={v => v && setDateRange(v as [Dayjs, Dayjs])}
                            allowClear={false}
                        />
                    </Col>
                    <Col>
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
                    </Col>
                    <Col>
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
                    </Col>
                </Row>
            </MotionCard>

            {/* KPIs */}

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Statistic
                            title='Engagements'
                            value={kpis.total}
                            loading={loading}
                            prefix={
                                <ProjectOutlined style={{ color: '#1890ff', fontSize: 20 }} />
                            }
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Statistic
                            title='Unique Stakeholders'
                            value={kpis.uniqueStakeholders}
                            loading={loading}
                            prefix={
                                <UsergroupAddOutlined
                                    style={{ color: '#52c41a', fontSize: 20 }}
                                />
                            }
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Statistic
                            title='Total Attendees'
                            value={kpis.totalAttendees}
                            loading={loading}
                            prefix={
                                <TeamOutlined style={{ color: '#faad14', fontSize: 20 }} />
                            }
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Statistic
                            title='Images Uploaded'
                            value={kpis.totalImages}
                            loading={loading}
                            prefix={
                                <PictureOutlined style={{ color: '#eb2f96', fontSize: 20 }} />
                            }
                        />
                    </MotionCard>
                </Col>
            </Row>

            {filtered.length === 0 ? (
                <MotionCard>
                    <Empty description='No data in the selected range/filters' />
                </MotionCard>
            ) : (
                <>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={14}>
                            <MotionCard>
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={hcEngagementsOverTime}
                                />
                            </MotionCard>
                        </Col>
                        <Col xs={24} lg={10}>
                            <MotionCard>
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={hcModeSplit}
                                />
                            </MotionCard>
                        </Col>
                    </Row>

                    <Divider />

                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={12}>
                            <MotionCard>
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={hcTopStakeholders}
                                />
                            </MotionCard>
                        </Col>
                        <Col xs={24} lg={12}>
                            <MotionCard>
                                <HighchartsReact highcharts={Highcharts} options={hcByType} />
                            </MotionCard>
                        </Col>
                    </Row>
                </>
            )}
        </Layout>
    )
}

export default StakeholderEngagementDashboard
