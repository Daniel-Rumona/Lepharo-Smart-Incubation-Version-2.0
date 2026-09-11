import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Alert,
    Button,
    Col,
    Empty,
    Input,
    Modal,
    Row,
    Select,
    Space,
    Table,
    Tag,
    Typography,
    message,
    Segmented,
    Card
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    SearchOutlined,
    DownloadOutlined,
    TeamOutlined,
    HourglassOutlined,
    UserOutlined,
    EyeOutlined,
    BarChartOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    where
} from 'firebase/firestore'
import * as XLSX from 'xlsx'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { db } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { Helmet } from 'react-helmet'

const { Text } = Typography

type SessionRole = 'operations' | 'consultant' | 'projectmanager' | 'projectadmin'

type GroupedRow = {
    id: string
    email: string
    name?: string
    departmentName?: string
    roles: string[]
    lastStartedAt: any
    lastSeenAt: any
    lastEndedAt: any
    active: boolean
    sessionsToday: number
    sessionsWindow: number
    durWindowMins: number
}

type ActivityPoint = {
    day: string
    sessions: number
    durationMins: number
}

type DeltaDirection = 'up' | 'down' | 'flat'

type MetricDelta = {
    value: number
    percent: number
    direction: DeltaDirection
    label: string
}

const roundNumber = (value: number, decimals = 1) => {
    if (!Number.isFinite(value)) return 0
    return Number(value.toFixed(decimals))
}

const buildDelta = (
    currentValue: number,
    previousValue: number,
    label = 'vs previous period',
    decimals = 1
): MetricDelta => {
    const rawValue = currentValue - previousValue
    const value = roundNumber(rawValue, decimals)

    const rawPercent =
        previousValue > 0
            ? (rawValue / previousValue) * 100
            : currentValue > 0
                ? 100
                : 0

    return {
        value,
        percent: roundNumber(rawPercent, decimals),
        direction: value > 0 ? 'up' : value < 0 ? 'down' : 'flat',
        label
    }
}

const formatDeltaNumber = (value: number, decimals = 1) => {
    if (!Number.isFinite(value)) return '0'

    return value % 1 === 0
        ? value.toFixed(0)
        : value.toFixed(decimals)
}

const renderDelta = (delta: MetricDelta) => {
    const color =
        delta.direction === 'up'
            ? '#52c41a'
            : delta.direction === 'down'
                ? '#ff4d4f'
                : 'rgba(0,0,0,.45)'

    const valueSign = delta.value > 0 ? '+' : ''
    const percentSign = delta.percent > 0 ? '+' : ''

    return (
        <span style={{ color, fontWeight: 600 }}>
            {valueSign}
            {formatDeltaNumber(delta.value)} ({percentSign}
            {formatDeltaNumber(delta.percent)}%) {delta.label}
        </span>
    )
}

const ALLOWED_ROLES: SessionRole[] = ['operations', 'consultant', 'projectmanager', 'projectadmin']

const ROLE_LABEL_MAP: Record<string, string> = {
    consultant: 'Coordinator',
    projectmanager: 'Coordinator',
    operations: 'HOD',
    projectadmin: 'Center Coordinator'
}

const roleBadgeColor = (role: string) => {
    switch (role) {
        case 'operations':
            return 'blue'
        case 'consultant':
            return 'purple'
        case 'projectmanager':
            return 'geekblue'
        case 'projectadmin':
            return 'green'
        default:
            return 'default'
    }
}

const tsToDate = (v: any): Date | null => {
    if (!v) return null
    if (v?.toDate) return v.toDate()
    if (v instanceof Date) return v
    if (typeof v === 'string' || typeof v === 'number') {
        const d = new Date(v)
        return Number.isNaN(d.getTime()) ? null : d
    }
    return null
}

const tsToMs = (v: any): number | null => {
    const d = tsToDate(v)
    return d ? d.getTime() : null
}

const msToMin = (ms: number) => Math.max(0, Math.round(ms / 60000))

const formatDuration = (mins: number) => {
    const m = Math.floor(mins || 0)
    const h = Math.floor(m / 60)
    const mm = m % 60
    if (h <= 0) return `${mm}m`
    return `${h}h ${mm}m`
}

const formatDateCell = (v: any) => {
    const d = tsToDate(v)
    return d ? d.toLocaleString() : '—'
}

const getSessionQueryLimit = (days: number) => {
    if (days <= 7) return 1000
    if (days <= 14) return 2000
    if (days <= 30) return 4000
    if (days <= 120) return 8000
    return 12000
}

const isInternalEmail = (email: any) => {
    const e = String(email || '').trim().toLowerCase()
    return e.endsWith('@quantilytix.co.za')
}

const normalizeRole = (role: any) => String(role || '').trim().toLowerCase()

const formatDayLabel = (date: Date) =>
    date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
    })


export const MonitoringActivity: React.FC = () => {
    const [loadingUsers, setLoadingUsers] = useState(true)
    const [loadingSessions, setLoadingSessions] = useState(true)
    const [loadingMetrics, setLoadingMetrics] = useState(true)

    const pageLoading = loadingUsers || loadingSessions || loadingMetrics
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
    const initialPageLoading = pageLoading && !hasLoadedOnce

    const [recentSessions, setRecentSessions] = useState<GroupedRow[]>([])
    const [previousActiveNow, setPreviousActiveNow] = useState(0)
    const [previousSessionsToday, setPreviousSessionsToday] = useState(0)
    const [previousAvgMinsWindow, setPreviousAvgMinsWindow] = useState(0)
    const [activeNow, setActiveNow] = useState(0)
    const [sessionsToday, setSessionsToday] = useState(0)
    const [avgMinsWindow, setAvgMinsWindow] = useState<number>(0)
    const [windowDays, setWindowDays] = useState<number>(14)

    const [roleFilter, setRoleFilter] = useState<string[]>([])
    const [searchText, setSearchText] = useState<string>('')

    const [nameByEmail, setNameByEmail] = useState<Map<string, string>>(new Map())
    const [deptByEmail, setDeptByEmail] = useState<Map<string, string>>(new Map())
    const usersLoadedRef = useRef(false)

    const [viewModalOpen, setViewModalOpen] = useState(false)
    const [selectedUser, setSelectedUser] = useState<GroupedRow | null>(null)
    const [selectedUserSeries, setSelectedUserSeries] = useState<ActivityPoint[]>([])
    const [loadingSelectedActivity, setLoadingSelectedActivity] = useState(false)

    const windowLabel = `Last ${windowDays} days`

    const isAllowedRole = (role: any) => ALLOWED_ROLES.includes(normalizeRole(role) as SessionRole)


    const calculateWindowMetrics = (docs: any[], now = Date.now()) => {
        const activeUsers = new Set<string>()
        const windowUsers = new Set<string>()

        let durSum = 0
        let durN = 0

        docs.forEach(s => {
            const email = String(s?.email || '').trim().toLowerCase()
            const role = normalizeRole(s?.role)

            if (!email || isInternalEmail(email) || !isAllowedRole(role)) return

            const startedMs = tsToMs(s.startedAt)
            const lastSeenMs = tsToMs(s.lastSeenAt)
            const endedMs = tsToMs(s.endedAt)

            if (!startedMs) return

            windowUsers.add(email)

            if (!endedMs && lastSeenMs && now - lastSeenMs <= 10 * 60 * 1000) {
                activeUsers.add(email)
            }

            const endMs = endedMs || lastSeenMs

            if (endMs && endMs >= startedMs) {
                durSum += msToMin(endMs - startedMs)
                durN++
            }
        })

        return {
            activeNow: activeUsers.size,
            usersInWindow: windowUsers.size,
            avgMins: durN ? Number((durSum / durN).toFixed(1)) : 0
        }
    }

    const calculatePreviousWindowMetrics = (docs: any[], previousEndMs: number) => {
        const activeUsers = new Set<string>()
        const windowUsers = new Set<string>()

        let durSum = 0
        let durN = 0

        docs.forEach(s => {
            const email = String(s?.email || '').trim().toLowerCase()
            const role = normalizeRole(s?.role)

            if (!email || isInternalEmail(email) || !isAllowedRole(role)) return

            const startedMs = tsToMs(s.startedAt)
            const lastSeenMs = tsToMs(s.lastSeenAt)
            const endedMs = tsToMs(s.endedAt)

            if (!startedMs) return

            windowUsers.add(email)

            if (!endedMs && lastSeenMs && previousEndMs - lastSeenMs <= 10 * 60 * 1000) {
                activeUsers.add(email)
            }

            const endMs = endedMs || lastSeenMs

            if (endMs && endMs >= startedMs) {
                durSum += msToMin(endMs - startedMs)
                durN++
            }
        })

        return {
            activeNow: activeUsers.size,
            usersInWindow: windowUsers.size,
            avgMins: durN ? Number((durSum / durN).toFixed(1)) : 0
        }
    }

    useEffect(() => {
        if (!pageLoading) {
            setHasLoadedOnce(true)
        }
    }, [pageLoading])

    useEffect(() => {
        if (usersLoadedRef.current) {
            setLoadingUsers(false)
            return
        }

        usersLoadedRef.current = true

            ; (async () => {
                try {
                    setLoadingUsers(true)

                    const snap = await getDocs(query(collection(db, 'users'), limit(5000)))
                    const nameMap = new Map<string, string>()
                    const deptMap = new Map<string, string>()

                    snap.docs.forEach(d => {
                        const u: any = d.data()
                        const email = String(u?.email || '').trim().toLowerCase()

                        if (!email || isInternalEmail(email)) return

                        const resolvedName =
                            u?.name ||
                            u?.fullName ||
                            u?.displayName ||
                            `${u?.firstName || ''} ${u?.lastName || ''}`.trim() ||
                            u?.email ||
                            ''

                        const resolvedDepartment =
                            u?.departmentName ||
                            u?.department ||
                            u?.departmentId ||
                            ''

                        if (resolvedName) nameMap.set(email, String(resolvedName))
                        if (resolvedDepartment) deptMap.set(email, String(resolvedDepartment))
                    })

                    setNameByEmail(nameMap)
                    setDeptByEmail(deptMap)
                } catch (err) {
                    console.error('Failed to load user lookup data:', err)
                    setNameByEmail(new Map())
                    setDeptByEmail(new Map())
                } finally {
                    setLoadingUsers(false)
                }
            })()
    }, [])

    useEffect(() => {
        setLoadingSessions(true)
        setLoadingMetrics(true)

        const startDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

        const qSessions = query(
            collection(db, 'userSessions'),
            where('startedAt', '>=', startDate),
            orderBy('startedAt', 'desc'),
            limit(getSessionQueryLimit(windowDays))
        )

        let cancelled = false

        const unsub = onSnapshot(
            qSessions,
            snap => {
                try {
                    const raw = snap.docs.map(d => d.data() as any)
                    const currentMetrics = calculateWindowMetrics(raw, Date.now())

                    if (!cancelled) {
                        setActiveNow(currentMetrics.activeNow)
                        setSessionsToday(currentMetrics.usersInWindow)
                        setAvgMinsWindow(currentMetrics.avgMins)
                    }
                    const now = Date.now()
                    const todayStart = new Date()
                    todayStart.setHours(0, 0, 0, 0)

                    const byEmail = new Map<string, GroupedRow>()

                    const ensure = (email: string) => {
                        const key = String(email || '').trim().toLowerCase() || 'unknown'

                        if (!byEmail.has(key)) {
                            byEmail.set(key, {
                                id: key,
                                email: key,
                                name: nameByEmail.get(key),
                                departmentName: deptByEmail.get(key),
                                roles: [],
                                lastStartedAt: null,
                                lastSeenAt: null,
                                lastEndedAt: null,
                                active: false,
                                sessionsToday: 0,
                                sessionsWindow: 0,
                                durWindowMins: 0
                            })
                        }

                        return byEmail.get(key)!
                    }

                    raw.forEach(s => {
                        const email = String(s?.email || '').trim().toLowerCase()
                        const role = normalizeRole(s?.role)

                        if (!email || isInternalEmail(email) || !isAllowedRole(role)) return

                        const g = ensure(email)

                        const startedMs = tsToMs(s.startedAt)
                        const lastSeenMs = tsToMs(s.lastSeenAt)
                        const endedMs = tsToMs(s.endedAt)

                        if (role && !g.roles.includes(role)) g.roles.push(role)

                        if (!endedMs && lastSeenMs && now - lastSeenMs <= 10 * 60 * 1000) {
                            g.active = true
                        }

                        if (startedMs && startedMs >= todayStart.getTime()) {
                            g.sessionsToday++
                        }

                        if (startedMs && startedMs >= startDate.getTime()) {
                            const endMs = endedMs || lastSeenMs

                            if (endMs && endMs >= startedMs) {
                                g.sessionsWindow++
                                g.durWindowMins += msToMin(endMs - startedMs)
                            }
                        }

                        if (
                            !g.lastStartedAt ||
                            (startedMs && startedMs > (tsToMs(g.lastStartedAt) || 0))
                        ) {
                            g.lastStartedAt = s.startedAt
                        }

                        if (
                            !g.lastSeenAt ||
                            (lastSeenMs && lastSeenMs > (tsToMs(g.lastSeenAt) || 0))
                        ) {
                            g.lastSeenAt = s.lastSeenAt
                        }

                        if (
                            endedMs &&
                            (!g.lastEndedAt || endedMs > (tsToMs(g.lastEndedAt) || 0))
                        ) {
                            g.lastEndedAt = s.endedAt
                        }
                    })

                    if (!cancelled) {
                        setRecentSessions(
                            Array.from(byEmail.values()).sort((a, b) => {
                                const aMs =
                                    tsToMs(a.lastSeenAt) ||
                                    tsToMs(a.lastStartedAt) ||
                                    0

                                const bMs =
                                    tsToMs(b.lastSeenAt) ||
                                    tsToMs(b.lastStartedAt) ||
                                    0

                                return bMs - aMs
                            })
                        )
                    }
                } catch (err) {
                    console.error('Failed to process monitoring sessions:', err)

                    if (!cancelled) {
                        setRecentSessions([])
                    }
                } finally {
                    if (!cancelled) {
                        setLoadingSessions(false)
                    }
                }
            },
            err => {
                console.error('Failed to load monitoring sessions:', err)

                if (!cancelled) {
                    setRecentSessions([])
                    setLoadingSessions(false)
                }
            }
        )

            ; (async () => {
                try {
                    const now = Date.now()
                    const windowMs = windowDays * 24 * 60 * 60 * 1000

                    const currentStartDate = new Date(now - windowMs)
                    const previousStartDate = new Date(now - windowMs * 2)
                    const previousEndDate = currentStartDate

                    const previousSnap = await getDocs(
                        query(
                            collection(db, 'userSessions'),
                            where('startedAt', '>=', previousStartDate),
                            where('startedAt', '<', previousEndDate),
                            orderBy('startedAt', 'desc'),
                            limit(getSessionQueryLimit(windowDays))
                        )
                    )

                    const previousRows = previousSnap.docs.map(d => d.data() as any)

                    const previous = calculatePreviousWindowMetrics(
                        previousRows,
                        previousEndDate.getTime()
                    )

                    if (!cancelled) {
                        setPreviousActiveNow(previous.activeNow)
                        setPreviousSessionsToday(previous.usersInWindow)
                        setPreviousAvgMinsWindow(previous.avgMins)
                    }
                } catch (err) {
                    console.error('Failed to load previous monitoring metrics:', err)

                    if (!cancelled) {
                        setPreviousActiveNow(0)
                        setPreviousSessionsToday(0)
                        setPreviousAvgMinsWindow(0)
                    }
                } finally {
                    if (!cancelled) {
                        setLoadingMetrics(false)
                    }
                }
            })()

        return () => {
            cancelled = true
            unsub()
        }
    }, [windowDays, nameByEmail, deptByEmail])

    useEffect(() => {
        if (!viewModalOpen || !selectedUser?.email) {
            setSelectedUserSeries([])
            return
        }

        const startDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
        setLoadingSelectedActivity(true)

        const qSessions = query(
            collection(db, 'userSessions'),
            where('startedAt', '>=', startDate),
            orderBy('startedAt', 'asc'),
            limit(getSessionQueryLimit(windowDays))
        )

        const unsub = onSnapshot(
            qSessions,
            snap => {
                const targetEmail = String(selectedUser.email || '').trim().toLowerCase()
                const bucket = new Map<string, ActivityPoint>()

                snap.docs.forEach(docSnap => {
                    const s: any = docSnap.data()

                    const email = String(s?.email || '').trim().toLowerCase()
                    const role = normalizeRole(s?.role)

                    if (!email || email !== targetEmail) return
                    if (isInternalEmail(email) || !isAllowedRole(role)) return

                    const startedAt = tsToDate(s?.startedAt)
                    const startedMs = tsToMs(s?.startedAt)
                    const endedMs = tsToMs(s?.endedAt)
                    const lastSeenMs = tsToMs(s?.lastSeenAt)

                    if (!startedAt || !startedMs) return

                    const key = startedAt.toISOString().slice(0, 10)
                    const label = formatDayLabel(startedAt)
                    const endMs = endedMs || lastSeenMs || startedMs
                    const durationMins = endMs >= startedMs ? msToMin(endMs - startedMs) : 0

                    if (!bucket.has(key)) {
                        bucket.set(key, {
                            day: label,
                            sessions: 0,
                            durationMins: 0
                        })
                    }

                    const item = bucket.get(key)!
                    item.sessions += 1
                    item.durationMins += durationMins
                })

                const result = Array.from(bucket.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([, value]) => value)

                setSelectedUserSeries(result)
                setLoadingSelectedActivity(false)
            },
            err => {
                console.error('Failed to load selected user activity:', err)
                setSelectedUserSeries([])
                setLoadingSelectedActivity(false)
            }
        )

        return () => unsub()
    }, [viewModalOpen, selectedUser, windowDays])

    const exportFilteredToExcel = () => {
        if (!filteredRows.length) {
            message.info('Nothing to export.')
            return
        }

        const exportedAt = new Date()

        const rows = filteredRows.map((r, index) => ({
            '#': index + 1,
            'User Name': r.name || '—',
            'Role': r.roles.map(role => ROLE_LABEL_MAP[role] || role).join(', ') || '—',
            Department: r.departmentName || '—',
            Status: r.active ? 'Active' : 'Idle',
            'Last Login': tsToDate(r.lastStartedAt)?.toLocaleString() || '—',
            'Last Seen': tsToDate(r.lastSeenAt)?.toLocaleString() || '—',
            'Sessions Today': r.sessionsToday || 0,
            [`Sessions - Last ${windowDays} Days`]: r.sessionsWindow || 0,
            [`Total Duration - Last ${windowDays} Days`]: formatDuration(r.durWindowMins),
            [`Total Duration Minutes - Last ${windowDays} Days`]: r.durWindowMins || 0
        }))

        const title = `User Monitoring Activity Report`
        const period = `Reporting Window: Last ${windowDays} days`
        const generated = `Generated: ${exportedAt.toLocaleString()}`
        const totalUsers = `Total Users Exported: ${filteredRows.length}`

        const worksheetData = [
            [title],
            [period],
            [generated],
            [totalUsers],
            [],
            Object.keys(rows[0]),
            ...rows.map(row => Object.values(row))
        ]

        const ws = XLSX.utils.aoa_to_sheet(worksheetData)

        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
            { s: { r: 2, c: 0 }, e: { r: 2, c: 10 } },
            { s: { r: 3, c: 0 }, e: { r: 3, c: 10 } }
        ]

        ws['!cols'] = [
            { wch: 6 },
            { wch: 28 },
            { wch: 26 },
            { wch: 28 },
            { wch: 14 },
            { wch: 24 },
            { wch: 24 },
            { wch: 18 },
            { wch: 24 },
            { wch: 28 },
            { wch: 32 }
        ]

        ws['!autofilter'] = {
            ref: `A6:K${rows.length + 6}`
        }

        ws['!freeze'] = {
            xSplit: 0,
            ySplit: 6
        } as any

        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')

        for (let row = range.s.r; row <= range.e.r; row++) {
            for (let col = range.s.c; col <= range.e.c; col++) {
                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col })
                const cell = ws[cellAddress]

                if (!cell) continue

                if (row === 0) {
                    cell.s = {
                        font: { bold: true, sz: 16 },
                        alignment: { horizontal: 'center' }
                    }
                }

                if (row >= 1 && row <= 3) {
                    cell.s = {
                        font: { bold: true },
                        alignment: { horizontal: 'left' }
                    }
                }

                if (row === 5) {
                    cell.s = {
                        font: { bold: true },
                        alignment: { horizontal: 'center' },
                        fill: { fgColor: { rgb: 'F2F2F2' } },
                        border: {
                            top: { style: 'thin', color: { rgb: 'CCCCCC' } },
                            bottom: { style: 'thin', color: { rgb: 'CCCCCC' } }
                        }
                    }
                }
            }
        }

        const wb = XLSX.utils.book_new()

        XLSX.utils.book_append_sheet(wb, ws, `Activity ${windowDays}d`)

        const safeDate = exportedAt
            .toISOString()
            .slice(0, 10)

        XLSX.writeFile(
            wb,
            `user-monitoring-activity-last-${windowDays}-days-${safeDate}.xlsx`
        )
    }

    const filteredRows = useMemo(() => {
        const q = searchText.trim().toLowerCase()

        return recentSessions
            .filter(r => !isInternalEmail(r.email))
            .filter(r => (r.roles || []).some(isAllowedRole))
            .filter(r => {
                if (roleFilter.length && !r.roles.some(rr => roleFilter.includes(rr))) return false
                if (!q) return true

                const roleLabels = r.roles
                    .map(role => ROLE_LABEL_MAP[role] || role)
                    .join(' ')
                    .toLowerCase()

                return (
                    (r.name || '').toLowerCase().includes(q) ||
                    (r.departmentName || '').toLowerCase().includes(q) ||
                    roleLabels.includes(q)
                )
            })
    }, [recentSessions, roleFilter, searchText])

    const allRoles = useMemo(() => {
        const s = new Set<string>()
        recentSessions.forEach(r => {
            ; (r.roles || []).forEach(role => {
                const normalized = normalizeRole(role)
                if (isAllowedRole(normalized)) s.add(normalized)
            })
        })
        return Array.from(s)
    }, [recentSessions])

    const topUsers = useMemo(() => {
        return [...filteredRows]
            .sort((a, b) => {
                if (b.durWindowMins !== a.durWindowMins) return b.durWindowMins - a.durWindowMins
                if (b.sessionsWindow !== a.sessionsWindow) return b.sessionsWindow - a.sessionsWindow
                return (b.sessionsToday || 0) - (a.sessionsToday || 0)
            })
            .slice(0, 10)
    }, [filteredRows])

    const topUsersChartOptions = useMemo(() => {
        return {
            chart: {
                type: 'bar',
                height: 420
            },
            title: {
                text: undefined
            },
            credits: {
                enabled: false
            },
            xAxis: {
                categories: topUsers.map(u => u.name || u.departmentName || '—'),
                title: {
                    text: null
                }
            },
            yAxis: [
                {
                    title: {
                        text: 'Duration (mins)'
                    }
                },
                {
                    title: {
                        text: 'Sessions'
                    },
                    opposite: true
                }
            ],
            tooltip: {
                shared: true
            },
            legend: {
                enabled: true
            },
            plotOptions: {
                series: {
                    dataLabels: {
                        enabled: true,
                        style: {
                            fontWeight: 'bold'
                        }
                    }
                }
            },
            series: [
                {
                    type: 'bar',
                    name: 'Duration (mins)',
                    data: topUsers.map(u => u.durWindowMins),
                    yAxis: 0,
                    dataLabels: {
                        enabled: true,
                        format: '{y}m'
                    }
                },
                {
                    type: 'bar',
                    name: 'Sessions',
                    data: topUsers.map(u => u.sessionsWindow),
                    yAxis: 1,
                    dataLabels: {
                        enabled: true,
                        format: '{y}'
                    }
                }
            ]
        }
    }, [topUsers])

    const selectedUserChartOptions = useMemo(() => {
        return {
            chart: {
                zoomType: 'xy',
                height: 380
            },
            title: {
                text: undefined
            },
            credits: {
                enabled: false
            },
            xAxis: {
                categories: selectedUserSeries.map(p => p.day)
            },
            yAxis: [
                {
                    title: {
                        text: 'Sessions'
                    }
                },
                {
                    title: {
                        text: 'Duration (mins)'
                    },
                    opposite: true
                }
            ],
            tooltip: {
                shared: true
            },
            legend: {
                enabled: true
            },
            plotOptions: {
                series: {
                    dataLabels: {
                        enabled: true,
                        style: {
                            fontWeight: 'bold'
                        }
                    }
                }
            },
            series: [
                {
                    type: 'column',
                    name: 'Sessions',
                    data: selectedUserSeries.map(p => p.sessions),
                    yAxis: 0,
                    dataLabels: {
                        enabled: true,
                        format: '{y}'
                    }
                },
                {
                    type: 'spline',
                    name: 'Duration (mins)',
                    data: selectedUserSeries.map(p => p.durationMins),
                    yAxis: 1,
                    dataLabels: {
                        enabled: true,
                        format: '{y}m'
                    }
                }
            ]
        }
    }, [selectedUserSeries])

    const openActivityModal = (record: GroupedRow) => {
        setSelectedUser(record)
        setViewModalOpen(true)
    }

    const activeNowDelta = useMemo(
        () => buildDelta(activeNow, previousActiveNow),
        [activeNow, previousActiveNow]
    )

    const usersWindowDelta = useMemo(
        () => buildDelta(sessionsToday, previousSessionsToday),
        [sessionsToday, previousSessionsToday]
    )

    const avgDurationDelta = useMemo(
        () => buildDelta(avgMinsWindow, previousAvgMinsWindow),
        [avgMinsWindow, previousAvgMinsWindow]
    )

    const sessionColumns: ColumnsType<GroupedRow> = [
        {
            title: 'User',
            key: 'user',
            render: (_, record) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{record.name || '—'}</Text>
                    <Text type="secondary">{record.departmentName || '—'}</Text>
                </Space>
            )
        },
        {
            title: 'Role',
            dataIndex: 'roles',
            key: 'roles',
            render: (roles: string[]) => (
                <Space wrap>
                    {(roles || [])
                        .filter(isAllowedRole)
                        .map(role => (
                            <Tag key={role} color={roleBadgeColor(role)} style={{ borderRadius: 999 }}>
                                {ROLE_LABEL_MAP[role] || role}
                            </Tag>
                        ))}
                </Space>
            )
        },
        {
            title: 'Status',
            dataIndex: 'active',
            key: 'active',
            render: (v: boolean) => (
                <Tag color={v ? 'success' : 'default'} style={{ borderRadius: 999 }}>
                    {v ? 'Active' : 'Idle'}
                </Tag>
            )
        },
        {
            title: 'Last Login',
            dataIndex: 'lastStartedAt',
            key: 'lastStartedAt',
            render: formatDateCell
        },
        {
            title: 'Last Seen',
            dataIndex: 'lastSeenAt',
            key: 'lastSeenAt',
            render: formatDateCell
        },
        {
            title: 'Sessions Today',
            dataIndex: 'sessionsToday',
            key: 'sessionsToday',
            render: (v: number) => <Tag style={{ borderRadius: 999 }}>{v}</Tag>
        },
        {
            title: `Sessions (${windowDays}d)`,
            dataIndex: 'sessionsWindow',
            key: 'sessionsWindow',
            render: (v: number) => <Tag style={{ borderRadius: 999 }}>{v}</Tag>
        },
        {
            title: `Duration (${windowDays}d)`,
            dataIndex: 'durWindowMins',
            key: 'durWindowMins',
            render: (v: number) => (
                <Tag color="purple" style={{ borderRadius: 999 }}>
                    {formatDuration(v)}
                </Tag>
            )
        },
        {
            title: 'Action',
            key: 'action',
            width: 140,
            render: (_, record) => (
                <Button
                    icon={<EyeOutlined />}
                    type="default"
                    shape="round"
                    onClick={() => openActivityModal(record)}
                >
                    View Activity
                </Button>
            )
        }
    ]

    const topUsersColumns: ColumnsType<GroupedRow> = [
        {
            title: '#',
            key: 'rank',
            width: 60,
            render: (_, __, index) => <Text strong>{index + 1}</Text>
        },
        {
            title: 'User',
            key: 'user',
            render: (_, record) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{record.name || '—'}</Text>
                    <Text type="secondary">{record.departmentName || '—'}</Text>
                </Space>
            )
        },
        {
            title: 'Duration',
            dataIndex: 'durWindowMins',
            key: 'durWindowMins',
            render: (v: number) => (
                <Tag color="purple" style={{ borderRadius: 999 }}>
                    {formatDuration(v)}
                </Tag>
            )
        }
    ]

    if (initialPageLoading) {
        return (
            <div style={{ minHeight: '100vh' }}>
                <Helmet>
                    <title>User Activity | Smart Incubation</title>
                </Helmet>
                <LoadingOverlay tip="Loading user monitoring activity" />
            </div>
        )
    }

    return (
        <div style={{ padding: 24, minHeight: '100%' }}>
            <Helmet>
                <title>
                    User Activity | Smart Incubation
                </title>
            </Helmet>
            <Row gutter={[16, 16]} style={{ marginBottom: 15 }}>
                <Col xs={24} md={8}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<UserOutlined />}
                            iconBg="rgba(82,196,26,0.12)"
                            title="Active Now"
                            value={activeNow}
                            subtitle={
                                loadingMetrics
                                    ? <Text type="secondary">Calculating comparison...</Text>
                                    : renderDelta(activeNowDelta)
                            }
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} md={8}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<TeamOutlined />}
                            iconBg="rgba(22,119,255,0.12)"
                            title={`Active Users (${windowLabel})`}
                            value={sessionsToday}
                            subtitle={
                                loadingMetrics
                                    ? <Text type="secondary">Calculating comparison...</Text>
                                    : renderDelta(usersWindowDelta)
                            }
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} md={8}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<HourglassOutlined />}
                            iconBg="rgba(114,46,209,0.12)"
                            title={`Avg Duration (${windowLabel})`}
                            value={`${avgMinsWindow} min`}
                            subtitle={
                                loadingMetrics
                                    ? <Text type="secondary">Calculating comparison...</Text>
                                    : renderDelta(avgDurationDelta)
                            }
                        />
                    </MotionCard>
                </Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={16}>
                    <MotionCard
                        title={`Monitoring Activity — ${windowLabel}`}
                        filterBar={
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    flexWrap: 'wrap'
                                }}
                            >
                                <Segmented
                                    value={windowDays}
                                    onChange={v => setWindowDays(Number(v))}
                                    options={[7, 14, 30, 120].map(v => ({ label: `${v} days`, value: v }))}
                                />

                                <Select
                                    mode="multiple"
                                    allowClear
                                    placeholder="Filter by role"
                                    style={{ minWidth: 220, flex: '0 0 260px' }}
                                    value={roleFilter}
                                    onChange={setRoleFilter}
                                    optionFilterProp="label"
                                    options={allRoles.map(role => ({
                                        value: role,
                                        label: ROLE_LABEL_MAP[role] || role
                                    }))}
                                />

                                <Input
                                    allowClear
                                    prefix={<SearchOutlined />}
                                    placeholder="Search user or department"
                                    value={searchText}
                                    onChange={e => setSearchText(e.target.value)}
                                    style={{ minWidth: 240, flex: 1 }}
                                />

                                <Button
                                    icon={<DownloadOutlined />}
                                    onClick={exportFilteredToExcel}
                                    style={{ marginLeft: 'auto' }}
                                >
                                    Export Excel
                                </Button>
                            </div>
                        }
                        filterBarProps={{
                            background: '#fafafa',
                            borderColor: '#d9d9d9',
                            borderRadius: 12,
                            boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06)',
                            padding: 14,
                            marginBottom: 16
                        }}
                    >
                        <Table<GroupedRow>
                            rowKey="id"
                            dataSource={filteredRows}
                            columns={sessionColumns}
                            pagination={{ pageSize: 10, showSizeChanger: false }}
                            locale={{
                                emptyText: (
                                    <Empty
                                        description="No monitoring activity found."
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    />
                                )
                            }}
                            scroll={{ x: 1100 }}
                        />

                        <Alert
                            showIcon
                            type="info"
                            message="Session durations are estimated from recorded activity."
                            style={{ marginTop: 16, borderRadius: 12 }}
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} xl={8}>
                    <MotionCard
                        title={`Top 10 Engaged Users — ${windowLabel}`}
                        style={{ height: '100%' }}
                    >
                        {topUsers.length ? (
                            <>
                                <div style={{ marginBottom: 16 }}>
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        options={topUsersChartOptions}
                                    />
                                </div>

                                <Table<GroupedRow>
                                    rowKey="id"
                                    dataSource={topUsers}
                                    columns={topUsersColumns}
                                    pagination={false}
                                    size="small"
                                    scroll={{ x: 700 }}
                                />
                            </>
                        ) : (
                            <Empty
                                description="No engagement data found."
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                            />
                        )}
                    </MotionCard>
                </Col>
            </Row>

            <Modal
                title={
                    <Space>
                        <BarChartOutlined />
                        <span>Activity Overview</span>
                    </Space>
                }
                open={viewModalOpen}
                onCancel={() => {
                    setViewModalOpen(false)
                    setSelectedUser(null)
                }}
                footer={null}
                width={1000}
                destroyOnClose
            >
                {selectedUser ? (
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                        <Row gutter={[16, 16]}>
                            <Col xs={24} md={8}>
                                <Card
                                    hoverable
                                >
                                    <MotionCard.Metric
                                        title="User"
                                        value={selectedUser.name || '—'}
                                        subtitle={selectedUser.departmentName || '—'}
                                        icon={<UserOutlined />}
                                        iconBg="rgba(22,119,255,0.12)"
                                    />
                                </Card>
                            </Col>

                            <Col xs={24} md={8}>
                                <Card
                                    hoverable
                                >
                                    <MotionCard.Metric
                                        title={`Sessions (${windowDays}d)`}
                                        value={selectedUser.sessionsWindow}
                                        subtitle={`${selectedUser.sessionsToday} today`}
                                        icon={<TeamOutlined />}
                                        iconBg="rgba(82,196,26,0.12)"
                                    />
                                </Card>
                            </Col>

                            <Col xs={24} md={8}>
                                <Card
                                    hoverable
                                >
                                    <MotionCard.Metric
                                        title={`Duration (${windowDays}d)`}
                                        value={formatDuration(selectedUser.durWindowMins)}
                                        subtitle={selectedUser.active ? 'Active now' : 'Idle'}
                                        icon={<HourglassOutlined />}
                                        iconBg="rgba(114,46,209,0.12)"
                                    />
                                </Card>
                            </Col>
                        </Row>

                        <Card
                            hoverable
                            title={`${selectedUser.name || 'User'} — Daily Activity`}
                            extra={
                                <Space wrap>
                                    {(selectedUser.roles || []).filter(isAllowedRole).map(role => (
                                        <Tag
                                            key={role}
                                            color={roleBadgeColor(role)}
                                            style={{ borderRadius: 999 }}
                                        >
                                            {ROLE_LABEL_MAP[role] || role}
                                        </Tag>
                                    ))}
                                </Space>
                            }
                        >
                            {loadingSelectedActivity ? (
                                <div style={{ padding: 40, textAlign: 'center' }}>
                                    <Text type="secondary">Loading activity...</Text>
                                </div>
                            ) : selectedUserSeries.length ? (
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={selectedUserChartOptions}
                                />
                            ) : (
                                <Empty
                                    description="No activity found for this user."
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                />
                            )}
                        </Card>

                        <Row gutter={[16, 16]}>
                            <Col xs={24} md={12}>
                                <Card
                                    hoverable
                                >
                                    <MotionCard.Metric
                                        title="Last Login"
                                        value={formatDateCell(selectedUser.lastStartedAt)}
                                        subtitle="Latest start time"
                                    />
                                </Card>
                            </Col>

                            <Col xs={24} md={12}>
                                <Card
                                    hoverable
                                >
                                    <MotionCard.Metric
                                        title="Last Seen"
                                        value={formatDateCell(selectedUser.lastSeenAt)}
                                        subtitle="Latest activity time"
                                    />
                                </Card>
                            </Col>
                        </Row>
                    </Space>
                ) : null}
            </Modal>
        </div>
    )
}

export default MonitoringActivity
