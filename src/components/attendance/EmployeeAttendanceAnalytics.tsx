import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Table,
    Tag,
    Typography,
    Space,
    Empty,
    message,
    Button,
    Select,
    Modal,
    Form,
    Input,
    Alert,
    InputNumber,
    DatePicker,
    Popconfirm,
    Skeleton
} from 'antd'
import {
    TeamOutlined,
    ClockCircleOutlined,
    CheckCircleOutlined,
    EnvironmentOutlined,
    ExclamationCircleOutlined,
    HomeOutlined,
    FieldTimeOutlined,
    CloseCircleOutlined,
    BarChartOutlined
} from '@ant-design/icons'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
    QueryConstraint
} from 'firebase/firestore'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { db } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    resolveAttendanceVisibleEmployees,
    AttendanceScopedEmployee
} from '@/services/attendanceVisibility'
import {
    CenterLocation,
    DEFAULT_CENTER_RADIUS_METERS,
    buildCenterDocId,
    isCenterClockIn,
    isCenterConfigured,
    resolveCenterLocationForUser
} from '@/services/attendanceCenters'
import dayjs, { Dayjs } from 'dayjs'
import { LoadingOverlay } from '../shared/LoadingOverlay'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const { Text } = Typography

export type TimesheetEntry = {
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
    locationQuality?: 'high' | 'medium' | 'low'
    autoClockedOut?: boolean
    autoClockedOutAt?: any
    autoClockOutReason?: string
    auditFlag?: string
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

type CenterLocationForm = {
    locationLabel: string
    latitude?: number
    longitude?: number
    radiusMeters?: number
}

type Props = {
    title?: string
    days?: number
    startDate?: string
    endDate?: string
    showCurrentTable?: boolean
    compact?: boolean
    employees?: AttendanceScopedEmployee[]
    departmentId?: string
    enableDownloadEvent?: boolean
}

const uniqueStrings = (values: Array<string | undefined | null>) =>
    [...new Set(values.filter(Boolean).map(v => String(v)))]

const chunkArray = <T,>(items: T[], size: number): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
    return out
}

const parseTimeToDate = (timeStr?: string) => {
    if (!timeStr || timeStr === '-') return null

    const cleaned = timeStr.replace(/\s/g, '')
    const match = cleaned.match(/^(\d{1,2}):(\d{2})(AM|PM)?$/i)

    if (!match) return null

    let hour = Number(match[1])
    const minute = Number(match[2])
    const meridian = match[3]?.toUpperCase()

    if (meridian === 'PM' && hour < 12) hour += 12
    if (meridian === 'AM' && hour === 12) hour = 0

    const d = new Date()
    d.setHours(hour, minute, 0, 0)

    return d
}

const diffAsHoursMinutes = (from?: string, to?: string) => {
    const a = parseTimeToDate(from)
    const b = to ? parseTimeToDate(to) : new Date()

    if (!a || !b) return '0h 0m'

    const totalMinutes = Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60000))
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60

    return `${h}h ${m}m`
}

const timeStringToHours = (value?: string) => {
    if (!value) return 0

    const match = /(\d+)h\s+(\d+)m/.exec(value)

    if (!match) return 0

    return Number(match[1]) + Number(match[2]) / 60
}

const looksLikeCoordinates = (value?: string) => {
    const text = String(value || '').trim()
    if (!text) return false

    return /^-?\d+(?:\.\d+)?\s*[,;/]\s*-?\d+(?:\.\d+)?$/.test(text)
}

const readableLocation = (value?: string) => {
    const text = String(value || '').trim()
    return text && !looksLikeCoordinates(text) ? text : ''
}

const getAttendanceLocationText = (
    row: TimesheetEntry & { centerStatus?: 'at_center' | 'outside' },
    center?: CenterLocation | null
) => {
    if (row.centerStatus === 'at_center') {
        return center?.locationLabel || center?.centerName || 'At Center'
    }

    return (
        readableLocation(row.locationLabel) ||
        readableLocation(row.location) ||
        'Outside Center'
    )
}

const peopleLabel = (count: number) =>
    `${count} ${count === 1 ? 'person' : 'people'}`

const hasPositiveDuration = (value?: string) => {
    const text = String(value || '').trim().toLowerCase()
    if (!text || ['0', '0m', '0h', '0h 0m', '-', '—'].includes(text)) return false
    return /[1-9]/.test(text)
}

const isMissingCheckout = (row: TimesheetEntry) =>
    dayjs(row.date).isBefore(dayjs(), 'day') &&
    (!row.checkOut || row.checkOut === '-') &&
    !row.autoClockedOut


const isCurrentlyInRow = (row: TimesheetEntry) =>
    (row.status === 'checked_in' || row.status === 'on_break') &&
    (!row.checkOut || row.checkOut === '-')

const getEmployeeMap = (employees: AttendanceScopedEmployee[]) => {
    const map = new Map<string, AttendanceScopedEmployee>()

    employees.forEach(emp => {
        map.set(emp.id, emp)
        if (emp.authUid) map.set(emp.authUid, emp)
        if (emp.uid) map.set(emp.uid, emp)
    })

    return map
}

const getEmployeeDepartmentId = (emp?: AttendanceScopedEmployee) =>
    String(
        (emp as any)?.department?.id ||
        (emp as any)?.departmentId ||
        ''
    )

const getEmployeeDepartmentName = (emp?: AttendanceScopedEmployee) =>
    String(
        (emp as any)?.department?.name ||
        (emp as any)?.departmentName ||
        (emp as any)?.department ||
        'Unassigned Department'
    )


const getEmployeeRole = (emp?: AttendanceScopedEmployee) =>
    String((emp as any)?.role || '').trim().toLowerCase()

const PROJECTADMIN_ATTENDANCE_ROLES = new Set([
    'coordinator',
    'receptionist',
    'employee'
])

const getUserBranchId = (user?: any) =>
    typeof user?.assignedBranch === 'string'
        ? user.assignedBranch.trim()
        : ''

const fetchBranchNameById = async (branchId: string) => {
    if (!branchId) return ''

    const snap = await getDoc(doc(db, 'branches', branchId))

    if (!snap.exists()) return ''

    const data = snap.data() as { name?: string }

    return String(data.name || '').trim()
}


const toCsvHeader = (value: string) =>
    value
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase())

const downloadCsv = (rows: Record<string, any>[], filename: string) => {
    if (!rows.length) {
        message.warning('No data to download for the selected filters.')
        return
    }

    const keys = Object.keys(rows[0])
    const headers = keys.map(toCsvHeader)

    const csv = [
        headers.join(','),
        ...rows.map(row =>
            keys
                .map(key => {
                    const value = row[key] ?? ''
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

const EmployeeAttendanceAnalytics: React.FC<Props> = ({
    title = 'Attendance Analytics',
    days = 7,
    startDate,
    endDate,
    compact = false,
    employees: employeesProp,
    departmentId,
    enableDownloadEvent = false
}) => {
    const { user } = useFullIdentity()

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'employee-attendance-analytics',
            pageTitle: 'Attendance Analytics',
            guides: [
                {
                    id: 'attendance-analytics-overview',
                    title: 'Quick tour',
                    description:
                        'Understand the attendance summary, reporting filters, attendance records and review tools.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('attendance-metrics'),
                            popover: {
                                title: 'Attendance overview',
                                description:
                                    'These cards summarise the team in scope, who checked in today, who is currently present and who needs attention.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('attendance-filter-bar'),
                            popover: {
                                title: 'Attendance filters',
                                description:
                                    'Change the reporting period, search for an employee and narrow the records by department, attendance status or center location.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('attendance-records-table'),
                            popover: {
                                title: 'Attendance records',
                                description:
                                    'Review check-in and check-out times, hours worked, attendance flags and whether each clock-in matched the configured center.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('attendance-trends-action'),
                            popover: {
                                title: 'Attendance trends',
                                description:
                                    'Open the trend view to compare employee attendance and recorded hours across the selected reporting period.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('center-settings-action'),
                            waitForElement: 1200,
                            skipMissingElement: true,
                            popover: {
                                title: 'Center settings',
                                description:
                                    'Project admins can configure the branch center GPS point and the allowed clock-in radius from here.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('pending-overtime-section'),
                            waitForElement: 1200,
                            skipMissingElement: true,
                            popover: {
                                title: 'Pending overtime',
                                description:
                                    'When overtime requests are waiting for a decision, they appear here with the recorded reason and location status.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'review-attendance-record',
                    title: 'Review an attendance record',
                    description:
                        'Open an attendance entry and inspect its timing, location and attendance flags.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: '[data-guide="attendance-details-action"]',
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: 'Open attendance details',
                                description:
                                    'Select Details on any attendance row to inspect the full record.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-attendance-details-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Attendance details',
                                description:
                                    'This view shows the employee, date, hours, check-in and check-out times, location status and any recorded attendance flags.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('attendance-detail-location'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Clock-in location',
                                description:
                                    'See whether the clock-in matched the configured center and, when available, the readable location and device accuracy.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('attendance-detail-flags'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Attendance flags',
                                description:
                                    'Late arrival, missing checkout, auto clock-out, overtime and audit flags are grouped here for quick review.',
                                side: 'right',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'review-attendance-trends',
                    title: 'Review attendance trends',
                    description:
                        'Open the trend view and interpret attendance and recorded-hours activity.',
                    kind: 'task',
                    order: 3,
                    steps: [
                        {
                            element: guideTarget('attendance-trends-action'),
                            advanceOnClick: true,
                            popover: {
                                title: 'View Trends',
                                description:
                                    'Open the attendance trend analysis for the current filters.',
                                side: 'bottom',
                                align: 'end',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-attendance-trends-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Attendance trends',
                                description:
                                    'The trend view inherits the current reporting range and attendance filters.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('attendance-trends-chart'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Trend chart',
                                description:
                                    'For a single employee the chart focuses on hours worked. For a wider team it compares checked-in employees with recorded hours.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'review-attendance-attention',
                    title: 'Review attendance issues',
                    description:
                        'See who has not clocked in and which attendance records require attention today.',
                    kind: 'task',
                    order: 4,
                    steps: [
                        {
                            element: guideTarget('needs-attention-metric'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Needs Attention',
                                description:
                                    'Open this card to review today’s missing clock-ins and flagged attendance records.',
                                side: 'bottom',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-attendance-attention-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Today’s attention',
                                description:
                                    'The modal separates employees with no clock-in from records flagged for lateness, auto clock-out, overtime, audit review or being outside the center.',
                                side: 'left',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'configure-attendance-center',
                    title: 'Configure the attendance center',
                    description:
                        'Set the branch center location and allowed clock-in radius.',
                    kind: 'task',
                    order: 5,
                    steps: [
                        {
                            element: guideTarget('center-settings-action'),
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: 'Center Settings',
                                description:
                                    'Project admins can open the center setup from the attendance toolbar.',
                                side: 'bottom',
                                align: 'end',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-center-settings-modal',
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Center setup',
                                description:
                                    'Set the displayed address, capture the physical GPS point and choose the permitted radius for center clock-ins.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('center-location-label'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Displayed location',
                                description:
                                    'Enter the official address staff and reports should display for this center.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('capture-center-location'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Capture center GPS',
                                description:
                                    'While physically at the center, capture the device GPS point used for location verification.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('center-radius'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Allowed radius',
                                description:
                                    'Choose how far from the saved center point a clock-in may still count as being at the center.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-center-settings-submit',
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Save center',
                                description:
                                    'Save the location and radius after the GPS point has been captured.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'review-overtime-request',
                    title: 'Review overtime requests',
                    description:
                        'Approve or reject pending overtime using the recorded reason and location status.',
                    kind: 'task',
                    order: 6,
                    steps: [
                        {
                            element: guideTarget('pending-overtime-section'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Pending overtime approvals',
                                description:
                                    'Overtime requests appear here after an employee clocks out past shift end and provides a reason.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="overtime-approve-action"]',
                            waitForElement: 1200,
                            skipMissingElement: true,
                            popover: {
                                title: 'Approve overtime',
                                description:
                                    'Approve when the reason and recorded location support the overtime request.',
                                side: 'left',
                                align: 'center'
                            }
                        },
                        {
                            element: '[data-guide="overtime-reject-action"]',
                            waitForElement: 1200,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: 'Reject overtime',
                                description:
                                    'Reject when the request should not be approved. A note is required before the decision is saved.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-overtime-reject-modal',
                            waitForElement: 3000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Rejection note',
                                description:
                                    'Explain why the overtime was rejected. The note remains visible in the attendance record.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-overtime-reject-submit',
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Confirm rejection',
                                description:
                                    'Save the rejection after the required note has been entered.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    const [scopedEmployees, setScopedEmployees] = useState<AttendanceScopedEmployee[]>([])
    const [loadingEmployees, setLoadingEmployees] = useState(true)

    const [todayRows, setTodayRows] = useState<TimesheetEntry[]>([])
    const [historicalRows, setHistoricalRows] = useState<TimesheetEntry[]>([])
    const [loadingCurrent, setLoadingCurrent] = useState(true)
    const [loadingHistory, setLoadingHistory] = useState(true)
    const [hasLoadedHistoryOnce, setHasLoadedHistoryOnce] = useState(false)

    const [departmentFilter, setDepartmentFilter] = useState<string>('all')
    const [departmentIsMain, setDepartmentIsMain] = useState(false)
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
        dayjs(startDate || dayjs().subtract(days - 1, 'day')),
        dayjs(endDate || dayjs())
    ])

    const [centerLocation, setCenterLocation] = useState<CenterLocation | null>(null)
    const [centerModalOpen, setCenterModalOpen] = useState(false)
    const [loadingCenter, setLoadingCenter] = useState(false)
    const [savingCenter, setSavingCenter] = useState(false)

    const [centerForm] = Form.useForm<CenterLocationForm>()
    const centerLatitude = Form.useWatch('latitude', centerForm)
    const centerLongitude = Form.useWatch('longitude', centerForm)
    const [centerCaptureAccuracy, setCenterCaptureAccuracy] = useState<number | null>(null)

    const [rejectingRow, setRejectingRow] = useState<any | null>(null)
    const [rejectNote, setRejectNote] = useState('')
    const [decidingId, setDecidingId] = useState<string | null>(null)

    const [attendanceSearch, setAttendanceSearch] = useState('')
    const [attendanceStatusFilter, setAttendanceStatusFilter] = useState('all')
    const [attendanceLocationFilter, setAttendanceLocationFilter] = useState('all')
    const [selectedAttendanceRow, setSelectedAttendanceRow] = useState<any | null>(null)
    const [trendsOpen, setTrendsOpen] = useState(false)
    const [attentionOpen, setAttentionOpen] = useState(false)

    const normalizedRole = String(user?.role || '').trim().toLowerCase()
    const isProjectAdmin = normalizedRole === 'projectadmin'
    const isOperations = normalizedRole === 'operations'
    const isMainOperations = isOperations && departmentIsMain
    const canSwitchDepartment = isProjectAdmin || isMainOperations

    const userBranchId = useMemo(() => getUserBranchId(user), [user])
    const [userBranchName, setUserBranchName] = useState('')

    useEffect(() => {
        let active = true

        const loadBranchName = async () => {
            if (!userBranchId) {
                if (active) setUserBranchName('')
                return
            }

            try {
                const branchName = await fetchBranchNameById(userBranchId)
                if (active) setUserBranchName(branchName)
            } catch (error) {
                console.error('[EmployeeAttendanceAnalytics] branch name load failed', error)
                if (active) setUserBranchName('')
            }
        }

        void loadBranchName()
        return () => { active = false }
    }, [userBranchId])

    const effectiveStartDate = dateRange[0].format('YYYY-MM-DD')
    const effectiveEndDate = dateRange[1].format('YYYY-MM-DD')

    useEffect(() => {
        setDateRange([
            dayjs(startDate || dayjs().subtract(days - 1, 'day')),
            dayjs(endDate || dayjs())
        ])
    }, [startDate, endDate, days])

    useEffect(() => {
        let active = true

        const resolveDepartmentScope = async () => {
            if (!isOperations || !user?.departmentId) {
                if (active) setDepartmentIsMain(false)
                return
            }

            try {
                const departmentSnap = await getDoc(doc(db, 'departments', user.departmentId))
                const profileSaysMain = user?.isMain === true || user?.departmentIsMain === true
                if (active) {
                    setDepartmentIsMain(
                        departmentSnap.exists()
                            ? departmentSnap.data()?.isMain === true
                            : profileSaysMain
                    )
                }
            } catch (error) {
                console.error('[EmployeeAttendanceAnalytics] department scope load failed', error)
                if (active) {
                    setDepartmentIsMain(user?.isMain === true || user?.departmentIsMain === true)
                }
            }
        }

        void resolveDepartmentScope()
        return () => { active = false }
    }, [isOperations, user?.departmentId, user?.isMain, user?.departmentIsMain])

    useEffect(() => {
        setDepartmentFilter(canSwitchDepartment ? 'all' : (isOperations ? user?.departmentId || 'all' : 'all'))
    }, [canSwitchDepartment, isOperations, user?.departmentId])

    const centerDocId = useMemo(
        () => buildCenterDocId({ branchId: userBranchId }),
        [userBranchId]
    )

    useEffect(() => {
        let mounted = true

        const loadEmployees = async () => {
            if (employeesProp) {
                setScopedEmployees(employeesProp)
                setLoadingEmployees(false)
                return
            }

            if (!user) {
                if (mounted) {
                    setScopedEmployees([])
                    setLoadingEmployees(false)
                }
                return
            }

            setLoadingEmployees(true)

            try {
                const rows = await resolveAttendanceVisibleEmployees(user)

                if (mounted) {
                    setScopedEmployees(rows)
                }
            } catch (error) {
                console.error('[EmployeeAttendanceAnalytics] visibility load failed', error)
                message.error('Failed to load attendance visibility.')

                if (mounted) {
                    setScopedEmployees([])
                }
            } finally {
                if (mounted) {
                    setLoadingEmployees(false)
                }
            }
        }

        loadEmployees()

        return () => {
            mounted = false
        }
    }, [
        employeesProp,
        user?.uid,
        user?.role,
        user?.departmentId,
        user?.assignedBranch
    ])

    useEffect(() => {
        let mounted = true

        const loadCenter = async () => {
            if (!user || !userBranchId) {
                setCenterLocation(null)
                return
            }

            try {
                const center = await resolveCenterLocationForUser(db, user)
                if (mounted) setCenterLocation(center)
            } catch (error) {
                console.error('[EmployeeAttendanceAnalytics] center location load failed', error)
                if (mounted) setCenterLocation(null)
            }
        }

        loadCenter()

        return () => {
            mounted = false
        }
    }, [user, userBranchId])

    const scopeFilteredEmployees = useMemo(() => {
        return scopedEmployees.filter(emp => {
            const matchesRole =
                !isProjectAdmin ||
                PROJECTADMIN_ATTENDANCE_ROLES.has(getEmployeeRole(emp))

            const matchesDepartment =
                !departmentId ||
                departmentId === 'all' ||
                getEmployeeDepartmentId(emp) === departmentId

            return matchesRole && matchesDepartment
        })
    }, [scopedEmployees, departmentId, isProjectAdmin])

    const availableDepartments = useMemo(() => {
        const map = new Map<string, string>()

        scopeFilteredEmployees.forEach(emp => {
            const id = getEmployeeDepartmentId(emp)
            const name = getEmployeeDepartmentName(emp)
            if (id) map.set(id, name)
        })

        return [...map.entries()]
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label))
    }, [scopeFilteredEmployees])

    const filteredEmployees = useMemo(() => {
        const enforcedDepartment = canSwitchDepartment
            ? departmentFilter
            : isOperations
                ? user?.departmentId || 'all'
                : 'all'

        return scopeFilteredEmployees.filter(emp =>
            enforcedDepartment === 'all' || getEmployeeDepartmentId(emp) === enforcedDepartment
        )
    }, [scopeFilteredEmployees, canSwitchDepartment, departmentFilter, isOperations, user?.departmentId])

    const employeeMap = useMemo(
        () => getEmployeeMap(scopeFilteredEmployees),
        [scopeFilteredEmployees]
    )

    const filteredEmployeeIds = useMemo(
        () =>
            new Set(
                uniqueStrings(
                    filteredEmployees.flatMap(emp => [emp.authUid, emp.uid, emp.id])
                )
            ),
        [filteredEmployees]
    )

    const candidateIds = useMemo(
        () =>
            uniqueStrings(
                scopeFilteredEmployees.flatMap(emp => [emp.authUid, emp.uid, emp.id])
            ),
        [scopeFilteredEmployees]
    )

    useEffect(() => {
        if (!candidateIds.length) {
            setTodayRows([])
            setLoadingCurrent(false)
            return
        }

        setLoadingCurrent(true)

        const today = dayjs().format('YYYY-MM-DD')
        const chunks = chunkArray(candidateIds, 10)
        const unsubscribers: Array<() => void> = []
        const store = new Map<string, TimesheetEntry>()

        chunks.forEach(ids => {
            const qy = query(
                collection(db, 'timesheets'),
                where('date', '==', today),
                where('userId', 'in', ids)
            )

            const unsub = onSnapshot(
                qy,
                snap => {
                    const currentIds = new Set(snap.docs.map(d => d.id))

                    snap.docs.forEach(docSnap => {
                        const row = { id: docSnap.id, ...(docSnap.data() as any) } as TimesheetEntry
                        store.set(docSnap.id, row)
                    })

                    for (const [key, value] of store.entries()) {
                        if (ids.includes(String(value.userId)) && !currentIds.has(key) && value.date === today) {
                            store.delete(key)
                        }
                    }

                    const next = [...store.values()].sort((a, b) =>
                        String(a.checkIn || '').localeCompare(String(b.checkIn || ''))
                    )

                    setTodayRows(next)
                    setLoadingCurrent(false)
                },
                err => {
                    console.error('[EmployeeAttendanceAnalytics] current snapshot failed', err)
                    setLoadingCurrent(false)
                }
            )

            unsubscribers.push(unsub)
        })

        return () => unsubscribers.forEach(fn => fn())
    }, [candidateIds])

    useEffect(() => {
        const loadHistory = async () => {
            if (!candidateIds.length) {
                setHistoricalRows([])
                setLoadingHistory(false)
                setHasLoadedHistoryOnce(true)
                return
            }

            setLoadingHistory(true)

            try {
                const chunks = chunkArray(candidateIds, 10)
                const merged = new Map<string, TimesheetEntry>()

                for (const ids of chunks) {
                    const constraints: QueryConstraint[] = [
                        where('userId', 'in', ids),
                        where('date', '>=', effectiveStartDate),
                        where('date', '<=', effectiveEndDate),
                        orderBy('date', 'asc')
                    ]

                    const snap = await getDocs(
                        query(collection(db, 'timesheets'), ...constraints)
                    )

                    snap.docs.forEach(docSnap => {
                        const row = {
                            id: docSnap.id,
                            ...(docSnap.data() as any)
                        } as TimesheetEntry

                        merged.set(docSnap.id || `${row.userId}_${row.date}`, row)
                    })
                }

                setHistoricalRows([...merged.values()])
            } catch (err) {
                console.error('[EmployeeAttendanceAnalytics] history load failed', err)
                setHistoricalRows([])
                message.error('Failed to load attendance history.')
            } finally {
                setLoadingHistory(false)
                setHasLoadedHistoryOnce(true)
            }
        }

        loadHistory()
    }, [candidateIds, effectiveStartDate, effectiveEndDate])

    const filteredTodayRows = useMemo(
        () => todayRows.filter(row => filteredEmployeeIds.has(String(row.userId))),
        [todayRows, filteredEmployeeIds]
    )

    const currentlyLoggedIn = useMemo(() => {
        return filteredTodayRows
            .filter(isCurrentlyInRow)
            .map(row => {
                const emp = employeeMap.get(row.userId)

                return {
                    ...row,
                    employeeName: emp?.name || emp?.email || row.userId,
                    department: getEmployeeDepartmentName(emp),
                    departmentId: getEmployeeDepartmentId(emp),
                    position: (emp as any)?.position || '—',
                    branch: userBranchName || '—',
                    liveHours: row.checkIn
                        ? diffAsHoursMinutes(
                            row.checkIn,
                            row.checkOut && row.checkOut !== '-' ? row.checkOut : undefined
                        )
                        : '0h 0m'
                }
            })
    }, [filteredTodayRows, employeeMap, userBranchName])

    const checkedInTodayIds = useMemo(
        () => new Set(filteredTodayRows.map(row => String(row.userId))),
        [filteredTodayRows]
    )

    const notCheckedInToday = useMemo(
        () =>
            filteredEmployees.filter(emp => {
                const ids = uniqueStrings([emp.authUid, emp.uid, emp.id])
                return !ids.some(id => checkedInTodayIds.has(id))
            }),
        [filteredEmployees, checkedInTodayIds]
    )

    const todayFlaggedUserIds = useMemo(() => {
        const ids = new Set<string>()

        filteredTodayRows.forEach(row => {
            const outsideConfiguredCenter =
                isCenterConfigured(centerLocation) &&
                !isCenterClockIn(row, centerLocation)

            const hasIssue =
                hasPositiveDuration(row.lateBy) ||
                row.autoClockedOut === true ||
                !!String(row.auditFlag || '').trim() ||
                row.overtimeApprovalStatus === 'pending' ||
                outsideConfiguredCenter

            if (hasIssue) ids.add(String(row.userId))
        })

        return ids
    }, [filteredTodayRows, centerLocation])

    const attentionUserIds = useMemo(() => {
        const ids = new Set(todayFlaggedUserIds)

        notCheckedInToday.forEach(emp => {
            ids.add(String(emp.authUid || emp.uid || emp.id))
        })

        return ids
    }, [todayFlaggedUserIds, notCheckedInToday])

    const metrics = useMemo(() => {
        const checkedInToday = new Set(
            filteredTodayRows
                .filter(row => !!row.checkIn && row.checkIn !== '-')
                .map(row => row.userId)
        ).size

        return {
            teamMembers: filteredEmployees.length,
            checkedInToday,
            currentlyIn: currentlyLoggedIn.length,
            needsAttention: attentionUserIds.size
        }
    }, [
        filteredEmployees.length,
        filteredTodayRows,
        currentlyLoggedIn.length,
        attentionUserIds.size
    ])


    const historicalRowsWithEmployees = useMemo(() => {
        return historicalRows
            .filter(row => !!row.checkIn && row.checkIn !== '-')
            .map(row => {
                const emp = employeeMap.get(row.userId)

                const departmentId = getEmployeeDepartmentId(emp)
                const departmentName = getEmployeeDepartmentName(emp)

                return {
                    ...row,
                    employeeName: emp?.name || emp?.email || row.userId,
                    email: emp?.email || '',
                    departmentId: departmentId || departmentName,
                    department: departmentName,
                    position: (emp as any)?.position || '',
                    branch: userBranchName
                }
            })
    }, [historicalRows, employeeMap, userBranchName])

    const pendingOvertimeRows = useMemo(() => {
        return historicalRowsWithEmployees
            .filter(
                row =>
                    filteredEmployeeIds.has(String(row.userId)) &&
                    row.overtimeApprovalStatus === 'pending'
            )
            .sort((a, b) => `${b.date}_${b.checkOut || ''}`.localeCompare(`${a.date}_${a.checkOut || ''}`))
    }, [historicalRowsWithEmployees, filteredEmployeeIds])

    const decideOvertime = async (row: any, decision: 'approved' | 'rejected', note?: string) => {
        if (!row?.id) return

        setDecidingId(row.id)

        try {
            await updateDoc(doc(db, 'timesheets', row.id), {
                overtimeApprovalStatus: decision,
                overtimeDecisionBy: user?.uid || '',
                overtimeDecisionByName: user?.name || user?.displayName || user?.email || '',
                overtimeDecisionAt: serverTimestamp(),
                overtimeDecisionNote: note || ''
            })

            message.success(`Overtime request ${decision}.`)
        } catch (error) {
            console.error('[EmployeeAttendanceAnalytics] overtime decision failed', error)
            message.error('Could not record the decision.')
        } finally {
            setDecidingId(null)
        }
    }

    const submitRejectOvertime = async () => {
        if (!rejectingRow) return

        const note = rejectNote.trim()
        if (!note) {
            message.error('Add a short note explaining the rejection.')
            return
        }

        await decideOvertime(rejectingRow, 'rejected', note)
        setRejectingRow(null)
        setRejectNote('')
    }

    const rangeLoginRows = useMemo(() => {
        return historicalRowsWithEmployees
            .filter(row => filteredEmployeeIds.has(String(row.userId)))
            .map(row => ({
                ...row,
                centerStatus: isCenterClockIn(row, centerLocation) ? 'at_center' : 'outside'
            }))
            .sort((a, b) =>
                `${b.date}_${b.checkIn || ''}_${b.employeeName}`.localeCompare(`${a.date}_${a.checkIn || ''}_${a.employeeName}`)
            )
    }, [historicalRowsWithEmployees, filteredEmployeeIds, centerLocation])

    const attendanceState = (row: any) => {
        const late = hasPositiveDuration(row.lateBy)
        const missingCheckout = isMissingCheckout(row)
        const autoClockedOut = row.autoClockedOut === true
        const overtime =
            hasPositiveDuration(row.overtime) ||
            !!row.overtimeApprovalStatus
        const needsReview = !!String(row.auditFlag || '').trim()

        return {
            late,
            missingCheckout,
            autoClockedOut,
            overtime,
            needsReview,
            clean: !late && !missingCheckout && !autoClockedOut && !overtime && !needsReview
        }
    }

    const filteredAttendanceRows = useMemo(() => {
        const needle = attendanceSearch.trim().toLowerCase()

        return rangeLoginRows.filter(row => {
            if (needle) {
                const haystack = [
                    row.employeeName,
                    row.email,
                    row.department,
                    row.position
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()

                if (!haystack.includes(needle)) return false
            }

            if (
                attendanceLocationFilter !== 'all' &&
                row.centerStatus !== attendanceLocationFilter
            ) {
                return false
            }

            if (attendanceStatusFilter !== 'all') {
                const state = attendanceState(row)

                const matchesStatus =
                    attendanceStatusFilter === 'currently_in'
                        ? row.date === dayjs().format('YYYY-MM-DD') &&
                        isCurrentlyInRow(row)
                        : attendanceStatusFilter === 'on_time'
                            ? state.clean
                            : attendanceStatusFilter === 'late'
                                ? state.late
                                : attendanceStatusFilter === 'missing_checkout'
                                    ? state.missingCheckout
                                    : attendanceStatusFilter === 'auto_clocked_out'
                                        ? state.autoClockedOut
                                        : attendanceStatusFilter === 'overtime'
                                            ? state.overtime
                                            : attendanceStatusFilter === 'needs_review'
                                                ? state.needsReview
                                                : true

                if (!matchesStatus) return false
            }

            return true
        })
    }, [
        rangeLoginRows,
        attendanceSearch,
        attendanceStatusFilter,
        attendanceLocationFilter
    ])

    const attendanceSummary = useMemo(() => {
        const uniquePeople = new Set(filteredAttendanceRows.map(row => row.userId)).size
        const centerClockIns = filteredAttendanceRows.filter(
            row => row.centerStatus === 'at_center'
        ).length
        const outsideClockIns = filteredAttendanceRows.length - centerClockIns
        const centerRate = filteredAttendanceRows.length
            ? Math.round((centerClockIns / filteredAttendanceRows.length) * 100)
            : 0

        return {
            uniquePeople,
            totalClockIns: filteredAttendanceRows.length,
            centerClockIns,
            outsideClockIns,
            centerRate
        }
    }, [filteredAttendanceRows])

    const trendPersonName = useMemo(() => {
        const names = [
            ...new Set(
                filteredAttendanceRows
                    .map(row => String(row.employeeName || '').trim())
                    .filter(Boolean)
            )
        ]

        return names.length === 1 ? names[0] : ''
    }, [filteredAttendanceRows])

    const trendDateLabels = useMemo(
        () =>
            [...new Set(filteredAttendanceRows.map(row => row.date))]
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b)),
        [filteredAttendanceRows]
    )

    const filteredSeries = useMemo(() => {
        return trendDateLabels.map(dateKey => {
            const rows = filteredAttendanceRows.filter(r => r.date === dateKey)
            const uniqueUsers = new Set(rows.map(r => r.userId)).size

            const totalHours = rows.reduce((sum, row) => {
                const hoursWorked =
                    row.hoursWorked && row.hoursWorked !== '0h 0m'
                        ? row.hoursWorked
                        : row.checkIn
                            ? diffAsHoursMinutes(
                                row.checkIn,
                                row.checkOut && row.checkOut !== '-'
                                    ? row.checkOut
                                    : undefined
                            )
                            : '0h 0m'

                return sum + timeStringToHours(hoursWorked)
            }, 0)

            return {
                dateKey,
                label: dayjs(dateKey).format(
                    trendDateLabels.length > 10 ? 'DD MMM' : 'ddd, DD MMM'
                ),
                checkedIns: uniqueUsers,
                hours: Number(totalHours.toFixed(1))
            }
        })
    }, [filteredAttendanceRows, trendDateLabels])

    const todayAttentionRows = useMemo(() => {
        return filteredTodayRows
            .map(row => {
                const emp = employeeMap.get(row.userId)

                return {
                    ...row,
                    employeeName: emp?.name || emp?.email || row.userId,
                    department: getEmployeeDepartmentName(emp),
                    position: (emp as any)?.position || '',
                    centerStatus: isCenterClockIn(row, centerLocation)
                        ? 'at_center'
                        : 'outside'
                }
            })
            .filter(row => {
                const outsideConfiguredCenter =
                    isCenterConfigured(centerLocation) &&
                    row.centerStatus === 'outside'

                return (
                    hasPositiveDuration(row.lateBy) ||
                    row.autoClockedOut === true ||
                    !!String(row.auditFlag || '').trim() ||
                    row.overtimeApprovalStatus === 'pending' ||
                    outsideConfiguredCenter
                )
            })
    }, [filteredTodayRows, employeeMap, centerLocation])

    const showTodayCheckedIn = () => {
        const today = dayjs()
        setDateRange([today, today])
        setAttendanceSearch('')
        setAttendanceStatusFilter('all')
        setAttendanceLocationFilter('all')
    }

    const showCurrentlyIn = () => {
        const today = dayjs()
        setDateRange([today, today])
        setAttendanceSearch('')
        setAttendanceStatusFilter('currently_in')
        setAttendanceLocationFilter('all')
    }

    const chartOptions: Highcharts.Options = useMemo(() => {
        const singlePerson = attendanceSummary.uniquePeople === 1

        if (singlePerson) {
            return {
                chart: {
                    type: 'spline',
                    height: compact ? 300 : 360
                },
                title: {
                    text: trendPersonName
                        ? `Hours Worked — ${trendPersonName}`
                        : 'Hours Worked'
                },
                credits: { enabled: false },
                xAxis: {
                    categories: filteredSeries.map(d => d.label)
                },
                yAxis: {
                    min: 0,
                    title: { text: 'Hours worked' }
                },
                legend: {
                    enabled: false
                },
                tooltip: {
                    shared: false,
                    valueSuffix: 'h'
                },
                plotOptions: {
                    spline: {
                        dataLabels: {
                            enabled: true,
                            format: '{y}h'
                        }
                    }
                },
                series: [
                    {
                        type: 'spline',
                        name: 'Hours worked',
                        data: filteredSeries.map(d => d.hours)
                    }
                ]
            }
        }

        return {
            chart: {
                type: 'column',
                height: compact ? 300 : 360
            },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: {
                categories: filteredSeries.map(d => d.label)
            },
            yAxis: [
                {
                    title: { text: 'Employees' },
                    allowDecimals: false
                },
                {
                    title: { text: 'Hours' },
                    opposite: true,
                    min: 0
                }
            ],
            legend: {
                enabled: true
            },
            tooltip: {
                shared: true
            },
            plotOptions: {
                column: {
                    borderRadius: 6,
                    dataLabels: {
                        enabled: true
                    }
                },
                spline: {
                    dataLabels: {
                        enabled: true,
                        format: '{y}h'
                    }
                }
            },
            series: [
                {
                    type: 'column',
                    name: 'Checked-in employees',
                    data: filteredSeries.map(d => d.checkedIns)
                },
                {
                    type: 'spline',
                    name: 'Recorded hours',
                    yAxis: 1,
                    data: filteredSeries.map(d => d.hours)
                }
            ]
        }
    }, [
        filteredSeries,
        compact,
        attendanceSummary.uniquePeople,
        trendPersonName
    ])

    const exportRows = useMemo(() => {
        return filteredAttendanceRows.map(row => ({
            employeeName: row.employeeName,
            email: row.email,
            department: row.department,
            position: row.position,
            branch: row.branch,
            date: row.date,
            checkIn: row.checkIn || '',
            checkOut: row.checkOut || '',
            status: row.status || '',
            hoursWorked: row.hoursWorked || '0h 0m',
            location: getAttendanceLocationText(row, centerLocation),
            locationStatus: row.centerStatus === 'at_center' ? 'At Center' : 'Outside Center',
            accuracy: row.locationAccuracy ?? '',
            autoClockedOut: row.autoClockedOut ? 'Yes' : 'No',
            overtime: row.overtime || '0h 0m',
            overtimeReason: row.overtimeReason || '',
            overtimeApprovalStatus: row.overtimeApprovalStatus || '',
            overtimeLocationVerified: row.overtimeApprovalStatus ? (row.overtimeLocationVerified ? 'Yes' : 'No') : '',
            auditFlag: row.auditFlag || ''
        }))
    }, [filteredAttendanceRows, centerLocation])

    useEffect(() => {
        if (!enableDownloadEvent) return

        const handler = () => {
            downloadCsv(
                exportRows,
                `team-attendance-${effectiveStartDate}-to-${effectiveEndDate}.csv`
            )
        }

        window.addEventListener('download-team-attendance-analytics', handler)

        return () => {
            window.removeEventListener('download-team-attendance-analytics', handler)
        }
    }, [enableDownloadEvent, exportRows, effectiveStartDate, effectiveEndDate])

    const openCenterModal = async () => {
        if (!isProjectAdmin) return

        if (!userBranchId) {
            message.warning('Your profile is not linked to an assigned branch.')
            return
        }

        setCenterModalOpen(true)
        setLoadingCenter(true)

        try {
            const branchNameFromDb = await fetchBranchNameById(userBranchId)

            if (!branchNameFromDb) {
                message.warning('Your assigned branch could not be found in branches.')
                setCenterModalOpen(false)
                return
            }

            const existingCenter = await resolveCenterLocationForUser(db, user)

            if (existingCenter) {
                centerForm.setFieldsValue({
                    locationLabel: existingCenter.locationLabel || '',
                    latitude: existingCenter.latitude,
                    longitude: existingCenter.longitude,
                    radiusMeters:
                        existingCenter.radiusMeters || DEFAULT_CENTER_RADIUS_METERS
                })
                setCenterCaptureAccuracy(
                    typeof (existingCenter as any).coordinateAccuracyMeters === 'number'
                        ? (existingCenter as any).coordinateAccuracyMeters
                        : null
                )

                setCenterLocation({
                    ...existingCenter,
                    branchId: userBranchId,
                    branchName: branchNameFromDb,
                    centerName: branchNameFromDb
                })
            } else {
                centerForm.setFieldsValue({
                    locationLabel: '',
                    latitude: undefined,
                    longitude: undefined,
                    radiusMeters: DEFAULT_CENTER_RADIUS_METERS
                })
                setCenterCaptureAccuracy(null)
            }
        } catch (error) {
            console.error('[EmployeeAttendanceAnalytics] center modal load failed', error)
            message.error('Failed to load center setup.')
        } finally {
            setLoadingCenter(false)
        }
    }

    const saveCenterLocation = async () => {
        if (!isProjectAdmin) {
            message.warning('Only project admins can update the center.')
            return
        }

        if (!userBranchId) {
            message.warning('Your profile is not linked to an assigned branch.')
            return
        }

        try {
            const values = await centerForm.validateFields()

            setSavingCenter(true)

            const branchNameFromDb = await fetchBranchNameById(userBranchId)

            if (!branchNameFromDb) {
                message.warning('Your assigned branch could not be found in branches.')
                return
            }

            const payload: CenterLocation & {
                coordinateAccuracyMeters?: number
            } = {
                branchId: userBranchId,
                branchName: branchNameFromDb,
                centerName: branchNameFromDb,
                locationLabel: values.locationLabel.trim(),
                radiusMeters: values.radiusMeters || DEFAULT_CENTER_RADIUS_METERS,
                latitude: values.latitude as number,
                longitude: values.longitude as number,
                ...(centerCaptureAccuracy !== null
                    ? { coordinateAccuracyMeters: centerCaptureAccuracy }
                    : {})
            }

            await setDoc(
                doc(db, 'attendanceCenters', centerDocId),
                {
                    ...payload,
                    updatedBy: user?.uid || '',
                    updatedByEmail: user?.email || '',
                    updatedByName: user?.name || user?.displayName || user?.email || '',
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            )

            setCenterLocation({
                id: centerDocId,
                ...payload
            })

            message.success('Center saved.')
            setCenterModalOpen(false)
        } catch (error) {
            if ((error as any)?.errorFields) return

            console.error('[EmployeeAttendanceAnalytics] center save failed', error)
            message.error('Failed to save center.')
        } finally {
            setSavingCenter(false)
        }
    }

    const captureCenterCoordinates = () => {
        if (!navigator.geolocation) {
            message.error('Location is not supported on this device.')
            return
        }

        const hide = message.loading('Confirming the center coordinates…', 0)
        navigator.geolocation.getCurrentPosition(
            position => {
                hide()
                const accuracy = Math.round(position.coords.accuracy)

                centerForm.setFieldsValue({
                    latitude: Number(position.coords.latitude.toFixed(7)),
                    longitude: Number(position.coords.longitude.toFixed(7))
                })
                setCenterCaptureAccuracy(accuracy)
                message.success(`Center coordinates captured (about ${accuracy}m accuracy).`)
            },
            () => {
                hide()
                message.error('Could not capture the center. Allow location and try again while at the center.')
            },
            { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 }
        )
    }

    const rangeLoginColumns = [
        {
            title: 'Employee',
            key: 'employeeName',
            width: 190,
            render: (_: any, row: any) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{row.employeeName}</Text>
                    {row.position ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {row.position}
                        </Text>
                    ) : null}
                </Space>
            )
        },
        {
            title: 'Department',
            dataIndex: 'department',
            key: 'department',
            width: 150
        },
        {
            title: 'Date',
            dataIndex: 'date',
            key: 'date',
            width: 120,
            render: (value: string) => dayjs(value).format('DD MMM YYYY')
        },
        {
            title: 'Time',
            key: 'time',
            width: 145,
            render: (_: any, row: any) => (
                <Text>
                    {row.checkIn || '—'} → {row.checkOut || '—'}
                </Text>
            )
        },
        {
            title: 'Hours',
            key: 'hoursWorked',
            width: 100,
            render: (_: any, row: any) => {
                const hours =
                    row.hoursWorked && row.hoursWorked !== '0h 0m'
                        ? row.hoursWorked
                        : row.checkIn
                            ? diffAsHoursMinutes(
                                row.checkIn,
                                row.checkOut && row.checkOut !== '-'
                                    ? row.checkOut
                                    : undefined
                            )
                            : '0h 0m'

                return <Text strong>{hours}</Text>
            }
        },
        {
            title: 'Attendance',
            key: 'attendance',
            width: 210,
            render: (_: any, row: any) => {
                const state = attendanceState(row)
                const tags: React.ReactNode[] = []

                if (state.late) {
                    tags.push(
                        <Tag key="late" color="gold">
                            Late {row.lateBy}
                        </Tag>
                    )
                }

                if (state.missingCheckout) {
                    tags.push(
                        <Tag key="missing-checkout" color="red">
                            Missing checkout
                        </Tag>
                    )
                }

                if (state.autoClockedOut) {
                    tags.push(
                        <Tag key="auto-clockout" color="orange">
                            Auto clock-out
                        </Tag>
                    )
                }

                if (state.overtime) {
                    tags.push(
                        <Tag key="overtime" color="purple">
                            {hasPositiveDuration(row.overtime)
                                ? `Overtime ${row.overtime}`
                                : 'Overtime'}
                        </Tag>
                    )
                }

                if (state.needsReview) {
                    tags.push(
                        <Tag key="review" color="red">
                            Needs review
                        </Tag>
                    )
                }

                if (
                    row.date === dayjs().format('YYYY-MM-DD') &&
                    row.status === 'on_break'
                ) {
                    tags.push(
                        <Tag key="break" color="blue">
                            On break
                        </Tag>
                    )
                } else if (
                    row.date === dayjs().format('YYYY-MM-DD') &&
                    row.status === 'checked_in' &&
                    (!row.checkOut || row.checkOut === '-')
                ) {
                    tags.push(
                        <Tag key="current" color="blue">
                            Still clocked in
                        </Tag>
                    )
                }

                if (!tags.length) {
                    tags.push(
                        <Tag key="on-time" color="green">
                            On time
                        </Tag>
                    )
                }

                return <Space size={[4, 4]} wrap>{tags}</Space>
            }
        },
        {
            title: 'Location',
            key: 'location',
            width: 210,
            render: (_: any, row: any) => {
                const atCenter = row.centerStatus === 'at_center'
                const locationText = getAttendanceLocationText(row, centerLocation)

                return (
                    <Space direction="vertical" size={2}>
                        <Tag color={atCenter ? 'green' : 'orange'}>
                            {atCenter ? 'At Center' : 'Outside Center'}
                        </Tag>
                        {locationText &&
                            locationText !== 'At Center' &&
                            locationText !== 'Outside Center' ? (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                {locationText}
                            </Text>
                        ) : null}
                    </Space>
                )
            }
        },
        {
            title: '',
            key: 'details',
            width: 90,
            fixed: 'right' as const,
            render: (_: any, row: any) => (
                <Button
                    data-guide="attendance-details-action"
                    type="link"
                    size="small"
                    onClick={() => setSelectedAttendanceRow(row)}
                >
                    Details
                </Button>
            )
        }
    ]

    const pendingOvertimeColumns = [
        {
            title: 'Employee',
            key: 'employeeName',
            render: (_: any, row: any) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{row.employeeName}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{row.department}</Text>
                </Space>
            )
        },
        {
            title: 'Date',
            dataIndex: 'date',
            key: 'date',
            render: (value: string) => dayjs(value).format('DD MMM YYYY')
        },
        {
            title: 'Check In / Out',
            key: 'times',
            render: (_: any, row: any) => `${row.checkIn || '—'} → ${row.checkOut || '—'}`
        },
        {
            title: 'Overtime',
            dataIndex: 'overtime',
            key: 'overtime',
            render: (value: string) => <Tag color="purple">{value || '0h 0m'}</Tag>
        },
        {
            title: 'Reason',
            dataIndex: 'overtimeReason',
            key: 'overtimeReason',
            render: (value: string) => value || <Text type="secondary">No reason given</Text>
        },
        {
            title: 'Location at Checkout',
            key: 'overtimeLocationVerified',
            render: (_: any, row: any) =>
                row.overtimeLocationVerified ? (
                    <Tag color="green">At center</Tag>
                ) : (
                    <Tag color="orange">Not at center</Tag>
                )
        },
        {
            title: 'Decision',
            key: 'decision',
            render: (_: any, row: any) => (
                <Space>
                    <Popconfirm
                        title="Approve this overtime?"
                        onConfirm={() => decideOvertime(row, 'approved')}
                        okText="Approve"
                    >
                        <Button
                            data-guide="overtime-approve-action"
                            size="small"
                            type="primary"
                            loading={decidingId === row.id}
                            icon={<CheckCircleOutlined />}
                        >
                            Approve
                        </Button>
                    </Popconfirm>
                    <Button
                        data-guide="overtime-reject-action"
                        size="small"
                        danger
                        loading={decidingId === row.id}
                        icon={<CloseCircleOutlined />}
                        onClick={() => {
                            setRejectingRow(row)
                            setRejectNote('')
                        }}
                    >
                        Reject
                    </Button>
                </Space>
            )
        }
    ]

    const tableFilterBar = (
        <Space
            data-guide="attendance-filter-bar"
            direction="vertical"
            size={12}
            style={{ width: '100%' }}
        >
            <Row gutter={[12, 12]} align="middle" justify="space-between">
                <Col xs={24} lg={15}>
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Text strong>Attendance Records</Text>

                        <Text type="secondary" style={{ fontSize: 12 }}>
                            Who attended, when they worked, and whether the clock-in matched the configured center.
                        </Text>

                        <Space size={[6, 6]} wrap>
                            <Tag>{peopleLabel(attendanceSummary.uniquePeople)}</Tag>
                            <Tag>{attendanceSummary.totalClockIns} clock-in{attendanceSummary.totalClockIns === 1 ? '' : 's'}</Tag>
                            <Tag color="green">
                                {attendanceSummary.centerClockIns} at center
                            </Tag>
                            <Tag color={attendanceSummary.outsideClockIns ? 'orange' : 'default'}>
                                {attendanceSummary.outsideClockIns} outside
                            </Tag>
                            <Tag color={attendanceSummary.centerRate >= 80 ? 'green' : 'blue'}>
                                {attendanceSummary.centerRate}% center rate
                            </Tag>
                            {notCheckedInToday.length ? (
                                <Tag color="gold">
                                    {notCheckedInToday.length} no clock-in today
                                </Tag>
                            ) : null}
                        </Space>

                        {isCenterConfigured(centerLocation) ? (
                            <Space size={6} wrap>
                                <Tag color="green">Center configured</Tag>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    {centerLocation?.centerName} • {centerLocation?.locationLabel}
                                </Text>
                            </Space>
                        ) : (
                            <Text type="warning" style={{ fontSize: 12 }}>
                                No center configured for this assigned branch. Clock-ins cannot be matched to the center until it is configured.
                            </Text>
                        )}
                    </Space>
                </Col>

                <Col xs={24} lg={9}>
                    <Space
                        wrap
                        style={{
                            width: '100%',
                            justifyContent: 'flex-end'
                        }}
                    >
                        <Button
                            data-guide="attendance-trends-action"
                            icon={<BarChartOutlined />}
                            onClick={() => setTrendsOpen(true)}
                        >
                            View Trends
                        </Button>

                        {isProjectAdmin ? (
                            <Button
                                data-guide="center-settings-action"
                                type="primary"
                                icon={<EnvironmentOutlined />}
                                onClick={openCenterModal}
                            >
                                {isCenterConfigured(centerLocation)
                                    ? 'Center Settings'
                                    : 'Set Center'}
                            </Button>
                        ) : null}
                    </Space>
                </Col>
            </Row>

            <Row gutter={[8, 8]}>
                <Col xs={24} md={12} xl={6}>
                    <DatePicker.RangePicker
                        aria-label="Attendance reporting range"
                        value={dateRange}
                        allowClear={false}
                        style={{ width: '100%' }}
                        onChange={value => {
                            if (!value?.[0] || !value?.[1]) return
                            setDateRange([value[0], value[1]])
                        }}
                    />
                </Col>

                <Col xs={24} md={12} xl={6}>
                    <Input
                        allowClear
                        value={attendanceSearch}
                        onChange={event => setAttendanceSearch(event.target.value)}
                        placeholder="Search employee"
                    />
                </Col>

                {canSwitchDepartment ? (
                    <Col xs={24} md={8} xl={4}>
                        <Select
                            aria-label="Department"
                            value={departmentFilter}
                            onChange={setDepartmentFilter}
                            style={{ width: '100%' }}
                            options={[
                                { value: 'all', label: 'All departments' },
                                ...availableDepartments
                            ]}
                        />
                    </Col>
                ) : null}

                <Col xs={24} md={8} xl={canSwitchDepartment ? 4 : 6}>
                    <Select
                        aria-label="Attendance status"
                        value={attendanceStatusFilter}
                        onChange={setAttendanceStatusFilter}
                        style={{ width: '100%' }}
                        options={[
                            { value: 'all', label: 'All statuses' },
                            { value: 'currently_in', label: 'Currently in' },
                            { value: 'on_time', label: 'On time' },
                            { value: 'late', label: 'Late' },
                            { value: 'missing_checkout', label: 'Missing checkout' },
                            { value: 'auto_clocked_out', label: 'Auto clock-out' },
                            { value: 'overtime', label: 'Overtime' },
                            { value: 'needs_review', label: 'Needs review' }
                        ]}
                    />
                </Col>

                <Col xs={24} md={8} xl={canSwitchDepartment ? 4 : 6}>
                    <Select
                        aria-label="Center location status"
                        value={attendanceLocationFilter}
                        onChange={setAttendanceLocationFilter}
                        style={{ width: '100%' }}
                        options={[
                            { value: 'all', label: 'All locations' },
                            { value: 'at_center', label: 'At center' },
                            { value: 'outside', label: 'Outside center' }
                        ]}
                    />
                </Col>
            </Row>
        </Space>
    )

    const isInitialLoading =
        loadingEmployees ||
        (!hasLoadedHistoryOnce && loadingHistory)

    if (isInitialLoading) {
        return <LoadingOverlay tip="Loading attendance analytics" />
    }

    if (!filteredEmployees.length) {
        return (
            <MotionCard>
                <Empty description="No employees match the selected attendance filters." />
            </MotionCard>
        )
    }

    return (
        <div>
            {title ? (
                <div style={{ marginBottom: 12 }}>
                    <Text strong style={{ fontSize: 16 }}>
                        {title}
                    </Text>
                </div>
            ) : null}

            <Row data-guide="attendance-metrics" gutter={[16, 16]}>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard.Metric
                        icon={<TeamOutlined />}
                        iconBg="rgba(22,119,255,.12)"
                        title="Team Members"
                        value={loadingCurrent ? '...' : metrics.teamMembers}
                        subtitle="In your attendance scope"
                    />
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard.Metric
                        clickable
                        onClick={showTodayCheckedIn}
                        icon={<CheckCircleOutlined />}
                        iconBg="rgba(82,196,26,.12)"
                        title="Checked In Today"
                        value={loadingCurrent ? '...' : metrics.checkedInToday}
                        subtitle={`${notCheckedInToday.length} with no clock-in`}
                    />
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard.Metric
                        clickable
                        onClick={showCurrentlyIn}
                        icon={<ClockCircleOutlined />}
                        iconBg="rgba(22,119,255,.12)"
                        title="Currently In"
                        value={loadingCurrent ? '...' : metrics.currentlyIn}
                        subtitle="Click to show current team"
                    />
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <div data-guide="needs-attention-metric">
                        <MotionCard.Metric
                            clickable
                            onClick={() => setAttentionOpen(true)}
                            icon={<ExclamationCircleOutlined />}
                            iconBg="rgba(250,173,20,.12)"
                            title="Needs Attention"
                            value={loadingCurrent ? '...' : metrics.needsAttention}
                            subtitle={
                                metrics.needsAttention
                                    ? `${notCheckedInToday.length} no clock-in • ${todayFlaggedUserIds.size} flagged`
                                    : 'No attendance issues today'
                            }
                        />
                    </div>
                </Col>
            </Row>


            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col span={24}>
                    <MotionCard filterBar={tableFilterBar}>
                        {loadingHistory ? (
                            <Skeleton
                                active
                                title={false}
                                paragraph={{ rows: 7, width: '100%' }}
                            />
                        ) : (
                            <div data-guide="attendance-records-table">
                                <Table
                                    rowKey={row => row.id || `${row.userId}_${row.date}_${row.checkIn}`}
                                    size="middle"
                                    columns={rangeLoginColumns as any}
                                    dataSource={filteredAttendanceRows}
                                    pagination={{
                                        pageSize: 8,
                                        showSizeChanger: false,
                                        position: ['bottomCenter']
                                    }}
                                    locale={{
                                        emptyText: 'No attendance records found for the selected range.'
                                    }}
                                    scroll={{ x: 1250 }}
                                />
                            </div>
                        )}
                    </MotionCard>
                </Col>
            </Row>

            {pendingOvertimeRows.length ? (
                <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                    <Col span={24}>
                        <div data-guide="pending-overtime-section">
                            <MotionCard>
                                <div style={{ marginBottom: 12 }}>
                                    <Space direction="vertical" size={2}>
                                        <Text strong>
                                            <FieldTimeOutlined /> Pending Overtime Approvals ({pendingOvertimeRows.length})
                                        </Text>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            Overtime only reaches here once an employee clocks out past shift end with a reason. Approve or reject based on the reason and whether their location matched the center at that moment.
                                        </Text>
                                    </Space>
                                </div>

                                {loadingHistory ? (
                                    <Skeleton
                                        active
                                        title={false}
                                        paragraph={{ rows: 4, width: '100%' }}
                                    />
                                ) : (
                                    <Table
                                        rowKey="id"
                                        size="middle"
                                        columns={pendingOvertimeColumns as any}
                                        dataSource={pendingOvertimeRows}
                                        pagination={{ pageSize: 5, showSizeChanger: false }}
                                        scroll={{ x: 900 }}
                                    />
                                )}
                            </MotionCard>
                        </div>
                    </Col>
                </Row>
            ) : null}

            <Modal
                className="guide-attendance-trends-modal"
                open={trendsOpen}
                title={attendanceSummary.uniquePeople === 1 && trendPersonName ? `Work Trend — ${trendPersonName}` : 'Attendance Trends'}
                onCancel={() => setTrendsOpen(false)}
                footer={
                    <Button onClick={() => setTrendsOpen(false)}>
                        Close
                    </Button>
                }
                centered
                width={920}
                destroyOnClose={false}
            >
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Space size={[6, 6]} wrap>
                        <Tag>{effectiveStartDate} → {effectiveEndDate}</Tag>
                        <Tag>{peopleLabel(attendanceSummary.uniquePeople)}</Tag>
                        <Tag>{attendanceSummary.totalClockIns} clock-in{attendanceSummary.totalClockIns === 1 ? '' : 's'}</Tag>
                        <Tag color="green">{attendanceSummary.centerRate}% center rate</Tag>
                    </Space>

                    {loadingHistory ? (
                        <Skeleton
                            active
                            title={false}
                            paragraph={{ rows: 8, width: '100%' }}
                        />
                    ) : filteredSeries.length ? (
                        <div data-guide="attendance-trends-chart">
                            <HighchartsReact highcharts={Highcharts} options={chartOptions} />
                        </div>
                    ) : (
                        <Empty description="No clock-in records found for the selected filters." />
                    )}
                </Space>
            </Modal>

            <Modal
                className="guide-attendance-attention-modal"
                open={attentionOpen}
                title={`Today's Attention (${metrics.needsAttention})`}
                onCancel={() => setAttentionOpen(false)}
                footer={
                    <Button onClick={() => setAttentionOpen(false)}>
                        Close
                    </Button>
                }
                centered
                width={760}
            >
                <Space direction="vertical" size={18} style={{ width: '100%' }}>
                    <div>
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                            <Text strong>
                                No clock-in today ({notCheckedInToday.length})
                            </Text>

                            {notCheckedInToday.length ? (
                                <Space size={[6, 6]} wrap>
                                    {notCheckedInToday.map(emp => (
                                        <Tag key={emp.authUid || emp.uid || emp.id} color="gold">
                                            {emp.name || emp.email || 'Unnamed employee'}
                                        </Tag>
                                    ))}
                                </Space>
                            ) : (
                                <Text type="secondary">
                                    Everyone in the current attendance scope has clocked in today.
                                </Text>
                            )}
                        </Space>
                    </div>

                    <div>
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Text strong>
                                Flagged attendance ({todayAttentionRows.length})
                            </Text>

                            {todayAttentionRows.length ? (
                                todayAttentionRows.map(row => (
                                    <div
                                        key={row.id || `${row.userId}_${row.checkIn}`}
                                        style={{
                                            border: '1px solid #f0f0f0',
                                            borderRadius: 10,
                                            padding: 12
                                        }}
                                    >
                                        <Row gutter={[12, 8]} align="middle">
                                            <Col xs={24} md={9}>
                                                <Space direction="vertical" size={0}>
                                                    <Text strong>{row.employeeName}</Text>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        {row.department}
                                                    </Text>
                                                </Space>
                                            </Col>

                                            <Col xs={24} md={15}>
                                                <Space size={[4, 4]} wrap>
                                                    {hasPositiveDuration(row.lateBy) ? (
                                                        <Tag color="gold">Late {row.lateBy}</Tag>
                                                    ) : null}
                                                    {row.autoClockedOut ? (
                                                        <Tag color="orange">Auto clock-out</Tag>
                                                    ) : null}
                                                    {row.overtimeApprovalStatus === 'pending' ? (
                                                        <Tag color="purple">Overtime pending</Tag>
                                                    ) : null}
                                                    {row.auditFlag ? (
                                                        <Tag color="red">Needs review</Tag>
                                                    ) : null}
                                                    {isCenterConfigured(centerLocation) &&
                                                        row.centerStatus === 'outside' ? (
                                                        <Tag color="orange">Outside Center</Tag>
                                                    ) : null}
                                                </Space>
                                            </Col>
                                        </Row>
                                    </div>
                                ))
                            ) : (
                                <Text type="secondary">
                                    No recorded attendance issues require review today.
                                </Text>
                            )}
                        </Space>
                    </div>
                </Space>
            </Modal>

            <Modal
                className="guide-attendance-details-modal"
                open={!!selectedAttendanceRow}
                title="Attendance Details"
                onCancel={() => setSelectedAttendanceRow(null)}
                footer={
                    <Button onClick={() => setSelectedAttendanceRow(null)}>
                        Close
                    </Button>
                }
                centered
                width={620}
            >
                {selectedAttendanceRow ? (
                    <Space direction="vertical" size={14} style={{ width: '100%' }}>
                        <div>
                            <Text strong style={{ fontSize: 16 }}>
                                {selectedAttendanceRow.employeeName}
                            </Text>
                            <br />
                            <Text type="secondary">
                                {selectedAttendanceRow.department}
                                {selectedAttendanceRow.position
                                    ? ` • ${selectedAttendanceRow.position}`
                                    : ''}
                            </Text>
                        </div>

                        <Row gutter={[12, 12]}>
                            <Col xs={12}>
                                <Text type="secondary">Date</Text>
                                <div>
                                    <Text strong>
                                        {dayjs(selectedAttendanceRow.date).format('DD MMM YYYY')}
                                    </Text>
                                </div>
                            </Col>
                            <Col xs={12}>
                                <Text type="secondary">Hours</Text>
                                <div>
                                    <Text strong>
                                        {selectedAttendanceRow.hoursWorked &&
                                            selectedAttendanceRow.hoursWorked !== '0h 0m'
                                            ? selectedAttendanceRow.hoursWorked
                                            : selectedAttendanceRow.checkIn
                                                ? diffAsHoursMinutes(
                                                    selectedAttendanceRow.checkIn,
                                                    selectedAttendanceRow.checkOut &&
                                                        selectedAttendanceRow.checkOut !== '-'
                                                        ? selectedAttendanceRow.checkOut
                                                        : undefined
                                                )
                                                : '0h 0m'}
                                    </Text>
                                </div>
                            </Col>
                            <Col xs={12}>
                                <Text type="secondary">Check In</Text>
                                <div><Text strong>{selectedAttendanceRow.checkIn || '—'}</Text></div>
                            </Col>
                            <Col xs={12}>
                                <Text type="secondary">Check Out</Text>
                                <div><Text strong>{selectedAttendanceRow.checkOut || '—'}</Text></div>
                            </Col>
                        </Row>

                        <div data-guide="attendance-detail-location">
                            <Text type="secondary">Location</Text>
                            <div style={{ marginTop: 4 }}>
                                <Space size={[6, 6]} wrap>
                                    <Tag
                                        color={
                                            selectedAttendanceRow.centerStatus === 'at_center'
                                                ? 'green'
                                                : 'orange'
                                        }
                                    >
                                        {selectedAttendanceRow.centerStatus === 'at_center'
                                            ? 'At Center'
                                            : 'Outside Center'}
                                    </Tag>
                                    {getAttendanceLocationText(
                                        selectedAttendanceRow,
                                        centerLocation
                                    ) !== 'At Center' &&
                                        getAttendanceLocationText(
                                            selectedAttendanceRow,
                                            centerLocation
                                        ) !== 'Outside Center' ? (
                                        <Text>
                                            {getAttendanceLocationText(
                                                selectedAttendanceRow,
                                                centerLocation
                                            )}
                                        </Text>
                                    ) : null}
                                </Space>
                            </div>
                        </div>

                        {typeof selectedAttendanceRow.locationAccuracy === 'number' ? (
                            <div>
                                <Text type="secondary">Device location accuracy</Text>
                                <div>
                                    <Tag>
                                        ±{Math.round(selectedAttendanceRow.locationAccuracy)}m
                                    </Tag>
                                </div>
                            </div>
                        ) : null}

                        <div data-guide="attendance-detail-flags">
                            <Text type="secondary">Attendance flags</Text>
                            <div style={{ marginTop: 4 }}>
                                <Space size={[6, 6]} wrap>
                                    {hasPositiveDuration(selectedAttendanceRow.lateBy) ? (
                                        <Tag color="gold">
                                            Late {selectedAttendanceRow.lateBy}
                                        </Tag>
                                    ) : null}
                                    {isMissingCheckout(selectedAttendanceRow) ? (
                                        <Tag color="red">Missing checkout</Tag>
                                    ) : null}
                                    {selectedAttendanceRow.autoClockedOut ? (
                                        <Tag color="orange">Auto clock-out</Tag>
                                    ) : null}
                                    {hasPositiveDuration(selectedAttendanceRow.overtime) ||
                                        selectedAttendanceRow.overtimeApprovalStatus ? (
                                        <Tag color="purple">
                                            {selectedAttendanceRow.overtime || 'Overtime'}
                                        </Tag>
                                    ) : null}
                                    {selectedAttendanceRow.auditFlag ? (
                                        <Tag color="red">Needs review</Tag>
                                    ) : null}
                                    {!hasPositiveDuration(selectedAttendanceRow.lateBy) &&
                                        !isMissingCheckout(selectedAttendanceRow) &&
                                        !selectedAttendanceRow.autoClockedOut &&
                                        !hasPositiveDuration(selectedAttendanceRow.overtime) &&
                                        !selectedAttendanceRow.overtimeApprovalStatus &&
                                        !selectedAttendanceRow.auditFlag ? (
                                        <Tag color="green">No issues recorded</Tag>
                                    ) : null}
                                </Space>
                            </div>
                        </div>

                        {selectedAttendanceRow.autoClockOutReason ? (
                            <Alert
                                type="warning"
                                showIcon
                                message="Auto clock-out reason"
                                description={selectedAttendanceRow.autoClockOutReason}
                            />
                        ) : null}

                        {selectedAttendanceRow.overtimeReason ? (
                            <Alert
                                type="info"
                                showIcon
                                message="Overtime reason"
                                description={selectedAttendanceRow.overtimeReason}
                            />
                        ) : null}

                        {selectedAttendanceRow.auditFlag ? (
                            <Alert
                                type="warning"
                                showIcon
                                message="Audit note"
                                description={selectedAttendanceRow.auditFlag}
                            />
                        ) : null}
                    </Space>
                ) : null}
            </Modal>

            <Modal
                className="guide-overtime-reject-modal"
                open={!!rejectingRow}
                title="Reject overtime request"
                onCancel={() => {
                    setRejectingRow(null)
                    setRejectNote('')
                }}
                onOk={submitRejectOvertime}
                okText="Reject"
                okButtonProps={{
                    danger: true,
                    className: 'guide-overtime-reject-submit'
                }}
                confirmLoading={decidingId === rejectingRow?.id}
                centered
            >
                <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    <Text>
                        Rejecting {rejectingRow?.employeeName}'s overtime request for {rejectingRow?.date ? dayjs(rejectingRow.date).format('DD MMM YYYY') : ''}.
                    </Text>
                    <div>
                        <Text strong>Note (visible in the record)</Text>
                        <Input.TextArea
                            rows={3}
                            value={rejectNote}
                            onChange={e => setRejectNote(e.target.value)}
                            placeholder="Explain why this overtime is not being approved."
                        />
                    </div>
                </Space>
            </Modal>

            <Modal
                className="guide-center-settings-modal"
                open={centerModalOpen}
                title={
                    <Space>
                        <HomeOutlined />
                        <span>Center Settings</span>
                    </Space>
                }
                onCancel={() => setCenterModalOpen(false)}
                onOk={saveCenterLocation}
                okText="Save Center"
                okButtonProps={{ className: 'guide-center-settings-submit' }}
                confirmLoading={savingCenter}
                destroyOnClose={false}
                width={680}
            >
                <Form
                    form={centerForm}
                    layout="vertical"
                    disabled={loadingCenter || savingCenter}
                >
                    <div data-guide="center-location-label">
                        <Form.Item
                            label="Displayed Location Label"
                            name="locationLabel"
                            rules={[{ required: true, message: 'Enter the official address to display.' }]}
                            extra="This is the address staff and reports will see for this center (e.g. its official postal address). It is shown only — it is never used to verify a clock-in."
                        >
                            <Input placeholder="Example: 37 Benoni Street" />
                        </Form.Item>
                    </div>

                    <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="Capture the center GPS while you are physically at the center"
                        description="The GPS point and device accuracy are captured automatically and are not editable. The allowed radius remains configurable because it defines how far from the saved center point a clock-in may still count as being at the center."
                        action={
                            <Button
                                data-guide="capture-center-location"
                                onClick={captureCenterCoordinates}
                            >
                                Capture current location
                            </Button>
                        }
                    />

                    <Form.Item
                        name="latitude"
                        hidden
                        rules={[{ required: true, message: 'Capture the center coordinates.' }]}
                    >
                        <Input />
                    </Form.Item>

                    <Form.Item
                        name="longitude"
                        hidden
                        rules={[{ required: true, message: 'Capture the center coordinates.' }]}
                    >
                        <Input />
                    </Form.Item>

                    <Row gutter={[12, 12]} align="bottom">
                        <Col xs={24} md={16}>
                            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                <Text strong>Center GPS</Text>

                                {typeof centerLatitude === 'number' &&
                                    typeof centerLongitude === 'number' ? (
                                    <Space size={[6, 6]} wrap>
                                        <Tag color="green">GPS point captured</Tag>
                                        {centerCaptureAccuracy !== null ? (
                                            <Tag
                                                color={
                                                    centerCaptureAccuracy <= 30
                                                        ? 'green'
                                                        : centerCaptureAccuracy <= 100
                                                            ? 'gold'
                                                            : 'orange'
                                                }
                                            >
                                                Device accuracy ±{centerCaptureAccuracy}m
                                            </Tag>
                                        ) : (
                                            <Tag>Saved location</Tag>
                                        )}
                                    </Space>
                                ) : (
                                    <Tag color="orange">GPS point not captured</Tag>
                                )}
                            </Space>
                        </Col>

                        <Col xs={24} md={8}>
                            <div data-guide="center-radius">
                                <Form.Item
                                    label="Allowed radius (metres)"
                                    name="radiusMeters"
                                    style={{ marginBottom: 0 }}
                                >
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        min={50}
                                        max={2000}
                                        step={50}
                                    />
                                </Form.Item>
                            </div>
                        </Col>
                    </Row>
                </Form>
            </Modal>
        </div>
    )
}

export default EmployeeAttendanceAnalytics
