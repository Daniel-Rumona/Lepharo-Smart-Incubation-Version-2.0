import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Space, Spin, Typography } from 'antd'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    CoffeeOutlined,
    EnvironmentOutlined,
    LogoutOutlined,
    ReloadOutlined
} from '@ant-design/icons'
import { addDoc, collection, doc, onSnapshot, query, Timestamp, updateDoc, where } from 'firebase/firestore'
import { useLocation } from 'react-router-dom'
import { auth, db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLoginPrompt } from '@/contexts/LoginPromptContext'
import { useBranchOperatingHours } from '@/hooks/useBranchOperatingHours'
import { clockMinutes, getDayHours, lateMinutes } from '@/utils/branchOperatingHours'
import './mandatory-daily-clock-in.css'
import { signOutApp } from '@/lib/firestoreCache'

const { Text, Title } = Typography

const REQUIRED_ROLES = new Set(['employee', 'coordinator'])
const PUBLIC_PATHS = new Set(['/', '/login', '/reset-password'])

type LocationState = {
    status: 'idle' | 'requesting' | 'ready' | 'denied' | 'error' | 'unsupported'
    latitude?: number
    longitude?: number
    accuracy?: number
    message: string
}

const dateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const timeKey = (date = new Date()) =>
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

const MandatoryDailyClockIn = () => {
    const { user, loading: identityLoading, isViewingAs } = useFullIdentity()
    const branchSchedule = useBranchOperatingHours(user, identityLoading)
    const { setClockGateState } = useLoginPrompt()
    const routeLocation = useLocation()
    const normalizedRole = String(user?.role || '').trim().toLowerCase()
    const [currentDate, setCurrentDate] = useState(() => new Date())
    const todayHours = getDayHours(branchSchedule.hours, currentDate)
    const normalizedEmail = String(
        user?.email || auth.currentUser?.email || ''
    )
        .trim()
        .toLowerCase()

    const isQuantilytixEmail = normalizedEmail.endsWith('@quantilytix.co.za')
    const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes()
    const clockInAvailable = !todayHours.closed && currentMinutes >= Math.max(0, clockMinutes(todayHours.opens) - 30)

    // Re-evaluate the weekday while the app remains open so the gate closes
    // automatically when Friday rolls into the weekend.
    useEffect(() => {
        const intervalId = window.setInterval(() => setCurrentDate(new Date()), 60_000)
        return () => window.clearInterval(intervalId)
    }, [])

    const requiresDailyClockIn =
        (branchSchedule.loading || !!branchSchedule.error || clockInAvailable) &&
        !isViewingAs &&
        !isQuantilytixEmail &&
        REQUIRED_ROLES.has(normalizedRole)

    const isPublicRoute = PUBLIC_PATHS.has(routeLocation.pathname) ||
        routeLocation.pathname.startsWith('/registration')

    const [checkingEntry, setCheckingEntry] = useState(true)
    const [hasClockedInToday, setHasClockedInToday] = useState(false)
    const [todayEntry, setTodayEntry] = useState<{ id: string; status: string } | null>(null)
    const [resumeBreakRequired, setResumeBreakRequired] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [permissionState, setPermissionState] = useState<PermissionState | 'unknown'>('unknown')
    const [location, setLocation] = useState<LocationState>({
        status: 'idle',
        message: 'Location permission is required to continue.'
    })
    const initializedSnapshotUser = useRef<string | null>(null)

    const today = dateKey(currentDate)
    const gateOpen = requiresDailyClockIn && !isPublicRoute && !checkingEntry &&
        !branchSchedule.loading && (!hasClockedInToday || resumeBreakRequired || !!branchSchedule.error)

    useEffect(() => {
        if (identityLoading || (requiresDailyClockIn && (checkingEntry || branchSchedule.loading))) {
            setClockGateState('checking')
        } else if (gateOpen) {
            setClockGateState('open')
        } else {
            setClockGateState('complete')
        }
    }, [checkingEntry, gateOpen, identityLoading, requiresDailyClockIn, setClockGateState, branchSchedule.loading])

    useEffect(() => {
        if (identityLoading) return
        if (!requiresDailyClockIn || !user?.uid) {
            setCheckingEntry(false)
            setHasClockedInToday(false)
            setTodayEntry(null)
            setResumeBreakRequired(false)
            initializedSnapshotUser.current = null
            return
        }

        setCheckingEntry(true)
        const timesheetQuery = query(
            collection(db, 'timesheets'),
            where('userId', '==', user.uid)
        )

        return onSnapshot(
            timesheetQuery,
            snapshot => {
                const foundDocument = snapshot.docs.find(snapshotDoc => {
                    const entry = snapshotDoc.data() as any
                    return entry.date === today && !!entry.checkIn && entry.checkIn !== '-'
                })
                const entry = foundDocument
                    ? { id: foundDocument.id, status: String(foundDocument.data().status || '') }
                    : null

                setTodayEntry(entry)
                setHasClockedInToday(!!entry)

                // Only require break resumption when this is the first attendance
                // snapshot after login/page load. Starting a break during the
                // current active session must not immediately reopen this modal.
                if (initializedSnapshotUser.current !== user.uid) {
                    initializedSnapshotUser.current = user.uid
                    setResumeBreakRequired(entry?.status === 'on_break')
                } else if (entry?.status !== 'on_break') {
                    setResumeBreakRequired(false)
                }
                setCheckingEntry(false)
            },
            error => {
                console.error('[MandatoryDailyClockIn] timesheet check failed', error)
                // Fail closed for the required roles: do not allow the gate to be bypassed
                // merely because the attendance check could not be completed.
                setCheckingEntry(false)
                setHasClockedInToday(false)
            }
        )
    }, [identityLoading, requiresDailyClockIn, user?.uid, today])

    const saveClockInAt = useCallback(async (position: GeolocationPosition) => {
        const currentUser = auth.currentUser
        if (!currentUser || submitting || isViewingAs || branchSchedule.loading || branchSchedule.error) return

        setSubmitting(true)
        try {
            const now = timeKey()
            const shift = getDayHours(branchSchedule.hours, new Date())
            await addDoc(collection(db, 'timesheets'), {
                userId: currentUser.uid,
                branchId: branchSchedule.branchId || null,
                scheduledHours: shift,
                date: today,
                checkIn: now,
                checkOut: '-',
                status: 'checked_in',
                location: `${position.coords.latitude},${position.coords.longitude}`,
                locationLabel: `Lat ${position.coords.latitude.toFixed(6)}, Lng ${position.coords.longitude.toFixed(6)}`,
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                locationAccuracy: position.coords.accuracy || null,
                locationVerified: true,
                locationQuality: (position.coords.accuracy || Infinity) <= 50
                    ? 'high'
                    : (position.coords.accuracy || Infinity) <= 150
                        ? 'medium'
                        : 'low',
                locationCaptureFailed: false,
                locationFailureReason: '',
                autoClockedOut: false,
                autoClockOutReason: '',
                auditFlag: (position.coords.accuracy || 0) > 150 ? 'LOW_ACCURACY_LOCATION' : '',
                hoursWorked: '0h 0m',
                lateBy: `${lateMinutes(now, shift)}m`,
                overtime: '0h 0m',
                createdAt: Timestamp.now()
            })
            setHasClockedInToday(true)
        } catch (error) {
            console.error('[MandatoryDailyClockIn] clock-in failed', error)
            setLocation(previous => ({
                ...previous,
                status: 'error',
                message: 'Clock-in could not be saved. Check your connection and try again.'
            }))
        } finally {
            setSubmitting(false)
        }
    }, [submitting, today, isViewingAs, branchSchedule.loading, branchSchedule.error, branchSchedule.hours, branchSchedule.branchId])

    const requestLocation = useCallback(() => {
        if (!window.isSecureContext) {
            setLocation({
                status: 'error',
                message: 'Location permission requires a secure HTTPS connection (or localhost).'
            })
            return
        }

        if (!navigator.geolocation) {
            setLocation({
                status: 'unsupported',
                message: 'This browser does not support location. Use a supported browser to clock in.'
            })
            return
        }

        if (permissionState === 'denied') {
            setLocation({
                status: 'denied',
                message: 'Location is blocked for this site. Select the lock/site-controls icon beside the address, change Location to Allow, then press the button again.'
            })
            return
        }

        setLocation({
            status: 'requesting',
            message: 'Waiting for the browser location prompt and a GPS reading…'
        })

        let bestPosition: GeolocationPosition | null = null
        let completed = false

        const finishWithPosition = (position: GeolocationPosition) => {
            if (completed) return
            completed = true
            window.clearTimeout(timeoutId)
            navigator.geolocation.clearWatch(watchId)
            setPermissionState('granted')
            setLocation({
                status: 'ready',
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                message: `Location confirmed to approximately ${Math.round(position.coords.accuracy)} metres.`
            })
            void saveClockInAt(position)
        }

        const finishWithError = (error?: GeolocationPositionError) => {
            if (completed) return
            if (bestPosition) {
                finishWithPosition(bestPosition)
                return
            }

            completed = true
            window.clearTimeout(timeoutId)
            navigator.geolocation.clearWatch(watchId)
            const denied = error?.code === 1
            if (denied) setPermissionState('denied')
            setLocation({
                status: denied ? 'denied' : 'error',
                message: denied
                    ? 'Location is blocked for this site. Select the lock/site-controls icon beside the address, change Location to Allow, then press the button again.'
                    : 'The browser could not obtain a location. Turn on device location, move near a window, and try again.'
            })
        }

        // Called directly by the click handler so a browser whose permission is
        // still set to "Ask" can display its native location prompt.
        const watchId = navigator.geolocation.watchPosition(
            position => {
                if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) {
                    bestPosition = position
                }
                if (position.coords.accuracy <= 100) finishWithPosition(position)
            },
            finishWithError,
            { enableHighAccuracy: true, timeout: 18_000, maximumAge: 0 }
        )

        const timeoutId = window.setTimeout(() => {
            if (bestPosition) finishWithPosition(bestPosition)
            else finishWithError()
        }, 18_000)
    }, [permissionState, saveClockInAt])

    useEffect(() => {
        if (!gateOpen || !navigator.permissions?.query) return

        let permission: PermissionStatus | undefined
        navigator.permissions.query({ name: 'geolocation' }).then(result => {
            permission = result
            setPermissionState(result.state)
            permission.onchange = () => {
                const nextState = permission?.state || 'unknown'
                setPermissionState(nextState)
                if (nextState === 'granted') {
                    setLocation({
                        status: 'idle',
                        message: 'Location permission is ready. Press the button to confirm your position.'
                    })
                }
            }
        }).catch(() => undefined)

        return () => {
            if (permission) permission.onchange = null
        }
    }, [gateOpen])

    const continueDay = async () => {
        if (!todayEntry?.id || submitting) return

        setSubmitting(true)
        try {
            await updateDoc(doc(db, 'timesheets', todayEntry.id), {
                status: 'checked_in',
                breakEndedAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            })
            setResumeBreakRequired(false)
        } catch (error) {
            console.error('[MandatoryDailyClockIn] resume from break failed', error)
        } finally {
            setSubmitting(false)
        }
    }

    const logout = async () => {
        setHasClockedInToday(false)
        setLocation({ status: 'idle', message: 'Location permission is required to continue.' })
        // Signs out, clears the cached Firestore documents and replaces the
        // document. A client-side navigate() would leave the app running against
        // a terminated Firestore client.
        await signOutApp('/login')
    }

    if (identityLoading || !requiresDailyClockIn) return null

    return (
        <Modal
            open={gateOpen}
            closable={false}
            maskClosable={false}
            keyboard={false}
            footer={null}
            width={440}
            centered
            destroyOnClose={false}
            styles={{
                mask: {
                    background: 'rgba(15, 23, 42, .44)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)'
                },
                body: { padding: '10px 4px 4px' }
            }}
        >
            <Space direction="vertical" size={18} style={{ width: '100%', textAlign: 'center' }}>
                <div>
                    <ClockCircleOutlined style={{ color: '#1677ff', fontSize: 34 }} />
                    <Title level={3} style={{ margin: '10px 0 2px' }}>
                        {resumeBreakRequired ? 'Continue your workday' : 'Start your workday'}
                    </Title>
                    <Text type="secondary">
                        {user?.name ? `Welcome, ${user.name}. ` : ''}
                        {resumeBreakRequired
                            ? 'Your previous session is still on break.'
                            : 'Confirm your location to clock in.'}
                    </Text>
                </div>

                {branchSchedule.error ? (
                    <Alert type='error' showIcon message={branchSchedule.error}
                        action={<Button onClick={branchSchedule.retry}>Retry</Button>} />
                ) : checkingEntry ? (
                    <Spin tip="Checking today’s attendance…" />
                ) : (
                    <Alert
                        showIcon
                        type={resumeBreakRequired ? 'info' : location.status === 'ready' ? 'success' : location.status === 'requesting' ? 'info' : 'warning'}
                        icon={resumeBreakRequired ? <CoffeeOutlined /> : location.status === 'ready' ? <CheckCircleOutlined /> : <EnvironmentOutlined />}
                        message={resumeBreakRequired ? 'Currently on break' : location.status === 'ready' ? 'Location confirmed' : 'Location required'}
                        description={resumeBreakRequired
                            ? 'Continue your day to end the break and return your attendance status to checked in.'
                            : location.message}
                        style={{ textAlign: 'left' }}
                    />
                )}

                <div className="mandatory-clock-orb-wrap">
                    <button
                        type="button"
                        className={`mandatory-clock-orb ${(location.status === 'ready' || resumeBreakRequired) ? 'mandatory-clock-orb--ready' : ''}`}
                        disabled={!!branchSchedule.error || branchSchedule.loading || submitting || (!resumeBreakRequired && location.status === 'requesting')}
                        onClick={resumeBreakRequired ? continueDay : requestLocation}
                    >
                        <span className="mandatory-clock-orb__icon">
                            {submitting || (!resumeBreakRequired && location.status === 'requesting')
                                ? <Spin size="small" />
                                : resumeBreakRequired
                                    ? <CoffeeOutlined />
                                    : location.status === 'ready'
                                        ? <ClockCircleOutlined />
                                        : <ReloadOutlined />}
                        </span>
                        <span className="mandatory-clock-orb__label">
                            {resumeBreakRequired
                                ? 'Continue day'
                                : location.status === 'ready'
                                    ? 'Saving clock-in'
                                    : location.status === 'requesting'
                                        ? 'Locating…'
                                        : permissionState === 'denied'
                                            ? 'Retry location'
                                            : 'Allow location & clock in'}
                        </span>
                        <span className="mandatory-clock-orb__hint">
                            {resumeBreakRequired
                                ? 'End break and resume work'
                                : location.status === 'ready'
                                    ? 'Clock-in is saved automatically'
                                    : permissionState === 'denied'
                                        ? 'Allow it in browser settings'
                                        : 'Required to continue'}
                        </span>
                    </button>
                </div>

                <Text type="secondary" style={{ fontSize: 12 }}>
                    This step is required once per workday and cannot be skipped.
                </Text>

                <Button
                    danger
                    block
                    icon={<LogoutOutlined />}
                    onClick={logout}
                    style={{ borderRadius: 10, borderWidth: 1.5, fontWeight: 600 }}
                >
                    Logout
                </Button>
            </Space>
        </Modal>
    )
}

export default MandatoryDailyClockIn
