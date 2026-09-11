import { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    Row,
    Space,
    Tag,
    Typography,
    Segmented,
    message,
    DatePicker,
    Select,
    Alert,
    Modal,
    Input
} from 'antd'
import {
    ClockCircleOutlined,
    EnvironmentOutlined,
    CoffeeOutlined,
    PlayCircleOutlined,
    StopOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    HourglassOutlined,
    ReloadOutlined,
    BankOutlined,
    DownloadOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { db, auth } from '@/firebase'
import {
    collection,
    addDoc,
    doc,
    updateDoc,
    onSnapshot,
    query,
    where,
    Timestamp
} from 'firebase/firestore'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useBranchOperatingHours } from '@/hooks/useBranchOperatingHours'
import { BranchDayHours, LEGACY_SHIFT, getDayHours, plannedMinutes, lateMinutes, overtimeMinutes } from '@/utils/branchOperatingHours'
import EmployeeAttendanceAnalytics from '@/components/attendance/EmployeeAttendanceAnalytics'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import {
    CenterLocation,
    isCenterClockIn,
    resolveCenterLocationForUser
} from '@/services/attendanceCenters'
import dayjs, { Dayjs } from 'dayjs'
import './clock-in.css'

const { Text } = Typography

interface TimesheetEntry {
    branchId?: string
    scheduledHours?: BranchDayHours
    id?: string
    date: string
    userId: string
    checkIn?: string
    checkOut?: string
    status: 'checked_in' | 'checked_out' | 'on_break'
    location?: string
    locationLabel?: string
    latitude?: number
    longitude?: number
    locationAccuracy?: number
    locationVerified?: boolean
    locationQuality?: 'high' | 'medium' | 'low' | 'unavailable'
    detectedLocationLabel?: string
    centerMatched?: boolean
    autoClockedOut?: boolean
    autoClockedOutAt?: any
    autoClockOutReason?: string
    auditFlag?: string
    locationCaptureFailed?: boolean
    locationFailureReason?: string
    hoursWorked?: string
    lateBy?: string
    overtime?: string
    overtimeReason?: string
    overtimeRequestedAt?: string
    overtimeLocationVerified?: boolean
    overtimeApprovalStatus?: 'pending' | 'approved' | 'rejected'
    overtimeDecisionByName?: string
    overtimeDecisionNote?: string
}

type PendingOvertimeCheckout = {
    existingEntryId: string
    now: string
    checkIn: string
    lateBy: string
    overtimeStr: string
}

type LocationState = {
    status: 'idle' | 'detecting' | 'ready' | 'denied' | 'unsupported' | 'error'
    label: string
    latitude: number | null
    longitude: number | null
    accuracy: number | null
    timestamp: number | null
}

type DatePreset = 'this_week' | 'this_month' | 'custom'

const LOCATION_TIMEOUT_MS = 18000

const parseClockTimeToMinutes = (value?: string) => {
    if (!value || value === '-') return null

    const cleaned = value.trim()
    const match = cleaned.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
    if (!match) return null

    let hour = Number(match[1])
    const minute = Number(match[2])
    const meridian = match[3]?.toUpperCase()

    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        return null
    }

    if (meridian) {
        if (hour < 1 || hour > 12) return null
        if (meridian === 'PM' && hour < 12) hour += 12
        if (meridian === 'AM' && hour === 12) hour = 0
    } else if (hour < 0 || hour > 23) {
        return null
    }

    return hour * 60 + minute
}

const getCurrentClockTime = () => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

const calculateWorkedMinutes = (checkIn?: string, checkOut?: string) => {
    const checkInMinutes = parseClockTimeToMinutes(checkIn)
    const checkOutMinutes = parseClockTimeToMinutes(checkOut)

    if (checkInMinutes === null || checkOutMinutes === null) return 0

    let totalMinutes = checkOutMinutes - checkInMinutes

    // Supports a shift that ends after midnight without turning it into zero.
    if (totalMinutes < 0) totalMinutes += 24 * 60

    return Math.max(0, totalMinutes)
}

const getLateBy = (checkIn: string, shift: BranchDayHours) => {
    const checkInMinutes = parseClockTimeToMinutes(checkIn)
    if (checkInMinutes === null) return '0m'

    return `${lateMinutes(`${String(Math.floor(checkInMinutes / 60)).padStart(2, '0')}:${String(checkInMinutes % 60).padStart(2, '0')}`, shift)}m`
}

const calculateWorkedHours = (checkIn: string, checkOut: string) => {
    const totalMinutes = calculateWorkedMinutes(checkIn, checkOut)
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
}

const calculateOvertime = (checkIn: string, checkOut: string, shift: BranchDayHours) => {
    const start = parseClockTimeToMinutes(checkIn)
    const end = parseClockTimeToMinutes(checkOut)
    if (start === null || end === null) return '0h 0m'
    const asTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    const minutes = overtimeMinutes(asTime(start), asTime(end), shift)
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const formatLocationLabel = (data: any, latitude: number, longitude: number) => {
    const address = data?.address || {}

    const road = address.road
    const suburb =
        address.suburb ||
        address.neighbourhood ||
        address.hamlet ||
        address.residential
    const city =
        address.city ||
        address.town ||
        address.village ||
        address.municipality
    const state = address.state || address.county

    const parts = [road, suburb, city, state].filter(Boolean)

    if (parts.length) {
        return parts.join(', ')
    }

    return 'Location captured'
}

const parseHoursStringToMinutes = (value?: string) => {
    if (!value) return 0
    const match = /(\d+)h\s+(\d+)m/.exec(value)
    if (!match) return 0
    return Number(match[1]) * 60 + Number(match[2])
}

const formatMinutes = (totalMinutes: number) => {
    const safe = Math.max(0, totalMinutes)
    const h = Math.floor(safe / 60)
    const m = safe % 60
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`
}

const diffMinutesFromTime = (from?: string, toDate: Date = new Date()) => {
    const startMinutes = parseClockTimeToMinutes(from)
    if (startMinutes === null) return 0

    const currentMinutes = toDate.getHours() * 60 + toDate.getMinutes()
    let difference = currentMinutes - startMinutes

    if (difference < 0) difference += 24 * 60

    return Math.max(0, difference)
}

const getEntryWorkedMinutes = (row: TimesheetEntry, now = new Date()) => {
    const savedMinutes = parseHoursStringToMinutes(row.hoursWorked)
    if (savedMinutes > 0) return savedMinutes

    if (
        (row.status === 'checked_in' || row.status === 'on_break') &&
        row.checkIn
    ) {
        return diffMinutesFromTime(row.checkIn, now)
    }

    if (row.checkIn && row.checkOut && row.checkOut !== '-') {
        return calculateWorkedMinutes(row.checkIn, row.checkOut)
    }

    return 0
}

const getCurrentWorkWeekRange = (): [Dayjs, Dayjs] => {
    const today = dayjs()
    const weekday = today.day()
    const daysFromMonday = weekday === 0 ? -6 : 1 - weekday
    const monday = today.add(daysFromMonday, 'day').startOf('day')

    return [monday, monday.add(6, 'day').endOf('day')]
}

const getStartOfWorkWeek = () => {
    const now = new Date()
    const day = now.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    const monday = new Date(now)
    monday.setDate(now.getDate() + diffToMonday)
    monday.setHours(0, 0, 0, 0)
    return monday
}

const getWorkWeekDates = () => {
    const monday = getStartOfWorkWeek()
    return Array.from({ length: 5 }).map((_, idx) => {
        const d = new Date(monday)
        d.setDate(monday.getDate() + idx)
        return d
    })
}

const dateKey = (date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

const dayShort = (date: Date) =>
    date.toLocaleDateString([], { weekday: 'short' })

const ClockinPage = () => {
    const { user, actor, loading: identityLoading, isViewingAs } = useFullIdentity()
    const branchSchedule = useBranchOperatingHours(actor, identityLoading)

    const normalizedRole = (user?.role || '').trim().toLowerCase()
    const canSeeTeamAnalytics = ['projectadmin', 'operations'].includes(normalizedRole)

    const [activeView, setActiveView] = useState<'my_timesheet' | 'team_analytics'>(
        'my_timesheet'
    )

    const [datePreset, setDatePreset] = useState<DatePreset>('this_week')
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() =>
        getCurrentWorkWeekRange()
    )

    const [hubFilter, setHubFilter] = useState<string>('all')

    const isMainOperations =
        normalizedRole === 'operations' &&
        (user?.isMain === true || user?.departmentIsMain === true)

    const filteredStartDate = dateRange[0].format('YYYY-MM-DD')
    const filteredEndDate = dateRange[1].format('YYYY-MM-DD')

    const [currentStatus, setCurrentStatus] = useState<'checked_out' | 'checked_in' | 'on_break'>(
        'checked_out'
    )
    const [weeklyTimesheet, setWeeklyTimesheet] = useState<TimesheetEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [nowTick, setNowTick] = useState(Date.now())

    const [overtimeModalOpen, setOvertimeModalOpen] = useState(false)
    const [overtimeReasonDraft, setOvertimeReasonDraft] = useState('')
    const [pendingOvertimeCheckout, setPendingOvertimeCheckout] = useState<PendingOvertimeCheckout | null>(null)
    const [submittingOvertime, setSubmittingOvertime] = useState(false)

    const [locationState, setLocationState] = useState<LocationState>({
        status: 'idle',
        label: 'Location not checked yet',
        latitude: null,
        longitude: null,
        accuracy: null,
        timestamp: null
    })

    const [centerLocation, setCenterLocation] = useState<CenterLocation | null>(null)

    useEffect(() => {
        if (identityLoading || !actor) {
            setCenterLocation(null)
            return
        }

        let mounted = true

        resolveCenterLocationForUser(db, actor)
            .then(center => {
                if (mounted) setCenterLocation(center)
            })
            .catch(error => {
                console.error('[ClockinPage] center location load failed', error)
                if (mounted) setCenterLocation(null)
            })

        return () => {
            mounted = false
        }
    }, [actor, identityLoading])

    const isAtConfiguredCenter = useMemo(
        () =>
            isCenterClockIn(
                {
                    latitude: locationState.latitude,
                    longitude: locationState.longitude,
                    locationAccuracy: locationState.accuracy
                },
                centerLocation
            ),
        [locationState.latitude, locationState.longitude, locationState.accuracy, centerLocation]
    )

    const displayLocationLabel =
        centerLocation && isAtConfiguredCenter ? centerLocation.locationLabel : locationState.label

    useEffect(() => {
        if (!canSeeTeamAnalytics) {
            setActiveView('my_timesheet')
        }
    }, [canSeeTeamAnalytics])

    useEffect(() => {
        const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [])

    const detectLocation = async (showPermissionHelp = false) => {
        if (!navigator.geolocation) {
            setLocationState({
                status: 'unsupported',
                label: 'Location not supported on this device',
                latitude: null,
                longitude: null,
                accuracy: null,
                timestamp: null
            })
            return
        }

        setLocationState(prev => ({
            ...prev,
            status: 'detecting',
            label: 'Detecting location...'
        }))

        let bestPosition: GeolocationPosition | null = null
        let finished = false

        const finishWithPosition = async (position: GeolocationPosition) => {
            if (finished) return
            finished = true
            window.clearTimeout(timeoutId)
            navigator.geolocation.clearWatch(watchId)

            const { latitude, longitude, accuracy } = position.coords

            setLocationState({
                status: 'ready',
                label: 'Location captured',
                latitude,
                longitude,
                accuracy,
                timestamp: position.timestamp
            })

            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${latitude}&lon=${longitude}`
                )
                const data = await res.json()

                setLocationState(prev => ({
                    ...prev,
                    label: formatLocationLabel(data, latitude, longitude)
                }))
            } catch (err) {
                console.error('Reverse geocoding failed:', err)
            }
        }

        const finishWithError = (error?: GeolocationPositionError) => {
            if (finished) return
            if (bestPosition) {
                void finishWithPosition(bestPosition)
                return
            }

            finished = true
            window.clearTimeout(timeoutId)
            navigator.geolocation.clearWatch(watchId)

            const denied = error?.code === 1
            setLocationState({
                status: denied ? 'denied' : 'error',
                label: denied
                    ? 'Location permission denied'
                    : 'Location could not be confirmed. Move near a window and try again.',
                latitude: null,
                longitude: null,
                accuracy: null,
                timestamp: null
            })

            if (denied && showPermissionHelp) {
                Modal.info({
                    title: 'Location permission is blocked',
                    content: (
                        <div>
                            <p>The browser cannot show another prompt until location access is reset for this site.</p>
                            <ol style={{ paddingLeft: 20, marginBottom: 0 }}>
                                <li>Select the lock or site-controls icon beside the web address.</li>
                                <li>Set <strong>Location</strong> to <strong>Allow</strong>.</li>
                                <li>Select <strong>Request location</strong> again.</li>
                            </ol>
                        </div>
                    ),
                    okText: 'Got it'
                })
            }
        }

        const watchId = navigator.geolocation.watchPosition(
            position => {
                if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) {
                    bestPosition = position
                }

                // A strong reading can be used immediately. Coarser rural readings are
                // given a little longer so the device can refine them.
                if (position.coords.accuracy <= 60) {
                    void finishWithPosition(position)
                }
            },
            finishWithError,
            {
                enableHighAccuracy: true,
                timeout: LOCATION_TIMEOUT_MS,
                maximumAge: 0
            }
        )

        const timeoutId = window.setTimeout(() => {
            if (bestPosition) {
                void finishWithPosition(bestPosition)
            } else {
                setLocationState({
                    status: 'error',
                    label: 'Location could not be confirmed. Move near a window and try again.',
                    latitude: null,
                    longitude: null,
                    accuracy: null,
                    timestamp: null
                })
                finished = true
                navigator.geolocation.clearWatch(watchId)
            }
        }, LOCATION_TIMEOUT_MS)
    }

    const retryLocation = async () => {
        if (!navigator.geolocation) {
            Modal.info({
                title: 'Location is not available',
                content: 'Turn on location services for this device, then reopen the page.',
                okText: 'Got it'
            })
            return
        }

        try {
            const permission = await navigator.permissions?.query({
                name: 'geolocation' as PermissionName
            })

            if (permission?.state === 'denied') {
                Modal.info({
                    title: 'Allow location in your browser',
                    content: (
                        <div>
                            <p>Your browser has blocked new location prompts for this site.</p>
                            <ol style={{ paddingLeft: 20, marginBottom: 0 }}>
                                <li>Select the lock or site-controls icon beside the web address.</li>
                                <li>Set <strong>Location</strong> to <strong>Allow</strong>.</li>
                                <li>Return here and select the button below.</li>
                            </ol>
                        </div>
                    ),
                    okText: "I've allowed it — retry",
                    onOk: () => detectLocation()
                })
                return
            }
        } catch {
            // Some browsers do not expose the Permissions API; geolocation itself
            // still provides the correct prompt or error state.
        }

        message.loading({ content: 'Requesting your location…', key: 'location-retry', duration: 2 })
        await detectLocation()
    }

    const requestBrowserLocation = () => {
        if (!navigator.geolocation) {
            Modal.info({
                title: 'Location is not available',
                content: 'Turn on location services for this device, then reopen the page.',
                okText: 'Got it'
            })
            return
        }

        // Keep the geolocation call directly inside the click handler. This lets
        // the browser display its native permission prompt when still permitted.
        message.loading({
            content: 'Waiting for browser location permission...',
            key: 'location-retry',
            duration: 2
        })
        void detectLocation(true)
    }

    const applyDatePreset = (preset: DatePreset) => {
        setDatePreset(preset)

        if (preset === 'this_week') {
            setDateRange(getCurrentWorkWeekRange())
        }

        if (preset === 'this_month') {
            setDateRange([dayjs().startOf('month'), dayjs().endOf('month')])
        }
    }

    useEffect(() => {
        if (identityLoading || !actor?.uid) return

        const userId = actor.uid
        const today = dateKey(new Date())
        const qy = query(collection(db, 'timesheets'), where('userId', '==', userId))

        const unsub = onSnapshot(qy, snapshot => {
            const entries = snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                ...docSnap.data()
            })) as TimesheetEntry[]

            const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))
            setWeeklyTimesheet(sorted)

            const todayEntry = entries.find(e => e.date === today)
            setCurrentStatus(todayEntry?.status || 'checked_out')
            setLoading(false)
        })

        return () => unsub()
    }, [identityLoading, actor?.uid])

    useEffect(() => {
        detectLocation()
    }, [])

    const downloadCsv = (rows: any[], filename: string) => {
        if (!rows.length) {
            message.warning('No data to download for the selected filters.')
            return
        }

        const headers = Object.keys(rows[0])

        const csv = [
            headers.join(','),
            ...rows.map(row =>
                headers
                    .map(header => {
                        const value = row[header] ?? ''
                        return `"${String(value).replace(/"/g, '""')}"`
                    })
                    .join(',')
            )
        ].join('\n')

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)

        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()

        URL.revokeObjectURL(url)
    }

    const filteredMyTimesheet = useMemo(() => {
        return weeklyTimesheet.filter(row => {
            return row.date >= filteredStartDate && row.date <= filteredEndDate
        })
    }, [weeklyTimesheet, filteredStartDate, filteredEndDate])


    const todayKey = dateKey(new Date())

    const filteredWorkedMinutes = useMemo(() => {
        const now = new Date(nowTick)
        return filteredMyTimesheet.reduce(
            (sum, row) => sum + getEntryWorkedMinutes(row, now),
            0
        )
    }, [filteredMyTimesheet, nowTick])

    const filteredWorkedDaysCount = useMemo(() => {
        return new Set(
            filteredMyTimesheet
                .filter(row => !!row.checkIn && row.checkIn !== '-')
                .map(row => row.date)
        ).size
    }, [filteredMyTimesheet])

    const filteredLateMinutes = useMemo(() => {
        return filteredMyTimesheet.reduce(
            (sum, row) => sum + (parseInt((row.lateBy || '0m').replace(/\D/g, '')) || 0),
            0
        )
    }, [filteredMyTimesheet])

    const filteredOvertimeMinutes = useMemo(() => {
        return filteredMyTimesheet.reduce(
            (sum, row) => sum + parseHoursStringToMinutes(row.overtime || '0h 0m'),
            0
        )
    }, [filteredMyTimesheet])

    const expectedSchedule = useMemo(() => {
        const start = dayjs(filteredStartDate)
        const end = dayjs(filteredEndDate)
        const totalDays = end.diff(start, 'day') + 1

        return Array.from({ length: totalDays }).map((_, index) => {
            const date = start.add(index, 'day')
            const entry = filteredMyTimesheet.find(row => row.date === date.format('YYYY-MM-DD'))
            return entry?.scheduledHours || getDayHours(branchSchedule.hours, date.toDate())
        })
    }, [filteredStartDate, filteredEndDate, filteredMyTimesheet, branchSchedule.hours])
    const filteredExpectedDays = expectedSchedule.filter(day => !day.closed).length
    const filteredExpectedMinutes = expectedSchedule.reduce((sum, day) => sum + plannedMinutes(day), 0)

    const myTimesheetTitle = useMemo(() => {
        if (
            filteredStartDate === getCurrentWorkWeekRange()[0].format('YYYY-MM-DD') &&
            filteredEndDate === getCurrentWorkWeekRange()[1].format('YYYY-MM-DD')
        ) {
            return 'My weekly time'
        }

        if (
            filteredStartDate === dayjs().startOf('month').format('YYYY-MM-DD') &&
            filteredEndDate === dayjs().endOf('month').format('YYYY-MM-DD')
        ) {
            return 'My monthly time'
        }

        return `My time (${filteredStartDate} to ${filteredEndDate})`
    }, [filteredStartDate, filteredEndDate])

    const handleDownloadCurrentView = () => {
        if (activeView === 'my_timesheet') {
            downloadCsv(
                filteredMyTimesheet.map(row => ({
                    date: row.date,
                    checkIn: row.checkIn || '',
                    checkOut: row.checkOut || '',
                    status: row.status,
                    hoursWorked: formatMinutes(getEntryWorkedMinutes(row, new Date(nowTick))),
                    lateBy: row.lateBy || '0m',
                    overtime: row.overtime || '0h 0m',
                    location: row.locationLabel || row.location || '',
                    autoClockedOut: row.autoClockedOut ? 'Yes' : 'No',
                    auditFlag: row.auditFlag || ''
                })),
                `my-timesheet-${filteredStartDate}-to-${filteredEndDate}.csv`
            )

            return
        }

        window.dispatchEvent(
            new CustomEvent('download-team-attendance-analytics', {
                detail: {
                    startDate: filteredStartDate,
                    endDate: filteredEndDate,
                    hubId: hubFilter
                }
            })
        )
    }



    const minutesToHours = (minutes: number) => Number((minutes / 60).toFixed(2))

    const todayEntry = useMemo(
        () => weeklyTimesheet.find(e => e.date === todayKey) || null,
        [weeklyTimesheet, todayKey]
    )
    const todayHours = todayEntry?.scheduledHours || getDayHours(branchSchedule.hours, new Date(nowTick))

    const todayMinutesWorked = useMemo(() => {
        if (!todayEntry) return 0
        return getEntryWorkedMinutes(todayEntry, new Date(nowTick))
    }, [todayEntry, nowTick])

    const todayLateMinutes = useMemo(
        () => parseInt((todayEntry?.lateBy || '0m').replace(/\D/g, '')) || 0,
        [todayEntry]
    )

    const todayOvertimeMinutes = useMemo(
        () => parseHoursStringToMinutes(todayEntry?.overtime || '0h 0m'),
        [todayEntry]
    )

    const currentElapsed = useMemo(() => {
        if (!todayEntry?.checkIn) return '00:00:00'
        const totalMinutes = diffMinutesFromTime(todayEntry.checkIn, new Date(nowTick))
        const hours = Math.floor(totalMinutes / 60)
        const minutes = totalMinutes % 60
        const seconds = Math.floor((nowTick / 1000) % 60)
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }, [todayEntry, nowTick])

    const filteredDates = useMemo(() => {
        const start = dayjs(filteredStartDate)
        const end = dayjs(filteredEndDate)
        const diff = end.diff(start, 'day')

        return Array.from({ length: diff + 1 }).map((_, index) =>
            start.add(index, 'day').toDate()
        )
    }, [filteredStartDate, filteredEndDate])

    const businessDates = useMemo(
        () => filteredDates.filter(date => {
            const row = filteredMyTimesheet.find(entry => entry.date === dateKey(date))
            return !!row || !getDayHours(branchSchedule.hours, date).closed
        }),
        [filteredDates, filteredMyTimesheet, branchSchedule.hours]
    )

    const weekDates = useMemo(() => getWorkWeekDates(), [])
    const weekKeys = useMemo(() => businessDates.map(d => dateKey(d)), [businessDates])

    const weekRows = useMemo(
        () => weeklyTimesheet.filter(row => weekKeys.includes(row.date)),
        [weeklyTimesheet, weekKeys]
    )

    const weekWorkedMinutes = useMemo(() => {
        const now = new Date(nowTick)
        return weekRows.reduce(
            (sum, row) => sum + getEntryWorkedMinutes(row, now),
            0
        )
    }, [weekRows, nowTick])

    const workedDaysCount = useMemo(() => {
        return new Set(
            weekRows
                .filter(r => !!r.checkIn && r.checkIn !== '-')
                .map(r => r.date)
        ).size
    }, [weekRows])

    const dailySummary = useMemo(() => {
        return {
            totalHours: formatMinutes(todayMinutesWorked),
            totalLate: `${todayLateMinutes}m`,
            totalOvertime: formatMinutes(todayOvertimeMinutes)
        }
    }, [todayMinutesWorked, todayLateMinutes, todayOvertimeMinutes])


    const timelineChartOptions: Highcharts.Options = useMemo(() => {
        const categories = businessDates.map(d =>
            dayjs(d).format(businessDates.length > 10 ? 'DD MMM' : 'ddd')
        )

        const lateData = businessDates.map(d => {
            const key = dateKey(d)
            const row = filteredMyTimesheet.find(r => r.date === key)
            const lateMinutes =
                parseInt((row?.lateBy || '0m').replace(/\D/g, '')) || 0
            return minutesToHours(lateMinutes)
        })

        const workedData = businessDates.map(d => {
            const key = dateKey(d)
            const row = filteredMyTimesheet.find(r => r.date === key)
            if (!row) return 0

            return minutesToHours(getEntryWorkedMinutes(row, new Date(nowTick)))
        })

        const overtimeData = businessDates.map(d => {
            const key = dateKey(d)
            const row = filteredMyTimesheet.find(r => r.date === key)
            return minutesToHours(parseHoursStringToMinutes(row?.overtime || '0h 0m'))
        })

        return {
            chart: {
                type: 'column',
                height: 315,
                spacingTop: 12,
                spacingBottom: 12,
                borderRadius: 12
            },
            title: { text: undefined },
            credits: { enabled: false },
            legend: {
                enabled: true,
                align: 'center',
                verticalAlign: 'bottom',
                itemDistance: 18,
                symbolRadius: 6,
                itemStyle: {
                    fontWeight: '500',
                    color: '#595959'
                }
            },
            xAxis: {
                categories,
                lineWidth: 0,
                tickWidth: 0,
                gridLineWidth: 0,
                labels: {
                    style: {
                        fontSize: '12px'
                    }
                }
            },
            yAxis: {
                min: 0,
                title: { text: undefined },
                gridLineColor: '#eef2f7',
                allowDecimals: false,
                labels: {
                    formatter: function () {
                        return `${this.value}h`
                    }
                }
            },
            tooltip: {
                shared: true,
                valueSuffix: 'h'
            },
            plotOptions: {
                series: {
                    stacking: 'normal',
                    borderWidth: 0,
                    borderRadius: 6,
                    pointPadding: 0.18,
                    groupPadding: 0.12,
                    dataLabels: {
                        enabled: true,
                        formatter: function () {
                            return this.y && this.y > 0 ? `${this.y}h` : ''
                        },
                        style: {
                            textOutline: 'none',
                            fontSize: '11px',
                            fontWeight: '500'
                        }
                    }
                }
            },
            series: [
                {
                    type: 'column',
                    name: 'Late',
                    color: '#ff4d4f',
                    data: lateData
                },
                {
                    type: 'column',
                    name: 'Worked',
                    color: '#1677ff',
                    data: workedData
                },
                {
                    type: 'column',
                    name: 'Overtime',
                    color: '#faad14',
                    data: overtimeData
                }
            ]
        }
    }, [businessDates, filteredMyTimesheet, nowTick])

    const isLocationStillPending =
        locationState.status === 'idle' || locationState.status === 'detecting'

    const canClockIn =
        locationState.status === 'ready' &&
        locationState.latitude !== null &&
        locationState.longitude !== null &&
        locationState.accuracy !== null

    const handleClockAction = async (
        action: 'check_in' | 'check_out' | 'break_start' | 'break_end'
    ) => {
        if (isViewingAs) {
            message.error('Return to your own account before recording attendance.')
            return
        }
        if (branchSchedule.loading || branchSchedule.error) {
            message.error(branchSchedule.error || 'Please wait for branch operating hours to load.')
            return
        }
        if (!auth.currentUser) {
            message.error('Not authenticated')
            return
        }

        if (action === 'check_in') {
            if (isLocationStillPending) {
                message.error('Still detecting location. Please wait or retry.')
                return
            }

            if (
                !canClockIn
            ) {
                message.error('Valid GPS coordinates are required before clocking in.')
                return
            }
        }

        const userId = auth.currentUser.uid
        const today = dateKey(new Date())
        const now = getCurrentClockTime()

        const existingEntry = weeklyTimesheet.find(e => e.date === today)
        // Preserve the schedule captured at clock-in, including after a branch edit.
        // Pre-feature entries retain the original 07:00–15:00 shift.
        const shift = existingEntry ? existingEntry.scheduledHours || LEGACY_SHIFT
            : getDayHours(branchSchedule.hours, new Date())

        let updatedStatus: TimesheetEntry['status'] = 'checked_out'
        if (action === 'check_in') updatedStatus = 'checked_in'
        if (action === 'check_out') updatedStatus = 'checked_out'
        if (action === 'break_start') updatedStatus = 'on_break'
        if (action === 'break_end') updatedStatus = 'checked_in'

        if (!existingEntry) {
            if (action !== 'check_in') {
                message.warning('You must check in first.')
                return
            }

            const auditFlags: string[] = []
            if (locationState.accuracy && locationState.accuracy > 150) auditFlags.push('LOW_ACCURACY_LOCATION')
            if (centerLocation && !isAtConfiguredCenter) auditFlags.push('OUTSIDE_CENTER')

            await addDoc(collection(db, 'timesheets'), {
                userId,
                branchId: branchSchedule.branchId || null,
                scheduledHours: shift,
                date: today,
                checkIn: now,
                checkOut: '-',
                status: updatedStatus,

                location: `${locationState.latitude},${locationState.longitude}`,
                // Shown to the employee and in reports: the branch's on-file address
                // when the GPS distance check matches the configured center, otherwise
                // the device's own detected address. Matching itself never compares
                // address text — only the raw coordinates, via isAtConfiguredCenter.
                locationLabel: centerLocation && isAtConfiguredCenter
                    ? centerLocation.locationLabel
                    : locationState.label,
                detectedLocationLabel: locationState.label,
                centerMatched: isAtConfiguredCenter,
                latitude: locationState.latitude,
                longitude: locationState.longitude,
                locationAccuracy: locationState.accuracy,
                locationVerified: true,
                locationQuality: locationState.accuracy && locationState.accuracy <= 50
                    ? 'high'
                    : locationState.accuracy && locationState.accuracy <= 150
                        ? 'medium'
                        : 'low',

                locationCaptureFailed: false,
                locationFailureReason: '',

                autoClockedOut: false,
                autoClockOutReason: '',
                auditFlag: auditFlags.join(', '),
                hoursWorked: '0h 0m',
                lateBy: getLateBy(now, shift),
                overtime: '0h 0m',
                createdAt: Timestamp.now()
            })
        } else {
            if (existingEntry.status === 'checked_out') {
                message.warning('You already checked out for today.')
                return
            }

            if (action === 'check_out') {
                const overtimeStr = calculateOvertime(existingEntry.checkIn || now, now, shift)
                const overtimeMinutes = parseHoursStringToMinutes(overtimeStr)

                if (overtimeMinutes > 0) {
                    if (!canClockIn) {
                        message.error('A current location reading is required to log overtime. Refresh your location and try again.')
                        return
                    }

                    setPendingOvertimeCheckout({
                        existingEntryId: existingEntry.id!,
                        now,
                        checkIn: existingEntry.checkIn || now,
                        lateBy: existingEntry.lateBy || getLateBy(existingEntry.checkIn || now, shift),
                        overtimeStr
                    })
                    setOvertimeReasonDraft('')
                    setOvertimeModalOpen(true)
                    return
                }

                await updateDoc(doc(db, 'timesheets', existingEntry.id!), {
                    status: 'checked_out',
                    checkOut: now,
                    hoursWorked: calculateWorkedHours(existingEntry.checkIn || now, now),
                    lateBy: existingEntry.lateBy || getLateBy(existingEntry.checkIn || now, shift),
                    overtime: overtimeStr,
                    updatedAt: Timestamp.now()
                })
            } else {
                await updateDoc(doc(db, 'timesheets', existingEntry.id!), {
                    status: updatedStatus,
                    updatedAt: Timestamp.now()
                })
            }
        }

        message.success(
            `${action === 'check_in'
                ? 'Checked in'
                : action === 'check_out'
                    ? 'Checked out'
                    : action === 'break_start'
                        ? 'Break started'
                        : 'Break ended'} at ${now}`
        )
    }

    const confirmOvertimeCheckout = async () => {
        if (!pendingOvertimeCheckout) return
        if (isViewingAs || !auth.currentUser || auth.currentUser.uid !== actor?.uid) {
            message.error('Return to your own account before recording attendance.')
            return
        }

        const reason = overtimeReasonDraft.trim()
        if (!reason) {
            message.error('A reason is required before this overtime can be submitted for approval.')
            return
        }

        setSubmittingOvertime(true)

        try {
            const matchedAtCheckout = isCenterClockIn(
                {
                    latitude: locationState.latitude,
                    longitude: locationState.longitude,
                    locationAccuracy: locationState.accuracy
                },
                centerLocation
            )

            const auditFlags: string[] = []
            if (centerLocation && !matchedAtCheckout) auditFlags.push('OVERTIME_OUTSIDE_CENTER')

            await updateDoc(doc(db, 'timesheets', pendingOvertimeCheckout.existingEntryId), {
                status: 'checked_out',
                checkOut: pendingOvertimeCheckout.now,
                hoursWorked: calculateWorkedHours(pendingOvertimeCheckout.checkIn, pendingOvertimeCheckout.now),
                lateBy: pendingOvertimeCheckout.lateBy,
                overtime: pendingOvertimeCheckout.overtimeStr,
                overtimeReason: reason,
                overtimeRequestedAt: pendingOvertimeCheckout.now,
                overtimeLocationVerified: matchedAtCheckout,
                overtimeApprovalStatus: 'pending',
                auditFlag: auditFlags.join(', '),
                updatedAt: Timestamp.now()
            })

            message.success(`Checked out at ${pendingOvertimeCheckout.now}. Overtime sent for supervisor approval.`)
            setOvertimeModalOpen(false)
            setPendingOvertimeCheckout(null)
        } catch (error) {
            console.error('[ClockinPage] overtime checkout failed', error)
            message.error('Could not submit the overtime request. Please try again.')
        } finally {
            setSubmittingOvertime(false)
        }
    }

    const getStatusTag = (status: string) => {
        switch (status) {
            case 'checked_in':
                return <Tag color='green'>Checked In</Tag>
            case 'checked_out':
                return <Tag color='default'>Checked Out</Tag>
            case 'on_break':
                return <Tag color='orange'>On Break</Tag>
            default:
                return <Tag>{status}</Tag>
        }
    }

    if (loading || identityLoading || branchSchedule.loading) {
        return <LoadingOverlay tip='Loading timesheet' />
    }

    const locationNeedsAttention = ['denied', 'error', 'unsupported'].includes(locationState.status)
    const isWorking = currentStatus === 'checked_in' || currentStatus === 'on_break'

    return (
        <div style={{ padding: 20, minHeight: '100vh' }}>

            {canSeeTeamAnalytics && (
                <DashboardHeaderCard
                    title='Clock-in'
                    titleIcon={
                        <ClockCircleOutlined style={{ color: '#1677ff' }} />
                    }
                    extraRight={
                        <Space size='middle' wrap>
                            {activeView === 'team_analytics' && isMainOperations && (
                                <Select
                                    value={hubFilter}
                                    style={{ minWidth: 180 }}
                                    suffixIcon={<BankOutlined />}
                                    onChange={setHubFilter}
                                    options={[
                                        { label: 'All Hubs', value: 'all' },
                                        ...(user?.hubOptions || user?.branchOptions || []).map(
                                            (hub: any) => ({
                                                label: hub.name,
                                                value: hub.id
                                            })
                                        )
                                    ]}
                                />
                            )}

                            <Segmented
                                value={activeView}
                                onChange={value =>
                                    setActiveView(
                                        value as 'my_timesheet' | 'team_analytics'
                                    )
                                }
                                options={[
                                    {
                                        label: 'My Timesheet',
                                        value: 'my_timesheet'
                                    },
                                    {
                                        label: 'Team Analytics',
                                        value: 'team_analytics'
                                    }
                                ]}
                            />
                        </Space>
                    }
                />
            )}

            {activeView === 'team_analytics' && canSeeTeamAnalytics ? (
                <EmployeeAttendanceAnalytics
                    title=""
                    days={7}
                    showCurrentTable
                    startDate={filteredStartDate}
                    endDate={filteredEndDate}
                    enableDownloadEvent
                />
            ) : (
                <>
                    <Alert
                        style={{ marginBottom: 16 }}
                        type={branchSchedule.error ? 'error' : 'info'}
                        showIcon
                        message={branchSchedule.error || `${branchSchedule.branchName || 'Branch'} hours today: ${todayHours.closed ? 'Closed' : `${todayHours.opens}–${todayHours.closes}`}`}
                        description={branchSchedule.error ? 'Attendance changes are paused until the schedule loads.' :
                            `${branchSchedule.configured ? 'Using your assigned branch operating hours.' : 'No custom branch hours set; using Mon–Fri 07:00–15:00.'} ${todayHours.closed ? 'Work recorded on closed days is submitted for overtime approval.' : 'Overtime after closing still requires approval.'}`}
                        action={branchSchedule.error ? <Button onClick={branchSchedule.retry}>Retry</Button> : undefined}
                    />
                    <Row gutter={[16, 16]} className='timesheet-metrics'>
                        <Col xs={24} sm={12} xl={6}>
                            <MotionCard.Metric
                                icon={<ClockCircleOutlined />}
                                iconBg='rgba(22,119,255,.12)'
                                title='Planned hours'
                                value={branchSchedule.error ? 'Unavailable' : formatMinutes(filteredExpectedMinutes)}
                                subtitle={`Days worked: ${filteredWorkedDaysCount}/${filteredExpectedDays}`}
                            />
                        </Col>
                        <Col xs={24} sm={12} xl={6}>
                            <MotionCard.Metric
                                icon={<CheckCircleOutlined />}
                                iconBg='rgba(34,160,107,.12)'
                                title='Worked hours'
                                value={formatMinutes(filteredWorkedMinutes)}
                                subtitle='Recorded in selected period'
                            />
                        </Col>
                        <Col xs={24} sm={12} xl={6}>
                            <MotionCard.Metric
                                icon={<HourglassOutlined />}
                                iconBg='rgba(250,173,20,.12)'
                                title='Late in period'
                                value={`${filteredLateMinutes}m`}
                                subtitle='Accumulated late minutes'
                            />
                        </Col>
                        <Col xs={24} sm={12} xl={6}>
                            <MotionCard.Metric
                                icon={<ExclamationCircleOutlined />}
                                iconBg='rgba(114,46,209,.12)'
                                title='Overtime'
                                value={formatMinutes(filteredOvertimeMinutes)}
                                subtitle='In the selected period'
                            />
                        </Col>
                    </Row>

                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={8}>
                            <MotionCard
                                className='clock-panel'
                                styles={{ body: { padding: 16 } }}
                            >
                                <div
                                    className='clock-panel__topline'
                                    style={{ marginBottom: 4 }}
                                >
                                    <span className={`clock-panel__dot clock-panel__dot--${currentStatus}`} />
                                    <Text strong>
                                        {currentStatus === 'checked_in'
                                            ? 'You are clocked in'
                                            : currentStatus === 'on_break'
                                                ? 'You are on a break'
                                                : 'Ready to start your day'}
                                    </Text>
                                    <span className='clock-panel__status'>
                                        {getStatusTag(currentStatus)}
                                    </span>
                                </div>

                                <div
                                    style={{
                                        textAlign: 'center',
                                        padding: '6px 0 8px'
                                    }}
                                >
                                    <div
                                        style={{
                                            fontSize: 28,
                                            lineHeight: 1.05,
                                            fontWeight: 800,
                                            letterSpacing: '.04em',
                                            fontVariantNumeric: 'tabular-nums'
                                        }}
                                    >
                                        {isWorking ? currentElapsed : '00:00:00'}
                                    </div>
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        {isWorking
                                            ? `Current session${todayEntry?.checkIn ? ` • checked in ${todayEntry.checkIn}` : ''}`
                                            : 'Clock in when you are ready'}
                                    </Text>
                                </div>

                                <div
                                    className={`location-check location-check--${locationState.status}`}
                                    style={{
                                        marginTop: 4,
                                        padding: '9px 10px',
                                        gap: 10,
                                        alignItems: 'center'
                                    }}
                                >
                                    <EnvironmentOutlined className='location-check__icon' />

                                    <div
                                        className='location-check__copy'
                                        style={{ minWidth: 0, flex: 1 }}
                                    >
                                        <Space size={6} wrap>
                                            <Text strong style={{ fontSize: 12 }}>
                                                {locationState.status === 'ready'
                                                    ? 'Location confirmed'
                                                    : locationState.status === 'detecting'
                                                        ? 'Confirming location…'
                                                        : 'Location required'}
                                            </Text>

                                            {centerLocation && locationState.status === 'ready' ? (
                                                <Tag
                                                    color={isAtConfiguredCenter ? 'green' : 'orange'}
                                                    style={{ marginInlineEnd: 0 }}
                                                >
                                                    {isAtConfiguredCenter ? 'At Center' : 'Outside Center'}
                                                </Tag>
                                            ) : null}

                                            {locationState.status === 'ready' &&
                                                typeof locationState.accuracy === 'number' &&
                                                locationState.accuracy > 150 ? (
                                                <Tag color='gold' style={{ marginInlineEnd: 0 }}>
                                                    GPS ±{Math.round(locationState.accuracy)}m
                                                </Tag>
                                            ) : null}
                                        </Space>

                                        <Text
                                            type='secondary'
                                            ellipsis={{ tooltip: displayLocationLabel }}
                                            style={{
                                                display: 'block',
                                                fontSize: 11,
                                                marginTop: 1
                                            }}
                                        >
                                            {displayLocationLabel}
                                        </Text>
                                    </div>

                                    <Button
                                        size='small'
                                        shape='circle'
                                        aria-label={locationNeedsAttention ? 'Request location' : 'Refresh location'}
                                        icon={<ReloadOutlined spin={locationState.status === 'detecting'} />}
                                        loading={locationState.status === 'detecting'}
                                        onClick={requestBrowserLocation}
                                    />
                                </div>

                                {locationNeedsAttention && (
                                    <Alert
                                        style={{ marginTop: 8 }}
                                        type='warning'
                                        showIcon
                                        message={
                                            locationState.status === 'denied'
                                                ? 'Allow location to clock in'
                                                : 'We could not confirm your location'
                                        }
                                        description={
                                            locationState.status === 'denied'
                                                ? 'Allow Location in your browser, then request it again.'
                                                : 'Turn on device location, move near a window, and retry.'
                                        }
                                    />
                                )}

                                <div
                                    className='clock-panel__actions'
                                    style={{ gap: 8, marginTop: 10 }}
                                >
                                    <button
                                        type='button'
                                        className={`clock-orb ${isWorking ? 'clock-orb--active' : ''}`}
                                        style={{
                                            width: 156,
                                            height: 156,
                                            minWidth: 156,
                                            minHeight: 156,
                                            margin: '0 auto'
                                        }}
                                        disabled={!isWorking && !canClockIn}
                                        onClick={() =>
                                            handleClockAction(isWorking ? 'check_out' : 'check_in')
                                        }
                                        aria-label={isWorking ? 'Clock out' : 'Clock in'}
                                    >
                                        <span className='clock-orb__icon'>
                                            {isWorking ? <StopOutlined /> : <PlayCircleOutlined />}
                                        </span>
                                        <span className='clock-orb__label'>
                                            {isWorking ? 'Clock out' : 'Clock in'}
                                        </span>
                                        <span className='clock-orb__hint'>
                                            {!isWorking && !canClockIn
                                                ? 'Location required'
                                                : 'Tap to confirm'}
                                        </span>
                                    </button>

                                    <Button
                                        block
                                        icon={<CoffeeOutlined />}
                                        disabled={currentStatus === 'checked_out'}
                                        onClick={() =>
                                            handleClockAction(
                                                currentStatus === 'on_break'
                                                    ? 'break_end'
                                                    : 'break_start'
                                            )
                                        }
                                    >
                                        {currentStatus === 'on_break'
                                            ? 'End break'
                                            : 'Start break'}
                                    </Button>
                                </div>

                                {(todayEntry?.lateBy && todayEntry.lateBy !== '0m') ||
                                    todayEntry?.autoClockedOut ||
                                    todayEntry?.overtimeApprovalStatus ? (
                                    <Space
                                        size={[4, 4]}
                                        wrap
                                        style={{ marginTop: 8 }}
                                    >
                                        {todayEntry?.lateBy &&
                                            todayEntry.lateBy !== '0m' && (
                                                <Tag color='orange'>
                                                    Late {todayEntry.lateBy}
                                                </Tag>
                                            )}
                                        {todayEntry?.autoClockedOut && (
                                            <Tag color='orange'>Auto clocked out</Tag>
                                        )}
                                        {todayEntry?.overtimeApprovalStatus === 'pending' && (
                                            <Tag color='gold'>Overtime pending</Tag>
                                        )}
                                        {todayEntry?.overtimeApprovalStatus === 'approved' && (
                                            <Tag color='green'>Overtime approved</Tag>
                                        )}
                                        {todayEntry?.overtimeApprovalStatus === 'rejected' && (
                                            <Tag color='red'>Overtime rejected</Tag>
                                        )}
                                    </Space>
                                ) : null}
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={16}>
                            <MotionCard
                                className='timesheet-chart-card'
                                styles={{ body: { padding: 16 } }}
                                filterBarProps={{ marginBottom: 8, padding: '10px 12px' }}
                                filterBar={
                                    <Row
                                        gutter={[10, 8]}
                                        align='middle'
                                        justify='space-between'
                                        style={{ width: '100%' }}
                                    >
                                        <Col flex='auto'>
                                            <Space direction='vertical' size={0}>
                                                <Text strong>Work history</Text>
                                                <Text type='secondary' style={{ fontSize: 11 }}>
                                                    Daily hours for the selected period
                                                </Text>
                                            </Space>
                                        </Col>

                                        <Col>
                                            <Space
                                                size={8}
                                                wrap
                                                className='timesheet-chart-card__controls'
                                            >
                                                <Segmented
                                                    value={datePreset}
                                                    onChange={value =>
                                                        applyDatePreset(value as DatePreset)
                                                    }
                                                    options={[
                                                        { label: 'This week', value: 'this_week' },
                                                        { label: 'This month', value: 'this_month' },
                                                        { label: 'Custom', value: 'custom' }
                                                    ]}
                                                />

                                                {datePreset === 'custom' ? (
                                                    <DatePicker.RangePicker
                                                        value={dateRange}
                                                        allowClear={false}
                                                        onChange={value => {
                                                            if (!value?.[0] || !value?.[1]) return
                                                            setDateRange([value[0], value[1]])
                                                        }}
                                                    />
                                                ) : null}

                                                <Button
                                                    shape='round'
                                                    icon={<DownloadOutlined />}
                                                    onClick={handleDownloadCurrentView}
                                                >
                                                    Download
                                                </Button>
                                            </Space>
                                        </Col>
                                    </Row>
                                }
                            >
                                <HighchartsReact highcharts={Highcharts} options={timelineChartOptions} />
                            </MotionCard>
                        </Col>
                    </Row>
                </>
            )}

            <Modal
                open={overtimeModalOpen}
                title='Confirm overtime'
                onCancel={() => {
                    setOvertimeModalOpen(false)
                    setPendingOvertimeCheckout(null)
                }}
                onOk={confirmOvertimeCheckout}
                okText='Submit for approval'
                confirmLoading={submittingOvertime}
            >
                <Space direction='vertical' style={{ width: '100%' }} size={12}>
                    <Alert
                        type='info'
                        showIcon
                        message={`Clocking out at ${pendingOvertimeCheckout?.now} is ${pendingOvertimeCheckout?.overtimeStr} past the normal shift end.`}
                        description='Your current location is checked against the branch center and submitted with this request. A supervisor must approve it before it counts as paid overtime.'
                    />
                    <div>
                        <Text strong>Reason for overtime</Text>
                        <Input.TextArea
                            rows={3}
                            value={overtimeReasonDraft}
                            onChange={e => setOvertimeReasonDraft(e.target.value)}
                            placeholder='What were you working on?'
                        />
                    </div>
                </Space>
            </Modal>
        </div>
    )
}

export default ClockinPage
