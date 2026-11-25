import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Avatar, Badge, Button, Card, Col, Drawer, Empty, Popover, Row, Segmented, Select, Space, Table, Tag, theme, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    BarChartOutlined,
    ClockCircleOutlined,
    DownloadOutlined,
    FileTextOutlined,
    FilterOutlined,
    IdcardOutlined,
    LoginOutlined,
    ReloadOutlined,
    TeamOutlined,
    UserOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import dayjs, { type Dayjs } from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { collection, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import * as XLSX from 'xlsx'
import { db } from '@/firebase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useDashboardDateRange } from '@/lib/useDashboardDateRange'
import { formatRole } from '@/lib/roleLabels'
import { AdminKpiTile, AdminMiniBars, AdminRoleTag, AdminShareRing } from '@/components/admin/AdminKpiTile'
import { PAGE_VISITS, type UsageAction } from '@/utils/usageTracking'
import '@/styles/admin-overview.css'

dayjs.extend(relativeTime)

const { Text } = Typography

/*
 * Usage: who used the platform and for how long (userSessions, written by
 * components/AuthSessionTracker.tsx), which pages they used and what they did
 * there (pageVisits, written by components/UsageTracker.tsx). The period comes
 * from the topbar date filter.
 */

/** Reads stop here; the page says so when a period hits it. */
const READ_CAP = 10_000
/** Sessions ping at most once a minute while someone is active, so this is "online now". */
const ONLINE_WINDOW_MIN = 5

/* Filter bar sizing, in px: the tabs stay at least this wide before the filters fold into one button. */
const TABS_MIN_WIDTH = 320
const ACTIONS_WIDTH = 140
const BAR_GAP = 10
const FILTER_WIDTH = { role: 180, user: 220, page: 220 }

type Session = { id: string; uid: string; email: string; role: string; startedAt: Date; lastSeenAt: Date; ms: number }

type Visit = {
    id: string
    uid: string
    name: string
    email: string
    role: string
    page: string
    path: string
    title: string
    at: Date | null
    activeMs: number
    actionCount: number
    actions: UsageAction[]
}

type ActionStat = { label: string; kind: string; count: number }

type UserRow = { uid: string; name: string; email: string; role: string; sessions: number; ms: number; pageMs: number; visits: number; actions: number; lastSeen: Date | null }
type PageRow = { page: string; label: string; visits: number; users: number; ms: number; actions: number; topActions: ActionStat[] }

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
}

const formatDuration = (ms: number) => {
    const mins = Math.max(0, Math.round(ms / 60_000))
    if (ms > 0 && mins === 0) return `${Math.max(1, Math.round(ms / 1000))}s`
    const h = Math.floor(mins / 60)
    return h ? `${h}h ${mins % 60}m` : `${mins}m`
}

const initialsOf = (name: string) =>
    name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?'

/** "/operations/monitoring/activity" -> "Operations › Monitoring › Activity", for pages with no title yet. */
const routeLabel = (page: string) =>
    page === '/'
        ? 'Home'
        : page
              .split('/')
              .filter(Boolean)
              .filter(s => s !== ':id')
              .map(s => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
              .join(' › ')

const groupBy = <T,>(rows: T[], key: (row: T) => string) => {
    const map = new Map<string, T[]>()
    rows.forEach(r => {
        const k = key(r)
        const list = map.get(k)
        if (list) list.push(r)
        else map.set(k, [r])
    })
    return map
}

const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((t, r) => t + pick(r), 0)

/** Counts actions by label, most frequent first. */
const tallyActions = (visits: Visit[]): ActionStat[] => {
    const counts = new Map<string, ActionStat>()
    visits.forEach(v =>
        v.actions.forEach(a => {
            const key = `${a.kind}|${a.label}`
            const hit = counts.get(key)
            if (hit) hit.count += 1
            else counts.set(key, { label: a.label, kind: a.kind, count: 1 })
        })
    )
    return [...counts.values()].sort((a, b) => b.count - a.count)
}

/**
 * Routes that render a different screen per department, so their <title>
 * depends on who visited (e.g. /operations/reports is "ROM Reports" for the ROM
 * department and "HR Reports" for HR). Naming the row after the most common
 * title would label the whole route after one department.
 */
const SHARED_PAGE_LABELS: Record<string, string> = {
    '/operations/reports': 'Department Reports'
}

/** The title seen most often for a page; titles vary while a page loads. */
const commonTitle = (visits: Visit[]) => {
    const counts = new Map<string, number>()
    visits.forEach(v => v.title && v.title !== 'Untitled' && counts.set(v.title, (counts.get(v.title) || 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
}

const KIND_COLOR: Record<string, string> = { button: 'blue', link: 'geekblue', tab: 'purple', menu: 'cyan', toggle: 'orange', custom: 'green' }

const ActionTags: React.FC<{ actions: ActionStat[]; max?: number }> = ({ actions, max = 3 }) =>
    actions.length === 0 ? (
        <Text type='secondary'>Viewed only</Text>
    ) : (
        <Space size={[4, 4]} wrap>
            {actions.slice(0, max).map(a => (
                <Tag key={`${a.kind}|${a.label}`} color={KIND_COLOR[a.kind]} bordered={false} style={{ marginInlineEnd: 0 }}>
                    {a.label} · {a.count}
                </Tag>
            ))}
        </Space>
    )

const CardHead: React.FC<{ title: string; hint?: string; extra?: React.ReactNode }> = ({ title, hint, extra }) => (
    <div className='admin-card-head'>
        <div>
            <h3>{title}</h3>
            {hint && <span>{hint}</span>}
        </div>
        {extra}
    </div>
)

const UsageStatistics: React.FC = () => {
    const isMobile = useIsMobile()
    const { token } = theme.useToken()
    const { range } = useDashboardDateRange()

    const [sessions, setSessions] = useState<Session[]>([])
    const [visits, setVisits] = useState<Visit[]>([])
    const [onlineUids, setOnlineUids] = useState<Array<{ uid: string; role: string }>>([])
    const [names, setNames] = useState<Map<string, string>>(new Map())
    const [capped, setCapped] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [reloadKey, setReloadKey] = useState(0)

    const [roleFilter, setRoleFilter] = useState('all')
    const [userFilter, setUserFilter] = useState('all')
    const [pageFilter, setPageFilter] = useState('all')
    const [section, setSection] = useState<'overview' | 'users' | 'pages'>('overview')
    const [openPage, setOpenPage] = useState<string | null>(null)
    const [openUser, setOpenUser] = useState<string | null>(null)
    const barRef = useRef<HTMLDivElement>(null)
    const [barWidth, setBarWidth] = useState(0)

    useEffect(() => {
        const el = barRef.current
        if (!el) return
        const observer = new ResizeObserver(([entry]) => setBarWidth(entry.contentRect.width))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const ACCENT = token.colorPrimary
    const ACCENT_DEEP = token.colorPrimaryActive
    const ACCENT_SOFT = token.colorPrimaryBorder
    const ROLE_COLORS = [ACCENT, token.colorPrimaryBorderHover, ACCENT_DEEP, '#0d9488', '#d97706', '#94a3b8', '#db2777', '#0891b2']

    const start = range ? range[0].startOf('day') : null
    const end = range ? range[1].endOf('day') : dayjs().endOf('day')
    const periodKey = `${start?.valueOf() ?? 'all'}|${end.valueOf()}`

    useEffect(() => {
        let active = true
        setLoading(true)
        setError(null)

        const between = (field: string) => [
            ...(start ? [where(field, '>=', Timestamp.fromDate(start.toDate()))] : []),
            where(field, '<=', Timestamp.fromDate(end.toDate())),
            orderBy(field, 'desc'),
            limit(READ_CAP)
        ]

        Promise.all([
            getDocs(query(collection(db, 'userSessions'), ...between('startedAt'))),
            getDocs(query(collection(db, PAGE_VISITS), ...between('enteredAt'))),
            getDocs(
                query(
                    collection(db, 'userSessions'),
                    where('lastSeenAt', '>=', Timestamp.fromDate(dayjs().subtract(ONLINE_WINDOW_MIN, 'minute').toDate()))
                )
            ),
            getDocs(collection(db, 'users'))
        ])
            .then(([sessionSnap, visitSnap, onlineSnap, userSnap]) => {
                if (!active) return
                setCapped(sessionSnap.size >= READ_CAP || visitSnap.size >= READ_CAP)
                setSessions(
                    sessionSnap.docs.flatMap(d => {
                        const s = d.data() as any
                        const startedAt = toDate(s.startedAt)
                        if (!startedAt) return []
                        // lastSeenAt only moves while the user is active, so it bounds the time actually used.
                        const lastSeenAt = toDate(s.lastSeenAt) || startedAt
                        return [{
                            id: d.id,
                            uid: String(s.uid || ''),
                            email: String(s.email || ''),
                            role: String(s.role || 'unknown'),
                            startedAt,
                            lastSeenAt,
                            ms: Math.max(0, lastSeenAt.getTime() - startedAt.getTime())
                        }]
                    })
                )
                setVisits(
                    visitSnap.docs
                        .map(d => {
                            const v = d.data() as any
                            return {
                                id: d.id,
                                uid: String(v.uid || ''),
                                name: String(v.name || ''),
                                email: String(v.email || ''),
                                role: String(v.role || 'unknown'),
                                page: String(v.page || v.path || '/'),
                                path: String(v.path || ''),
                                title: String(v.title || ''),
                                at: toDate(v.enteredAt),
                                activeMs: Number(v.activeMs) || 0,
                                totalMs: Number(v.totalMs) || 0,
                                actionCount: Number(v.actionCount) || 0,
                                actions: Array.isArray(v.actions) ? v.actions : []
                            }
                        })
                        // Redirects and pages left within a second are not visits anyone made.
                        .filter(v => v.totalMs >= 1000 || v.actionCount > 0 || v.totalMs === 0)
                )
                setOnlineUids(
                    onlineSnap.docs
                        .map(d => d.data() as any)
                        .filter(s => !s.endedAt)
                        .map(s => ({ uid: String(s.uid || ''), role: String(s.role || 'unknown') }))
                )
                setNames(
                    new Map(
                        userSnap.docs.map(d => {
                            const u = d.data() as any
                            return [d.id, String(u.name || u.fullName || u.displayName || [u.firstName, u.surname].filter(Boolean).join(' ') || '')]
                        })
                    )
                )
            })
            .catch(e => active && setError(String(e?.message || e)))
            .finally(() => active && setLoading(false))
        return () => {
            active = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [periodKey, reloadKey])

    const nameOf = (uid: string, fallback: string) => names.get(uid) || fallback || 'Unknown user'

    const pageLabels = useMemo(() => {
        const map = new Map<string, string>()
        groupBy(visits, v => v.page).forEach((rows, page) =>
            map.set(page, SHARED_PAGE_LABELS[page] || commonTitle(rows) || routeLabel(page))
        )
        return map
    }, [visits])

    // Each tab shows only the filters that apply to it, and a filter that is not on screen does not apply.
    const usesUser = section !== 'pages'
    const usesPage = section !== 'users'
    const activeUser = usesUser ? userFilter : 'all'
    const activePage = usesPage ? pageFilter : 'all'

    const filteredSessions = useMemo(
        () => sessions.filter(s => (roleFilter === 'all' || s.role === roleFilter) && (activeUser === 'all' || s.uid === activeUser)),
        [sessions, roleFilter, activeUser]
    )
    const filteredVisits = useMemo(
        () =>
            visits.filter(
                v =>
                    (roleFilter === 'all' || v.role === roleFilter) &&
                    (activeUser === 'all' || v.uid === activeUser) &&
                    (activePage === 'all' || v.page === activePage)
            ),
        [visits, roleFilter, activeUser, activePage]
    )

    const roleOptions = useMemo(
        () => [...new Set([...sessions.map(s => s.role), ...visits.map(v => v.role)])].filter(Boolean).sort().map(r => ({ value: r, label: formatRole(r) })),
        [sessions, visits]
    )
    const userOptions = useMemo(() => {
        const map = new Map<string, string>()
        ;[...sessions, ...visits].forEach(r => map.set(r.uid, nameOf(r.uid, ('name' in r && r.name) || r.email)))
        return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions, visits, names])
    const pageOptions = useMemo(
        () => [...pageLabels.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
        [pageLabels]
    )

    const userRows = useMemo<UserRow[]>(() => {
        const rows = new Map<string, UserRow>()
        const row = (uid: string, email: string, role: string, name = '') => {
            let r = rows.get(uid)
            if (!r) {
                r = { uid, name: nameOf(uid, name || email), email, role, sessions: 0, ms: 0, pageMs: 0, visits: 0, actions: 0, lastSeen: null }
                rows.set(uid, r)
            }
            return r
        }
        filteredSessions.forEach(s => {
            const r = row(s.uid, s.email, s.role)
            r.sessions += 1
            r.ms += s.ms
            if (!r.lastSeen || s.lastSeenAt > r.lastSeen) r.lastSeen = s.lastSeenAt
        })
        filteredVisits.forEach(v => {
            const r = row(v.uid, v.email, v.role, v.name)
            r.visits += 1
            r.pageMs += v.activeMs
            r.actions += v.actionCount
            if (v.at && (!r.lastSeen || v.at > r.lastSeen)) r.lastSeen = v.at
        })
        return [...rows.values()].sort((a, b) => b.ms + b.pageMs - (a.ms + a.pageMs))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredSessions, filteredVisits, names])

    const pageRows = useMemo<PageRow[]>(
        () =>
            [...groupBy(filteredVisits, v => v.page).entries()]
                .map(([page, rows]) => ({
                    page,
                    label: pageLabels.get(page) || routeLabel(page),
                    visits: rows.length,
                    users: new Set(rows.map(r => r.uid)).size,
                    ms: sum(rows, r => r.activeMs),
                    actions: sum(rows, r => r.actionCount),
                    topActions: tallyActions(rows)
                }))
                .sort((a, b) => b.ms - a.ms),
        [filteredVisits, pageLabels]
    )

    const totalMs = sum(filteredSessions, s => s.ms)
    const totalPageMs = sum(pageRows, r => r.ms)
    const online = new Set(
        onlineUids.filter(o => (roleFilter === 'all' || o.role === roleFilter) && (userFilter === 'all' || o.uid === userFilter)).map(o => o.uid)
    ).size

    // Seven days up to the end of the period (or today), beside the figures.
    const barsEnd = end.isAfter(dayjs()) ? dayjs() : end
    const lastSevenDays = Array.from({ length: 7 }, (_, i) => barsEnd.subtract(6 - i, 'day'))
    const dailyBars = (pick: (s: Session) => number) =>
        lastSevenDays.map(day => ({
            key: day.valueOf(),
            label: day.format('dd').slice(0, 1),
            value: sum(filteredSessions.filter(s => dayjs(s.startedAt).isSame(day, 'day')), pick)
        }))

    const roleTime = useMemo(() => {
        const totals = new Map<string, number>()
        filteredSessions.forEach(s => totals.set(s.role, (totals.get(s.role) || 0) + s.ms))
        return [...totals.entries()].filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1])
    }, [filteredSessions])

    const trendChart = useMemo<Highcharts.Options>(() => {
        const days = new Map<string, { visits: number; ms: number }>()
        filteredVisits.forEach(v => {
            if (!v.at) return
            const key = dayjs(v.at).format('YYYY-MM-DD')
            const d = days.get(key) || { visits: 0, ms: 0 }
            d.visits += 1
            d.ms += v.activeMs
            days.set(key, d)
        })
        const entries = [...days.entries()].sort(([a], [b]) => a.localeCompare(b))
        return {
            chart: { type: 'areaspline', height: 300, spacing: [12, 4, 4, 4], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { align: 'right', verticalAlign: 'top', itemDistance: 16, symbolRadius: 6 },
            tooltip: { shared: true },
            xAxis: { categories: entries.map(([d]) => dayjs(d).format('DD MMM')), lineWidth: 0, tickLength: 0 },
            yAxis: [
                { min: 0, title: { text: 'Visits' }, allowDecimals: false, gridLineDashStyle: 'Dash' },
                { min: 0, opposite: true, title: { text: 'Minutes' }, gridLineWidth: 0 }
            ],
            plotOptions: { areaspline: { marker: { radius: 3, symbol: 'circle' }, lineWidth: 2.5 } },
            series: [
                {
                    type: 'areaspline',
                    name: 'Page visits',
                    color: ACCENT,
                    data: entries.map(([, d]) => d.visits),
                    fillColor: {
                        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                        stops: [
                            [0, Highcharts.color(ACCENT).setOpacity(0.32).get('rgba') as string],
                            [1, Highcharts.color(ACCENT).setOpacity(0).get('rgba') as string]
                        ]
                    }
                },
                {
                    type: 'areaspline',
                    name: 'Active minutes',
                    yAxis: 1,
                    color: ACCENT_DEEP,
                    fillColor: 'transparent',
                    dashStyle: 'ShortDash',
                    data: entries.map(([, d]) => Math.round(d.ms / 60_000))
                }
            ]
        }
    }, [filteredVisits, ACCENT, ACCENT_DEEP])

    const roleChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'pie', height: 220, spacing: [0, 0, 0, 0], backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            tooltip: {
                pointFormatter() {
                    return `<b>${formatDuration(this.y || 0)}</b> (${Math.round(this.percentage || 0)}%)`
                }
            },
            plotOptions: { pie: { innerSize: '74%', borderWidth: 3, borderColor: token.colorBgContainer, borderRadius: 6, dataLabels: { enabled: false } } },
            series: [
                {
                    type: 'pie',
                    name: 'Time used',
                    data: roleTime.map(([role, ms], i) => ({ name: formatRole(role), y: ms, color: ROLE_COLORS[i % ROLE_COLORS.length] }))
                }
            ]
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [roleTime, ACCENT, token.colorBgContainer]
    )

    const pagesChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'bar', height: 340, backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { enabled: false },
            xAxis: { categories: pageRows.slice(0, 8).map(r => r.label), lineWidth: 0, tickLength: 0 },
            yAxis: { min: 0, title: { text: 'Minutes' }, gridLineDashStyle: 'Dash' },
            plotOptions: { bar: { borderRadius: 6, pointPadding: 0.12, groupPadding: 0.08 } },
            series: [{ type: 'bar', name: 'Active minutes', color: ACCENT, data: pageRows.slice(0, 8).map(r => Math.round(r.ms / 60_000)) }]
        }),
        [pageRows, ACCENT]
    )

    const usersChart = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: 'column', height: 340, backgroundColor: 'transparent' },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { enabled: false },
            xAxis: { categories: userRows.slice(0, 8).map(r => r.name), lineWidth: 0, tickLength: 0 },
            yAxis: { min: 0, title: { text: 'Minutes' }, gridLineDashStyle: 'Dash' },
            plotOptions: { column: { borderRadius: 6, pointPadding: 0.1, groupPadding: 0.12 } },
            series: [
                {
                    type: 'column',
                    name: 'Logged-in minutes',
                    // The busiest user in full accent, the rest lighter, like the KPI bars.
                    data: userRows.slice(0, 8).map((r, i) => ({ y: Math.round(r.ms / 60_000), color: i === 0 ? ACCENT : ACCENT_SOFT }))
                }
            ]
        }),
        [userRows, ACCENT, ACCENT_SOFT]
    )

    const exportXlsx = () => {
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(
                userRows.map(u => ({
                    Name: u.name,
                    Email: u.email,
                    Role: formatRole(u.role),
                    Sessions: u.sessions,
                    'Logged-in minutes': Math.round(u.ms / 60_000),
                    'Page visits': u.visits,
                    'Active page minutes': Math.round(u.pageMs / 60_000),
                    Actions: u.actions,
                    'Last seen': u.lastSeen ? dayjs(u.lastSeen).format('YYYY-MM-DD HH:mm') : ''
                }))
            ),
            'Users'
        )
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(
                pageRows.map(p => ({
                    Page: p.label,
                    Route: p.page,
                    Visits: p.visits,
                    Users: p.users,
                    'Active minutes': Math.round(p.ms / 60_000),
                    Actions: p.actions,
                    'Top actions': p.topActions.slice(0, 5).map(a => `${a.label} (${a.count})`).join(', ')
                }))
            ),
            'Pages'
        )
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(
                filteredVisits.map(v => ({
                    When: v.at ? dayjs(v.at).format('YYYY-MM-DD HH:mm') : '',
                    Name: nameOf(v.uid, v.name || v.email),
                    Email: v.email,
                    Role: formatRole(v.role),
                    Page: pageLabels.get(v.page) || v.page,
                    Path: v.path,
                    'Active seconds': Math.round(v.activeMs / 1000),
                    Actions: v.actions.map(a => a.label).join(' → ')
                }))
            ),
            'Visits'
        )
        XLSX.writeFile(wb, `usage-${dayjs().format('YYYY-MM-DD')}.xlsx`)
    }

    const userColumns: ColumnsType<UserRow> = [
        {
            title: 'User',
            key: 'user',
            render: (_, r) => (
                <Space size={10}>
                    <Avatar size={32} className='usage-rank-avatar'>{initialsOf(r.name)}</Avatar>
                    <Space direction='vertical' size={0}>
                        <Text strong>{r.name}</Text>
                        <Text type='secondary' style={{ fontSize: 12 }}>{r.email}</Text>
                    </Space>
                </Space>
            )
        },
        { title: 'Role', dataIndex: 'role', render: (role: string) => <AdminRoleTag role={role} />, width: 160 },
        { title: 'Sessions', dataIndex: 'sessions', sorter: (a, b) => a.sessions - b.sessions, width: 100 },
        { title: 'Logged-in time', dataIndex: 'ms', render: formatDuration, sorter: (a, b) => a.ms - b.ms, defaultSortOrder: 'descend', width: 130 },
        { title: 'Page visits', dataIndex: 'visits', sorter: (a, b) => a.visits - b.visits, width: 110 },
        { title: 'Actions', dataIndex: 'actions', sorter: (a, b) => a.actions - b.actions, width: 100 },
        { title: 'Last seen', dataIndex: 'lastSeen', render: (d: Date | null) => (d ? dayjs(d).fromNow() : '—'), width: 130 }
    ]

    const pageColumns: ColumnsType<PageRow> = [
        {
            title: 'Page',
            key: 'page',
            render: (_, r) => (
                <Space direction='vertical' size={0} style={{ minWidth: 160 }}>
                    <Text strong>{r.label}</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>{r.page}</Text>
                </Space>
            )
        },
        { title: 'Visits', dataIndex: 'visits', sorter: (a, b) => a.visits - b.visits, width: 90 },
        { title: 'Users', dataIndex: 'users', sorter: (a, b) => a.users - b.users, width: 90 },
        { title: 'Time used', dataIndex: 'ms', render: formatDuration, sorter: (a, b) => a.ms - b.ms, defaultSortOrder: 'descend', width: 110 },
        { title: 'Avg / visit', key: 'avg', render: (_, r) => formatDuration(r.ms / r.visits), width: 100 },
        { title: 'Most done', key: 'top', render: (_, r) => <ActionTags actions={r.topActions} /> }
    ]

    const pageDetail = useMemo(() => {
        if (!openPage) return null
        const rows = filteredVisits.filter(v => v.page === openPage)
        const users = [...groupBy(rows, v => v.uid).values()]
            .map(r => ({ uid: r[0].uid, name: nameOf(r[0].uid, r[0].name || r[0].email), role: r[0].role, visits: r.length, ms: sum(r, v => v.activeMs) }))
            .sort((a, b) => b.ms - a.ms)
        return { title: pageLabels.get(openPage) || openPage, rows, users, actions: tallyActions(rows) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openPage, filteredVisits, pageLabels, names])

    const userDetail = useMemo(() => {
        if (!openUser) return null
        const row = userRows.find(u => u.uid === openUser)
        const rows = filteredVisits.filter(v => v.uid === openUser)
        const pages = [...groupBy(rows, v => v.page).entries()]
            .map(([page, r]) => ({ page, title: pageLabels.get(page) || page, visits: r.length, ms: sum(r, v => v.activeMs), actions: tallyActions(r) }))
            .sort((a, b) => b.ms - a.ms)
        return { row, rows, pages }
    }, [openUser, userRows, filteredVisits, pageLabels])

    const visitTimeline = (rows: Visit[], showUser: boolean) => (
        <Table<Visit>
            size='small'
            rowKey='id'
            dataSource={rows}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: true }}
            columns={[
                { title: 'When', dataIndex: 'at', render: (d: Date | null) => (d ? dayjs(d).format('D MMM HH:mm') : '—'), width: 110 },
                showUser
                    ? { title: 'User', key: 'user', render: (_, v) => nameOf(v.uid, v.name || v.email) }
                    : { title: 'Page', key: 'page', render: (_, v) => pageLabels.get(v.page) || v.page },
                { title: 'Active', dataIndex: 'activeMs', render: formatDuration, width: 80 },
                {
                    title: 'What was done',
                    key: 'actions',
                    render: (_, v) =>
                        v.actions.length ? (
                            <Text style={{ fontSize: 12 }}>
                                {v.actions.map(a => a.label).join(' → ')}
                                {v.actionCount > v.actions.length && ` … +${v.actionCount - v.actions.length}`}
                            </Text>
                        ) : (
                            <Text type='secondary'>Viewed only</Text>
                        )
                }
            ]}
        />
    )

    const rankUsers = userRows.filter(u => u.ms > 0).slice(0, 6)

    // The filters this tab uses, with the width each needs inline.
    const tabFilters = [
        {
            key: 'role',
            width: FILTER_WIDTH.role,
            node: (
                <Select
                    className='usage-filter-select'
                    prefix={<IdcardOutlined />}
                    value={roleFilter}
                    onChange={setRoleFilter}
                    options={[{ value: 'all', label: 'All roles' }, ...roleOptions]}
                    style={{ width: FILTER_WIDTH.role }}
                    popupMatchSelectWidth={false}
                />
            )
        },
        ...(usesUser
            ? [{
                key: 'user',
                width: FILTER_WIDTH.user,
                node: (
                    <Select
                        className='usage-filter-select'
                        prefix={<UserOutlined />}
                        showSearch
                        optionFilterProp='label'
                        value={userFilter}
                        onChange={setUserFilter}
                        options={[{ value: 'all', label: 'All users' }, ...userOptions]}
                        style={{ width: FILTER_WIDTH.user }}
                        popupMatchSelectWidth={false}
                    />
                )
            }]
            : []),
        ...(usesPage
            ? [{
                key: 'page',
                width: FILTER_WIDTH.page,
                node: (
                    <Select
                        className='usage-filter-select'
                        prefix={<FileTextOutlined />}
                        showSearch
                        optionFilterProp='label'
                        value={pageFilter}
                        onChange={setPageFilter}
                        options={[{ value: 'all', label: 'All pages' }, ...pageOptions]}
                        style={{ width: FILTER_WIDTH.page }}
                        popupMatchSelectWidth={false}
                    />
                )
            }]
            : [])
    ]
    const activeFilterCount = [roleFilter, usesUser ? userFilter : 'all', usesPage ? pageFilter : 'all'].filter(f => f !== 'all').length
    const clearFilters = () => {
        setRoleFilter('all')
        setUserFilter('all')
        setPageFilter('all')
    }
    // Inline while the tabs keep a comfortable width beside them; behind one button once the bar would squash.
    const inlineNeeds = TABS_MIN_WIDTH + ACTIONS_WIDTH + sum(tabFilters, f => f.width + BAR_GAP) + BAR_GAP
    const collapseFilters = barWidth > 0 && barWidth < inlineNeeds

    return (
        <div className='admin-overview'>
            <Helmet>
                <title>Usage | Smart Incubation</title>
            </Helmet>

            {error && <Alert type='error' showIcon message='Could not load usage' description={error} style={{ marginBottom: 16 }} />}
            {capped && (
                <Alert
                    type='warning'
                    showIcon
                    message={`Showing the latest ${READ_CAP.toLocaleString()} records only; pick a shorter period for complete figures.`}
                    style={{ marginBottom: 16 }}
                />
            )}

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} xl={6}>
                    <AdminKpiTile compact loading={loading} icon={<ClockCircleOutlined />} label='Total time used' value={formatDuration(totalMs)} visual={<AdminMiniBars bars={dailyBars(s => s.ms)} />} />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <AdminKpiTile compact loading={loading} icon={<LoginOutlined />} label='Sessions' value={filteredSessions.length} visual={<AdminMiniBars bars={dailyBars(() => 1)} />} />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<TeamOutlined />}
                        label='Active now'
                        value={online}
                        visual={
                            <span className='usage-live-pill'>
                                <i />
                                Live
                            </span>
                        }
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<BarChartOutlined />}
                        label='Most used page'
                        value={pageRows[0]?.label || 'No data'}
                        visual={pageRows[0] ? <AdminShareRing value={pageRows[0].ms} total={totalPageMs} /> : undefined}
                    />
                </Col>
            </Row>

            <div className='usage-filter-bar' ref={barRef}>
                <Segmented
                    className='usage-filter-tabs'
                    block
                    value={section}
                    onChange={v => setSection(v as typeof section)}
                    options={[
                        { value: 'overview', label: 'Overview' },
                        { value: 'users', label: 'Users' },
                        { value: 'pages', label: 'Pages' }
                    ]}
                />
                {collapseFilters ? (
                    <Popover
                        trigger='click'
                        placement='bottomRight'
                        content={
                            <div className='usage-filter-popover'>
                                {tabFilters.map(f => (
                                    <React.Fragment key={f.key}>{f.node}</React.Fragment>
                                ))}
                                <Button type='link' size='small' disabled={!activeFilterCount} onClick={clearFilters}>
                                    Clear filters
                                </Button>
                            </div>
                        }
                    >
                        <Badge count={activeFilterCount} size='small' color={token.colorPrimary}>
                            <Button icon={<FilterOutlined />}>Filters</Button>
                        </Badge>
                    </Popover>
                ) : (
                    tabFilters.map(f => <React.Fragment key={f.key}>{f.node}</React.Fragment>)
                )}
                <Space className='usage-filter-actions'>
                    <Button icon={<ReloadOutlined />} onClick={() => setReloadKey(k => k + 1)} loading={loading} aria-label='Refresh' />
                    <Button icon={<DownloadOutlined />} onClick={exportXlsx} disabled={!userRows.length && !pageRows.length}>
                        Export
                    </Button>
                </Space>
            </div>

            {section === 'overview' && (
                <>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={16}>
                            <Card className='admin-card' bordered={false} loading={loading}>
                                <CardHead title='Activity trend' hint='Page visits and active minutes per day' />
                                {filteredVisits.length ? <HighchartsReact highcharts={Highcharts} options={trendChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                            </Card>
                        </Col>
                        <Col xs={24} lg={8}>
                            <Card className='admin-card' bordered={false} loading={loading}>
                                <CardHead title='Time by role' hint='Share of logged-in time' />
                                {roleTime.length ? (
                                    <>
                                        <div className='admin-donut'>
                                            <HighchartsReact highcharts={Highcharts} options={roleChart} />
                                            <div className='admin-donut-center'>
                                                <strong className='is-text'>{formatDuration(totalMs)}</strong>
                                                <span>Total time</span>
                                            </div>
                                        </div>
                                        <ul className='admin-legend'>
                                            {roleTime.slice(0, 6).map(([role, ms], i) => (
                                                <li key={role}>
                                                    <i style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }} />
                                                    <span>{formatRole(role)}</span>
                                                    <b>{formatDuration(ms)}</b>
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
                    <Row gutter={[16, 16]} className='admin-overview-row'>
                        <Col xs={24} lg={12}>
                            <Card className='admin-card' bordered={false} loading={loading}>
                                <CardHead title='Most used pages' hint='Ranked by active time · select one to see what was done' />
                                {pageRows.length ? (
                                    <ol className='usage-rank-list'>
                                        {pageRows.slice(0, 6).map((r, i) => (
                                            <li key={r.page} className='is-clickable' onClick={() => setOpenPage(r.page)}>
                                                <span className='usage-rank-index'>{i + 1}</span>
                                                <div className='usage-rank-copy'>
                                                    <div className='usage-rank-top'>
                                                        <strong title={r.page}>{r.label}</strong>
                                                        <b>{formatDuration(r.ms)}</b>
                                                    </div>
                                                    <div className='usage-rank-bar'>
                                                        <span style={{ width: `${Math.max(4, (r.ms / (pageRows[0].ms || 1)) * 100)}%` }} />
                                                    </div>
                                                    <small>
                                                        {r.visits} visits · {r.users} users · {r.actions} actions
                                                    </small>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                ) : (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                                )}
                            </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                            <Card className='admin-card' bordered={false} loading={loading}>
                                <CardHead title='Most active users' hint='Ranked by logged-in time · select one for their activity' />
                                {rankUsers.length ? (
                                    <ol className='usage-rank-list'>
                                        {rankUsers.map(r => (
                                            <li key={r.uid} className='is-clickable' onClick={() => setOpenUser(r.uid)}>
                                                <Avatar size={36} className='usage-rank-avatar'>{initialsOf(r.name)}</Avatar>
                                                <div className='usage-rank-copy'>
                                                    <div className='usage-rank-top'>
                                                        <strong title={r.email}>{r.name}</strong>
                                                        <b>{formatDuration(r.ms)}</b>
                                                    </div>
                                                    <div className='usage-rank-bar'>
                                                        <span style={{ width: `${Math.max(4, (r.ms / (rankUsers[0].ms || 1)) * 100)}%` }} />
                                                    </div>
                                                    <small>
                                                        <AdminRoleTag role={r.role} /> {r.sessions} sessions
                                                    </small>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                ) : (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                                )}
                            </Card>
                        </Col>
                    </Row>
                </>
            )}

            {section === 'users' && (
                <>
                    <Card className='admin-card' bordered={false} loading={loading} style={{ marginBottom: 16 }}>
                        <CardHead title='Logged-in time by user' hint='Top 8 users, in minutes' />
                        {userRows.length ? <HighchartsReact highcharts={Highcharts} options={usersChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                    </Card>
                    <Card className='admin-card' bordered={false}>
                        <CardHead title='Users' hint='Select a user for their pages and actions' />
                        <Table<UserRow>
                            size='small'
                            rowKey='uid'
                            loading={loading}
                            dataSource={userRows}
                            columns={isMobile ? [userColumns[0], userColumns[3]] : userColumns}
                            pagination={{ pageSize: 10, showSizeChanger: false }}
                            scroll={{ x: isMobile ? undefined : 900 }}
                            onRow={r => ({ onClick: () => setOpenUser(r.uid), style: { cursor: 'pointer' } })}
                        />
                    </Card>
                </>
            )}

            {section === 'pages' && (
                <>
                    <Card className='admin-card' bordered={false} loading={loading} style={{ marginBottom: 16 }}>
                        <CardHead title='Time by page' hint='Top 8 pages, in active minutes' />
                        {pageRows.length ? <HighchartsReact highcharts={Highcharts} options={pagesChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                    </Card>
                    <Card className='admin-card' bordered={false}>
                        <CardHead title='Pages' hint='Select a page to see what was done there' />
                        <Table<PageRow>
                            size='small'
                            rowKey='page'
                            loading={loading}
                            dataSource={pageRows}
                            columns={isMobile ? [pageColumns[0], pageColumns[3]] : pageColumns}
                            pagination={{ pageSize: 10, showSizeChanger: false }}
                            scroll={{ x: isMobile ? undefined : 900 }}
                            onRow={r => ({ onClick: () => setOpenPage(r.page), style: { cursor: 'pointer' } })}
                        />
                    </Card>
                </>
            )}

            <Drawer open={!!pageDetail} onClose={() => setOpenPage(null)} width={isMobile ? '100%' : 760} title={pageDetail?.title} destroyOnClose>
                {pageDetail && (
                    <Space direction='vertical' size={20} style={{ width: '100%' }}>
                        <div>
                            <Text strong>What was done here</Text>
                            <Table<ActionStat>
                                size='small'
                                rowKey={a => `${a.kind}|${a.label}`}
                                dataSource={pageDetail.actions}
                                pagination={{ pageSize: 8, showSizeChanger: false }}
                                locale={{ emptyText: 'Only viewed, nothing clicked' }}
                                style={{ marginTop: 8 }}
                                columns={[
                                    { title: 'Action', dataIndex: 'label' },
                                    { title: 'Type', dataIndex: 'kind', render: (k: string) => <Tag color={KIND_COLOR[k]} bordered={false}>{k}</Tag>, width: 100 },
                                    { title: 'Times', dataIndex: 'count', width: 80 }
                                ]}
                            />
                        </div>
                        <div>
                            <Text strong>Who used it</Text>
                            <Table
                                size='small'
                                rowKey='uid'
                                dataSource={pageDetail.users}
                                pagination={{ pageSize: 8, showSizeChanger: false }}
                                style={{ marginTop: 8 }}
                                columns={[
                                    { title: 'User', dataIndex: 'name' },
                                    { title: 'Role', dataIndex: 'role', render: (r: string) => <AdminRoleTag role={r} /> },
                                    { title: 'Visits', dataIndex: 'visits', width: 80 },
                                    { title: 'Active time', dataIndex: 'ms', render: formatDuration, width: 110 }
                                ]}
                            />
                        </div>
                        <div>
                            <Text strong>Visits</Text>
                            <div style={{ marginTop: 8 }}>{visitTimeline(pageDetail.rows, true)}</div>
                        </div>
                    </Space>
                )}
            </Drawer>

            <Drawer
                open={!!userDetail}
                onClose={() => setOpenUser(null)}
                width={isMobile ? '100%' : 760}
                title={userDetail?.row ? `${userDetail.row.name}${userDetail.row.email ? ` · ${userDetail.row.email}` : ''}` : ''}
                destroyOnClose
            >
                {userDetail && (
                    <Space direction='vertical' size={20} style={{ width: '100%' }}>
                        {userDetail.row && (
                            <Space wrap>
                                <AdminRoleTag role={userDetail.row.role} />
                                <Tag bordered={false}>{userDetail.row.sessions} sessions</Tag>
                                <Tag bordered={false}>{formatDuration(userDetail.row.ms)} logged in</Tag>
                                <Tag bordered={false}>{userDetail.row.actions} actions</Tag>
                            </Space>
                        )}
                        <div>
                            <Text strong>Pages used</Text>
                            <Table
                                size='small'
                                rowKey='page'
                                dataSource={userDetail.pages}
                                pagination={{ pageSize: 8, showSizeChanger: false }}
                                scroll={{ x: true }}
                                style={{ marginTop: 8 }}
                                locale={{ emptyText: 'No page visits recorded in this period' }}
                                columns={[
                                    { title: 'Page', dataIndex: 'title' },
                                    { title: 'Visits', dataIndex: 'visits', width: 70 },
                                    { title: 'Active', dataIndex: 'ms', render: formatDuration, width: 80 },
                                    { title: 'Most done', dataIndex: 'actions', render: (a: ActionStat[]) => <ActionTags actions={a} /> }
                                ]}
                            />
                        </div>
                        <div>
                            <Text strong>Visits</Text>
                            <div style={{ marginTop: 8 }}>{visitTimeline(userDetail.rows, false)}</div>
                        </div>
                    </Space>
                )}
            </Drawer>
        </div>
    )
}

export default UsageStatistics
