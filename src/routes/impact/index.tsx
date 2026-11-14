import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Alert,
    Badge,
    Button,
    Col,
    Drawer,
    Empty,
    Input,
    Radio,
    Row,
    Segmented,
    Space,
    Table,
    Tag,
    Typography,
    message,
    theme
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    ExperimentOutlined,
    FilterOutlined,
    QuestionCircleOutlined,
    ReloadOutlined,
    RiseOutlined,
    TableOutlined,
    TeamOutlined,
    WarningOutlined
} from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import 'highcharts/highcharts-more'
import { MetricTile, MotionCard } from '@/components/dashboards/metrics/Header'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    IMPACT_METRIC_LABEL,
    IMPACT_REFRESH_ROLES,
    formatLift,
    formatPoints,
    formatRange,
    metricOf,
    type ImpactMetric,
    impactForProgramme,
    programmeNames,
    refreshImpact,
    type InterventionImpact
} from '@/services/interventionImpactService'
import {
    IMPACT_STATUS,
    ImpactResultView,
    ImpactStatusTags,
    RangeBar,
    rangeCrossesZero,
    impactPeriod,
    useLiftColour
} from '@/components/interventions/ImpactSummary'

const { Text, Paragraph, Title } = Typography

// Matches the interventionImpact read rule in firestore.rules.
const VIEW_ROLES = new Set(['operations', 'projectadmin', 'director'])

type TabKey = 'working' | 'results' | 'method'
type StatusFilter = 'all' | InterventionImpact['status']

const statusOrder: Record<InterventionImpact['status'], number> = { reportable: 0, early: 1, insufficient: 2 }

const ImpactAnalyticsPage: React.FC = () => {
    const { user } = useFullIdentity()
    const role = String(user?.role || '').toLowerCase()
    const { programId, isAllPrograms } = useActiveProgramId()
    const { token } = theme.useToken()
    const liftColour = useLiftColour()
    const [searchParams, setSearchParams] = useSearchParams()

    const [allRows, setRows] = useState<InterventionImpact[]>([])
    const [names, setNames] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [version, setVersion] = useState(0)
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [search, setSearch] = useState('')
    const [selected, setSelected] = useState<InterventionImpact | null>(null)
    const [filtersOpen, setFiltersOpen] = useState(false)
    const isMobile = useIsMobile()

    const interventionParam = searchParams.get('intervention')
    const metric: ImpactMetric = searchParams.get('measure') === 'jobs' ? 'jobs' : 'revenue'
    const metricLabel = IMPACT_METRIC_LABEL[metric]
    const setMetric = (next: ImpactMetric) => {
        const params = new URLSearchParams(searchParams)
        params.set('measure', next)
        setSearchParams(params, { replace: true })
        setSelected(null)
    }
    const rows = useMemo(() => allRows.filter(row => metricOf(row) === metric), [allRows, metric])
    const tab: TabKey = (searchParams.get('tab') as TabKey) || (interventionParam ? 'results' : 'working')
    const setTab = (next: string) => {
        const params = new URLSearchParams(searchParams)
        params.set('tab', next)
        setSearchParams(params, { replace: true })
    }

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        Promise.all([impactForProgramme(programId), programmeNames().catch(() => ({}))])
            .then(([results, programmeLabels]) => {
                if (cancelled) return
                setRows(results)
                setNames(programmeLabels)
            })
            .catch(error => {
                console.error('Could not load impact results', error)
                if (!cancelled) setRows([])
            })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [programId, version])

    // Arriving from an intervention: show its results, and open it when there is only
    // one. Once per arrival, so switching measure or recalculating doesn't reopen it.
    const autoOpened = useRef<string | null>(null)
    useEffect(() => {
        if (!interventionParam || loading || autoOpened.current === interventionParam) return
        autoOpened.current = interventionParam
        const matches = rows.filter(row => row.interventionId === interventionParam)
        if (matches.length === 1) setSelected(matches[0])
    }, [interventionParam, loading, rows])

    const programmeLabel = (row: InterventionImpact) => names[row.programId] || 'Programme'
    const showProgramme = isAllPrograms && new Set(rows.map(row => row.programId)).size > 1

    const counts = useMemo(() => ({
        reportable: rows.filter(row => row.status === 'reportable').length,
        early: rows.filter(row => row.status === 'early').length,
        insufficient: rows.filter(row => row.status === 'insufficient').length,
        measured: rows.reduce((sum, row) => sum + row.treatedCount, 0)
    }), [rows])

    const working = useMemo(() => rows
        .filter(row => row.status !== 'insufficient' && row.liftPercent !== null)
        .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || (b.liftPercent ?? 0) - (a.liftPercent ?? 0)), [rows])

    const tableRows = useMemo(() => {
        const term = search.trim().toLowerCase()
        return rows
            .filter(row => !interventionParam || row.interventionId === interventionParam)
            .filter(row => statusFilter === 'all' || row.status === statusFilter)
            .filter(row => !term || `${row.interventionTitle} ${programmeLabel(row)}`.toLowerCase().includes(term))
            .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || (b.liftPercent ?? -Infinity) - (a.liftPercent ?? -Infinity))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, statusFilter, search, interventionParam, names])

    const computedAt = allRows.find(row => row.computedAt)?.computedAt
    const canRefresh = IMPACT_REFRESH_ROLES.has(role)

    const onRefresh = async () => {
        setRefreshing(true)
        try {
            const summary = await refreshImpact()
            message.success(`Impact recalculated: ${summary.reportable} reportable, ${summary.early} early signals.`)
            setVersion(value => value + 1)
        } catch (error: any) {
            message.error(error?.message || 'Could not recalculate impact right now.')
        } finally {
            setRefreshing(false)
        }
    }

    const chartOptions = useMemo<Highcharts.Options>(() => {
        const label = (row: InterventionImpact) =>
            showProgramme ? `${row.interventionTitle} · ${programmeLabel(row)}` : row.interventionTitle
        return {
            chart: { type: 'bar', height: Math.max(220, working.length * 44 + 80), backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { enabled: false },
            xAxis: { categories: working.map(label), labels: { style: { fontSize: '12px' } } },
            yAxis: {
                title: { text: metric === 'jobs' ? 'Jobs per SME vs similar SMEs' : 'Revenue growth vs similar SMEs (percentage points)' },
                plotLines: [{ value: 0, width: 1, color: token.colorTextTertiary, zIndex: 3 }]
            },
            tooltip: {
                shared: true,
                formatter: function () {
                    const row = working[(this as any).points?.[0]?.point?.index ?? 0]
                    if (!row) return false
                    return `<b>${row.interventionTitle}</b><br/>` +
                        `${formatLift(row, row.liftPercent)} (likely ${formatRange(row.rangeLowPercent, row.rangeHighPercent)})<br/>` +
                        `${row.treatedCount} SMEs vs ${row.comparisonCount} similar · ${IMPACT_STATUS[row.status].label}` +
                        (row.demo ? '<br/><i>Demo data</i>' : '')
                }
            },
            plotOptions: {
                series: {
                    cursor: 'pointer',
                    point: { events: { click: function () { setSelected(working[(this as any).index] || null) } } }
                }
            },
            series: [
                {
                    type: 'bar',
                    name: 'Difference',
                    data: working.map(row => ({
                        y: row.liftPercent ?? 0,
                        color: rangeCrossesZero(row) ? token.colorTextTertiary : (row.liftPercent ?? 0) >= 0 ? token.colorSuccess : token.colorError,
                        opacity: row.status === 'reportable' ? 1 : 0.55
                    }))
                },
                {
                    type: 'errorbar',
                    name: 'Likely range',
                    data: working.map(row => [row.rangeLowPercent ?? 0, row.rangeHighPercent ?? 0]),
                    color: token.colorText,
                    enableMouseTracking: false
                }
            ]
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [working, names, showProgramme, token, metric])

    // One scale for every bar in view, so a wide range looks wide next to a narrow one.
    const rangeScale = Math.max(
        0,
        ...tableRows
            .filter(row => row.status !== 'insufficient')
            .flatMap(row => [row.rangeLowPercent, row.rangeHighPercent, row.liftPercent].map(value => Math.abs(value ?? 0)))
    )

    const columns: ColumnsType<InterventionImpact> = [
        {
            title: 'Intervention',
            dataIndex: 'interventionTitle',
            width: 380,
            render: (_, row) => (
                <Space direction='vertical' size={2}>
                    <Text strong>{row.interventionTitle}</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {[showProgramme ? programmeLabel(row) : null, impactPeriod(row) ? `Completed ${impactPeriod(row)}` : null]
                            .filter(Boolean)
                            .join(' · ') || 'No completions measured yet'}
                    </Text>
                </Space>
            )
        },
        { title: 'Status', key: 'status', width: 200, render: (_, row) => <ImpactStatusTags result={row} /> },
        {
            title: 'Difference vs similar SMEs',
            key: 'lift',
            sorter: (a, b) => (a.liftPercent ?? -Infinity) - (b.liftPercent ?? -Infinity),
            render: (_, row) => row.status === 'insufficient' ? (
                <Text type='secondary'>Too few SMEs</Text>
            ) : (
                <div>
                    <Space size={8} align='baseline' wrap>
                        <Text strong style={{ color: liftColour(row) }}>{formatLift(row, row.liftPercent)}</Text>
                        {row.rangeLowPercent !== row.rangeHighPercent ? (
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                likely {formatRange(row.rangeLowPercent, row.rangeHighPercent)}
                                {rangeCrossesZero(row) ? ' · could be none' : ''}
                            </Text>
                        ) : null}
                    </Space>
                    <RangeBar result={row} scale={rangeScale} />
                </div>
            )
        },
        {
            title: 'SMEs',
            key: 'smes',
            width: 170,
            align: 'right',
            responsive: ['sm'],
            sorter: (a, b) => a.treatedCount - b.treatedCount,
            render: (_, row) => (
                <Space direction='vertical' size={0} style={{ alignItems: 'flex-end' }}>
                    <Text>{row.treatedCount} vs {row.comparisonCount}</Text>
                    <Text type='secondary' style={{ fontSize: 11, whiteSpace: 'nowrap' }}>completed vs similar</Text>
                </Space>
            )
        }
    ]

    if (user && !VIEW_ROLES.has(role)) {
        return <Alert type='info' showIcon style={{ margin: 24 }} message='Impact Analytics is available to operations, project admins and directors.' />
    }

    const workingTab = !working.length ? (
        <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`No intervention has enough SMEs with ${metric === 'jobs' ? 'staff numbers' : 'revenue'} before and after it yet.`}
        />
    ) : (
        <Row gutter={[16, 16]}>
            <Col xs={24} xl={14}>
                <MotionCard title={metric === 'jobs' ? 'Difference in jobs per SME' : 'Difference in revenue growth'} bordered={false}>
                    <HighchartsReact highcharts={Highcharts} options={chartOptions} />
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        Lines show the likely range. Grey bars could be no difference at all; faded bars are early signals. Select a bar for the details.
                    </Text>
                </MotionCard>
            </Col>
            <Col xs={24} xl={10}>
                <MotionCard title='Reportable results' bordered={false}>
                    {working.filter(row => row.status === 'reportable').length ? (
                        <Space direction='vertical' size={12} style={{ width: '100%' }}>
                            {working.filter(row => row.status === 'reportable').map(row => (
                                <button
                                    key={row.id}
                                    type='button'
                                    onClick={() => setSelected(row)}
                                    style={{
                                        all: 'unset',
                                        cursor: 'pointer',
                                        display: 'block',
                                        padding: '12px 14px',
                                        borderRadius: token.borderRadiusLG,
                                        border: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <Space style={{ width: '100%', justifyContent: 'space-between' }} align='start'>
                                        <Space direction='vertical' size={0}>
                                            <Text strong>{row.interventionTitle}</Text>
                                            {showProgramme ? <Text type='secondary' style={{ fontSize: 12 }}>{programmeLabel(row)}</Text> : null}
                                        </Space>
                                        <Text strong style={{ fontSize: 18, color: liftColour(row), whiteSpace: 'nowrap' }}>
                                            {formatLift(row, row.liftPercent)}
                                        </Text>
                                    </Space>
                                    <Paragraph type='secondary' style={{ margin: '6px 0 0', fontSize: 13 }}>
                                        {row.headline}
                                    </Paragraph>
                                    {row.demo ? <Tag color='purple' style={{ borderRadius: 999, marginTop: 6 }}>Demo data</Tag> : null}
                                </button>
                            ))}
                        </Space>
                    ) : (
                        <Text type='secondary'>
                            Nothing is reportable yet. A result needs at least 10 SMEs who completed the intervention and 10 similar SMEs to compare with.
                        </Text>
                    )}
                </MotionCard>
            </Col>
        </Row>
    )

    const statusOptions: { label: string; value: StatusFilter }[] = [
        { label: 'All', value: 'all' },
        { label: 'Reportable', value: 'reportable' },
        { label: 'Early', value: 'early' },
        { label: 'Not enough data', value: 'insufficient' }
    ]
    const clearInterventionFilter = () => {
        const params = new URLSearchParams(searchParams)
        params.delete('intervention')
        setSearchParams(params, { replace: true })
    }

    const resultCard = (row: InterventionImpact) => (
        <button
            key={row.id}
            type='button'
            onClick={() => setSelected(row)}
            style={{
                all: 'unset',
                boxSizing: 'border-box',
                cursor: 'pointer',
                display: 'block',
                width: '100%',
                padding: '12px 14px',
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                    <Text strong style={{ display: 'block' }}>{row.interventionTitle}</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {[showProgramme ? programmeLabel(row) : null, impactPeriod(row)].filter(Boolean).join(' · ') || 'No completions measured yet'}
                    </Text>
                </div>
                {row.status === 'insufficient' ? null : (
                    <Text strong style={{ fontSize: 16, color: liftColour(row), whiteSpace: 'nowrap' }}>
                        {formatLift(row, row.liftPercent)}
                    </Text>
                )}
            </div>
            {row.status === 'insufficient' ? null : (
                <>
                    <RangeBar result={row} scale={rangeScale} width={9999} />
                    {row.rangeLowPercent !== row.rangeHighPercent ? (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            Likely {formatRange(row.rangeLowPercent, row.rangeHighPercent)}
                            {rangeCrossesZero(row) ? ' · could be none' : ''}
                        </Text>
                    ) : null}
                </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <ImpactStatusTags result={row} />
                <Text type='secondary' style={{ fontSize: 12 }}>{row.treatedCount} completed vs {row.comparisonCount} similar</Text>
            </div>
        </button>
    )

    const mobileResults = (
        <Space direction='vertical' size={12} style={{ width: '100%' }}>
            <div style={{ display: 'flex', gap: 8 }}>
                <Input.Search
                    allowClear
                    placeholder='Search interventions'
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    style={{ flex: 1, minWidth: 0 }}
                />
                <Badge dot={statusFilter !== 'all' || !!interventionParam} offset={[-4, 4]}>
                    <Button icon={<FilterOutlined />} onClick={() => setFiltersOpen(true)}>Filters</Button>
                </Badge>
            </div>
            {tableRows.length ? tableRows.map(resultCard) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No results match.' />
            )}
        </Space>
    )

    const resultsTab = isMobile ? mobileResults : (
        <MotionCard
            bordered={false}
            filterBarProps={{ marginBottom: 16, padding: 14 }}
            filterBar={
                <Row gutter={[12, 12]} align='middle' justify='space-between'>
                    <Col xs={24} md={10}>
                        <Input.Search
                            allowClear
                            placeholder='Search intervention or programme'
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                        />
                    </Col>
                    <Col xs={24} md={14} style={{ textAlign: 'right' }}>
                        <Space wrap style={{ justifyContent: 'flex-end' }}>
                            {interventionParam ? (
                                <Tag closable onClose={clearInterventionFilter} style={{ borderRadius: 999 }}>
                                    One intervention
                                </Tag>
                            ) : null}
                            <Segmented
                                value={statusFilter}
                                onChange={value => setStatusFilter(value as StatusFilter)}
                                options={statusOptions}
                            />
                        </Space>
                    </Col>
                </Row>
            }
        >
            <Table<InterventionImpact>
                rowKey='id'
                columns={columns}
                dataSource={tableRows}
                pagination={{ pageSize: 15, hideOnSinglePage: true }}
                onRow={row => ({ onClick: () => setSelected(row), style: { cursor: 'pointer' } })}
                locale={{ emptyText: 'No results match.' }}
                tableLayout='fixed'
                scroll={{ x: 760 }}
            />
        </MotionCard>
    )

    const methodTab = (
        <MotionCard bordered={false}>
            <Space direction='vertical' size={18} style={{ maxWidth: 760 }}>
                <div>
                    <Title level={5}>What the number means</Title>
                    <Paragraph>
                        For each intervention, we compare how an SME measure changed for SMEs who completed it with how it changed for
                        similar SMEs in the same programme who hadn't had it yet, over the same months. The difference is what the
                        intervention is linked to beyond what the cohort did anyway.
                    </Paragraph>
                </div>
                <div>
                    <Title level={5}>How it's measured</Title>
                    <Paragraph style={{ marginBottom: 0 }}>
                        <ul style={{ paddingLeft: 20, margin: 0 }}>
                            <li>Only completions the SME confirmed count, and each SME counts once, at its first completion.</li>
                            <li><Text strong>Revenue</Text> is measured as percentage growth, and the difference in percentage points, so small and large businesses compare fairly.</li>
                            <li><Text strong>Jobs</Text> are permanent plus temporary staff, measured as jobs added per SME. A percentage would overstate a 3-person team hiring one person.</li>
                            <li>The 3 months before completion are compared with months 3–6 after. At least 2 months are needed on each side.</li>
                            <li>Comparison SMEs are matched on sector and size (revenue or team) where there are enough, then on sector, then on programme.</li>
                            <li>The likely range comes from re-running the comparison 1,000 times on resampled SMEs.</li>
                            <li>Revenue and staff numbers come from the QuantNow sync, or the SME's own monthly figures where QuantNow has none.</li>
                        </ul>
                    </Paragraph>
                </div>
                <div>
                    <Title level={5}>When a result can be used</Title>
                    <Space direction='vertical' size={8}>
                        {(Object.keys(IMPACT_STATUS) as InterventionImpact['status'][]).map(status => (
                            <Space key={status} align='start'>
                                <Tag color={IMPACT_STATUS[status].color} style={{ borderRadius: 999, minWidth: 110, textAlign: 'center' }}>
                                    {IMPACT_STATUS[status].label}
                                </Tag>
                                <Text>
                                    {status === 'reportable'
                                        ? 'At least 10 SMEs on each side. Gets a funder line and shows on the funder dashboard.'
                                        : status === 'early'
                                            ? '5 to 9 SMEs. For staff to watch; not shown to funders.'
                                            : 'Fewer than 5 SMEs with revenue on both sides. No figure is shown.'}
                                </Text>
                            </Space>
                        ))}
                    </Space>
                </div>
                <Alert
                    type='info'
                    showIcon
                    message='A link, not proof'
                    description='SMEs often receive several interventions in the same months. The overlap figure on each result shows how much of the credit is shared. Say "linked to", never "caused".'
                />
            </Space>
        </MotionCard>
    )

    return (
        <div style={{ padding: isMobile ? 16 : 24, minHeight: '100vh' }}>
            <Helmet><title>Impact Analytics | Smart Incubation</title></Helmet>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} lg={6}>
                    <MetricTile compact={isMobile} loading={loading} icon={<RiseOutlined />} tone='success' title='Reportable' value={counts.reportable} subtitle='10+ SMEs each side' />
                </Col>
                <Col xs={12} lg={6}>
                    <MetricTile compact={isMobile} loading={loading} icon={<ExperimentOutlined />} tone='warning' title='Early signals' value={counts.early} subtitle='5 to 9 SMEs' />
                </Col>
                {isMobile ? null : (
                <>
                <Col xs={12} lg={6}>
                    <MetricTile compact={isMobile} loading={loading} icon={<WarningOutlined />} tone='neutral' title='Not enough data' value={counts.insufficient} subtitle='Fewer than 5 SMEs' />
                </Col>
                <Col xs={12} lg={6}>
                    <MetricTile compact={isMobile} loading={loading} icon={<TeamOutlined />} tone='info' title='SMEs measured' value={counts.measured} subtitle={`Completions with ${metric === 'jobs' ? 'staff numbers' : 'revenue'} both sides`} />
                </Col>
                </>
                )}
            </Row>

            {isMobile ? (
                <Space direction='vertical' size={10} style={{ width: '100%', marginBottom: 16 }}>
                    <Segmented
                        block
                        value={tab}
                        onChange={value => setTab(String(value))}
                        options={[
                            { value: 'working', label: 'Working' },
                            { value: 'results', label: 'Results' },
                            { value: 'method', label: 'Method' }
                        ]}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Segmented
                            value={metric}
                            onChange={value => setMetric(value as ImpactMetric)}
                            options={[
                                { label: 'Revenue', value: 'revenue' },
                                { label: 'Jobs', value: 'jobs' }
                            ]}
                        />
                        {computedAt ? (
                            <Text type='secondary' style={{ fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                                Updated {dayjs(computedAt).format('D MMM')}
                            </Text>
                        ) : null}
                        {canRefresh ? (
                            <Button
                                shape='circle'
                                icon={<ReloadOutlined />}
                                loading={refreshing}
                                onClick={onRefresh}
                                aria-label='Recalculate'
                                style={computedAt ? undefined : { marginLeft: 'auto' }}
                            />
                        ) : null}
                    </div>
                </Space>
            ) : (
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 16
                    }}
                >
                    <Segmented
                        value={tab}
                        onChange={value => setTab(String(value))}
                        options={[
                            { value: 'working', label: <span><RiseOutlined /> What's working</span> },
                            { value: 'results', label: <span><TableOutlined /> All results</span> },
                            { value: 'method', label: <span><QuestionCircleOutlined /> How it's measured</span> }
                        ]}
                    />
                    <Space wrap>
                        {computedAt ? <Text type='secondary' style={{ fontSize: 12 }}>Updated {dayjs(computedAt).format('D MMM YYYY')}</Text> : null}
                        <Segmented
                            value={metric}
                            onChange={value => setMetric(value as ImpactMetric)}
                            options={[
                                { label: 'Revenue', value: 'revenue' },
                                { label: 'Jobs', value: 'jobs' }
                            ]}
                        />
                        {canRefresh ? (
                            <Button shape='round' icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
                                Recalculate
                            </Button>
                        ) : null}
                    </Space>
                </div>
            )}

            {loading ? (
                <PageSkeleton variant='list' />
            ) : tab === 'results' ? resultsTab : tab === 'method' ? methodTab : workingTab}

            <Drawer
                className={isMobile ? 'ws-drawer ws-sheet' : undefined}
                placement={isMobile ? 'bottom' : 'right'}
                height={isMobile ? '88vh' : undefined}
                open={!!selected}
                onClose={() => setSelected(null)}
                width={isMobile ? undefined : Math.min(720, typeof window === 'undefined' ? 720 : window.innerWidth)}
                title={selected ? (
                    <Space direction='vertical' size={0}>
                        <span>{selected.interventionTitle} · {IMPACT_METRIC_LABEL[metricOf(selected)].name}</span>
                        <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>{programmeLabel(selected)}</Text>
                    </Space>
                ) : null}
                destroyOnClose
            >
                {selected ? <ImpactResultView result={selected} compact={isMobile} /> : null}
            </Drawer>

            {isMobile ? (
                <Drawer
                    className='ws-drawer ws-sheet'
                    placement='bottom'
                    height='auto'
                    open={filtersOpen}
                    onClose={() => setFiltersOpen(false)}
                    title='Filters'
                >
                    <Space direction='vertical' size={16} style={{ width: '100%' }}>
                        <div>
                            <Text type='secondary' style={{ display: 'block', marginBottom: 8 }}>Status</Text>
                            <Radio.Group
                                value={statusFilter}
                                onChange={event => setStatusFilter(event.target.value)}
                                style={{ width: '100%' }}
                            >
                                <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                    {statusOptions.map(option => (
                                        <Radio key={option.value} value={option.value}>{option.label}</Radio>
                                    ))}
                                </Space>
                            </Radio.Group>
                        </div>
                        {interventionParam ? (
                            <Button block onClick={clearInterventionFilter}>Show every intervention</Button>
                        ) : null}
                        <Button type='primary' block onClick={() => setFiltersOpen(false)}>Done</Button>
                    </Space>
                </Drawer>
            ) : null}
        </div>
    )
}

export default ImpactAnalyticsPage
