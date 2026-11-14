import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Avatar,
    Badge,
    Button,
    Card,
    Col,
    DatePicker,
    Drawer,
    Dropdown,
    Empty,
    Input,
    Modal,
    Popover,
    Progress,
    Row,
    Segmented,
    Select,
    Skeleton,
    Typography,
    message,
    theme
} from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import {
    BarChartOutlined,
    ClockCircleOutlined,
    EditOutlined,
    EllipsisOutlined,
    ExportOutlined,
    EyeOutlined,
    FilterOutlined,
    InboxOutlined,
    PlusOutlined,
    RiseOutlined,
    SearchOutlined,
    StarOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { Helmet } from 'react-helmet'
import { Inquiry, InquiryPriority, PRIORITY_COLORS, STATUS_COLORS } from '@/types/inquiry'
import { inquiryService } from '@/services/inquiryService'
import { followUpService, type FollowUp } from '@/services/followUpService'
import {
    ALL_CHANNELS,
    channelLabel,
    resolveInquiryAudience,
    resolveInquiryChannel,
    type InquiryChannel
} from '@/utils/inquirySource'
import {
    CONTACT_TYPE_LABEL,
    INQUIRY_CONTACT_TYPES,
    inquiryContactType,
    isVisitPurpose,
    VISIT_PURPOSE_LABEL,
    type InquiryContactType,
    type VisitPurpose
} from '@/lib/inquiryContactTypes'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { useAuth } from '@/hooks/useAuth'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useDataColor } from '@/lib/chartColors'
import { followUpStateByInquiry, inquiryInTab, OPEN_STATUSES, type InquiryTab } from '@/lib/inquiryList'
import { AdminKpiTile, AdminMiniBars, AdminShareRing, type AdminKpiTrend } from '@/components/admin/AdminKpiTile'
import InquiryForm from '@/components/receptionist/InquiryForm'
import InquiryEditModal from '@/components/receptionist/InquiryEditModal'
import InquiryDetail from '@/components/receptionist/InquiryDetail'
import '@/styles/admin-overview.css'
import '@/styles/receptionist-dashboard.css'

/*
 * The branch's inquiries for reception: tiles, one toolbar (tabs, search,
 * filters, new inquiry) and a compact list. Each row says where its follow-up
 * stands, so this list and the follow-ups worklist tell the same story.
 */

const { RangePicker } = DatePicker
const { Text } = Typography

type RangeValue = [Dayjs | null, Dayjs | null] | null

const PAGE = 20
const PRIORITIES: InquiryPriority[] = ['Urgent', 'High', 'Medium', 'Low']

const TAB_LABEL: Record<InquiryTab, string> = { open: 'Open', new: 'New', closed: 'Closed', all: 'All' }
const TABS: InquiryTab[] = ['open', 'new', 'closed', 'all']

/** SME, potential incubatee, funder, stakeholder or visitor; 'unknown' for older inquiries that never recorded it. */
const contactTypeOf = (inquiry: Inquiry): InquiryContactType | 'unknown' =>
    inquiryContactType(inquiry as any, resolveInquiryAudience(inquiry) === 'Incubatee') || 'unknown'
const contactTypeLabel = (type: InquiryContactType | 'unknown') => (type === 'unknown' ? 'Not recorded' : CONTACT_TYPE_LABEL[type])

const departmentOf = (inquiry: Inquiry) => String(inquiry.inquiryDetails?.department || '').trim()

const initials = (inquiry: Inquiry) =>
    `${inquiry.contactInfo?.firstName?.charAt(0) || ''}${inquiry.contactInfo?.lastName?.charAt(0) || ''}`.toUpperCase() || '?'

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value?.toDate === 'function') return value.toDate()
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Monday-based weeks, as the rest of the receptionist pages use. */
const monday = (day: Dayjs) => day.subtract((day.day() + 6) % 7, 'day').startOf('day')

const trendOf = (current: number, previous: number, label: string): AdminKpiTrend | undefined => {
    const change = current - previous
    if (change === 0) return undefined
    const percent = previous ? Math.round((Math.abs(change) / previous) * 100) : undefined
    return {
        amount: percent !== undefined ? `${percent}%` : String(Math.abs(change)),
        direction: change > 0 ? 'up' : 'down',
        tone: change > 0 ? 'good' : 'bad',
        text: `${change > 0 ? '+' : ''}${change} vs ${label}`
    }
}

const InquiriesList: React.FC = () => {
    const { user, loading: userLoading } = useAuth()
    const { activeProgramId } = useActiveProgramId()
    const branchId = String(user?.assignedBranch || '')

    const [inquiries, setInquiries] = useState<Inquiry[]>([])
    const [followUps, setFollowUps] = useState<FollowUp[]>([])
    const [loading, setLoading] = useState(true)

    const [tab, setTab] = useState<InquiryTab>('open')
    const [search, setSearch] = useState('')
    const [priority, setPriority] = useState<InquiryPriority | 'all'>('all')
    const [source, setSource] = useState<InquiryChannel | 'all'>('all')
    const [audience, setAudience] = useState<InquiryContactType | 'unknown' | 'all'>('all')
    const [department, setDepartment] = useState<string>('all')
    const [range, setRange] = useState<RangeValue>(null)
    const [shown, setShown] = useState(PAGE)

    const [newOpen, setNewOpen] = useState(false)
    const [newFooter, setNewFooter] = useState<HTMLDivElement | null>(null)
    const [analyticsOpen, setAnalyticsOpen] = useState(false)
    const [viewId, setViewId] = useState<string | null>(null)
    const [editId, setEditId] = useState<string | null>(null)

    const load = useCallback(async () => {
        if (!branchId) return setLoading(false)
        setLoading(true)
        try {
            const [rows, fus] = await Promise.all([
                inquiryService.getInquiriesByBranch(branchId),
                followUpService.getFollowUpsByBranch(branchId).catch(() => [] as FollowUp[])
            ])
            // General (non-incubatee) inquiries have no programme and show under every programme.
            setInquiries(activeProgramId ? rows.filter(i => !i.programId || i.programId === activeProgramId) : rows)
            setFollowUps(fus)
        } catch (error) {
            console.error('Error loading inquiries:', error)
            message.error('Could not load inquiries.')
        } finally {
            setLoading(false)
        }
    }, [branchId, activeProgramId])

    useEffect(() => {
        if (!userLoading) load()
    }, [load, userLoading])

    const now = new Date()
    const followUpState = useMemo(() => followUpStateByInquiry(followUps, now), [followUps]) // eslint-disable-line react-hooks/exhaustive-deps

    const departments = useMemo(
        () => [...new Set(inquiries.map(departmentOf).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
        [inquiries]
    )

    // Everything but the tab: the tabs' counts and the analytics use this set.
    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase()
        const from = range?.[0]?.startOf('day').toDate()
        const to = range?.[1]?.endOf('day').toDate()
        return inquiries.filter(i => {
            if (priority !== 'all' && i.priority !== priority) return false
            if (source !== 'all' && resolveInquiryChannel(i.source) !== source) return false
            if (audience !== 'all' && contactTypeOf(i) !== audience) return false
            if (department !== 'all' && departmentOf(i) !== department) return false
            const at = toDate(i.submittedAt)
            if (from && to && (!at || at < from || at > to)) return false
            if (!needle) return true
            return [
                // The full name too, so "Thabo Mokoena" finds Thabo Mokoena.
                `${i.contactInfo?.firstName || ''} ${i.contactInfo?.lastName || ''}`,
                i.contactInfo?.email,
                i.contactInfo?.phone,
                i.contactInfo?.company,
                i.inquiryDetails?.description,
                i.inquiryDetails?.inquiryType,
                departmentOf(i)
            ].some(value => String(value || '').toLowerCase().includes(needle))
        })
    }, [inquiries, search, priority, source, audience, department, range])

    const tabCounts = useMemo(
        () => Object.fromEntries(TABS.map(t => [t, filtered.filter(i => inquiryInTab(i.status, t)).length])) as Record<InquiryTab, number>,
        [filtered]
    )
    const visible = useMemo(() => filtered.filter(i => inquiryInTab(i.status, tab)), [filtered, tab])

    // Open on Open; if nothing is open, on All rather than an empty list. Once a tab is picked, it stays.
    const [tabChosen, setTabChosen] = useState(false)
    useEffect(() => {
        if (!tabChosen && !loading) setTab(tabCounts.open ? 'open' : 'all')
    }, [tabChosen, loading, tabCounts.open])

    useEffect(() => setShown(PAGE), [tab, search, priority, source, audience, department, range])

    // ---- Tiles: the branch's inquiries in this programme, before any filter ----
    const figures = useMemo(() => {
        const today = dayjs().startOf('day')
        const tomorrow = today.add(1, 'day')
        const monthStart = today.startOf('month')
        const lastMonthStart = monthStart.subtract(1, 'month')
        const elapsed = tomorrow.diff(monthStart, 'day')
        const lastMonthSameDays = lastMonthStart.add(Math.min(elapsed, lastMonthStart.daysInMonth()), 'day')
        const between = (from: Dayjs, to: Dayjs) =>
            inquiries.filter(i => {
                const at = dayjs(toDate(i.submittedAt))
                return !at.isBefore(from) && at.isBefore(to)
            }).length
        const monthBars = Array.from({ length: 6 }, (_, k) => {
            const start = monthStart.subtract(5 - k, 'month')
            return { key: start.valueOf(), label: start.format('MMM'), value: between(start, k === 5 ? tomorrow : start.add(1, 'month')) }
        })
        const open = inquiries.filter(i => inquiryInTab(i.status, 'open')).length
        return {
            total: inquiries.length,
            newCount: inquiries.filter(i => i.status === 'New').length,
            open,
            month: between(monthStart, tomorrow),
            lastMonth: between(lastMonthStart, lastMonthSameDays),
            monthBars,
            converted: inquiries.filter(i => i.status === 'Converted').length
        }
    }, [inquiries])

    // ---- Filters ----
    const activeFilters =
        (priority !== 'all' ? 1 : 0) +
        (source !== 'all' ? 1 : 0) +
        (audience !== 'all' ? 1 : 0) +
        (department !== 'all' ? 1 : 0) +
        (range?.[0] && range?.[1] ? 1 : 0)

    const clearFilters = () => {
        setPriority('all')
        setSource('all')
        setAudience('all')
        setDepartment('all')
        setRange(null)
    }

    const filterPanel = (
        <div className='usage-filter-popover'>
            <Select
                className='usage-filter-select'
                value={priority}
                onChange={setPriority}
                options={[{ value: 'all', label: 'All priorities' }, ...PRIORITIES.map(p => ({ value: p, label: p }))]}
            />
            <Select
                className='usage-filter-select'
                value={source}
                onChange={setSource}
                options={[{ value: 'all', label: 'All sources' }, ...ALL_CHANNELS.map(o => ({ value: o.value, label: channelLabel(o.value) }))]}
            />
            <Select
                className='usage-filter-select'
                value={audience}
                onChange={setAudience}
                options={[
                    { value: 'all', label: 'All contact types' },
                    ...INQUIRY_CONTACT_TYPES.map(type => ({ value: type, label: CONTACT_TYPE_LABEL[type] })),
                    { value: 'unknown', label: 'Not recorded' }
                ]}
            />
            <Select
                className='usage-filter-select'
                value={department}
                onChange={setDepartment}
                showSearch
                optionFilterProp='label'
                options={[{ value: 'all', label: 'All departments' }, ...departments.map(d => ({ value: d, label: d }))]}
            />
            <RangePicker
                value={range}
                onChange={value => setRange(value as RangeValue)}
                style={{ width: '100%' }}
                placeholder={['Received from', 'to']}
                presets={[
                    { label: 'This week', value: [monday(dayjs()), dayjs()] },
                    { label: 'This month', value: [dayjs().startOf('month'), dayjs()] },
                    { label: 'Last 30 days', value: [dayjs().subtract(29, 'day'), dayjs()] }
                ]}
            />
            {activeFilters > 0 && (
                <Button type='link' onClick={clearFilters}>
                    Clear filters
                </Button>
            )}
        </div>
    )

    // ---- Analytics: what the current filters show ----
    const breakdown = (keyOf: (i: Inquiry) => string) => {
        const counts = new Map<string, number>()
        filtered.forEach(i => counts.set(keyOf(i), (counts.get(keyOf(i)) || 0) + 1))
        return [...counts.entries()]
            .map(([key, count]) => ({ key, count, percent: filtered.length ? Math.round((count / filtered.length) * 100) : 0 }))
            .sort((a, b) => b.count - a.count)
    }
    const byDepartment = useMemo(() => breakdown(i => departmentOf(i) || 'No department'), [filtered]) // eslint-disable-line react-hooks/exhaustive-deps
    const bySource = useMemo(() => breakdown(i => channelLabel(resolveInquiryChannel(i.source))), [filtered]) // eslint-disable-line react-hooks/exhaustive-deps
    const byAudience = useMemo(() => breakdown(i => contactTypeLabel(contactTypeOf(i))), [filtered]) // eslint-disable-line react-hooks/exhaustive-deps

    // Six months of the filtered inquiries, and the share of each contact type.
    const { token } = theme.useToken()
    const analytics = useMemo(() => {
        const start = dayjs().startOf('month').subtract(5, 'month')
        const months = Array.from({ length: 6 }, (_, k) => start.add(k, 'month'))
        const perMonth = months.map(m =>
            filtered.filter(i => {
                const at = toDate(i.submittedAt)
                return at && dayjs(at).isSame(m, 'month')
            }).length
        )
        const open = filtered.filter(i => inquiryInTab(i.status, 'open')).length
        const converted = filtered.filter(i => i.status === 'Converted').length
        return {
            months: months.map(m => m.format('MMM')),
            perMonth,
            open,
            converted,
            convertedShare: filtered.length ? Math.round((converted / filtered.length) * 100) : 0,
            topDepartment: byDepartment.find(d => d.key !== 'No department')?.key || '—'
        }
    }, [filtered, byDepartment])

    // Data colours, not the accent: under a red accent a count must not look like bad news (lib/chartColors).
    const DATA = useDataColor()
    const TYPE_COLORS = [DATA, '#0d9488', '#7c3aed', '#d97706', '#0891b2', '#94a3b8']

    // No chart menu (the "hamburger"): these charts are read here, not exported.
    const trendChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'areaspline', height: 220, spacing: [8, 4, 4, 4], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            legend: { enabled: false },
            xAxis: { categories: analytics.months, lineWidth: 0, tickLength: 0 },
            yAxis: { title: { text: undefined }, allowDecimals: false, gridLineDashStyle: 'Dash' },
            tooltip: { pointFormat: '<b>{point.y}</b> inquiries' },
            plotOptions: { areaspline: { marker: { radius: 3, symbol: 'circle' }, lineWidth: 2.5 } },
            series: [
                {
                    type: 'areaspline',
                    name: 'Inquiries',
                    data: analytics.perMonth,
                    color: DATA,
                    fillColor: {
                        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                        stops: [
                            [0, Highcharts.color(DATA).setOpacity(0.3).get('rgba') as string],
                            [1, Highcharts.color(DATA).setOpacity(0).get('rgba') as string]
                        ]
                    }
                }
            ]
        }),
        [analytics, DATA]
    )

    const typeChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'pie', height: 200, spacing: [0, 0, 0, 0], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
            plotOptions: { pie: { innerSize: '72%', borderWidth: 3, borderColor: token.colorBgElevated, borderRadius: 6, dataLabels: { enabled: false } } },
            series: [
                {
                    type: 'pie',
                    name: 'Inquiries',
                    data: byAudience.map((row, k) => ({ name: row.key, y: row.count, color: TYPE_COLORS[k % TYPE_COLORS.length] }))
                }
            ]
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [byAudience, DATA, token.colorBgElevated]
    )

    // ---- Rendering ----

    if (userLoading) return <Skeleton active style={{ padding: 24 }} />

    if (!branchId) {
        return (
            <div className='admin-overview rcp-dashboard'>
                <Card className='admin-card' bordered={false}>
                    <Empty description='You need to be assigned to a branch to see its inquiries.' />
                </Card>
            </div>
        )
    }

    const renderRow = (inquiry: Inquiry) => {
        const name = `${inquiry.contactInfo?.firstName || ''} ${inquiry.contactInfo?.lastName || ''}`.trim() || 'Unnamed contact'
        const received = toDate(inquiry.submittedAt)
        const followUp = followUpState.get(inquiry.id)
        const type = contactTypeOf(inquiry)
        return (
            <li key={inquiry.id} className='rcp-inq-row'>
                <button type='button' className='rcp-inquiry-main' onClick={() => setViewId(inquiry.id)} aria-label={`Open the inquiry from ${name}`}>
                    <Avatar size={38} className='rcp-inquiry-avatar'>
                        {initials(inquiry)}
                    </Avatar>
                    <span className='rcp-inquiry-copy'>
                        <span className='rcp-inquiry-top'>
                            <strong>
                                {name}
                                {inquiry.isRepresentative && <span className='rcp-inq-rep'>Representative</span>}
                            </strong>
                            <time title={received ? dayjs(received).format('D MMM YYYY, HH:mm') : undefined}>
                                {received ? (dayjs(received).isSame(dayjs(), 'year') ? dayjs(received).format('D MMM') : dayjs(received).format('D MMM YYYY')) : '—'}
                            </time>
                        </span>
                        <span className='rcp-inquiry-detail'>
                            {[departmentOf(inquiry), inquiry.inquiryDetails?.inquiryType, inquiry.contactInfo?.company].filter(Boolean).join(' · ') || 'Inquiry'}
                        </span>
                        {inquiry.inquiryDetails?.description && <span className='rcp-inq-desc'>{inquiry.inquiryDetails.description}</span>}
                        <span className='rcp-inquiry-meta'>
                            <span className='rcp-pill' style={{ ['--pill' as any]: STATUS_COLORS[inquiry.status as keyof typeof STATUS_COLORS] || '#8c8c8c' }}>
                                {inquiry.status}
                            </span>
                            <span className='rcp-pill' style={{ ['--pill' as any]: PRIORITY_COLORS[inquiry.priority] || '#8c8c8c' }}>
                                {inquiry.priority}
                            </span>
                            <span className='rcp-inquiry-channel'>
                                {channelLabel(resolveInquiryChannel(inquiry.source))}
                                {type !== 'unknown' ? ` · ${CONTACT_TYPE_LABEL[type]}` : ''}
                                {isVisitPurpose((inquiry as any).visitPurpose) && (inquiry as any).visitPurpose !== 'inquiry'
                                    ? ` · ${VISIT_PURPOSE_LABEL[(inquiry as any).visitPurpose as VisitPurpose]}`
                                    : ''}
                            </span>
                            {followUp && (
                                <span className={`rcp-inq-fu is-${followUp.tone}`}>
                                    {followUp.tone === 'escalated' ? <ExportOutlined /> : <ClockCircleOutlined />} {followUp.label}
                                </span>
                            )}
                        </span>
                    </span>
                </button>
                <Dropdown
                    trigger={['click']}
                    menu={{
                        items: [
                            { key: 'view', label: 'Open', icon: <EyeOutlined /> },
                            { key: 'edit', label: 'Edit', icon: <EditOutlined /> }
                        ],
                        onClick: ({ key }) => (key === 'edit' ? setEditId(inquiry.id) : setViewId(inquiry.id))
                    }}
                >
                    <Button type='text' size='small' icon={<EllipsisOutlined />} aria-label={`More actions for ${name}`} />
                </Dropdown>
            </li>
        )
    }

    const filtersOn = activeFilters > 0 || search.trim()

    return (
        <div className='admin-overview rcp-dashboard' style={{ ['--rcp-data' as any]: DATA }}>
            <Helmet>
                <title>Inquiries | Smart Incubation</title>
            </Helmet>

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<StarOutlined />}
                        label='New'
                        value={figures.newCount}
                        visual={
                            <span title={`${figures.newCount} of ${figures.open} open inquiries are still waiting for a first reply`}>
                                <AdminShareRing value={figures.newCount} total={figures.open} color={DATA} />
                            </span>
                        }
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<InboxOutlined />}
                        label='Open'
                        value={figures.open}
                        visual={
                            <span title={`${figures.open} of ${figures.total} inquiries are open (${OPEN_STATUSES.join(', ')})`}>
                                <AdminShareRing value={figures.open} total={figures.total} color={DATA} />
                            </span>
                        }
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<BarChartOutlined />}
                        label='This month'
                        value={figures.month}
                        trend={trendOf(figures.month, figures.lastMonth, 'the same days last month')}
                        visual={<AdminMiniBars bars={figures.monthBars} />}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<RiseOutlined />}
                        label='Converted'
                        value={figures.converted}
                        visual={
                            <span title={`${figures.converted} of ${figures.total} inquiries converted`}>
                                <AdminShareRing value={figures.converted} total={figures.total} color={DATA} />
                            </span>
                        }
                    />
                </Col>
            </Row>

            {/* One filter bar, as on Contacts: tabs, search, filters and the page's actions. */}
            <DashboardFilterBar className='admin-toolbar rcp-fu-toolbar rcp-inq-filterbar' borderRadius={16} marginBottom={16}>
                <Segmented
                    className='admin-toolbar-tabs'
                    value={tab}
                    onChange={value => {
                        setTab(value as InquiryTab)
                        setTabChosen(true)
                    }}
                    options={TABS.map(key => ({
                        value: key,
                        label: (
                            <span className='admin-toolbar-tab'>
                                {TAB_LABEL[key]}
                                <span className='rcp-fu-tab-count'>{tabCounts[key]}</span>
                            </span>
                        )
                    }))}
                />
                <Input
                    allowClear
                    className='admin-toolbar-search'
                    prefix={<SearchOutlined />}
                    placeholder='Search inquiries'
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                />
                <div className='admin-toolbar-actions'>
                    <Popover trigger='click' placement='bottomRight' content={filterPanel} title='Filter inquiries'>
                        <Badge count={activeFilters} size='small' offset={[-4, 4]}>
                            <Button icon={<FilterOutlined />}>Filters</Button>
                        </Badge>
                    </Popover>
                    <Button icon={<BarChartOutlined />} onClick={() => setAnalyticsOpen(true)}>
                        Analytics
                    </Button>
                    <Button type='primary' icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>
                        New inquiry
                    </Button>
                </div>
            </DashboardFilterBar>

            <Card className='admin-card rcp-fu-card' bordered={false}>
                <div className='admin-card-head'>
                    <div>
                        <h3>{TAB_LABEL[tab]} inquiries</h3>
                        <span>
                            {visible.length.toLocaleString()} {visible.length === 1 ? 'inquiry' : 'inquiries'}
                            {filtersOn ? ' match your search and filters' : ', newest first'}
                        </span>
                    </div>
                    {filtersOn && (
                        <Button
                            type='text'
                            size='small'
                            onClick={() => {
                                clearFilters()
                                setSearch('')
                            }}
                        >
                            Clear all
                        </Button>
                    )}
                </div>

                {loading ? (
                    <Skeleton active avatar paragraph={{ rows: 4 }} />
                ) : visible.length ? (
                    <>
                        <ul className='rcp-inquiry-list'>{visible.slice(0, shown).map(renderRow)}</ul>
                        {visible.length > shown && (
                            <Button block type='text' onClick={() => setShown(n => n + PAGE)} style={{ marginTop: 8 }}>
                                Show {Math.min(PAGE, visible.length - shown)} more of {(visible.length - shown).toLocaleString()}
                            </Button>
                        )}
                    </>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={filtersOn ? 'No inquiries match your search and filters.' : `No ${TAB_LABEL[tab].toLowerCase()} inquiries.`}
                    />
                )}
            </Card>

            {/* Analytics for what the search and filters show. */}
            <Modal
                open={analyticsOpen}
                onCancel={() => setAnalyticsOpen(false)}
                footer={null}
                width={960}
                className='rcp-analytics-modal'
                style={{ maxWidth: 'calc(100vw - 24px)' }}
                centered
                destroyOnClose
                title={
                    <div className='rcp-an-title'>
                        <span className='rcp-an-icon'>
                            <BarChartOutlined />
                        </span>
                        <div>
                            <h2>Inquiry analytics</h2>
                            <span>
                                {filtered.length.toLocaleString()} {filtered.length === 1 ? 'inquiry' : 'inquiries'}
                                {filtersOn ? ' matching your search and filters' : ' at your branch'}
                            </span>
                        </div>
                    </div>
                }
                styles={{ body: { maxHeight: '76vh', overflowY: 'auto', overflowX: 'hidden' } }}
            >
                {filtered.length ? (
                    <div className='rcp-an'>
                        <dl className='rcp-an-stats'>
                            <div>
                                <dt>Inquiries</dt>
                                <dd>{filtered.length.toLocaleString()}</dd>
                            </div>
                            <div>
                                <dt>Still open</dt>
                                <dd>{analytics.open.toLocaleString()}</dd>
                            </div>
                            <div>
                                <dt>Converted</dt>
                                <dd>
                                    {analytics.converted.toLocaleString()} <small>{analytics.convertedShare}%</small>
                                </dd>
                            </div>
                            <div>
                                <dt>Busiest department</dt>
                                <dd className='is-text' title={analytics.topDepartment}>
                                    {analytics.topDepartment}
                                </dd>
                            </div>
                        </dl>

                        <div className='rcp-an-grid'>
                            <section className='rcp-an-card is-wide'>
                                <h3>Coming in</h3>
                                <span>Inquiries per month, last six months</span>
                                <HighchartsReact highcharts={Highcharts} options={trendChart} />
                            </section>

                            <section className='rcp-an-card'>
                                <h3>Who they are from</h3>
                                <span>By contact type</span>
                                <div className='admin-donut'>
                                    <HighchartsReact highcharts={Highcharts} options={typeChart} />
                                    <div className='admin-donut-center'>
                                        <strong>{filtered.length.toLocaleString()}</strong>
                                        <span>Inquiries</span>
                                    </div>
                                </div>
                                <ul className='admin-legend rcp-an-legend'>
                                    {byAudience.map((row, k) => (
                                        <li key={row.key}>
                                            <i style={{ background: TYPE_COLORS[k % TYPE_COLORS.length] }} />
                                            <span>{row.key}</span>
                                            <b>{row.count}</b>
                                        </li>
                                    ))}
                                </ul>
                            </section>

                            {[
                                { title: 'By department', hint: 'Which department each inquiry is for', rows: byDepartment, wide: true },
                                { title: 'How they reached us', hint: 'By source', rows: bySource, wide: false }
                            ].map(block => (
                                <section key={block.title} className={block.wide ? 'rcp-an-card is-wide' : 'rcp-an-card'}>
                                    <h3>{block.title}</h3>
                                    <span>{block.hint}</span>
                                    <ol className='usage-rank-list rcp-an-ranks'>
                                        {block.rows.map((row, k) => (
                                            <li key={row.key}>
                                                <span className='usage-rank-index'>{k + 1}</span>
                                                <div className='usage-rank-copy'>
                                                    <div className='usage-rank-top'>
                                                        <strong title={row.key}>{row.key}</strong>
                                                        <b>
                                                            {row.count} <small>· {row.percent}%</small>
                                                        </b>
                                                    </div>
                                                    <div className='usage-rank-bar'>
                                                        <span style={{ width: `${row.percent}%` }} />
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                </section>
                            ))}
                        </div>
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No inquiries match your search and filters.' />
                )}
            </Modal>

            <Modal
                title='New inquiry'
                open={newOpen}
                onCancel={() => setNewOpen(false)}
                // The form puts its Clear / Previous / Next / Save buttons here.
                footer={<div ref={setNewFooter} />}
                width={860}
                centered
                destroyOnClose
                className='inq-form-modal'
                styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '8px 4px 8px 0' } }}
            >
                {/* With "All programmes", a non-incubatee inquiry needs no programme; the form
                    asks for one only when linking an SME. */}
                <InquiryForm
                    embedded
                    stepped
                    forcedProgramId={activeProgramId}
                    footerContainer={newFooter}
                    onSuccess={() => {
                        setNewOpen(false)
                        load()
                    }}
                />
            </Modal>

            <Drawer
                open={Boolean(viewId)}
                onClose={() => setViewId(null)}
                width='min(720px, 100vw)'
                title={null}
                destroyOnClose
                styles={{ body: { padding: 24 } }}
            >
                {viewId && (
                    <InquiryDetail
                        inquiryId={viewId}
                        embedded
                        onEdit={() => {
                            const id = viewId
                            setViewId(null)
                            setEditId(id)
                        }}
                    />
                )}
            </Drawer>

            <InquiryEditModal
                inquiryId={editId}
                onClose={() => setEditId(null)}
                onSaved={() => {
                    setEditId(null)
                    load()
                }}
            />
        </div>
    )
}

export default InquiriesList
