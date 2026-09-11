import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Col,
    DatePicker,
    Drawer,
    Empty,
    Form,
    Input,
    InputNumber,
    Modal,
    Progress,
    Row,
    Divider,
    Segmented,
    Select,
    Space,
    Table,
    Tag,
    Typography,
    message
} from 'antd'
import {
    CheckCircleOutlined,
    CloudDownloadOutlined,
    EyeOutlined,
    FileTextOutlined,
    ReloadOutlined,
    RiseOutlined,
    TeamOutlined,
    TrophyOutlined,
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
import {
    DashboardHeaderCard,
    MotionCard
} from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

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
    status?: string
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

type CompactPhase = 'midYear' | 'yearEnd'

type CompactRating = {
    target?: string
    self?: number
    manager?: number
    final?: number
    selfComment?: string
    managerComment?: string
}

type PerformanceCompact = {
    id: string
    employeeId: string
    employeeName?: string
    department?: string
    financialYear?: string
    phase: CompactPhase
    ratings: Record<string, CompactRating>
    overallSelfComment?: string
    overallManagerComment?: string
    finalRating?: number
    status?: string
    createdAtText?: string
    reviewerName?: string
    reviewerRole?: string
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

const EXCLUDED_ROLES = new Set(['incubatee', 'funder', 'admin'])

const ACTION_OPTIONS = [
    { value: 'recognition', label: 'Recognition' },
    { value: 'coaching', label: 'Coaching' },
    { value: 'training', label: 'Training Plan' },
    { value: 'performance-improvement', label: 'Performance Improvement' },
    { value: 'escalation', label: 'Escalate' }
]

const STATUS_OPTIONS = [
    { value: 'open', label: 'Open' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'escalated', label: 'Escalated' }
]

const COMPACT_DIMENSIONS = [
    {
        key: 'scorecard',
        label: 'Company or department scorecard',
        description:
            'Contribution towards the company or department scorecard cascaded from organisational KPIs.'
    },
    {
        key: 'grc',
        label: 'Governance, risk and compliance',
        description:
            'Contribution to governance, risk, compliance, audit findings and internal controls.'
    },
    {
        key: 'procurement',
        label: 'Procurement and financial management',
        description:
            'Contribution to procurement, financial controls and effective supply chain management.'
    },
    {
        key: 'people',
        label: 'People management',
        description:
            'Contribution to people management processes and adherence to IPM timelines.'
    },
    {
        key: 'deliverables',
        label: 'Key deliverables',
        description:
            'Contribution towards key deliverables assigned by the CEO or line manager.'
    }
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

function compactRatingLabel(score?: number) {
    if (!score) return 'Not Rated'
    if (score < 1.5) return 'Very Unsatisfactory'
    if (score < 2.5) return 'Unsatisfactory'
    if (score < 3.5) return 'Satisfactory'
    if (score < 4.5) return 'More than Satisfactory'
    return 'Exceptional'
}

function compactRatingColor(score?: number) {
    if (!score) return 'default'
    if (score < 2.5) return 'red'
    if (score < 3.5) return 'gold'
    if (score < 4.5) return 'blue'
    return 'green'
}

function suggestedCompactRatingFromAttendance(score?: number) {
    if (typeof score !== 'number') return undefined
    if (score >= 90) return 5
    if (score >= 75) return 4
    if (score >= 60) return 3
    if (score >= 40) return 2
    return 1
}

function averageFinalRating(ratings: Record<string, CompactRating> = {}) {
    const values = COMPACT_DIMENSIONS
        .map(d => Number(ratings[d.key]?.final || 0))
        .filter(v => v > 0)

    if (!values.length) return undefined
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
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

const EmployeePerformancePage: React.FC = () => {
    const { user } = useFullIdentity()
    const [form] = Form.useForm()
    const userRole = cleanRole(user?.role)
    const userDepartment = String((user as any)?.departmentName || (user as any)?.department || '')
    const isDirector = userRole === 'director'
    const isHR =
        userRole === 'hr' ||
        userDepartment.toLowerCase().startsWith('hrm') ||
        userDepartment.toLowerCase().includes('human resources')
    const isHod = userRole === 'operations'
    const canSeeAll = isDirector || isHR

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
    const [compactOpen, setCompactOpen] = useState(false)
    const [compactStep, setCompactStep] = useState(0)
    const [historyOpen, setHistoryOpen] = useState(false)

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

    const loadData = async () => {
        setLoading(true)
        try {
            const [usersSnap, reviewsSnap, compactSnap] = await Promise.all([
                getDocs(
                    query(
                        collection(db, 'users'),

                    )
                ),
                getDocs(
                    query(
                        collection(db, 'employeePerformanceReviews'),

                    )
                )
                ,
                getDocs(
                    query(
                        collection(db, 'employeePerformanceCompacts'),

                    )
                )
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
                        status: data.status || 'Active'
                    } as EmployeeRow
                })
                .filter(emp => !EXCLUDED_ROLES.has(cleanRole(emp.role)))
                .filter(emp => !isControlEmail(emp.email))
                .filter(emp => {
                    if (canSeeAll) return true
                    if (!isHod) return emp.id === String(user?.id || '')
                    if (!userDepartment) return false
                    return String(emp.department || '').toLowerCase() === userDepartment.toLowerCase()
                })

            const reviewRows = reviewsSnap.docs
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

            const compactRows = compactSnap.docs
                .map(d => {
                    const data: any = d.data()
                    const ratings = data.ratings || {}
                    return {
                        id: d.id,
                        employeeId: String(data.employeeId || ''),
                        employeeName: data.employeeName,
                        department: data.department,
                        financialYear: data.financialYear || 'FY2026/27',
                        phase: data.phase || 'midYear',
                        ratings,
                        overallSelfComment: data.overallSelfComment,
                        overallManagerComment: data.overallManagerComment,
                        finalRating: data.finalRating || averageFinalRating(ratings),
                        status: data.status || 'draft',
                        createdAtText: data.createdAtText || toDateText(data.createdAt),
                        reviewerName: data.reviewerName,
                        reviewerRole: data.reviewerRole
                    } as PerformanceCompact
                })
                .filter(r => staff.some(emp => emp.id === r.employeeId || emp.authUid === r.employeeId))
                .sort((a, b) => (b.createdAtText || '').localeCompare(a.createdAtText || ''))

            setEmployees(staff)
            setReviews(reviewRows)
            setCompacts(compactRows)
            await loadAutomaticPerformance(staff)
        } catch (error) {
            console.error(error)
            message.error('Failed to load employee performance.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadData()
    }, [user?.id, userRole, userDepartment])

    const latestReviewByEmployee = useMemo(() => {
        const map = new Map<string, PerformanceReview>()
        reviews.forEach(review => {
            if (!map.has(review.employeeId)) {
                map.set(review.employeeId, review)
            }
        })
        return map
    }, [reviews])

    const latestCompactByEmployee = useMemo(() => {
        const map = new Map<string, PerformanceCompact>()
        compacts.forEach(compact => {
            if (!map.has(compact.employeeId)) {
                map.set(compact.employeeId, compact)
            }
        })
        return map
    }, [compacts])

    const departments = useMemo(
        () =>
            [...new Set(employees.map(emp => emp.department).filter(Boolean).map(String))].sort(),
        [employees]
    )

    const rows = useMemo(() => {
        let next = employees.map(emp => {
            const review =
                latestReviewByEmployee.get(emp.id) ||
                (emp.authUid ? latestReviewByEmployee.get(emp.authUid) : undefined)
            const automatic = autoPerformance[emp.id]
            const compact =
                latestCompactByEmployee.get(emp.id) ||
                (emp.authUid ? latestCompactByEmployee.get(emp.authUid) : undefined)
            const compactRating = compact?.finalRating
            const suggestedRating = suggestedCompactRatingFromAttendance(automatic?.score)
            const effectiveScore = compactRating ?? suggestedRating
            const effectiveRating = compactRatingLabel(effectiveScore)
            return {
                ...emp,
                latestReview: review,
                compact,
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
            next = next.filter(row => row.department === departmentFilter)
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
    }, [employees, latestReviewByEmployee, latestCompactByEmployee, autoPerformance, search, departmentFilter, ratingFilter, dateRange])

    const metrics = useMemo(() => {
        const scored = rows.filter(row => typeof row.effectiveScore === 'number')
        const average = scored.length
            ? Number((scored.reduce((sum, row) => sum + Number(row.effectiveScore || 0), 0) / scored.length).toFixed(2))
            : 0
        const openActions = rows.filter(row => ['open', 'in-progress', 'escalated'].includes(row.actionStatus)).length
        const critical = rows.filter(row => Number(row.effectiveScore || 0) > 0 && Number(row.effectiveScore || 0) < 2.5).length
        return {
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

    const openCompact = (employee: EmployeeRow) => {
        const compact =
            latestCompactByEmployee.get(employee.id) ||
            (employee.authUid ? latestCompactByEmployee.get(employee.authUid) : undefined)
        const automatic = autoPerformance[employee.id]
        const peopleSuggestion = suggestedCompactRatingFromAttendance(automatic?.score)

        const initialRatings = COMPACT_DIMENSIONS.reduce((acc, dimension) => {
            acc[dimension.key] = {
                target: compact?.ratings?.[dimension.key]?.target || '',
                self: compact?.ratings?.[dimension.key]?.self,
                manager: compact?.ratings?.[dimension.key]?.manager,
                final:
                    compact?.ratings?.[dimension.key]?.final ||
                    (dimension.key === 'people' ? peopleSuggestion : undefined),
                selfComment: compact?.ratings?.[dimension.key]?.selfComment || '',
                managerComment: compact?.ratings?.[dimension.key]?.managerComment || ''
            }
            return acc
        }, {} as Record<string, CompactRating>)

        setSelectedEmployee(employee)
        form.resetFields()
        form.setFieldsValue({
            financialYear: compact?.financialYear || 'FY2026/27',
            phase: compact?.phase || 'midYear',
            status: compact?.status || 'draft',
            ratings: initialRatings,
            overallSelfComment: compact?.overallSelfComment || '',
            overallManagerComment: compact?.overallManagerComment || ''
        })
        setCompactStep(0)
        setCompactOpen(true)
    }

    const saveCompact = async (values: any) => {
        if (!selectedEmployee) return

        const ratings = values.ratings || {}
        const missingIndex = COMPACT_DIMENSIONS.findIndex(
            dimension => !ratings?.[dimension.key]?.final
        )

        if (missingIndex >= 0) {
            setCompactStep(missingIndex + 1)
            message.warning('Please complete the final rating for each compact dimension.')
            return
        }

        const finalRating = averageFinalRating(ratings)
        const automatic = autoPerformance[selectedEmployee.id]

        setSaving(true)
        try {
            await addDoc(collection(db, 'employeePerformanceCompacts'), {
                employeeId: selectedEmployee.id,
                employeeAuthUid: selectedEmployee.authUid || selectedEmployee.id,
                employeeName: selectedEmployee.name || '',
                employeeEmail: selectedEmployee.email || '',
                department: selectedEmployee.department || null,
                position: selectedEmployee.position || null,
                financialYear: values.financialYear || 'FY2026/27',
                phase: values.phase || 'midYear',
                ratings,
                finalRating: finalRating || null,
                overallSelfComment: values.overallSelfComment || '',
                overallManagerComment: values.overallManagerComment || '',
                status: values.status || 'draft',
                attendanceEvidence: automatic || null,
                reviewerId: String(user?.id || ''),
                reviewerName: user?.name || user?.email || '',
                reviewerRole: user?.role || '',
                createdAt: serverTimestamp(),
                createdAtText: dayjs().format('YYYY-MM-DD')
            })

            message.success('Performance compact saved.')
            setCompactOpen(false)
            setSelectedEmployee(null)
            await loadData()
        } catch (error) {
            console.error(error)
            message.error('Could not save performance compact.')
        } finally {
            setSaving(false)
        }
    }

    const saveAction = async (values: any) => {
        if (!selectedEmployee) return

        const score = Number(values.score || 0)
        const automatic = autoPerformance[selectedEmployee.id]
        setSaving(true)
        try {
            await addDoc(collection(db, 'employeePerformanceReviews'), {
                employeeId: selectedEmployee.id,
                employeeAuthUid: selectedEmployee.authUid || selectedEmployee.id,
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

    const compactStepOptions = [
        { label: 'Setup', value: 0 },
        ...COMPACT_DIMENSIONS.map((dimension, index) => ({
            label: `${index + 1}. ${dimension.label.split(' ')[0]}`,
            value: index + 1
        })),
        { label: 'Overall', value: COMPACT_DIMENSIONS.length + 1 }
    ]

    const activeCompactDimension =
        compactStep > 0 && compactStep <= COMPACT_DIMENSIONS.length
            ? COMPACT_DIMENSIONS[compactStep - 1]
            : null

    const compactLastStep = COMPACT_DIMENSIONS.length + 1

    if (loading) {
        return
        <div style={{ minHeight: '100vh' }}>
            <LoadingOverlay tip='Loading employee performance...' />
        </div>
    }

    return (
        <div style={{ padding: 24 }}>
            <DashboardHeaderCard
                title='Employee Performance'
                titleIcon={<TrophyOutlined />}
                titleTag={{
                    label: canSeeAll ? 'All Employees' : 'Department Scope',
                    color: canSeeAll ? 'blue' : 'purple'
                }}
                subtitle={
                    canSeeAll
                        ? 'HR and Director view across all employee IPM compacts.'
                        : `${userDepartment || 'Your department'} IPM compact view.`
                }
                subtitleTags={[
                    {
                        label: 'FY2026/27 compact model',
                        color: 'green'
                    }
                ]}
                extraRight={
                    <Space wrap>
                        <Button icon={<CloudDownloadOutlined />} onClick={exportCsv}>
                            Export
                        </Button>
                        <Button icon={<ReloadOutlined />} onClick={loadData}>
                            Refresh
                        </Button>
                    </Space>
                }
            />

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={5}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<TeamOutlined />}
                            title='Employees'
                            value={metrics.total}
                            subtitle='Visible in your scope'
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} lg={5}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<CheckCircleOutlined />}
                            iconBg='rgba(82,196,26,.12)'
                            title='Rated'
                            value={metrics.reviewed}
                            subtitle='Compact or suggested'
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} lg={5}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<RiseOutlined />}
                            iconBg='rgba(22,119,255,.12)'
                            title='Average Score'
                            value={metrics.average ? `${metrics.average}/5` : '-'}
                            subtitle='Equal-weight compact average'
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} lg={5}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<FileTextOutlined />}
                            iconBg='rgba(250,173,20,.14)'
                            title='Open Actions'
                            value={metrics.openActions}
                            subtitle='Follow-up required'
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} lg={4}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<WarningOutlined />}
                            iconBg='rgba(255,77,79,.12)'
                            title='Critical'
                            value={metrics.critical}
                            subtitle='Below 2.5 rating'
                        />
                    </MotionCard>
                </Col>
            </Row>

            <MotionCard
                style={{ marginTop: 16 }}
                filterBar={
                    <Row gutter={[12, 12]} align='middle'>
                        <Col xs={24} lg={7}>
                            <Input.Search
                                allowClear
                                placeholder='Search employee, email, position, department'
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </Col>
                        <Col xs={24} sm={12} lg={5}>
                            <Select
                                allowClear
                                placeholder='Department'
                                value={departmentFilter}
                                onChange={setDepartmentFilter}
                                style={{ width: '100%' }}
                                options={departments.map(dep => ({ value: dep, label: dep }))}
                            />
                        </Col>
                        <Col xs={24} sm={12} lg={5}>
                            <Select
                                allowClear
                                placeholder='Rating'
                                value={ratingFilter}
                                onChange={setRatingFilter}
                                style={{ width: '100%' }}
                                options={['Exceptional', 'More than Satisfactory', 'Satisfactory', 'Unsatisfactory', 'Very Unsatisfactory', 'Not Rated'].map(value => ({
                                    value,
                                    label: value
                                }))}
                            />
                        </Col>
                        <Col xs={24} lg={7}>
                            <RangePicker
                                value={dateRange as any}
                                onChange={value => setDateRange(value as any)}
                                style={{ width: '100%' }}
                            />
                        </Col>
                    </Row>
                }
                filterBarProps={{
                    background: '#f8fafc',
                    borderColor: '#d9e8ff',
                    borderRadius: 14
                }}
            >
                <Table
                    rowKey='id'
                    dataSource={rows}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    locale={{ emptyText: <Empty description='No employees found for this scope.' /> }}
                    columns={[
                        {
                            title: 'Employee',
                            key: 'employee',
                            render: (_: any, row: any) => (
                                <Space direction='vertical' size={0}>
                                    <Text strong>{row.name || '-'}</Text>
                                    <Text type='secondary'>{row.email || '-'}</Text>
                                </Space>
                            )
                        },
                        {
                            title: 'Role',
                            dataIndex: 'role',
                            key: 'role',
                            render: (value: string) => displayRole(value)
                        },
                        {
                            title: 'Department',
                            dataIndex: 'department',
                            key: 'department',
                            render: (value: string) => value || '-'
                        },
                        {
                            title: 'IPM Rating',
                            key: 'score',
                            render: (_: any, row: any) =>
                                typeof row.effectiveScore === 'number' ? (
                                    <Space direction='vertical' size={2} style={{ minWidth: 180 }}>
                                        <Progress
                                            percent={Math.round((row.effectiveScore / 5) * 100)}
                                            size='small'
                                            format={() => `${row.effectiveScore}/5`}
                                            status={row.effectiveScore < 2.5 ? 'exception' : 'normal'}
                                        />
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            {row.compact
                                                ? `${row.compact.financialYear} ${row.compact.phase === 'midYear' ? 'mid-year' : 'year-end'}`
                                                : `Suggested from evidence: ${row.automatic?.signals?.[0] || 'no attendance signal'}`}
                                        </Text>
                                    </Space>
                                ) : (
                                    <Tag>Not Rated</Tag>
                                )
                        },
                        {
                            title: 'Rating',
                            key: 'rating',
                            render: (_: any, row: any) => (
                                <Tag color={compactRatingColor(row.effectiveScore)} style={{ borderRadius: 999 }}>
                                    {row.latestRating}
                                </Tag>
                            )
                        },
                        {
                            title: 'Action',
                            key: 'action',
                            render: (_: any, row: any) => (
                                <Space direction='vertical' size={0}>
                                    <Tag color={statusColor(row.actionStatus)} style={{ borderRadius: 999 }}>
                                        {row.actionStatus === 'none' ? 'No Action' : row.actionStatus}
                                    </Tag>
                                    {row.dueDate ? <Text type='secondary'>Due {row.dueDate}</Text> : null}
                                </Space>
                            )
                        },
                        {
                            title: 'Actions',
                            key: 'actions',
                            render: (_: any, row: EmployeeRow) => (
                                <Space wrap>
                                    <Button
                                        type='primary'
                                        shape='round'
                                        icon={<FileTextOutlined />}
                                        onClick={() => openCompact(row)}
                                    >
                                        Open Compact
                                    </Button>
                                    <Button
                                        shape='round'
                                        icon={<WarningOutlined />}
                                        onClick={() => openAction(row)}
                                    >
                                        Take Action
                                    </Button>
                                    <Button
                                        shape='round'
                                        icon={<EyeOutlined />}
                                        onClick={() => {
                                            setSelectedEmployee(row)
                                            setHistoryOpen(true)
                                        }}
                                    >
                                        History
                                    </Button>
                                </Space>
                            )
                        }
                    ]}
                />
            </MotionCard>

            <Modal
                open={compactOpen}
                title={selectedEmployee ? `FY2026/27 IPM Compact - ${selectedEmployee.name}` : 'IPM Compact'}
                onCancel={() => setCompactOpen(false)}
                footer={null}
                destroyOnClose
                width={1100}
            >
                {selectedEmployee && autoPerformance[selectedEmployee.id] ? (
                    <Alert
                        showIcon
                        type='info'
                        style={{ marginBottom: 16 }}
                        message='Attendance evidence for People Management'
                        description={autoPerformance[selectedEmployee.id].signals.join(' | ')}
                    />
                ) : null}

                <Form form={form} layout='vertical' onFinish={saveCompact}>
                    <Segmented
                        block
                        value={compactStep}
                        onChange={value => setCompactStep(Number(value))}
                        options={compactStepOptions}
                        style={{ marginBottom: 16 }}
                    />

                    {compactStep === 0 && (
                        <>
                            <Alert
                                showIcon
                                type='warning'
                                style={{ marginBottom: 16 }}
                                message='Rating scale'
                                description='Use the compact scale: 1 Very Unsatisfactory, 2 Unsatisfactory, 3 Satisfactory, 4 More than Satisfactory, 5 Exceptional. Final rating is the average of the five equally weighted dimensions.'
                            />
                            <Row gutter={[12, 0]}>
                                <Col xs={24} md={8}>
                                    <Form.Item name='financialYear' label='Financial Year'>
                                        <Input />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                    <Form.Item name='phase' label='Review Phase'>
                                        <Select
                                            options={[
                                                { value: 'midYear', label: 'Mid-year Review' },
                                                { value: 'yearEnd', label: 'Year-end Review' }
                                            ]}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                    <Form.Item name='status' label='Compact Status'>
                                        <Select
                                            options={[
                                                { value: 'draft', label: 'Draft' },
                                                { value: 'manager-reviewed', label: 'Manager Reviewed' },
                                                { value: 'employee-signed', label: 'Employee Signed' },
                                                { value: 'hr-checked', label: 'HR Compliance Checked' },
                                                { value: 'ceo-assured', label: 'CEO Assured' }
                                            ]}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </>
                    )}

                    {activeCompactDimension && (
                        <MotionCard style={{ marginBottom: 12 }}>
                            <Space direction='vertical' size={8} style={{ width: '100%' }}>
                                <Space align='start' wrap>
                                    <Tag color='blue' style={{ borderRadius: 999 }}>
                                        {compactStep}
                                    </Tag>
                                    <div>
                                        <Text strong>{activeCompactDimension.label}</Text>
                                        <div>
                                            <Text type='secondary'>{activeCompactDimension.description}</Text>
                                        </div>
                                    </div>
                                </Space>

                                <Form.Item
                                    name={['ratings', activeCompactDimension.key, 'target']}
                                    label='Target / KPI'
                                >
                                    <Input.TextArea rows={3} placeholder='Capture the target or KPI for this dimension.' />
                                </Form.Item>

                                <Row gutter={[12, 0]}>
                                    <Col xs={24} md={8}>
                                        <Form.Item
                                            name={['ratings', activeCompactDimension.key, 'self']}
                                            label='Self-rating'
                                        >
                                            <InputNumber min={1} max={5} step={1} style={{ width: '100%' }} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={8}>
                                        <Form.Item
                                            name={['ratings', activeCompactDimension.key, 'manager']}
                                            label='Manager rating'
                                        >
                                            <InputNumber min={1} max={5} step={1} style={{ width: '100%' }} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={8}>
                                        <Form.Item
                                            name={['ratings', activeCompactDimension.key, 'final']}
                                            label='Final rating'
                                            rules={[{ required: true, message: 'Enter final rating' }]}
                                        >
                                            <InputNumber min={1} max={5} step={1} style={{ width: '100%' }} />
                                        </Form.Item>
                                    </Col>
                                </Row>

                                <Row gutter={[12, 0]}>
                                    <Col xs={24} md={12}>
                                        <Form.Item
                                            name={['ratings', activeCompactDimension.key, 'selfComment']}
                                            label='Self-comment'
                                        >
                                            <Input.TextArea rows={3} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <Form.Item
                                            name={['ratings', activeCompactDimension.key, 'managerComment']}
                                            label='Manager comment'
                                        >
                                            <Input.TextArea rows={3} />
                                        </Form.Item>
                                    </Col>
                                </Row>
                            </Space>
                        </MotionCard>
                    )}

                    {compactStep === compactLastStep && (
                        <>
                            <Alert
                                showIcon
                                type='success'
                                style={{ marginBottom: 16 }}
                                message='Overall comments and sign-off readiness'
                                description='Use this step for the overall mid-year or year-end comments before saving the compact record.'
                            />
                            <Row gutter={[12, 0]}>
                                <Col xs={24} md={12}>
                                    <Form.Item name='overallSelfComment' label='Overall self-comment'>
                                        <Input.TextArea rows={5} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name='overallManagerComment' label='Overall manager comment'>
                                        <Input.TextArea rows={5} />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </>
                    )}

                    <Divider />
                    <Row justify='space-between' align='middle'>
                        <Col>
                            <Text type='secondary'>
                                Step {compactStep + 1} of {compactLastStep + 1}
                            </Text>
                        </Col>
                        <Col>
                            <Space>
                                <Button onClick={() => setCompactOpen(false)} disabled={saving}>
                                    Cancel
                                </Button>
                                <Button
                                    disabled={compactStep === 0 || saving}
                                    onClick={() => setCompactStep(prev => Math.max(prev - 1, 0))}
                                >
                                    Previous
                                </Button>
                                {compactStep < compactLastStep ? (
                                    <Button
                                        type='primary'
                                        onClick={() => setCompactStep(prev => Math.min(prev + 1, compactLastStep))}
                                    >
                                        Next
                                    </Button>
                                ) : (
                                    <Button type='primary' htmlType='submit' loading={saving}>
                                        Save Compact
                                    </Button>
                                )}
                            </Space>
                        </Col>
                    </Row>
                </Form>
            </Modal>

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
                width={760}
            >
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
            </Drawer>
        </div>
    )
}

export default EmployeePerformancePage
