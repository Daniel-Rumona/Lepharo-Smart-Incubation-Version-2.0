import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Alert,
    App,
    Button,
    Col,
    Empty,
    Form,
    Grid,
    Input,
    Modal,
    Row,
    Select,
    Space,
    Switch,
    Table,
    Tag,
    Tooltip,
    Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CheckCircleOutlined,
    ClearOutlined,
    DeleteOutlined,
    EditOutlined,
    EyeInvisibleOutlined,
    MailOutlined,
    PlusOutlined,
    SearchOutlined,
    StarOutlined,
    TeamOutlined,
    UserSwitchOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'
import { auth, db, functions } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { isQuantilytixDomain } from '@/utils/quantilytixAccess'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import { httpsCallable } from 'firebase/functions'
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    where
} from 'firebase/firestore'

const { Text } = Typography
const { useBreakpoint } = Grid

const COORDINATORS_COLLECTION = 'coordinators'
const USERS_COLLECTION = 'users'
const PROGRAMS_COLLECTION = 'programs'
const BRANCHES_COLLECTION = 'branches'
const ASSIGNED_INTERVENTIONS_COLLECTION = 'assignedInterventions'

type EngagementCategory = 'Full-time' | 'Contract' | 'Intern' | null
type CoordinatorScope = 'center' | 'national'

interface BranchOption {
    id: string
    name: string
}

interface ProgramOption {
    id: string
    name: string
    branchId?: string | null
    branchName?: string | null
}

interface Coordinator {
    id: string
    uid?: string | null
    authUid?: string | null
    name: string
    email: string

    departmentId?: string | null
    departmentName?: string | null
    assignmentsCount: number
    rating: number
    active: boolean
    engagementCategory?: EngagementCategory
    branchIds?: string[]
    branchNames?: string[]
    branchId?: string | null
    branchName?: string | null
    assignedPrograms?: string[]
    isNational?: boolean
    nationalCoordinator?: boolean
    createdAt?: any
    updatedAt?: any
}

interface CoordinatorFormValues {
    name: string
    email: string
    engagementCategory?: EngagementCategory
    branchId?: string
    assignedPrograms?: string[]
    coordinatorScope?: CoordinatorScope
}

const CREATE_USER_URL =
    'https://us-central1-lph-smart-inc.cloudfunctions.net/createPlatformUser'
const normalizeString = (value: unknown) =>
    String(value || '')
        .trim()
        .toLowerCase()

const cleanArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []

    return Array.from(
        new Set(
            value
                .map(item => String(item || '').trim())
                .filter(Boolean)
        )
    )
}

const scoreCoordinatorRecord = (item: Coordinator) =>
    (item.id === item.authUid ? 4 : 0) +
    (item.authUid ? 3 : 0) +
    (item.uid ? 2 : 0) +
    (item.active ? 1 : 0)

const dedupeCoordinators = (items: Coordinator[]) => {
    const grouped = new Map<string, Coordinator[]>()

    for (const item of items) {
        const key =
            normalizeString(item.authUid) ||
            normalizeString(item.uid) ||
            `${normalizeString(item.email)}::${normalizeString(item.departmentId)}`

        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(item)
    }

    const picked: Coordinator[] = []

    for (const group of grouped.values()) {
        const sorted = [...group].sort(
            (a, b) => scoreCoordinatorRecord(b) - scoreCoordinatorRecord(a)
        )

        const base = sorted[0]
        const uid = base.uid || sorted.find(x => x.uid)?.uid || null
        const authUid = base.authUid || sorted.find(x => x.authUid)?.authUid || null
        const branchIds = cleanArray(
            base.branchIds?.length
                ? base.branchIds
                : base.branchId
                    ? [base.branchId]
                    : []
        )
        const branchNames = cleanArray(
            base.branchNames?.length
                ? base.branchNames
                : base.branchName
                    ? [base.branchName]
                    : []
        )

        picked.push({
            ...base,
            uid,
            authUid,
            active: sorted.some(x => x.active),
            rating: Math.max(...sorted.map(x => Number(x.rating || 0))),
            assignmentsCount: 0,
            branchIds,
            branchNames,
            branchId: base.branchId || branchIds[0] || null,
            branchName: base.branchName || branchNames[0] || null,
            assignedPrograms: cleanArray(base.assignedPrograms),
            isNational: Boolean(base.isNational ?? base.nationalCoordinator),
            nationalCoordinator: Boolean(base.nationalCoordinator)
        })
    }

    return picked.sort((a, b) => a.name.localeCompare(b.name))
}

const toUserFriendlyError = (
    error: any,
    fallback = 'Something went wrong. Please try again.'
) => {
    const code = String(error?.code || error?.error || '').toLowerCase()
    const raw = String(
        error?.message ||
        error?.details ||
        error?.error ||
        error ||
        ''
    ).toLowerCase()

    if (code) {
        if (code.includes('existing_user_conversion_requires_system_admin')) {
            return 'Only a system administrator can convert an existing user into a coordinator.'
        }

        if (
            code.includes('email-already-in-use') ||
            code.includes('email-already-exists') ||
            code.includes('email_already_exists') ||
            code.includes('already-exists') ||
            code.includes('already_exists')
        ) {
            return 'This email address is already linked to another user.'
        }

        if (code.includes('invalid-email') || code.includes('invalid_email')) {
            return 'Please enter a valid email address.'
        }

        if (code.includes('network') || code.includes('failed-to-fetch') || code.includes('timeout')) {
            return 'Network issue detected. Please check your connection and try again.'
        }

        if (code.includes('permission-denied') || code.includes('not_authenticated') || code.includes('unauthenticated')) {
            return 'You do not have permission to perform this action.'
        }
    }

    if (!raw) return fallback

    if (raw.includes('existing_user_conversion_requires_system_admin')) {
        return 'Only a system administrator can convert an existing user into a coordinator.'
    }

    if (
        raw.includes('email-already-exists') ||
        raw.includes('email already exists') ||
        raw.includes('email_already_exists') ||
        raw.includes('already exists') ||
        raw.includes('already_exists') ||
        raw.includes('auth/email-already-in-use')
    ) {
        return 'This email address is already linked to another user.'
    }

    if (
        raw.includes('invalid email') ||
        raw.includes('auth/invalid-email') ||
        raw.includes('invalid_email')
    ) {
        return 'Please enter a valid email address.'
    }

    if (
        raw.includes('not authenticated') ||
        raw.includes('unauthenticated') ||
        raw.includes('permission denied') ||
        raw.includes('missing or insufficient permissions')
    ) {
        return 'You do not have permission to perform this action.'
    }

    if (
        raw.includes('network') ||
        raw.includes('failed to fetch') ||
        raw.includes('timeout')
    ) {
        return 'Network issue detected. Please check your connection and try again.'
    }

    if (raw.includes('failed to create user')) {
        return 'Unable to create the user. This may mean the email is already registered or is invalid.'
    }

    if (raw.includes('user not found') || raw.includes('no user record')) {
        return 'The selected user could not be found.'
    }

    if (raw.includes('department could not be resolved')) {
        return 'Your department information is incomplete. Please contact an administrator.'
    }

    if (raw.includes('linked user account could not be found')) {
        return 'The linked user account could not be found. Check that this coordinator has a valid user profile.'
    }

    if (raw.includes('create_failed')) {
        return 'Unable to create the coordinator right now. Please try again.'
    }

    if (raw.includes('delete_failed')) {
        return 'Unable to delete the coordinator right now. Please try again.'
    }

    return raw || fallback
}

const resolveAllPrograms = async (
): Promise<ProgramOption[]> => {
    const programsRef = collection(db, PROGRAMS_COLLECTION)

    const snapshot = await getDocs(programsRef)

    return snapshot.docs
        .map(programDoc => {
            const data = programDoc.data() as any
            const assignedBranch =
                typeof data.assignedBranch === 'object' && data.assignedBranch !== null
                    ? data.assignedBranch
                    : null

            return {
                id: programDoc.id,
                name: String(data.name || data.programName || data.title || 'Unnamed Program'),
                branchId: String(assignedBranch?.id || data.branchId || ''),
                branchName: String(assignedBranch?.name || data.branchName || '')
            }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
}

const getLinkedUserRef = async (input: {
    uid?: string | null
    authUid?: string | null
    email?: string | null
}) => {
    const linkedUid = input.authUid || input.uid || null

    if (linkedUid) {
        const directRef = doc(db, USERS_COLLECTION, linkedUid)
        const directSnap = await getDoc(directRef)

        if (directSnap.exists()) {
            return directRef
        }
    }

    const email = normalizeString(input.email)
    if (!email) return null

    const usersSnap = await getDocs(
        query(collection(db, USERS_COLLECTION), where('email', '==', email))
    )

    if (usersSnap.empty) return null

    return doc(db, USERS_COLLECTION, usersSnap.docs[0].id)
}

export const CoordinatorsPage: React.FC = () => {
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const { message } = App.useApp()
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()

    const [form] = Form.useForm<CoordinatorFormValues>()
    const [editForm] = Form.useForm<CoordinatorFormValues>()

    const [coordinators, setCoordinators] = useState<Coordinator[]>([])
    const [branches, setBranches] = useState<BranchOption[]>([])
    const [programs, setPrograms] = useState<ProgramOption[]>([])

    const [loading, setLoading] = useState(true)
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState(false)

    const [addModalVisible, setAddModalVisible] = useState(false)
    const [isDummyAddMode, setIsDummyAddMode] = useState(false)
    const [editModalVisible, setEditModalVisible] = useState(false)
    const [editingCoordinator, setEditingCoordinator] = useState<Coordinator | null>(null)

    const [searchText, setSearchText] = useState('')
    const [engagementFilter, setEngagementFilter] = useState<EngagementCategory | undefined>()
    const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | undefined>()

    const isMobile = !screens.md

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'coordinators',
            pageTitle: 'Coordinators',
            guides: [
                {
                    id: 'coordinators-overview',
                    title: 'Quick tour',
                    description: 'Understand coordinator metrics, filters, records and management actions.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('coordinator-metrics'),
                            popover: {
                                title: 'Coordinator overview',
                                description:
                                    'These cards summarise coordinators in your department. Assignment totals follow the currently selected programme and count grouped interventions as one logical assignment.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('coordinator-filters'),
                            popover: {
                                title: 'Search and filter',
                                description:
                                    'Search coordinators by name, email or center, then narrow the list by engagement category or status.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('add-coordinator'),
                            popover: {
                                title: 'Add a coordinator',
                                description:
                                    'Use this action to create a coordinator, assign a center and define whether their programme scope is center based or national.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('coordinators-table'),
                            popover: {
                                title: 'Coordinator records',
                                description:
                                    'Review each coordinator, their center, programme count, logical assignment count and rating.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('coordinator-actions'),
                            popover: {
                                title: 'Manage a coordinator',
                                description:
                                    'From the Actions column you can view performance, edit coordinator details, delete a coordinator or activate and deactivate their account.',
                                side: 'left',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'add-coordinator',
                    title: 'Add a coordinator',
                    description: 'Walk through creating a coordinator and assigning their operational scope.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: guideTarget('add-coordinator'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Start here',
                                description:
                                    'Select Add Coordinator to open the coordinator setup form.',
                                side: 'bottom',
                                align: 'end',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-add-coordinator-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Coordinator setup',
                                description:
                                    'This form creates the coordinator profile and defines where they can operate.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('coordinator-name'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Coordinator name',
                                description:
                                    'Enter the coordinator’s full name as it should appear throughout the platform.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('coordinator-email'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Login email',
                                description:
                                    'Enter the email address that will be linked to the coordinator’s user account.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('coordinator-engagement'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Engagement category',
                                description:
                                    'Specify whether the coordinator is Full-time, Contract or Intern.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('coordinator-branch'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Assigned center',
                                description:
                                    'Choose the coordinator’s primary center. For Center Based coordinators, all programmes attached to this center are assigned automatically.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="coordinator-programs"], [data-guide="coordinator-no-programs"]',
                            waitForElement: 5000,
                            popover: {
                                title: 'Programme scope',
                                description:
                                    'Center Based coordinators receive the selected center’s programmes automatically. National coordinators can manually select programmes across multiple centers.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('coordinator-scope'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Coordinator scope',
                                description:
                                    'Choose Center Based for a coordinator who should only work with programmes attached to their selected center. Choose National when the coordinator needs access to programmes across multiple centers.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-create-coordinator-submit',
                            waitForElement: 5000,
                            popover: {
                                title: 'Create coordinator',
                                description:
                                    'Once the required details are complete, select Create Coordinator to finish the setup.',
                                side: 'top',
                                align: 'end'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    const isQuantilytixViewer = isQuantilytixDomain(user?.email)

    const visibleCoordinators = useMemo(
        () =>
            coordinators.filter(c =>
                isQuantilytixDomain(c.email) ? isQuantilytixViewer : true
            ),
        [coordinators, isQuantilytixViewer]
    )

    const fetchBranches = useCallback(async () => {
        const snapshot = await getDocs(
            collection(db, BRANCHES_COLLECTION)
        )

        setBranches(
            snapshot.docs
                .map(branchDoc => ({
                    id: branchDoc.id,
                    name: String(branchDoc.data()?.name || 'Unnamed Branch')
                }))
                .sort((a, b) => a.name.localeCompare(b.name))
        )
    }, [])

    const fetchPrograms = useCallback(async () => {
        const nextPrograms = await resolveAllPrograms()
        setPrograms(nextPrograms)
    }, [])

    const fetchCoordinators = useCallback(async () => {
        if (!user?.departmentId) {
            setCoordinators([])
            setLoading(false)
            return
        }

        setLoading(true)

        try {
            const [coordinatorsSnap, usersSnap, assignmentsSnap] = await Promise.all([
                getDocs(
                    query(
                        collection(db, COORDINATORS_COLLECTION),
                        where('departmentId', '==', user.departmentId)
                    )
                ),
                getDocs(
                    collection(db, USERS_COLLECTION)
                ),
                getDocs(
                    query(
                        collection(db, ASSIGNED_INTERVENTIONS_COLLECTION),
                        where('departmentId', '==', user.departmentId),
                        ...(activeProgramId
                            ? [where('programId', '==', activeProgramId)]
                            : [])
                    )
                )
            ])

            const usersById = new Map<string, any>()
            const usersByEmail = new Map<string, any>()

            usersSnap.docs.forEach(userDoc => {
                const data = {
                    __id: userDoc.id,
                    ...(userDoc.data() as any)
                }

                usersById.set(userDoc.id, data)

                const email = normalizeString(data.email)
                if (email) usersByEmail.set(email, data)
            })

            const rawCoordinators: Coordinator[] = coordinatorsSnap.docs.map(coordinatorDoc => {
                const data = coordinatorDoc.data() as any
                const linkedUser =
                    usersById.get(String(data.authUid || data.uid || coordinatorDoc.id)) ||
                    usersByEmail.get(normalizeString(data.email)) ||
                    null

                const userAssignedPrograms = cleanArray(linkedUser?.assignedPrograms)
                const mirrorAssignedPrograms = cleanArray(data.assignedPrograms)
                const assignedPrograms = userAssignedPrograms.length
                    ? userAssignedPrograms
                    : mirrorAssignedPrograms

                const assignedBranch =
                    typeof data.assignedBranch === 'object' && data.assignedBranch !== null
                        ? data.assignedBranch
                        : null

                const legacyAssignedBranch =
                    typeof data.assignedBranch === 'string'
                        ? data.assignedBranch
                        : null

                const primaryBranchId =
                    linkedUser?.assignedBranch ||
                    assignedBranch?.id ||
                    data.branchId ||
                    legacyAssignedBranch ||
                    data.branchIds?.[0] ||
                    null

                const primaryBranchName =
                    linkedUser?.assignedBranchName ||
                    assignedBranch?.name ||
                    data.branchName ||
                    data.branchNames?.[0] ||
                    null

                return {
                    id: coordinatorDoc.id,
                    uid: data.uid || linkedUser?.uid || linkedUser?.__id || null,
                    authUid: data.authUid || data.uid || linkedUser?.uid || linkedUser?.__id || null,
                    name: String(data.name || linkedUser?.fullName || linkedUser?.name || ''),
                    email: String(data.email || linkedUser?.email || ''),
                    departmentId: data.departmentId ?? linkedUser?.departmentId ?? null,
                    departmentName: data.departmentName ?? linkedUser?.departmentName ?? null,
                    assignmentsCount: Number(data.assignmentsCount || 0),
                    rating: Number(data.rating || 0),
                    active: data.active !== false && linkedUser?.active !== false,
                    engagementCategory: data.engagementCategory ?? null,
                    branchIds: primaryBranchId ? [primaryBranchId] : [],
                    branchNames: primaryBranchName ? [primaryBranchName] : [],
                    branchId: primaryBranchId,
                    branchName: primaryBranchName,
                    assignedPrograms,
                    isNational: Boolean(
                        linkedUser?.isNational ??
                        data.isNational ??
                        linkedUser?.nationalCoordinator ??
                        data.nationalCoordinator
                    ),
                    nationalCoordinator: Boolean(
                        linkedUser?.nationalCoordinator ?? data.nationalCoordinator
                    ),
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt
                }
            })

            const deduped = dedupeCoordinators(rawCoordinators)

            const withAssignments = deduped.map(item => {
                const possibleIds = new Set(
                    [
                        item.id,
                        item.uid || '',
                        item.authUid || ''
                    ].filter(Boolean)
                )

                const logicalAssignments = new Set<string>()
                const ratings: number[] = []

                for (const snap of assignmentsSnap.docs) {
                    const data = snap.data() as any
                    const assigneeId = String(
                        data.assigneeId || data.coordinatorId || data.assigneeDocId || ''
                    )

                    if (!possibleIds.has(assigneeId)) continue

                    const allocationType = String(data.allocationType || '').toLowerCase()
                    const groupId = String(data.groupId || '').trim()
                    const interventionId = String(data.interventionId || '').trim()
                    const cycleKey = String(data.cycleKey || '').trim()

                    const assignmentKey =
                        allocationType === 'group' && groupId
                            ? `group:${groupId}:${interventionId || 'unknown'}:${cycleKey || 'default'}`
                            : `individual:${snap.id}`

                    logicalAssignments.add(assignmentKey)

                    const candidates = [
                        data.rating,
                        data.clientRating,
                        data.smeRating,
                        data?.feedback?.rating,
                        data?.feedbackRating
                    ]

                    for (const candidate of candidates) {
                        const value = Number(candidate)
                        if (!Number.isNaN(value) && isFinite(value)) {
                            ratings.push(value)
                            break
                        }
                    }
                }

                const avgRating = ratings.length
                    ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
                    : Number(item.rating || 0)

                return {
                    ...item,
                    assignmentsCount: logicalAssignments.size,
                    rating: avgRating
                }
            })

            setCoordinators(withAssignments)
        } catch (error) {
            console.error('Error fetching coordinators:', error)
            message.error('Failed to load coordinators.')
        } finally {
            setLoading(false)
        }
    }, [message, user?.departmentId, activeProgramId])

    useEffect(() => {
        if (identityLoading) return

        if (!user?.departmentId) {
            setLoading(false)
            return
        }

        void fetchBranches()
        void fetchPrograms()
        void fetchCoordinators()
    }, [
        identityLoading,
        user?.departmentId,
        activeProgramId,
        fetchBranches,
        fetchPrograms,
        fetchCoordinators
    ])

    const filteredCoordinators = useMemo(() => {
        const term = normalizeString(searchText)

        return visibleCoordinators.filter(coordinator => {
            const matchesSearch =
                !term ||
                normalizeString(coordinator.name).includes(term) ||
                normalizeString(coordinator.email).includes(term) ||
                normalizeString((coordinator.branchNames || []).join(', ')).includes(term)

            const matchesEngagement = engagementFilter
                ? coordinator.engagementCategory === engagementFilter
                : true

            const matchesStatus =
                statusFilter === 'active'
                    ? coordinator.active
                    : statusFilter === 'inactive'
                        ? !coordinator.active
                        : true

            return matchesSearch && matchesEngagement && matchesStatus
        })
    }, [visibleCoordinators, searchText, engagementFilter, statusFilter])

    const totals = useMemo(() => {
        const total = visibleCoordinators.length
        const active = visibleCoordinators.filter(c => c.active).length
        const averageRating = total
            ? visibleCoordinators.reduce((sum, c) => sum + Number(c.rating || 0), 0) / total
            : 0
        const totalAssignments = visibleCoordinators.reduce(
            (sum, c) => sum + Number(c.assignmentsCount || 0),
            0
        )

        return {
            total,
            active,
            inactive: Math.max(0, total - active),
            averageRating,
            totalAssignments
        }
    }, [visibleCoordinators])

    const addCoordinatorScope =
        Form.useWatch('coordinatorScope', form) || 'center'
    const addCenterId = Form.useWatch('branchId', form)

    const editCoordinatorScope =
        Form.useWatch('coordinatorScope', editForm) || 'center'
    const editCenterId = Form.useWatch('branchId', editForm)

    const getCenterProgramIds = useCallback(
        (centerId?: string) => {
            if (!centerId) return []

            return programs
                .filter(program => String(program.branchId || '') === String(centerId))
                .map(program => program.id)
        },
        [programs]
    )

    const addCenterProgramIds = useMemo(
        () => getCenterProgramIds(addCenterId),
        [addCenterId, getCenterProgramIds]
    )

    const editCenterProgramIds = useMemo(
        () => getCenterProgramIds(editCenterId),
        [editCenterId, getCenterProgramIds]
    )

    const addCenterHasPrograms = addCenterProgramIds.length > 0
    const editCenterHasPrograms = editCenterProgramIds.length > 0

    useEffect(() => {
        if (!addModalVisible || addCoordinatorScope !== 'center') return

        form.setFieldValue('assignedPrograms', addCenterProgramIds)
    }, [
        addModalVisible,
        addCoordinatorScope,
        addCenterProgramIds,
        form
    ])

    useEffect(() => {
        if (!editModalVisible || editCoordinatorScope !== 'center') return

        editForm.setFieldValue('assignedPrograms', editCenterProgramIds)
    }, [
        editModalVisible,
        editCoordinatorScope,
        editCenterProgramIds,
        editForm
    ])

    const resetFilters = () => {
        setSearchText('')
        setEngagementFilter(undefined)
        setStatusFilter(undefined)
    }

    const handleAddCoordinator = async (values: CoordinatorFormValues) => {
        setAdding(true)

        try {
            const depId = user?.departmentId
            const depName = user?.departmentName || 'Department'

            if (!depId) {
                throw new Error('Your department could not be resolved.')
            }

            const idToken = await auth.currentUser?.getIdToken()
            if (!idToken) throw new Error('Not authenticated')

            const branchId = values.branchId!
            const branchName = branches.find(branch => branch.id === branchId)?.name || null
            const isNational = values.coordinatorScope === 'national'
            const assignedPrograms = isNational
                ? cleanArray(values.assignedPrograms)
                : getCenterProgramIds(branchId)

            const payload = {
                email: values.email,
                name: values.name,
                role: "coordinator",
                departmentId: depId,
                departmentName: depName,

                branchId,
                branchName,
                assignedPrograms,

                engagementCategory: values.engagementCategory || null,
                isNational,

                sendEmail: true,
                sendResetLink: true,
                // Existing identities may be converted only after the backend
                // independently verifies that the caller is a system admin.
                allowExisting: true,
            }

            const resp = await fetch(CREATE_USER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify(payload)
            })

            const data = await resp.json().catch(() => null)

            if (!resp.ok || !data?.ok) {
                const backendMessage =
                    data?.message ||
                    data?.error ||
                    data?.details ||
                    `Request failed with status ${resp.status}`

                throw new Error(backendMessage)
            }

            if (!data.uid && !data.user?.uid) {
                throw new Error('Linked user account could not be found.')
            }

            message.success('Coordinator created successfully.')
            form.resetFields()
            setAddModalVisible(false)
            setIsDummyAddMode(false)
            await fetchCoordinators()
        } catch (error: any) {
            console.error(error)
            message.error(
                toUserFriendlyError(error, 'Failed to create coordinator.')
            )
        } finally {
            setAdding(false)
        }
    }

    const handleEditCoordinator = async (values: CoordinatorFormValues) => {
        if (!editingCoordinator) return

        setEditing(true)

        try {
            const depId = user?.departmentId
            const depName = user?.departmentName || 'Department'

            if (!depId) {
                throw new Error('Your department could not be resolved.')
            }

            const branchId = values.branchId!
            const branchName = branches.find(branch => branch.id === branchId)?.name || null
            const isNational = values.coordinatorScope === 'national'
            const assignedPrograms = isNational
                ? cleanArray(values.assignedPrograms)
                : getCenterProgramIds(branchId)
            const nextEmail = normalizeString(values.email)
            const currentEmail = normalizeString(editingCoordinator.email)

            const linkedUserRef = await getLinkedUserRef({
                uid: editingCoordinator.uid,
                authUid: editingCoordinator.authUid,
                email: currentEmail
            })

            if (!linkedUserRef) {
                throw new Error('Linked user account could not be found.')
            }

            const linkedUserId = linkedUserRef.id
            const linkedUserData = (await getDoc(linkedUserRef)).data()
            const authUid = String(
                editingCoordinator.authUid ||
                linkedUserData?.authUid ||
                linkedUserData?.uid ||
                editingCoordinator.uid ||
                linkedUserId
            )
            const emailChanged = nextEmail !== currentEmail

            if (emailChanged) {
                const updateEmail = httpsCallable(functions, 'updateUserEmailCascade')
                await updateEmail({ uid: authUid, newEmail: nextEmail })
            }

            await setDoc(
                linkedUserRef,
                {
                    email: nextEmail,
                    name: values.name,
                    role: 'coordinator',
                    assignedBranch: branchId,
                    assignedBranchName: branchName,
                    assignedPrograms,
                    isNational,
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            )

            await setDoc(
                doc(db, COORDINATORS_COLLECTION, editingCoordinator.id),
                {
                    uid: authUid,
                    authUid,
                    name: values.name,
                    email: nextEmail,
                    role: 'coordinator',
                    departmentId: depId,
                    departmentName: depName,
                    engagementCategory: values.engagementCategory || null,
                    branchId,
                    branchName,
                    assignedBranch: branchId,
                    assignedBranchName: branchName,
                    assignedPrograms,
                    isNational,
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            )

            message.success(
                emailChanged
                    ? 'Coordinator details and login email updated.'
                    : 'Coordinator details updated.'
            )
            setEditModalVisible(false)
            setEditingCoordinator(null)
            editForm.resetFields()
            await fetchCoordinators()
        } catch (error: any) {
            console.error('Error updating coordinator:', error)
            message.error(
                toUserFriendlyError(error, 'Failed to update coordinator.')
            )
        } finally {
            setEditing(false)
        }
    }

    const handleDeleteCoordinator = async (record: Coordinator) => {
        Modal.confirm({
            title: 'Delete Coordinator',
            content: `Are you sure you want to permanently delete "${record.name}" (${record.email})? This cannot be undone.`,
            okText: 'Delete',
            okType: 'danger',
            cancelText: 'Cancel',
            async onOk() {
                try {
                    const deleteUser = httpsCallable(functions, 'deleteUserCascade')
                    await deleteUser({
                        email: record.email,
                        uid: record.authUid || record.uid || undefined,
                        confirm: true
                    })

                    await deleteDoc(doc(db, COORDINATORS_COLLECTION, record.id))

                    message.success('Coordinator deleted successfully.')
                    await fetchCoordinators()
                } catch (error: any) {
                    console.error('Error deleting coordinator:', error)
                    message.error(
                        toUserFriendlyError(error, 'Failed to delete coordinator.')
                    )
                }
            }
        })
    }

    const handleActivateToggle = async (record: Coordinator, checked: boolean) => {
        try {
            await setDoc(
                doc(db, COORDINATORS_COLLECTION, record.id),
                {
                    active: checked,
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            )

            const userRef = await getLinkedUserRef({
                uid: record.uid,
                authUid: record.authUid,
                email: record.email
            })

            if (userRef) {
                await setDoc(
                    userRef,
                    {
                        active: checked,
                        updatedAt: serverTimestamp()
                    },
                    { merge: true }
                )
            }

            setCoordinators(prev =>
                prev.map(item =>
                    item.id === record.id ? { ...item, active: checked } : item
                )
            )

            message.success(`Coordinator ${checked ? 'activated' : 'deactivated'}.`)
        } catch (error) {
            console.error('Error toggling coordinator:', error)
            message.error('Failed to update coordinator.')
        }
    }

    const openEdit = (record: Coordinator) => {
        setEditingCoordinator(record)
        const branchId = record.branchId || record.branchIds?.[0] || undefined

        editForm.setFieldsValue({
            name: record.name,
            email: record.email,
            engagementCategory: record.engagementCategory || undefined,
            branchId,
            assignedPrograms: record.assignedPrograms || [],
            coordinatorScope:
                record.isNational || record.nationalCoordinator
                    ? 'national'
                    : 'center'
        })

        setEditModalVisible(true)
    }

    const programOptions = useMemo(
        () =>
            programs.map(program => ({
                label: program.branchName
                    ? `${program.name} — ${program.branchName}`
                    : program.name,
                value: program.id
            })),
        [programs]
    )

    const columns: ColumnsType<Coordinator> = [
        {
            title: 'Coordinator',
            key: 'coordinator',
            width: 180,
            render: (_, record) => (
                <div style={{ minWidth: 0 }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            minWidth: 0
                        }}
                    >
                        <Text
                            strong
                            ellipsis={{ tooltip: record.name }}
                            style={{
                                flex: 1,
                                minWidth: 0
                            }}
                        >
                            {record.name || 'Unnamed Coordinator'}
                        </Text>

                        {(record.isNational || record.nationalCoordinator) && (
                            <Tag
                                color='purple'
                                style={{
                                    marginInlineEnd: 0,
                                    flex: '0 0 auto',
                                    fontSize: 10,
                                    paddingInline: 5
                                }}
                            >
                                National
                            </Tag>
                        )}
                    </div>

                    <Text
                        type='secondary'
                        ellipsis={{ tooltip: record.email }}
                        style={{
                            display: 'block',
                            fontSize: 12,
                            width: '100%'
                        }}
                    >
                        {record.email}
                    </Text>
                </div>
            )
        },
        {
            title: 'Center',
            key: 'branch',
            width: 95,
            ellipsis: true,
            render: (_, record) => {
                const names = record.branchNames?.length
                    ? record.branchNames
                    : record.branchName
                        ? [record.branchName]
                        : []

                return names.length ? (
                    <Text ellipsis={{ tooltip: names.join(', ') }}>
                        {names.join(', ')}
                    </Text>
                ) : (
                    <Text type='secondary'>—</Text>
                )
            }
        },
        {
            title: 'Programs',
            key: 'programs',
            width: 70,
            align: 'center',
            render: (_, record) => (
                <Tag
                    color={record.assignedPrograms?.length ? 'blue' : 'default'}
                    style={{ marginInlineEnd: 0 }}
                >
                    {record.assignedPrograms?.length || 0}
                </Tag>
            )
        },
        {
            title: 'Assigned',
            dataIndex: 'assignmentsCount',
            key: 'assignmentsCount',
            width: 75,
            align: 'center',
            sorter: (a, b) => a.assignmentsCount - b.assignmentsCount
        },
        {
            title: 'Rating',
            dataIndex: 'rating',
            key: 'rating',
            width: 65,
            align: 'center',
            sorter: (a, b) => a.rating - b.rating,
            render: value => Number(value || 0).toFixed(1)
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 155,
            align: 'center',
            render: (_, record) => (
                <Space
                    data-guide='coordinator-actions'
                    size={4}
                    wrap={false}
                >
                    <Tooltip title='View Performance'>
                        <Button
                            size='middle'
                            shape='circle'
                            icon={<TeamOutlined />}
                            variant='filled'
                            color='blue'
                            onClick={() =>
                                navigate(
                                    `/operations/coordinators/${record.id}/performance`,
                                    {
                                        state: {
                                            coordinatorName: record.name
                                        }
                                    }
                                )
                            }
                        />
                    </Tooltip>

                    <Tooltip title='Edit Coordinator'>
                        <Button
                            size='middle'
                            shape='circle'
                            icon={<EditOutlined />}
                            variant='filled'
                            color='gold'
                            style={{ border: '1px solid gold' }}
                            onClick={() => openEdit(record)}
                        />
                    </Tooltip>

                    <Tooltip title='Delete Coordinator'>
                        <Button
                            size='middle'
                            shape='circle'
                            icon={<DeleteOutlined />}
                            danger
                            variant='filled'
                            onClick={() => handleDeleteCoordinator(record)}
                        />
                    </Tooltip>

                    <Tooltip title={record.active ? 'Active' : 'Inactive'}>
                        <Switch
                            size='small'
                            checked={record.active}
                            onChange={checked =>
                                handleActivateToggle(record, checked)
                            }
                        />
                    </Tooltip>
                </Space>
            )
        }
    ]

    const filterBar = (
        <div data-guide='coordinator-filters'>
            <Row
                gutter={[12, 12]}
                align='middle'
                wrap={false}
                style={{ flexWrap: 'nowrap', overflowX: 'auto' }}
            >
                <Col xs={24} md={10} lg={8}>
                    <Input
                        allowClear
                        value={searchText}
                        onChange={event => setSearchText(event.target.value)}
                        prefix={<SearchOutlined />}
                        placeholder='Search by name, email or branch'
                    />
                </Col>

                <Col xs={24} sm={12} md={7} lg={4}>
                    <Select
                        allowClear
                        value={engagementFilter}
                        onChange={value => setEngagementFilter(value)}
                        placeholder='Engagement'
                        style={{ width: '100%' }}
                        options={[
                            { label: 'Full-time', value: 'Full-time' },
                            { label: 'Contract', value: 'Contract' },
                            { label: 'Intern', value: 'Intern' }
                        ]}
                    />
                </Col>

                <Col xs={24} sm={12} md={7} lg={4}>
                    <Select
                        allowClear
                        value={statusFilter}
                        onChange={value => setStatusFilter(value)}
                        placeholder='Status'
                        style={{ width: '100%' }}
                        options={[
                            { label: 'Active', value: 'active' },
                            { label: 'Inactive', value: 'inactive' }
                        ]}
                    />
                </Col>

                <Col xs={24} lg={8}>
                    <div style={{ display: 'flex', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
                        <Space wrap size={[8, 8]}>
                            <Button
                                size='middle'
                                shape='round'
                                icon={<ClearOutlined />}
                                variant='filled'
                                color='cyan'
                                style={{ border: '1px solid #87e8de' }}
                                onClick={resetFilters}
                            >
                                Reset
                            </Button>

                            <Button
                                size='middle'
                                shape='round'
                                data-guide='add-coordinator'
                                icon={<PlusOutlined />}
                                variant='solid'
                                color='blue'
                                style={{ border: '1px solid #91caff' }}
                                onClick={() => {
                                    form.resetFields()
                                    form.setFieldValue('coordinatorScope', 'center')
                                    setIsDummyAddMode(false)
                                    setAddModalVisible(true)
                                }}
                            >
                                Add Coordinator
                            </Button>

                            {isQuantilytixViewer && (
                                <Button
                                    size='middle'
                                    shape='round'
                                    icon={<EyeInvisibleOutlined />}
                                    variant='solid'
                                    color='purple'
                                    style={{ border: '1px solid #d3adf7' }}
                                    onClick={() => {
                                        form.resetFields()
                                        form.setFieldValue('coordinatorScope', 'center')
                                        setIsDummyAddMode(true)
                                        setAddModalVisible(true)
                                    }}
                                >
                                    Dummy
                                </Button>
                            )}
                        </Space>
                    </div>
                </Col>
            </Row>
        </div>
    )

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Coordinators | Smart Incubation</title>
            </Helmet>

            <Row data-guide='coordinator-metrics' gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} md={12} xl={6}>
                    <MotionCard.Metric
                        icon={<TeamOutlined style={{ color: '#1677ff' }} />}
                        iconBg='rgba(22,119,255,0.12)'
                        title='Total Coordinators'
                        value={totals.total}
                        subtitle='Deduped view'
                    />
                </Col>

                <Col xs={24} md={12} xl={6}>
                    <MotionCard.Metric
                        icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                        iconBg='rgba(82,196,26,0.12)'
                        title='Active Coordinators'
                        value={totals.active}
                        subtitle={`${totals.inactive} inactive`}
                    />
                </Col>

                <Col xs={24} md={12} xl={6}>
                    <MotionCard.Metric
                        icon={<StarOutlined style={{ color: '#faad14' }} />}
                        iconBg='rgba(250,173,20,0.12)'
                        title='Average Rating'
                        value={totals.averageRating.toFixed(1)}
                        subtitle='Across visible coordinators'
                    />
                </Col>

                <Col xs={24} md={12} xl={6}>
                    <MotionCard.Metric
                        icon={<UserSwitchOutlined style={{ color: '#722ed1' }} />}
                        iconBg='rgba(114,46,209,0.12)'
                        title='Assignments'
                        value={totals.totalAssignments}
                        subtitle='Mapped across all assignees'
                    />
                </Col>
            </Row>

            <MotionCard
                style={{ width: '100%' }}
                filterBar={filterBar}
                filterBarProps={{
                    background: '#f8fafc',
                    borderColor: '#d9e8ff',
                    borderRadius: 14,
                    boxShadow: 'inset 0 2px 8px rgba(15,23,42,0.05)',
                    padding: 16
                }}
            >
                <Space direction='vertical' size={16} style={{ width: '100%' }}>
                    <div data-guide='coordinators-table'>
                        <Table<Coordinator>
                            size='small'
                            tableLayout='fixed'
                            rowKey={record => record.authUid || record.uid || record.id}
                            columns={columns}
                            dataSource={filteredCoordinators}
                            loading={loading}
                            pagination={{
                                pageSize: 8,
                                showSizeChanger: false,
                                position: ['bottomCenter']
                            }}
                            locale={{
                                emptyText: (
                                    <Empty
                                        description={
                                            searchText || engagementFilter || statusFilter
                                                ? 'No coordinators match your current filters'
                                                : 'No coordinators found'
                                        }
                                    />
                                )
                            }}
                        />
                    </div>
                </Space>
            </MotionCard>

            <Modal
                className='guide-add-coordinator-modal'
                title={isDummyAddMode ? 'Add Dummy Coordinator (Internal Only)' : 'Add New Coordinator'}
                open={addModalVisible}
                onCancel={() => {
                    setAddModalVisible(false)
                    setIsDummyAddMode(false)
                    form.resetFields()
                }}
                onOk={() => form.submit()}
                okText='Create Coordinator'
                okButtonProps={{
                    className: 'guide-create-coordinator-submit',
                    icon: <PlusOutlined />,
                    loading: adding
                }}
                centered
                destroyOnClose
                width={720}
                styles={{ body: { maxHeight: '70vh', overflowY: 'auto', overflowX: 'hidden' } }}
            >
                <Form<CoordinatorFormValues>
                    form={form}
                    layout='vertical'
                    initialValues={{ coordinatorScope: 'center' }}
                    onFinish={handleAddCoordinator}
                >
                    {isDummyAddMode && (
                        <Text type='secondary' style={{ display: 'block', marginBottom: 12 }}>
                            This coordinator will only be visible to @quantilytix.co.za users. The
                            email address must be on the quantilytix.co.za domain.
                        </Text>
                    )}

                    <Row gutter={12}>
                        <Col xs={24} md={12}>
                            <div data-guide='coordinator-name'>
                                <Form.Item
                                    name='name'
                                    label='Name'
                                    rules={[{ required: true, message: 'Please enter coordinator name' }]}
                                >
                                    <Input placeholder='Enter full name' />
                                </Form.Item>
                            </div>
                        </Col>

                        <Col xs={24} md={12}>
                            <div data-guide='coordinator-email'>
                                <Form.Item
                                    name='email'
                                    label='Email'
                                    rules={[
                                        { required: true, message: 'Please enter coordinator email' },
                                        { type: 'email', message: 'Enter a valid email address' },
                                        ...(isDummyAddMode
                                            ? [
                                                {
                                                    validator: (_: unknown, value: string) =>
                                                        isQuantilytixDomain(value)
                                                            ? Promise.resolve()
                                                            : Promise.reject(
                                                                new Error(
                                                                    'Dummy coordinators must use a @quantilytix.co.za email address'
                                                                )
                                                            )
                                                }
                                            ]
                                            : [])
                                    ]}
                                >
                                    <Input prefix={<MailOutlined />} placeholder='Enter email address' />
                                </Form.Item>
                            </div>
                        </Col>
                    </Row>

                    <Row gutter={12}>
                        <Col xs={24} md={12}>
                            <div data-guide='coordinator-engagement'>
                                <Form.Item
                                    name='engagementCategory'
                                    label='Engagement Category'
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Please select engagement category'
                                        }
                                    ]}
                                >
                                    <Select
                                        placeholder='Select engagement category'
                                        options={[
                                            { label: 'Full-time', value: 'Full-time' },
                                            { label: 'Contract', value: 'Contract' },
                                            { label: 'Intern', value: 'Intern' }
                                        ]}
                                    />
                                </Form.Item>
                            </div>
                        </Col>

                        <Col xs={24} md={12}>
                            <div data-guide='coordinator-scope'>
                                <Form.Item
                                    name='coordinatorScope'
                                    label='Coordinator Scope'
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Please select coordinator scope'
                                        }
                                    ]}
                                >
                                    <Select
                                        options={[
                                            { label: 'Center Based', value: 'center' },
                                            { label: 'National', value: 'national' }
                                        ]}
                                    />
                                </Form.Item>
                            </div>
                        </Col>
                    </Row>

                    <Row gutter={12}>
                        <Col
                            xs={24}
                            md={
                                addCoordinatorScope === 'center' &&
                                    addCenterId &&
                                    !addCenterHasPrograms
                                    ? 24
                                    : 12
                            }
                        >
                            <div data-guide='coordinator-branch'>
                                <Form.Item
                                    name='branchId'
                                    label='Center'
                                    rules={[{ required: true, message: 'Please select a center' }]}
                                >
                                    <Select
                                        placeholder='Select center'
                                        showSearch
                                        optionFilterProp='label'
                                        options={branches.map(branch => ({
                                            label: branch.name,
                                            value: branch.id
                                        }))}
                                    />
                                </Form.Item>
                            </div>
                        </Col>

                        {!(
                            addCoordinatorScope === 'center' &&
                            addCenterId &&
                            !addCenterHasPrograms
                        ) && (
                                <Col xs={24} md={12}>
                                    <div data-guide='coordinator-programs'>
                                        <Form.Item
                                            name='assignedPrograms'
                                            label={
                                                addCoordinatorScope === 'center'
                                                    ? 'Assigned Programs (Automatic)'
                                                    : 'Assigned Programs'
                                            }
                                        >
                                            <Select
                                                mode='multiple'
                                                placeholder={
                                                    addCoordinatorScope === 'center'
                                                        ? 'Programs assigned from selected center'
                                                        : 'Select program(s)'
                                                }
                                                showSearch
                                                optionFilterProp='label'
                                                maxTagCount='responsive'
                                                disabled={addCoordinatorScope === 'center'}
                                                options={programOptions}
                                            />
                                        </Form.Item>
                                    </div>
                                </Col>
                            )}
                    </Row>

                    {addCoordinatorScope === 'center' &&
                        addCenterId &&
                        !addCenterHasPrograms && (
                            <div
                                data-guide='coordinator-no-programs'
                                style={{ marginBottom: 16 }}
                            >
                                <Alert
                                    type='info'
                                    showIcon
                                    message='Center currently has no programs'
                                    description='This coordinator will be center based, but no programs are currently attached to the selected center.'
                                />
                            </div>
                        )}
                </Form>
            </Modal>

            <Modal
                title='Edit Coordinator'
                open={editModalVisible}
                onCancel={() => {
                    setEditModalVisible(false)
                    setEditingCoordinator(null)
                }}
                onOk={() => editForm.submit()}
                okText='Save Changes'
                okButtonProps={{
                    icon: <EditOutlined />,
                    loading: editing
                }}
                centered
                destroyOnClose
                width={720}
                styles={{ body: { maxHeight: '70vh', overflowY: 'auto', overflowX: 'hidden' } }}
            >
                <Form<CoordinatorFormValues>
                    form={editForm}
                    layout='vertical'
                    onFinish={handleEditCoordinator}
                >
                    <Row gutter={12}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='name'
                                label='Name'
                                rules={[{ required: true, message: 'Please enter coordinator name' }]}
                            >
                                <Input placeholder='Enter full name' />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                name='email'
                                label='Email'
                                rules={[
                                    { required: true, message: 'Please enter coordinator email' },
                                    { type: 'email', message: 'Enter a valid email address' }
                                ]}
                            >
                                <Input prefix={<MailOutlined />} placeholder='Enter email address' />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={12}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='engagementCategory'
                                label='Engagement Category'
                                rules={[
                                    {
                                        required: true,
                                        message: 'Please select engagement category'
                                    }
                                ]}
                            >
                                <Select
                                    placeholder='Select engagement category'
                                    options={[
                                        { label: 'Full-time', value: 'Full-time' },
                                        { label: 'Contract', value: 'Contract' },
                                        { label: 'Intern', value: 'Intern' }
                                    ]}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                name='coordinatorScope'
                                label='Coordinator Scope'
                                rules={[
                                    {
                                        required: true,
                                        message: 'Please select coordinator scope'
                                    }
                                ]}
                            >
                                <Select
                                    options={[
                                        { label: 'Center Based', value: 'center' },
                                        { label: 'National', value: 'national' }
                                    ]}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={12}>
                        <Col
                            xs={24}
                            md={
                                editCoordinatorScope === 'center' &&
                                    editCenterId &&
                                    !editCenterHasPrograms
                                    ? 24
                                    : 12
                            }
                        >
                            <Form.Item
                                name='branchId'
                                label='Center'
                                rules={[{ required: true, message: 'Please select a center' }]}
                            >
                                <Select
                                    placeholder='Select center'
                                    showSearch
                                    optionFilterProp='label'
                                    options={branches.map(branch => ({
                                        label: branch.name,
                                        value: branch.id
                                    }))}
                                />
                            </Form.Item>
                        </Col>

                        {!(
                            editCoordinatorScope === 'center' &&
                            editCenterId &&
                            !editCenterHasPrograms
                        ) && (
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        name='assignedPrograms'
                                        label={
                                            editCoordinatorScope === 'center'
                                                ? 'Assigned Programs (Automatic)'
                                                : 'Assigned Programs'
                                        }
                                    >
                                        <Select
                                            mode='multiple'
                                            placeholder={
                                                editCoordinatorScope === 'center'
                                                    ? 'Programs assigned from selected center'
                                                    : 'Select program(s)'
                                            }
                                            showSearch
                                            optionFilterProp='label'
                                            maxTagCount='responsive'
                                            disabled={editCoordinatorScope === 'center'}
                                            options={programOptions}
                                        />
                                    </Form.Item>
                                </Col>
                            )}
                    </Row>

                    {editCoordinatorScope === 'center' &&
                        editCenterId &&
                        !editCenterHasPrograms && (
                            <div style={{ marginBottom: 16 }}>
                                <Alert
                                    type='info'
                                    showIcon
                                    message='Center currently has no programs'
                                    description='This coordinator will be center based, but no programs are currently attached to the selected center.'
                                />
                            </div>
                        )}
                </Form>
            </Modal>
        </div>
    )
}

export default CoordinatorsPage
