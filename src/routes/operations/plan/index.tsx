import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet'
import {
    Alert,
    Badge,
    Button,
    Col,
    Empty,
    Grid,
    Input,
    message,
    Modal,
    Pagination,
    Popconfirm,
    Row,
    Segmented,
    Select,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography
} from 'antd'
import {
    MailOutlined,
    SearchOutlined,
    TeamOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    FileTextOutlined,
    ArrowRightOutlined,
    EyeOutlined,
    CheckOutlined,
    CloseOutlined
} from '@ant-design/icons'
import { auth, db } from '@/firebase'
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    updateDoc,
    orderBy,
    serverTimestamp,
    arrayUnion,
    Timestamp,
    onSnapshot
} from 'firebase/firestore'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { StatusPill } from '@/routes/operations/movs/movParts'
import '@/routes/operations/movs/movs.css'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DepartmentRoleKey, useDepartmentRoles } from '@/services/departmentRoles'
import { useNavigate } from 'react-router-dom'
import ConfirmedInterventionsModal from './confirmed'
import { roundBtn } from '@/components/shared/StyledButton'
import { countDeptInterventionsInPlan } from '@/utils/diagnosticPlanDeptInterventions'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import { functionsBaseUrl } from '@/firebaseConfig'

const { Text } = Typography
const { useBreakpoint } = Grid

type DeptConfirmValue =
    | boolean
    | {
        confirmed?: boolean
        departmentId?: string | null
        confirmedAt?: any
        confirmedBy?: string
    }

type SmmeConfirmValue =
    | boolean
    | {
        confirmed?: boolean
        departmentId?: string | null
        confirmedAt?: any
        confirmedBy?: string
    }

type DeptDoc = {
    id: string
    name: string
    parentDepartmentId?: string | null
    parentDeptId?: string | null
    parentId?: string | null
}

const toMillis = (v: any): number => {
    if (!v) return 0
    if (typeof v === 'number') return v
    if (v instanceof Date) return v.getTime()
    if (typeof v?.toMillis === 'function') return v.toMillis()
    if (typeof v?.seconds === 'number') return v.seconds * 1000
    return 0
}

function chunk<T>(arr: T[], size = 10): T[][] {
    const out: T[][] = []
    const step = Math.max(1, Math.floor(size))
    for (let i = 0; i < arr.length; i += step) out.push(arr.slice(i, i + step))
    return out
}

const isDeptConfirmedValue = (v: DeptConfirmValue | undefined): boolean => {
    if (v === true) return true
    if (v && typeof v === 'object' && v.confirmed === true) return true
    return false
}

const isSmmeConfirmedValue = (v: SmmeConfirmValue | undefined): boolean => {
    if (v === true) return true
    if (v && typeof v === 'object' && v.confirmed === true) return true
    return false
}

const getDeptConfirmMap = (plan: any) =>
    (plan?.confirmedByDeptId || {}) as Record<string, DeptConfirmValue>

const isDeptConfirmedForMe = (plan: any, deptId: string) =>
    !!deptId && isDeptConfirmedValue(getDeptConfirmMap(plan)[deptId])

const countConfirmedDeptTotal = (plan: any, confirmDeptIds: string[]) => {
    const byId = getDeptConfirmMap(plan)
    return confirmDeptIds.filter(id => isDeptConfirmedValue(byId[id])).length
}

// Merge, don't pick one: department saves always write smmeConfirmedByDeptId
// (often {}), which used to hide the SME's real sign-offs in the other map.
const getSmmeConfirmMap = (plan: any) =>
    ({
        ...(plan?.smmeConfirmedByDeptId || {}),
        ...(plan?.incubateeDepartmentConfirmationsByDeptId || {})
    }) as Record<string, SmmeConfirmValue>

const isSmmeConfirmedForMe = (plan: any, deptId: string) =>
    !!deptId && isSmmeConfirmedValue(getSmmeConfirmMap(plan)[deptId])

const countConfirmedSmmeTotal = (plan: any, confirmDeptIds: string[]) => {
    const byId = getSmmeConfirmMap(plan)
    return confirmDeptIds.filter(id => isSmmeConfirmedValue(byId[id])).length
}

/** Departments that sit outside the Developmental Plan confirmation chain. */
const SKIP_ROLES: DepartmentRoleKey[] = ['monitoring', 'inhouseFinance', 'rom', 'hr']

async function fetchApplicationRows(programId: string) {
    const qRef = query(
        collection(db, 'applications'),
        where('applicationStatus', '==', 'accepted'),
        where('programId', '==', programId)
    )

    const snap = await getDocs(qRef)
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
}

export type DpRow = {
    participantId: string
    beneficiaryName: string
    programName: string
    email?: string | null
    emailValid?: boolean

    deptStatus: 'Pending' | 'Confirmed'
    overallDeptStatus: 'Pending' | 'Confirmed'

    smmeStatus: 'Locked' | 'Pending' | 'Confirmed'
    isFinalisedForMe: boolean
    isFinalisedOverall: boolean

    submittedDeptCount: number
    requiredDeptCount: number | null

    submittedSmmeCount: number
    requiredSmmeCount: number | null

    devPlanUnlocked: boolean
    devPlanChangeStatus?: string | null
    devPlanChangeRequested?: boolean
    devPlanEditTargetRole?: string | null

    changeReason?: string | null
    requestedByDeptName?: string | null
    unlockedForDeptId?: string | null
    unlockedForDeptName?: string | null
    unlockedBy?: string | null
    unlockedAtMs?: number

    hasAnyPlan: boolean
    deptInterventionsCount?: number
    deptHasInterventions?: boolean

    childDeptStatuses?: Array<{
        deptId: string
        deptName: string
        deptConfirmed: boolean
        smmeConfirmed: boolean
        status: 'Department Pending' | 'SME Pending' | 'Finalised'
    }>

    holdUpDepts?: string[]
}

const niceError = (msg: any) => {
    const m = String(msg || '').trim()

    if (!m) return 'Something went wrong.'
    if (/Invalid participant email/i.test(m) || /invalid email/i.test(m)) {
        return 'This participant has an invalid email. Fix it in Applications before retrying.'
    }
    if (/suppressed/i.test(m)) {
        return 'This email previously bounced (invalid recipient). Update the participant email before retrying.'
    }
    if (/recently sent/i.test(m) || /too many requests/i.test(m) || /429/i.test(m)) {
        return 'A reminder was sent recently. Try again later.'
    }
    if (/Missing required fields/i.test(m)) {
        return 'Missing required data to send this reminder.'
    }
    if (/Participant email not found/i.test(m)) {
        return 'No email found for this participant. Add it in Applications.'
    }

    return m
}

const normalizeEmail = (v: any) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)

const DiagnosticPlanConfirmations: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const { activeProgramId } = useActiveProgramId()

    const [bootLoading, setBootLoading] = useState(true)
    const [listLoading, setListLoading] = useState(false)
    const [rowsReloadKey, setRowsReloadKey] = useState(0)

    const { roleOf, nameOf, departments, loading: rolesLoading } = useDepartmentRoles()
    const userDepartmentId = String((user as any)?.departmentId || '').trim()
    const userDepartment = userDepartmentId
        ? nameOf(userDepartmentId, String((user as any)?.departmentName || ''))
        : ''
    const userDepartmentRole = roleOf(userDepartmentId)

    const [confirmDeptIds, setConfirmDeptIds] = useState<string[]>([])
    const [deptIdToName, setDeptIdToName] = useState<Record<string, string>>({})

    const [parentDeptId, setParentDeptId] = useState<string>('')
    const [childDeptIdsOfParent, setChildDeptIdsOfParent] = useState<string[]>([])

    const [rows, setRows] = useState<DpRow[]>([])
    const [searchText, setSearchText] = useState('')
    /** One of STATUS_SEGMENTS' values; '' until the role is known (then the first segment). */
    const [statusFilter, setStatusFilter] = useState<string>('')
    const [listPage, setListPage] = useState(1)

    const [sendingReminders, setSendingReminders] = useState(false)
    const [sendingSmmeReminderPid, setSendingSmmeReminderPid] = useState<string | null>(null)
    const [sendingBatchSmme, setSendingBatchSmme] = useState(false)
    const [batchSmmeProgress, setBatchSmmeProgress] = useState({
        total: 0,
        done: 0
    })

    const [confirmedModalOpen, setConfirmedModalOpen] = useState(false)
    const [confirmedModalPid, setConfirmedModalPid] = useState<string | null>(null)

    const [hodReqLoading, setHodReqLoading] = useState(false)
    const [hodRequests, setHodRequests] = useState<any[]>([])
    const [hodRequestsModalOpen, setHodRequestsModalOpen] = useState(false)
    const [hodDecisionModalOpen, setHodDecisionModalOpen] = useState(false)
    const [hodSelectedReq, setHodSelectedReq] = useState<any | null>(null)
    const [hodDecisionNote, setHodDecisionNote] = useState('')
    const [resolvingReq, setResolvingReq] = useState(false)

    const [participantNameById, setParticipantNameById] = useState<Record<string, string>>({})

    const resolveDeptParentId = (d: DeptDoc) =>
        (d.parentDepartmentId ?? d.parentDeptId ?? d.parentId ?? null) as string | null

    const participantLabel = useCallback(
        (pid: any) => {
            const id = String(pid || '').trim()
            if (!id) return '—'
            return participantNameById[id] || id
        },
        [participantNameById]
    )

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    const isROM = userDepartmentRole === 'rom'

    const roleRaw = String(
        (user as any)?.role ||
        (user as any)?.userRole ||
        (user as any)?.position ||
        ''
    )
        .toLowerCase()
        .trim()

    const isHOD = roleRaw === 'operations'

    useEffect(() => {
        if (!identityLoading && !rolesLoading) setBootLoading(false)
    }, [identityLoading, rolesLoading])

    useEffect(() => {
        if (!userDepartmentId || rolesLoading) {
            setConfirmDeptIds([])
            setDeptIdToName({})
            setParentDeptId('')
            setChildDeptIdsOfParent([])
            return
        }

        const depts = departments as DeptDoc[]
        const idToName: Record<string, string> = {}
        depts.forEach(d => {
            idToName[d.id] = d.name
        })
        setDeptIdToName(idToName)

        const myDoc = depts.find(d => d.id === userDepartmentId) || null
        const myParentId = myDoc ? resolveDeptParentId(myDoc) : null
        const pId = myParentId && idToName[myParentId] ? myParentId : userDepartmentId
        setParentDeptId(pId)

        setChildDeptIdsOfParent(
            depts.filter(d => resolveDeptParentId(d) === pId).map(d => d.id)
        )

        setConfirmDeptIds(
            depts
                .filter(d => {
                    const role = roleOf(d.id)
                    return !role || !SKIP_ROLES.includes(role)
                })
                .map(d => d.id)
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userDepartmentId, departments, rolesLoading])

    const isParentDeptUser = useMemo(() => {
        if (!isHOD) return false
        if (!parentDeptId) return false
        if (parentDeptId !== userDepartmentId) return false

        return (childDeptIdsOfParent?.length || 0) > 0
    }, [
        isHOD,
        parentDeptId,
        userDepartmentId,
        childDeptIdsOfParent
    ])

    const canBuildOrEditPlans = !isROM && !isParentDeptUser
    const canSendSmmeReminders = !isROM && !isParentDeptUser
    const canSendDepartmentReminders = isROM
    const canReviewHodRequests = isHOD

    const guideRegistration = useMemo<PageGuideRegistration>(() => {
        const guides: PageGuideRegistration['guides'] = [
            {
                id: 'development-plan-confirmations-overview',
                title: 'Quick tour',
                description:
                    'Understand Development Plan confirmation progress, filters and the actions available to your role.',
                kind: 'page',
                order: 1,
                steps: [
                    {
                        element: guideTarget('dp-confirmation-metrics'),
                        popover: {
                            title: 'Confirmation metrics',
                            description:
                                'Track participants in scope, plans that are finalised, plans that still need action and pending DP requests.',
                            side: 'bottom',
                            align: 'start'
                        }
                    },
                    ...(canReviewHodRequests
                        ? [
                            {
                                element: guideTarget('dp-change-requests'),
                                waitForElement: 1200,
                                popover: {
                                    title: 'DP plan requests',
                                    description:
                                        'This metric shows coordinator requests waiting for HOD review. Select it to open the requests.',
                                    side: 'bottom' as const,
                                    align: 'start' as const
                                }
                            }
                        ]
                        : []),
                    {
                        element: guideTarget('dp-confirmation-filters'),
                        popover: {
                            title: 'Search and status filters',
                            description:
                                'Search by beneficiary and focus the table on the confirmation states relevant to your department.',
                            side: 'bottom',
                            align: 'start'
                        }
                    },
                    {
                        element: guideTarget('dp-confirmation-table'),
                        popover: {
                            title: 'Development Plans',
                            description:
                                'Review department confirmation, SME confirmation and the actions currently available for each participant.',
                            side: 'top',
                            align: 'start'
                        }
                    }
                ]
            }
        ]

        if (canBuildOrEditPlans) {
            guides.push({
                id: 'development-plan-build-edit',
                title: 'Build or edit a Development Plan',
                description:
                    'Open a participant Development Plan when your department is allowed to build or edit it.',
                kind: 'task',
                order: 2,
                steps: () => {
                    const hasVisibleBuildOrEdit =
                        typeof document !== 'undefined' &&
                        Boolean(
                            document.querySelector(
                                '[data-guide="dp-build-edit-action"]'
                            )
                        )

                    if (hasVisibleBuildOrEdit) {
                        return [
                            {
                                element: '[data-guide="dp-build-edit-action"]',
                                advanceOnClick: true,
                                popover: {
                                    title: 'Build or Edit',
                                    description:
                                        'Select Build or Edit. Guide Me will follow you into the Development Plan Builder.',
                                    side: 'left',
                                    align: 'center',
                                    showButtons: ['close']
                                }
                            },
                            {
                                element: guideTarget('dp-builder-header'),
                                waitForElement: 8000,
                                popover: {
                                    title: 'Development Plan Builder',
                                    description:
                                        'You are now in the builder for the selected SME.',
                                    side: 'bottom',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('dp-builder-steps'),
                                waitForElement: 5000,
                                popover: {
                                    title: 'Builder stages',
                                    description:
                                        'Work through the SME selections, department additions and confirmation stages shown here.',
                                    side: 'bottom',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('dp-builder-current-step'),
                                waitForElement: 5000,
                                popover: {
                                    title: 'Continue building',
                                    description:
                                        'Complete the current stage to continue building the Development Plan.',
                                    side: 'top',
                                    align: 'start'
                                }
                            }
                        ]
                    }

                    return [
                        {
                            element: guideTarget('dp-confirmation-table'),
                            popover: {
                                title: 'No Build/Edit action on this page',
                                description:
                                    'The currently visible rows are view-only or not editable by your department.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                }
            })
        }

        guides.push({
            id: 'development-plan-view',
            title: 'View a Development Plan',
            description:
                'Open a participant’s confirmed Development Plan and review the interventions available to your current scope.',
            kind: 'task',
            order: 3,
            steps: () => {
                const hasVisibleView =
                    typeof document !== 'undefined' &&
                    Boolean(
                        document.querySelector(
                            '[data-guide="dp-view-plan-action"]'
                        )
                    )

                if (hasVisibleView) {
                    return [
                        {
                            element: '[data-guide="dp-view-plan-action"]',
                            popover: {
                                title: 'View Development Plan',
                                description:
                                    'Select View to open the participant’s confirmed Development Plan.',
                                side: 'left',
                                align: 'center'
                            }
                        }
                    ]
                }

                return [
                    {
                        element: guideTarget('dp-confirmation-table'),
                        popover: {
                            title: 'No View action on this page',
                            description:
                                'A View button appears when a participant has a plan that your current role and department are allowed to review.',
                            side: 'top',
                            align: 'start'
                        }
                    }
                ]
            }
        })

        if (canSendSmmeReminders) {
            guides.push({
                id: 'development-plan-sme-reminders',
                title: 'Send SME reminders',
                description:
                    'Remind SMEs whose department plan is confirmed but whose SME confirmation is still pending.',
                kind: 'task',
                order: 4,
                steps: [
                    {
                        element: '[data-guide="dp-sme-reminder-action"]',
                        waitForElement: 1200,
                        skipMissingElement: true,
                        popover: {
                            title: 'Remind one SME',
                            description:
                                'This action appears when your department is confirmed and the SME is still pending.',
                            side: 'left',
                            align: 'center'
                        }
                    },
                    {
                        element: guideTarget('dp-batch-sme-reminders'),
                        waitForElement: 1200,
                        skipMissingElement: true,
                        popover: {
                            title: 'Remind SMEs in batch',
                            description:
                                'When two or more visible SMEs are waiting for confirmation, send reminders in one batch.',
                            side: 'bottom',
                            align: 'end'
                        }
                    }
                ]
            })
        }

        if (canSendDepartmentReminders) {
            guides.push({
                id: 'development-plan-department-reminders',
                title: 'Send department reminders',
                description:
                    'ROM can remind departments that have not yet confirmed their Development Plans.',
                kind: 'task',
                order: 5,
                steps: [
                    {
                        element: guideTarget('dp-department-reminders'),
                        waitForElement: 1500,
                        popover: {
                            title: 'Department reminders',
                            description:
                                'Send reminders to departments that still need to submit or confirm their Development Plan work.',
                            side: 'bottom',
                            align: 'end'
                        }
                    }
                ]
            })
        }

        if (canReviewHodRequests) {
            const hasRequests = hodRequests.length > 0

            guides.push({
                id: 'development-plan-change-requests',
                title: 'Review DP change requests',
                description:
                    'Review coordinator requests to unlock a Development Plan for editing.',
                kind: 'task',
                order: 6,
                steps: hasRequests
                    ? [
                        {
                            element: guideTarget('dp-change-requests'),
                            waitForElement: 1500,
                            advanceOnClick: true,
                            popover: {
                                title: 'Pending change requests',
                                description:
                                    'This metric shows how many Development Plan edit requests are waiting for HOD review. Select it to open the request list.',
                                side: 'bottom',
                                align: 'start',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-dp-change-requests-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'DP Plan Requests',
                                description:
                                    'Review the participant, requesting department and reason before opening a request for a decision.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="dp-change-request-action"]',
                            waitForElement: 1500,
                            advanceOnClick: true,
                            popover: {
                                title: 'View and decide',
                                description:
                                    'Open a request to review its reason and decide whether the plan should be unlocked.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-dp-change-request-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Change request decision',
                                description:
                                    'Approving unlocks the plan for the requesting department. Rejecting keeps it locked.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('dp-change-request-note'),
                            waitForElement: 1500,
                            popover: {
                                title: 'Decision note',
                                description:
                                    'Add an optional note explaining the approval or rejection.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('dp-change-request-actions'),
                            waitForElement: 1500,
                            popover: {
                                title: 'Approve or reject',
                                description:
                                    'Reject keeps the plan locked. Approve & Unlock enables editing for the requesting department.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                    : [
                        {
                            element: guideTarget('dp-change-requests'),
                            waitForElement: 1500,
                            popover: {
                                title: 'DP change requests',
                                description:
                                    'This metric shows pending coordinator edit requests. There are no requests waiting for HOD review right now.',
                                side: 'bottom',
                                align: 'start'
                            }
                        }
                    ]
            })
        }

        if (isParentDeptUser) {
            guides.push({
                id: 'development-plan-parent-status',
                title: 'Review child department progress',
                description:
                    'See which child departments or SMEs are holding up Development Plan finalisation.',
                kind: 'task',
                order: 7,
                steps: [
                    {
                        element: guideTarget('dp-confirmation-table'),
                        popover: {
                            title: 'Child department status',
                            description:
                                'Parent HODs see each child department as Department Pending, SME Pending or Finalised.',
                            side: 'top',
                            align: 'start'
                        }
                    },
                    {
                        element: '[data-guide="dp-view-plan-action"]',
                        waitForElement: 1200,
                        skipMissingElement: true,
                        popover: {
                            title: 'View confirmed interventions',
                            description:
                                'Open the participant view to inspect confirmed interventions across the parent department scope.',
                            side: 'left',
                            align: 'center'
                        }
                    }
                ]
            })
        }

        return {
            pageId: 'development-plan-confirmations',
            pageTitle: 'Development Plans',
            guides
        }
    }, [
        canBuildOrEditPlans,
        canReviewHodRequests,
        canSendDepartmentReminders,
        canSendSmmeReminders,
        hodRequests.length,
        isParentDeptUser
    ])

    usePageGuides(guideRegistration)

    const FUNCTIONS_BASE = functionsBaseUrl

    const callFunction = async (path: string, payload: any) => {
        const currentUser = auth.currentUser
        if (!currentUser) throw new Error('You must be logged in')

        const idToken = await currentUser.getIdToken()

        const res = await fetch(`${FUNCTIONS_BASE}/${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify(payload)
        })

        const data = await res.json().catch(() => ({}))

        if (!res.ok || data?.ok === false) {
            throw new Error(data?.error || `Failed calling ${path}`)
        }

        return data
    }

    const handleSendDeptReminders = async () => {
        try {
            setSendingReminders(true)

            const currentUser = auth.currentUser
            if (!currentUser) {
                throw new Error('You must be logged in to send reminders')
            }

            const idToken = await currentUser.getIdToken()

            const res = await fetch(`${FUNCTIONS_BASE}/sendDevPlanReminders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    mode: 'departments',
                    programId: activeProgramId || null
                })
            })

            const data = await res.json().catch(() => ({}))

            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'Failed to send reminders')
            }

            message.success(`Reminders sent to ${data.sent || 0} recipient(s).`)
        } catch (err: any) {
            console.error(err)
            message.error(niceError(err?.message))
        } finally {
            setSendingReminders(false)
        }
    }

    const handleSendSmmeReminder = async (
        participantId: string,
        row?: DpRow
    ) => {
        if (row?.emailValid === false) {
            message.error(
                'This participant has an invalid email. Fix it in Applications before sending a reminder.'
            )
            return
        }

        if (!row?.email) {
            message.error(
                'No email found for this participant. Add it in Applications before sending a reminder.'
            )
            return
        }

        try {
            setSendingSmmeReminderPid(participantId)

            const submittedCount = Number(row?.submittedDeptCount ?? 0)
            const totalCount = Number(
                row?.requiredDeptCount ?? confirmDeptIds.length ?? 0
            )

            await callFunction('remindSmmeDpConfirmation', {
                programId: activeProgramId || null,
                participantId,
                reminderFromDeptId: userDepartmentId || null,
                reminderFromDeptName: userDepartment || null,
                submittedCount,
                totalCount
            })

            message.success('SME reminder sent.')
        } catch (err: any) {
            console.error(err)
            message.error(niceError(err?.message))
        } finally {
            setSendingSmmeReminderPid(null)
        }
    }

    const fetchHodRequests = useCallback(async () => {
        if (!isHOD || !activeProgramId) {
            setHodRequests([])
            return
        }

        const hodDeptId = userDepartmentId || parentDeptId

        if (!hodDeptId) {
            setHodRequests([])
            return
        }

        setHodReqLoading(true)

        try {
            const snap = await getDocs(
                query(
                    collection(db, 'dpChangeRequests'),
                    where('programId', '==', activeProgramId),
                    where('hodDeptId', '==', hodDeptId),
                    where('status', '==', 'pending'),
                    orderBy('createdAt', 'desc')
                )
            )

            setHodRequests(
                snap.docs
                    .map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    }))
                    .filter(
                        request =>
                            String(request?.requestedByRole || '').toLowerCase() ===
                            'coordinator'
                    )
            )
        } catch (e) {
            console.error('[HOD Requests] failed to load', e)
            setHodRequests([])
        } finally {
            setHodReqLoading(false)
        }
    }, [
        isHOD,
        activeProgramId,
        userDepartmentId,
        parentDeptId
    ])

    useEffect(() => {
        if (!isHOD) return
        void fetchHodRequests()
    }, [isHOD, fetchHodRequests])

    const fetchRows = useCallback(async () => {
        if (!activeProgramId) {
            setRows([])
            return
        }

        setListLoading(true)

        try {
            const apps = await fetchApplicationRows(activeProgramId)

            const base = apps
                .filter(a => !!(a as any).participantId)
                .map(a => {
                    const raw =
                        (a as any).email ||
                        (a as any).applicantEmail ||
                        (a as any).participantEmail ||
                        ''

                    const email = normalizeEmail(raw)

                    return {
                        participantId: String((a as any).participantId),
                        beneficiaryName:
                            (a as any).beneficiaryName ||
                            (a as any).participantName ||
                            '',
                        programName:
                            (a as any).programName ||
                            (a as any)?.program?.name ||
                            '',
                        email,
                        emailValid: !!email && isValidEmail(email)
                    }
                })

            const nameMap: Record<string, string> = {}

            base.forEach(b => {
                const pid = String(b.participantId || '').trim()
                const name = String(b.beneficiaryName || '').trim()

                if (pid && name) nameMap[pid] = name
            })

            setParticipantNameById(nameMap)

            if (!base.length) {
                setRows([])
                return
            }

            const latestByPid = new Map<
                string,
                {
                    createdAt: number
                    final: boolean
                }
            >()

            const planByPid = new Map<string, any>()

            for (const ids of chunk(
                base.map(b => b.participantId),
                10
            )) {
                const plansSnap = await getDocs(
                    query(
                        collection(db, 'diagnosticPlans'),
                        where('participantId', 'in', ids)
                    )
                )

                plansSnap.docs.forEach(docSnap => {
                    const data = docSnap.data() as any
                    const pid = String(data.participantId || '')

                    if (!pid) return

                    const planProgramId =
                        String(data.programId || '') ||
                        String(data?.program?.id || '') ||
                        ''

                    if (
                        planProgramId &&
                        planProgramId !== activeProgramId
                    ) {
                        return
                    }

                    const created = toMillis(data.createdAt)
                    const final = data.finalConfirmation === true
                    const prev = latestByPid.get(pid)

                    if (!prev || created > prev.createdAt) {
                        latestByPid.set(pid, {
                            createdAt: created,
                            final
                        })
                        planByPid.set(pid, {
                            ...data,
                            __docId: docSnap.id
                        })
                    }
                })
            }

            const effectiveTotal = confirmDeptIds.length
                ? confirmDeptIds.length
                : null

            const list: DpRow[] = base.map(b => {
                const latest = latestByPid.get(b.participantId)
                const plan = planByPid.get(b.participantId) as any | undefined

                const edit = plan?.devPlanEdit || {}

                const unlockedForDeptId = String(
                    edit?.unlockedForDeptId || ''
                )
                const unlockedForDeptName = String(
                    edit?.unlockedForDeptName || ''
                )

                const matchesDeptId =
                    !!userDepartmentId &&
                    !!unlockedForDeptId &&
                    unlockedForDeptId === String(userDepartmentId)

                const devPlanUnlocked =
                    edit?.unlocked === true && matchesDeptId

                const devPlanChangeStatus = String(
                    edit?.changeRequestStatus || ''
                )
                const devPlanChangeRequested =
                    edit?.changeRequested === true
                const devPlanEditTargetRole = edit?.targetRole
                    ? String(edit.targetRole)
                    : null

                const changeReason = edit?.changeRequestReason
                    ? String(edit.changeRequestReason)
                    : null

                const requestedByDeptName =
                    edit?.changeRequestedByDeptName
                        ? String(edit.changeRequestedByDeptName)
                        : null

                const unlockedBy = edit?.unlockedBy
                    ? String(edit.unlockedBy)
                    : null

                const unlockedAtMs = toMillis(edit?.unlockedAt)
                const final = !!latest?.final
                const hasAnyPlan = !!plan

                const submittedDeptCount = plan
                    ? countConfirmedDeptTotal(plan, confirmDeptIds)
                    : 0

                const submittedSmmeCount = plan
                    ? countConfirmedSmmeTotal(plan, confirmDeptIds)
                    : 0

                const isSkipDeptForThisUser =
                    !isROM &&
                    !!userDepartmentRole &&
                    SKIP_ROLES.includes(userDepartmentRole)

                const deptConfirmedForMe =
                    isSkipDeptForThisUser ||
                    (plan ? isDeptConfirmedForMe(plan, userDepartmentId) : false)

                const deptAllConfirmed =
                    typeof effectiveTotal === 'number' &&
                        effectiveTotal > 0
                        ? submittedDeptCount >= effectiveTotal
                        : false

                const deptStatus: 'Pending' | 'Confirmed' =
                    deptConfirmedForMe || final
                        ? 'Confirmed'
                        : 'Pending'

                const overallDeptStatus: 'Pending' | 'Confirmed' =
                    deptAllConfirmed || final
                        ? 'Confirmed'
                        : 'Pending'

                const smmeConfirmedForMe =
                    plan ? isSmmeConfirmedForMe(plan, userDepartmentId) : false

                const smmeAllConfirmed =
                    typeof effectiveTotal === 'number' &&
                        effectiveTotal > 0
                        ? submittedSmmeCount >= effectiveTotal
                        : false

                const smmeStatus:
                    | 'Locked'
                    | 'Pending'
                    | 'Confirmed' =
                    deptStatus === 'Confirmed' || final
                        ? smmeConfirmedForMe
                            ? 'Confirmed'
                            : 'Pending'
                        : 'Locked'

                const isFinalisedForMe =
                    deptStatus === 'Confirmed' &&
                    smmeStatus === 'Confirmed'

                // ROM's Finalise (finalConfirmation) settles the plan, as the plan view shows it.
                const isFinalisedOverall =
                    final || (deptAllConfirmed && smmeAllConfirmed)

                let deptInterventionsCount = 0
                let deptHasInterventions = false

                if (plan) {
                    const deptIdsForScope = isROM
                        ? confirmDeptIds
                        : isParentDeptUser
                            ? (childDeptIdsOfParent || []).filter(
                                id => id && id !== userDepartmentId
                            )
                            : [userDepartmentId]

                    const res = countDeptInterventionsInPlan(
                        plan,
                        deptIdsForScope,
                        {
                            requireConfirmedOnly: true
                        }
                    )

                    deptInterventionsCount = res.count
                    deptHasInterventions = res.hasInterventions
                }

                let childDeptStatuses: DpRow['childDeptStatuses'] = []
                let holdUpDepts: string[] = []

                if (plan && isParentDeptUser) {
                    const childIds = (
                        childDeptIdsOfParent || []
                    ).filter(
                        id => id && id !== userDepartmentId
                    )

                    childDeptStatuses = childIds.map(cid => {
                        const cname = deptIdToName[cid] || cid

                        const deptConfirmed = isDeptConfirmedForMe(plan, cid)
                        const smmeConfirmed = isSmmeConfirmedForMe(plan, cid)

                        const status:
                            | 'Department Pending'
                            | 'SME Pending'
                            | 'Finalised' =
                            !deptConfirmed
                                ? 'Department Pending'
                                : !smmeConfirmed
                                    ? 'SME Pending'
                                    : 'Finalised'

                        return {
                            deptId: cid,
                            deptName: cname,
                            deptConfirmed,
                            smmeConfirmed,
                            status
                        }
                    })

                    holdUpDepts = childDeptStatuses
                        .filter(x => x.status !== 'Finalised')
                        .map(x => x.deptName)
                }

                return {
                    participantId: b.participantId,
                    beneficiaryName: b.beneficiaryName,
                    programName: b.programName,
                    email: b.email,
                    emailValid: b.emailValid,
                    deptStatus,
                    overallDeptStatus,
                    smmeStatus,
                    isFinalisedForMe,
                    isFinalisedOverall,
                    submittedDeptCount,
                    requiredDeptCount: effectiveTotal,
                    submittedSmmeCount,
                    requiredSmmeCount: effectiveTotal,
                    childDeptStatuses,
                    holdUpDepts,
                    devPlanUnlocked,
                    devPlanChangeStatus,
                    devPlanChangeRequested,
                    devPlanEditTargetRole,
                    unlockedForDeptId:
                        unlockedForDeptId || null,
                    unlockedForDeptName:
                        unlockedForDeptName || null,
                    changeReason,
                    requestedByDeptName,
                    unlockedBy,
                    unlockedAtMs,
                    deptInterventionsCount,
                    deptHasInterventions,
                    hasAnyPlan
                }
            })

            list.sort((a, b) => {
                const aDeptPending =
                    a.deptStatus === 'Pending' ? 1 : 0
                const bDeptPending =
                    b.deptStatus === 'Pending' ? 1 : 0

                if (aDeptPending !== bDeptPending) {
                    return bDeptPending - aDeptPending
                }

                const aSmmePending =
                    a.smmeStatus === 'Pending' ? 1 : 0
                const bSmmePending =
                    b.smmeStatus === 'Pending' ? 1 : 0

                if (aSmmePending !== bSmmePending) {
                    return bSmmePending - aSmmePending
                }

                return String(
                    a.beneficiaryName || ''
                ).localeCompare(
                    String(b.beneficiaryName || ''),
                    undefined,
                    {
                        sensitivity: 'base'
                    }
                )
            })

            setRows(list)

        } catch (e) {
            console.error('fetchRows failed', e)
            setRows([])
        } finally {
            setListLoading(false)
        }
    }, [
        activeProgramId,
        confirmDeptIds,
        deptIdToName,
        userDepartmentId,
        userDepartmentRole,
        isParentDeptUser,
        childDeptIdsOfParent,
        isROM
    ])

    useEffect(() => {
        if (!activeProgramId || !confirmDeptIds.length) {
            setRows([])
            return
        }

        let unsubscribers: Array<() => void> = []
        let cancelled = false

        const setup = async () => {
            setListLoading(true)

            try {
                const apps = await fetchApplicationRows(activeProgramId)

                if (cancelled) return

                const participantIds = apps
                    .map(a => String((a as any).participantId || ''))
                    .filter(Boolean)

                if (!participantIds.length) {
                    await fetchRows()
                    return
                }

                const rebuild = async () => {
                    if (cancelled) return
                    await fetchRows()
                }

                unsubscribers = chunk(
                    participantIds,
                    10
                ).map(ids => {
                    const qRef = query(
                        collection(db, 'diagnosticPlans'),
                        where('participantId', 'in', ids)
                    )

                    return onSnapshot(
                        qRef,
                        async () => {
                            await rebuild()
                        },
                        err => {
                            console.error(
                                '[DP Confirmations] diagnosticPlans snapshot failed',
                                err
                            )
                        }
                    )
                })

                await rebuild()
            } catch (e) {
                console.error(
                    '[DP Confirmations] realtime setup failed',
                    e
                )

                setRows([])
            } finally {
                if (!cancelled) {
                    setListLoading(false)
                }
            }
        }

        void setup()

        return () => {
            cancelled = true
            unsubscribers.forEach(fn => fn())
        }
    }, [
        activeProgramId,
        confirmDeptIds,
        fetchRows,
        rowsReloadKey
    ])

    const resolveHodRequest = useCallback(
        async (decision: 'approved' | 'rejected') => {
            if (!isHOD) {
                message.error(
                    'Only an HOD can resolve edit requests.'
                )
                return
            }

            if (!hodSelectedReq?.id) return

            if (
                String(
                    hodSelectedReq?.requestedByRole || ''
                ).toLowerCase() !== 'coordinator'
            ) {
                message.error(
                    'This is not a coordinator edit request.'
                )
                return
            }

            const reqId = String(hodSelectedReq.id)
            const planId = String(
                hodSelectedReq?.diagnosticPlanDocId || ''
            )

            if (!planId) {
                message.error(
                    'Request missing diagnosticPlanDocId.'
                )
                return
            }

            const who =
                user?.email ||
                user?.uid ||
                auth.currentUser?.email ||
                auth.currentUser?.uid ||
                'unknown'

            const note = hodDecisionNote.trim()
            const reason = String(
                hodSelectedReq?.reason || ''
            ).trim()

            setResolvingReq(true)

            try {
                await updateDoc(
                    doc(db, 'dpChangeRequests', reqId),
                    {
                        status: decision,
                        resolvedAt: serverTimestamp(),
                        resolvedBy: who,
                        resolvedNote: note || null,
                        auditTrail: arrayUnion({
                            action: decision,
                            actor: who,
                            actorRole: roleRaw || null,
                            actorDeptId:
                                userDepartmentId || null,
                            actorDeptName:
                                userDepartment || null,
                            note: note || null,
                            createdAt: Timestamp.now()
                        })
                    }
                )

                if (decision === 'approved') {
                    const unlockForDeptId = String(
                        hodSelectedReq?.requestedByDeptId ||
                        hodSelectedReq?.unlockedForDeptId ||
                        ''
                    )

                    const unlockForDeptName = String(
                        hodSelectedReq?.requestedByDeptName ||
                        hodSelectedReq?.unlockedForDeptName ||
                        ''
                    )

                    await updateDoc(
                        doc(db, 'diagnosticPlans', planId),
                        {
                            'devPlanEdit.unlocked': true,
                            'devPlanEdit.unlockedAt':
                                serverTimestamp(),
                            'devPlanEdit.unlockedBy': who,
                            'devPlanEdit.unlockedReason':
                                reason || null,
                            'devPlanEdit.unlockedForDeptId':
                                unlockForDeptId || null,
                            'devPlanEdit.unlockedForDeptName':
                                unlockForDeptName || null,
                            'devPlanEdit.changeRequestStatus':
                                'approved',
                            'devPlanEdit.changeRequested': false,
                            'devPlanEdit.changeRequestResolvedAt':
                                serverTimestamp(),
                            'devPlanEdit.changeRequestResolvedBy':
                                who,
                            'devPlanEdit.changeRequestResolutionNote':
                                note || null
                        }
                    )
                } else {
                    await updateDoc(
                        doc(db, 'diagnosticPlans', planId),
                        {
                            'devPlanEdit.changeRequestStatus':
                                'rejected',
                            'devPlanEdit.changeRequested': false,
                            'devPlanEdit.changeRequestResolvedAt':
                                serverTimestamp(),
                            'devPlanEdit.changeRequestResolvedBy':
                                who,
                            'devPlanEdit.changeRequestResolutionNote':
                                note || null
                        }
                    )
                }

                message.success(`Request ${decision}.`)

                setHodDecisionModalOpen(false)
                setHodSelectedReq(null)
                setHodDecisionNote('')
                setRowsReloadKey(k => k + 1)

                // rowsReloadKey above already reloads the rows.
                setHodRequests(prev =>
                    prev.filter(r => r.id !== reqId)
                )
            } catch (e: any) {
                console.error(e)
                message.error(
                    e?.message ||
                    'Failed to resolve request.'
                )
            } finally {
                setResolvingReq(false)
            }
        },
        [
            hodSelectedReq,
            hodDecisionNote,
            isHOD,
            user,
            roleRaw,
            userDepartmentId,
            userDepartment,
            fetchRows
        ]
    )

    /**
     * What each row needs, in words. One rule per role:
     * - a delivering department: build its plan, then wait for the SME;
     * - ROM: wait for every department, then every SME, then it's finalised;
     * - a parent department: watch its child departments for hold-ups.
     */
    const stageOf = useCallback(
        (r: DpRow): 'build' | 'departments' | 'sme' | 'done' => {
            if (isParentDeptUser) return (r.childDeptStatuses || []).length > 0 && (r.holdUpDepts || []).length === 0 ? 'done' : 'departments'
            if (isROM) return r.isFinalisedOverall ? 'done' : r.overallDeptStatus === 'Confirmed' ? 'sme' : 'departments'
            if (r.devPlanUnlocked || r.deptStatus === 'Pending') return 'build'
            return r.isFinalisedForMe ? 'done' : 'sme'
        },
        [isROM, isParentDeptUser]
    )

    const STATUS_SEGMENTS = useMemo(
        () =>
            isParentDeptUser
                ? [
                    { value: 'departments', label: 'Hold-ups', tone: 'warning' },
                    { value: 'done', label: 'Done', tone: 'success' },
                    { value: 'all', label: 'All', tone: 'neutral' }
                ]
                : isROM
                    ? [
                        { value: 'departments', label: 'Waiting on departments', tone: 'warning' },
                        { value: 'sme', label: 'Waiting on SME', tone: 'info' },
                        { value: 'done', label: 'Finalised', tone: 'success' },
                        { value: 'all', label: 'All', tone: 'neutral' }
                    ]
                    : [
                        { value: 'build', label: 'Needs your plan', tone: 'warning' },
                        { value: 'sme', label: 'Waiting on SME', tone: 'info' },
                        { value: 'done', label: 'Done', tone: 'success' },
                        { value: 'all', label: 'All', tone: 'neutral' }
                    ],
        [isROM, isParentDeptUser]
    )
    const activeStatus = STATUS_SEGMENTS.some(segment => segment.value === statusFilter)
        ? statusFilter
        : STATUS_SEGMENTS[0].value

    const searchedRows = useMemo(() => {
        const q = searchText.trim().toLowerCase()
        return q
            ? rows.filter(r => `${r.beneficiaryName || ''} ${r.email || ''}`.toLowerCase().includes(q))
            : rows
    }, [rows, searchText])

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { all: searchedRows.length }
        for (const r of searchedRows) {
            const stage = stageOf(r)
            counts[stage] = (counts[stage] || 0) + 1
        }
        return counts
    }, [searchedRows, stageOf])

    const filteredRows = useMemo(
        () => (activeStatus === 'all' ? searchedRows : searchedRows.filter(r => stageOf(r) === activeStatus)),
        [searchedRows, activeStatus, stageOf]
    )

    useEffect(() => setListPage(1), [activeStatus, searchText])

    const batchSmmeTargets = useMemo(() => {
        const canRemind = (r: DpRow) =>
            r.deptStatus === 'Confirmed' &&
            r.smmeStatus === 'Pending' &&
            !r.isFinalisedForMe

        return filteredRows.filter(canRemind)
    }, [filteredRows])

    const canBatchRemindSmme =
        batchSmmeTargets.length >= 2

    const handleSendBatchSmmeReminders = async () => {
        try {
            setSendingBatchSmme(true)

            setBatchSmmeProgress({
                total: batchSmmeTargets.length,
                done: 0
            })

            let done = 0
            let failed = 0

            for (const row of batchSmmeTargets) {
                if (!row.email || row.emailValid === false) {
                    failed++
                    continue
                }

                try {
                    await callFunction(
                        'remindSmmeDpConfirmation',
                        {
                            programId: activeProgramId,
                            participantId:
                                row.participantId,
                            reminderFromDeptId:
                                userDepartmentId,
                            reminderFromDeptName:
                                userDepartment,
                            submittedCount:
                                row.submittedDeptCount,
                            totalCount:
                                row.requiredDeptCount
                        }
                    )

                    done++

                    setBatchSmmeProgress({
                        total: batchSmmeTargets.length,
                        done
                    })
                } catch (e: any) {
                    failed++
                    console.error(
                        'Batch reminder failed for',
                        row.participantId,
                        e?.message
                    )
                }

                await sleep(1200)
            }

            if (failed > 0) {
                message.warning(
                    `Sent ${done} SME reminder${done === 1 ? '' : 's'
                    }; ${failed} failed or had no valid email.`
                )
            } else {
                message.success(
                    `Sent SME reminders to ${done} participants.`
                )
            }
        } catch (err: any) {
            console.error(err)
            message.error(niceError(err?.message))
        } finally {
            setSendingBatchSmme(false)
        }
    }

    const BUILD_ROUTE = '/operations/diagnostic-plan'

    const goBuild = useCallback(
        (participantId: string) => {
            navigate(
                `${BUILD_ROUTE}?participantId=${encodeURIComponent(
                    participantId
                )}`
            )
        },
        [navigate]
    )

    const openConfirmedModal = useCallback(
        (participantId: string) => {
            setConfirmedModalPid(participantId)
            setConfirmedModalOpen(true)
        },
        []
    )

    const closeConfirmedModal = useCallback(() => {
        setConfirmedModalOpen(false)
        setConfirmedModalPid(null)
    }, [])

    if (bootLoading) {
        return (
            <div
                style={{
                    padding: isMobile ? 12 : 24,
                    minHeight: '100vh'
                }}
            >
                <PageSkeleton variant='list' />
            </div>
        )
    }

    if (!activeProgramId) {
        return (
            <div
                style={{
                    padding: isMobile ? 12 : 24,
                    minHeight: '100vh'
                }}
            >
                <MotionCard>
                    <Alert
                        type="info"
                        showIcon
                        message="Select a program"
                        description="This page works with one active program. Choose a specific program from the global program filter."
                    />
                </MotionCard>
            </div>
        )
    }

    const LIST_PAGE_SIZE = 12
    const pageRows = filteredRows.slice((listPage - 1) * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE)

    const STAGE_PILL: Record<string, { tone: string; label: string }> = {
        build: { tone: 'warning', label: 'Needs your plan' },
        departments: { tone: 'warning', label: isParentDeptUser ? 'Hold-up' : 'Departments pending' },
        sme: { tone: 'info', label: 'Waiting on SME' },
        done: { tone: 'success', label: isROM ? 'Finalised' : 'Done' }
    }

    /** One line of context per row, in the words of the row's stage. */
    const metaOf = (r: DpRow) => {
        const parts: string[] = []
        if (isParentDeptUser) {
            const items = r.childDeptStatuses || []
            const done = items.filter(x => x.status === 'Finalised').length
            parts.push(items.length ? `${done} of ${items.length} departments done` : 'No departments yet')
        } else if (isROM) {
            parts.push(`${r.submittedDeptCount || 0} of ${r.requiredDeptCount ?? '–'} departments`)
            parts.push(`${r.submittedSmmeCount || 0} of ${r.requiredSmmeCount ?? '–'} SME sign-offs`)
        } else if (r.deptStatus === 'Confirmed' && typeof r.deptInterventionsCount === 'number') {
            parts.push(`${r.deptInterventionsCount} intervention${r.deptInterventionsCount === 1 ? '' : 's'}`)
        }
        if (!r.email) parts.push('No email')
        return parts.join(' · ')
    }

    /** The one thing to do on a row: build or edit, remind the SME, or view. */
    const actionOf = (r: DpRow) => {
        const stage = stageOf(r)
        if (stage === 'build' && !isROM && !isParentDeptUser) {
            return (
                <Button
                    data-guide="dp-build-edit-action"
                    type="primary"
                    size="small"
                    shape="round"
                    icon={<ArrowRightOutlined />}
                    iconPosition="end"
                    onClick={() => goBuild(r.participantId)}
                >
                    {r.hasAnyPlan && r.devPlanUnlocked ? 'Edit plan' : 'Build plan'}
                </Button>
            )
        }
        const canRemind = stage === 'sme' && !isROM && !isParentDeptUser && !!r.email && r.emailValid !== false
        return (
            <Space size={6}>
                {canRemind && (
                    <Popconfirm
                        title="Remind the SME?"
                        description="Emails the SME to confirm your department's plan."
                        okText="Send"
                        onConfirm={() => handleSendSmmeReminder(r.participantId, r)}
                    >
                        <Button
                            data-guide="dp-sme-reminder-action"
                            size="small"
                            shape="round"
                            icon={<MailOutlined />}
                            loading={sendingSmmeReminderPid === r.participantId}
                        >
                            Remind
                        </Button>
                    </Popconfirm>
                )}
                {(r.hasAnyPlan || isROM || isParentDeptUser) && (
                    <Button
                        data-guide="dp-view-plan-action"
                        size="small"
                        shape="round"
                        onClick={() => openConfirmedModal(r.participantId)}
                    >
                        View
                    </Button>
                )}
            </Space>
        )
    }

    return (
        <div className="ws-page">
            <Helmet>
                <title>
                    Development Plans | Smart Incubation
                </title>
                <meta
                    name="description"
                    content="Track departmental and SME confirmations for Development Plans."
                />
            </Helmet>

            <DashboardFilterBar>
                <div className="ws-toolbar" data-guide="dp-confirmation-filters">
                    <Segmented
                        data-guide="dp-confirmation-metrics"
                        className="ws-toolbar-status mv-status-strip"
                        block
                        value={activeStatus}
                        onChange={value => setStatusFilter(String(value))}
                        aria-label="Filter by status"
                        options={STATUS_SEGMENTS.map(segment => ({
                            value: segment.value,
                            label: (
                                <span className="mv-seg">
                                    {segment.label}
                                    {!listLoading && (
                                        <span className={`mv-seg-count qtx-tone-${segment.tone}`}>
                                            {statusCounts[segment.value] || 0}
                                        </span>
                                    )}
                                </span>
                            )
                        }))}
                    />
                    <Input
                        className="ws-toolbar-search"
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="Search SME or email"
                        aria-label="Search SMEs"
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                    />
                    {isHOD && (
                        <Badge className="ws-toolbar-button" count={hodRequests.length} size="small" offset={[-6, 4]}>
                            <Button
                                data-guide="dp-change-requests"
                                block
                                icon={<FileTextOutlined />}
                                loading={hodReqLoading}
                                onClick={() => {
                                    setHodRequestsModalOpen(true)
                                    void fetchHodRequests()
                                }}
                            >
                                Edit requests
                            </Button>
                        </Badge>
                    )}
                    {!isROM && !isParentDeptUser && canBatchRemindSmme && (
                        <Popconfirm
                            title="Remind SMEs?"
                            description={`Emails the ${batchSmmeTargets.length} SMEs who haven't confirmed your department's plan.`}
                            onConfirm={handleSendBatchSmmeReminders}
                            okText="Send"
                        >
                            <Button
                                className="ws-toolbar-button"
                                data-guide="dp-batch-sme-reminders"
                                icon={<MailOutlined />}
                                loading={sendingBatchSmme}
                            >
                                Remind SMEs
                            </Button>
                        </Popconfirm>
                    )}
                    {isROM && (
                        <Popconfirm
                            title="Remind departments?"
                            description="Emails every department that hasn't confirmed its plans."
                            onConfirm={handleSendDeptReminders}
                            okText="Send"
                        >
                            <Button
                                className="ws-toolbar-button"
                                data-guide="dp-department-reminders"
                                icon={<MailOutlined />}
                                loading={sendingReminders}
                            >
                                Remind departments
                            </Button>
                        </Popconfirm>
                    )}
                </div>
            </DashboardFilterBar>

            {sendingBatchSmme && batchSmmeProgress.total > 0 && (
                <Alert
                    type="info"
                    showIcon
                    message={`Sending SME reminders… ${batchSmmeProgress.done} of ${batchSmmeProgress.total}`}
                    style={{ marginBottom: 10 }}
                />
            )}

            <MotionCard loading={listLoading}>
                <div data-guide="dp-confirmation-table">
                    {filteredRows.length === 0 ? (
                        <Empty
                            className="ws-list-empty"
                            description={
                                activeStatus === 'build' && !searchText
                                    ? 'No plans need you right now.'
                                    : 'No SMEs match.'
                            }
                        />
                    ) : (
                        <>
                            <div className="ws-rows" role="list" aria-label="Development plans">
                                {pageRows.map(r => {
                                    const stage = stageOf(r)
                                    const pill = STAGE_PILL[stage]
                                    const holdUps = isParentDeptUser ? (r.childDeptStatuses || []).filter(x => x.status !== 'Finalised') : []
                                    return (
                                        <div key={r.participantId} role="listitem" className="ws-row is-static">
                                            <EntityAvatar name={r.beneficiaryName || 'SME'} size={36} />
                                            <div className="ws-row-main">
                                                <div className="ws-row-name">{r.beneficiaryName || 'Unnamed SME'}</div>
                                                <div className="ws-row-meta">{metaOf(r) || r.email}</div>
                                                {(holdUps.length > 0 || r.devPlanChangeRequested) && (
                                                    <div className="mv-row-flags">
                                                        {r.devPlanChangeRequested && <span className="mv-flag is-info">Edit requested</span>}
                                                        {holdUps.map(x => (
                                                            <span key={x.deptId} className="mv-flag is-warning" title={x.status === 'SME Pending' ? 'Department confirmed, SME still to sign' : 'Department still to confirm'}>
                                                                {x.deptName}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="ws-row-side is-inline">
                                                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                                                {actionOf(r)}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                            {filteredRows.length > LIST_PAGE_SIZE && (
                                <div className="ws-pagination">
                                    <Pagination
                                        size="small"
                                        current={listPage}
                                        pageSize={LIST_PAGE_SIZE}
                                        total={filteredRows.length}
                                        onChange={setListPage}
                                        showSizeChanger={false}
                                        showLessItems
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </MotionCard>

            <ConfirmedInterventionsModal
                open={confirmedModalOpen}
                participantId={
                    confirmedModalPid!
                }
                department={userDepartment}
                onClose={closeConfirmedModal}
            />

            <Modal
                className="guide-dp-change-requests-modal"
                title={
                    <Space
                        size={8}
                        wrap
                    >
                        <span>
                            DP Plan Requests
                        </span>
                        <Tag
                            color={
                                hodRequests.length > 0
                                    ? 'orange'
                                    : 'default'
                            }
                        >
                            {hodRequests.length}{' '}
                            pending
                        </Tag>
                    </Space>
                }
                open={hodRequestsModalOpen}
                centered
                width={900}
                onCancel={() =>
                    setHodRequestsModalOpen(false)
                }
                footer={null}
                destroyOnHidden
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent:
                            'space-between',
                        gap: 12,
                        marginBottom: 14,
                        flexWrap: 'wrap'
                    }}
                >
                    <Text type="secondary">
                        Review coordinator requests to
                        temporarily unlock a Development
                        Plan for editing.
                    </Text>

                    <Button
                        icon={<EyeOutlined />}
                        style={roundBtn}
                        loading={hodReqLoading}
                        onClick={() =>
                            void fetchHodRequests()
                        }
                    >
                        Refresh
                    </Button>
                </div>

                {hodRequests.length === 0 ? (
                    <Alert
                        type="info"
                        showIcon
                        message="No pending DP change requests."
                    />
                ) : (
                    <Table
                        loading={hodReqLoading}
                        dataSource={hodRequests}
                        rowKey="id"
                        size="small"
                        scroll={{
                            x: 760
                        }}
                        pagination={{
                            pageSize: 6,
                            showSizeChanger: false,
                            position: [
                                'bottomCenter'
                            ]
                        }}
                        columns={[
                            {
                                title: 'Participant',
                                dataIndex:
                                    'participantId',
                                ellipsis: true,
                                render: (
                                    pid: any
                                ) => (
                                    <Text strong>
                                        {participantLabel(
                                            pid
                                        )}
                                    </Text>
                                )
                            },
                            {
                                title: 'Requested By',
                                dataIndex:
                                    'requestedByDeptName',
                                render: (
                                    v: any,
                                    r: any
                                ) => (
                                    <Space
                                        direction="vertical"
                                        size={0}
                                    >
                                        <Tag>
                                            {v ||
                                                '—'}
                                        </Tag>
                                        <Text
                                            type="secondary"
                                            style={{
                                                fontSize: 12
                                            }}
                                        >
                                            {r?.requestedByUserEmail ||
                                                '—'}
                                        </Text>
                                    </Space>
                                )
                            },
                            {
                                title: 'Reason',
                                dataIndex: 'reason',
                                ellipsis: true
                            },
                            {
                                title: 'Action',
                                width: 140,
                                render: (
                                    _: any,
                                    r: any
                                ) => (
                                    <Button
                                        data-guide="dp-change-request-action"
                                        type="link"
                                        onClick={() => {
                                            setHodSelectedReq(
                                                r
                                            )
                                            setHodDecisionNote(
                                                ''
                                            )
                                            setHodDecisionModalOpen(
                                                true
                                            )
                                        }}
                                    >
                                        View / Decide
                                    </Button>
                                )
                            }
                        ]}
                    />
                )}
            </Modal>

            <Modal
                className="guide-dp-change-request-modal"
                title="DP Change Request Decision"
                open={hodDecisionModalOpen}
                centered
                onCancel={() => {
                    setHodDecisionModalOpen(false)
                    setHodSelectedReq(null)
                    setHodDecisionNote('')
                }}
                footer={null}
            >
                {hodSelectedReq && (
                    <>
                        <Alert
                            type="info"
                            showIcon
                            message="Approving unlocks the plan for editing. Rejecting keeps it locked. The original request reason is shown below."
                            style={{
                                marginBottom: 12
                            }}
                        />

                        <p>
                            <b>Participant:</b>{' '}
                            {participantLabel(
                                hodSelectedReq.participantId
                            )}
                        </p>

                        <p>
                            <b>Requested by:</b>{' '}
                            {hodSelectedReq.requestedByDeptName ||
                                '—'}{' '}
                            (
                            {hodSelectedReq.requestedByUserEmail ||
                                '—'}
                            )
                        </p>

                        <p>
                            <b>Reason:</b>{' '}
                            {hodSelectedReq.reason ||
                                '—'}
                        </p>

                        <div data-guide="dp-change-request-note">
                            <Input.TextArea
                                rows={4}
                                value={
                                    hodDecisionNote
                                }
                                onChange={e =>
                                    setHodDecisionNote(
                                        e.target.value
                                    )
                                }
                                placeholder="Optional note (why approved/rejected)"
                                maxLength={800}
                                showCount
                                style={{
                                    marginTop: 8
                                }}
                            />
                        </div>

                        <Space
                            data-guide="dp-change-request-actions"
                            style={{
                                marginTop: 12
                            }}
                            wrap
                        >
                            <Button
                                icon={
                                    <CloseOutlined />
                                }
                                iconPosition="end"
                                style={roundBtn}
                                variant="solid"
                                danger
                                loading={
                                    resolvingReq
                                }
                                onClick={() =>
                                    resolveHodRequest(
                                        'rejected'
                                    )
                                }
                            >
                                Reject
                            </Button>

                            <Button
                                icon={
                                    <CheckOutlined />
                                }
                                iconPosition="end"
                                style={roundBtn}
                                variant="solid"
                                color="green"
                                loading={
                                    resolvingReq
                                }
                                onClick={() =>
                                    resolveHodRequest(
                                        'approved'
                                    )
                                }
                            >
                                Approve & Unlock
                            </Button>
                        </Space>
                    </>
                )}
            </Modal>
        </div>
    )
}

export default DiagnosticPlanConfirmations
