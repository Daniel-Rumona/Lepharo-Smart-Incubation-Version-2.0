import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet'
import {
    Alert,
    Button,
    Col,
    Grid,
    Input,
    message,
    Modal,
    Popconfirm,
    Row,
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
import { onAuthStateChanged } from 'firebase/auth'
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
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useNavigate } from 'react-router-dom'
import ConfirmedInterventionsModal from './confirmed'
import { roundBtn } from '@/components/shared/StyledButton'
import { countDeptInterventionsInPlan } from '@/utils/diagnosticPlanDeptInterventions'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

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
    parentDepartmentName?: string | null
    parentDeptName?: string | null
    parentName?: string | null
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

const norm = (s: any) =>
    String(s ?? '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

const SAME_DEPT = (a?: string, b?: string) =>
    norm(a).replace(/[^\w\s]|_/g, '') === norm(b).replace(/[^\w\s]|_/g, '')

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

const getDeptConfirmMaps = (plan: any) => {
    const byId = (plan?.confirmedByDeptId || null) as Record<string, DeptConfirmValue> | null
    const byName = ((plan?.confirmed || {}) as Record<string, DeptConfirmValue>) || {}
    return { byId, byName }
}

const isDeptConfirmedForMe = (plan: any, deptId: string, deptName: string) => {
    const { byId, byName } = getDeptConfirmMaps(plan)
    const v1 = byId ? byId[deptId] : undefined
    const v2 = byName ? byName[deptName] : undefined
    return isDeptConfirmedValue(v1) || isDeptConfirmedValue(v2)
}

const countConfirmedDeptTotal = (
    plan: any,
    confirmDeptIds: string[],
    deptIdToName: Record<string, string>
) => {
    const { byId, byName } = getDeptConfirmMaps(plan)

    if (byId) return confirmDeptIds.filter(id => isDeptConfirmedValue(byId[id])).length

    const allowNames = new Set(confirmDeptIds.map(id => deptIdToName[id]).filter(Boolean))
    const values = Object.entries(byName || {})
        .filter(([name]) => (allowNames.size ? allowNames.has(name) : true))
        .map(([, v]) => v)

    return values.filter(v => isDeptConfirmedValue(v)).length
}

const getSmmeConfirmMaps = (plan: any) => {
    const byId =
        (plan?.smmeConfirmedByDeptId ||
            plan?.incubateeDepartmentConfirmationsByDeptId ||
            null) as Record<string, SmmeConfirmValue> | null

    const byName =
        ((plan?.smmeConfirmedByDept ||
            plan?.incubateeConfirmedByDept ||
            plan?.incubateeDepartmentConfirmations ||
            plan?.smmeConfirmedMap ||
            {}) as Record<string, SmmeConfirmValue>) || {}

    return { byId, byName }
}

const isSmmeConfirmedForMe = (plan: any, deptId: string, deptName: string) => {
    const { byId, byName } = getSmmeConfirmMaps(plan)
    const v1 = byId ? byId[deptId] : undefined
    const v2 = byName ? byName[deptName] : undefined
    return isSmmeConfirmedValue(v1) || isSmmeConfirmedValue(v2)
}

const countConfirmedSmmeTotal = (
    plan: any,
    confirmDeptIds: string[],
    deptIdToName: Record<string, string>
) => {
    const { byId, byName } = getSmmeConfirmMaps(plan)

    if (byId) return confirmDeptIds.filter(id => isSmmeConfirmedValue(byId[id])).length

    const allowNames = new Set(confirmDeptIds.map(id => deptIdToName[id]).filter(Boolean))
    const values = Object.entries(byName || {})
        .filter(([name]) => (allowNames.size ? allowNames.has(name) : true))
        .map(([, v]) => v)

    return values.filter(v => isSmmeConfirmedValue(v)).length
}

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
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const { activeProgramId } = useActiveProgramId()

    const [bootLoading, setBootLoading] = useState(true)
    const [listLoading, setListLoading] = useState(false)
    const [rowsReloadKey, setRowsReloadKey] = useState(0)

    const [userDepartment, setUserDepartment] = useState<string>('')

    const [confirmDeptIds, setConfirmDeptIds] = useState<string[]>([])
    const [deptIdToName, setDeptIdToName] = useState<Record<string, string>>({})
    const [userDepartmentId, setUserDepartmentId] = useState<string>('')

    const [parentDeptId, setParentDeptId] = useState<string>('')
    const [parentDeptName, setParentDeptName] = useState<string>('')
    const [childDeptIdsOfParent, setChildDeptIdsOfParent] = useState<string[]>([])

    const [rows, setRows] = useState<DpRow[]>([])
    const [searchText, setSearchText] = useState('')
    const [statusFilter, setStatusFilter] = useState<
        | 'All'
        | 'Hold-ups'
        | 'Finalised'
        | 'Department Pending'
        | 'Department Confirmed'
        | 'SME Pending'
        | 'Finalised (My Department + SME)'
        | 'Finalised (All Depts + All SME)'
    >('All')

    const [stats, setStats] = useState({
        total: 0,
        confirmed: 0,
        pending: 0
    })

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

    const resolveDeptParentName = (d: DeptDoc) =>
        (d.parentDepartmentName ?? d.parentDeptName ?? d.parentName ?? null) as string | null

    const participantLabel = useCallback(
        (pid: any) => {
            const id = String(pid || '').trim()
            if (!id) return '—'
            return participantNameById[id] || id
        },
        [participantNameById]
    )

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    const ME_DEPT_NAME = 'M&E (Monitoring and Evaluation)'
    const SKIP_DEPTS = useMemo(
        () => [
            ME_DEPT_NAME,
            'IHF (InHouse Finance)',
            'ROM (Recruitment, Onboarding and Maintenance)',
            'HRM (Human Resources Management)'
        ],
        [ME_DEPT_NAME]
    )

    const isROM = SAME_DEPT(
        userDepartment,
        'ROM (Recruitment, Onboarding and Maintenance)'
    )

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
        const unsub = onAuthStateChanged(auth, async u => {
            if (!u?.email) {
                setUserDepartment('')
                setBootLoading(false)
                return
            }

            try {
                const userSnap = await getDocs(
                    query(collection(db, 'users'), where('email', '==', u.email))
                )

                if (!userSnap.empty) {
                    const data = userSnap.docs[0].data() as any
                    setUserDepartment(String(data.departmentName || ''))
                }
            } catch (e) {
                console.error('Error loading user profile:', e)
            } finally {
                setBootLoading(false)
            }
        })

        return () => unsub()
    }, [])

    useEffect(() => {
        ; (async () => {
            if (!userDepartment) {
                setConfirmDeptIds([])
                setDeptIdToName({})
                setUserDepartmentId('')
                setParentDeptId('')
                setParentDeptName('')
                setChildDeptIdsOfParent([])
                return
            }

            try {
                const deptSnap = await getDocs(collection(db, 'departments'))
                const depts: DeptDoc[] = deptSnap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))

                const idToName: Record<string, string> = {}
                const nameToId: Record<string, string> = {}

                depts.forEach(d => {
                    idToName[d.id] = d.name
                    nameToId[d.name] = d.id
                })

                setDeptIdToName(idToName)

                const myDoc = depts.find(d => SAME_DEPT(d.name, userDepartment)) || null
                const myId = myDoc?.id || ''
                setUserDepartmentId(myId)

                let pId = ''
                let pName = ''

                if (myDoc) {
                    const pid = resolveDeptParentId(myDoc)
                    const pname = resolveDeptParentName(myDoc)

                    if (pid && idToName[pid]) {
                        pId = pid
                        pName = idToName[pid]
                    } else if (pname && nameToId[pname]) {
                        pId = nameToId[pname]
                        pName = pname
                    } else {
                        pId = myDoc.id
                        pName = myDoc.name
                    }
                } else {
                    pId = myId
                    pName = userDepartment
                }

                setParentDeptId(pId)
                setParentDeptName(pName)

                const childIds = depts
                    .filter(d => {
                        const pid = resolveDeptParentId(d)
                        const pname = resolveDeptParentName(d)

                        if (pid) return pid === pId
                        if (pname) return SAME_DEPT(pname, pName)

                        return false
                    })
                    .map(d => d.id)

                setChildDeptIdsOfParent(childIds)

                const confirmIds = depts
                    .filter(d => !SKIP_DEPTS.some(skip => SAME_DEPT(skip, d.name)))
                    .map(d => d.id)

                setConfirmDeptIds(confirmIds)
            } catch (e) {
                console.error('[DP Confirmations] error loading departments', e)
                setConfirmDeptIds([])
                setDeptIdToName({})
                setUserDepartmentId('')
                setParentDeptId('')
                setParentDeptName('')
                setChildDeptIdsOfParent([])
            }
        })()
    }, [userDepartment, SKIP_DEPTS])

    const isParentDeptUser = useMemo(() => {
        if (!isHOD) return false
        if (!parentDeptId) return false
        if (!SAME_DEPT(parentDeptName, userDepartment)) return false

        return (childDeptIdsOfParent?.length || 0) > 0
    }, [
        isHOD,
        parentDeptId,
        parentDeptName,
        userDepartment,
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

    const FUNCTIONS_BASE = 'https://us-central1-lph-smart-inc.cloudfunctions.net'

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
            setStats({ total: 0, confirmed: 0, pending: 0 })
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
                setStats({ total: 0, confirmed: 0, pending: 0 })
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

                const matchesDeptName =
                    !!unlockedForDeptName &&
                    SAME_DEPT(unlockedForDeptName, userDepartment)

                const devPlanUnlocked =
                    edit?.unlocked === true &&
                    (matchesDeptId || matchesDeptName)

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
                    ? countConfirmedDeptTotal(
                        plan,
                        confirmDeptIds,
                        deptIdToName
                    )
                    : 0

                const submittedSmmeCount = plan
                    ? countConfirmedSmmeTotal(
                        plan,
                        confirmDeptIds,
                        deptIdToName
                    )
                    : 0

                const isSkipDeptForThisUser =
                    !isROM &&
                    SKIP_DEPTS.some(d =>
                        SAME_DEPT(d, userDepartment)
                    )

                const deptConfirmedForMe =
                    isSkipDeptForThisUser ||
                    (plan && userDepartmentId
                        ? isDeptConfirmedForMe(
                            plan,
                            userDepartmentId,
                            userDepartment
                        )
                        : plan
                            ? isDeptConfirmedForMe(
                                plan,
                                '__no_id__',
                                userDepartment
                            )
                            : false)

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
                    plan && userDepartmentId
                        ? isSmmeConfirmedForMe(
                            plan,
                            userDepartmentId,
                            userDepartment
                        )
                        : plan
                            ? isSmmeConfirmedForMe(
                                plan,
                                '__no_id__',
                                userDepartment
                            )
                            : false

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

                const isFinalisedOverall =
                    (deptAllConfirmed || final) &&
                    smmeAllConfirmed

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

                        const deptConfirmed =
                            isDeptConfirmedForMe(
                                plan,
                                cid,
                                cname
                            )

                        const smmeConfirmed =
                            isSmmeConfirmedForMe(
                                plan,
                                cid,
                                cname
                            )

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

            const total = list.length
            const confirmedCount = isROM
                ? list.filter(r => r.isFinalisedOverall).length
                : isParentDeptUser
                    ? list.filter(
                        r =>
                            (r.childDeptStatuses || []).length > 0 &&
                            (r.holdUpDepts || []).length === 0
                    ).length
                    : list.filter(r => r.isFinalisedForMe).length

            const pending = Math.max(
                0,
                total - confirmedCount
            )

            setStats({
                total,
                confirmed: confirmedCount,
                pending
            })
        } catch (e) {
            console.error('fetchRows failed', e)
            setRows([])
            setStats({
                total: 0,
                confirmed: 0,
                pending: 0
            })
        } finally {
            setListLoading(false)
        }
    }, [
        activeProgramId,
        confirmDeptIds,
        deptIdToName,
        userDepartment,
        userDepartmentId,
        isParentDeptUser,
        childDeptIdsOfParent,
        isROM,
        SKIP_DEPTS
    ])

    useEffect(() => {
        if (!activeProgramId || !confirmDeptIds.length) {
            setRows([])
            setStats({
                total: 0,
                confirmed: 0,
                pending: 0
            })
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
                setStats({
                    total: 0,
                    confirmed: 0,
                    pending: 0
                })
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

                setHodRequests(prev =>
                    prev.filter(r => r.id !== reqId)
                )

                await fetchRows()
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

    const filteredRows = useMemo(() => {
        const q = searchText.trim().toLowerCase()

        const bySearch = rows.filter(r =>
            String(
                r.beneficiaryName || ''
            )
                .toLowerCase()
                .includes(q)
        )

        if (isParentDeptUser) {
            if (statusFilter === 'All') return bySearch

            if (statusFilter === 'Hold-ups') {
                return bySearch.filter(
                    r =>
                        (r.holdUpDepts || []).length > 0
                )
            }

            if (statusFilter === 'Finalised') {
                return bySearch.filter(
                    r =>
                        (r.childDeptStatuses || []).length >
                        0 &&
                        (r.holdUpDepts || []).length === 0
                )
            }

            return bySearch
        }

        if (statusFilter === 'All') return bySearch

        if (statusFilter === 'Department Pending') {
            return bySearch.filter(
                r => r.deptStatus === 'Pending'
            )
        }

        if (statusFilter === 'Department Confirmed') {
            return bySearch.filter(
                r =>
                    r.deptStatus === 'Confirmed' &&
                    !(
                        isROM
                            ? r.isFinalisedOverall
                            : r.isFinalisedForMe
                    )
            )
        }

        if (statusFilter === 'SME Pending') {
            return bySearch.filter(
                r => r.smmeStatus === 'Pending'
            )
        }

        if (
            statusFilter ===
            'Finalised (My Department + SME)'
        ) {
            return bySearch.filter(
                r => r.isFinalisedForMe
            )
        }

        if (
            statusFilter ===
            'Finalised (All Depts + All SME)'
        ) {
            return bySearch.filter(
                r => r.isFinalisedOverall
            )
        }

        return bySearch
    }, [
        rows,
        searchText,
        statusFilter,
        isROM,
        isParentDeptUser
    ])

    useEffect(() => {
        const total = filteredRows.length

        const confirmedCount = isROM
            ? filteredRows.filter(
                r => r.isFinalisedOverall
            ).length
            : isParentDeptUser
                ? filteredRows.filter(
                    r =>
                        (r.childDeptStatuses || [])
                            .length > 0 &&
                        (r.holdUpDepts || []).length ===
                        0
                ).length
                : filteredRows.filter(
                    r => r.isFinalisedForMe
                ).length

        const pending = Math.max(
            0,
            total - confirmedCount
        )

        setStats({
            total,
            confirmed: confirmedCount,
            pending
        })
    }, [
        filteredRows,
        isROM,
        isParentDeptUser
    ])

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

    const parentColumns = useMemo(
        () => [
            {
                title: 'Beneficiary',
                dataIndex: 'beneficiaryName',
                render: (_: any, r: DpRow) => (
                    <Space
                        direction="vertical"
                        size={2}
                    >
                        <Text strong>
                            {r.beneficiaryName || '-'}
                        </Text>

                        {!!r.email && (
                            <Tag
                                color={
                                    r.emailValid
                                        ? 'blue'
                                        : 'red'
                                }
                                style={{
                                    marginInlineStart: 0
                                }}
                            >
                                {r.email}
                            </Tag>
                        )}

                        {!r.email && (
                            <Tag
                                color="default"
                                style={{
                                    marginInlineStart: 0
                                }}
                            >
                                No email
                            </Tag>
                        )}
                    </Space>
                )
            },
            {
                title: 'Child Departments',
                dataIndex: 'childDeptStatuses',
                render: (_: any, r: DpRow) => {
                    const items =
                        r.childDeptStatuses || []

                    if (!items.length) {
                        return <Tag>—</Tag>
                    }

                    const sorted = [...items].sort(
                        (a, b) => {
                            const aHold =
                                a.status === 'Finalised'
                                    ? 0
                                    : 1

                            const bHold =
                                b.status === 'Finalised'
                                    ? 0
                                    : 1

                            return bHold - aHold
                        }
                    )

                    return (
                        <Space wrap>
                            {sorted.map(x => {
                                const color =
                                    x.status ===
                                        'Finalised'
                                        ? 'green'
                                        : x.status ===
                                            'SME Pending'
                                            ? 'gold'
                                            : 'orange'

                                const tip =
                                    x.status ===
                                        'Finalised'
                                        ? 'Department + SME confirmed'
                                        : x.status ===
                                            'SME Pending'
                                            ? 'Department confirmed, SME still pending'
                                            : 'Department confirmation pending'

                                return (
                                    <Tooltip
                                        key={x.deptId}
                                        title={tip}
                                    >
                                        <Tag
                                            color={
                                                color
                                            }
                                        >
                                            {x.deptName}:{' '}
                                            {x.status}
                                        </Tag>
                                    </Tooltip>
                                )
                            })}
                        </Space>
                    )
                }
            },
            {
                title: 'Actions',
                render: (_: any, r: DpRow) => (
                    <Button
                        data-guide="dp-view-plan-action"
                        icon={<EyeOutlined />}
                        iconPosition="end"
                        style={roundBtn}
                        onClick={() =>
                            openConfirmedModal(
                                r.participantId
                            )
                        }
                    >
                        View
                    </Button>
                )
            }
        ],
        [openConfirmedModal]
    )

    const normalColumns = useMemo(
        () => [
            {
                title: 'Beneficiary',
                dataIndex: 'beneficiaryName',
                render: (_: any, r: DpRow) => (
                    <Space
                        direction="vertical"
                        size={2}
                    >
                        <Text strong>
                            {r.beneficiaryName || '-'}
                        </Text>

                        {!!r.email && (
                            <Tag
                                color={
                                    r.emailValid
                                        ? 'blue'
                                        : 'red'
                                }
                                style={{
                                    marginInlineStart: 0
                                }}
                            >
                                {r.email}
                            </Tag>
                        )}

                        {!r.email && (
                            <Tag
                                color="default"
                                style={{
                                    marginInlineStart: 0
                                }}
                            >
                                No email
                            </Tag>
                        )}
                    </Space>
                )
            },
            {
                title: isROM
                    ? 'Department Confirmations (All)'
                    : 'Department Confirmation',
                dataIndex: 'deptStatus',
                render: (_: any, r: DpRow) => {
                    const v = isROM
                        ? r.overallDeptStatus
                        : r.deptStatus

                    const ok =
                        v === 'Confirmed'

                    return (
                        <Space
                            direction="vertical"
                            size={0}
                        >
                            {ok ? (
                                <Tag color="blue">
                                    Confirmed
                                </Tag>
                            ) : (
                                <Tag color="orange">
                                    Pending
                                </Tag>
                            )}

                            {ok &&
                                typeof r.deptInterventionsCount ===
                                'number' && (
                                    <Tag
                                        color={
                                            r.deptInterventionsCount >
                                                0
                                                ? 'purple'
                                                : 'default'
                                        }
                                    >
                                        Intv:{' '}
                                        {
                                            r.deptInterventionsCount
                                        }
                                    </Tag>
                                )}

                            {isROM && (
                                <Text
                                    type="secondary"
                                    style={{
                                        fontSize: 12
                                    }}
                                >
                                    {r.submittedDeptCount ||
                                        0}
                                    {typeof r.requiredDeptCount ===
                                        'number' &&
                                        r.requiredDeptCount > 0
                                        ? ` / ${r.requiredDeptCount}`
                                        : ' / -'}
                                </Text>
                            )}
                        </Space>
                    )
                }
            },
            {
                title: isROM
                    ? 'SME Confirmations'
                    : 'SME Confirmation',
                dataIndex: 'smmeStatus',
                render: (_: any, r: DpRow) => {
                    const v = r.smmeStatus

                    const tag =
                        v === 'Locked' ? (
                            <Tag>Locked</Tag>
                        ) : v === 'Confirmed' ? (
                            <Tag color="green">
                                Confirmed
                            </Tag>
                        ) : (
                            <Tag color="gold">
                                Pending
                            </Tag>
                        )

                    if (!isROM) return tag

                    const submitted =
                        r.submittedSmmeCount || 0
                    const total =
                        r.requiredSmmeCount

                    return (
                        <Space
                            direction="vertical"
                            size={0}
                        >
                            {tag}

                            <Text
                                type="secondary"
                                style={{
                                    fontSize: 12
                                }}
                            >
                                {submitted}
                                {typeof total ===
                                    'number' &&
                                    total > 0
                                    ? ` / ${total}`
                                    : ' / -'}
                            </Text>
                        </Space>
                    )
                }
            },
            {
                title: 'Actions',
                render: (_: any, r: DpRow) => {
                    const canViewConfirmedRom =
                        isROM &&
                        r.isFinalisedOverall

                    const canBuildOrEdit =
                        !isROM &&
                        !isParentDeptUser &&
                        (!r.hasAnyPlan ||
                            r.deptStatus ===
                            'Pending' ||
                            r.devPlanUnlocked ===
                            true)

                    const buildLabel =
                        r.hasAnyPlan &&
                            r.devPlanUnlocked
                            ? 'Edit'
                            : 'Build'

                    const canRemindSmme =
                        !isROM &&
                        r.deptStatus ===
                        'Confirmed' &&
                        r.smmeStatus ===
                        'Pending' &&
                        !r.isFinalisedForMe &&
                        !!r.email &&
                        r.emailValid !== false

                    const canViewAsPlanOwner =
                        !isROM &&
                        r.hasAnyPlan &&
                        r.deptStatus ===
                        'Confirmed'

                    const canViewFinalised =
                        !isROM &&
                        r.isFinalisedForMe

                    const canView =
                        canViewConfirmedRom ||
                        canViewFinalised ||
                        canViewAsPlanOwner

                    return (
                        <Space wrap>
                            {canBuildOrEdit && (
                                <Button
                                    data-guide="dp-build-edit-action"
                                    icon={
                                        <ArrowRightOutlined />
                                    }
                                    iconPosition="end"
                                    style={roundBtn}
                                    variant="filled"
                                    color="orange"
                                    onClick={() =>
                                        goBuild(
                                            r.participantId
                                        )
                                    }
                                >
                                    {buildLabel}
                                </Button>
                            )}

                            {canRemindSmme && (
                                <Popconfirm
                                    title="Send SME reminder?"
                                    description="This will email the SME to confirm the Developmental Plan for your department."
                                    onConfirm={() =>
                                        handleSendSmmeReminder(
                                            r.participantId,
                                            r
                                        )
                                    }
                                    okText="Send"
                                    cancelText="Cancel"
                                >
                                    <Button
                                        data-guide="dp-sme-reminder-action"
                                        icon={
                                            <MailOutlined />
                                        }
                                        iconPosition="end"
                                        style={
                                            roundBtn
                                        }
                                        loading={
                                            sendingSmmeReminderPid ===
                                            r.participantId
                                        }
                                        disabled={
                                            sendingSmmeReminderPid ===
                                            r.participantId
                                        }
                                    >
                                        Remind
                                    </Button>
                                </Popconfirm>
                            )}

                            {canView && (
                                <Button
                                    data-guide="dp-view-plan-action"
                                    icon={
                                        <EyeOutlined />
                                    }
                                    iconPosition="end"
                                    style={
                                        roundBtn
                                    }
                                    variant="filled"
                                    color="primary"
                                    onClick={() =>
                                        openConfirmedModal(
                                            r.participantId
                                        )
                                    }
                                >
                                    View
                                </Button>
                            )}
                        </Space>
                    )
                }
            }
        ],
        [
            isROM,
            isParentDeptUser,
            sendingSmmeReminderPid,
            goBuild,
            handleSendSmmeReminder,
            openConfirmedModal
        ]
    )

    const columns = useMemo(() => {
        if (isParentDeptUser) {
            return parentColumns
        }

        return normalColumns
    }, [
        isParentDeptUser,
        parentColumns,
        normalColumns
    ])

    if (bootLoading) {
        return (
            <div
                style={{
                    padding: isMobile ? 12 : 24,
                    minHeight: '100vh'
                }}
            >
                <LoadingOverlay tip="Fetching Development Plans" />
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

    return (
        <div
            style={{
                padding: isMobile ? 12 : 24,
                minHeight: '100vh'
            }}
        >
            <Helmet>
                <title>
                    Development Plans | Smart Incubation
                </title>
                <meta
                    name="description"
                    content="Track departmental and SME confirmations for Development Plans."
                />
            </Helmet>

            <Row
                data-guide="dp-confirmation-metrics"
                gutter={[16, 16]}
                style={{
                    marginBottom: 16
                }}
            >
                <Col
                    xs={24}
                    sm={isHOD ? 12 : 8}
                    xl={isHOD ? 6 : 8}
                >
                    <MotionCard.Metric
                        loading={listLoading}
                        icon={
                            <TeamOutlined
                                style={{
                                    fontSize: 18,
                                    color: '#1890ff'
                                }}
                            />
                        }
                        iconBg="#e6f7ff"
                        title="Total Participants"
                        value={stats.total}
                    />
                </Col>

                <Col
                    xs={24}
                    sm={isHOD ? 12 : 8}
                    xl={isHOD ? 6 : 8}
                >
                    <MotionCard.Metric
                        loading={listLoading}
                        icon={
                            <CheckCircleOutlined
                                style={{
                                    fontSize: 18,
                                    color: '#3f8600'
                                }}
                            />
                        }
                        iconBg="#f6ffed"
                        title="Finalised"
                        value={stats.confirmed}
                    />
                </Col>

                <Col
                    xs={24}
                    sm={isHOD ? 12 : 8}
                    xl={isHOD ? 6 : 8}
                >
                    <MotionCard.Metric
                        loading={listLoading}
                        icon={
                            <ClockCircleOutlined
                                style={{
                                    fontSize: 18,
                                    color: '#faad14'
                                }}
                            />
                        }
                        iconBg="#fffbe6"
                        title="Not Finalised"
                        value={stats.pending}
                    />
                </Col>

                {isHOD && (
                    <Col
                        xs={24}
                        sm={12}
                        xl={6}
                    >
                        <div data-guide="dp-change-requests">
                            <MotionCard.Metric
                                loading={hodReqLoading}
                                icon={
                                    <FileTextOutlined
                                        style={{
                                            fontSize: 18,
                                            color: '#722ed1'
                                        }}
                                    />
                                }
                                iconBg="#f9f0ff"
                                title="DP Plan Requests"
                                value={
                                    hodRequests.length
                                }
                                onClick={() => {
                                    setHodRequestsModalOpen(
                                        true
                                    )
                                    void fetchHodRequests()
                                }}
                            />
                        </div>
                    </Col>
                )}
            </Row>

            {sendingBatchSmme &&
                batchSmmeProgress.total > 0 && (
                    <Alert
                        type="info"
                        showIcon
                        message="Sending SME reminders..."
                        description={`Progress: ${batchSmmeProgress.done} / ${batchSmmeProgress.total}`}
                        style={{
                            marginBottom: 10
                        }}
                    />
                )}

            <MotionCard
                loading={listLoading}
                filterBar={
                    <div
                        data-guide="dp-confirmation-filters"
                        style={{
                            display: 'flex',
                            gap: 12,
                            alignItems: 'end',
                            flexWrap: 'wrap'
                        }}
                    >
                        <div
                            style={{
                                flex: 1,
                                minWidth: 240
                            }}
                        >
                            <Input
                                prefix={
                                    <SearchOutlined />
                                }
                                placeholder="Search by Beneficiary Name"
                                value={searchText}
                                onChange={e =>
                                    setSearchText(
                                        e.target.value
                                    )
                                }
                            />
                        </div>

                        <div
                            style={{
                                width: 300,
                                minWidth: 240
                            }}
                        >
                            <Select
                                style={{
                                    width: '100%'
                                }}
                                value={statusFilter}
                                onChange={v =>
                                    setStatusFilter(v)
                                }
                                options={
                                    isParentDeptUser
                                        ? [
                                            {
                                                value: 'All',
                                                label: 'All'
                                            },
                                            {
                                                value: 'Hold-ups',
                                                label: 'Hold-ups (Any child pending)'
                                            },
                                            {
                                                value: 'Finalised',
                                                label: 'Finalised (All child depts done)'
                                            }
                                        ]
                                        : [
                                            {
                                                value: 'All',
                                                label: 'All'
                                            },
                                            {
                                                value: 'Department Pending',
                                                label: 'Department Pending'
                                            },
                                            {
                                                value: 'Department Confirmed',
                                                label: 'Department Confirmed (not finalised yet)'
                                            },
                                            {
                                                value: 'SME Pending',
                                                label: 'SME Pending'
                                            },
                                            {
                                                value: 'Finalised (My Department + SME)',
                                                label: 'Finalised (My Department + SME)'
                                            },
                                            ...(isROM
                                                ? [
                                                    {
                                                        value: 'Finalised (All Depts + All SME)',
                                                        label: 'Finalised (All Depts + All SME)'
                                                    }
                                                ]
                                                : [])
                                        ]
                                }
                            />
                        </div>

                        {!isROM &&
                            !isParentDeptUser &&
                            canBatchRemindSmme && (
                                <Popconfirm
                                    title="Send SME reminders in batch?"
                                    description={`This will email ${batchSmmeTargets.length} SMEs who haven't confirmed your department yet.`}
                                    onConfirm={
                                        handleSendBatchSmmeReminders
                                    }
                                    okText="Yes, send"
                                    cancelText="Cancel"
                                >
                                    <Button
                                        data-guide="dp-batch-sme-reminders"
                                        icon={
                                            <MailOutlined />
                                        }
                                        variant="solid"
                                        style={
                                            roundBtn
                                        }
                                        loading={
                                            sendingBatchSmme
                                        }
                                        disabled={
                                            sendingBatchSmme
                                        }
                                        color="cyan"
                                    >
                                        Remind SMEs
                                    </Button>
                                </Popconfirm>
                            )}

                        {isROM && (
                            <Popconfirm
                                title="Send department reminders?"
                                description="This will email all departments that have not confirmed their developmental plans."
                                onConfirm={
                                    handleSendDeptReminders
                                }
                                okText="Yes, send"
                                cancelText="Cancel"
                            >
                                <Button
                                    data-guide="dp-department-reminders"
                                    type="primary"
                                    icon={
                                        <MailOutlined />
                                    }
                                    loading={
                                        sendingReminders
                                    }
                                    disabled={
                                        sendingReminders
                                    }
                                    style={roundBtn}
                                >
                                    Send Department Reminders
                                </Button>
                            </Popconfirm>
                        )}
                    </div>
                }
            >
                <div data-guide="dp-confirmation-table">
                    <Table
                        dataSource={filteredRows}
                        columns={columns as any}
                        rowKey="participantId"
                        pagination={{
                            pageSize: 6,
                            showSizeChanger: false,
                            position: [
                                'bottomCenter'
                            ]
                        }}
                        size="middle"
                        scroll={{
                            x: 1000
                        }}
                    />
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
