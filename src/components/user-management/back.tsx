// UserManagement.tsx
import React, { useState, useEffect } from 'react'
import {
    Table,
    Button,
    Space,
    Tag,
    Modal,
    Form,
    Input,
    Select,
    Switch,
    message,
    Popconfirm,
    Tooltip,
    Alert,
    InputNumber,
    Card,
    Row,
    Col,
    Grid,
    List,
    Divider
} from 'antd'
import {
    UserAddOutlined,
    EditOutlined,
    DeleteOutlined,
    LockFilled,
    LoadingOutlined,
    ReloadOutlined,
    PullRequestOutlined,
    UserOutlined,
    SmileOutlined,
    FrownOutlined,
    TeamOutlined,
    CloseOutlined
} from '@ant-design/icons'
import {
    collection,
    query,
    onSnapshot,
    doc,
    setDoc,
    updateDoc,
    addDoc,
    getDocs,
    where,
    limit,
    documentId
} from 'firebase/firestore'
import { db, auth } from '@/firebase'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase'
import { branchService } from '@/services/branchService'
import { departmentService } from '@/services/departmentService'
import AdminPasswordResetModal from './AdminPasswordResetModal'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { Helmet } from 'react-helmet'
import { LoadingOverlay } from '../shared/LoadingOverlay'
import { MotionCard } from '../dashboards/metrics/Header'

const { Search } = Input

interface User {
    id: string
    name: string
    email: string
    role: string
    status: 'Active' | 'Inactive'
    createdAt?: string
    assignedBranch?: string
    departmentId?: string
    departmentName?: string
    digitalSignature?: string

    assignedPrograms?: string[]
    engagementCategory?: 'Full-time' | 'Contract' | 'Intern' | null
    nationalCoordinator?: boolean
}

const BRANCH_SCOPED_ROLES = ['Center Coordinator', 'Receptionist', 'Employee']

const DEPARTMENT_SCOPED_ROLES = [
    'Head Of Department',
    'Project Manager',
    'Coordinator'
]

// deterministic-ish cryptographic fingerprint for the user
const generateDigitalSignature = async (seed: string) => {
    const nonceArr = new Uint32Array(1)
    window.crypto.getRandomValues(nonceArr)
    const payload = `${seed}|${Date.now()}|${nonceArr[0]}`
    const bytes = new TextEncoder().encode(payload)
    const hashBuf = await window.crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    return hash
}

// UI ↔ backend role mapping
const ROLE_DISPLAY_MAP: Record<string, string> = {
    system_admin: 'System Admin',
    projectadmin: 'Center Coordinator',
    operations: 'Head Of Department',
    coordinator: 'Coordinator',
    consultant: 'Coordinator',
    employee: 'Employee',
    auxiliary: 'Employee'
}
const ROLE_BACKEND_MAP: Record<string, string> = {
    'System Admin': 'admin',
    'Center Coordinator': 'projectadmin',
    'Head Of Department': 'operations',
    Coordinator: 'coordinator',
    Employee: 'employee'
}

const AVAILABLE_ROLES = [
    'Director',
    'System Admin',
    'Head Of Department',
    'Incubatee',
    'Funder',
    'Coordinator',
    'Center Coordinator',
    'Receptionist',
    'Employee',
    'Project Manager'
]

const HR_MANAGED_ROLES = [
    'Head Of Department',
    'Project Manager',
    'Coordinator',
    'Center Coordinator',
    'Receptionist',
    'Employee'
]

export const UserManagement: React.FC = () => {
    const { user } = useFullIdentity()
    const [users, setUsers] = useState<User[]>([])
    const [directorCompanies, setDirectorCompanies] = useState<
        Array<{ code: string; label: string }>
    >([])
    const [branches, setBranches] = useState<any[]>([])
    const [departments, setDepartments] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [isEditMode, setIsEditMode] = useState(false)
    const [currentUser, setCurrentUser] = useState<User | null>(null)
    const [searchText, setSearchText] = useState('')
    const [resetPasswordModalVisible, setResetPasswordModalVisible] =
        useState(false)
    const [resetPasswordEmail, setResetPasswordEmail] = useState('')
    const [selectedRole, setSelectedRole] = useState('')
    const [resetAdminPasswordModalVisible, setResetAdminPasswordModalVisible] =
        useState(false)
    const [resetUserId, setResetUserId] = useState<string | null>(null)
    const [form] = Form.useForm()

    const [savingUser, setSavingUser] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md // phones & small tablets

    // ✅ Programs dropdown options (scoped)
    const [selectablePrograms, setSelectablePrograms] = useState<
        Array<{ id: string; name?: string; title?: string; programName?: string; }>
    >([])
    const [programsLoading, setProgramsLoading] = useState(false)

    const ROLE_ASSIGNMENTS: Record<string, string[]> = {
        // ✅ Allow projectadmin to add Funders (hard permission enforced in submit)
        projectadmin: ['Receptionist', 'Employee', 'Head Of Department', 'Funder'],
        operations: ['Coordinator', 'Project Manager', 'Employee'],
        hr: HR_MANAGED_ROLES
    }

    const uniqBy = <T, K extends keyof any>(arr: T[], key: (x: T) => K) => {
        const m = new Map<K, T>()
        for (const it of arr) m.set(key(it), it)
        return [...m.values()]
    }

    const CONSULTANT_EXPERTISE = [
        'Strategy',
        'Marketing',
        'Finance',
        'Technology',
        'Operations',
        'HR',
        'Compliance'
    ]

    const friendlyApiError = (code?: string) => {
        if (!code) {
            return 'Something went wrong. Please try again.'
        }

        // Normalise so we can be a bit loose with what the backend sends
        const normalized = code.toLowerCase().trim()

        switch (normalized) {
            case 'method_not_allowed':
                return 'This action is not allowed.'
            case 'missing_id_token':
                return 'You are not signed in. Please sign in and try again.'
            case 'permission_denied':
                return 'You do not have permission to perform this action.'
            case 'existing_user_conversion_requires_system_admin':
                return 'Only a user with the system_admin role can convert an existing user into a coordinator.'
            case 'uid_or_email_required':
                return 'A UID or email is required to process this request.'
            case 'user_not_found':
                return 'We could not find that user.'
            case 'cross_company_delete_forbidden':
                return 'You can only manage users in your own company.'
            case 'cannot_delete_self':
                return 'You cannot delete your own account.'
            case 'delete_failed':
                return 'We could not delete the user. Please try again.'
            case 'create_failed':
                return 'We could not create the user. Please check the details and try again.'
            case 'email_already_exists':
            case 'auth/email-already-exists':
                return 'This email is already registered on the platform.'
            case 'invalid_role':
            case 'invalid_role_for_creator':
                return 'You are not allowed to assign that role. Please choose a different role.'
            case 'invalid_company_code':
                return 'The selected company is not valid for your account.'
            case 'internal_error':
                return 'Something went wrong on our side. Please try again.'
            default:
                // Fall back to a generic message but don’t show weird internal codes
                return 'Something went wrong while processing this request. Please try again.'
        }
    }

    // Detect whether the current user's department is marked as "main"
    const isMainDepartmentUser = React.useMemo(() => {
        if (!user) return false
        if ((user as any)?.departmentIsMain === true) return true
        if ((user as any)?.isMainDepartment === true) return true
        const uDept = (user as any)?.department || {}
        if (
            uDept?.isMain === true ||
            uDept?.is_main === true ||
            uDept?.isPrimary === true ||
            uDept?.primary === true
        ) {
            return true
        }
        if (user?.departmentId) {
            const dep = departments.find(d => d.id === user.departmentId) || {}
            const flag =
                (dep as any).isMain ??
                (dep as any).is_main ??
                (dep as any).isPrimary ??
                (dep as any).primary
            if (flag === true) return true
        }
        return false
    }, [user, departments])

    // Detect whether this user is the MAIN Center Coordinator (branch isMain = true)
    const isMainCenterCoordinator = React.useMemo(() => {
        if (!user) return false

        const myRole = (user.role || '').toLowerCase()
        if (myRole !== 'projectadmin') return false

        const assignedBranchId =
            (user as any).assignedBranch ||
            (user as any).branchId ||
            null

        if (!assignedBranchId) return false

        const branch = branches.find(b => b.id === assignedBranchId)
        if (!branch) return false

        const flag =
            (branch as any).isMain ??
            (branch as any).is_main ??
            (branch as any).isPrimary ??
            (branch as any).primary

        return flag === true
    }, [user, branches])

    const displayRoleOf = (u: User) => {
        const key = (u.role || '').toLowerCase()
        return (
            ROLE_DISPLAY_MAP[key] ||
            (u.role || '').charAt(0).toUpperCase() + (u.role || '').slice(1)
        )
    }

    const isIncubateeRole = (role?: string) =>
        (role || '').toLowerCase() === 'incubatee'

    const isIncubateeUser = (u: User) => {
        const disp = ROLE_DISPLAY_MAP[(u.role || '').toLowerCase()] || u.role || ''
        return isIncubateeRole(disp)
    }

    const branchNameOf = (branchesArr: any[], id?: string) =>
        branchesArr.find(b => b.id === id)?.name || id || ''

    const showAdminPasswordResetModal = (userId: string) => {
        setResetUserId(userId)
        setResetAdminPasswordModalVisible(true)
    }

    const getFriendlyFirebaseError = (errorCode: string): string => {
        const map: Record<string, string> = {
            'auth/email-already-in-use':
                'This email is already registered. Try logging in instead.',
            'auth/invalid-email':
                'The email address is not valid. Please check and try again.',
            'auth/user-not-found': 'No account found with this email.',
            'auth/wrong-password': 'Incorrect password. Please try again.',
            'auth/weak-password': 'Password too weak. Use at least 6 characters.',
            'auth/network-request-failed': 'Network error. Check your connection.',
            'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
            'auth/internal-error': 'Something went wrong. Please try again shortly.'
        }
        return map[errorCode] || 'Unexpected error. Please try again.'
    }

    const HIDE_DOMAIN = 'quantilytix.co.za'
    const isHiddenDomainEmail = (email?: string) =>
        !!email && email.toLowerCase().endsWith(`@${HIDE_DOMAIN}`)

    const isAdmin = (me: any) => {
        const role = (me?.role || '').toLowerCase()
        return role === 'admin'
    }

    const shouldHideRow = (me: any, email?: string) => {
        if (!email) return false
        if (isAdmin(me)) return false
        return isHiddenDomainEmail(email)
    }

    const shouldRedactEmail = (me: any, email?: string) => {
        if (!email) return false
        if (isAdmin(me)) return false
        return email.toLowerCase().endsWith(`@${HIDE_DOMAIN}`)
    }
    const displayEmail = (me: any, email?: string) =>
        shouldRedactEmail(me, email) ? '— hidden —' : email || ''

    const isSuperUser = (me: any) => {
        const role = (me?.role || '').toLowerCase()
        return role === 'admin'
    }

    const canUseSystemTools = isAdmin(user)

    const getAssignableRoles = (): string[] => {
        const role = (user?.role || '').toLowerCase()
        const deptName = (user?.departmentName || '').toLowerCase()
        const isHrDepartment =
            role === 'hr' ||
            deptName.startsWith('hrm') ||
            deptName.includes('human resources')

        if (isHrDepartment && !isAdmin(user)) {
            return HR_MANAGED_ROLES
        }

        // Full power: Admin, Director, or another main department user
        if (
            isAdmin(user) ||
            role === 'director' ||
            isMainDepartmentUser
        ) {
            return isAdmin(user)
                ? AVAILABLE_ROLES
                : AVAILABLE_ROLES.filter(roleName => roleName !== 'Coordinator')
        }

        // 🔹 Main Center Coordinator = normal CC scope + can assign other CCs
        if (role === 'projectadmin' && isMainCenterCoordinator) {
            return [...ROLE_ASSIGNMENTS.projectadmin, 'Center Coordinator']
        }

        return ROLE_ASSIGNMENTS[role] || []
    }

    const assignableRoles = React.useMemo(
        () => getAssignableRoles(),
        [user, isMainDepartmentUser, isMainCenterCoordinator, departments]
    )

    // Who I can SEE in the table (this drives metrics too)
    const canSeeUser = (me: any, u: User): boolean => {
        const superUser = isSuperUser(me)
        if (superUser) return true


        if (isMainDepartmentUser) {
            if (!isAdmin(me) && isIncubateeUser(u)) return false
            return true
        }

        const myRole = (me?.role || '').toLowerCase()
        const displayRole = (
            ROLE_DISPLAY_MAP[(u.role || '').toLowerCase()] ||
            (u.role || '').charAt(0).toUpperCase() + (u.role || '').slice(1)
        ).toLowerCase()

        const allowedRoles = assignableRoles.map(r => r.toLowerCase())
        if (!allowedRoles.includes(displayRole)) return false

        if (myRole === 'projectadmin') {
            if (displayRole === 'receptionist' || displayRole === 'auxiliary') {
                return !!me?.assignedBranch && u.assignedBranch === me.assignedBranch
            }
            return true
        }

        if (myRole === 'operations') {
            if (!me?.departmentId) return false
            return u.departmentId === me.departmentId
        }

        return true
    }

    const canManageUser = (me: any, u: User) => canSeeUser(me, u)

    useEffect(() => {
        const isElevated =
            isAdmin(user) ||
            (user?.role || '').toLowerCase() === 'director' ||
            isMainDepartmentUser
        if (!isElevated) return
            ; (async () => {
                try {
                    // pull directors from your tenant first; if you’re a true super admin with no company lock, show all
                    const baseQ =
                        isSuperUser(user) && !user?.companyCode
                            ? query(collection(db, 'users'), where('role', '==', 'director'))
                            : query(
                                collection(db, 'users'),
                                where('role', '==', 'director'),
                                where('companyCode', '==', user?.companyCode || '')
                            )

                    const snap = await getDocs(baseQ)
                    const raw = snap.docs.map(d => {
                        const data = d.data() as any
                        const code = data.companyCode || ''
                        const name = data.companyName || data.company || '' // support optional naming if present
                        const label = name ? `${name} (${code})` : code
                        return { code, label }
                    })

                    setDirectorCompanies(
                        uniqBy(
                            raw.filter(x => !!x.code),
                            x => x.code
                        )
                    )
                } catch (e) {
                    console.warn('Failed to load director companies', e)
                }
            })()
    }, [user?.role, isMainDepartmentUser])

    // load branches/departments once
    useEffect(() => {
        const load = async () => {
            try {
                const [branchesData, departmentsData] = await Promise.all([
                    branchService.getAllBranches(),
                    departmentService.getAllDepartments()
                ])
                setBranches(branchesData)
                setDepartments(departmentsData)
            } catch (e) {
                console.error('UserManagement: Error fetching refs:', e)
                message.error('Failed to load branches/departments.')
            }
        }
        load()
    }, [])

    // ✅ Load selectable programs (company-scoped; CC uses user.assignedPrograms)
    useEffect(() => {
        const chunk = <T,>(arr: T[], size: number) => {
            const out: T[][] = []
            for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
            return out
        }

        const loadPrograms = async () => {
            if (!user) return
            const myRole = (user?.role || '').toLowerCase()
            const companyCode = user?.companyCode || ''

            setProgramsLoading(true)
            try {
                // Admin/Director/MainDept: all programs in company
                if (isAdmin(user) || myRole === 'director' || isMainDepartmentUser) {
                    const qAll = query(collection(db, 'programs'))

                    const snap = await getDocs(qAll)
                    const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                    setSelectablePrograms(all)
                    return
                }

                // ProjectAdmin: ONLY programs whose ids are on user.assignedPrograms
                if (myRole === 'projectadmin') {
                    // Try identity first
                    let myProgramIds: string[] = Array.isArray((user as any)?.assignedPrograms)
                        ? ((user as any)?.assignedPrograms as string[])
                        : []

                    // Fallback: fetch from users collection by email if identity missing assignedPrograms
                    if (!myProgramIds.length && user?.email) {
                        const uq = query(
                            collection(db, 'users'),
                            where('email', '==', user.email),
                            limit(1)
                        )
                        const usnap = await getDocs(uq)
                        if (!usnap.empty) {
                            const udata = usnap.docs[0].data() as any
                            if (Array.isArray(udata?.assignedPrograms)) {
                                myProgramIds = udata.assignedPrograms
                            }
                        }
                    }

                    if (!myProgramIds.length) {
                        setSelectablePrograms([])
                        return
                    }

                    const batches = chunk(myProgramIds, 10)
                    const results: any[] = []

                    for (const ids of batches) {
                        // NOTE: documentId IN (max 10). We avoid adding companyCode filter here to reduce index risk,
                        // then client-filter by companyCode if present.
                        const pq = query(
                            collection(db, 'programs'),
                            where(documentId(), 'in', ids)
                        )
                        const psnap = await getDocs(pq)
                        results.push(...psnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
                    }

                    const filtered = companyCode
                        ? results.filter(p => !p.companyCode || p.companyCode === companyCode)
                        : results

                    setSelectablePrograms(filtered)
                    return
                }

                // Others: keep empty (unchanged behavior)
                setSelectablePrograms([])
            } catch (e) {
                console.warn('Failed to load programs', e)
                setSelectablePrograms([])
            } finally {
                setProgramsLoading(false)
            }
        }

        loadPrograms()
    }, [user?.role, user?.email, isMainDepartmentUser])

    // live users list (already company-scoped at the query when not super)
    useEffect(() => {
        const isSuper = isSuperUser(user)

        if (!isSuper && !user?.companyCode) return

        const usersQ = isSuper
            ? query(collection(db, 'users'))
            : query(
                collection(db, 'users'),
                where('companyCode', '==', user!.companyCode)
            )

        setLoading(true)
        const unsub = onSnapshot(
            usersQ,
            snap => {
                const list = snap.docs.map(d => {
                    const data = d.data() as any
                    return {
                        id: d.id,
                        ...data,
                        companyCode: data.companyCode || null,
                        createdAt: data.createdAt?.toDate
                            ? data.createdAt.toDate().toISOString()
                            : typeof data.createdAt === 'string'
                                ? data.createdAt
                                : new Date().toISOString(),
                        status: data.status || 'Active',
                        assignedPrograms: Array.isArray(data.assignedPrograms)
                            ? data.assignedPrograms
                            : []
                    } as User
                })
                setUsers(list)
                setLoading(false)
            },
            () => setLoading(false)
        )
        return () => unsub()
    }, [user?.role, user?.admin])

    // open modal for create/edit
    const showModal = async (edit = false, u: User | null = null) => {
        setIsEditMode(edit)
        setCurrentUser(u)
        setIsModalVisible(true)

        if (edit && u) {
            const displayRole = displayRoleOf(u)
            setSelectedRole(displayRole)

            // base prefill
            form.setFieldsValue({
                name: u.name,
                email: u.email,
                role: displayRole,
                assignedBranch: u.assignedBranch,
                departmentId: u.departmentId,
                status: u.status === 'Active',
                assignedPrograms: Array.isArray(u.assignedPrograms) ? u.assignedPrograms : [],
                engagementCategory: u.engagementCategory || undefined,
                nationalCoordinator: Boolean(u.nationalCoordinator)
            })

            // if consultant, also prefill expertise/rate/type/... from /consultants
            if (displayRole === 'Consultant') {
                const qs = await getDocs(
                    query(
                        collection(db, 'consultants'),
                        where('email', '==', u.email),
                        where('companyCode', '==', user?.companyCode || '')
                    )
                )
                if (!qs.empty) {
                    const data = qs.docs[0].data() as any
                    form.setFieldsValue({
                        expertise: data.expertise || [],
                        rate: typeof data.rate === 'number' ? data.rate : undefined,
                        type: data.type || undefined,
                        engagementCategory: data.engagementCategory || undefined,
                        internalRole: data.internalRole || undefined,
                        branchId: data.branchId || undefined
                    })
                }
            }
        } else {
            form.resetFields()
            setSelectedRole('')
            form.setFieldsValue({ status: true })
        }
    }

    // role change -> clear irrelevant assignments
    const handleRoleChange = (role: string) => {
        setSelectedRole(role)

        if (!BRANCH_SCOPED_ROLES.includes(role)) {
            form.setFieldsValue({ assignedBranch: undefined })
        }
        // Dept picker should NOT show for Consultant (locked to current user's dept)
        if (!DEPARTMENT_SCOPED_ROLES.includes(role) || role === 'Consultant') {
            form.setFieldsValue({ departmentId: undefined })
        }
        if (role !== 'Consultant') {
            form.setFieldsValue({
                expertise: undefined,
                rate: undefined,
                type: undefined,
                engagementCategory: undefined,
                internalRole: undefined,
                branchId: undefined
            })
        }

        // Funders and coordinators both support program assignments.
        if (role !== 'Funder' && role !== 'Coordinator') {
            form.setFieldsValue({ assignedPrograms: undefined })
        }
    }

    const upsertOperationsStaff = async ({
        email,
        name,
        departmentId,
        departmentName,
        digitalSignature
    }: {
        email: string
        name: string
        departmentId?: string
        departmentName?: string
        digitalSignature?: string
    }) => {
        const qs = await getDocs(
            query(
                collection(db, 'operationsStaff'),
                where('email', '==', email),
                where('companyCode', '==', user?.companyCode || '')
            )
        )

        if (qs.empty) {
            await addDoc(collection(db, 'operationsStaff'), {
                email,
                name,
                companyCode: user?.companyCode || '',
                departmentId: departmentId || null,
                departmentName: departmentName || null,
                digitalSignature: digitalSignature || null,
                createdAt: new Date()
            })
        } else {
            await setDoc(
                doc(db, 'operationsStaff', qs.docs[0].id),
                {
                    name,
                    departmentId: departmentId || null,
                    departmentName: departmentName || null,
                    digitalSignature: digitalSignature || null,
                    updatedAt: new Date()
                },
                { merge: true }
            )
        }
    }

    const upsertConsultant = async ({
        email,
        name,
        departmentId,
        departmentName,
        digitalSignature,
        authUid,
        expertise,
        rate,
        type,
        engagementCategory,
        internalRole,
        branchId
    }: {
        email: string
        name: string
        departmentId?: string | null
        departmentName?: string | null
        digitalSignature?: string | null
        authUid?: string | null
        expertise?: string[]
        rate?: number
        type?: 'Internal' | 'External'
        engagementCategory?: 'Full-time' | 'Contract' | 'Intern' | null
        internalRole?: 'Coordinator' | 'Consultant' | null
        branchId?: string | null
    }) => {
        const companyCode = user?.companyCode || ''
        const qs = await getDocs(
            query(
                collection(db, 'consultants'),
                where('email', '==', email),

            )
        )

        const branchName = branchId
            ? branches.find(b => b.id === branchId)?.name || null
            : null

        const base = {
            email,
            name,
            companyCode,
            departmentId: departmentId ?? null,
            departmentName: departmentName ?? null,
            digitalSignature: digitalSignature ?? null,
            authUid: authUid ?? null,
            updatedAt: new Date().toISOString()
        }

        const payload: any = {
            ...base,
            ...(Array.isArray(expertise) ? { expertise } : {}),
            ...(typeof rate === 'number' ? { rate } : {}),
            ...(type ? { type } : {}),
            engagementCategory: engagementCategory ?? null,
            internalRole: type === 'Internal' ? internalRole ?? null : null,
            branchId:
                type === 'Internal' && internalRole === 'Coordinator'
                    ? branchId ?? null
                    : null,
            branchName:
                type === 'Internal' && internalRole === 'Coordinator'
                    ? branchName
                    : null
        }

        if (qs.empty) {
            await addDoc(collection(db, 'consultants'), {
                ...payload,
                assignmentsCount: 0,
                rating: 0,
                active: true,
                createdAt: new Date().toISOString()
            })
        } else {
            await setDoc(doc(db, 'consultants', qs.docs[0].id), payload, {
                merge: true
            })
        }
    }

    // create/update handler
    const handleSubmit = async (values: any) => {
        setSavingUser(true)
        try {
            if (!isAdmin(user) && values?.role === 'Incubatee') {
                message.error(
                    'You do not have permission to assign the Incubatee role.'
                )
                setSavingUser(false)
                return
            }

            // ✅ Funders must have at least 1 program
            if (values?.role === 'Funder') {
                const sel: string[] = Array.isArray(values?.assignedPrograms)
                    ? values.assignedPrograms
                    : []
                if (!sel.length) {
                    message.error('Please select at least 1 program for this funder.')
                    setSavingUser(false)
                    return
                }

                // ✅ projectadmin can only assign funders to their own programs
                const myRole = (user?.role || '').toLowerCase()
                if (myRole === 'projectadmin') {
                    const allowed = new Set(selectablePrograms.map(p => p.id))
                    const outOfScope = sel.filter(id => !allowed.has(id))
                    if (outOfScope.length) {
                        message.error('You can only assign funders to programs you are part of.')
                        setSavingUser(false)
                        return
                    }
                }
            }

            if (values?.role === 'Coordinator' && !values.assignedBranch) {
                message.error('Coordinator requires a branch assignment.')
                return
            }

            if (values?.role === 'Coordinator') {
                const selectedBranch = branches.find(b => b.id === values.assignedBranch)
                const selectedDepartment = departments.find(d => d.id === values.departmentId)
                const coordinatorCompanyCode =
                    selectedBranch?.companyCode || selectedDepartment?.companyCode || ''

                if (
                    selectedBranch?.companyCode &&
                    selectedDepartment?.companyCode &&
                    selectedBranch.companyCode !== selectedDepartment.companyCode
                ) {
                    message.error('The coordinator branch and department must belong to the same company.')
                    return
                }

                const invalidProgram = (Array.isArray(values.assignedPrograms)
                    ? values.assignedPrograms
                    : []
                ).some((programId: string) => {
                    const program = selectablePrograms.find(p => p.id === programId)
                    return Boolean(
                        coordinatorCompanyCode &&
                        program?.companyCode &&
                        program.companyCode !== coordinatorCompanyCode
                    )
                })

                if (invalidProgram) {
                    message.error('All assigned programs must belong to the coordinator company.')
                    return
                }
            }

            const backendRole =
                ROLE_BACKEND_MAP[values.role] ||
                (values.role === 'Center Coordinator'
                    ? 'projectadmin'
                    : values.role.toLowerCase())

            if (BRANCH_SCOPED_ROLES.includes(values.role) && !values.assignedBranch) {
                setSavingUser(false)
                return message.error(`${values.role} requires a branch assignment`)
            }
            if (
                DEPARTMENT_SCOPED_ROLES.includes(values.role) &&
                values.role !== 'Consultant' && // consultant dept is auto-locked
                !values.departmentId
            ) {
                setSavingUser(false)
                return message.error(`${values.role} requires a department assignment`)
            }

            // ===== EDIT PATH =====
            if (isEditMode && currentUser) {
                const nextEmail = String(values.email || '').trim().toLowerCase()
                const emailChanged = nextEmail !== currentUser.email.trim().toLowerCase()
                if (emailChanged) {
                    if (!canUseSystemTools) {
                        message.error('Only the system administrator can change login emails.')
                        return
                    }
                    const updateEmail = httpsCallable(functions, 'updateUserEmailCascade')
                    await updateEmail({ uid: currentUser.id, newEmail: nextEmail })
                }

                const digitalSignature =
                    currentUser.digitalSignature &&
                        currentUser.digitalSignature.length > 0
                        ? currentUser.digitalSignature
                        : await generateDigitalSignature(
                            `${currentUser.email}|${values.name}`
                        )

                const updateData: any = {
                    email: nextEmail,
                    name: values.name,
                    role: backendRole,
                    status: values.status ? 'Active' : 'Inactive',
                    updatedAt: new Date().toISOString(),
                    digitalSignature,
                    // ✅ ensure no stale programs
                    assignedPrograms:
                        values.role === 'Funder' || values.role === 'Coordinator'
                            ? (Array.isArray(values.assignedPrograms) ? values.assignedPrograms : [])
                            : []
                }

                if (values.role === 'Coordinator') {
                    const sel = departments.find(d => d.id === values.departmentId)
                    updateData.assignedBranch = values.assignedBranch
                    updateData.assignedBranchName = branches.find(
                        b => b.id === values.assignedBranch
                    )?.name || null
                    updateData.branchId = values.assignedBranch
                    updateData.branchName = updateData.assignedBranchName
                    updateData.departmentId = sel?.id || values.departmentId
                    updateData.departmentName = sel?.name || 'Unknown'
                    updateData.engagementCategory = values.engagementCategory || null
                    updateData.nationalCoordinator = Boolean(values.nationalCoordinator)
                } else if (BRANCH_SCOPED_ROLES.includes(values.role)) {
                    updateData.assignedBranch = values.assignedBranch
                    updateData.departmentId = null
                    updateData.departmentName = null
                } else if (DEPARTMENT_SCOPED_ROLES.includes(values.role)) {
                    // For consultant: lock to current user's department
                    if (backendRole === 'consultant') {
                        updateData.assignedBranch = null
                        updateData.departmentId = user?.departmentId || null
                        updateData.departmentName = user?.departmentName || null
                    } else {
                        const sel = departments.find(d => d.id === values.departmentId)
                        updateData.assignedBranch = null
                        updateData.departmentId = sel?.id || values.departmentId
                        updateData.departmentName = sel?.name || 'Unknown'
                    }
                } else {
                    updateData.assignedBranch = null
                    updateData.departmentId = null
                    updateData.departmentName = null
                }

                if (backendRole === 'operations') {
                    await upsertOperationsStaff({
                        email: nextEmail,
                        name: values.name,
                        departmentId: updateData.departmentId,
                        departmentName: updateData.departmentName,
                        digitalSignature
                    })
                } else if (backendRole === 'consultant') {
                    // mirror into consultants collection (use current user's department)
                    const depId = user?.departmentId || null
                    const depName = user?.departmentName || null

                    updateData.assignedBranch = null
                    updateData.departmentId = depId
                    updateData.departmentName = depName

                    await upsertConsultant({
                        email: nextEmail,
                        name: values.name,
                        departmentId: depId,
                        departmentName: depName,
                        digitalSignature,
                        expertise: values.expertise,
                        rate: typeof values.rate === 'number' ? values.rate : undefined,
                        type: values.type,
                        engagementCategory: values.engagementCategory || null,
                        internalRole:
                            values.type === 'Internal' ? values.internalRole || null : null,
                        branchId:
                            values.type === 'Internal' &&
                                values.internalRole === 'Coordinator'
                                ? values.branchId || null
                                : null
                    })

                    // keep a compact snapshot on the user
                    updateData.consultantProfile = {
                        expertise: values.expertise || [],
                        rate: typeof values.rate === 'number' ? values.rate : null,
                        type: values.type || null,
                        engagementCategory: values.engagementCategory || null,
                        internalRole:
                            values.type === 'Internal' ? values.internalRole || null : null,
                        branchId:
                            values.type === 'Internal' &&
                                values.internalRole === 'Coordinator'
                                ? values.branchId || null
                                : null
                    }
                }

                if (backendRole === 'coordinator') {
                    const idToken = await auth.currentUser?.getIdToken()
                    if (!idToken) throw new Error('missing_id_token')

                    const resp = await fetch(
                        'https://us-central1-lph-smart-inc.cloudfunctions.net/createPlatformUser',
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${idToken}`
                            },
                            body: JSON.stringify({
                                email: nextEmail,
                                name: values.name,
                                role: 'coordinator',
                                companyCode: currentUser.companyCode || user?.companyCode || '',
                                departmentId: updateData.departmentId,
                                departmentName: updateData.departmentName,
                                branchId: values.assignedBranch,
                                branchName: updateData.assignedBranchName,
                                assignedPrograms: updateData.assignedPrograms,
                                engagementCategory: updateData.engagementCategory,
                                nationalCoordinator: updateData.nationalCoordinator,
                                status: updateData.status,
                                allowExisting: true,
                                sendEmail: false
                            })
                        }
                    )
                    const data = await resp.json().catch(() => null)
                    if (!resp.ok || !data?.ok) {
                        throw new Error(data?.error || data?.message || 'create_failed')
                    }
                } else {
                    await updateDoc(doc(db, 'users', currentUser.id), updateData)
                }

                // sync contact email onto branch / department
                try {
                    // Center Coordinator → branch contactEmail
                    if (
                        values.role === 'Center Coordinator' &&
                        updateData.assignedBranch
                    ) {
                        await updateDoc(
                            doc(db, 'branches', updateData.assignedBranch),
                            {
                                contactEmail: nextEmail
                            }
                        )
                    }

                    // Head Of Department → department contactEmail
                    if (
                        values.role === 'Head Of Department' &&
                        updateData.departmentId
                    ) {
                        await updateDoc(
                            doc(db, 'departments', updateData.departmentId),
                            {
                                contactEmail: nextEmail
                            }
                        )
                    }
                } catch (syncErr) {
                    console.warn('Failed to sync contact email to branch/department', syncErr)
                }

                message.success(emailChanged ? 'User and login email updated everywhere.' : 'User updated successfully!')
            }
            // ---- CREATE PATH ----
            else {
                const idToken = await auth.currentUser?.getIdToken()
                if (!idToken) {
                    message.error('You are not signed in. Please sign in and try again.')
                    setSavingUser(false)
                    return
                }

                const backendRole =
                    ROLE_BACKEND_MAP[values.role] ||
                    (values.role === 'Center Coordinator'
                        ? 'projectadmin'
                        : values.role.toLowerCase())

                // decide companyCode
                const creatorElevated =
                    isAdmin(user) ||
                    (user?.role || '').toLowerCase() === 'director' ||
                    isMainDepartmentUser
                const creatingDirector = values.role === 'Director'

                const selectedCoordinatorBranch =
                    values.role === 'Coordinator'
                        ? branches.find(b => b.id === values.assignedBranch)
                        : null
                const selectedCoordinatorDepartment =
                    values.role === 'Coordinator'
                        ? departments.find(d => d.id === values.departmentId)
                        : null

                const companyCodeForPayload =
                    values.role === 'Coordinator'
                        ? selectedCoordinatorBranch?.companyCode ||
                        selectedCoordinatorDepartment?.companyCode ||
                        user?.companyCode || ''
                        : creatorElevated && creatingDirector && values.companyCodeOverride
                            ? values.companyCodeOverride
                            : user?.companyCode || ''

                let departmentIdForPayload: string | null = null
                let departmentNameForPayload: string | null = null

                if (values.role === 'Consultant') {
                    departmentIdForPayload = user?.departmentId || null
                    departmentNameForPayload = user?.departmentName || null
                } else if (DEPARTMENT_SCOPED_ROLES.includes(values.role)) {
                    const sel = departments.find(d => d.id === values.departmentId)
                    departmentIdForPayload = sel?.id || values.departmentId || null
                    departmentNameForPayload = sel?.name || null
                }

                const payload: any = {
                    email: values.email,
                    name: values.name,
                    role: backendRole,
                    companyCode: companyCodeForPayload,
                    assignedBranch: BRANCH_SCOPED_ROLES.includes(values.role)
                        ? values.assignedBranch
                        : null,
                    departmentId: departmentIdForPayload,
                    departmentName: departmentNameForPayload,
                    status: values.status ? 'Active' : 'Inactive',
                    // ✅ Funders assigned programs (and clear for non-funders)
                    assignedPrograms:
                        values.role === 'Funder' || values.role === 'Coordinator'
                            ? (Array.isArray(values.assignedPrograms) ? values.assignedPrograms : [])
                            : [],
                    // enforce mustRegister false
                    mustRegister: false,
                    // existing flags:
                    sendEmail: true,
                    sendResetLink: true,
                    allowExisting: values.role === 'Coordinator'
                }

                if (values.role === 'Coordinator') {
                    payload.branchId = values.assignedBranch
                    payload.branchName = branches.find(
                        b => b.id === values.assignedBranch
                    )?.name || null
                    payload.engagementCategory = values.engagementCategory || null
                    payload.nationalCoordinator = Boolean(values.nationalCoordinator)
                }

                if (values.role === 'Consultant') {
                    payload.expertise = values.expertise || []
                    if (typeof values.rate === 'number') payload.rate = values.rate
                    payload.type = values.type
                    payload.engagementCategory = values.engagementCategory || null
                    payload.internalRole =
                        values.type === 'Internal' ? values.internalRole || null : null

                    const branchId =
                        values.type === 'Internal' && values.internalRole === 'Coordinator'
                            ? values.branchId || null
                            : null
                    payload.branchId = branchId
                    payload.branchName = branchId
                        ? branches.find(b => b.id === branchId)?.name || null
                        : null
                }

                try {
                    const resp = await fetch(
                        'https://us-central1-lph-smart-inc.cloudfunctions.net/createPlatformUser',
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${idToken}`
                            },
                            body: JSON.stringify(payload)
                        }
                    )

                    let data: any = null
                    try {
                        data = await resp.json()
                    } catch {
                        data = null
                    }

                    if (!resp.ok || !data?.ok) {
                        const rawError: string | undefined =
                            data?.error || data?.code || data?.message

                        // If backend forwarded a Firebase auth code, reuse the Firebase mapper
                        if (rawError && rawError.startsWith('auth/')) {
                            message.error(getFriendlyFirebaseError(rawError))
                        } else {
                            message.error(friendlyApiError(rawError || 'create_failed'))
                        }

                        // Don’t fall through to the success branch
                        return
                    }

                    // After backend user creation, sync contact email to branch / department
                    try {
                        // Center Coordinator → its branch contactEmail
                        if (
                            values.role === 'Center Coordinator' &&
                            payload.assignedBranch
                        ) {
                            await updateDoc(
                                doc(db, 'branches', payload.assignedBranch),
                                {
                                    contactEmail: values.email
                                }
                            )
                        }

                        // Head Of Department → its department contactEmail
                        if (
                            values.role === 'Head Of Department' &&
                            departmentIdForPayload
                        ) {
                            await updateDoc(
                                doc(db, 'departments', departmentIdForPayload),
                                {
                                    contactEmail: values.email
                                }
                            )
                        }
                    } catch (syncErr) {
                        console.warn('Failed to sync contact email to branch/department', syncErr)
                    }

                    message.success(
                        values.role === 'Coordinator' && data.created === false
                            ? 'Existing user converted to coordinator successfully.'
                            : 'User created successfully. A welcome email has been sent.'
                    )
                } catch (networkErr: any) {
                    console.error('Create user network error:', networkErr)
                    message.error(
                        networkErr?.message?.includes('Failed to fetch')
                            ? 'Could not reach the server. Please check your connection and try again.'
                            : 'We could not create the user due to a server error. Please try again.'
                    )
                    return
                }
            }

            setIsModalVisible(false)
            form.resetFields()
        } catch (authError: any) {
            console.error('Save error:', authError)
            if (authError?.code) {
                message.error(getFriendlyFirebaseError(authError.code))
            } else {
                message.error(authError?.message || 'Failed to save user.')
            }
        } finally {
            setSavingUser(false)
        }
    }

    const handleDelete = async (userId: string) => {
        try {
            const victim = users.find(u => u.id === userId)
            if (!victim || !canManageUser(user, victim)) {
                message.error('You do not have permission to delete this user.')
                return
            }

            setDeletingId(userId)

            const cascadeDelete = httpsCallable(functions, 'deleteUserCascade')
            await cascadeDelete({ uid: userId, confirm: true })
            message.success('User deleted from Auth and related Firestore records.')
        } catch (error: any) {
            message.error(friendlyApiError(error?.message))
        } finally {
            setDeletingId(null)
        }
    }

    const showResetPasswordModal = (email: string) => {
        setResetPasswordEmail(email)
        setResetPasswordModalVisible(true)
    }

    const handlePasswordReset = async () => {
        try {
            const sendReset = httpsCallable(
                functions,
                'sendLoggedPasswordResetEmail'
            )
            await sendReset({ email: resetPasswordEmail })
            message.success(`Password reset email sent to ${resetPasswordEmail}`)
            setResetPasswordModalVisible(false)
        } catch (error: any) {
            console.error('Error sending password reset:', error)
            message.error(getFriendlyFirebaseError(error.code))
        }
    }

    const handleAdminPasswordReset = async (userId: string) => {
        const newPassword = prompt('Enter new password for user:')
        if (!newPassword) return
        try {
            const adminResetUserPassword = httpsCallable(
                functions,
                'adminResetUserPassword'
            )
            await adminResetUserPassword({ uid: userId, newPassword })
            message.success('✅ Password reset successfully.')
        } catch (error: any) {
            console.error('Password reset error:', error)
            message.error(error.message || 'Failed to reset password.')
        }
    }

    const toggleUserStatus = async (u: User) => {
        try {
            const newStatus = u.status === 'Active' ? 'Inactive' : 'Active'
            await updateDoc(doc(db, 'users', u.id), {
                status: newStatus,
                updatedAt: new Date().toISOString()
            })
            message.success(`User status changed to ${newStatus}`)
        } catch (error: any) {
            console.error('Error updating status:', error)
            message.error(
                `Failed to update status: ${error.message || 'Unknown error'}`
            )
        }
    }

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A'
        try {
            const d = new Date(dateString)
            return d.toString() === 'Invalid Date' ? 'N/A' : d.toLocaleDateString()
        } catch {
            return 'N/A'
        }
    }

    const handleRefresh = () => {
        setLoading(true)
        setTimeout(() => setLoading(false), 800)
    }

    // ====== SCOPED DATA (drives both table and metrics) ======
    const visibleUsers = users.filter(u => canSeeUser(user, u))

    const companyScopedUsers = isAdmin(user)
        ? visibleUsers
        : isMainDepartmentUser
            ? visibleUsers.filter(u => !isIncubateeUser(u))
            : visibleUsers

    const domainFilteredUsers = companyScopedUsers.filter(
        u => !shouldHideRow(user, u.email)
    )

    const visibleAssignableRoles = React.useMemo(() => {
        // hard guard: admin should **never** see an empty list
        if (isAdmin(user)) {
            const base = assignableRoles.length ? assignableRoles : AVAILABLE_ROLES
            return base
        }
        return assignableRoles.filter(r => r !== 'Incubatee')
    }, [assignableRoles, user])

    const scopedTotals = React.useMemo(() => {
        const total = domainFilteredUsers.length
        const active = domainFilteredUsers.filter(u => u.status === 'Active').length
        const inactive = total - active
        const byRole: Record<string, number> = {}
        for (const u of domainFilteredUsers) {
            const r = displayRoleOf(u)
            byRole[r] = (byRole[r] || 0) + 1
        }
        return { total, active, inactive, byRole }
    }, [domainFilteredUsers])

    const searchedUsers = React.useMemo(() => {
        const s = searchText.trim().toLowerCase()
        if (!s) return domainFilteredUsers

        return domainFilteredUsers.filter(u => {
            return (
                (u.name || '').toLowerCase().includes(s) ||
                (u.email || '').toLowerCase().includes(s) ||
                displayRoleOf(u).toLowerCase().includes(s) ||
                branchNameOf(branches, u.assignedBranch).toLowerCase().includes(s) ||
                (u.departmentName || '').toLowerCase().includes(s) ||
                (u.status || '').toLowerCase().includes(s)
            )
        })
    }, [searchText, domainFilteredUsers, branches])

    const roleFilterOptions = isSuperUser(user)
        ? AVAILABLE_ROLES
        : visibleAssignableRoles

    const columns = [
        {
            title: 'Name',
            dataIndex: 'name',
            key: 'name',
            sorter: (a: User, b: User) => a.name.localeCompare(b.name),
            width: '18%',
            ellipsis: true,
            responsive: ['md']
        },
        {
            title: 'Email',
            dataIndex: 'email',
            key: 'email',
            width: '22%',
            ellipsis: true,
            render: (email: string) => (
                <span style={{ wordBreak: 'break-all' }}>{email}</span>
            ),
            responsive: ['lg']
        },
        {
            title: 'Role',
            dataIndex: 'role',
            key: 'role',
            filters: roleFilterOptions.map(r => ({ text: r, value: r })),
            onFilter: (value: any, record: User) => displayRoleOf(record) === value,
            render: (role: string) => {
                const safe = role || ''
                const displayRole =
                    ROLE_DISPLAY_MAP[safe.toLowerCase()] ||
                    safe.charAt(0).toUpperCase() + safe.slice(1)

                const color =
                    displayRole === 'Director'
                        ? 'purple'
                        : displayRole === 'Admin'
                            ? 'blue'
                            : displayRole === 'Head Of Department'
                                ? 'green'
                                : displayRole === 'Incubatee'
                                    ? 'orange'
                                    : displayRole === 'Funder'
                                        ? 'gold'
                                        : displayRole === 'Consultant'
                                            ? 'cyan'
                                            : displayRole === 'Center Coordinator'
                                                ? 'magenta'
                                                : displayRole === 'Auxiliary'
                                                    ? 'pink'
                                                    : displayRole === 'Receptionist'
                                                        ? 'lime'
                                                        : 'default'

                return <Tag color={color}>{displayRole || 'Unknown'}</Tag>
            },
            width: '14%',
            ellipsis: true,
            responsive: ['md']
        },
        {
            title: 'Branch/Dept',
            key: 'assignment',
            render: (_: any, record: User) => {
                // Optional: show program count for Funders (no redesign)
                const displayRole = displayRoleOf(record)
                if (displayRole === 'Funder') {
                    const count = Array.isArray(record.assignedPrograms)
                        ? record.assignedPrograms.length
                        : 0
                    return <Tag color='gold'>Programs: {count}</Tag>
                }

                if (record.assignedBranch) {
                    const b = branches.find(x => x.id === record.assignedBranch)
                    return <Tag color='blue'>🏢 {b?.name || record.assignedBranch}</Tag>
                }
                if (record.departmentName) {
                    return <Tag color='orange'>🏭 {record.departmentName}</Tag>
                }
                return <Tag color='default'>Not Assigned</Tag>
            },
            width: '14%',
            ellipsis: true,
            responsive: ['lg']
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            filters: [
                { text: 'Active', value: 'Active' },
                { text: 'Inactive', value: 'Inactive' }
            ],
            onFilter: (value: any, record: User) => record.status === value,
            render: (status: string, record: User) => (
                <Popconfirm
                    title={`Change user status to ${status === 'Active' ? 'Inactive' : 'Active'
                        }?`}
                    onConfirm={() => toggleUserStatus(record)}
                    okText='Yes'
                    cancelText='No'
                >
                    <Tag
                        color={status === 'Active' ? 'success' : 'error'}
                        style={{ cursor: 'pointer' }}
                    >
                        {status}
                    </Tag>
                </Popconfirm>
            ),
            width: '10%',
            responsive: ['md']
        },
        {
            title: 'Created',
            dataIndex: 'createdAt',
            key: 'createdAt',
            render: (date: string) => formatDate(date),
            sorter: (a: User, b: User) => {
                const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0
                const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0
                return aT - bT
            },
            width: '10%',
            ellipsis: true,
            responsive: ['lg']
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, record: User) => {
                const manageable = canManageUser(user, record)
                return (
                    <Space size='small'>
                        <Tooltip
                            title={manageable ? 'Edit User' : 'You can’t edit this user'}
                        >
                            <Button
                                shape='circle'
                                icon={<EditOutlined />}
                                onClick={() => manageable && showModal(true, record)}
                                size='small'
                                disabled={!manageable}
                            />
                        </Tooltip>

                        <Tooltip
                            title={
                                manageable ? 'Reset Password' : 'You can’t reset this user'
                            }
                        >
                            <Button
                                shape='circle'
                                icon={<PullRequestOutlined />}
                                onClick={() =>
                                    manageable && showResetPasswordModal(record.email)
                                }
                                size='small'
                                disabled={!manageable}
                            />
                        </Tooltip>

                        <Tooltip
                            title={
                                manageable
                                    ? 'Reset Password (Admin)'
                                    : 'You can’t reset this user'
                            }
                        >
                            <Button
                                shape='circle'
                                icon={<LockFilled />}
                                onClick={() =>
                                    manageable && showAdminPasswordResetModal(record.id)
                                }
                                size='small'
                                disabled={!manageable}
                            />
                        </Tooltip>

                        <Popconfirm
                            title='Are you sure you want to delete this user?'
                            description='This action cannot be undone.'
                            onConfirm={() => handleDelete(record.id)}
                            okText='Yes'
                            cancelText='No'
                            okButtonProps={{
                                danger: true,
                                loading: deletingId === record.id
                            }}
                            disabled={!manageable || !!deletingId}
                        >
                            <Tooltip
                                title={
                                    manageable ? 'Delete User' : 'You can’t delete this user'
                                }
                            >
                                <Button
                                    shape='circle'
                                    size='middle'
                                    icon={
                                        deletingId === record.id ? (
                                            <LoadingOutlined />
                                        ) : (
                                            <DeleteOutlined />
                                        )
                                    }
                                    danger
                                    size='small'
                                    disabled={!manageable || !!deletingId}
                                />
                            </Tooltip>
                        </Popconfirm>
                    </Space>
                )
            },
            width: '15%',
            fixed: 'right' as const,
            responsive: ['md']
        }
    ]

    const MOBILE_CARD_STYLE: React.CSSProperties = {
        width: '100%',
        maxWidth: 640,
        margin: '0 auto 12px' // <-- margin BELOW only
    }

    const MobileUserCard: React.FC<{ item: User }> = ({ item }) => {
        const manageable = canManageUser(user, item)
        const roleTag = (() => {
            const safe = item.role || ''
            const displayRole =
                ROLE_DISPLAY_MAP[safe.toLowerCase()] ||
                safe.charAt(0).toUpperCase() + safe.slice(1)
            const color =
                displayRole === 'Director'
                    ? 'purple'
                    : displayRole === 'Admin'
                        ? 'blue'
                        : displayRole === 'Head Of Department'
                            ? 'green'
                            : displayRole === 'Incubatee'
                                ? 'orange'
                                : displayRole === 'Funder'
                                    ? 'gold'
                                    : displayRole === 'Consultant'
                                        ? 'cyan'
                                        : displayRole === 'Center Coordinator'
                                            ? 'magenta'
                                            : displayRole === 'Auxiliary'
                                                ? 'pink'
                                                : displayRole === 'Receptionist'
                                                    ? 'lime'
                                                    : 'default'
            return <Tag color={color}>{displayRole}</Tag>
        })()

        const assignmentTag = (() => {
            const displayRole = displayRoleOf(item)
            if (displayRole === 'Funder') {
                const count = Array.isArray(item.assignedPrograms) ? item.assignedPrograms.length : 0
                return <Tag color='gold'>Programs: {count}</Tag>
            }

            if (item.assignedBranch) {
                const b = branches.find(x => x.id === item.assignedBranch)
                return <Tag color='blue'>🏢 {b?.name || item.assignedBranch}</Tag>
            }
            if (item.departmentName) {
                return <Tag color='orange'>🏭 {item.departmentName}</Tag>
            }
            return <Tag>Not Assigned</Tag>
        })()

        return (
            <Card size='small' style={{ borderRadius: 12, ...MOBILE_CARD_STYLE }}>
                <Space direction='vertical' size={6} style={{ width: '100%' }}>
                    <Space
                        wrap
                        align='start'
                        style={{ justifyContent: 'space-between', width: '100%' }}
                    >
                        <div style={{ fontWeight: 600 }}>
                            {item.name}
                            <div
                                style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}
                            >
                                {displayEmail(user, item.email)}
                            </div>
                        </div>
                        <Tag color={item.status === 'Active' ? 'success' : 'error'}>
                            {item.status}
                        </Tag>
                    </Space>

                    <Space wrap>
                        {roleTag}
                        {assignmentTag}
                        <Tag>{formatDate(item.createdAt)}</Tag>
                    </Space>

                    <Divider style={{ margin: '8px 0' }} />

                    <Space wrap>
                        <Tooltip
                            title={manageable ? 'Edit User' : 'You can’t edit this user'}
                        >
                            <Button
                                size='small'
                                type='default'
                                icon={<EditOutlined />}
                                onClick={() => manageable && showModal(true, item)}
                                disabled={!manageable}
                            >
                                Edit
                            </Button>
                        </Tooltip>

                        <Tooltip
                            title={
                                manageable ? 'Reset Password' : 'You can’t reset this user'
                            }
                        >
                            <Button
                                size='small'
                                type='default'
                                icon={<PullRequestOutlined />}
                                onClick={() => manageable && showResetPasswordModal(item.email)}
                                disabled={!manageable}
                            >
                                Reset
                            </Button>
                        </Tooltip>

                        <Tooltip
                            title={manageable ? 'Admin Reset' : 'You can’t reset this user'}
                        >
                            <Button
                                size='small'
                                type='default'
                                icon={<LockFilled />}
                                onClick={() =>
                                    manageable && showAdminPasswordResetModal(item.id)
                                }
                                disabled={!manageable}
                            >
                                Admin Reset
                            </Button>
                        </Tooltip>

                        <Popconfirm
                            title='Delete this user?'
                            onConfirm={() => handleDelete(item.id)}
                            okButtonProps={{ danger: true, loading: deletingId === item.id }}
                            okText='Yes'
                            cancelText='No'
                            disabled={!manageable || !!deletingId}
                        >
                            <Button
                                size='small'
                                type='primary'
                                danger
                                icon={
                                    deletingId === item.id ? (
                                        <LoadingOutlined />
                                    ) : (
                                        <DeleteOutlined />
                                    )
                                }
                                disabled={!manageable || !!deletingId}
                            >
                                Delete
                            </Button>
                        </Popconfirm>
                    </Space>
                </Space>
            </Card>
        )
    }

    return (
        <div style={{ minHeight: '100vh', padding: isMobile ? 12 : 24 }}>
            <Helmet>
                <title>User Management</title>
            </Helmet>
            {loading ? (
                <LoadingOverlay tip='Getting users ready' />
            ) : (
                <>
                    {/* ====== SCOPED METRICS (role-aware) ====== */}
                    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                        <Col xs={24} sm={12} md={8}>
                            <MotionCard><MotionCard.Metric title='Team Members' value={scopedTotals.total} icon={<UserOutlined style={{ color: '#1677ff' }} />} iconBg='rgba(22,119,255,.12)' /></MotionCard>
                        </Col>
                        <Col xs={24} sm={12} md={8}>
                            <MotionCard><MotionCard.Metric title='Active Members' value={scopedTotals.active} icon={<SmileOutlined style={{ color: '#16a34a' }} />} iconBg='rgba(22,163,74,.12)' /></MotionCard>
                        </Col>
                        <Col xs={24} sm={12} md={8}>
                            <MotionCard><MotionCard.Metric title='Inactive Members' value={scopedTotals.inactive} icon={<FrownOutlined style={{ color: '#dc2626' }} />} iconBg='rgba(220,38,38,.12)' /></MotionCard>
                        </Col>
                    </Row>

                    {/* Toolbar */}
                    <MotionCard style={{ marginBottom: 16 }}>
                        <Row gutter={[8, 8]} align='middle' wrap>
                            {/* Left: Search + Refresh */}
                            <Col xs={24} md={16}>
                                {isMobile ? (
                                    <>
                                        <Input.Search
                                            placeholder='Search users by name, email or role'
                                            value={searchText}
                                            onChange={e => setSearchText(e.target.value)}
                                            onSearch={val => setSearchText(val)}
                                            allowClear
                                            style={{ width: '100%' }}
                                        />
                                        <Button
                                            icon={<ReloadOutlined />}
                                            onClick={handleRefresh}
                                            block
                                            style={{ marginTop: 8 }}
                                        >
                                            Refresh
                                        </Button>
                                    </>
                                ) : (
                                    <Space.Compact style={{ width: '100%' }}>
                                        <Input.Search
                                            placeholder='Search users by name, email or role'
                                            value={searchText}
                                            onChange={e => setSearchText(e.target.value)}
                                            onSearch={val => setSearchText(val)}
                                            allowClear
                                            style={{ flex: 1, minWidth: 0 }}
                                        />
                                        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
                                            Refresh
                                        </Button>
                                    </Space.Compact>
                                )}
                            </Col>

                            {/* Right: Add User */}
                            <Col
                                xs={24}
                                md={8}
                                style={{ textAlign: isMobile ? 'left' : 'right' }}
                            >
                                <Button
                                    type='primary'
                                    icon={<UserAddOutlined />}
                                    onClick={() => showModal()}
                                    block={isMobile}
                                >
                                    Add User
                                </Button>
                            </Col>
                        </Row>
                    </MotionCard>


                    {isMobile ? (
                        <List
                            dataSource={searchedUsers}
                            loading={loading}
                            renderItem={item => (
                                <List.Item style={{ padding: 0, border: 'none' }}>
                                    <MobileUserCard item={item} />
                                </List.Item>
                            )}
                            pagination={{
                                pageSize: 5,
                                showSizeChanger: false
                            }}
                        />
                    ) : (
                        <MotionCard>
                            <Table
                                dataSource={searchedUsers}
                                columns={columns as any}
                                rowKey='id'
                                loading={loading}
                                size='middle'
                                sticky
                                scroll={{ x: 1000 }}
                                pagination={{
                                    pageSize: 10,
                                    showSizeChanger: false,
                                    position: ['bottomCenter']
                                }}
                            />
                        </MotionCard>
                    )}

                    {/* Modal for create/edit */}
                    <Modal
                        title={isEditMode ? 'Edit User' : 'Create New User'}
                        open={isModalVisible}
                        onCancel={() => setIsModalVisible(false)}
                        footer={null}
                        maskClosable={false}
                    >
                        {!isEditMode && (
                            <Alert
                                type='warning'
                                showIcon
                                style={{ marginBottom: 12 }}
                                message='Default password for newly created users'
                                description={
                                    <span>
                                        New users are created with a temporary password{' '}
                                        <strong>Password@1</strong>. They should change it on first
                                        sign-in.
                                    </span>
                                }
                            />
                        )}

                        <Form form={form} layout='vertical' onFinish={handleSubmit}>
                            <Form.Item
                                name='name'
                                label='Name'
                                rules={[
                                    { required: true, message: "Please enter user's name" }
                                ]}
                            >
                                <Input placeholder='Enter full name' />
                            </Form.Item>

                            <Form.Item
                                name='email'
                                label='Email'
                                rules={[
                                    { required: true, message: "Please enter user's email" },
                                    { type: 'email', message: 'Please enter a valid email' }
                                ]}
                            >
                                <Input
                                    placeholder='Enter email address'
                                    disabled={isEditMode && !canUseSystemTools}
                                />
                            </Form.Item>

                            <Form.Item
                                name='role'
                                label='Role'
                                rules={[{ required: true, message: 'Please select a role' }]}
                            >
                                <Select placeholder='Select role' onChange={handleRoleChange}>
                                    {visibleAssignableRoles.map(role => (
                                        <Select.Option key={role} value={role}>
                                            {role}
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>

                            {/* Program assignments for funders and coordinators */}
                            {(selectedRole === 'Funder' || selectedRole === 'Coordinator') && (
                                <Form.Item
                                    name='assignedPrograms'
                                    label='Assigned Programs'
                                    rules={selectedRole === 'Funder'
                                        ? [{
                                            required: true,
                                            validator: async (_, val) => {
                                                const arr = Array.isArray(val) ? val : []
                                                if (!arr.length) {
                                                    throw new Error('Please select at least 1 program.')
                                                }
                                            }
                                        }]
                                        : []}
                                >
                                    <Select
                                        mode='multiple'
                                        placeholder='Select program(s)'
                                        loading={programsLoading}
                                        optionFilterProp='label'
                                        showSearch
                                        options={selectablePrograms.map(p => ({
                                            value: p.id,
                                            label:
                                                (p as any).name ||
                                                (p as any).title ||
                                                (p as any).programName ||
                                                p.id
                                        }))}
                                    />
                                </Form.Item>
                            )}

                            {/* If creator is elevated AND creating a Director, let them pick an existing company */}
                            <Form.Item
                                noStyle
                                shouldUpdate={(prev, cur) => prev.role !== cur.role}
                            >
                                {() => {
                                    const myRole = (user?.role || '').toLowerCase()
                                    const creatingDirector =
                                        form.getFieldValue('role') === 'Director'
                                    const elevated =
                                        isAdmin(user) ||
                                        myRole === 'director' ||
                                        isMainDepartmentUser

                                    if (!creatingDirector || !elevated) return null

                                    return (
                                        <Form.Item
                                            name='companyCodeOverride'
                                            label='Assign to Existing Company (optional)'
                                            tooltip='Choose an existing company for this new Director. If left empty, your own companyCode will be used.'
                                        >
                                            <Select
                                                placeholder={
                                                    directorCompanies.length
                                                        ? 'Select a company'
                                                        : 'No other companies found – will use your companyCode'
                                                }
                                                allowClear
                                                showSearch
                                                optionFilterProp='label'
                                                options={directorCompanies.map(c => ({
                                                    value: c.code,
                                                    label: c.label
                                                }))}
                                            />
                                        </Form.Item>
                                    )
                                }}
                            </Form.Item>

                            {selectedRole === 'Consultant' && (
                                <>
                                    <Form.Item name='expertise' label='Expertise Areas'>
                                        <Select
                                            mode='tags'
                                            placeholder='Add expertise areas (optional)'
                                        >
                                            {CONSULTANT_EXPERTISE.map(x => (
                                                <Select.Option key={x} value={x}>
                                                    {x}
                                                </Select.Option>
                                            ))}
                                        </Select>
                                    </Form.Item>

                                    <Form.Item name='rate' label='Rate per Hour (ZAR)'>
                                        <InputNumber min={0} style={{ width: '100%' }} />
                                    </Form.Item>

                                    <Form.Item
                                        name='type'
                                        label='Consultant Type'
                                        rules={[{ required: true, message: 'Please select type' }]}
                                    >
                                        <Select placeholder='Select type'>
                                            <Select.Option value='Internal'>Internal</Select.Option>
                                            <Select.Option value='External'>External</Select.Option>
                                        </Select>
                                    </Form.Item>

                                    <Form.Item
                                        name='engagementCategory'
                                        label='Engagement Category'
                                        rules={[
                                            { required: true, message: 'Please select engagement' }
                                        ]}
                                    >
                                        <Select placeholder='Select engagement category'>
                                            <Select.Option value='Full-time'>Full-time</Select.Option>
                                            <Select.Option value='Contract'>Contract</Select.Option>
                                            <Select.Option value='Intern'>Intern</Select.Option>
                                        </Select>
                                    </Form.Item>

                                    <Form.Item noStyle shouldUpdate={(p, c) => p.type !== c.type}>
                                        {({ getFieldValue }) =>
                                            getFieldValue('type') === 'Internal' ? (
                                                <Form.Item
                                                    name='internalRole'
                                                    label='Internal Role'
                                                    rules={[
                                                        {
                                                            required: true,
                                                            message: 'Please select internal role'
                                                        }
                                                    ]}
                                                >
                                                    <Select placeholder='Select internal role'>
                                                        <Select.Option value='Coordinator'>
                                                            Coordinator
                                                        </Select.Option>
                                                        <Select.Option value='Consultant'>
                                                            Consultant
                                                        </Select.Option>
                                                    </Select>
                                                </Form.Item>
                                            ) : null
                                        }
                                    </Form.Item>

                                    <Form.Item
                                        noStyle
                                        shouldUpdate={(p, c) =>
                                            p.type !== c.type || p.internalRole !== c.internalRole
                                        }
                                    >
                                        {({ getFieldValue }) =>
                                            getFieldValue('type') === 'Internal' &&
                                                getFieldValue('internalRole') === 'Coordinator' ? (
                                                <Form.Item
                                                    name='branchId'
                                                    label='Branch'
                                                    rules={[
                                                        {
                                                            required: true,
                                                            message: 'Please select a branch'
                                                        }
                                                    ]}
                                                >
                                                    <Select placeholder='Select branch'>
                                                        {branches.map(b => (
                                                            <Select.Option key={b.id} value={b.id}>
                                                                {b.name}
                                                            </Select.Option>
                                                        ))}
                                                    </Select>
                                                </Form.Item>
                                            ) : null
                                        }
                                    </Form.Item>
                                </>
                            )}

                            {selectedRole === 'Coordinator' && (
                                <>
                                    <Form.Item
                                        name='engagementCategory'
                                        label='Engagement Category'
                                        rules={[
                                            {
                                                required: true,
                                                message: 'Please select an engagement category'
                                            }
                                        ]}
                                    >
                                        <Select placeholder='Select engagement category'>
                                            <Select.Option value='Full-time'>Full-time</Select.Option>
                                            <Select.Option value='Contract'>Contract</Select.Option>
                                            <Select.Option value='Intern'>Intern</Select.Option>
                                        </Select>
                                    </Form.Item>

                                    <Form.Item
                                        name='assignedBranch'
                                        label='Assigned Branch'
                                        rules={[
                                            {
                                                required: true,
                                                message: 'Please select an assigned branch'
                                            }
                                        ]}
                                    >
                                        <Select
                                            placeholder='Select branch'
                                            showSearch
                                            optionFilterProp='label'
                                            options={branches.map(branch => ({
                                                value: branch.id,
                                                label: branch.name
                                            }))}
                                        />
                                    </Form.Item>

                                    <Form.Item
                                        name='nationalCoordinator'
                                        label='National Coordinator'
                                        valuePropName='checked'
                                    >
                                        <Switch />
                                    </Form.Item>
                                </>
                            )}

                            {/* Department picker ONLY for dept-scoped roles OTHER THAN Consultant */}
                            {DEPARTMENT_SCOPED_ROLES.includes(selectedRole) &&
                                selectedRole !== 'Consultant' && (
                                    <Form.Item
                                        name='departmentId'
                                        label='Department'
                                        rules={[
                                            {
                                                required: true,
                                                message: `Please select a department for ${selectedRole}!`
                                            }
                                        ]}
                                    >
                                        <Select placeholder='Select a department'>
                                            {departments.map(dep => (
                                                <Select.Option key={dep.id} value={dep.id}>
                                                    {dep.name}
                                                </Select.Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                )}

                            {BRANCH_SCOPED_ROLES.includes(selectedRole) && (
                                <Form.Item
                                    name='assignedBranch'
                                    label='Branch'
                                    rules={[
                                        {
                                            required: true,
                                            message: `Please select a branch for ${selectedRole}!`
                                        }
                                    ]}
                                >
                                    <Select placeholder='Select a branch'>
                                        {branches.map(branch => {
                                            const locationStr =
                                                typeof branch.location === 'string'
                                                    ? branch.location
                                                    : `${branch.location?.city ||
                                                    branch.location?.address ||
                                                    'Unknown Location'
                                                    }`
                                            return (
                                                <Select.Option key={branch.id} value={branch.id}>
                                                    {branch.name} - {locationStr}
                                                </Select.Option>
                                            )
                                        })}
                                    </Select>
                                </Form.Item>
                            )}

                            <Form.Item name='status' label='Status' valuePropName='checked'>
                                <Switch checkedChildren='Active' unCheckedChildren='Inactive' />
                            </Form.Item>

                            <Form.Item style={{ marginTop: 24 }}>
                                <Row gutter={12}>
                                    <Col span={12}>
                                        <Button
                                            block
                                            danger
                                            icon={<CloseOutlined />}
                                            onClick={() => setIsModalVisible(false)}
                                            disabled={savingUser}
                                        >
                                            Cancel
                                        </Button>
                                    </Col>

                                    <Col span={12}>
                                        <Button
                                            block
                                            type='primary'
                                            htmlType='submit'
                                            icon={isEditMode ? <EditOutlined /> : <UserAddOutlined />}
                                            loading={savingUser}
                                            disabled={savingUser}
                                        >
                                            {isEditMode ? 'Update' : 'Create'}
                                        </Button>
                                    </Col>
                                </Row>
                            </Form.Item>
                        </Form>
                    </Modal>

                    {/* Password Reset Confirmation Modal */}
                    <Modal
                        title='Reset Password'
                        open={resetPasswordModalVisible}
                        onCancel={() => setResetPasswordModalVisible(false)}
                        onOk={handlePasswordReset}
                        okText='Send Reset Email'
                        cancelText='Cancel'
                    >
                        <p>Send a password reset email to:</p>
                        <p style={{ fontWeight: 'bold' }}>{resetPasswordEmail}</p>
                    </Modal>

                    <AdminPasswordResetModal
                        visible={resetAdminPasswordModalVisible}
                        userId={resetUserId}
                        onClose={() => setResetAdminPasswordModalVisible(false)}
                    />
                </>
            )}
        </div>
    )
}

export default UserManagement
