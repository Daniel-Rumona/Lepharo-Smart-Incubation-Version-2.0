import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Avatar,
    Button,
    Col,
    DatePicker,
    Drawer,
    Dropdown,
    Empty,
    Form,
    Input,
    InputNumber,
    Modal,
    Progress,
    Row,
    Select,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography,
    message,
    theme
} from 'antd'
import {
    CheckCircleOutlined,
    CloudDownloadOutlined,
    EyeOutlined,
    FileTextOutlined,
    CommentOutlined,
    MoreOutlined,
    TrophyOutlined,
    ReloadOutlined,
    RiseOutlined,
    SettingOutlined,
    TeamOutlined,
    WarningOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import {
    addDoc,
    collection,
    getDocs,
    query,
    serverTimestamp,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid } from '@/components/dashboards/metrics/MetricsGrid'
import { MobileCardList } from '@/components/shared/MobileCardList'
import '@/components/shared/setup-segmented.css'
import { useIsMobile } from '@/hooks/useIsMobile'
import { isStaffRole } from '@/lib/roleLabels'
import { CompactDrawer, type CompactMode } from './CompactDrawer'
import { CompetenciesModal } from './CompetenciesModal'
import { CheckInsDrawer } from './CheckInsDrawer'
import { PepDrawer } from './PepDrawer'
import { CalibrationDrawer, type CalibrationRow } from './CalibrationDrawer'
import { ComplianceDrawer, type ComplianceRow } from './ComplianceDrawer'
import { CyclesModal, cycleStatusTag } from './CyclesModal'
import {
    PHASES,
    annualScore,
    checkInCadence,
    phaseScore,
    reviewStage,
    compactFromLegacy,
    compactStatusMeta,
    cycleForDate,
    defaultCompactContent,
    headlineScore,
    ratingColor as compactRatingColor,
    ratingLabel as compactRatingLabel,
    type CheckIn,
    type CompactContent,
    type EnhancementPlan,
    type ReviewRecord,
    type Competency,
    type ItemRating,
    type PerformanceCycle,
    type PhaseKey,
    type Signoff
} from './ipm'

const { Text } = Typography
const { RangePicker } = DatePicker

type EmployeeRow = {
    id: string
    authUid?: string
    name?: string
    email?: string
    role?: string
    position?: string
    department?: string
    departmentId?: string | null
    branchId?: string | null
    status?: string
    lineManagerId?: string | null
}

type PerformanceReview = {
    id: string
    employeeId: string
    employeeName?: string
    employeeEmail?: string
    department?: string
    score: number
    rating: string
    actionType: string
    actionStatus: string
    notes?: string
    dueDate?: string | null
    createdAt?: any
    createdAtText?: string
    reviewerName?: string
    reviewerRole?: string
}

type LegacyCompact = {
    phase?: string
    ratings?: Record<string, ItemRating>
    overallSelfComment?: string
    overallManagerComment?: string
    createdAtText?: string
}

type PerformanceCompact = CompactContent & {
    id: string
    signoff?: Signoff
    /** The employee's auth uid (employeeId on records that predate it). */
    employeeId: string
    cycleId?: string
    financialYear?: string
    status?: string
    createdAt?: unknown
    /** Saved before cycles existed: a new document per save, rated per default dimension. */
    legacy?: LegacyCompact
}

type TimesheetEntry = {
    id?: string
    userId?: string
    date?: string
    checkIn?: string
    checkOut?: string
    status?: string
    hoursWorked?: string
    lateBy?: string
}

type LeaveRequest = {
    employeeId?: string
    from?: string
    to?: string
    status?: string
}

type AutoPerformance = {
    employeeId: string
    score: number
    rating: string
    attendedDays: number
    expectedDays: number
    approvedLeaveDays: number
    lateDays: number
    completedDays: number
    signals: string[]
}


const ACTION_OPTIONS = [
    { value: 'recognition', label: 'Recognition' },
    { value: 'coaching', label: 'Coaching' },
    { value: 'training', label: 'Training Plan' },
    { value: 'escalation', label: 'Escalate' }
]

// Compact rating bands, best first, with the theme colour used in the rating spread.
const RATING_BANDS = [
    { label: 'Exceptional', colorToken: 'colorSuccess' },
    { label: 'More than Satisfactory', colorToken: 'colorInfo' },
    { label: 'Satisfactory', colorToken: 'colorWarning' },
    { label: 'Unsatisfactory', colorToken: 'colorError' },
    { label: 'Very Unsatisfactory', colorToken: 'colorErrorActive' },
    { label: 'Not Rated', colorToken: 'colorTextQuaternary' }
] as const

function initialsOf(name?: string) {
    const parts = String(name || '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
    return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
}

const STATUS_OPTIONS = [
    { value: 'open', label: 'Open' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'escalated', label: 'Escalated' }
]

function cleanRole(role?: string) {
    return String(role || '').toLowerCase().replace(/\s+/g, '')
}

function displayRole(role?: string) {
    const key = cleanRole(role)
    const labels: Record<string, string> = {
        operations: 'Head Of Department',
        projectmanager: 'Project Manager',
        projectadmin: 'Center Coordinator',
        consultant: 'Consultant',
        receptionist: 'Receptionist',
        auxiliary: 'Auxiliary',
        director: 'Director'
    }
    return labels[key] || role || '-'
}

function ratingFromScore(score: number) {
    if (score >= 85) return 'Excellent'
    if (score >= 70) return 'Good'
    if (score >= 55) return 'Needs Support'
    return 'Critical'
}

function suggestedCompactRatingFromAttendance(score?: number) {
    if (typeof score !== 'number') return undefined
    if (score >= 90) return 5
    if (score >= 75) return 4
    if (score >= 60) return 3
    if (score >= 40) return 2
    return 1
}

function ratingColor(rating?: string) {
    if (rating === 'Excellent') return 'green'
    if (rating === 'Good') return 'blue'
    if (rating === 'Needs Support') return 'gold'
    return 'red'
}

function statusColor(status?: string) {
    if (status === 'completed') return 'green'
    if (status === 'in-progress') return 'blue'
    if (status === 'escalated') return 'red'
    return 'gold'
}

function isControlEmail(email?: string) {
    return String(email || '').toLowerCase().endsWith('@quantilytix.co.za')
}

function toDateText(value: any) {
    if (!value) return ''
    if (typeof value === 'string') return value
    if (value?.toDate) return dayjs(value.toDate()).format('YYYY-MM-DD')
    return ''
}

function parseLateMinutes(value?: string) {
    if (!value) return 0
    const hours = Number(/(\d+)h/.exec(value)?.[1] || 0)
    const minutes = Number(/(\d+)m/.exec(value)?.[1] || 0)
    return hours * 60 + minutes
}

function parseWorkedMinutes(value?: string) {
    if (!value) return 0
    const hours = Number(/(\d+)h/.exec(value)?.[1] || 0)
    const minutes = Number(/(\d+)m/.exec(value)?.[1] || 0)
    return hours * 60 + minutes
}

function businessDaysBetween(start: dayjs.Dayjs, end: dayjs.Dayjs) {
    let cursor = start.startOf('day')
    let count = 0
    while (cursor.isBefore(end, 'day') || cursor.isSame(end, 'day')) {
        const day = cursor.day()
        if (day !== 0 && day !== 6) count += 1
        cursor = cursor.add(1, 'day')
    }
    return count
}

function overlappingBusinessDays(from?: string, to?: string, start?: dayjs.Dayjs, end?: dayjs.Dayjs) {
    if (!from || !to || !start || !end) return 0
    const leaveStart = dayjs(from).isAfter(start) ? dayjs(from) : start
    const leaveEnd = dayjs(to).isBefore(end) ? dayjs(to) : end
    if (!leaveStart.isValid() || !leaveEnd.isValid() || leaveEnd.isBefore(leaveStart)) return 0
    return businessDaysBetween(leaveStart, leaveEnd)
}

function calculateAutoPerformance(
    employee: EmployeeRow,
    timesheets: TimesheetEntry[],
    leaves: LeaveRequest[],
    start: dayjs.Dayjs,
    end: dayjs.Dayjs
): AutoPerformance {
    const expectedDays = businessDaysBetween(start, end)
    const approvedLeaveDays = leaves
        .filter(leave => String(leave.status || '').toLowerCase() === 'approved')
        .reduce(
            (sum, leave) => sum + overlappingBusinessDays(leave.from, leave.to, start, end),
            0
        )

    const adjustedExpectedDays = Math.max(expectedDays - approvedLeaveDays, 0)
    const attendedDates = new Set<string>()
    const lateDates = new Set<string>()
    const completedDates = new Set<string>()

    timesheets.forEach(row => {
        if (!row.date) return
        attendedDates.add(row.date)

        if (parseLateMinutes(row.lateBy) > 0) lateDates.add(row.date)

        if (
            row.checkOut ||
            row.status === 'checked_out' ||
            parseWorkedMinutes(row.hoursWorked) > 0
        ) {
            completedDates.add(row.date)
        }
    })

    const attendedDays = attendedDates.size
    const lateDays = lateDates.size
    const completedDays = completedDates.size

    const attendanceRatio =
        adjustedExpectedDays > 0 ? Math.min(attendedDays / adjustedExpectedDays, 1) : 1
    const punctualityRatio =
        attendedDays > 0 ? Math.max((attendedDays - lateDays) / attendedDays, 0) : 0
    const completionRatio =
        attendedDays > 0 ? Math.min(completedDays / attendedDays, 1) : 0

    const score = Math.round(
        attendanceRatio * 70 +
        punctualityRatio * attendanceRatio * 15 +
        completionRatio * attendanceRatio * 15
    )

    const signals = [
        `${attendedDays}/${adjustedExpectedDays} expected days attended`,
        `${lateDays} late day${lateDays === 1 ? '' : 's'}`,
        `${completedDays} completed checkout${completedDays === 1 ? '' : 's'}`,
        approvedLeaveDays ? `${approvedLeaveDays} approved leave day${approvedLeaveDays === 1 ? '' : 's'} excluded` : ''
    ].filter(Boolean)

    return {
        employeeId: employee.id,
        score,
        rating: ratingFromScore(score),
        attendedDays,
        expectedDays: adjustedExpectedDays,
        approvedLeaveDays,
        lateDays,
        completedDays,
        signals
    }
}

const EMPTY_COMPACT = defaultCompactContent()

const EmployeePerformancePage: React.FC = () => {
    const { user } = useFullIdentity()
    const [form] = Form.useForm()
    const userRole = cleanRole(user?.role)
    const { hasRole, nameOf } = useDepartmentRoles()
    const userDepartmentId = String((user as any)?.departmentId || '').trim()
    const isDirector = userRole === 'director'
    const isHR = userRole === 'hr' || hasRole(userDepartmentId, 'hr')
    const canSeeAll = isDirector || isHR
    const myUid = String(user?.id || '')
    // HR and the CEO see everyone; anyone else sees themselves and the
    // people who report to them (users/{uid}.lineManagerId), as the rules allow.
    const isSelf = (employee: EmployeeRow) => !!myUid && (employee.id === myUid || employee.authUid === myUid)
    // Nobody manages their own compact: their line manager does.
    const canManage = (employee: EmployeeRow) =>
        !isSelf(employee) && (canSeeAll || (!!myUid && employee.lineManagerId === myUid))

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [employees, setEmployees] = useState<EmployeeRow[]>([])
    const [reviews, setReviews] = useState<PerformanceReview[]>([])
    const [compacts, setCompacts] = useState<PerformanceCompact[]>([])
    const [autoPerformance, setAutoPerformance] = useState<Record<string, AutoPerformance>>({})
    const [search, setSearch] = useState('')
    const [departmentFilter, setDepartmentFilter] = useState<string>()
    const [ratingFilter, setRatingFilter] = useState<string>()
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
    const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null)
    const [actionOpen, setActionOpen] = useState(false)
    const [compactEmployee, setCompactEmployee] = useState<EmployeeRow | null>(null)
    const [cycles, setCycles] = useState<PerformanceCycle[]>([])
    const [selectedCycleId, setSelectedCycleId] = useState<string>()
    const [cyclesOpen, setCyclesOpen] = useState(false)
    const [reviewRecords, setReviewRecords] = useState<ReviewRecord[]>([])
    const [calibrationOpen, setCalibrationOpen] = useState(false)
    const [complianceOpen, setComplianceOpen] = useState(false)
    const [branchNames, setBranchNames] = useState<Map<string, string>>(new Map())
    const [userNames, setUserNames] = useState<Map<string, string>>(new Map())
    const [compactMode, setCompactMode] = useState<CompactMode>('manage')
    const [competencies, setCompetencies] = useState<Competency[]>([])
    const [competenciesOpen, setCompetenciesOpen] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [focus, setFocus] = useState<'all' | 'attention' | 'unrated' | 'checkInDue'>('all')
    const [checkIns, setCheckIns] = useState<CheckIn[]>([])
    const [plans, setPlans] = useState<EnhancementPlan[]>([])
    const [checkInsRow, setCheckInsRow] = useState<any | null>(null)
    const [pepRow, setPepRow] = useState<any | null>(null)
    const [sessionMode, setSessionMode] = useState<CompactMode>('manage')
    const { token } = theme.useToken()
    const isMobile = useIsMobile()

    const loadAutomaticPerformance = async (staff: EmployeeRow[]) => {
        if (staff.length === 0) {
            setAutoPerformance({})
            return
        }

        const end = dayjs().endOf('day')
        const start = dayjs().subtract(29, 'day').startOf('day')
        const startKey = start.format('YYYY-MM-DD')
        const endKey = end.format('YYYY-MM-DD')
        const staffKeys = new Map<string, EmployeeRow>()

        staff.forEach(emp => {
            staffKeys.set(emp.id, emp)
            if (emp.authUid) staffKeys.set(emp.authUid, emp)
        })

        let timesheets: TimesheetEntry[] = []
        let leaves: LeaveRequest[] = []

        try {
            const [timesheetSnap, leaveSnap] = await Promise.all([
                getDocs(
                    query(
                        collection(db, 'timesheets'),

                        where('date', '>=', startKey),
                        where('date', '<=', endKey)
                    )
                ),
                getDocs(
                    query(
                        collection(db, 'leaveRequests'),

                    )
                )
            ])

            timesheets = timesheetSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
            leaves = leaveSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
        } catch (error) {
            console.warn('[EmployeePerformance] company signal query failed, using scoped fallback.', error)

            const employeeTimesheets = await Promise.all(
                staff.map(async emp => {
                    const ids = [emp.id, emp.authUid].filter(Boolean) as string[]
                    const rows = await Promise.all(
                        ids.map(async id => {
                            const snap = await getDocs(
                                query(
                                    collection(db, 'timesheets'),
                                    where('userId', '==', id),
                                    where('date', '>=', startKey),
                                    where('date', '<=', endKey)
                                )
                            )
                            return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                        })
                    )
                    return rows.flat()
                })
            )

            const leaveSnap = await getDocs(
                query(collection(db, 'leaveRequests'))
            )

            timesheets = employeeTimesheets.flat()
            leaves = leaveSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
        }

        const groupedTimesheets = new Map<string, TimesheetEntry[]>()
        const groupedLeaves = new Map<string, LeaveRequest[]>()

        timesheets.forEach(row => {
            const emp = staffKeys.get(String(row.userId || ''))
            if (!emp) return
            const current = groupedTimesheets.get(emp.id) || []
            current.push(row)
            groupedTimesheets.set(emp.id, current)
        })

        leaves.forEach(leave => {
            const emp = staffKeys.get(String(leave.employeeId || ''))
            if (!emp) return
            const current = groupedLeaves.get(emp.id) || []
            current.push(leave)
            groupedLeaves.set(emp.id, current)
        })

        const next: Record<string, AutoPerformance> = {}
        staff.forEach(emp => {
            next[emp.id] = calculateAutoPerformance(
                emp,
                groupedTimesheets.get(emp.id) || [],
                groupedLeaves.get(emp.id) || [],
                start,
                end
            )
        })

        setAutoPerformance(next)
    }

    const loadPerformanceDocs = async (name: string) => {
        if (canSeeAll) return (await getDocs(collection(db, name))).docs
        if (!myUid) return []
        const [mine, team] = await Promise.all([
            getDocs(query(collection(db, name), where('employeeAuthUid', '==', myUid))),
            getDocs(query(collection(db, name), where('lineManagerId', '==', myUid)))
        ])
        return [...new Map([...mine.docs, ...team.docs].map(d => [d.id, d])).values()]
    }

    const loadData = async () => {
        setLoading(true)
        try {
            const [usersSnap, reviewDocs, compactDocs, cycleSnap, competencySnap, checkInDocs, planDocs, reviewRecordDocs, branchSnap] = await Promise.all([
                getDocs(collection(db, 'users')),
                loadPerformanceDocs('employeePerformanceReviews'),
                loadPerformanceDocs('employeePerformanceCompacts'),
                getDocs(collection(db, 'performanceCycles')),
                getDocs(collection(db, 'ipmCompetencies')),
                loadPerformanceDocs('performanceCheckIns'),
                loadPerformanceDocs('performanceEnhancementPlans'),
                loadPerformanceDocs('performanceReviews'),
                // Centres are stored as branches; their names label the score roll-up.
                canSeeAll ? getDocs(collection(db, 'branches')) : Promise.resolve(null)
            ])

            const staff = usersSnap.docs
                .map(d => {
                    const data: any = d.data()
                    return {
                        id: d.id,
                        authUid: data.uid || data.authUid || data.userId || d.id,
                        name: data.name || data.fullName || data.email?.split('@')[0],
                        email: data.email,
                        role: data.role,
                        position: data.position || data.jobTitle,
                        department: data.department || data.departmentName,
                        departmentId: data.departmentId || null,
                        branchId: data.assignedBranch || data.branchId || null,
                        status: data.status || 'Active',
                        lineManagerId: data.lineManagerId || null
                    } as EmployeeRow
                })
                .filter(emp => isStaffRole(emp.role))
                .filter(emp => !isControlEmail(emp.email))
                .filter(emp => canSeeAll || emp.id === myUid || emp.lineManagerId === myUid)

            const reviewRows = reviewDocs
                .map(d => {
                    const data: any = d.data()
                    const score = Number(data.score || 0)
                    return {
                        id: d.id,
                        employeeId: String(data.employeeId || ''),
                        employeeName: data.employeeName,
                        employeeEmail: data.employeeEmail,
                        department: data.department,
                        score,
                        rating: data.rating || ratingFromScore(score),
                        actionType: data.actionType || 'coaching',
                        actionStatus: data.actionStatus || 'open',
                        notes: data.notes,
                        dueDate: data.dueDate || null,
                        createdAt: data.createdAt,
                        createdAtText: data.createdAtText || toDateText(data.createdAt),
                        reviewerName: data.reviewerName,
                        reviewerRole: data.reviewerRole
                    } as PerformanceReview
                })
                .filter(r => staff.some(emp => emp.id === r.employeeId || emp.authUid === r.employeeId))
                .sort((a, b) => (b.createdAtText || '').localeCompare(a.createdAtText || ''))

            const compactRows = compactDocs
                .map(d => {
                    const data: any = d.data()
                    const createdAtText = data.createdAtText || toDateText(data.createdAt)
                    return {
                        id: d.id,
                        employeeId: String(data.employeeAuthUid || data.employeeId || ''),
                        cycleId: data.cycleId,
                        financialYear: data.financialYear || 'FY2026/27',
                        status: data.status || 'draft',
                        sectionWeights: data.sectionWeights,
                        items: data.items || [],
                        reviews: data.reviews || {},
                        pdp: data.pdp || [],
                        signoff: data.signoff || {},
                        createdAt: data.createdAt,
                        legacy: data.cycleId
                            ? undefined
                            : {
                                  phase: data.phase,
                                  ratings: data.ratings,
                                  overallSelfComment: data.overallSelfComment,
                                  overallManagerComment: data.overallManagerComment,
                                  createdAtText
                              }
                    } as PerformanceCompact
                })
                .filter(r => staff.some(emp => emp.id === r.employeeId || emp.authUid === r.employeeId))

            const cycleRows = cycleSnap.docs
                .map(d => ({ ...(d.data() as PerformanceCycle), id: d.id }))
                .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))
            const currentCycleId = cycleForDate(new Date()).id

            setEmployees(staff)
            // Every user, not only the staff listed: a line manager can sit outside the list.
            setUserNames(
                new Map(
                    usersSnap.docs.flatMap(d => {
                        const data: any = d.data()
                        const name = String(data.name || data.fullName || data.email || d.id)
                        const authUid = data.uid || data.authUid || data.userId
                        return [[d.id, name], ...(authUid ? [[String(authUid), name]] : [])] as [string, string][]
                    })
                )
            )
            setBranchNames(new Map((branchSnap?.docs || []).map(d => [d.id, String(d.get('name') || d.id)])))
            setReviews(reviewRows)
            setCompacts(compactRows)
            setCycles(cycleRows)
            setCheckIns(checkInDocs.map(d => ({ ...(d.data() as CheckIn), id: d.id })))
            setPlans(planDocs.map(d => ({ ...(d.data() as EnhancementPlan), id: d.id })))
            setReviewRecords(reviewRecordDocs.map(d => ({ ...(d.data() as ReviewRecord), id: d.id })))
            setCompetencies(
                competencySnap.docs
                    .map(d => ({ ...(d.data() as Competency), id: d.id }))
                    .filter(c => c.active !== false)
                    .sort((a, b) => a.cluster.localeCompare(b.cluster) || a.name.localeCompare(b.name))
            )
            setSelectedCycleId(current =>
                current && cycleRows.some(c => c.id === current)
                    ? current
                    : (cycleRows.find(c => c.id === currentCycleId) || cycleRows[0])?.id
            )
            // Attendance is supporting evidence only; a failed lookup must not hide the page.
            await loadAutomaticPerformance(staff).catch(error => {
                console.warn('[EmployeePerformance] attendance evidence unavailable.', error)
                setAutoPerformance({})
            })
        } catch (error) {
            console.error(error)
            message.error('Failed to load employee performance.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadData()
    }, [user?.id, userRole, userDepartmentId, isHR])

    const latestReviewByEmployee = useMemo(() => {
        const map = new Map<string, PerformanceReview>()
        reviews.forEach(review => {
            if (!map.has(review.employeeId)) {
                map.set(review.employeeId, review)
            }
        })
        return map
    }, [reviews])

    const selectedCycle = useMemo(() => cycles.find(c => c.id === selectedCycleId) || null, [cycles, selectedCycleId])

    // This cycle's compact per employee, plus pre-cycle records saved under the
    // same financial year label, which seed the compact until it is saved.
    const cycleCompacts = useMemo(() => {
        const current = new Map<string, PerformanceCompact>()
        const legacy = new Map<string, PerformanceCompact[]>()
        if (!selectedCycle) return { current, legacy }
        compacts.forEach(compact => {
            if (compact.cycleId === selectedCycle.id) current.set(compact.employeeId, compact)
            else if (compact.legacy && compact.financialYear === selectedCycle.label) {
                legacy.set(compact.employeeId, [...(legacy.get(compact.employeeId) || []), compact])
            }
        })
        return { current, legacy }
    }, [compacts, selectedCycle])

    const compactFor = (emp: EmployeeRow) =>
        (emp.authUid && cycleCompacts.current.get(emp.authUid)) || cycleCompacts.current.get(emp.id)
    const legacyFor = (emp: EmployeeRow) =>
        (emp.authUid && cycleCompacts.legacy.get(emp.authUid)) || cycleCompacts.legacy.get(emp.id) || []

    const departments = useMemo(
        () =>
            [...new Set(employees.map(emp => emp.departmentId).filter(Boolean).map(String))]
                .map(id => ({ value: id, label: nameOf(id) }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [employees, nameOf]
    )

    const checkInsByEmployee = useMemo(() => {
        const map = new Map<string, CheckIn[]>()
        checkIns.forEach(c => map.set(c.employeeAuthUid, [...(map.get(c.employeeAuthUid) || []), c]))
        return map
    }, [checkIns])

    const plansByEmployee = useMemo(() => {
        const map = new Map<string, EnhancementPlan[]>()
        plans.forEach(p => map.set(p.employeeAuthUid, [...(map.get(p.employeeAuthUid) || []), p]))
        return map
    }, [plans])

    const reviewsByEmployee = useMemo(() => {
        const map = new Map<string, Partial<Record<PhaseKey, ReviewRecord>>>()
        if (!selectedCycle) return map
        reviewRecords
            .filter(r => r.cycleId === selectedCycle.id)
            .forEach(r => map.set(r.employeeAuthUid, { ...(map.get(r.employeeAuthUid) || {}), [r.phase]: r }))
        return map
    }, [reviewRecords, selectedCycle])

    const rows = useMemo(() => {
        const today = dayjs().format('YYYY-MM-DD')
        let next = employees.map(emp => {
            const review =
                latestReviewByEmployee.get(emp.id) ||
                (emp.authUid ? latestReviewByEmployee.get(emp.authUid) : undefined)
            const automatic = autoPerformance[emp.id]
            const compact = compactFor(emp)
            const legacy = compact ? [] : legacyFor(emp)
            const records = reviewsByEmployee.get(emp.authUid || emp.id) || {}
            const midYear = compact ? phaseScore(compact.reviews.midYear?.score, records.midYear) : null
            const yearEnd = compact ? phaseScore(compact.reviews.yearEnd?.score, records.yearEnd) : null
            const headline = compact
                ? { score: annualScore(midYear, yearEnd), phase: (yearEnd !== null ? 'yearEnd' : midYear !== null ? 'midYear' : null) as PhaseKey | null }
                : headlineScore(compactFromLegacy(legacy.map(entry => entry.legacy as LegacyCompact)).reviews)
            // The review in progress: the year-end once it has started, else the mid-year.
            const activeReview = records.yearEnd || records.midYear || null
            const suggestedRating = suggestedCompactRatingFromAttendance(automatic?.score)
            // Attendance only suggests a rating while no compact exists for this cycle.
            const effectiveScore = headline.score ?? (compact ? undefined : suggestedRating)
            const effectiveRating = compactRatingLabel(effectiveScore)
            const ratingSource =
                headline.score !== null ? (compact ? 'compact' : 'legacy') : !compact && suggestedRating ? 'attendance' : null
            return {
                ...emp,
                latestReview: review,
                compact,
                compactStatus: compact?.status,
                ratingPhase: headline.phase as PhaseKey | null,
                annual: compact ? midYear !== null && yearEnd !== null : false,
                calibrated: !!(records.midYear?.calibration || records.yearEnd?.calibration),
                activeReview,
                ratingSource,
                cadence: checkInCadence((checkInsByEmployee.get(emp.authUid || emp.id) || []).map(c => c.date), today),
                activePlan: (plansByEmployee.get(emp.authUid || emp.id) || []).find(p => p.status === 'active') || null,
                hasPlans: (plansByEmployee.get(emp.authUid || emp.id) || []).length > 0,
                automatic,
                latestScore: review?.score,
                systemScore: automatic?.score,
                effectiveScore,
                latestRating: effectiveRating,
                actionStatus: review?.actionStatus || 'none',
                dueDate: review?.dueDate
            }
        })

        if (search) {
            const needle = search.toLowerCase()
            next = next.filter(
                row =>
                    String(row.name || '').toLowerCase().includes(needle) ||
                    String(row.email || '').toLowerCase().includes(needle) ||
                    String(row.position || '').toLowerCase().includes(needle) ||
                    String(row.department || '').toLowerCase().includes(needle)
            )
        }

        if (departmentFilter) {
            next = next.filter(row => row.departmentId === departmentFilter)
        }

        if (ratingFilter) {
            next = next.filter(row => row.latestRating === ratingFilter)
        }

        if (dateRange) {
            const [start, end] = dateRange
            next = next.filter(row => {
                const created = row.latestReview?.createdAtText
                if (!created) return false
                const d = dayjs(created)
                return d.isSame(start, 'day') || d.isSame(end, 'day') || (d.isAfter(start) && d.isBefore(end))
            })
        }

        return next
    }, [employees, latestReviewByEmployee, cycleCompacts, reviewsByEmployee, checkInsByEmployee, plansByEmployee, autoPerformance, search, departmentFilter, ratingFilter, dateRange])

    const metrics = useMemo(() => {
        const scored = rows.filter(row => typeof row.effectiveScore === 'number')
        const average = scored.length
            ? Number((scored.reduce((sum, row) => sum + Number(row.effectiveScore || 0), 0) / scored.length).toFixed(2))
            : 0
        const openActions = rows.filter(row => ['open', 'in-progress', 'escalated'].includes(row.actionStatus)).length
        const critical = rows.filter(row => Number(row.effectiveScore || 0) > 0 && Number(row.effectiveScore || 0) < 2.5).length
        const checkInsDue = rows.filter(row => row.cadence.due).length
        return {
            checkInsDue,
            total: rows.length,
            reviewed: scored.length,
            average,
            openActions,
            critical
        }
    }, [rows])

    const selectedHistory = useMemo(() => {
        if (!selectedEmployee) return []
        return reviews.filter(
            review =>
                review.employeeId === selectedEmployee.id ||
                review.employeeId === selectedEmployee.authUid
        )
    }, [reviews, selectedEmployee])

    const openAction = (employee: EmployeeRow) => {
        const latest =
            latestReviewByEmployee.get(employee.id) ||
            (employee.authUid ? latestReviewByEmployee.get(employee.authUid) : undefined)
        setSelectedEmployee(employee)
        form.resetFields()
        form.setFieldsValue({
            score: latest?.score ?? autoPerformance[employee.id]?.score ?? 70,
            actionType: latest?.actionType || 'coaching',
            actionStatus: latest?.actionStatus || 'open',
            dueDate: latest?.dueDate ? dayjs(latest.dueDate) : dayjs().add(14, 'day'),
            notes: ''
        })
        setActionOpen(true)
    }

    const openCompact = (employee: EmployeeRow, mode: CompactMode = 'manage') => {
        if (!selectedCycle) {
            message.info(canSeeAll ? 'Open a performance cycle first.' : 'HR has not opened a performance cycle yet.')
            return
        }
        setCompactMode(mode)
        setCompactEmployee(employee)
    }

    // What the drawer starts from: this cycle's compact, else the employee's
    // pre-cycle ratings for the same year, else the default template.
    const compactInitial = useMemo(() => {
        if (!compactEmployee) return null
        const existing = compactFor(compactEmployee)
        if (existing?.sectionWeights) {
            return {
                content: { sectionWeights: existing.sectionWeights, items: existing.items, reviews: existing.reviews, pdp: existing.pdp },
                signoff: existing.signoff || {},
                exists: true,
                createdAt: existing.createdAt,
                legacy: false
            }
        }
        const legacy = legacyFor(compactEmployee)
        if (legacy.length) {
            return {
                content: compactFromLegacy(legacy.map(entry => entry.legacy as LegacyCompact)),
                signoff: {},
                exists: false,
                createdAt: undefined,
                legacy: true
            }
        }
        return { content: defaultCompactContent(), signoff: {}, exists: false, createdAt: undefined, legacy: false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [compactEmployee, cycleCompacts])

    const saveAction = async (values: any) => {
        if (!selectedEmployee) return

        const score = Number(values.score || 0)
        const automatic = autoPerformance[selectedEmployee.id]
        setSaving(true)
        try {
            await addDoc(collection(db, 'employeePerformanceReviews'), {
                employeeId: selectedEmployee.id,
                employeeAuthUid: selectedEmployee.authUid || selectedEmployee.id,
                lineManagerId: selectedEmployee.lineManagerId || null,
                employeeName: selectedEmployee.name || '',
                employeeEmail: selectedEmployee.email || '',
                department: selectedEmployee.department || null,
                position: selectedEmployee.position || null,
                score,
                rating: ratingFromScore(score),
                systemScore: automatic?.score ?? null,
                systemRating: automatic?.rating ?? null,
                systemSignals: automatic?.signals || [],
                systemWindowDays: 30,
                actionType: values.actionType,
                actionStatus: values.actionStatus,
                dueDate: values.dueDate?.format ? values.dueDate.format('YYYY-MM-DD') : null,
                notes: values.notes || '',
                reviewerId: String(user?.id || ''),
                reviewerName: user?.name || user?.email || '',
                reviewerRole: user?.role || '',
                createdAt: serverTimestamp(),
                createdAtText: dayjs().format('YYYY-MM-DD')
            })

            message.success('Performance action saved.')
            setActionOpen(false)
            setSelectedEmployee(null)
            await loadData()
        } catch (error) {
            console.error(error)
            message.error('Could not save performance action.')
        } finally {
            setSaving(false)
        }
    }

    const exportCsv = () => {
        const header = ['Employee,Email,Department,Position,System Score,Rating,Action Status,Due Date']
        const lines = rows.map(row =>
            [
                `"${row.name || ''}"`,
                row.email || '',
                `"${row.department || ''}"`,
                `"${row.position || ''}"`,
                row.effectiveScore ?? '',
                row.latestRating || '',
                row.actionStatus || '',
                row.dueDate || ''
            ].join(',')
        )

        const blob = new Blob([header.concat(lines).join('\n')], {
            type: 'text/csv;charset=utf-8;'
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `employee-performance-${dayjs().format('YYYYMMDD')}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }


    const nameById = useMemo(
        () =>
            new Map([
                ...userNames,
                ...(employees.flatMap(emp => [[emp.id, emp.name || emp.email || ''], ...(emp.authUid ? [[emp.authUid, emp.name || emp.email || '']] : [])]) as [string, string][])
            ]),
        [employees, userNames]
    )

    const ratingBands = useMemo(
        () =>
            RATING_BANDS.map(band => ({
                ...band,
                count: rows.filter(row => row.latestRating === band.label).length
            })),
        [rows]
    )

    const visibleRows = useMemo(() => {
        if (focus === 'attention') return rows.filter(row => Number(row.effectiveScore || 0) > 0 && Number(row.effectiveScore) < 2.5)
        if (focus === 'unrated') return rows.filter(row => typeof row.effectiveScore !== 'number')
        if (focus === 'checkInDue') return rows.filter(row => row.cadence.due)
        return rows
    }, [rows, focus])

    const toggleFocus = (next: typeof focus) => setFocus(current => (current === next ? 'all' : next))
    const focusStyle = (key: typeof focus): React.CSSProperties =>
        focus === key && key !== 'all' ? { outline: `2px solid ${token.colorPrimary}`, borderRadius: 16 } : {}

    const calibrationRows: CalibrationRow[] = employees
        .filter(emp => !isSelf(emp) && compactFor(emp))
        .map(emp => {
            const compact = compactFor(emp)!
            return {
                key: emp.id,
                employeeUid: emp.authUid || emp.id,
                name: emp.name || emp.email || emp.id,
                department: emp.department,
                departmentId: emp.departmentId,
                lineManagerName: emp.lineManagerId ? nameById.get(emp.lineManagerId) : undefined,
                scores: { midYear: compact.reviews.midYear?.score ?? null, yearEnd: compact.reviews.yearEnd?.score ?? null },
                records: reviewsByEmployee.get(emp.authUid || emp.id) || {}
            }
        })

    // Everyone in the IPM process this cycle; the CEO's own performance is agreed with the board.
    const complianceRows: ComplianceRow[] = employees
        .filter(emp => cleanRole(emp.role) !== 'director')
        .map(emp => {
            const uid = emp.authUid || emp.id
            const compact = compactFor(emp)
            const records = reviewsByEmployee.get(uid) || {}
            const midYear = compact ? phaseScore(compact.reviews.midYear?.score, records.midYear) : null
            const yearEnd = compact ? phaseScore(compact.reviews.yearEnd?.score, records.yearEnd) : null
            return {
                key: emp.id,
                name: emp.name || emp.email || emp.id,
                department: emp.department,
                departmentId: emp.departmentId,
                branchId: emp.branchId,
                branchName: emp.branchId ? branchNames.get(emp.branchId) : undefined,
                lineManagerName: emp.lineManagerId ? nameById.get(emp.lineManagerId) : undefined,
                score: annualScore(midYear, yearEnd),
                state: {
                    uid,
                    lineManagerId: emp.lineManagerId,
                    compact: compact ? { signoff: compact.signoff } : null,
                    checkInDates: (checkInsByEmployee.get(uid) || []).map(c => c.date),
                    reviews: records
                }
            }
        })

    const emptyText = canSeeAll
        ? 'No employees match these filters.'
        : 'Nobody reports to you yet. HR sets line managers on the Employees page.'

    const roleLine = (row: any) =>
        [row.position, displayRole(row.role)]
            .filter(v => v && v !== '-')
            .filter((v, i, all) => all.findIndex(other => other.toLowerCase() === v.toLowerCase()) === i)
            .join(' · ')

    const ratingSourceText = (row: any) =>
        row.ratingSource === 'attendance'
            ? 'Suggested from attendance'
            : [
                  row.annual ? 'Annual (mid-year and year-end)' : PHASES.find(p => p.key === row.ratingPhase)?.label,
                  row.calibrated ? 'calibrated' : '',
                  row.ratingSource === 'legacy' ? 'earlier record' : '',
                  row.compact ? compactStatusMeta(row.compactStatus).label : ''
              ]
                  .filter(Boolean)
                  .join(' · ')

    const lineManagerCell = (row: any) => {
        if (!row.lineManagerId) return <Text type='secondary'>Not set</Text>
        if (row.lineManagerId === myUid) return <Text>You</Text>
        return nameById.get(row.lineManagerId) || <Text type='secondary'>Unknown</Text>
    }

    const followUpCell = (row: any) =>
        row.actionStatus === 'none' ? (
            <Text type='secondary'>—</Text>
        ) : (
            <Space direction='vertical' size={0}>
                <Tag color={statusColor(row.actionStatus)} style={{ borderRadius: 999, margin: 0 }}>
                    {STATUS_OPTIONS.find(option => option.value === row.actionStatus)?.label || row.actionStatus}
                </Tag>
                {row.dueDate ? <Text type='secondary' style={{ fontSize: 12 }}>Due {row.dueDate}</Text> : null}
            </Space>
        )

    const cadenceText = (row: any) =>
        row.cadence.lastDate
            ? row.cadence.daysSince === 0
                ? 'Checked in today'
                : `Checked in ${row.cadence.daysSince}d ago`
            : 'No check-ins yet'

    const progressCell = (row: any) => (
        <Space direction='vertical' size={4}>
            <Space size={6} wrap>
                <Tag color={row.cadence.due ? 'red' : 'green'} style={{ borderRadius: 999, margin: 0 }}>
                    {row.cadence.due ? 'Check-in due' : 'Up to date'}
                </Tag>
                {row.activePlan ? (
                    <Tag color='volcano' style={{ borderRadius: 999, margin: 0 }}>
                        Enhancement plan
                    </Tag>
                ) : null}
            </Space>
            <Text type='secondary' style={{ fontSize: 12 }}>{cadenceText(row)}</Text>
            {row.activeReview ? (
                <Tag
                    color={{ disputed: 'red', validated: 'green', calibration: 'blue', validation: 'blue' }[reviewStage(row.activeReview) as string] || 'default'}
                    style={{ borderRadius: 999, margin: 0, width: 'fit-content' }}
                >
                    {PHASES.find(p => p.key === row.activeReview.phase)?.label}:{' '}
                    {{
                        self: 'self-assessment',
                        manager: 'manager assessing',
                        discussion: 'to discuss and sign',
                        disputed: 'disputed',
                        calibration: 'to calibrate',
                        validation: 'awaiting CEO',
                        validated: 'validated'
                    }[reviewStage(row.activeReview)]}
                </Tag>
            ) : null}
            {row.actionStatus !== 'none' ? followUpCell(row) : null}
        </Space>
    )

    const openCheckIns = (row: any, mode: CompactMode) => {
        setSessionMode(mode)
        setCheckInsRow(row)
    }

    const openPlan = (row: any, mode: CompactMode) => {
        setSessionMode(mode)
        setPepRow(row)
    }

    const showHistoryFor = (row: EmployeeRow) => {
        setSelectedEmployee(row)
        setHistoryOpen(true)
    }

    // Phone card buttons share the card's width, so they carry short labels.
    const cardActions = (row: EmployeeRow): React.ReactNode[] => {
        const history = (
            <Button key='history' icon={<EyeOutlined />} onClick={() => showHistoryFor(row)}>
                History
            </Button>
        )
        const more = (items: { key: string; label: string; icon: React.ReactNode; onClick: () => void }[]) => (
            <Dropdown key='more' trigger={['click']} menu={{ items }}>
                <Button icon={<MoreOutlined />}>More</Button>
            </Dropdown>
        )
        const historyItem = { key: 'history', icon: <EyeOutlined />, label: 'History', onClick: () => showHistoryFor(row) }
        if (isSelf(row)) {
            const anyRow = row as any
            return [
                <Button key='compact' type='primary' icon={<FileTextOutlined />} disabled={!compactFor(row)} onClick={() => openCompact(row, 'self')}>
                    My compact
                </Button>,
                <Button key='checkins' icon={<CommentOutlined />} onClick={() => openCheckIns(row, 'self')}>
                    Check-ins
                </Button>,
                more([
                    ...(anyRow.hasPlans ? [{ key: 'plan', icon: <WarningOutlined />, label: 'My enhancement plan', onClick: () => openPlan(row, 'self') }] : []),
                    historyItem
                ])
            ]
        }
        if (!canManage(row)) return [history]
        return [
            <Button key='compact' type='primary' icon={<FileTextOutlined />} onClick={() => openCompact(row)}>
                Compact
            </Button>,
            <Button key='checkins' icon={<CommentOutlined />} onClick={() => openCheckIns(row, 'manage')}>
                Check-ins
            </Button>,
            more([
                { key: 'plan', icon: <WarningOutlined />, label: 'Enhancement plan', onClick: () => openPlan(row, 'manage') },
                { key: 'action', icon: <TrophyOutlined />, label: 'Take action', onClick: () => openAction(row) },
                historyItem
            ])
        ]
    }

    return (
        <div style={{ padding: isMobile ? '5px 12px 16px' : 24, minHeight: '100vh' }}>
            <MetricsGrid
                metrics={[
                    {
                        key: 'employees',
                        important: true,
                        loading,
                        icon: <TeamOutlined />,
                        tone: 'accent',
                        title: canSeeAll ? 'Employees' : 'My Team',
                        value: metrics.total,
                        subtitle: canSeeAll ? 'All staff in IPM' : 'You and your direct reports',
                        mobileSubtitle: canSeeAll ? 'All staff' : 'You and your team',
                        onClick: () => setFocus('all')
                    },
                    {
                        key: 'rated',
                        loading,
                        icon: <CheckCircleOutlined />,
                        tone: 'success',
                        title: 'Rated',
                        value: `${metrics.reviewed}/${metrics.total}`,
                        subtitle: `${metrics.total - metrics.reviewed} not rated yet`,
                        onClick: () => toggleFocus('unrated'),
                        wrapperStyle: focusStyle('unrated')
                    },
                    {
                        key: 'average',
                        loading,
                        icon: <RiseOutlined />,
                        tone: 'info',
                        title: 'Average Rating',
                        value: metrics.average ? `${metrics.average}/5` : '—',
                        subtitle: metrics.average ? compactRatingLabel(metrics.average) : 'No ratings yet'
                    },
                    {
                        key: 'attention',
                        important: true,
                        loading,
                        icon: <WarningOutlined />,
                        tone: 'danger',
                        title: 'Needs Attention',
                        mobileTitle: 'Attention',
                        value: metrics.critical,
                        subtitle: 'Rated below 2.5',
                        mobileSubtitle: 'Below 2.5',
                        onClick: () => toggleFocus('attention'),
                        wrapperStyle: focusStyle('attention')
                    },
                    {
                        key: 'checkInDue',
                        loading,
                        icon: <CommentOutlined />,
                        tone: 'warning',
                        title: 'Check-ins Due',
                        value: metrics.checkInsDue,
                        subtitle: 'None in the last 14 days',
                        onClick: () => toggleFocus('checkInDue'),
                        wrapperStyle: focusStyle('checkInDue')
                    }
                ]}
            />

            <MotionCard
                style={{ marginTop: 16 }}
                loading={loading}
                skeleton={isMobile ? 'list' : 'table'}
                skeletonRows={8}
                skeletonColumns={6}
                filterBar={
                    <div className='setup-toolbar'>
                        <div className='setup-toolbar-filter'>
                            <Select
                                placeholder='Cycle'
                                value={selectedCycleId}
                                onChange={setSelectedCycleId}
                                style={{ width: '100%' }}
                                options={cycles.map(c => ({ value: c.id, label: c.label }))}
                                notFoundContent='No cycle opened'
                            />
                        </div>
                        <div className='setup-toolbar-search'>
                            <Input.Search
                                allowClear
                                placeholder='Search name, email, position, department'
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <div className='setup-toolbar-filter'>
                            <Select
                                allowClear
                                placeholder='Department'
                                value={departmentFilter}
                                onChange={setDepartmentFilter}
                                style={{ width: '100%' }}
                                options={departments}
                            />
                        </div>
                        <div className='setup-toolbar-filter'>
                            <Select
                                allowClear
                                placeholder='Rating'
                                value={ratingFilter}
                                onChange={setRatingFilter}
                                style={{ width: '100%' }}
                                options={RATING_BANDS.map(band => ({ value: band.label, label: band.label }))}
                            />
                        </div>
                        <div className='setup-toolbar-search' style={{ flex: '1 1 240px' }}>
                            <RangePicker
                                value={dateRange as any}
                                onChange={value => setDateRange(value as any)}
                                placeholder={['Reviewed from', 'to']}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className='setup-toolbar-action'>
                            <Space wrap>
                                {isMobile ? null : (
                                    <Tag color={canSeeAll ? 'blue' : 'purple'} style={{ borderRadius: 999, margin: 0 }}>
                                        {canSeeAll ? 'All employees' : 'My team'}
                                    </Tag>
                                )}
                                <Tooltip title='Export CSV'>
                                    <Button shape={isMobile ? 'default' : 'circle'} icon={<CloudDownloadOutlined />} onClick={exportCsv} aria-label='Export CSV' />
                                </Tooltip>
                                <Tooltip title='Refresh'>
                                    <Button shape={isMobile ? 'default' : 'circle'} icon={<ReloadOutlined />} onClick={loadData} aria-label='Refresh' />
                                </Tooltip>
                                {canSeeAll ? (
                                    <Tooltip title='Cycles and competencies'>
                                        <Dropdown
                                            trigger={['click']}
                                            menu={{
                                                items: [
                                                    { key: 'cycles', label: 'Performance cycles' },
                                                    { key: 'competencies', label: `Competency library (${competencies.length})` },
                                                    { key: 'calibration', label: 'Calibration' },
                                                    { key: 'compliance', label: 'IPM compliance' }
                                                ],
                                                onClick: ({ key }) =>
                                                    key === 'cycles'
                                                        ? setCyclesOpen(true)
                                                        : key === 'calibration'
                                                          ? setCalibrationOpen(true)
                                                          : key === 'compliance'
                                                            ? setComplianceOpen(true)
                                                            : setCompetenciesOpen(true)
                                            }}
                                        >
                                            <Button shape={isMobile ? 'default' : 'circle'} icon={<SettingOutlined />} aria-label='Performance settings' />
                                        </Dropdown>
                                    </Tooltip>
                                ) : null}
                            </Space>
                        </div>
                    </div>
                }
            >
                {!selectedCycle ? (
                    <Alert
                        type='warning'
                        showIcon
                        style={{ marginBottom: 16 }}
                        message={`No performance cycle is open for ${cycleForDate(new Date()).label}`}
                        description={
                            canSeeAll
                                ? 'Open the cycle to set its review windows and start compacting.'
                                : 'HR opens each financial year before compacts can be captured.'
                        }
                        action={
                            canSeeAll ? (
                                <Button type='primary' onClick={() => setCyclesOpen(true)}>
                                    Open cycle
                                </Button>
                            ) : null
                        }
                    />
                ) : (
                    <Space wrap size={[16, 6]} style={{ marginBottom: 12 }}>
                        {cycleStatusTag(selectedCycle.status)}
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {dayjs(selectedCycle.startDate).format('D MMM YYYY')} – {dayjs(selectedCycle.endDate).format('D MMM YYYY')}
                        </Text>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            Compacting {dayjs(selectedCycle.windows.compacting.from).format('D MMM')}–{dayjs(selectedCycle.windows.compacting.to).format('D MMM')}
                            {' · '}Mid-year {dayjs(selectedCycle.windows.midYear.from).format('D MMM')}–{dayjs(selectedCycle.windows.midYear.to).format('D MMM')}
                            {' · '}Year-end {dayjs(selectedCycle.windows.yearEnd.from).format('D MMM')}–{dayjs(selectedCycle.windows.yearEnd.to).format('D MMM')}
                        </Text>
                    </Space>
                )}

                {rows.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div
                            style={{
                                display: 'flex',
                                height: 8,
                                borderRadius: 999,
                                overflow: 'hidden',
                                background: token.colorFillSecondary
                            }}
                        >
                            {ratingBands
                                .filter(band => band.count > 0)
                                .map(band => (
                                    <Tooltip key={band.label} title={`${band.label}: ${band.count}`}>
                                        <div
                                            style={{
                                                flex: band.count,
                                                background: token[band.colorToken],
                                                opacity: ratingFilter && ratingFilter !== band.label ? 0.3 : 1,
                                                cursor: 'pointer'
                                            }}
                                            onClick={() => setRatingFilter(ratingFilter === band.label ? undefined : band.label)}
                                        />
                                    </Tooltip>
                                ))}
                        </div>
                        <Space wrap size={[16, 4]} style={{ marginTop: 8 }}>
                            {ratingBands.map(band => (
                                <Text
                                    key={band.label}
                                    type={ratingFilter && ratingFilter !== band.label ? 'secondary' : undefined}
                                    style={{ fontSize: 12, cursor: 'pointer' }}
                                    onClick={() => setRatingFilter(ratingFilter === band.label ? undefined : band.label)}
                                >
                                    <span
                                        style={{
                                            display: 'inline-block',
                                            width: 8,
                                            height: 8,
                                            borderRadius: 999,
                                            marginRight: 6,
                                            background: token[band.colorToken]
                                        }}
                                    />
                                    {band.label} <Text type='secondary' style={{ fontSize: 12 }}>{band.count}</Text>
                                </Text>
                            ))}
                        </Space>
                    </div>
                )}

                {isMobile ? (
                    <MobileCardList
                        data={visibleRows}
                        getKey={row => row.id}
                        emptyText={emptyText}
                        renderCard={(row: any) => ({
                            title: row.name || '—',
                            subtitle: roleLine(row) || undefined,
                            badge:
                                typeof row.effectiveScore === 'number' ? (
                                    <Tag color={compactRatingColor(row.effectiveScore)} style={{ borderRadius: 999, margin: 0 }}>
                                        {row.effectiveScore}/5
                                    </Tag>
                                ) : (
                                    <Tag style={{ borderRadius: 999, margin: 0 }}>Not rated</Tag>
                                ),
                            fields: [
                                {
                                    label: 'Rating',
                                    value:
                                        typeof row.effectiveScore === 'number'
                                            ? row.latestRating
                                            : row.compact
                                              ? `Compact ${compactStatusMeta(row.compactStatus).label.toLowerCase()}`
                                              : '—'
                                },
                                { label: 'Line manager', value: isSelf(row) ? 'You' : lineManagerCell(row) },
                                { label: 'Department', value: row.department || '—' },
                                { label: 'Progress', value: progressCell(row) }
                            ],
                            note:
                                typeof row.effectiveScore === 'number' ? (
                                    <Text type='secondary' style={{ fontSize: 12 }}>{ratingSourceText(row)}</Text>
                                ) : undefined,
                            actions: cardActions(row)
                        })}
                    />
                ) : (
                <Table
                    rowKey='id'
                    dataSource={visibleRows}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    scroll={{ x: 960 }}
                    locale={{ emptyText: <Empty description={emptyText} /> }}
                    columns={[
                        {
                            title: 'Employee',
                            key: 'employee',
                            render: (_: any, row: any) => (
                                <Space size={12}>
                                    <Avatar style={{ background: token.colorPrimaryBg, color: token.colorPrimary }}>
                                        {initialsOf(row.name || row.email)}
                                    </Avatar>
                                    <Space direction='vertical' size={0}>
                                        <Space size={6}>
                                            <Text strong>{row.name || '—'}</Text>
                                            {row.id === myUid || row.authUid === myUid ? (
                                                <Tag color='purple' style={{ borderRadius: 999, margin: 0 }}>You</Tag>
                                            ) : null}
                                        </Space>
                                        <Text type='secondary' style={{ fontSize: 12 }}>{roleLine(row)}</Text>
                                    </Space>
                                </Space>
                            )
                        },
                        {
                            title: 'Department',
                            dataIndex: 'department',
                            key: 'department',
                            render: (value: string) => value || <Text type='secondary'>—</Text>
                        },
                        {
                            title: 'Line Manager',
                            key: 'lineManager',
                            render: (_: any, row: any) => lineManagerCell(row)
                        },
                        {
                            title: 'IPM Rating',
                            key: 'score',
                            width: 240,
                            render: (_: any, row: any) =>
                                typeof row.effectiveScore === 'number' ? (
                                    <Space direction='vertical' size={2} style={{ width: '100%' }}>
                                        <Space size={8}>
                                            <Text strong>{row.effectiveScore}/5</Text>
                                            <Tag color={compactRatingColor(row.effectiveScore)} style={{ borderRadius: 999, margin: 0 }}>
                                                {row.latestRating}
                                            </Tag>
                                        </Space>
                                        <Progress
                                            percent={Math.round((row.effectiveScore / 5) * 100)}
                                            size='small'
                                            showInfo={false}
                                            status={row.effectiveScore < 2.5 ? 'exception' : 'normal'}
                                        />
                                        <Text type='secondary' style={{ fontSize: 12 }}>{ratingSourceText(row)}</Text>
                                    </Space>
                                ) : (
                                    <Space direction='vertical' size={2}>
                                        <Tag style={{ borderRadius: 999, margin: 0 }}>Not Rated</Tag>
                                        {row.compact ? (
                                            <Text type='secondary' style={{ fontSize: 12 }}>Compact: {compactStatusMeta(row.compactStatus).label.toLowerCase()}</Text>
                                        ) : null}
                                    </Space>
                                )
                        },
                        {
                            title: 'Progress',
                            key: 'progress',
                            render: (_: any, row: any) => progressCell(row)
                        },
                        {
                            title: '',
                            key: 'actions',
                            align: 'right' as const,
                            render: (_: any, row: EmployeeRow) => {
                                const showHistory = () => showHistoryFor(row)
                                if (isSelf(row)) {
                                    const started = !!compactFor(row)
                                    return (
                                        <Space size={8}>
                                            <Tooltip title={started ? '' : 'Your line manager has not started your compact yet.'}>
                                                <Button
                                                    type='primary'
                                                    shape='round'
                                                    icon={<FileTextOutlined />}
                                                    disabled={!started}
                                                    onClick={() => openCompact(row, 'self')}
                                                >
                                                    My compact
                                                </Button>
                                            </Tooltip>
                                            <Button shape='round' icon={<CommentOutlined />} onClick={() => openCheckIns(row, 'self')}>
                                                Check-ins
                                            </Button>
                                            <Dropdown
                                                trigger={['click']}
                                                menu={{
                                                    items: [
                                                        ...((row as any).hasPlans
                                                            ? [{ key: 'plan', icon: <WarningOutlined />, label: 'My enhancement plan', onClick: () => openPlan(row, 'self') }]
                                                            : []),
                                                        { key: 'history', icon: <EyeOutlined />, label: 'History', onClick: showHistory }
                                                    ]
                                                }}
                                            >
                                                <Button shape='circle' icon={<MoreOutlined />} aria-label='More actions' />
                                            </Dropdown>
                                        </Space>
                                    )
                                }
                                if (!canManage(row)) {
                                    return (
                                        <Button shape='round' icon={<EyeOutlined />} onClick={showHistory}>
                                            History
                                        </Button>
                                    )
                                }
                                return (
                                    <Space size={8}>
                                        <Button
                                            type='primary'
                                            shape='round'
                                            icon={<FileTextOutlined />}
                                            onClick={() => openCompact(row)}
                                        >
                                            Compact
                                        </Button>
                                        <Dropdown
                                            trigger={['click']}
                                            menu={{
                                                items: [
                                                    { key: 'checkins', icon: <CommentOutlined />, label: 'Check-ins', onClick: () => openCheckIns(row, 'manage') },
                                                    { key: 'plan', icon: <WarningOutlined />, label: 'Enhancement plan', onClick: () => openPlan(row, 'manage') },
                                                    { key: 'action', icon: <TrophyOutlined />, label: 'Take action', onClick: () => openAction(row) },
                                                    { key: 'history', icon: <EyeOutlined />, label: 'History', onClick: showHistory }
                                                ]
                                            }}
                                        >
                                            <Button shape='circle' icon={<MoreOutlined />} aria-label='More actions' />
                                        </Dropdown>
                                    </Space>
                                )
                            }
                        }
                    ]}
                />
                )}
            </MotionCard>

            <CompactDrawer
                open={!!compactEmployee}
                onClose={() => setCompactEmployee(null)}
                mode={compactMode}
                employee={compactEmployee}
                lineManagerName={compactEmployee?.lineManagerId ? nameById.get(compactEmployee.lineManagerId) : undefined}
                cycle={selectedCycle}
                initial={compactInitial?.content || EMPTY_COMPACT}
                initialSignoff={compactInitial?.signoff}
                exists={!!compactInitial?.exists}
                isLegacySeed={compactInitial?.legacy}
                competencies={competencies}
                canSignAsManager={!!myUid && compactEmployee?.lineManagerId === myUid}
                canCheckAsHr={canSeeAll}
                reviewRecords={compactEmployee ? reviewsByEmployee.get(compactEmployee.authUid || compactEmployee.id) : undefined}
                existingCreatedAt={compactInitial?.createdAt}
                attendanceSignals={compactEmployee ? autoPerformance[compactEmployee.id]?.signals : undefined}
                user={{ id: myUid, name: user?.name || user?.email || '', role: user?.role || '' }}
                onSaved={loadData}
            />

            <CalibrationDrawer
                open={calibrationOpen}
                onClose={() => setCalibrationOpen(false)}
                cycle={selectedCycle}
                rows={calibrationRows}
                isCeo={isDirector}
                departments={departments}
                user={{ id: myUid, name: user?.name || user?.email || '' }}
                onSaved={loadData}
            />

            <ComplianceDrawer
                open={complianceOpen}
                onClose={() => setComplianceOpen(false)}
                cycle={selectedCycle}
                rows={complianceRows}
                departments={departments}
                nameOf={uid => (uid ? nameById.get(uid) : undefined)}
            />

            <CheckInsDrawer
                open={!!checkInsRow}
                onClose={() => setCheckInsRow(null)}
                mode={sessionMode}
                employee={checkInsRow}
                lineManagerName={checkInsRow?.lineManagerId ? nameById.get(checkInsRow.lineManagerId) : undefined}
                cycle={selectedCycle}
                goals={checkInsRow ? compactFor(checkInsRow)?.items || [] : []}
                checkIns={checkInsRow ? checkInsByEmployee.get(checkInsRow.authUid || checkInsRow.id) || [] : []}
                // Guidance follows a real compact rating, not the attendance suggestion.
                score={checkInsRow && checkInsRow.ratingSource !== 'attendance' ? checkInsRow.effectiveScore : null}
                user={{ id: myUid, name: user?.name || user?.email || '', role: user?.role || '' }}
                onSaved={loadData}
            />

            <PepDrawer
                open={!!pepRow}
                onClose={() => setPepRow(null)}
                mode={sessionMode}
                employee={pepRow}
                cycle={selectedCycle}
                plans={pepRow ? plansByEmployee.get(pepRow.authUid || pepRow.id) || [] : []}
                user={{ id: myUid, name: user?.name || user?.email || '', role: user?.role || '' }}
                onSaved={loadData}
            />

            <CompetenciesModal
                open={competenciesOpen}
                onClose={() => setCompetenciesOpen(false)}
                competencies={competencies}
                userId={myUid}
                onChanged={loadData}
            />

            <CyclesModal
                open={cyclesOpen}
                onClose={() => setCyclesOpen(false)}
                cycles={cycles}
                userId={myUid}
                onSaved={cycleId => {
                    setSelectedCycleId(cycleId)
                    loadData()
                }}
            />

            <Modal
                open={actionOpen}
                title={selectedEmployee ? `Performance Action - ${selectedEmployee.name}` : 'Performance Action'}
                onCancel={() => setActionOpen(false)}
                footer={null}
                destroyOnClose
                width={720}
            >
                {selectedEmployee && autoPerformance[selectedEmployee.id] ? (
                    <Alert
                        showIcon
                        type='info'
                        style={{ marginBottom: 16 }}
                        message={`System score: ${autoPerformance[selectedEmployee.id].score}% (${autoPerformance[selectedEmployee.id].rating})`}
                        description={autoPerformance[selectedEmployee.id].signals.join(' | ')}
                    />
                ) : null}
                <Form form={form} layout='vertical' onFinish={saveAction}>
                    <Row gutter={[12, 0]}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='score'
                                label='Performance Score'
                                rules={[{ required: true, message: 'Enter a score' }]}
                            >
                                <InputNumber min={0} max={100} addonAfter='%' style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='actionType'
                                label='Action Type'
                                rules={[{ required: true, message: 'Select an action' }]}
                            >
                                <Select options={ACTION_OPTIONS} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='actionStatus'
                                label='Action Status'
                                rules={[{ required: true, message: 'Select a status' }]}
                            >
                                <Select options={STATUS_OPTIONS} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name='dueDate' label='Follow-up Date'>
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name='notes' label='Notes / Decision'>
                                <Input.TextArea rows={4} placeholder='Record the action, decision, or support required.' />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
                        <Space>
                            <Button onClick={() => setActionOpen(false)} disabled={saving}>
                                Cancel
                            </Button>
                            <Button type='primary' htmlType='submit' loading={saving}>
                                Save Action
                            </Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>

            <Drawer
                open={historyOpen}
                onClose={() => setHistoryOpen(false)}
                title={selectedEmployee ? `Performance History - ${selectedEmployee.name}` : 'Performance History'}
                width={isMobile ? '100%' : 760}
            >
                {isMobile ? (
                    <MobileCardList
                        data={selectedHistory}
                        getKey={row => row.id}
                        pageSize={6}
                        emptyText='No performance history yet.'
                        renderCard={(row: PerformanceReview) => ({
                            title: STATUS_OPTIONS.find(option => option.value === row.actionStatus)?.label || row.actionStatus,
                            subtitle: row.createdAtText || undefined,
                            badge: <Tag color={ratingColor(row.rating)} style={{ margin: 0 }}>{row.rating}</Tag>,
                            fields: [
                                { label: 'Score', value: `${row.score}%` },
                                { label: 'Reviewer', value: row.reviewerName || '-' }
                            ],
                            note: row.notes || undefined
                        })}
                    />
                ) : (
                <Table
                    rowKey='id'
                    dataSource={selectedHistory}
                    pagination={{ pageSize: 6 }}
                    locale={{ emptyText: <Empty description='No performance history yet.' /> }}
                    columns={[
                        {
                            title: 'Date',
                            dataIndex: 'createdAtText',
                            key: 'createdAtText',
                            render: (value: string) => value || '-'
                        },
                        {
                            title: 'Score',
                            dataIndex: 'score',
                            key: 'score',
                            render: (value: number) => `${value}%`
                        },
                        {
                            title: 'Rating',
                            dataIndex: 'rating',
                            key: 'rating',
                            render: (value: string) => <Tag color={ratingColor(value)}>{value}</Tag>
                        },
                        {
                            title: 'Status',
                            dataIndex: 'actionStatus',
                            key: 'actionStatus',
                            render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>
                        },
                        {
                            title: 'Reviewer',
                            dataIndex: 'reviewerName',
                            key: 'reviewerName',
                            render: (value: string, row: PerformanceReview) => (
                                <Space direction='vertical' size={0}>
                                    <Text>{value || '-'}</Text>
                                    <Text type='secondary'>{displayRole(row.reviewerRole)}</Text>
                                </Space>
                            )
                        },
                        {
                            title: 'Notes',
                            dataIndex: 'notes',
                            key: 'notes',
                            render: (value: string) => value || '-'
                        }
                    ]}
                />
                )}
            </Drawer>
        </div>
    )
}

export default EmployeePerformancePage
