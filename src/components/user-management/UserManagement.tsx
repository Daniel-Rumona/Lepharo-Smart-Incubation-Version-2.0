// UserManagement.tsx
import React, { useState, useEffect } from 'react'
import dayjs from 'dayjs'
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
    DatePicker,
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
import { OrganogramModal } from './OrganogramModal'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'

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
    branchId?: string
    position?: string | null
    employeementType?: 'permanent' | 'intern' | null
    startDate?: string | null
    endDate?: string | null
    employeeType?: string | null
}

const BRANCH_SCOPED_ROLES = ['Center Coordinator', 'Receptionist', 'Employee']

const DEPARTMENT_SCOPED_ROLES = [
    'Head Of Department',
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

// UI to backend role mapping
const ROLE_DISPLAY_MAP: Record<string, string> = {
    system_admin: 'System Admin',
    projectadmin: 'Center Coordinator',
    operations: 'Head Of Department',
    coordinator: 'Coordinator',
    employee: 'Employee',
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
    'Employee'
]

const HR_MANAGED_ROLES = [
    'Head Of Department',
    'Coordinator',
    'Center Coordinator',
    'Receptionist',
    'Employee'
]

export const UserManagement: React.FC = () => {
    const { user } = useFullIdentity()
    const [users, setUsers] = useState<User[]>([])
    const [branches, setBranches] = useState<any[]>([])
    const [departments, setDepartments] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [isEditMode, setIsEditMode] = useState(false)
    const [currentUser, setCurrentUser] = useState<User | null>(null)
    const [searchText, setSearchText] = useState('')
    const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined)
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
    const [isOrgChartVisible, setIsOrgChartVisible] = useState(false)
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md // phones & small tablets

    // Programs dropdown options (scoped)
    const [selectablePrograms, setSelectablePrograms] = useState<
        Array<{ id: string; name?: string; title?: string; programName?: string }>
    >([])
    const [programsLoading, setProgramsLoading] = useState(false)

    const ROLE_ASSIGNMENTS: Record<string, string[]> = {
        projectadmin: ['Receptionist', 'Employee'],
        operations: ['Coordinator', 'Employee'],
        hr: HR_MANAGED_ROLES
    }

    const departmentNameOf = (record: User) =>
        departments.find(department => department.id === record.departmentId)?.name ||
        record.departmentName ||
        ''

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

    const assignedBranchIdOf = (u?: Partial<User> | null) =>
        u?.assignedBranch || u?.branchId || ''

    const currentProjectAdminBranchId =
        (user?.role || '').toLowerCase() === 'projectadmin'
            ? assignedBranchIdOf(user as any)
            : ''

    const isIncubateeRole = (role?: string) =>
        (role || '').toLowerCase() === 'incubatee'

    const isIncubateeUser = (u: User) => {
        const disp = ROLE_DISPLAY_MAP[(u.role || '').toLowerCase()] || u.role || ''
        return isIncubateeRole(disp)
    }

    const branchNameOf = (branchesArr: any[], id?: string) =>
        branchesArr.find(b => b.id === id)?.name || id || ''

    const employeePositionOf = (employee: User) =>
        employee.position || employee.employeeType || ''

    const employmentTypeLabelOf = (employee: User) => {
        if (employee.employeementType === 'permanent') return 'Permanent'
        if (employee.employeementType === 'intern') return 'Intern'
        return ''
    }

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

        if (role === 'projectadmin') {
            return isMainCenterCoordinator
                ? [...ROLE_ASSIGNMENTS.projectadmin, 'Center Coordinator']
                : ROLE_ASSIGNMENTS.projectadmin
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

        return ROLE_ASSIGNMENTS[role] || []
    }

    const assignableRoles = React.useMemo(
        () => getAssignableRoles(),
        [user, isMainDepartmentUser, isMainCenterCoordinator, departments]
    )

    // Visibility and management are intentionally separate.
    // A project administrator can view branch coordinators, but cannot manage them.
    const canSeeUser = (me: any, u: User): boolean => {
        if (isSuperUser(me)) return true

        const myRole = (me?.role || '').toLowerCase()
        const displayRole = displayRoleOf(u)

        if (myRole === 'projectadmin') {
            const myBranchId = assignedBranchIdOf(me)
            const userBranchId = assignedBranchIdOf(u)

            if (!myBranchId || userBranchId !== myBranchId) return false

            const branchVisibleRoles = ['Receptionist', 'Employee', 'Coordinator']

            if (isMainCenterCoordinator) {
                branchVisibleRoles.push('Center Coordinator')
            }

            return branchVisibleRoles.includes(displayRole)
        }

        if (isMainDepartmentUser) {
            if (!isAdmin(me) && isIncubateeUser(u)) return false
            return true
        }

        const allowedRoles = assignableRoles.map(roleName => roleName.toLowerCase())
        if (!allowedRoles.includes(displayRole.toLowerCase())) return false

        if (myRole === 'operations') {
            if (!me?.departmentId) return false
            return u.departmentId === me.departmentId
        }

        return true
    }

    const canManageUser = (me: any, u: User): boolean => {
        if (!canSeeUser(me, u)) return false
        if (isSuperUser(me)) return true

        const myRole = (me?.role || '').toLowerCase()
        const displayRole = displayRoleOf(u)

        if (myRole === 'projectadmin') {
            if (displayRole === 'Coordinator') return false

            if (displayRole === 'Center Coordinator') {
                return isMainCenterCoordinator
            }

            return displayRole === 'Receptionist' || displayRole === 'Employee'
        }

        return true
    }

    const isProjectAdminCoordinatorViewOnly = (me: any, u: User) =>
        (me?.role || '').toLowerCase() === 'projectadmin' &&
        displayRoleOf(u) === 'Coordinator'

    const branchesForSelectedRole = React.useMemo(() => {
        const myRole = (user?.role || '').toLowerCase()
        const isProjectAdminManagedRole =
            myRole === 'projectadmin' &&
            (selectedRole === 'Receptionist' || selectedRole === 'Employee')

        if (!isProjectAdminManagedRole) return branches

        return branches.filter(branch => branch.id === currentProjectAdminBranchId)
    }, [
        branches,
        currentProjectAdminBranchId,
        selectedRole,
        user?.role
    ])

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

    // Load selectable programs. Project admins remain restricted to assignedPrograms.
    useEffect(() => {
        const chunk = <T,>(arr: T[], size: number) => {
            const out: T[][] = []
            for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
            return out
        }

        const loadPrograms = async () => {
            if (!user) return
            const myRole = (user?.role || '').toLowerCase()

            setProgramsLoading(true)
            try {
                // Admin / Director / Main Department: all programs.
                if (isAdmin(user) || myRole === 'director' || isMainDepartmentUser) {
                    const snap = await getDocs(collection(db, 'programs'))
                    setSelectablePrograms(
                        snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                    )
                    return
                }

                // Project Admin: only programs explicitly assigned to the user.
                if (myRole === 'projectadmin') {
                    let myProgramIds: string[] = Array.isArray((user as any)?.assignedPrograms)
                        ? ((user as any).assignedPrograms as string[])
                        : []

                    // Fallback to the users record when identity does not contain assignedPrograms.
                    if (!myProgramIds.length && user?.email) {
                        const usnap = await getDocs(
                            query(
                                collection(db, 'users'),
                                where('email', '==', user.email),
                                limit(1)
                            )
                        )

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

                    const results: any[] = []
                    for (const ids of chunk(myProgramIds, 10)) {
                        const psnap = await getDocs(
                            query(
                                collection(db, 'programs'),
                                where(documentId(), 'in', ids)
                            )
                        )
                        results.push(
                            ...psnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                        )
                    }

                    setSelectablePrograms(results)
                    return
                }

                setSelectablePrograms([])
            } catch (e) {
                console.warn('Failed to load programs', e)
                setSelectablePrograms([])
            } finally {
                setProgramsLoading(false)
            }
        }

        loadPrograms()
    }, [user?.role, user?.email, user?.assignedPrograms, isMainDepartmentUser])

    // Live users list. Access is scoped by canSeeUser rather than company.
    useEffect(() => {
        setLoading(true)

        const unsub = onSnapshot(
            collection(db, 'users'),
            snap => {
                const list = snap.docs.map(d => {
                    const data = d.data() as any
                    return {
                        id: d.id,
                        ...data,
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
    }, [])

    // open modal for create/edit
    const showModal = async (edit = false, u: User | null = null) => {
        if (edit && u && !canManageUser(user, u)) {
            message.warning('This coordinator is view only and cannot be edited.')
            return
        }

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
                nationalCoordinator: Boolean(u.nationalCoordinator),
                position: u.position || u.employeeType || undefined,
                employeementType: u.employeementType || undefined,
                startDate: u.startDate ? dayjs(u.startDate) : undefined,
                endDate: u.endDate ? dayjs(u.endDate) : undefined
            })
        } else {
            form.resetFields()
            setSelectedRole('')
            form.setFieldsValue({
                status: true,
                assignedBranch: currentProjectAdminBranchId || undefined
            })
        }
    }

    // role change -> clear irrelevant assignments
    const handleRoleChange = (role: string) => {
        setSelectedRole(role)

        const isProjectAdminManagedRole =
            (user?.role || '').toLowerCase() === 'projectadmin' &&
            (role === 'Receptionist' || role === 'Employee')

        if (isProjectAdminManagedRole) {
            form.setFieldsValue({
                assignedBranch: currentProjectAdminBranchId || undefined
            })
        } else if (!BRANCH_SCOPED_ROLES.includes(role)) {
            form.setFieldsValue({ assignedBranch: undefined })
        }

        if (role !== 'Employee') {
            form.setFieldsValue({
                position: undefined,
                employeementType: undefined,
                startDate: undefined,
                endDate: undefined
            })
        }
        if (!DEPARTMENT_SCOPED_ROLES.includes(role)) {
            form.setFieldsValue({ departmentId: undefined })
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
                limit(1)
            )
        )

        if (qs.empty) {
            await addDoc(collection(db, 'operationsStaff'), {
                email,
                name,
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

    // create/update handler
    const handleSubmit = async (values: any) => {
        setSavingUser(true)
        try {
            const myRole = (user?.role || '').toLowerCase()

            if (isEditMode && currentUser && !canManageUser(user, currentUser)) {
                message.error('This coordinator is view only and cannot be changed.')
                return
            }

            if (myRole === 'projectadmin') {
                const projectAdminCreateRoles = new Set([
                    'Receptionist',
                    'Employee',
                    ...(isMainCenterCoordinator ? ['Center Coordinator'] : [])
                ])

                if (!projectAdminCreateRoles.has(values?.role)) {
                    message.error('Project administrators can only manage receptionists and employees.')
                    return
                }

                if (values?.role === 'Receptionist' || values?.role === 'Employee') {
                    if (!currentProjectAdminBranchId) {
                        message.error('Your account does not have an assigned branch.')
                        return
                    }

                    values.assignedBranch = currentProjectAdminBranchId
                }
            }

            if (!isAdmin(user) && values?.role === 'Incubatee') {
                message.error(
                    'You do not have permission to assign the Incubatee role.'
                )
                setSavingUser(false)
                return
            }

            // Funders must have at least 1 program
            if (values?.role === 'Funder') {
                const sel: string[] = Array.isArray(values?.assignedPrograms)
                    ? values.assignedPrograms
                    : []
                if (!sel.length) {
                    message.error('Please select at least 1 program for this funder.')
                    setSavingUser(false)
                    return
                }

                // Project administrators can only assign funders to their own programs
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

            const employeePosition =
                values?.role === 'Employee'
                    ? String(values?.position || '').trim()
                    : null
            const employeeEmploymentType =
                values?.role === 'Employee'
                    ? values?.employeementType || null
                    : null
            const employeeStartDate =
                values?.role === 'Employee' &&
                    employeeEmploymentType === 'intern' &&
                    values?.startDate
                    ? dayjs(values.startDate).format('YYYY-MM-DD')
                    : null
            const employeeEndDate =
                values?.role === 'Employee' &&
                    employeeEmploymentType === 'intern' &&
                    values?.endDate
                    ? dayjs(values.endDate).format('YYYY-MM-DD')
                    : null

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
                    // Ensure no stale programs
                    assignedPrograms:
                        values.role === 'Funder' || values.role === 'Coordinator'
                            ? (Array.isArray(values.assignedPrograms) ? values.assignedPrograms : [])
                            : [],
                    position: employeePosition,
                    employeementType: employeeEmploymentType,
                    startDate: employeeStartDate,
                    endDate: employeeEndDate,
                    employeeType: null
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
                    const sel = departments.find(d => d.id === values.departmentId)
                    updateData.assignedBranch = null
                    updateData.departmentId = sel?.id || values.departmentId
                    updateData.departmentName = sel?.name || 'Unknown'
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
                let departmentIdForPayload: string | null = null
                let departmentNameForPayload: string | null = null

                if (DEPARTMENT_SCOPED_ROLES.includes(values.role)) {
                    const sel = departments.find(d => d.id === values.departmentId)
                    departmentIdForPayload = sel?.id || values.departmentId || null
                    departmentNameForPayload = sel?.name || null
                }

                const payload: any = {
                    email: values.email,
                    name: values.name,
                    role: backendRole,
                    assignedBranch: BRANCH_SCOPED_ROLES.includes(values.role)
                        ? values.assignedBranch
                        : null,
                    departmentId: departmentIdForPayload,
                    departmentName: departmentNameForPayload,
                    status: values.status ? 'Active' : 'Inactive',
                    // Funders assigned programs (and clear for non-funders)
                    assignedPrograms:
                        values.role === 'Funder' || values.role === 'Coordinator'
                            ? (Array.isArray(values.assignedPrograms) ? values.assignedPrograms : [])
                            : [],
                    position: employeePosition,
                    employeementType: employeeEmploymentType,
                    startDate: employeeStartDate,
                    endDate: employeeEndDate,
                    employeeType: null,
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

                        // Do not fall through to the success branch
                        return
                    }

                    if (values.role === 'Employee') {
                        const createdUserId = data?.uid || data?.userId || null
                        const employeePatch = {
                            position: employeePosition,
                            employeementType: employeeEmploymentType,
                            startDate: employeeStartDate,
                            endDate: employeeEndDate,
                            employeeType: null,
                            assignedBranch: payload.assignedBranch,
                            updatedAt: new Date().toISOString()
                        }

                        if (createdUserId) {
                            await setDoc(
                                doc(db, 'users', createdUserId),
                                employeePatch,
                                { merge: true }
                            )
                        } else {
                            const createdUserQuery = query(
                                collection(db, 'users'),
                                where('email', '==', String(values.email).trim().toLowerCase()),
                                limit(1)
                            )
                            const createdUserSnapshot = await getDocs(createdUserQuery)

                            if (!createdUserSnapshot.empty) {
                                await setDoc(
                                    doc(db, 'users', createdUserSnapshot.docs[0].id),
                                    employeePatch,
                                    { merge: true }
                                )
                            }
                        }
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
            message.success('Password reset successfully.')
        } catch (error: any) {
            console.error('Password reset error:', error)
            message.error(error.message || 'Failed to reset password.')
        }
    }

    const toggleUserStatus = async (u: User) => {
        if (!canManageUser(user, u)) {
            message.error('This coordinator is view only and cannot be changed.')
            return
        }

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

    const scopedUsers = isAdmin(user)
        ? visibleUsers
        : isMainDepartmentUser
            ? visibleUsers.filter(u => !isIncubateeUser(u))
            : visibleUsers

    const domainFilteredUsers = scopedUsers.filter(
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
        const search = searchText.trim().toLowerCase()

        return domainFilteredUsers.filter(item => {
            const matchesSearch =
                !search ||
                (item.name || '').toLowerCase().includes(search) ||
                (item.email || '').toLowerCase().includes(search) ||
                branchNameOf(
                    branches,
                    assignedBranchIdOf(item)
                ).toLowerCase().includes(search) ||
                (item.departmentName || '').toLowerCase().includes(search) ||
                (item.position || '').toLowerCase().includes(search) ||
                (item.employeementType || '').toLowerCase().includes(search) ||
                (item.status || '').toLowerCase().includes(search)

            const matchesRole =
                !roleFilter || displayRoleOf(item) === roleFilter

            return matchesSearch && matchesRole
        })
    }, [
        searchText,
        roleFilter,
        domainFilteredUsers,
        branches
    ])

    const roleFilterOptions = React.useMemo(() => {
        if (isSuperUser(user)) return AVAILABLE_ROLES

        if ((user?.role || '').toLowerCase() === 'projectadmin') {
            return Array.from(new Set([...visibleAssignableRoles, 'Coordinator']))
        }

        return visibleAssignableRoles
    }, [user, visibleAssignableRoles])

    // Organogram is only meaningful for a Center Coordinator (branch root) or
    // a Head Of Department (department root) — both need their scope id.
    const myBackendRole = (user?.role || '').toLowerCase()
    const canViewOrgChart =
        (myBackendRole === 'projectadmin' && !!currentProjectAdminBranchId) ||
        (myBackendRole === 'operations' && !!user?.departmentId)

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
            render: (role: string, record: User) => {
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
                                        : displayRole === 'Center Coordinator'
                                            ? 'magenta' : displayRole === 'Receptionist'
                                                ? 'lime'
                                                : 'default'

                return (
                    <Space size={[4, 4]} wrap>
                        <Tag color={color}>{displayRole || 'Unknown'}</Tag>
                        {displayRole === 'Employee' && employeePositionOf(record) ? (
                            <Tag color='blue'>{employeePositionOf(record)}</Tag>
                        ) : null}
                        {displayRole === 'Employee' && employmentTypeLabelOf(record) ? (
                            <Tag color={record.employeementType === 'intern' ? 'orange' : 'green'}>
                                {employmentTypeLabelOf(record)}
                            </Tag>
                        ) : null}
                        {(user?.role || '').toLowerCase() === 'projectadmin' &&
                            displayRole === 'Coordinator' ? (
                            <Tag>View only</Tag>
                        ) : null}
                    </Space>
                )
            },
            width: '14%',
            ellipsis: true,
            responsive: ['md']
        },
        {
            title: 'Assignment',
            key: 'assignment',
            render: (_: unknown, record: User) => {
                const displayRole = displayRoleOf(record)

                if (displayRole === 'Funder') {
                    const count = Array.isArray(record.assignedPrograms)
                        ? record.assignedPrograms.length
                        : 0

                    return <Tag color='gold'>Programs: {count}</Tag>
                }

                if (displayRole === 'Coordinator') {
                    const departmentName = departmentNameOf(record)

                    return departmentName ? (
                        <Tag color='orange'>{departmentName}</Tag>
                    ) : (
                        <Tag>Department not assigned</Tag>
                    )
                }

                if (
                    displayRole === 'Receptionist' ||
                    displayRole === 'Employee'
                ) {
                    return <Tag color='blue'>Current Centre</Tag>
                }

                const branchId = assignedBranchIdOf(record)

                if (branchId) {
                    const branch = branches.find(item => item.id === branchId)

                    return (
                        <Tag color='blue'>
                            {branch?.name || branchId}
                        </Tag>
                    )
                }

                const departmentName = departmentNameOf(record)

                if (departmentName) {
                    return <Tag color='orange'>{departmentName}</Tag>
                }

                return <Tag>Not Assigned</Tag>
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
            render: (status: string, record: User) => {
                const manageable = canManageUser(user, record)
                const statusTag = (
                    <Tag
                        color={status === 'Active' ? 'success' : 'error'}
                        style={{ cursor: manageable ? 'pointer' : 'default' }}
                    >
                        {status}
                    </Tag>
                )

                if (!manageable) {
                    return <Tooltip title='View only'>{statusTag}</Tooltip>
                }

                return (
                    <Popconfirm
                        title={`Change user status to ${status === 'Active' ? 'Inactive' : 'Active'
                            }?`}
                        onConfirm={() => toggleUserStatus(record)}
                        okText='Yes'
                        cancelText='No'
                    >
                        {statusTag}
                    </Popconfirm>
                )
            },
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

                if (isProjectAdminCoordinatorViewOnly(user, record)) {
                    return <Tag>View only</Tag>
                }

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
                                    size='small'
                                    icon={
                                        deletingId === record.id ? (
                                            <LoadingOutlined />
                                        ) : (
                                            <DeleteOutlined />
                                        )
                                    }
                                    danger
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
                                    : displayRole === 'Center Coordinator'
                                        ? 'magenta' : displayRole === 'Receptionist'
                                            ? 'lime'
                                            : 'default'
            return (
                <Space size={[4, 4]} wrap>
                    <Tag color={color}>{displayRole}</Tag>
                    {displayRole === 'Employee' && employeePositionOf(item) ? (
                        <Tag color='blue'>{employeePositionOf(item)}</Tag>
                    ) : null}
                    {displayRole === 'Employee' && employmentTypeLabelOf(item) ? (
                        <Tag color={item.employeementType === 'intern' ? 'orange' : 'green'}>
                            {employmentTypeLabelOf(item)}
                        </Tag>
                    ) : null}
                    {(user?.role || '').toLowerCase() === 'projectadmin' &&
                        displayRole === 'Coordinator' ? (
                        <Tag>View only</Tag>
                    ) : null}
                </Space>
            )
        })()

        const assignmentTag = (() => {
            const displayRole = displayRoleOf(item)

            if (displayRole === 'Funder') {
                const count = Array.isArray(item.assignedPrograms)
                    ? item.assignedPrograms.length
                    : 0

                return <Tag color='gold'>Programs: {count}</Tag>
            }

            if (displayRole === 'Coordinator') {
                const departmentName = departmentNameOf(item)

                return departmentName ? (
                    <Tag color='orange'>{departmentName}</Tag>
                ) : (
                    <Tag>Department not assigned</Tag>
                )
            }

            if (
                displayRole === 'Receptionist' ||
                displayRole === 'Employee'
            ) {
                return null
            }

            const branchId = assignedBranchIdOf(item)

            if (branchId) {
                const branch = branches.find(row => row.id === branchId)

                return (
                    <Tag color='blue'>
                        {branch?.name || branchId}
                    </Tag>
                )
            }

            const departmentName = departmentNameOf(item)

            if (departmentName) {
                return <Tag color='orange'>{departmentName}</Tag>
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

                    {isProjectAdminCoordinatorViewOnly(user, item) ? (
                        <Tag>Coordinator details are view only</Tag>
                    ) : (
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
                    )}
                </Space>
            </Card>
        )
    }

    const userMetrics: DashboardMetric[] = [
        {
            key: 'team',
            title: 'Team Members',
            value: scopedTotals.total,
            icon: <UserOutlined style={{ color: '#1677ff' }} />,
            iconBg: 'rgba(22,119,255,.12)',
            important: true
        },
        {
            key: 'active',
            title: 'Active Members',
            value: scopedTotals.active,
            icon: <SmileOutlined style={{ color: '#16a34a' }} />,
            iconBg: 'rgba(22,163,74,.12)',
            important: true
        },
        {
            key: 'inactive',
            title: 'Inactive Members',
            value: scopedTotals.inactive,
            icon: <FrownOutlined style={{ color: '#dc2626' }} />,
            iconBg: 'rgba(220,38,38,.12)'
        }
    ]

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
                    <div style={{ marginBottom: 16 }}>
                        <MetricsGrid metrics={userMetrics} />
                    </div>

                    {/* Toolbar */}
                    {isMobile ? (
                        <>
                            <MotionCard filterBar={
                                < Row gutter={[8, 8]} align='middle'>
                                    <Col xs={24} sm={24} md={8}>
                                        <Input.Search
                                            placeholder='Search by name, email, position or department'
                                            value={searchText}
                                            onChange={event => setSearchText(event.target.value)}
                                            onSearch={value => setSearchText(value)}
                                            allowClear
                                            style={{ width: '100%' }}
                                        />
                                    </Col>

                                    <Col xs={24} sm={12} md={4}>
                                        <Select
                                            placeholder='Filter by role'
                                            value={roleFilter}
                                            onChange={value => setRoleFilter(value)}
                                            allowClear
                                            showSearch
                                            optionFilterProp='label'
                                            style={{ width: '100%' }}
                                            options={roleFilterOptions.map(role => ({
                                                value: role,
                                                label: role
                                            }))}
                                        />
                                    </Col>

                                    <Col xs={24} sm={12} md={3}>
                                        <Button
                                            icon={<ReloadOutlined />}
                                            onClick={handleRefresh}
                                            block
                                        >
                                            Refresh
                                        </Button>
                                    </Col>

                                    {canViewOrgChart && (
                                        <Col xs={24} sm={12} md={5}>
                                            <Button
                                                onClick={() => setIsOrgChartVisible(true)}
                                                block
                                            >
                                                View Organogram
                                            </Button>
                                        </Col>
                                    )}

                                    <Col
                                        xs={24}
                                        sm={canViewOrgChart ? 12 : 24}
                                        md={canViewOrgChart ? 4 : 9}
                                    >
                                        <Button
                                            type='primary'
                                            icon={<UserAddOutlined />}
                                            onClick={() => showModal()}
                                            block
                                        >
                                            Add User
                                        </Button>
                                    </Col>
                                </Row>}
                                filterBarProps={{ marginBottom: 0 }}
                                style={{ marginBottom: 16 }}>
                            </MotionCard>

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
                                    showSizeChanger: false,
                                    position: 'bottom',
                                    align: 'center'
                                }}
                            />
                        </>
                    ) : (
                        <MotionCard filterBar={
                            < Row gutter={[8, 8]} align='middle'>
                                <Col xs={24} sm={24} md={8}>
                                    <Input.Search
                                        placeholder='Search by name, email, position or department'
                                        value={searchText}
                                        onChange={event => setSearchText(event.target.value)}
                                        onSearch={value => setSearchText(value)}
                                        allowClear
                                        style={{ width: '100%' }}
                                    />
                                </Col>

                                <Col xs={24} sm={12} md={4}>
                                    <Select
                                        placeholder='Filter by role'
                                        value={roleFilter}
                                        onChange={value => setRoleFilter(value)}
                                        allowClear
                                        showSearch
                                        optionFilterProp='label'
                                        style={{ width: '100%' }}
                                        options={roleFilterOptions.map(role => ({
                                            value: role,
                                            label: role
                                        }))}
                                    />
                                </Col>

                                <Col xs={24} sm={12} md={3}>
                                    <Button
                                        icon={<ReloadOutlined />}
                                        onClick={handleRefresh}
                                        block
                                    >
                                        Refresh
                                    </Button>
                                </Col>

                                {canViewOrgChart && (
                                    <Col xs={24} sm={12} md={5}>
                                        <Button
                                            onClick={() => setIsOrgChartVisible(true)}
                                            block
                                        >
                                            View Organogram
                                        </Button>
                                    </Col>
                                )}

                                <Col
                                    xs={24}
                                    sm={canViewOrgChart ? 12 : 24}
                                    md={canViewOrgChart ? 4 : 9}
                                >
                                    <Button
                                        type='primary'
                                        icon={<UserAddOutlined />}
                                        onClick={() => showModal()}
                                        block
                                    >
                                        Add User
                                    </Button>
                                </Col>
                            </Row>}
                            filterBarProps={{ marginBottom: 10 }}
                            style={{ marginBottom: 16 }}>
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
                                <Select
                                    placeholder='Select role'
                                    onChange={handleRoleChange}
                                    disabled={
                                        isEditMode &&
                                        (user?.role || '').toLowerCase() === 'projectadmin'
                                    }
                                >
                                    {visibleAssignableRoles.map(role => (
                                        <Select.Option key={role} value={role}>
                                            {role}
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>

                            {selectedRole === 'Employee' && (
                                <>
                                    <Form.Item
                                        name='position'
                                        label='Position'
                                        rules={[
                                            {
                                                required: true,
                                                whitespace: true,
                                                message: 'Please enter the employee position'
                                            }
                                        ]}
                                    >
                                        <Input placeholder='e.g. Admin, Handyman or Office Assistant' />
                                    </Form.Item>

                                    <Form.Item
                                        name='employeementType'
                                        label='Employment Type'
                                        rules={[
                                            {
                                                required: true,
                                                message: 'Please select the employment type'
                                            }
                                        ]}
                                    >
                                        <Select
                                            placeholder='Select employment type'
                                            onChange={value => {
                                                if (value !== 'intern') {
                                                    form.setFieldsValue({
                                                        startDate: undefined,
                                                        endDate: undefined
                                                    })
                                                }
                                            }}
                                        >
                                            <Select.Option value='permanent'>
                                                Permanent
                                            </Select.Option>
                                            <Select.Option value='intern'>
                                                Intern
                                            </Select.Option>
                                        </Select>
                                    </Form.Item>

                                    <Form.Item
                                        noStyle
                                        shouldUpdate={(previous, current) =>
                                            previous.employeementType !==
                                            current.employeementType
                                        }
                                    >
                                        {({ getFieldValue }) =>
                                            getFieldValue('employeementType') === 'intern' ? (
                                                <Row gutter={12}>
                                                    <Col xs={24} sm={12}>
                                                        <Form.Item
                                                            name='startDate'
                                                            label='Internship Start Date'
                                                            rules={[
                                                                {
                                                                    required: true,
                                                                    message: 'Please select the start date'
                                                                }
                                                            ]}
                                                        >
                                                            <DatePicker
                                                                style={{ width: '100%' }}
                                                                format='DD MMM YYYY'
                                                            />
                                                        </Form.Item>
                                                    </Col>

                                                    <Col xs={24} sm={12}>
                                                        <Form.Item
                                                            name='endDate'
                                                            label='Internship End Date'
                                                            dependencies={['startDate']}
                                                            rules={[
                                                                {
                                                                    required: true,
                                                                    message: 'Please select the end date'
                                                                },
                                                                ({ getFieldValue }) => ({
                                                                    validator(_, value) {
                                                                        const startDate =
                                                                            getFieldValue('startDate')

                                                                        if (
                                                                            !value ||
                                                                            !startDate ||
                                                                            dayjs(value).isAfter(
                                                                                dayjs(startDate)
                                                                            )
                                                                        ) {
                                                                            return Promise.resolve()
                                                                        }

                                                                        return Promise.reject(
                                                                            new Error(
                                                                                'End date must be after the start date'
                                                                            )
                                                                        )
                                                                    }
                                                                })
                                                            ]}
                                                        >
                                                            <DatePicker
                                                                style={{ width: '100%' }}
                                                                format='DD MMM YYYY'
                                                            />
                                                        </Form.Item>
                                                    </Col>
                                                </Row>
                                            ) : null
                                        }
                                    </Form.Item>
                                </>
                            )}

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

                            {/* Department picker for dept-scoped roles */}
                            {DEPARTMENT_SCOPED_ROLES.includes(selectedRole) && (
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

                            {BRANCH_SCOPED_ROLES.includes(selectedRole) &&
                                !(
                                    (user?.role || '').toLowerCase() === 'projectadmin' &&
                                    (selectedRole === 'Receptionist' || selectedRole === 'Employee')
                                ) && (
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
                                            {branchesForSelectedRole.map(branch => {
                                                const locationStr =
                                                    typeof branch.location === 'string'
                                                        ? branch.location
                                                        : branch.location?.city ||
                                                        branch.location?.address ||
                                                        'Unknown Location'

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

                    {isOrgChartVisible && (
                        <OrganogramModal
                            open={isOrgChartVisible}
                            onClose={() => setIsOrgChartVisible(false)}
                            me={user}
                            users={domainFilteredUsers}
                            branches={branches}
                            departments={departments}
                            displayRoleOf={displayRoleOf}
                            assignedBranchIdOf={assignedBranchIdOf}
                        />
                    )}
                </>
            )
            }
        </div >
    )
}

export default UserManagement
