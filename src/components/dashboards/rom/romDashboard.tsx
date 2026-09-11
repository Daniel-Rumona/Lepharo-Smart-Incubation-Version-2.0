import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Row,
    Col,
    Table,
    Tag,
    Space,
    Button,
    Typography,
    Empty,
    Modal,
    DatePicker,
    Select,
    Input,
    Progress,
    Segmented,
} from 'antd'
import {
    TeamOutlined,
    ScheduleOutlined,
    ExclamationCircleOutlined,
    ReloadOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import { collection, getDocs, query, QueryConstraint, where } from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs, { Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'

import { MotionCard } from '../metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { Helmet } from 'react-helmet'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useSMERiskRegisterData } from '@/routes/operations/reports/monitoring/SMERiskRegister/useSMERiskRegisterData'
import { rollupReportAssignments } from '@/utils/reportGroupAssignments'
import { useColorMode } from '@/contexts/ThemeContext'

const { Text } = Typography
const { RangePicker } = DatePicker

/**
 * Field label for the follow-up filter bar.
 *
 * Typography.Text renders an inline <span>, and every control it labels here is
 * inline-flex or inline-block. Left inline, the label and its 100%-wide control
 * sat on the same line, so each field overflowed its column and the row ran off
 * the edge of the modal. Making the label a block is what keeps the fields
 * inside their columns.
 */
const FilterLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Text strong style={{ display: 'block', marginBottom: 6 }}>
        {children}
    </Text>
)

/**
 * Quick ranges offered inside the RangePicker dropdown.
 *
 * Built lazily on each render rather than as a module constant: dayjs() would
 * otherwise be frozen at import time, so "Last 7 days" would drift as the tab
 * stayed open overnight.
 */
const rangePresets = (): { label: string; value: [Dayjs, Dayjs] }[] => [
    { label: 'Last 7 days', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] },
    { label: 'Last 14 days', value: [dayjs().subtract(13, 'day').startOf('day'), dayjs().endOf('day')] },
    { label: 'Last 30 days', value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] },
    { label: 'This month', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
    { label: 'Last month', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
    // Derived by hand: dayjs' quarter helpers need the quarterOfYear plugin,
    // which this app never registers, and startOf('quarter') fails silently
    // without it rather than throwing.
    {
        label: 'This quarter',
        value: [
            dayjs().month(Math.floor(dayjs().month() / 3) * 3).startOf('month'),
            dayjs().month(Math.floor(dayjs().month() / 3) * 3 + 2).endOf('month'),
        ],
    },
    { label: 'Year to date', value: [dayjs().startOf('year'), dayjs().endOf('day')] },
]

type Acceptance = 'pending' | 'accepted' | 'declined'
type Completion = 'pending' | 'done' | 'confirmed' | 'rejected'
type RomHealthView = 'delivery' | 'compliance' | 'oversight'

type RomHealthSection = {
    key: RomHealthView
    label: string
    title: string
    total: number
    totalLabel: string
    healthyLabel: string
    items: Array<{
        label: string
        value: number
        color: string
    }>
}

type ProgressShape = {
    percentage?: number
    hoursLogged?: number
    sessionsLogged?: number
    documentsUploaded?: any[]
    updates?: any[]
}

type WorkflowState = {
    bucket: string
    waitingOn: string
    description: string
    tagColor: string
    chartColor: string
    rank: number
}

interface AppDoc {
    id: string
    participantId?: string
    beneficiaryName?: string
    email?: string
    stage?: string
    applicationStatus?: string
    complianceScore?: number
    gapGroup?: 'A' | 'B' | 'C'
    graduationStatus?: string
}

interface ConsolidatedMovDoc {
    id: string
    totalItems?: number
    interventions?: any[]
    approvals?: Array<{ step?: string }>
}

interface AssignedInterventionRow {
    id: string

    beneficiaryName?: string
    participantName?: string
    businessName?: string
    companyName?: string
    smmeName?: string
    participantId?: string

    consultantName?: string
    assigneeName?: string
    consultantEmail?: string
    assigneeEmail?: string

    interventionTitle?: string
    title?: string
    subInterventionTitle?: string
    subInterventionName?: string
    subIntervention?: string

    status?: string
    assignmentStatus?: string
    assigneeAcceptanceStatus?: string
    participantAcceptanceStatus?: string
    completionStatus?: string

    assigneeCompletionStatus?: string
    participantCompletionStatus?: string
    beneficiaryCompletionStatus?: string

    progress?: number | ProgressShape
    computedProgress?: number

    dueDate?: any
    assignedAt?: any
    createdAt?: any
    updatedAt?: any
    startDate?: any
    completedAt?: any

    declineReason?: string
    rejection?: {
        reason?: string
    }
    holdUpReason?: string
    holdupReason?: string
    delayReason?: string
    blockerReason?: string
    blockedReason?: string

    areaOfSupport?: string
    department?: string
    departmentName?: string
    departmentId?: string
    programId?: string

    groupId?: string
    groupKey?: string
    groupAssignmentId?: string

    snapshot?: {
        beneficiaryName?: string
        assigneeName?: string
        interventionTitle?: string
        departmentName?: string
        selectedSubIntervention?: {
            subId?: string
            title?: string
        } | null
    }
}

interface InterventionHoldUp {
    key: string
    department: string
    intervention: string
    sme: string
    facilitator: string
    waitingOn: string
    reason: string
    detail?: string
    progress: number
    assignedDate: number | null
    dueDate: number | null
    overdue: boolean
    state: WorkflowState
}

const norm = (value: any) =>
    String(value ?? '')
        .trim()
        .toLowerCase()

const toTitle = (s: string) =>
    String(s || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim()

const toMillis = (value: any): number | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate().getTime()
    if (typeof value === 'number') return value
    if (value instanceof Date) return value.getTime()
    const seconds = value?.seconds ?? value?._seconds
    if (typeof seconds === 'number') return seconds * 1000
    const parsed = new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : null
}

const asDay = (value: any) => {
    const ms = toMillis(value)
    if (!ms) return null
    return dayjs(ms)
}

const formatDate = (value: any) => {
    const d = asDay(value)
    return d && d.isValid() ? d.format('DD MMM YYYY') : '—'
}

const clampPercent = (value: any) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return 0
    return Math.max(0, Math.min(100, Math.round(num)))
}

const getProgressPercent = (row: AssignedInterventionRow) => {
    const computed = Number(row.computedProgress)
    if (Number.isFinite(computed)) return clampPercent(computed)

    if (typeof row.progress === 'number') return clampPercent(row.progress)

    const progressPercentage = Number((row.progress as ProgressShape | undefined)?.percentage)
    if (Number.isFinite(progressPercentage)) return clampPercent(progressPercentage)

    return 0
}

const progressTagColor = (percent: number) => {
    if (percent >= 100) return 'green'
    if (percent > 0) return 'blue'
    return 'default'
}

const getBeneficiaryName = (row: AssignedInterventionRow) =>
    row.beneficiaryName ||
    row.participantName ||
    row.businessName ||
    row.companyName ||
    row.smmeName ||
    row.snapshot?.beneficiaryName ||
    row.participantId ||
    'Unknown SME'

const getFacilitatorName = (row: AssignedInterventionRow) =>
    row.consultantName ||
    row.assigneeName ||
    row.snapshot?.assigneeName ||
    row.consultantEmail ||
    row.assigneeEmail ||
    'Unassigned facilitator'

const getDepartmentName = (row: AssignedInterventionRow) =>
    row.departmentName ||
    row.snapshot?.departmentName ||
    row.department ||
    row.areaOfSupport ||
    row.departmentId ||
    'Unassigned'

const getInterventionTitle = (row: AssignedInterventionRow) =>
    row.subInterventionTitle ||
    row.subInterventionName ||
    row.subIntervention ||
    row.snapshot?.selectedSubIntervention?.title ||
    row.interventionTitle ||
    row.title ||
    row.snapshot?.interventionTitle ||
    'Untitled intervention'

const getSmeAcceptance = (row: AssignedInterventionRow): Acceptance => {
    const value = norm(row.participantAcceptanceStatus || row.participantAcceptanceStatus)

    if (value === 'accepted' || value === 'confirmed') return 'accepted'
    if (value === 'declined' || value === 'rejected') return 'declined'

    return 'pending'
}

const getFacilitatorAcceptance = (row: AssignedInterventionRow): Acceptance => {
    const value = norm(row.assigneeAcceptanceStatus || row.assigneeAcceptanceStatus)

    if (value === 'accepted' || value === 'confirmed') return 'accepted'
    if (value === 'declined' || value === 'rejected') return 'declined'

    return 'pending'
}

const getFacilitatorCompletion = (row: AssignedInterventionRow): Completion => {
    const direct = norm(row.assigneeCompletionStatus || row.assigneeCompletionStatus)
    const completionStatus = norm(row.completionStatus)

    if (direct === 'done' || direct === 'completed' || direct === 'confirmed') return 'done'
    if (direct === 'rejected') return 'rejected'

    if (
        completionStatus === 'submitted' ||
        completionStatus === 'done' ||
        completionStatus === 'completed' ||
        completionStatus === 'confirmed'
    ) {
        return 'done'
    }

    return 'pending'
}

const getSmeCompletion = (row: AssignedInterventionRow): Completion => {
    const direct = norm(row.participantCompletionStatus || row.beneficiaryCompletionStatus)
    const completionStatus = norm(row.completionStatus)

    if (direct === 'confirmed' || direct === 'accepted') return 'confirmed'
    if (direct === 'done' || direct === 'completed') return 'done'
    if (direct === 'rejected' || direct === 'declined') return 'rejected'

    if (completionStatus === 'confirmed' || completionStatus === 'completed') return 'confirmed'
    if (completionStatus === 'rejected') return 'rejected'

    return 'pending'
}

const isFullyCompleted = (row: AssignedInterventionRow) => {
    const facilitatorDone = getFacilitatorCompletion(row)
    const smeDone = getSmeCompletion(row)

    return facilitatorDone === 'done' && (smeDone === 'confirmed' || smeDone === 'done')
}

const isCompletedLegacy = (row: AssignedInterventionRow) => {
    const status = norm(row.assignmentStatus)
    const completionStatus = norm(row.completionStatus)
    const participantCompletionStatus = norm(
        row.participantCompletionStatus || row.beneficiaryCompletionStatus
    )

    return (
        status === 'completed' ||
        completionStatus === 'confirmed' ||
        completionStatus === 'completed' ||
        participantCompletionStatus === 'confirmed' ||
        participantCompletionStatus === 'done' ||
        participantCompletionStatus === 'completed'
    )
}

const isCancelled = (row: AssignedInterventionRow) => {
    const status = norm(row.assignmentStatus)
    return status === 'cancelled' || status === 'canceled'
}

const isOverdueRecord = (row: AssignedInterventionRow) => {
    if (isCancelled(row) || isFullyCompleted(row) || isCompletedLegacy(row)) return false

    const due = asDay(row.dueDate)
    if (!due || !due.isValid()) return false

    return due.isBefore(dayjs(), 'day')
}

const getWorkflowState = (row: AssignedInterventionRow): WorkflowState => {
    const rawStatus = norm(row.assignmentStatus)
    const facilitatorAcceptance = getFacilitatorAcceptance(row)
    const smeAcceptance = getSmeAcceptance(row)
    const facilitatorCompletion = getFacilitatorCompletion(row)
    const smeCompletion = getSmeCompletion(row)

    if (isCancelled(row)) {
        return {
            bucket: 'Cancelled',
            waitingOn: 'No Action',
            description: 'This assigned intervention was cancelled.',
            tagColor: 'volcano',
            chartColor: '#f5222d',
            rank: 90,
        }
    }

    if (isFullyCompleted(row) || isCompletedLegacy(row)) {
        return {
            bucket: 'Completed',
            waitingOn: 'No Action',
            description: 'Facilitator delivery and SME confirmation are complete.',
            tagColor: 'green',
            chartColor: '#52c41a',
            rank: 80,
        }
    }

    if (facilitatorAcceptance === 'declined') {
        return {
            bucket: 'Facilitator Declined',
            waitingOn: 'Reassignment',
            description:
                'The facilitator declined this intervention. It needs reassignment or administrator action.',
            tagColor: 'red',
            chartColor: '#ff4d4f',
            rank: 15,
        }
    }

    if (facilitatorCompletion === 'rejected') {
        return {
            bucket: 'Delivery Rejected',
            waitingOn: 'Facilitator Correction',
            description: 'The facilitator delivery update was rejected and needs correction.',
            tagColor: 'red',
            chartColor: '#cf1322',
            rank: 55,
        }
    }

    if (smeCompletion === 'rejected') {
        return {
            bucket: 'SME Rejected Completion',
            waitingOn: 'Facilitator Correction',
            description:
                'The SME rejected the completion confirmation. The facilitator must correct or update the delivery.',
            tagColor: 'red',
            chartColor: '#d4380d',
            rank: 60,
        }
    }

    if (smeAcceptance === 'declined') {
        return {
            bucket: 'SME Declined',
            waitingOn: 'SME Follow-up',
            description: 'The SME declined the intervention.',
            tagColor: 'red',
            chartColor: '#ff7875',
            rank: 25,
        }
    }

    if (smeAcceptance === 'pending') {
        return {
            bucket: 'Awaiting SME Acceptance',
            waitingOn: 'SME Acceptance',
            description: 'The SME has not accepted the intervention yet.',
            tagColor: 'orange',
            chartColor: '#fa8c16',
            rank: 20,
        }
    }

    if (facilitatorCompletion === 'pending') {
        return {
            bucket: 'In Delivery',
            waitingOn: 'Facilitator Delivery',
            description: 'The facilitator must deliver or update progress.',
            tagColor: 'geekblue',
            chartColor: '#2f54eb',
            rank: 40,
        }
    }

    if (facilitatorCompletion === 'done' && smeCompletion === 'pending') {
        return {
            bucket: 'Awaiting SME Confirmation',
            waitingOn: 'SME Completion Confirm',
            description:
                'The facilitator marked delivery as done. The SME must confirm completion.',
            tagColor: 'purple',
            chartColor: '#722ed1',
            rank: 50,
        }
    }

    return {
        bucket: toTitle(rawStatus || 'Active'),
        waitingOn: 'Review',
        description:
            'This intervention has a status that does not match the standard workflow rules.',
        tagColor: 'blue',
        chartColor: '#1677ff',
        rank: 70,
    }
}

const getKnownBlockerDetail = (row: AssignedInterventionRow) =>
    row.holdUpReason ||
    row.holdupReason ||
    row.delayReason ||
    row.blockerReason ||
    row.blockedReason ||
    (row as any).participantDeclineReason ||
    (row as any).participantCompletionRejectionReason ||
    row.declineReason ||
    row.rejection?.reason ||
    ''

const needsFollowUp = (row: AssignedInterventionRow) => {
    if (isOverdueRecord(row)) return true

    return [
        'Reassignment',
        'Facilitator Correction',
        'SME Follow-up',
        'SME Acceptance',
        'SME Completion Confirm',
        'Review',
    ].includes(getWorkflowState(row).waitingOn)
}

const matchesDepartmentScope = (
    row: AssignedInterventionRow,
    scope?: { departmentId: string; departmentName: string }
) => {
    if (!scope) return true

    const rowDepartmentId = String(row.departmentId || '').trim()
    if (rowDepartmentId && rowDepartmentId === scope.departmentId) return true

    return norm(getDepartmentName(row)) === norm(scope.departmentName)
}

const getAssignmentRollupStatus = (row: AssignedInterventionRow) => {
    if (isFullyCompleted(row) || isCompletedLegacy(row)) return 'completed' as const
    if (isCancelled(row)) return 'declined' as const
    if (getProgressPercent(row) > 0) return 'in-progress' as const
    return 'assigned' as const
}

const hasApprovalStep = (pack: ConsolidatedMovDoc, step: string) =>
    pack.approvals?.some((approval) => norm(approval.step) === norm(step)) ?? false

const getMovItemCount = (pack: ConsolidatedMovDoc) => {
    const totalItems = Number(pack.totalItems)
    if (Number.isFinite(totalItems) && totalItems > 0) return totalItems
    if (Array.isArray(pack.interventions)) return pack.interventions.length
    return 1
}

const getMovStage = (pack: ConsolidatedMovDoc) => {
    if (
        hasApprovalStep(pack, 'validation') ||
        hasApprovalStep(pack, 'me_validation') ||
        hasApprovalStep(pack, 'me_signature')
    ) {
        return {
            name: 'M&E Signed',
            color: '#13c2c2',
            rank: 40,
        }
    }

    if (
        hasApprovalStep(pack, 'final_confirmation') ||
        hasApprovalStep(pack, 'cc_signature') ||
        hasApprovalStep(pack, 'centre_coordinator_signature')
    ) {
        return {
            name: 'CC Signed / Sent to M&E',
            color: '#722ed1',
            rank: 30,
        }
    }

    if (
        hasApprovalStep(pack, 'hod_submission') ||
        hasApprovalStep(pack, 'submitted_to_cc') ||
        hasApprovalStep(pack, 'submitted')
    ) {
        return {
            name: 'Submitted to CC',
            color: '#1677ff',
            rank: 20,
        }
    }

    return {
        name: 'Prepared / Not Submitted',
        color: '#faad14',
        rank: 10,
    }
}

const ROMDashboard: React.FC = () => {
    const { isDark } = useColorMode()
    const [applications, setApplications] = useState<AppDoc[]>([])
    const [movPacks, setMovPacks] = useState<ConsolidatedMovDoc[]>([])
    const [assignedInterventions, setAssignedInterventions] = useState<AssignedInterventionRow[]>(
        []
    )
    const [loading, setLoading] = useState(true)
    const [holdUpModalOpen, setHoldUpModalOpen] = useState(false)
    const [assignedDateRange, setAssignedDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
        null
    )
    const [dueDateRange, setDueDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
    const [holdUpDepartment, setHoldUpDepartment] = useState<string>('all')
    const [smeSearch, setSmeSearch] = useState('')
    const [romHealthView, setRomHealthView] = useState<RomHealthView>('delivery')

    const navigate = useNavigate()
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const {
        loading: riskLoading,
        rows: riskRows,
        departments,
        isDepartmentScopedView,
        scopedDepartment,
    } = useSMERiskRegisterData(activeProgramId)
    const loadTokenRef = useRef(0)

    const resetDashboardData = () => {
        setApplications([])
        setMovPacks([])
        setAssignedInterventions([])
    }

    const fetchData = async (programId: string | undefined, loadToken: number) => {
        setLoading(true)
        resetDashboardData()

        try {
            const scopedQuery = (collectionName: string) => {
                const constraints: QueryConstraint[] = []

                if (programId) {
                    constraints.push(where('programId', '==', programId))
                }

                return query(collection(db, collectionName), ...constraints)
            }

            const [appsSnap, movSnap, interventionsSnap] = await Promise.all([
                getDocs(scopedQuery('applications')),
                getDocs(scopedQuery('consolidatedMOVs')),
                getDocs(scopedQuery('assignedInterventions')),
            ])

            if (loadTokenRef.current !== loadToken) return

            const apps = appsSnap.docs.map((d) => {
                const data = d.data() as any
                return {
                    id: d.id,
                    ...data,
                    gapGroup: (data.gapGroup || 'N/A') as 'A' | 'B' | 'C',
                    complianceScore: data.complianceScore ?? null,
                }
            }) as AppDoc[]

            setApplications(apps)
            setMovPacks(
                movSnap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as Omit<ConsolidatedMovDoc, 'id'>),
                }))
            )
            setAssignedInterventions(
                interventionsSnap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as Omit<AssignedInterventionRow, 'id'>),
                }))
            )
        } catch (error) {
            console.error('Failed to load ROM dashboard data:', error)
        } finally {
            if (loadTokenRef.current === loadToken) {
                setLoading(false)
            }
        }
    }

    useEffect(() => {
        const loadToken = ++loadTokenRef.current
        fetchData(activeProgramId, loadToken)
    }, [activeProgramId, isAllPrograms])

    const validApplications = applications.filter(
        (app) => !(app.email || '').toLowerCase().endsWith('@quantilytix.co.za')
    )

    const totalParticipants = validApplications.filter(
        (app) => app.applicationStatus?.toLowerCase() === 'accepted'
    ).length
    const dropouts = validApplications.filter(
        (app) => app.applicationStatus?.toLowerCase() === 'withdrawn'
    ).length
    const groupCounts = useMemo(() => {
        const counts: Record<'A' | 'B' | 'C', number> = { A: 0, B: 0, C: 0 }
        applications.forEach((app) => {
            const isInternal = (app.email || '').toLowerCase().endsWith('@quantilytix.co.za')
            const isAccepted = app.applicationStatus?.toLowerCase() === 'accepted'
            if (isInternal || !isAccepted) return

            if (app.gapGroup && counts[app.gapGroup] !== undefined) {
                counts[app.gapGroup] += 1
            }
        })
        return counts
    }, [applications])

    const groupTotal = groupCounts.A + groupCounts.B + groupCounts.C
    const groupData = [
        { name: 'Group A', y: groupCounts.A, color: '#ff4d4f' },
        { name: 'Group B', y: groupCounts.B, color: '#faad14' },
        { name: 'Group C', y: groupCounts.C, color: '#52c41a' },
    ].filter((point) => point.y > 0)

    const movStageData = useMemo(() => {
        const bucketMap = new Map<
            string,
            { name: string; y: number; color: string; rank: number }
        >()

        movPacks.forEach((pack) => {
            const stage = getMovStage(pack)
            const current = bucketMap.get(stage.name)

            bucketMap.set(stage.name, {
                ...stage,
                y: (current?.y || 0) + getMovItemCount(pack),
            })
        })

        return Array.from(bucketMap.values())
            .filter((point) => point.y > 0)
            .sort((a, b) => a.rank - b.rank)
    }, [movPacks])

    const movTotal = movStageData.reduce((sum, point) => sum + point.y, 0)

    const myDepartmentScope = useMemo(() => {
        const departmentId = String(user?.departmentId || '').trim()
        if (!departmentId) return undefined

        const department = departments.find((item) => String(item.id) === departmentId)
        const departmentName = String(
            department?.name ||
            department?.title ||
            department?.departmentName ||
            department?.displayName ||
            user?.departmentName ||
            departmentId
        ).trim()

        return { departmentId, departmentName }
    }, [departments, user?.departmentId, user?.departmentName])

    const allActiveInterventionRows = useMemo(
        () =>
            assignedInterventions.filter(
                (row) => !isCancelled(row) && !isFullyCompleted(row) && !isCompletedLegacy(row)
            ),
        [assignedInterventions]
    )

    const myActiveInterventionRows = useMemo(
        () =>
            myDepartmentScope
                ? allActiveInterventionRows.filter((row) =>
                    matchesDepartmentScope(row, myDepartmentScope)
                )
                : [],
        [allActiveInterventionRows, myDepartmentScope]
    )

    const allActiveInterventionsCount = useMemo(
        () => rollupReportAssignments(allActiveInterventionRows, getAssignmentRollupStatus).length,
        [allActiveInterventionRows]
    )

    const myActiveInterventionsCount = useMemo(
        () => rollupReportAssignments(myActiveInterventionRows, getAssignmentRollupStatus).length,
        [myActiveInterventionRows]
    )

    const visibleAssignedInterventions = useMemo(
        () =>
            assignedInterventions.filter((row) =>
                matchesDepartmentScope(row, isDepartmentScopedView ? scopedDepartment : undefined)
            ),
        [assignedInterventions, isDepartmentScopedView, scopedDepartment]
    )

    const activeInterventionRows = useMemo(
        () =>
            visibleAssignedInterventions.filter(
                (row) => !isCancelled(row) && !isFullyCompleted(row) && !isCompletedLegacy(row)
            ),
        [visibleAssignedInterventions]
    )

    const interventionHoldUps = useMemo<InterventionHoldUp[]>(() => {
        return visibleAssignedInterventions
            .filter(needsFollowUp)
            .map((row) => {
                const state = getWorkflowState(row)
                const dueDate = toMillis(row.dueDate)

                return {
                    key: row.id,
                    department: getDepartmentName(row),
                    intervention: getInterventionTitle(row),
                    sme: getBeneficiaryName(row),
                    facilitator: getFacilitatorName(row),
                    waitingOn: state.waitingOn,
                    reason: state.description,
                    detail: getKnownBlockerDetail(row),
                    progress: getProgressPercent(row),
                    assignedDate: toMillis(row.assignedAt || row.createdAt || row.startDate),
                    dueDate,
                    overdue: isOverdueRecord(row),
                    state,
                }
            })
            .sort((a, b) => {
                if (a.state.rank !== b.state.rank) return a.state.rank - b.state.rank
                if (Number(b.overdue) !== Number(a.overdue))
                    return Number(b.overdue) - Number(a.overdue)
                return (
                    (a.dueDate || Number.MAX_SAFE_INTEGER) - (b.dueDate || Number.MAX_SAFE_INTEGER)
                )
            })
    }, [visibleAssignedInterventions])

    const needsFollowUpCount = useMemo(() => {
        const rowsById = new Map(activeInterventionRows.map((row) => [row.id, row]))
        const sourceRows = interventionHoldUps
            .map((item) => rowsById.get(item.key))
            .filter(Boolean) as AssignedInterventionRow[]

        return rollupReportAssignments(sourceRows, getAssignmentRollupStatus).length
    }, [activeInterventionRows, interventionHoldUps])

    const criticalSmesCount = useMemo(
        () => riskRows.filter((row) => row.riskLevel === 'Critical').length,
        [riskRows]
    )
    const deliveryHealth = useMemo(() => {
        const rollups = rollupReportAssignments(activeInterventionRows, getAssignmentRollupStatus)
        const today = dayjs().startOf('day')
        const dueSoonCutoff = today.add(7, 'day').endOf('day')
        const overdue = rollups.filter((rollup) => rollup.members.some(isOverdueRecord)).length
        const dueSoon = rollups.filter(
            (rollup) =>
                !rollup.members.some(isOverdueRecord) &&
                rollup.members.some((member) => {
                    const dueDate = asDay(member.dueDate)
                    return (
                        !!dueDate &&
                        !dueDate.isBefore(today, 'day') &&
                        !dueDate.isAfter(dueSoonCutoff, 'day')
                    )
                })
        ).length

        return {
            total: rollups.length,
            onTrack: Math.max(rollups.length - overdue - dueSoon, 0),
            dueSoon,
            overdue,
        }
    }, [activeInterventionRows])

    const complianceHealth = useMemo(() => {
        const complete = riskRows.filter(
            (row) =>
                row.docsTotal > 0 &&
                row.docsCompleted >= row.docsTotal &&
                row.docsPending === 0 &&
                row.docsQueried === 0 &&
                row.docsRejected === 0
        ).length
        const actionRequired = riskRows.filter(
            (row) => row.docsMissing + row.docsQueried + row.docsRejected > 0
        ).length

        return {
            total: riskRows.length,
            complete,
            pending: Math.max(riskRows.length - complete - actionRequired, 0),
            actionRequired,
        }
    }, [riskRows])

    const smeOversightHealth = useMemo(
        () => ({
            total: riskRows.length,
            fullyCovered: riskRows.filter(
                (row) => row.expectedDepartmentsCount > 0 && row.missingDepartmentsCount === 0
            ).length,
            serviceGaps: riskRows.filter((row) => row.missingDepartmentsCount > 0).length,
            elevatedRisk: riskRows.filter(
                (row) => row.riskLevel === 'High' || row.riskLevel === 'Critical'
            ).length,
        }),
        [riskRows]
    )
    const romHealthSections = useMemo<RomHealthSection[]>(
        () => [
            {
                key: 'delivery',
                label: 'Delivery',
                title: 'Intervention Delivery',
                total: deliveryHealth.total,
                totalLabel: 'interventions',
                healthyLabel: 'on track',
                items: [
                    { label: 'On track', value: deliveryHealth.onTrack, color: '#52c41a' },
                    { label: 'Due in 7 days', value: deliveryHealth.dueSoon, color: '#faad14' },
                    { label: 'Overdue', value: deliveryHealth.overdue, color: '#ff4d4f' },
                ],
            },
            {
                key: 'compliance',
                label: 'Compliance',
                title: 'Documents & Compliance',
                total: complianceHealth.total,
                totalLabel: 'SMEs',
                healthyLabel: 'complete',
                items: [
                    { label: 'Complete', value: complianceHealth.complete, color: '#52c41a' },
                    {
                        label: 'Pending / not assessed',
                        value: complianceHealth.pending,
                        color: '#1677ff',
                    },
                    {
                        label: 'Action required',
                        value: complianceHealth.actionRequired,
                        color: '#ff4d4f',
                    },
                ],
            },
            {
                key: 'oversight',
                label: 'SME Oversight',
                title: 'SME Oversight',
                total: smeOversightHealth.total,
                totalLabel: 'SMEs',
                healthyLabel: 'fully covered',
                items: [
                    {
                        label: 'Fully covered',
                        value: smeOversightHealth.fullyCovered,
                        color: '#52c41a',
                    },
                    {
                        label: 'Service gaps',
                        value: smeOversightHealth.serviceGaps,
                        color: '#fa8c16',
                    },
                    {
                        label: 'High / critical risk',
                        value: smeOversightHealth.elevatedRisk,
                        color: '#cf1322',
                    },
                ],
            },
        ],
        [deliveryHealth, complianceHealth, smeOversightHealth]
    )
    const selectedRomHealth =
        romHealthSections.find((section) => section.key === romHealthView) || romHealthSections[0]
    const selectedRomHealthScore = selectedRomHealth.total
        ? Math.round((selectedRomHealth.items[0].value / selectedRomHealth.total) * 100)
        : 0
    const metricsLoading = loading || riskLoading
    const appointmentDepartmentScopeIds = useMemo(
        () => departments.map((department) => String(department.id || '').trim()).filter(Boolean),
        [departments]
    )

    const departmentOptions = useMemo(
        () =>
            Array.from(new Set(interventionHoldUps.map((row) => row.department)))
                .sort((a, b) => a.localeCompare(b))
                .map((department) => ({ label: department, value: department })),
        [interventionHoldUps]
    )

    const filteredInterventionHoldUps = useMemo(() => {
        const search = norm(smeSearch)

        return interventionHoldUps.filter((row) => {
            const assigned = row.assignedDate ? dayjs(row.assignedDate) : null
            const due = row.dueDate ? dayjs(row.dueDate) : null
            const matchesAssignedRange =
                !assignedDateRange ||
                (!!assigned &&
                    (!assignedDateRange[0] || !assigned.isBefore(assignedDateRange[0], 'day')) &&
                    (!assignedDateRange[1] || !assigned.isAfter(assignedDateRange[1], 'day')))
            const matchesDueRange =
                !dueDateRange ||
                (!!due &&
                    (!dueDateRange[0] || !due.isBefore(dueDateRange[0], 'day')) &&
                    (!dueDateRange[1] || !due.isAfter(dueDateRange[1], 'day')))

            return (
                matchesAssignedRange &&
                matchesDueRange &&
                (holdUpDepartment === 'all' || row.department === holdUpDepartment) &&
                (!search || norm(row.sme).includes(search))
            )
        })
    }, [assignedDateRange, dueDateRange, holdUpDepartment, interventionHoldUps, smeSearch])

    const clearHoldUpFilters = () => {
        setAssignedDateRange(null)
        setDueDateRange(null)
        setHoldUpDepartment('all')
        setSmeSearch('')
    }

    const holdUpColumns = [
        {
            title: 'Intervention',
            dataIndex: 'intervention',
            key: 'intervention',
            render: (_: string, row: InterventionHoldUp) => (
                <Space direction="vertical" size={4}>
                    <Text strong>{row.intervention}</Text>
                    <Tag color="blue" style={{ width: 'fit-content', marginInlineEnd: 0 }}>
                        {row.department}
                    </Tag>
                </Space>
            ),
        },
        {
            title: 'SME & Facilitator',
            dataIndex: 'sme',
            key: 'smeFacilitator',
            width: 230,
            render: (_: string, row: InterventionHoldUp) => (
                <Space direction="vertical" size={2}>
                    <Text strong>{row.sme}</Text>
                    <Text type="secondary">{row.facilitator}</Text>
                </Space>
            ),
        },
        {
            title: 'Assigned',
            dataIndex: 'assignedDate',
            key: 'assignedDate',
            width: 135,
            render: (value: number | null) => formatDate(value),
        },
        {
            title: 'Reason',
            dataIndex: 'reason',
            key: 'reason',
            render: (_: string, row: InterventionHoldUp) => (
                <Space direction="vertical" size={2}>
                    <Space>
                        {row.overdue && <ExclamationCircleOutlined style={{ color: '#cf1322' }} />}
                        <Text type={row.overdue ? 'danger' : undefined}>{row.reason}</Text>
                    </Space>
                    {row.detail ? <Text type="secondary">Note: {row.detail}</Text> : null}
                </Space>
            ),
        },
        {
            title: 'Progress',
            dataIndex: 'progress',
            key: 'progress',
            width: 100,
            render: (progress: number) => (
                <Tag
                    color={progressTagColor(progress)}
                    style={{ minWidth: 52, textAlign: 'center' }}
                >
                    {progress}%
                </Tag>
            ),
        },
        {
            title: 'Due Date',
            dataIndex: 'dueDate',
            key: 'dueDate',
            width: 135,
            render: (_: number | null, row: InterventionHoldUp) => (
                <Space direction="vertical" size={2}>
                    <Text style={{ color: row.overdue ? '#ff4d4f' : undefined }}>
                        {formatDate(row.dueDate)}
                    </Text>
                    {row.overdue ? <Tag color="red">Overdue</Tag> : null}
                </Space>
            ),
        },
    ]

    return (
        <div style={{ padding: '5px 24px' }}>
            <Helmet>
                <title>ROM Dashboard | Smart Incubation</title>
            </Helmet>

            {loading && (
                <LoadingOverlay
                    tip={isAllPrograms ? 'Loading all program data...' : 'Loading program data...'}
                />
            )}

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard.Metric
                        icon={<TeamOutlined style={{ fontSize: 18, color: '#1677ff' }} />}
                        iconBg="#e6f7ff"
                        title="Active Participants"
                        value={Math.max(totalParticipants - dropouts, 0)}
                        subtitle="Accepted SMEs currently active"
                        loading={metricsLoading}
                    />
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard.Metric
                        icon={<ScheduleOutlined style={{ fontSize: 18, color: '#13c2c2' }} />}
                        iconBg="#e6fffb"
                        title="Active Interventions"
                        value={
                            <Space size={6}>
                                <span>{allActiveInterventionsCount}</span>
                                <Text type="secondary">|</Text>
                                <span>{myDepartmentScope ? myActiveInterventionsCount : '—'}</span>
                            </Space>
                        }
                        subtitle="All Departments | My Department"
                        loading={metricsLoading}
                    />
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard.Metric
                        icon={
                            <ExclamationCircleOutlined style={{ fontSize: 18, color: '#fa8c16' }} />
                        }
                        iconBg="#fff7e6"
                        title="Needs Follow Up"
                        value={needsFollowUpCount}
                        subtitle="Open intervention actions"
                        onClick={() => setHoldUpModalOpen(true)}
                        loading={metricsLoading}
                    />
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard.Metric
                        icon={<WarningOutlined style={{ fontSize: 18, color: '#ff4d4f' }} />}
                        iconBg="#fff2f0"
                        title="Critical SMEs"
                        value={criticalSmesCount}
                        subtitle="Open SME risk register"
                        onClick={() => navigate('/operations/participants/risk')}
                        loading={metricsLoading}
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} xl={12}>
                    <MotionCard title="Monitoring Operations">
                        <Row gutter={[32, 20]}>
                            <Col xs={24} lg={12}>
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                    <div>
                                        <Text strong>SME Group Distribution</Text>
                                        <br />
                                        <Text type="secondary">
                                            {groupTotal} grouped participants
                                        </Text>
                                    </div>
                                    {groupData.length === 0 ? (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description="No grouped participants"
                                        />
                                    ) : (
                                        groupData.map((item) => (
                                            <div key={item.name}>
                                                <Space
                                                    style={{
                                                        width: '100%',
                                                        justifyContent: 'space-between',
                                                    }}
                                                >
                                                    <Text>{item.name}</Text>
                                                    <Text strong>{item.y}</Text>
                                                </Space>
                                                <Progress
                                                    percent={
                                                        groupTotal
                                                            ? Math.round(
                                                                (item.y / groupTotal) * 100
                                                            )
                                                            : 0
                                                    }
                                                    strokeColor={item.color}
                                                    size="small"
                                                />
                                            </div>
                                        ))
                                    )}
                                </Space>
                            </Col>
                            <Col xs={24} lg={12}>
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                    <div>
                                        <Text strong>MOV Workflow</Text>
                                        <br />
                                        <Text type="secondary">
                                            {movTotal} MOV items in monitoring
                                        </Text>
                                    </div>
                                    {movStageData.length === 0 ? (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description="No MOV packs yet"
                                        />
                                    ) : (
                                        movStageData.map((item) => (
                                            <div key={item.name}>
                                                <Space
                                                    style={{
                                                        width: '100%',
                                                        justifyContent: 'space-between',
                                                    }}
                                                >
                                                    <Text>{item.name}</Text>
                                                    <Text strong>{item.y}</Text>
                                                </Space>
                                                <Progress
                                                    percent={
                                                        movTotal
                                                            ? Math.round((item.y / movTotal) * 100)
                                                            : 0
                                                    }
                                                    strokeColor={item.color}
                                                    size="small"
                                                />
                                            </div>
                                        ))
                                    )}
                                </Space>
                            </Col>
                        </Row>

                        <div
                            style={{
                                marginTop: 20,
                                paddingTop: 16,
                                borderTop: '1px solid #f0f0f0',
                            }}
                        >
                            <Space direction="vertical" size={2} style={{ marginBottom: 14 }}>
                                <Text strong>ROM Health</Text>
                                <Text type="secondary">
                                    Aggregate oversight only - open the registers for record-level
                                    detail.
                                </Text>
                            </Space>

                            <Segmented
                                block
                                value={romHealthView}
                                onChange={(value) => setRomHealthView(value as RomHealthView)}
                                options={romHealthSections.map((section) => ({
                                    label: section.label,
                                    value: section.key,
                                }))}
                            />

                            <div
                                style={{
                                    marginTop: 14,
                                    padding: 16,
                                    border: '1px solid #e6efff',
                                    borderRadius: 12,
                                    background: '#fafcff',
                                }}
                            >
                                <Row gutter={[20, 16]} align="middle">
                                    <Col xs={24} sm={8} style={{ textAlign: 'center' }}>
                                        <Progress
                                            type="dashboard"
                                            percent={selectedRomHealthScore}
                                            width={112}
                                            strokeColor={selectedRomHealth.items[0].color}
                                            trailColor={isDark ? "rgba(255, 255, 255, 0.10)" : "#e9edf3"}
                                            format={(percent) => (
                                                <Space direction="vertical" size={0}>
                                                    <Text strong style={{ fontSize: 22 }}>
                                                        {percent}%
                                                    </Text>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        {selectedRomHealth.healthyLabel}
                                                    </Text>
                                                </Space>
                                            )}
                                        />
                                    </Col>
                                    <Col xs={24} sm={16}>
                                        <Space
                                            style={{
                                                width: '100%',
                                                justifyContent: 'space-between',
                                                marginBottom: 10,
                                            }}
                                        >
                                            <Text strong>{selectedRomHealth.title}</Text>
                                            <Tag color="blue">
                                                {selectedRomHealth.total}{' '}
                                                {selectedRomHealth.totalLabel}
                                            </Tag>
                                        </Space>
                                        <Space
                                            direction="vertical"
                                            size={8}
                                            style={{ width: '100%' }}
                                        >
                                            {selectedRomHealth.items.map((item) => (
                                                <div key={item.label}>
                                                    <Space
                                                        style={{
                                                            width: '100%',
                                                            justifyContent: 'space-between',
                                                        }}
                                                    >
                                                        <Text>{item.label}</Text>
                                                        <Text strong>{item.value}</Text>
                                                    </Space>
                                                    <Progress
                                                        percent={
                                                            selectedRomHealth.total
                                                                ? Math.round(
                                                                    (item.value /
                                                                        selectedRomHealth.total) *
                                                                    100
                                                                )
                                                                : 0
                                                        }
                                                        strokeColor={item.color}
                                                        showInfo={false}
                                                        size="small"
                                                    />
                                                </div>
                                            ))}
                                        </Space>
                                    </Col>
                                </Row>
                            </div>
                        </div>
                    </MotionCard>
                </Col>
                <Col xs={24} xl={12}>
                    <UpcomingAppointmentsCard
                        showAddEvent
                        departmentId={
                            isDepartmentScopedView ? scopedDepartment?.departmentId : null
                        }
                        departmentIds={
                            isAllPrograms && !isDepartmentScopedView
                                ? appointmentDepartmentScopeIds
                                : undefined
                        }
                        programId={activeProgramId}
                        daysAhead={7}
                        limit={5}
                        onViewCalendar={() => navigate('/calendar')}
                    />
                </Col>
            </Row>

            <Modal
                title="Interventions Needing Follow Up"
                open={holdUpModalOpen}
                onCancel={() => setHoldUpModalOpen(false)}
                footer={null}
                width="min(1500px, 96vw)"
                destroyOnClose={false}
            >
                <MotionCard
                    bordered={false}
                    styles={{ body: { padding: 0 } }}
                    filterBar={
                        <Row gutter={[12, 12]} align="bottom">
                            <Col xs={24} md={12} xl={6}>
                                <FilterLabel>Assigned date</FilterLabel>
                                <RangePicker
                                    value={assignedDateRange}
                                    onChange={(dates) => setAssignedDateRange(dates)}
                                    style={{ width: '100%' }}
                                    format="DD MMM YYYY"
                                    presets={rangePresets()}
                                    allowClear
                                />
                            </Col>
                            <Col xs={24} md={12} xl={6}>
                                <FilterLabel>Due date</FilterLabel>
                                <RangePicker
                                    value={dueDateRange}
                                    onChange={(dates) => setDueDateRange(dates)}
                                    style={{ width: '100%' }}
                                    format="DD MMM YYYY"
                                    presets={rangePresets()}
                                    allowClear
                                />
                            </Col>
                            <Col xs={24} md={12} xl={5}>
                                <FilterLabel>Department</FilterLabel>
                                <Select
                                    value={holdUpDepartment}
                                    onChange={setHoldUpDepartment}
                                    options={[
                                        { label: 'All departments', value: 'all' },
                                        ...departmentOptions,
                                    ]}
                                    style={{ width: '100%' }}
                                    showSearch
                                    optionFilterProp="label"
                                />
                            </Col>
                            <Col xs={24} md={12} xl={4}>
                                <FilterLabel>SME</FilterLabel>
                                <Input.Search
                                    value={smeSearch}
                                    onChange={(event) => setSmeSearch(event.target.value)}
                                    placeholder="Search SME name"
                                    allowClear
                                    style={{ width: '100%' }}
                                />
                            </Col>
                            <Col xs={24} md={12} xl={3}>
                                <Button
                                    icon={<ReloadOutlined />}
                                    onClick={clearHoldUpFilters}
                                    block
                                >
                                    Reset
                                </Button>
                            </Col>
                        </Row>
                    }
                >
                    <Table
                        rowKey="key"
                        dataSource={filteredInterventionHoldUps}
                        columns={holdUpColumns as any}
                        loading={loading}
                        pagination={{
                            pageSize: 10,
                            showSizeChanger: false,
                            position: ['bottomCenter'],
                            showTotal: (total) =>
                                `${total} follow-up item${total === 1 ? '' : 's'}`,
                        }}
                        rowClassName={(row: InterventionHoldUp) =>
                            row.overdue ? 'rom-overdue-row' : ''
                        }
                        scroll={{ x: 1100, y: '55vh' }}
                    />
                </MotionCard>
            </Modal>

            {/*
                Overdue row highlight. Driven by custom properties rather than
                literals: this is a stylesheet rule with !important, so the global
                dark-mode remediation layer cannot reach it, and the original
                #fff1f0 stayed light while the table text went light with it —
                leaving overdue rows unreadable in dark mode.
            */}
            <style>{`
                :root {
                    --rom-overdue-bg: #fff1f0;
                    --rom-overdue-bg-hover: #ffccc7;
                }
                html[data-theme="dark"] {
                    --rom-overdue-bg: rgba(255, 77, 79, 0.16);
                    --rom-overdue-bg-hover: rgba(255, 77, 79, 0.28);
                }
                .rom-overdue-row > td {
                    background: var(--rom-overdue-bg) !important;
                }
                .rom-overdue-row:hover > td {
                    background: var(--rom-overdue-bg-hover) !important;
                }
            `}</style>
        </div>
    )
}

export default ROMDashboard
