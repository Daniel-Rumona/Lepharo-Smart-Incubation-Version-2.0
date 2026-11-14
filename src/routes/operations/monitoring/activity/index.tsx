import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Col, Drawer, Empty, Grid, Input, Pagination, Popover, Row, Segmented, Tag, message } from 'antd'
import {
    ClockCircleOutlined,
    DownloadOutlined,
    FieldTimeOutlined,
    FilterOutlined,
    HourglassOutlined,
    SearchOutlined,
    SortAscendingOutlined,
    TeamOutlined,
    ThunderboltOutlined
} from '@ant-design/icons'
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { motion, useReducedMotion } from 'framer-motion'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { ChoiceFilter, EntityAvatar, FilterPanel, SortSelect, type SortOption } from '@/components/workspace'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { formatRole, isStaffRole } from '@/lib/roleLabels'
import { canViewControlReportData, isQuantilytixControlEmail } from '@/utils/reportVisibility'
import {
    buildPeople,
    dailySeries,
    formatAgo,
    formatDuration,
    summarise,
    toSession,
    type Person,
    type Session,
    type SessionDoc
} from './activityData'
import { ActivityPersonDetail } from './ActivityPersonDetail'
import './activity.css'

type PersonSort = 'recent' | 'time' | 'name'

const SORT_OPTIONS: SortOption<PersonSort>[] = [
    { value: 'recent', label: 'Last seen', icon: <ClockCircleOutlined /> },
    { value: 'time', label: 'Most time', icon: <FieldTimeOutlined /> },
    { value: 'name', label: 'Name A–Z', icon: <SortAscendingOutlined /> }
]

const WINDOWS = [7, 14, 30, 90]
const PAGE_SIZE = 12
/** Most sessions read per window; a notice shows if a window hits it. */
const SESSION_LIMIT = 5000

const pctChange = (current: number, previous: number) =>
    previous > 0 ? Math.round(((current - previous) / previous) * 100) : null

const changeText = (current: number, previous: number) => {
    const pct = pctChange(current, previous)
    return pct === null ? undefined : `${pct > 0 ? '+' : ''}${pct}% vs previous period`
}

/** How staff use the app: who is on now, time spent per day and team, and each person's sessions. */
export const MonitoringActivity: React.FC = () => {
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.lg
    const reduceMotion = useReducedMotion()
    const { actor } = useFullIdentity()
    const showControl = canViewControlReportData(actor?.email)

    const [days, setDays] = useState(14)
    const [now, setNow] = useState(() => Date.now())
    const [current, setCurrent] = useState<Session[]>([])
    const [previous, setPrevious] = useState<Session[]>([])
    const [truncated, setTruncated] = useState(false)
    const [loading, setLoading] = useState(true)
    const [directory, setDirectory] = useState<Map<string, { name: string; team: string; photo?: string; email: string }>>(new Map())

    const [search, setSearch] = useState('')
    const [role, setRole] = useState('all')
    const [team, setTeam] = useState('all')
    const [sort, setSort] = useState<PersonSort>('recent')
    const [page, setPage] = useState(1)
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)

    // "Active now" depends on the clock as well as the data.
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000)
        return () => window.clearInterval(timer)
    }, [])

    // Names, teams and photos, by uid and by email (older sessions may lack a uid).
    useEffect(() => {
        Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'departments'))])
            .then(([users, departments]) => {
                const deptName = new Map(departments.docs.map(d => [d.id, String((d.data() as any)?.name || d.id)]))
                const map = new Map<string, { name: string; team: string; photo?: string; email: string }>()
                users.docs.forEach(d => {
                    const u = d.data() as any
                    const email = String(u.email || '').trim().toLowerCase()
                    const entry = {
                        name: u.name || u.fullName || u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || email,
                        team: u.departmentName || (u.departmentId ? deptName.get(u.departmentId) || '' : '') || u.department || '',
                        photo: u.photoURL || undefined,
                        email
                    }
                    map.set(d.id, entry)
                    if (u.uid) map.set(String(u.uid), entry)
                    if (email) map.set(email, entry)
                })
                setDirectory(map)
            })
            .catch(error => console.error('[activity] directory load failed', error))
    }, [])

    // Staff sessions only, with control (test) accounts hidden from everyone else.
    const keep = (s: Session | null): s is Session =>
        !!s && isStaffRole(s.role) && (showControl || !isQuantilytixControlEmail(s.email))

    useEffect(() => {
        setLoading(true)
        const start = dayjs().subtract(days, 'day').toDate()
        const prevStart = dayjs().subtract(days * 2, 'day').toDate()
        let cancelled = false

        const unsubscribe = onSnapshot(
            query(collection(db, 'userSessions'), where('startedAt', '>=', start), orderBy('startedAt', 'desc'), limit(SESSION_LIMIT)),
            snap => {
                if (cancelled) return
                setCurrent(snap.docs.map(d => toSession(d.data() as SessionDoc)).filter(keep))
                setTruncated(snap.size >= SESSION_LIMIT)
                setNow(Date.now())
                setLoading(false)
            },
            error => {
                console.error('[activity] sessions load failed', error)
                message.error('Couldn’t load activity')
                setLoading(false)
            }
        )

        // The previous window of the same length, for the comparison on each tile.
        getDocs(
            query(
                collection(db, 'userSessions'),
                where('startedAt', '>=', prevStart),
                where('startedAt', '<', start),
                orderBy('startedAt', 'desc'),
                limit(SESSION_LIMIT)
            )
        )
            .then(snap => !cancelled && setPrevious(snap.docs.map(d => toSession(d.data() as SessionDoc)).filter(keep)))
            .catch(() => !cancelled && setPrevious([]))

        return () => {
            cancelled = true
            unsubscribe()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days, showControl])

    const lookup = (personId: string, email: string) =>
        directory.get(personId) || directory.get(email) || { name: email, team: '' }

    const people = useMemo(() => buildPeople(current, lookup, now), [current, directory, now])
    const stats = useMemo(() => summarise(current, now), [current, now])
    const prevStats = useMemo(() => summarise(previous, now), [previous, now])

    const roles = useMemo(() => Array.from(new Set(people.flatMap(p => p.roles))).map(formatRole).sort(), [people])
    const teams = useMemo(() => Array.from(new Set(people.map(p => p.team).filter(Boolean))).sort(), [people])

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase()
        return people
            .filter(
                p =>
                    (role === 'all' || p.roles.some(r => formatRole(r) === role)) &&
                    (team === 'all' || p.team === team) &&
                    (!q || `${p.name} ${p.email} ${p.team}`.toLowerCase().includes(q))
            )
            .sort((a, b) => {
                if (sort === 'name') return a.name.localeCompare(b.name)
                if (sort === 'time') return b.minutes - a.minutes
                return Number(b.active) - Number(a.active) || (b.lastSeen || 0) - (a.lastSeen || 0)
            })
    }, [people, search, role, team, sort])

    const visibleIds = useMemo(() => new Set(visible.map(p => p.id)), [visible])
    const visibleSessions = useMemo(() => current.filter(s => visibleIds.has(s.personId)), [current, visibleIds])

    useEffect(() => setPage(1), [search, role, team, sort, days])

    useEffect(() => {
        if (isMobile) return
        if (!visible.some(p => p.id === selectedId)) setSelectedId(visible[0]?.id)
    }, [visible, selectedId, isMobile])

    const selected = people.find(p => p.id === selectedId) || null

    const daily = useMemo(() => dailySeries(visibleSessions, days, now), [visibleSessions, days, now])

    const dailyOptions: Highcharts.Options = {
        chart: { height: 280 },
        title: { text: undefined },
        credits: { enabled: false },
        xAxis: { categories: daily.map(p => dayjs(p.key).format('D MMM')) },
        yAxis: [
            { min: 0, allowDecimals: false, title: { text: undefined } },
            { min: 0, title: { text: undefined }, labels: { format: '{value}h' }, opposite: true }
        ],
        tooltip: { shared: true },
        plotOptions: { column: { borderRadius: 3, borderWidth: 0 } },
        series: [
            { type: 'column', name: 'People active', data: daily.map(p => p.people), color: '#93c5fd' },
            { type: 'spline', name: 'Hours', data: daily.map(p => p.hours), yAxis: 1, tooltip: { valueSuffix: 'h' } }
        ]
    }

    const teamOptions: Highcharts.Options = useMemo(() => {
        const minutes = new Map<string, number>()
        visible.forEach(p => minutes.set(p.team || 'No team', (minutes.get(p.team || 'No team') || 0) + p.minutes))
        const rows = Array.from(minutes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
        return {
            chart: { type: 'bar', height: Math.max(240, rows.length * 34 + 70) },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { enabled: false },
            xAxis: { categories: rows.map(([name]) => name), title: { text: undefined } },
            yAxis: { min: 0, title: { text: undefined }, labels: { format: '{value}h' } },
            tooltip: { pointFormat: '<b>{point.y}h</b>' },
            plotOptions: { bar: { borderRadius: 3, borderWidth: 0, dataLabels: { enabled: true, format: '{y}h' } } },
            series: [{ type: 'bar', name: 'Hours', data: rows.map(([, m]) => Math.round((m / 60) * 10) / 10) }]
        }
    }, [visible])

    const exportExcel = () => {
        if (!visible.length) {
            message.info('Nothing to export.')
            return
        }
        const rows = visible.map(p => ({
            Name: p.name,
            Email: p.email,
            Team: p.team || '—',
            Role: p.roles.map(formatRole).join(', '),
            Status: p.active ? 'Active now' : 'Not active',
            'Last seen': p.lastSeen ? dayjs(p.lastSeen).format('YYYY-MM-DD HH:mm') : '—',
            'Sessions today': p.sessionsToday,
            [`Sessions (${days} days)`]: p.sessions,
            [`Time in app (${days} days)`]: formatDuration(p.minutes),
            [`Minutes (${days} days)`]: p.minutes
        }))
        const sheet = XLSX.utils.json_to_sheet(rows)
        const book = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(book, sheet, `Activity ${days}d`)
        XLSX.writeFile(book, `staff-activity-${days}-days-${dayjs().format('YYYY-MM-DD')}.xlsx`)
    }

    const filterCount = Number(role !== 'all') + Number(team !== 'all')
    const filters = (
        <FilterPanel
            canReset={filterCount > 0}
            onReset={() => {
                setRole('all')
                setTeam('all')
            }}
        >
            <ChoiceFilter id='act-role' label='Role' allLabel='All roles' value={role} values={roles} onChange={setRole} />
            <ChoiceFilter id='act-team' label='Team' allLabel='All teams' value={team} values={teams} onChange={setTeam} />
        </FilterPanel>
    )

    const detail = selected ? <ActivityPersonDetail person={selected} sessions={current} days={days} now={now} /> : null
    const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <div className='ws-page'>
            <Helmet>
                <title>Staff activity</title>
            </Helmet>

            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                <Col xs={12} lg={6}>
                    <MetricTile icon={<ThunderboltOutlined />} tone='success' title='Active now' value={stats.activeNow} loading={loading} compact={isMobile} />
                </Col>
                <Col xs={12} lg={6}>
                    <MetricTile
                        icon={<TeamOutlined />}
                        tone='info'
                        title='People active'
                        value={stats.people}
                        subtitle={changeText(stats.people, prevStats.people)}
                        loading={loading}
                        compact={isMobile}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <MetricTile
                        icon={<FieldTimeOutlined />}
                        tone='accent'
                        title='Hours in the app'
                        value={Math.round(stats.minutes / 60)}
                        subtitle={changeText(stats.minutes, prevStats.minutes)}
                        loading={loading}
                        compact={isMobile}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <MetricTile
                        icon={<HourglassOutlined />}
                        tone='neutral'
                        title='Average session'
                        value={formatDuration(stats.avgMinutes)}
                        subtitle={changeText(stats.avgMinutes, prevStats.avgMinutes)}
                        loading={loading}
                        compact={isMobile}
                    />
                </Col>
            </Row>

            <DashboardFilterBar>
                <div className='ws-toolbar'>
                    <Input
                        className='ws-toolbar-search'
                        placeholder='Search by name, email or team'
                        prefix={<SearchOutlined />}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        allowClear
                        aria-label='Search staff activity'
                    />
                    <Segmented
                        className='ws-toolbar-status'
                        block
                        value={days}
                        onChange={v => setDays(Number(v))}
                        options={WINDOWS.map(d => ({ label: `${d} days`, value: d }))}
                    />
                    <Popover content={filters} trigger='click' placement='bottomLeft' title='Filters'>
                        <Badge className='ws-toolbar-button' count={filterCount} size='small' offset={[-6, 4]}>
                            <Button block icon={<FilterOutlined />}>
                                Filters
                            </Button>
                        </Badge>
                    </Popover>
                    <Button className='ws-toolbar-button' icon={<DownloadOutlined />} onClick={exportExcel}>
                        Export Excel
                    </Button>
                </div>
            </DashboardFilterBar>

            {truncated && (
                <Alert
                    type='warning'
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={`Only the latest ${SESSION_LIMIT.toLocaleString()} sessions are included. Pick a shorter period for complete figures.`}
                />
            )}

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} xl={15}>
                    <MotionCard title='Daily activity' loading={loading} skeletonRows={6}>
                        <HighchartsReact highcharts={Highcharts} options={dailyOptions} />
                    </MotionCard>
                </Col>
                <Col xs={24} xl={9}>
                    <MotionCard title='Hours by team' loading={loading} skeletonRows={6}>
                        {visible.length ? (
                            <HighchartsReact highcharts={Highcharts} options={teamOptions} />
                        ) : (
                            <Empty description='No activity in this period' />
                        )}
                    </MotionCard>
                </Col>
            </Row>

            <div className='ws-layout'>
                <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
                    <SortSelect value={sort} options={SORT_OPTIONS} onChange={setSort} label='Sort staff' />
                    {visible.length === 0 ? (
                        <Empty className='ws-list-empty' description='No staff activity matches these filters' />
                    ) : (
                        <>
                            <div key={`${page}|${sort}|${search}|${role}|${team}|${days}`} className='ws-rows' role='listbox' aria-label='Staff'>
                                {pageItems.map((p: Person, index) => (
                                    <motion.button
                                        key={p.id}
                                        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                        type='button'
                                        role='option'
                                        aria-selected={p.id === selectedId}
                                        className={`ws-row${p.id === selectedId ? ' is-selected' : ''}`}
                                        onClick={() => {
                                            setSelectedId(p.id)
                                            if (isMobile) setDrawerOpen(true)
                                        }}
                                    >
                                        <EntityAvatar name={p.name} photo={p.photo} size={36} />
                                        <div className='ws-row-main'>
                                            <div className='ws-row-name'>{p.name}</div>
                                            <div className='ws-row-meta'>
                                                {[p.team, formatDuration(p.minutes)].filter(Boolean).join(' · ')}
                                            </div>
                                        </div>
                                        <div className='ws-row-side'>
                                            {p.active ? (
                                                <Tag color='green' bordered={false}>
                                                    Active
                                                </Tag>
                                            ) : (
                                                <span className='act-ago'>{formatAgo(p.lastSeen, now)}</span>
                                            )}
                                        </div>
                                    </motion.button>
                                ))}
                            </div>
                            {visible.length > PAGE_SIZE && (
                                <div className='ws-pagination'>
                                    <Pagination
                                        size='small'
                                        current={page}
                                        pageSize={PAGE_SIZE}
                                        total={visible.length}
                                        onChange={setPage}
                                        showSizeChanger={false}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </MotionCard>

                {!isMobile && (
                    <div className='ws-detail-sticky'>
                        {detail || (
                            <MotionCard loading={loading} skeleton='text' skeletonRows={8}>
                                <Empty className='ws-detail-empty' description='Select someone to see their activity' />
                            </MotionCard>
                        )}
                    </div>
                )}
            </div>

            {isMobile && (
                <Drawer
                    className='ws-drawer'
                    open={drawerOpen && !!selected}
                    onClose={() => setDrawerOpen(false)}
                    placement='right'
                    width='100%'
                    title={selected?.name || 'Activity'}
                >
                    {detail}
                </Drawer>
            )}

            <p className='ws-muted act-note'>
                Time is estimated from activity in the app; a session counts until the last click or keypress, up to 12 hours.
            </p>
        </div>
    )
}

export default MonitoringActivity
